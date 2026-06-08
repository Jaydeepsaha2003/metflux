// Purchase Order entry, listing, and detail. Ported from .NET New_PO_Order.
// Header (PoOrder) + many lines (PoOrderItem) saved in one transaction.
import { Router } from 'express';
import { z } from 'zod';
import { q, qOne, insert, update, txn, del, newId } from '../lib/db.js';
import { AppError, asyncHandler } from '../lib/errors.js';
import { requireAuth, requirePermission } from '../lib/auth.js';
import { resolveTenant } from '../lib/tenant.js';

const router = Router();
router.use(requireAuth, resolveTenant);

const itemSchema = z.object({
  coreType: z.enum(['TOROIDAL', 'RECTANGULAR']),
  grade: z.string().trim().min(1).max(80),
  material: z.string().trim().min(1).max(120),
  measure: z.string().trim().min(1).max(160),
  description: z.string().trim().max(500).optional().nullable(),
  id1: z.coerce.number().nonnegative(),
  id2: z.coerce.number().nonnegative().optional().nullable(),
  od1: z.coerce.number().nonnegative(),
  od2: z.coerce.number().nonnegative().optional().nullable(),
  ht: z.coerce.number().nonnegative(),
  builtup: z.coerce.number().nonnegative().optional().nullable(),
  weightPerPc: z.coerce.number().nonnegative(),
  pcs: z.coerce.number().int().positive(),
  totalWeight: z.coerce.number().nonnegative(),
  coreAc: z.coerce.number().nonnegative().optional().nullable(),
  coreMl: z.coerce.number().nonnegative().optional().nullable(),
  d13: z.coerce.number().nonnegative().optional().nullable(),
  turns:       z.coerce.number().int().positive().optional().nullable(),
  flux:        z.coerce.number().positive().optional().nullable(),
  ateCm:       z.coerce.number().nonnegative().optional().nullable(),
  testVoltage: z.coerce.number().nonnegative().optional().nullable(),
  testCurrent: z.coerce.number().nonnegative().optional().nullable(),
  rateBasis: z.enum(['PER_KG', 'PER_PCS']).optional().nullable(),
  rateValue: z.coerce.number().nonnegative().optional().nullable(),
});

const deriveRate = ({ rateBasis, rateValue, weightPerPc, pcs, totalWeight }) => {
  if (!rateBasis || rateValue == null || rateValue <= 0) {
    return { ratePerKg: null, ratePerPc: null, totalAmount: null };
  }
  if (rateBasis === 'PER_KG') {
    return {
      ratePerKg:   rateValue,
      ratePerPc:   weightPerPc > 0 ? +(rateValue * weightPerPc).toFixed(4) : null,
      totalAmount: +(rateValue * (totalWeight ?? 0)).toFixed(2),
    };
  }
  return {
    ratePerPc:   rateValue,
    ratePerKg:   weightPerPc > 0 ? +(rateValue / weightPerPc).toFixed(4) : null,
    totalAmount: +(rateValue * (pcs ?? 0)).toFixed(2),
  };
};

const createSchema = z.object({
  poNumber: z.string().trim().min(1).max(60),
  customerId: z.string().min(1),
  orderDate: z.coerce.date(),
  deliveryDays: z.coerce.number().int().min(0).default(0),
  deliveryDate: z.coerce.date(),
  notes: z.string().max(2000).optional().nullable(),
  items: z.array(itemSchema).min(1, 'Add at least one item before submitting'),
});

// Loads items for a list of poOrderIds keyed by poOrderId.
const loadItemsForPos = async (poOrderIds) => {
  if (poOrderIds.length === 0) return new Map();
  const placeholders = poOrderIds.map(() => '?').join(',');
  const rows = await q(
    `SELECT * FROM \`PoOrderItem\` WHERE \`poOrderId\` IN (${placeholders}) ORDER BY \`createdAt\` ASC`,
    poOrderIds
  );
  const byPo = new Map();
  for (const it of rows) {
    if (!byPo.has(it.poOrderId)) byPo.set(it.poOrderId, []);
    byPo.get(it.poOrderId).push(it);
  }
  return byPo;
};

