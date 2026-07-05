// Customer returns — track items coming back for rework, then re-dispatched.
import { Router } from 'express';
import { z } from 'zod';
import { q, qOne, insert, update, del, txn } from '../lib/db.js';
import { AppError, asyncHandler } from '../lib/errors.js';
import { requireAuth, requireAnyPermission } from '../lib/auth.js';
import { resolveTenant } from '../lib/tenant.js';
import { logAudit, snapshotEntity } from '../lib/audit.js';

const router = Router();
router.use(requireAuth, resolveTenant);

const itemSchema = z.object({
  poOrderItemId: z.string().min(1),
  pcs:           z.coerce.number().int().positive(),
  reason:        z.string().trim().max(300).optional().nullable(),
});

const createSchema = z.object({
  returnNumber:   z.string().trim().min(1).max(60),
  returnDate:     z.coerce.date(),
  referenceType:  z.enum(['SO_NUMBER', 'INVOICE_NUMBER', 'WO_NUMBER']),
  referenceValue: z.string().trim().min(1).max(80),
  customerId:     z.string().min(1),
  reason:         z.string().trim().max(400).optional().nullable(),
  notes:          z.string().trim().max(2000).optional().nullable(),
  items:          z.array(itemSchema).min(1, 'Add at least one returned item'),
});

const updateSchema = z.object({
  returnNumber:   z.string().trim().min(1).max(60).optional(),
  returnDate:     z.coerce.date().optional(),
  referenceType:  z.enum(['SO_NUMBER', 'INVOICE_NUMBER', 'WO_NUMBER']).optional(),
  referenceValue: z.string().trim().min(1).max(80).optional(),
  reason:         z.string().trim().max(400).optional().nullable(),
  notes:          z.string().trim().max(2000).optional().nullable(),
});

const flattenItem = (it) => ({
  id:             it.id,
  poOrderItemId:  it.poOrderItemId,
  pcs:            it.pcs,
  reason:         it.reason,
  poNumber:       it.po_number ?? null,
  coreType:       it.item_coreType ?? null,
  grade:          it.item_grade ?? null,
  material:       it.item_material ?? null,
  measure:        it.item_measure ?? null,
  weightPerPc:    it.item_weightPerPc ?? null,
});

const loadItemsForReturns = async (returnIds) => {
  if (returnIds.length === 0) return new Map();
  const placeholders = returnIds.map(() => '?').join(',');
  const rows = await q(
    `SELECT ri.*,
            it.\`coreType\`    AS item_coreType,
            it.\`grade\`       AS item_grade,
            it.\`material\`    AS item_material,
            it.\`measure\`     AS item_measure,
            it.\`weightPerPc\` AS item_weightPerPc,
            po.\`poNumber\`    AS po_number
       FROM \`ReturnItem\` ri
       INNER JOIN \`PoOrderItem\` it ON it.\`id\` = ri.\`poOrderItemId\`
       INNER JOIN \`PoOrder\`     po ON po.\`id\` = it.\`poOrderId\`
       WHERE ri.\`returnId\` IN (${placeholders})`,
    returnIds
  );
  const by = new Map();
  for (const r of rows) {
    if (!by.has(r.returnId)) by.set(r.returnId, []);
    by.get(r.returnId).push(r);
  }
  return by;
};

const flattenReturn = (r, itemRows = []) => ({
  id:               r.id,
  returnNumber:     r.returnNumber,
  returnDate:       r.returnDate,
  referenceType:    r.referenceType,
  referenceValue:   r.referenceValue,
  status:           r.status,
  receivedAt:       r.receivedAt,
  reworkAt:         r.reworkAt,
  redispatchAt:     r.redispatchAt,
  redispatchVehicle: r.redispatchVehicle,
  closedAt:         r.closedAt,
  reason:           r.reason,
  notes:            r.notes,
  createdAt:        r.createdAt,
  updatedAt:        r.updatedAt,
  customerId:       r.customerId,
  customerName:     r.customer_name ?? null,
  itemCount:        itemRows.length,
  totalPcs:         itemRows.reduce((s, i) => s + (i.pcs ?? 0), 0),
  items:            itemRows.map(flattenItem),
});

