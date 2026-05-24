// Supplier Purchase Orders — material orders we place WITH a supplier.
import { Router } from 'express';
import { z } from 'zod';
import { q, qOne, insert, update, del, txn } from '../lib/db.js';
import { AppError, asyncHandler } from '../lib/errors.js';
import { requireAuth, requirePermission } from '../lib/auth.js';
import { resolveTenant } from '../lib/tenant.js';

const router = Router();
router.use(requireAuth, resolveTenant);

const itemSchema = z.object({
  description: z.string().trim().min(1).max(300),
  hsnCode:     z.string().trim().max(20).optional().nullable(),
  qty:         z.coerce.number().positive(),
  unit:        z.string().trim().min(1).max(20),
  rate:        z.coerce.number().nonnegative(),
  amount:      z.coerce.number().nonnegative(),
});

const createSchema = z.object({
  poNumber:     z.string().trim().min(1).max(60),
  supplierId:   z.string().min(1),
  orderDate:    z.coerce.date(),
  expectedDate: z.coerce.date().optional().nullable(),
  notes:        z.string().max(2000).optional().nullable(),
  items:        z.array(itemSchema).min(1, 'Add at least one item'),
});

const updateSchema = z.object({
  poNumber:     z.string().trim().min(1).max(60),
  supplierId:   z.string().min(1),
  orderDate:    z.coerce.date(),
  expectedDate: z.coerce.date().optional().nullable(),
  status:       z.enum(['PENDING', 'PARTIAL', 'RECEIVED', 'CANCELLED']).optional(),
  notes:        z.string().max(2000).optional().nullable(),
  items:        z.array(itemSchema.extend({ id: z.string().optional() })).min(1),
});

const receiveSchema = z.object({
  receipts: z.record(z.string(), z.coerce.number().min(0)),
});

const loadOne = async (id, companyId) => {
  const po = await qOne(
    'SELECT * FROM `SupplierOrder` WHERE `id` = ? AND `companyId` = ?',
    [id, companyId]
  );
  if (!po) return null;
  const items = await q(
    'SELECT * FROM `SupplierOrderItem` WHERE `supplierOrderId` = ? ORDER BY `createdAt` ASC',
    [po.id]
  );
  const supplier = await qOne(
    'SELECT `id`,`name`,`gstNumber`,`gstRate`,`state`,`address` FROM `Supplier` WHERE `id` = ?',
    [po.supplierId]
  );
  return { ...po, items, supplier };
};

/* GET /item-suggestions
   Distinct (description, hsnCode, unit) tuples used previously by this
   company — feeds the typeahead on the New / Edit Supplier PO pages so
   users can re-pick already-entered items without retyping the HSN. */
router.get('/item-suggestions', requirePermission('add_supplier_po'), asyncHandler(async (req, res) => {
  const { search } = z.object({
    search: z.string().trim().max(120).optional(),
  }).parse(req.query);

  let where = 'so.`companyId` = ?';
  const params = [req.tenant.companyId];
  if (search) {
    where += ' AND (soi.`description` LIKE ? OR soi.`hsnCode` LIKE ?)';
    const like = `%${search}%`;
    params.push(like, like);
  }

  const rows = await q(
    `SELECT soi.\`description\` AS description,
            soi.\`hsnCode\`     AS hsnCode,
            soi.\`unit\`        AS unit,
            COUNT(*)            AS uses,
            MAX(so.\`createdAt\`) AS lastUsedAt
       FROM \`SupplierOrderItem\` soi
       INNER JOIN \`SupplierOrder\` so ON so.\`id\` = soi.\`supplierOrderId\`
      WHERE ${where}
      GROUP BY soi.\`description\`, soi.\`hsnCode\`, soi.\`unit\`
      ORDER BY uses DESC, lastUsedAt DESC
      LIMIT 200`,
    params
  );

  res.json({
    items: rows.map((r) => ({
      description: r.description,
      hsnCode:     r.hsnCode,
      unit:        r.unit,
      uses:        Number(r.uses),
    })),
  });
}));

/* POST / */
router.post('/', requirePermission('add_supplier_po'), asyncHandler(async (req, res) => {
  const data = createSchema.parse(req.body);

  const supplier = await qOne(
    `SELECT s.* FROM \`Supplier\` s
       INNER JOIN \`SupplierMembership\` sm ON sm.\`supplierId\` = s.\`id\`
      WHERE s.\`id\` = ? AND sm.\`companyId\` = ? LIMIT 1`,
    [data.supplierId, req.tenant.companyId]
  );
  if (!supplier) throw new AppError('Supplier not found', 400, 'BAD_SUPPLIER');

  const dup = await qOne(
    'SELECT `id` FROM `SupplierOrder` WHERE `companyId` = ? AND `poNumber` = ?',
    [req.tenant.companyId, data.poNumber]
  );
  if (dup) throw new AppError('PO number already exists in this company', 409, 'PO_DUPLICATE');

  const poId = await txn(async (tx) => {
    const po = await tx.insert('SupplierOrder', {
      poNumber:     data.poNumber,
      orderDate:    data.orderDate,
      expectedDate: data.expectedDate ?? null,
      notes:        data.notes ?? null,
      companyId:    req.tenant.companyId,
      supplierId:   supplier.id,
      createdById:  req.auth.userId,
    });
    for (const it of data.items) {
      await tx.insert('SupplierOrderItem', {
        supplierOrderId: po.id,
        description: it.description,
        hsnCode:     it.hsnCode ?? null,
        qty:         it.qty,
        unit:        it.unit,
        rate:        it.rate,
        amount:      it.amount,
      });
    }
    return po.id;
  });

  res.status(201).json(await loadOne(poId, req.tenant.companyId));
}));