/* ---------- POST /api/po-orders — create ---------- */
router.post('/', requirePermission('add_po'), asyncHandler(async (req, res) => {
  const data = createSchema.parse(req.body);

  const customer = await qOne(
    'SELECT * FROM `Customer` WHERE `id` = ? AND `companyId` = ?',
    [data.customerId, req.tenant.companyId]
  );
  if (!customer) throw new AppError('Customer not found', 400, 'BAD_CUSTOMER');

  const dup = await qOne(
    'SELECT `id` FROM `PoOrder` WHERE `companyId` = ? AND `poNumber` = ?',
    [req.tenant.companyId, data.poNumber]
  );
  if (dup) throw new AppError('PO number already exists in this company', 409, 'PO_DUPLICATE');

  const result = await txn(async (tx) => {
    const po = await tx.insert('PoOrder', {
      poNumber: data.poNumber,
      orderDate: data.orderDate,
      deliveryDays: data.deliveryDays,
      deliveryDate: data.deliveryDate,
      notes: data.notes ?? null,
      companyId: req.tenant.companyId,
      customerId: customer.id,
      createdById: req.auth.userId,
    });
    const items = [];
    for (const it of data.items) {
      const derived = deriveRate(it);
      const inserted = await tx.insert('PoOrderItem', {
        poOrderId: po.id,
        coreType: it.coreType,
        grade: it.grade,
        material: it.material,
        measure: it.measure,
        description: it.description ?? null,
        id1: it.id1, id2: it.id2 ?? null,
        od1: it.od1, od2: it.od2 ?? null,
        ht: it.ht, builtup: it.builtup ?? null,
        weightPerPc: it.weightPerPc, pcs: it.pcs, totalWeight: it.totalWeight,
        coreAc: it.coreAc ?? null, coreMl: it.coreMl ?? null, d13: it.d13 ?? null,
        turns:       it.turns       ?? null,
        flux:        it.flux        ?? null,
        ateCm:       it.ateCm       ?? null,
        testVoltage: it.testVoltage ?? null,
        testCurrent: it.testCurrent ?? null,
        rateBasis:   it.rateBasis   ?? null,
        rateValue:   it.rateValue   ?? null,
        ratePerKg:   derived.ratePerKg,
        ratePerPc:   derived.ratePerPc,
        totalAmount: derived.totalAmount,
      });
      items.push(inserted);
    }
    return { ...po, items, customer };
  });

  res.status(201).json(result);
}));

/* ---------- GET /api/po-orders — list ---------- */
router.get('/', requirePermission('view_po'), asyncHandler(async (req, res) => {
  const { page, pageSize, search } = z.object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
    search: z.string().trim().max(120).optional(),
  }).parse(req.query);
  const skip = (page - 1) * pageSize;

  let baseWhere = 'p.`companyId` = ?';
  const params = [req.tenant.companyId];

  if (search) {
    const like = `%${search}%`;
    // EXISTS handles "any item matches" without duplicating PO rows.
    baseWhere += ` AND (
      p.\`poNumber\` LIKE ?
      OR c.\`name\` LIKE ?
      OR EXISTS (SELECT 1 FROM \`PoOrderItem\` it WHERE it.\`poOrderId\` = p.\`id\`
                  AND (it.\`measure\` LIKE ? OR it.\`grade\` LIKE ? OR it.\`material\` LIKE ?))
    )`;
    params.push(like, like, like, like, like);
  }

  const listSql = `
    SELECT p.*, c.\`id\` AS c_id, c.\`name\` AS c_name,
           (SELECT COUNT(*) FROM \`PoOrderItem\` ii WHERE ii.\`poOrderId\` = p.\`id\`) AS itemCount
      FROM \`PoOrder\` p
      INNER JOIN \`Customer\` c ON c.\`id\` = p.\`customerId\`
      WHERE ${baseWhere}
      ORDER BY p.\`createdAt\` DESC
      LIMIT ? OFFSET ?`;
  const countSql = `
    SELECT COUNT(*) AS n
      FROM \`PoOrder\` p
      INNER JOIN \`Customer\` c ON c.\`id\` = p.\`customerId\`
      WHERE ${baseWhere}`;

  const [rows, totalRow] = await Promise.all([
    q(listSql, [...params, pageSize, skip]),
    qOne(countSql, params),
  ]);

  const items = rows.map((r) => ({
    id: r.id,
    poNumber: r.poNumber,
    orderDate: r.orderDate,
    deliveryDate: r.deliveryDate,
    deliveryDays: r.deliveryDays,
    notes: r.notes,
    companyId: r.companyId,
    customerId: r.customerId,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    customer: { id: r.c_id, name: r.c_name },
    _count: { items: Number(r.itemCount ?? 0) },
  }));

  res.json({ items, total: Number(totalRow?.n ?? 0), page, pageSize });
}));