/* GET / — paginated */
router.get('/', requireAnyPermission('manage_returns', 'dispatch'), asyncHandler(async (req, res) => {
  const { page, pageSize, search, status } = z.object({
    page:     z.coerce.number().int().min(1).default(1),
    // Generous cap so the "Excel" button (pulls every filtered row at once)
    // works without paging. Normal browsing uses pageSize=20.
    pageSize: z.coerce.number().int().min(1).max(10000).default(50),
    search:   z.string().trim().max(120).optional(),
    status:   z.enum(['PENDING','RECEIVED','IN_REWORK','REDISPATCHED','CLOSED','CANCELLED','ALL']).default('ALL'),
  }).parse(req.query);
  const skip = (page - 1) * pageSize;

  let where = 'r.`companyId` = ?';
  const params = [req.tenant.companyId];
  if (status !== 'ALL') { where += ' AND r.`status` = ?'; params.push(status); }
  if (search) {
    const like = `%${search}%`;
    where += ` AND (
      r.\`returnNumber\` LIKE ?
      OR r.\`referenceValue\` LIKE ?
      OR c.\`name\` LIKE ?
      OR r.\`reason\` LIKE ?
      OR EXISTS (SELECT 1 FROM \`ReturnItem\` ri
                 INNER JOIN \`PoOrderItem\` it ON it.\`id\` = ri.\`poOrderItemId\`
                 WHERE ri.\`returnId\` = r.\`id\` AND it.\`measure\` LIKE ?)
    )`;
    params.push(like, like, like, like, like);
  }

  const [rows, totalRow] = await Promise.all([
    q(
      `SELECT r.*, c.\`name\` AS customer_name FROM \`Return\` r
         LEFT JOIN \`Customer\` c ON c.\`id\` = r.\`customerId\`
        WHERE ${where} ORDER BY r.\`returnDate\` DESC LIMIT ? OFFSET ?`,
      [...params, pageSize, skip]
    ),
    qOne(
      `SELECT COUNT(*) AS n FROM \`Return\` r
         LEFT JOIN \`Customer\` c ON c.\`id\` = r.\`customerId\`
        WHERE ${where}`,
      params
    ),
  ]);
  const byR = await loadItemsForReturns(rows.map((r) => r.id));
  res.json({
    items: rows.map((r) => flattenReturn(r, byR.get(r.id) ?? [])),
    total: Number(totalRow?.n ?? 0), page, pageSize,
  });
}));

/* GET /:id */
router.get('/:id', requireAnyPermission('manage_returns', 'dispatch'), asyncHandler(async (req, res) => {
  const r = await qOne(
    `SELECT r.*, c.\`name\` AS customer_name FROM \`Return\` r
       LEFT JOIN \`Customer\` c ON c.\`id\` = r.\`customerId\`
       WHERE r.\`id\` = ? AND r.\`companyId\` = ?`,
    [req.params.id, req.tenant.companyId]
  );
  if (!r) throw new AppError('Return not found', 404, 'NOT_FOUND');
  const byR = await loadItemsForReturns([r.id]);
  res.json(flattenReturn(r, byR.get(r.id) ?? []));
}));

/* POST / */
router.post('/', requireAnyPermission('manage_returns', 'dispatch'), asyncHandler(async (req, res) => {
  const data = createSchema.parse(req.body);

  const customer = await qOne(
    'SELECT * FROM `Customer` WHERE `id` = ? AND `companyId` = ?',
    [data.customerId, req.tenant.companyId]
  );
  if (!customer) throw new AppError('Customer not found', 400, 'BAD_CUSTOMER');

  const itemIds = data.items.map((i) => i.poOrderItemId);
  const placeholders = itemIds.map(() => '?').join(',');
  const owned = await q(
    `SELECT it.\`id\` FROM \`PoOrderItem\` it
       INNER JOIN \`PoOrder\` po ON po.\`id\` = it.\`poOrderId\`
       WHERE it.\`id\` IN (${placeholders}) AND po.\`companyId\` = ?`,
    [...itemIds, req.tenant.companyId]
  );
  if (owned.length !== itemIds.length) throw new AppError('One or more PO items not found', 404, 'NOT_FOUND');

  const dup = await qOne(
    'SELECT `id` FROM `Return` WHERE `companyId` = ? AND `returnNumber` = ?',
    [req.tenant.companyId, data.returnNumber]
  );
  if (dup) throw new AppError('Return number already exists in this company', 409, 'RETURN_DUPLICATE');

  const retId = await txn(async (tx) => {
    const ret = await tx.insert('Return', {
      returnNumber:   data.returnNumber,
      returnDate:     data.returnDate,
      referenceType:  data.referenceType,
      referenceValue: data.referenceValue,
      reason:         data.reason ?? null,
      notes:          data.notes  ?? null,
      companyId:      req.tenant.companyId,
      customerId:     customer.id,
      createdById:    req.auth.userId,
    });
    for (const i of data.items) {
      await tx.insert('ReturnItem', {
        returnId:      ret.id,
        poOrderItemId: i.poOrderItemId,
        pcs:           i.pcs,
        reason:        i.reason ?? null,
      });
    }
    return ret.id;
  });

  const fresh = await qOne(
    `SELECT r.*, c.\`name\` AS customer_name FROM \`Return\` r
       LEFT JOIN \`Customer\` c ON c.\`id\` = r.\`customerId\` WHERE r.\`id\` = ?`,
    [retId]
  );
  const byR = await loadItemsForReturns([retId]);
  await logAudit(req, { entity: 'Return', entityId: retId, action: 'CREATE', summary: `Return ${data.returnNumber} · ${customer.name}` });
  res.status(201).json(flattenReturn(fresh, byR.get(retId) ?? []));
}));