/* GET / */
router.get('/', requirePermission('view_supplier_po'), asyncHandler(async (req, res) => {
  const { page, pageSize, search, status } = z.object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(200).default(50),
    search: z.string().trim().max(120).optional(),
    status: z.enum(['PENDING', 'PARTIAL', 'RECEIVED', 'CANCELLED', 'ALL']).default('ALL'),
  }).parse(req.query);
  const skip = (page - 1) * pageSize;

  let where = 'so.`companyId` = ?';
  const params = [req.tenant.companyId];
  if (status !== 'ALL') { where += ' AND so.`status` = ?'; params.push(status); }
  if (search) {
    const like = `%${search}%`;
    where += ` AND (
      so.\`poNumber\` LIKE ?
      OR s.\`name\` LIKE ?
      OR EXISTS (SELECT 1 FROM \`SupplierOrderItem\` soi
                 WHERE soi.\`supplierOrderId\` = so.\`id\`
                   AND (soi.\`description\` LIKE ? OR soi.\`hsnCode\` LIKE ?))
    )`;
    params.push(like, like, like, like);
  }

  const [rows, totalRow] = await Promise.all([
    q(
      `SELECT so.* FROM \`SupplierOrder\` so
         INNER JOIN \`Supplier\` s ON s.\`id\` = so.\`supplierId\`
        WHERE ${where} ORDER BY so.\`createdAt\` DESC LIMIT ? OFFSET ?`,
      [...params, pageSize, skip]
    ),
    qOne(
      `SELECT COUNT(*) AS n FROM \`SupplierOrder\` so
         INNER JOIN \`Supplier\` s ON s.\`id\` = so.\`supplierId\`
        WHERE ${where}`,
      params
    ),
  ]);

  const items = await Promise.all(rows.map((r) => loadOne(r.id, req.tenant.companyId)));
  res.json({ items, total: Number(totalRow?.n ?? 0), page, pageSize });
}));

/* GET /:id */
router.get('/:id', requirePermission('view_supplier_po'), asyncHandler(async (req, res) => {
  const po = await loadOne(req.params.id, req.tenant.companyId);
  if (!po) throw new AppError('Supplier order not found', 404, 'NOT_FOUND');
  res.json(po);
}));

/* PUT /:id — full replace including items */
router.put('/:id', requirePermission('add_supplier_po'), asyncHandler(async (req, res) => {
  const data = updateSchema.parse(req.body);
  const existing = await loadOne(req.params.id, req.tenant.companyId);
  if (!existing) throw new AppError('Supplier order not found', 404, 'NOT_FOUND');

  const supplier = await qOne(
    `SELECT s.* FROM \`Supplier\` s
       INNER JOIN \`SupplierMembership\` sm ON sm.\`supplierId\` = s.\`id\`
      WHERE s.\`id\` = ? AND sm.\`companyId\` = ? LIMIT 1`,
    [data.supplierId, req.tenant.companyId]
  );
  if (!supplier) throw new AppError('Supplier not found', 400, 'BAD_SUPPLIER');

  await txn(async (tx) => {
    await tx.q('DELETE FROM `SupplierOrderItem` WHERE `supplierOrderId` = ?', [existing.id]);
    await tx.update('SupplierOrder', existing.id, {
      poNumber:     data.poNumber,
      orderDate:    data.orderDate,
      expectedDate: data.expectedDate ?? null,
      status:       data.status ?? existing.status,
      notes:        data.notes ?? null,
      supplierId:   supplier.id,
    });
    for (const it of data.items) {
      await tx.insert('SupplierOrderItem', {
        supplierOrderId: existing.id,
        description: it.description,
        hsnCode:     it.hsnCode ?? null,
        qty:         it.qty,
        unit:        it.unit,
        rate:        it.rate,
        amount:      it.amount,
      });
    }
  });

  res.json(await loadOne(existing.id, req.tenant.companyId));
}));

/* POST /:id/receive */
router.post('/:id/receive', requirePermission('add_supplier_po'), asyncHandler(async (req, res) => {
  const { receipts } = receiveSchema.parse(req.body);
  const po = await loadOne(req.params.id, req.tenant.companyId);
  if (!po) throw new AppError('Supplier order not found', 404, 'NOT_FOUND');

  await txn(async (tx) => {
    for (const item of po.items) {
      const cumulative = receipts[item.id];
      if (cumulative === undefined) continue;
      const clamped = Math.min(cumulative, item.qty);
      await tx.update('SupplierOrderItem', item.id, { receivedQty: clamped });
    }
  });

  const fresh = await loadOne(po.id, req.tenant.companyId);
  const allFull = fresh.items.every((it) => it.receivedQty >= it.qty);
  const anyPartial = fresh.items.some((it) => it.receivedQty > 0);
  const newStatus = allFull ? 'RECEIVED' : anyPartial ? 'PARTIAL' : 'PENDING';
  await update('SupplierOrder', fresh.id, { status: newStatus });
  res.json(await loadOne(fresh.id, req.tenant.companyId));
}));

/* DELETE /:id */
router.delete('/:id', requirePermission('add_supplier_po'), asyncHandler(async (req, res) => {
  const po = await qOne(
    'SELECT `id` FROM `SupplierOrder` WHERE `id` = ? AND `companyId` = ?',
    [req.params.id, req.tenant.companyId]
  );
  if (!po) throw new AppError('Supplier order not found', 404, 'NOT_FOUND');
  await del('SupplierOrder', po.id);
  res.status(204).end();
}));

export default router;