const flattenItem = (it) => {
  const pcsProduced   = Number(it.pcsProduced   ?? 0);
  const pcsDispatched = Number(it.pcsDispatched ?? 0);
  return {
    id: it.id,
    poOrderId: it.poOrderId,
    poNumber: it.poNumber,
    customerId: it.customerId,
    customerName: it.customerName,
    customerCode: it.customerCode,
    orderDate: it.orderDate,
    deliveryDate: it.deliveryDate,
    coreType: it.coreType,
    grade: it.grade,
    material: it.material,
    measure: it.measure,
    description: it.description ?? null,
    id1: it.id1, id2: it.id2,
    od1: it.od1, od2: it.od2,
    ht: it.ht, builtup: it.builtup,
    weightPerPc: it.weightPerPc,
    pcs: it.pcs,
    totalWeight: it.totalWeight,
    coreAc: it.coreAc, coreMl: it.coreMl, d13: it.d13,
    rateBasis:   it.rateBasis   ?? null,
    rateValue:   it.rateValue   ?? null,
    ratePerKg:   it.ratePerKg   ?? null,
    ratePerPc:   it.ratePerPc   ?? null,
    totalAmount: it.totalAmount ?? null,
    // Flux-test calibration (toroidal + rectangular). The Edit page needs
    // these to pre-fill the flux/turns inputs.
    turns:       it.turns       ?? null,
    flux:        it.flux        ?? null,
    ateCm:       it.ateCm       ?? null,
    testVoltage: it.testVoltage ?? null,
    testCurrent: it.testCurrent ?? null,
    pcsProduced,
    pcsDispatched,
    status: it.status,
    createdAt: it.createdAt,
  };
};

// SQL that returns each PoOrderItem row joined with its parent + customer
// plus pcsProduced / pcsDispatched aggregated via correlated subqueries.
const itemRowSql = `
  SELECT it.*,
         po.\`poNumber\`     AS poNumber,
         po.\`orderDate\`    AS orderDate,
         po.\`deliveryDate\` AS deliveryDate,
         po.\`customerId\`   AS customerId,
         c.\`name\`          AS customerName,
         c.\`customerCode\`  AS customerCode,
         (SELECT COALESCE(SUM(p.\`pcs\`),0) FROM \`Production\` p WHERE p.\`poOrderItemId\` = it.\`id\`) AS pcsProduced,
         (SELECT COALESCE(SUM(d.\`pcs\`),0) FROM \`Dispatch\`   d WHERE d.\`poOrderItemId\` = it.\`id\`) AS pcsDispatched
    FROM \`PoOrderItem\` it
    INNER JOIN \`PoOrder\`  po ON po.\`id\` = it.\`poOrderId\`
    INNER JOIN \`Customer\` c  ON c.\`id\`  = po.\`customerId\``;