/* PATCH /:id */
router.patch('/:id', requireAnyPermission('manage_returns', 'dispatch'), asyncHandler(async (req, res) => {
  const data = updateSchema.parse(req.body);
  const r = await qOne(
    'SELECT * FROM `Return` WHERE `id` = ? AND `companyId` = ?',
    [req.params.id, req.tenant.companyId]
  );
  if (!r) throw new AppError('Return not found', 404, 'NOT_FOUND');

  const before = await snapshotEntity('Return', r.id);
  const patch = {};
  if (data.returnNumber   !== undefined) patch.returnNumber = data.returnNumber;
  if (data.returnDate     !== undefined) patch.returnDate = data.returnDate;
  if (data.referenceType  !== undefined) patch.referenceType = data.referenceType;
  if (data.referenceValue !== undefined) patch.referenceValue = data.referenceValue;
  if (data.reason         !== undefined) patch.reason = data.reason ?? null;
  if (data.notes          !== undefined) patch.notes = data.notes ?? null;
  if (Object.keys(patch).length > 0) {
    await update('Return', r.id, patch);
    await logAudit(req, { entity: 'Return', entityId: r.id, action: 'UPDATE', summary: `Return ${patch.returnNumber ?? r.returnNumber}`, before });
  }

  const fresh = await qOne(
    `SELECT r.*, c.\`name\` AS customer_name FROM \`Return\` r
       LEFT JOIN \`Customer\` c ON c.\`id\` = r.\`customerId\` WHERE r.\`id\` = ?`,
    [r.id]
  );
  const byR = await loadItemsForReturns([r.id]);
  res.json(flattenReturn(fresh, byR.get(r.id) ?? []));
}));

const transitionSchema = z.object({
  to: z.enum(['RECEIVED', 'IN_REWORK', 'REDISPATCHED', 'CLOSED', 'CANCELLED']),
  vehicleNo: z.string().trim().max(80).optional().nullable(),
});

const ALLOWED = {
  PENDING:      new Set(['RECEIVED', 'CANCELLED']),
  RECEIVED:     new Set(['IN_REWORK', 'CANCELLED']),
  IN_REWORK:    new Set(['REDISPATCHED']),
  REDISPATCHED: new Set(['CLOSED']),
  CLOSED:       new Set(),
  CANCELLED:    new Set(),
};

router.post('/:id/transition', requireAnyPermission('manage_returns', 'dispatch'), asyncHandler(async (req, res) => {
  const { to, vehicleNo } = transitionSchema.parse(req.body);
  const r = await qOne(
    'SELECT * FROM `Return` WHERE `id` = ? AND `companyId` = ?',
    [req.params.id, req.tenant.companyId]
  );
  if (!r) throw new AppError('Return not found', 404, 'NOT_FOUND');
  if (!ALLOWED[r.status].has(to)) {
    throw new AppError(`Cannot transition ${r.status} → ${to}`, 400, 'BAD_TRANSITION');
  }

  const now = new Date();
  const stamp = {
    RECEIVED:     { receivedAt: now },
    IN_REWORK:    { reworkAt: now },
    REDISPATCHED: { redispatchAt: now, redispatchVehicle: vehicleNo ?? null },
    CLOSED:       { closedAt: now },
    CANCELLED:    { closedAt: now },
  }[to];
  await update('Return', r.id, { status: to, ...stamp });

  const fresh = await qOne(
    `SELECT r.*, c.\`name\` AS customer_name FROM \`Return\` r
       LEFT JOIN \`Customer\` c ON c.\`id\` = r.\`customerId\` WHERE r.\`id\` = ?`,
    [r.id]
  );
  const byR = await loadItemsForReturns([r.id]);
  res.json(flattenReturn(fresh, byR.get(r.id) ?? []));
}));

/* DELETE /:id */
router.delete('/:id', requireAnyPermission('manage_returns', 'dispatch'), asyncHandler(async (req, res) => {
  const r = await qOne(
    'SELECT `id` FROM `Return` WHERE `id` = ? AND `companyId` = ?',
    [req.params.id, req.tenant.companyId]
  );
  if (!r) throw new AppError('Return not found', 404, 'NOT_FOUND');
  const before = await snapshotEntity('Return', r.id);
  await del('Return', r.id);
  await logAudit(req, { entity: 'Return', entityId: r.id, action: 'DELETE', summary: before?.row ? `Return ${before.row.returnNumber}` : 'Return', before });
  res.status(204).end();
}));

export default router;
