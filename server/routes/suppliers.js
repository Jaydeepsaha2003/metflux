// Suppliers — a Supplier record can be shared across many companies via
// SupplierMembership, mirroring the Labour ⇄ LabourMembership pattern.
// Tenant scoping is done through that join table, NOT Supplier.companyId.
import { Router } from 'express';
import { z } from 'zod';
import { q, qOne, txn } from '../lib/db.js';
import { AppError, asyncHandler } from '../lib/errors.js';
import { requireAuth, requirePermission } from '../lib/auth.js';
import { resolveTenant } from '../lib/tenant.js';

const router = Router();
router.use(requireAuth, resolveTenant);

const idParam = z.object({ id: z.string().min(1) });
const paginationQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(20),
  search: z.string().trim().max(120).optional(),
});

// Base supplier fields (no company info — that lives in SupplierMembership).
const supplierFieldsBase = z.object({
  name:      z.string().trim().min(1).max(160),
  email:     z.string().email().optional().nullable().or(z.literal('')),
  phone:     z.string().trim().max(40).optional().nullable(),
  address:   z.string().trim().max(400).optional().nullable(),
  gstNumber: z.string().trim().max(40).optional().nullable(),
  state:     z.string().trim().max(80).optional().nullable(),
  gstRate:   z.coerce.number().min(0).max(100).default(0),
  notes:     z.string().trim().max(2000).optional().nullable(),
});

const createSchema = supplierFieldsBase.extend({
  companyIds: z.array(z.string()).min(1, 'Assign to at least one company'),
});

const updateSchema = supplierFieldsBase.partial().extend({
  companyIds: z.array(z.string()).min(1).optional(),
});

const normalizeEmail = (v) => ({ ...v, email: v.email === '' ? null : v.email });

// Returns the membership rows for a supplier in the shape the client wants:
// { id, supplierId, companyId, createdAt, company: {id, name} }
const loadCompanies = async (supplierId) => {
  const rows = await q(
    `SELECT sm.\`id\` AS sm_id, sm.\`supplierId\`, sm.\`companyId\`, sm.\`createdAt\`,
            c.\`id\` AS c_id, c.\`name\` AS c_name
       FROM \`SupplierMembership\` sm
       INNER JOIN \`Company\` c ON c.\`id\` = sm.\`companyId\`
      WHERE sm.\`supplierId\` = ?`,
    [supplierId]
  );
  return rows.map((r) => ({
    id: r.sm_id,
    supplierId: r.supplierId,
    companyId: r.companyId,
    createdAt: r.createdAt,
    company: { id: r.c_id, name: r.c_name },
  }));
};

const withCompanies = async (supplier) => {
  if (!supplier) return supplier;
  return { ...supplier, companies: await loadCompanies(supplier.id) };
};

// True iff the supplier is a member of the active tenant.
const isSupplierInTenant = (supplierId, companyId) => qOne(
  'SELECT `id` FROM `SupplierMembership` WHERE `supplierId` = ? AND `companyId` = ?',
  [supplierId, companyId]
);

/* GET / — suppliers visible to the active company */
router.get('/', requirePermission('add_supplier'), asyncHandler(async (req, res) => {
  const { page, pageSize, search } = paginationQuery.parse(req.query);
  const skip = (page - 1) * pageSize;

  let where = 'sm.`companyId` = ?';
  const params = [req.tenant.companyId];
  if (search) {
    where += ' AND (s.`name` LIKE ? OR s.`email` LIKE ? OR s.`phone` LIKE ? OR s.`gstNumber` LIKE ?)';
    const like = `%${search}%`;
    params.push(like, like, like, like);
  }

  const [rows, totalRow] = await Promise.all([
    q(
      `SELECT DISTINCT s.* FROM \`Supplier\` s
         INNER JOIN \`SupplierMembership\` sm ON sm.\`supplierId\` = s.\`id\`
        WHERE ${where} ORDER BY s.\`createdAt\` DESC LIMIT ? OFFSET ?`,
      [...params, pageSize, skip]
    ),
    qOne(
      `SELECT COUNT(DISTINCT s.\`id\`) AS n FROM \`Supplier\` s
         INNER JOIN \`SupplierMembership\` sm ON sm.\`supplierId\` = s.\`id\`
        WHERE ${where}`,
      params
    ),
  ]);

  const items = await Promise.all(rows.map(withCompanies));
  res.json({ items, total: Number(totalRow?.n ?? 0), page, pageSize });
}));

/* GET /:id */
router.get('/:id', requirePermission('add_supplier'), asyncHandler(async (req, res) => {
  const { id } = idParam.parse(req.params);
  const sm = await isSupplierInTenant(id, req.tenant.companyId);
  if (!sm) throw new AppError('Supplier not found', 404, 'NOT_FOUND');
  const supplier = await qOne('SELECT * FROM `Supplier` WHERE `id` = ?', [id]);
  if (!supplier) throw new AppError('Supplier not found', 404, 'NOT_FOUND');
  res.json(await withCompanies(supplier));
}));

/* POST / — create + assign to companies */
router.post('/', requirePermission('add_supplier'), asyncHandler(async (req, res) => {
  const data = normalizeEmail(createSchema.parse(req.body));
  const { companyIds, ...fields } = data;

  // Must include the active company so the creator can see the new supplier.
  const ids = [...new Set([...companyIds, req.tenant.companyId])];

  const supplier = await txn(async (tx) => {
    const created = await tx.insert('Supplier', {
      ...fields,
      // companyId column is legacy — set to the active tenant for backfill
      // safety, but the application no longer reads it.
      companyId:    req.tenant.companyId,
      createdById:  req.auth.userId,
    });
    for (const cid of ids) {
      await tx.insert('SupplierMembership', { supplierId: created.id, companyId: cid });
    }
    return created;
  });

  res.status(201).json(await withCompanies(supplier));
}));

/* PATCH /:id */
router.patch('/:id', requirePermission('add_supplier'), asyncHandler(async (req, res) => {
  const { id } = idParam.parse(req.params);
  const sm = await isSupplierInTenant(id, req.tenant.companyId);
  if (!sm) throw new AppError('Supplier not found', 404, 'NOT_FOUND');

  const data = normalizeEmail(updateSchema.parse(req.body));
  const { companyIds, ...fields } = data;

  const supplier = await txn(async (tx) => {
    if (companyIds !== undefined) {
      // Always include the active tenant in the new list so the user can't
      // accidentally lock themselves out of the supplier they just edited.
      const ids = [...new Set([...companyIds, req.tenant.companyId])];
      await tx.q('DELETE FROM `SupplierMembership` WHERE `supplierId` = ?', [id]);
      for (const cid of ids) {
        await tx.insert('SupplierMembership', { supplierId: id, companyId: cid });
      }
    }
    if (Object.keys(fields).length) await tx.update('Supplier', id, fields);
    return tx.qOne('SELECT * FROM `Supplier` WHERE `id` = ?', [id]);
  });

  res.json(await withCompanies(supplier));
}));

/* DELETE /:id — removes the supplier and all its memberships */
router.delete('/:id', requirePermission('add_supplier'), asyncHandler(async (req, res) => {
  const { id } = idParam.parse(req.params);
  const sm = await isSupplierInTenant(id, req.tenant.companyId);
  if (!sm) throw new AppError('Supplier not found', 404, 'NOT_FOUND');
  await txn(async (tx) => {
    await tx.q('DELETE FROM `SupplierMembership` WHERE `supplierId` = ?', [id]);
    await tx.q('DELETE FROM `Supplier` WHERE `id` = ?', [id]);
  });
  res.status(204).end();
}));

export default router;