/* GET /api/po-orders/items — paginated flat list */
router.get('/items', requirePermission('view_po'), asyncHandler(async (req, res) => {
  const { page, pageSize, search, status, poOrderId } = z.object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(200).default(50),
    search: z.string().trim().max(120).optional(),
    status: z.enum(['ACTIVE', 'CANCELLED', 'ALL']).default('ACTIVE'),
    poOrderId: z.string().trim().optional(),
  }).parse(req.query);
  const skip = (page - 1) * pageSize;

  let where = 'po.`companyId` = ?';
  const params = [req.tenant.companyId];
  if (status !== 'ALL') { where += ' AND it.`status` = ?'; params.push(status); }
  if (poOrderId)        { where += ' AND it.`poOrderId` = ?'; params.push(poOrderId); }
  if (search) {
    const like = `%${search}%`;
    where += ' AND (po.`poNumber` LIKE ? OR c.`name` LIKE ? OR it.`grade` LIKE ? OR it.`material` LIKE ? OR it.`measure` LIKE ?)';
    params.push(like, like, like, like, like);
  }

  const [rows, totalRow] = await Promise.all([
    q(
      `${itemRowSql} WHERE ${where} ORDER BY it.\`createdAt\` DESC LIMIT ? OFFSET ?`,
      [...params, pageSize, skip]
    ),
    qOne(
      `SELECT COUNT(*) AS n FROM \`PoOrderItem\` it
        INNER JOIN \`PoOrder\` po ON po.\`id\` = it.\`poOrderId\`
        INNER JOIN \`Customer\` c ON c.\`id\` = po.\`customerId\`
        WHERE ${where}`,
      params
    ),
  ]);

  res.json({ items: rows.map(flattenItem), total: Number(totalRow?.n ?? 0), page, pageSize });
}));

/* GET /api/po-orders/items/:id */
router.get('/items/:id', requirePermission('view_po'), asyncHandler(async (req, res) => {
  const row = await qOne(
    `${itemRowSql} WHERE it.\`id\` = ? AND po.\`companyId\` = ?`,
    [req.params.id, req.tenant.companyId]
  );
  if (!row) throw new AppError('Item not found', 404, 'NOT_FOUND');
  res.json(flattenItem(row));
}));

const itemUpdateSchema = itemSchema.partial();

/* PATCH /api/po-orders/items/:id */
router.patch('/items/:id', requirePermission('add_po'), asyncHandler(async (req, res) => {
  const data = itemUpdateSchema.parse(req.body);
  const row = await qOne(
    `${itemRowSql} WHERE it.\`id\` = ? AND po.\`companyId\` = ?`,
    [req.params.id, req.tenant.companyId]
  );
  if (!row) throw new AppError('Item not found', 404, 'NOT_FOUND');
  if (row.status === 'CANCELLED') throw new AppError('Cannot edit a cancelled item', 400, 'ITEM_CANCELLED');

  // Once any production has been recorded against this item, the item is
  // locked — anything you change here would invalidate the produced/dispatched
  // tallies and downstream paperwork. Use Cancel to shrink the remaining qty.
  const producedSoFar = Number(row.pcsProduced ?? 0);
  if (producedSoFar > 0) {
    throw new AppError(
      `Cannot edit this item — production has already started (${producedSoFar} pcs produced). ` +
      `Use Cancel to reduce the remaining quantity instead.`,
      400, 'PRODUCTION_STARTED'
    );
  }

  if (data.pcs !== undefined) {
    const minPcs = Math.max(Number(row.pcsProduced ?? 0), Number(row.pcsDispatched ?? 0));
    if (data.pcs < minPcs) {
      throw new AppError(
        `New pcs (${data.pcs}) is below already produced/dispatched (${minPcs}). Reduce production or dispatch first.`,
        400, 'PCS_BELOW_PROCESSED'
      );
    }
  }

  const rateInputsTouched =
    data.rateBasis !== undefined || data.rateValue !== undefined ||
    data.weightPerPc !== undefined || data.pcs !== undefined ||
    data.totalWeight !== undefined;

  const patch = { ...data };
  if (rateInputsTouched) {
    const derived = deriveRate({
      rateBasis:   data.rateBasis   !== undefined ? data.rateBasis   : row.rateBasis,
      rateValue:   data.rateValue   !== undefined ? data.rateValue   : row.rateValue,
      weightPerPc: data.weightPerPc !== undefined ? data.weightPerPc : row.weightPerPc,
      pcs:         data.pcs         !== undefined ? data.pcs         : row.pcs,
      totalWeight: data.totalWeight !== undefined ? data.totalWeight : row.totalWeight,
    });
    patch.ratePerKg   = derived.ratePerKg;
    patch.ratePerPc   = derived.ratePerPc;
    patch.totalAmount = derived.totalAmount;
  }

  const updated = await update('PoOrderItem', row.id, patch);
  res.json(updated);
}));

/* POST /api/po-orders/items/:id/cancel */
router.post('/items/:id/cancel', requirePermission('add_po'), asyncHandler(async (req, res) => {
  const row = await qOne(
    `${itemRowSql} WHERE it.\`id\` = ? AND po.\`companyId\` = ?`,
    [req.params.id, req.tenant.companyId]
  );
  if (!row) throw new AppError('Item not found', 404, 'NOT_FOUND');
  if (row.status === 'CANCELLED') return res.status(204).end();

  const produced = Number(row.pcsProduced ?? 0);
  const dispatched = Number(row.pcsDispatched ?? 0);
  const processed = Math.max(produced, dispatched);
  const remaining = row.pcs - processed;

  if (remaining <= 0) {
    throw new AppError(
      `Nothing remaining to cancel — ${processed} pcs already produced/dispatched out of ${row.pcs}.`,
      400, 'NOTHING_TO_CANCEL'
    );
  }

  if (processed === 0) {
    await update('PoOrderItem', row.id, { status: 'CANCELLED' });
  } else {
    const newTotalWeight = +(processed * row.weightPerPc).toFixed(3);
    const derived = deriveRate({
      rateBasis: row.rateBasis,
      rateValue: row.rateValue,
      weightPerPc: row.weightPerPc,
      pcs: processed,
      totalWeight: newTotalWeight,
    });
    await update('PoOrderItem', row.id, {
      pcs: processed,
      totalWeight: newTotalWeight,
      ratePerKg: derived.ratePerKg,
      ratePerPc: derived.ratePerPc,
      totalAmount: derived.totalAmount,
    });
  }
  res.status(204).end();
}));

/* GET /api/po-orders/summary */
router.get('/summary', requirePermission('po_summary'), asyncHandler(async (req, res) => {
  const { page, pageSize, search, status } = z.object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(200).default(50),
    search: z.string().trim().max(120).optional(),
    status: z.enum(['ACTIVE', 'CANCELLED', 'ALL']).default('ACTIVE'),
  }).parse(req.query);
  const skip = (page - 1) * pageSize;

  let where = 'po.`companyId` = ?';
  const params = [req.tenant.companyId];
  if (status !== 'ALL') { where += ' AND it.`status` = ?'; params.push(status); }
  if (search) {
    const like = `%${search}%`;
    where += ' AND (po.`poNumber` LIKE ? OR c.`name` LIKE ? OR it.`grade` LIKE ? OR it.`material` LIKE ? OR it.`measure` LIKE ?)';
    params.push(like, like, like, like, like);
  }

  const [rows, totalRow] = await Promise.all([
    q(
      `${itemRowSql} WHERE ${where} ORDER BY po.\`orderDate\` DESC, it.\`createdAt\` DESC LIMIT ? OFFSET ?`,
      [...params, pageSize, skip]
    ),
    qOne(
      `SELECT COUNT(*) AS n FROM \`PoOrderItem\` it
        INNER JOIN \`PoOrder\` po ON po.\`id\` = it.\`poOrderId\`
        INNER JOIN \`Customer\` c ON c.\`id\` = po.\`customerId\`
        WHERE ${where}`,
      params
    ),
  ]);

  const enriched = rows.map((it) => ({
    id:            it.id,
    poOrderId:     it.poOrderId,
    poNumber:      it.poNumber,
    orderDate:     it.orderDate,
    deliveryDate:  it.deliveryDate,
    customerName:  it.customerName,
    customerCode:  it.customerCode,
    coreType:      it.coreType,
    grade:         it.grade,
    material:      it.material,
    measure:       it.measure,
    description:   it.description ?? null,
    pcsOrdered:    it.pcs,
    pcsProduced:   Number(it.pcsProduced ?? 0),
    pcsDispatched: Number(it.pcsDispatched ?? 0),
    pcsPending:    Math.max(it.pcs - Number(it.pcsProduced ?? 0), 0),
    weightPerPc:   it.weightPerPc,
    totalWeight:   it.totalWeight,
    turns:         it.turns       ?? null,
    flux:          it.flux        ?? null,
    ateCm:         it.ateCm       ?? null,
    testVoltage:   it.testVoltage ?? null,
    testCurrent:   it.testCurrent ?? null,
    rateBasis:     it.rateBasis   ?? null,
    rateValue:     it.rateValue   ?? null,
    ratePerKg:     it.ratePerKg   ?? null,
    ratePerPc:     it.ratePerPc   ?? null,
    totalAmount:   it.totalAmount ?? null,
    status:        it.status,
  }));

  // Aggregate totals for the full filtered dataset (not just the current page).
  const aggRow = await qOne(
    `SELECT
       COALESCE(SUM(it.\`pcs\`), 0) AS totalOrdered,
       COALESCE(SUM(
         (SELECT COALESCE(SUM(pp.\`pcs\`),0) FROM \`Production\` pp WHERE pp.\`poOrderItemId\` = it.\`id\`)
       ), 0) AS totalProduced,
       COALESCE(SUM(
         (SELECT COALESCE(SUM(dd.\`pcs\`),0) FROM \`Dispatch\` dd WHERE dd.\`poOrderItemId\` = it.\`id\`)
       ), 0) AS totalDispatched
     FROM \`PoOrderItem\` it
       INNER JOIN \`PoOrder\` po ON po.\`id\` = it.\`poOrderId\`
       INNER JOIN \`Customer\` c ON c.\`id\` = po.\`customerId\`
     WHERE ${where}`,
    params
  );
  const aggregates = {
    pcsOrdered:    Number(aggRow?.totalOrdered    ?? 0),
    pcsProduced:   Number(aggRow?.totalProduced   ?? 0),
    pcsDispatched: Number(aggRow?.totalDispatched ?? 0),
    pcsPending:    Math.max(Number(aggRow?.totalOrdered ?? 0) - Number(aggRow?.totalProduced ?? 0), 0),
  };

  res.json({ items: enriched, total: Number(totalRow?.n ?? 0), page, pageSize, aggregates });
}));

/* GET /api/po-orders/:id */
router.get('/:id', requirePermission('view_po'), asyncHandler(async (req, res) => {
  const po = await qOne(
    'SELECT * FROM `PoOrder` WHERE `id` = ? AND `companyId` = ?',
    [req.params.id, req.tenant.companyId]
  );
  if (!po) throw new AppError('PO not found', 404, 'NOT_FOUND');
  const customer = await qOne('SELECT * FROM `Customer` WHERE `id` = ?', [po.customerId]);
  const itemsByPo = await loadItemsForPos([po.id]);
  res.json({ ...po, customer, items: itemsByPo.get(po.id) ?? [] });
}));

/* PATCH /api/po-orders/:id — edit the SO header (poNumber, customer, dates,
   notes). Locked the moment any production has been recorded on any line —
   editing identifiers after production would break downstream paperwork. */
const headerUpdateSchema = z.object({
  poNumber:     z.string().trim().min(1).max(60).optional(),
  customerId:   z.string().min(1).optional(),
  orderDate:    z.coerce.date().optional(),
  deliveryDate: z.coerce.date().optional(),
  deliveryDays: z.coerce.number().int().min(0).optional(),
  notes:        z.string().max(2000).optional().nullable(),
});

router.patch('/:id', requirePermission('add_po'), asyncHandler(async (req, res) => {
  const data = headerUpdateSchema.parse(req.body);

  const po = await qOne(
    'SELECT * FROM `PoOrder` WHERE `id` = ? AND `companyId` = ?',
    [req.params.id, req.tenant.companyId]
  );
  if (!po) throw new AppError('SO not found', 404, 'NOT_FOUND');

  // Block edits once ANY line item has any production logged against it —
  // changing identifiers / dates after production has started would break
  // downstream packing-list / dispatch / invoice references.
  const producedRow = await qOne(
    `SELECT COALESCE(SUM(p.\`pcs\`), 0) AS n
       FROM \`Production\` p
       INNER JOIN \`PoOrderItem\` it ON it.\`id\` = p.\`poOrderItemId\`
       WHERE it.\`poOrderId\` = ?`,
    [po.id]
  );
  if (Number(producedRow?.n ?? 0) > 0) {
    throw new AppError(
      `Cannot edit this SO header — production has already started on one or more lines. ` +
      `Use Cancel on a specific item to shrink remaining qty instead.`,
      400, 'PRODUCTION_STARTED'
    );
  }

  // If customer is being changed, verify the new one belongs to this tenant.
  if (data.customerId && data.customerId !== po.customerId) {
    const c = await qOne(
      'SELECT `id` FROM `Customer` WHERE `id` = ? AND `companyId` = ?',
      [data.customerId, req.tenant.companyId]
    );
    if (!c) throw new AppError('Customer not found', 400, 'BAD_CUSTOMER');
  }

  // If SO# is being changed, enforce per-company uniqueness.
  if (data.poNumber && data.poNumber !== po.poNumber) {
    const dup = await qOne(
      'SELECT `id` FROM `PoOrder` WHERE `companyId` = ? AND `poNumber` = ? AND `id` <> ?',
      [req.tenant.companyId, data.poNumber, po.id]
    );
    if (dup) throw new AppError('SO# already exists in this company', 409, 'PO_DUPLICATE');
  }

  const patch = {};
  if (data.poNumber     !== undefined) patch.poNumber     = data.poNumber;
  if (data.customerId   !== undefined) patch.customerId   = data.customerId;
  if (data.orderDate    !== undefined) patch.orderDate    = data.orderDate;
  if (data.deliveryDate !== undefined) patch.deliveryDate = data.deliveryDate;
  if (data.deliveryDays !== undefined) patch.deliveryDays = data.deliveryDays;
  if (data.notes        !== undefined) patch.notes        = data.notes ?? null;

  if (Object.keys(patch).length > 0) await update('PoOrder', po.id, patch);
  const fresh = await qOne('SELECT * FROM `PoOrder` WHERE `id` = ?', [po.id]);
  const customer = await qOne('SELECT * FROM `Customer` WHERE `id` = ?', [fresh.customerId]);
  res.json({ ...fresh, customer });
}));

/* POST /api/po-orders/:poId/items — add a new item to an existing PO */
router.post('/:poId/items', requirePermission('add_po'), asyncHandler(async (req, res) => {
  const data = itemSchema.parse(req.body);

  const po = await qOne(
    'SELECT * FROM `PoOrder` WHERE `id` = ? AND `companyId` = ?',
    [req.params.poId, req.tenant.companyId]
  );
  if (!po) throw new AppError('PO not found', 404, 'NOT_FOUND');

  const derived = deriveRate(data);
  const inserted = await insert('PoOrderItem', {
    poOrderId:   po.id,
    coreType:    data.coreType,
    grade:       data.grade,
    material:    data.material,
    measure:     data.measure,
    description: data.description ?? null,
    id1: data.id1, id2: data.id2 ?? null,
    od1: data.od1, od2: data.od2 ?? null,
    ht: data.ht,   builtup: data.builtup ?? null,
    weightPerPc: data.weightPerPc, pcs: data.pcs, totalWeight: data.totalWeight,
    coreAc: data.coreAc ?? null, coreMl: data.coreMl ?? null, d13: data.d13 ?? null,
    turns:       data.turns       ?? null,
    flux:        data.flux        ?? null,
    ateCm:       data.ateCm       ?? null,
    testVoltage: data.testVoltage ?? null,
    testCurrent: data.testCurrent ?? null,
    rateBasis:   data.rateBasis   ?? null,
    rateValue:   data.rateValue   ?? null,
    ratePerKg:   derived.ratePerKg,
    ratePerPc:   derived.ratePerPc,
    totalAmount: derived.totalAmount,
  });
  res.status(201).json(inserted);
}));

/* DELETE /api/po-orders/items/:id — permanently delete (no production/dispatch) */
router.delete('/items/:id', requirePermission('add_po'), asyncHandler(async (req, res) => {
  const row = await qOne(
    `${itemRowSql} WHERE it.\`id\` = ? AND po.\`companyId\` = ?`,
    [req.params.id, req.tenant.companyId]
  );
  if (!row) throw new AppError('Item not found', 404, 'NOT_FOUND');

  const produced   = Number(row.pcsProduced ?? 0);
  const dispatched = Number(row.pcsDispatched ?? 0);
  if (produced > 0 || dispatched > 0) {
    throw new AppError(
      `Cannot delete — ${produced} pcs produced and ${dispatched} pcs dispatched are already recorded.`,
      400, 'HAS_PRODUCTION'
    );
  }

  await q('DELETE FROM `PoOrderItem` WHERE `id` = ?', [row.id]);
  res.status(204).end();
}));

/* POST /api/po-orders/items/:id/restore — restore a cancelled item */
router.post('/items/:id/restore', requirePermission('add_po'), asyncHandler(async (req, res) => {
  const row = await qOne(
    `${itemRowSql} WHERE it.\`id\` = ? AND po.\`companyId\` = ?`,
    [req.params.id, req.tenant.companyId]
  );
  if (!row) throw new AppError('Item not found', 404, 'NOT_FOUND');
  if (row.status === 'ACTIVE') return res.json({ message: 'Already active' });

  await update('PoOrderItem', row.id, { status: 'ACTIVE' });
  res.json({ message: 'Restored' });
}));

/* DELETE /api/po-orders/:id — permanently delete an entire PO */
router.delete('/:id', requirePermission('add_po'), asyncHandler(async (req, res) => {
  const po = await qOne(
    'SELECT * FROM `PoOrder` WHERE `id` = ? AND `companyId` = ?',
    [req.params.id, req.tenant.companyId]
  );
  if (!po) throw new AppError('PO not found', 404, 'NOT_FOUND');

  // Block if any item has production or dispatch records.
  const processedRow = await qOne(
    `SELECT COUNT(*) AS n FROM \`PoOrderItem\` it
      WHERE it.\`poOrderId\` = ?
        AND (
          EXISTS (SELECT 1 FROM \`Production\` p WHERE p.\`poOrderItemId\` = it.\`id\`)
          OR EXISTS (SELECT 1 FROM \`Dispatch\`   d WHERE d.\`poOrderItemId\` = it.\`id\`)
        )`,
    [po.id]
  );
  if (Number(processedRow?.n ?? 0) > 0) {
    throw new AppError(
      'Cannot delete this PO — one or more items have production or dispatch records.',
      400, 'HAS_PRODUCTION'
    );
  }

  await txn(async (tx) => {
    await tx.q('DELETE FROM `PoOrderItem` WHERE `poOrderId` = ?', [po.id]);
    await tx.q('DELETE FROM `PoOrder` WHERE `id` = ?', [po.id]);
  });
  res.status(204).end();
}));

export default router;
