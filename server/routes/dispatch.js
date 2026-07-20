// Dispatch records — track shipments of produced goods to customers.
import { Router } from 'express';
import { z } from 'zod';
import { q, qOne, insert, update, del } from '../lib/db.js';
import { AppError, asyncHandler } from '../lib/errors.js';
import { requireAuth, requirePermission } from '../lib/auth.js';
import { resolveTenant } from '../lib/tenant.js';
import { notifyCompanyAdmins } from '../lib/push.js';
import { logAudit, snapshotEntity } from '../lib/audit.js';

const router = Router();
router.use(requireAuth, resolveTenant);

const createSchema = z.object({
  poOrderItemId: z.string().min(1),
  dispatchDate: z.coerce.date(),
  pcs: z.coerce.number().int().positive(),
  weightPerPc: z.coerce.number().nonnegative(),
  totalWeight: z.coerce.number().nonnegative(),
  actualWeight: z.coerce.number().nonnegative().optional().nullable(),
  vehicleNo: z.string().trim().max(80).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
});

const updateSchema = z.object({
  dispatchDate: z.coerce.date().optional(),
  pcs: z.coerce.number().int().positive().optional(),
  weightPerPc: z.coerce.number().nonnegative().optional(),
  totalWeight: z.coerce.number().nonnegative().optional(),
  actualWeight: z.coerce.number().nonnegative().optional().nullable(),
  vehicleNo: z.string().trim().max(80).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
});

const DISPATCH_ROW_SQL = `
  SELECT d.*,
         it.\`pcs\`         AS item_pcs,
         it.\`coreType\`    AS item_coreType,
         it.\`grade\`       AS item_grade,
         it.\`material\`    AS item_material,
         it.\`measure\`     AS item_measure,
         it.\`id1\`         AS item_id1, it.\`id2\` AS item_id2,
         it.\`od1\`         AS item_od1, it.\`od2\` AS item_od2,
         it.\`ht\`          AS item_ht,
         it.\`rateBasis\`   AS item_rateBasis,
         it.\`rateValue\`   AS item_rateValue,
         it.\`ratePerKg\`   AS item_ratePerKg,
         it.\`ratePerPc\`   AS item_ratePerPc,
         it.\`totalAmount\` AS item_totalAmount,
         it.\`turns\`       AS item_turns,
         it.\`flux\`        AS item_flux,
         it.\`ateCm\`       AS item_ateCm,
         it.\`testVoltage\` AS item_testVoltage,
         it.\`testCurrent\` AS item_testCurrent,
         po.\`id\`          AS po_id,
         po.\`poNumber\`    AS po_number,
         po.\`orderDate\`   AS po_orderDate,
         po.\`customerId\`  AS customer_id,
         c.\`name\`         AS customer_name,
         c.\`customerCode\` AS customer_code,
         c.\`state\`        AS customer_state,
         c.\`phone\`        AS customer_phone,
         w.\`name\`         AS warehouse_name
    FROM \`Dispatch\` d
    INNER JOIN \`PoOrderItem\` it ON it.\`id\` = d.\`poOrderItemId\`
    INNER JOIN \`PoOrder\`     po ON po.\`id\` = it.\`poOrderId\`
    INNER JOIN \`Customer\`    c  ON c.\`id\`  = po.\`customerId\`
    LEFT  JOIN \`Warehouse\`   w  ON w.\`id\`  = d.\`warehouseId\``;

const flatten = (r) => {
  const lineAmount = r.item_totalAmount ?? null;
  const proRataAmount = (lineAmount != null && r.item_pcs > 0)
    ? +(lineAmount * (r.pcs / r.item_pcs)).toFixed(2)
    : null;
  return {
    id: r.id,
    poOrderItemId: r.poOrderItemId,
    poNumber: r.po_number,
    orderDate: r.po_orderDate,
    customerId: r.customer_id,
    customerName: r.customer_name,
    customerCode: r.customer_code,
    customerState: r.customer_state ?? null,
    customerPhone: r.customer_phone ?? null,
    coreType: r.item_coreType,
    grade: r.item_grade,
    material: r.item_material,
    measure: r.item_measure,
    id1: r.item_id1, id2: r.item_id2 ?? null,
    od1: r.item_od1, od2: r.item_od2 ?? null,
    ht: r.item_ht,
    itemPcs: r.item_pcs,
    dispatchDate: r.dispatchDate,
    pcs: r.pcs,
    weightPerPc: r.weightPerPc,
    totalWeight: r.totalWeight,
    actualWeight: r.actualWeight ?? null,
    vehicleNo: r.vehicleNo,
    notes: r.notes,
    createdAt: r.createdAt,
    sourceType:    r.sourceType ?? 'PRODUCTION',
    warehouseName: r.warehouse_name ?? null,
    rateBasis:   r.item_rateBasis ?? null,
    rateValue:   r.item_rateValue ?? null,
    ratePerKg:   r.item_ratePerKg ?? null,
    ratePerPc:   r.item_ratePerPc ?? null,
    lineAmount,
    amount:      proRataAmount,
    turns:       r.item_turns       ?? null,
    flux:        r.item_flux        ?? null,
    ateCm:       r.item_ateCm       ?? null,
    testVoltage: r.item_testVoltage ?? null,
    testCurrent: r.item_testCurrent ?? null,
    poOrderId:   r.po_id ?? null,
  };
};

/* GET /ready — PO items with produced but undispatched pcs */
router.get('/ready', requirePermission('dispatch'), asyncHandler(async (req, res) => {
  const search = z.object({ search: z.string().trim().max(120).optional() }).parse(req.query).search;

  let where = 'po.`companyId` = ? AND it.`status` = ?';
  const params = [req.tenant.companyId, 'ACTIVE'];
  if (search) {
    const like = `%${search}%`;
    where += ' AND (po.`poNumber` LIKE ? OR c.`name` LIKE ? OR it.`grade` LIKE ? OR it.`material` LIKE ? OR it.`measure` LIKE ?)';
    params.push(like, like, like, like, like);
  }

  const rows = await q(
    `SELECT it.*,
            po.\`poNumber\`     AS po_number,
            po.\`deliveryDate\` AS po_deliveryDate,
            c.\`name\`          AS customer_name,
            c.\`customerCode\`  AS customer_code,
            (SELECT COALESCE(SUM(pp.\`pcs\`),0) FROM \`Production\` pp WHERE pp.\`poOrderItemId\` = it.\`id\`) AS produced,
            (SELECT COALESCE(SUM(dd.\`pcs\`),0) FROM \`Dispatch\`   dd WHERE dd.\`poOrderItemId\` = it.\`id\`) AS dispatched,
            (SELECT COALESCE(SUM(sm.\`pcs\`),0) FROM \`StockMovement\` sm WHERE sm.\`poOrderItemId\` = it.\`id\` AND sm.\`direction\` = 'IN') AS stockedIn
       FROM \`PoOrderItem\` it
       INNER JOIN \`PoOrder\`  po ON po.\`id\` = it.\`poOrderId\`
       INNER JOIN \`Customer\` c  ON c.\`id\`  = po.\`customerId\`
       WHERE ${where}
       ORDER BY it.\`createdAt\` DESC`,
    params
  );

  const ready = rows.map((it) => {
    const produced   = Number(it.produced ?? 0);
    const dispatched = Number(it.dispatched ?? 0);
    const stockedIn  = Number(it.stockedIn ?? 0);
    // Goods moved into a store leave the production-floor pool, so they no longer
    // count as ready-to-dispatch here (they're dispatched later via stock-out).
    const readyPcs   = Math.max(produced - dispatched - stockedIn, 0);
    const readyAmount = (it.totalAmount != null && it.pcs > 0)
      ? +(it.totalAmount * (readyPcs / it.pcs)).toFixed(2)
      : null;
    return {
      id: it.id,
      poNumber: it.po_number,
      customerName: it.customer_name,
      customerCode: it.customer_code,
      deliveryDate: it.po_deliveryDate,
      coreType: it.coreType, grade: it.grade, material: it.material, measure: it.measure,
      weightPerPc: it.weightPerPc,
      orderedPcs: it.pcs,
      producedPcs: produced,
      dispatchedPcs: dispatched,
      stockedInPcs: stockedIn,
      readyPcs,
      excessPcs: Math.max(produced - Number(it.pcs), 0),
      rateBasis:   it.rateBasis   ?? null,
      rateValue:   it.rateValue   ?? null,
      totalAmount: it.totalAmount ?? null,
      readyAmount,
    };
  }).filter((x) => x.readyPcs > 0);

  res.json({ items: ready });
}));

/* GET / — paginated list */
router.get('/', requirePermission('dispatch'), asyncHandler(async (req, res) => {
  const { page, pageSize, search, sort } = z.object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(200).default(50),
    search: z.string().trim().max(120).optional(),
    // 'date' (newest first) or 'customer' (groups a customer's dispatches
    // together, newest first within each — so same-customer/same-day rows sit
    // next to each other).
    sort: z.enum(['date', 'customer']).default('date'),
  }).parse(req.query);
  const skip = (page - 1) * pageSize;

  let where = 'd.`companyId` = ?';
  const params = [req.tenant.companyId];
  if (search) {
    const like = `%${search}%`;
    where += ' AND (d.`vehicleNo` LIKE ? OR po.`poNumber` LIKE ? OR c.`name` LIKE ? OR it.`grade` LIKE ? OR it.`material` LIKE ? OR it.`measure` LIKE ?)';
    params.push(like, like, like, like, like, like);
  }

  const orderBy = sort === 'customer'
    ? 'c.`name` ASC, d.`dispatchDate` DESC, d.`createdAt` DESC'
    : 'd.`dispatchDate` DESC, c.`name` ASC, d.`createdAt` DESC';

  const [rows, totalRow] = await Promise.all([
    q(`${DISPATCH_ROW_SQL} WHERE ${where} ORDER BY ${orderBy} LIMIT ? OFFSET ?`,
      [...params, pageSize, skip]),
    qOne(
      `SELECT COUNT(*) AS n FROM \`Dispatch\` d
        INNER JOIN \`PoOrderItem\` it ON it.\`id\` = d.\`poOrderItemId\`
        INNER JOIN \`PoOrder\` po ON po.\`id\` = it.\`poOrderId\`
        INNER JOIN \`Customer\` c ON c.\`id\` = po.\`customerId\`
        WHERE ${where}`, params),
  ]);

  res.json({ items: rows.map(flatten), total: Number(totalRow?.n ?? 0), page, pageSize });
}));

/* GET /:id */
router.get('/:id', requirePermission('dispatch'), asyncHandler(async (req, res) => {
  const row = await qOne(
    `${DISPATCH_ROW_SQL} WHERE d.\`id\` = ? AND d.\`companyId\` = ?`,
    [req.params.id, req.tenant.companyId]
  );
  if (!row) throw new AppError('Dispatch record not found', 404, 'NOT_FOUND');
  res.json(flatten(row));
}));

/* POST / */
router.post('/', requirePermission('dispatch'), asyncHandler(async (req, res) => {
  const data = createSchema.parse(req.body);

  const item = await qOne(
    `SELECT it.*,
            (SELECT COALESCE(SUM(pp.\`pcs\`),0) FROM \`Production\` pp WHERE pp.\`poOrderItemId\` = it.\`id\`) AS produced,
            (SELECT COALESCE(SUM(dd.\`pcs\`),0) FROM \`Dispatch\`   dd WHERE dd.\`poOrderItemId\` = it.\`id\`) AS dispatched
       FROM \`PoOrderItem\` it
       INNER JOIN \`PoOrder\` po ON po.\`id\` = it.\`poOrderId\`
       WHERE it.\`id\` = ? AND po.\`companyId\` = ?`,
    [data.poOrderItemId, req.tenant.companyId]
  );
  if (!item) throw new AppError('PO item not found', 404, 'NOT_FOUND');
  if (item.status === 'CANCELLED') throw new AppError('PO item is cancelled', 400, 'ITEM_CANCELLED');

  const available = Math.max(Number(item.produced ?? 0) - Number(item.dispatched ?? 0), 0);
  if (data.pcs > available) {
    throw new AppError(`Dispatch pcs (${data.pcs}) exceeds available produced pcs (${available}).`, 400, 'PCS_EXCEEDS');
  }

  const created = await insert('Dispatch', {
    poOrderItemId: data.poOrderItemId,
    dispatchDate: data.dispatchDate,
    pcs: data.pcs,
    weightPerPc: data.weightPerPc,
    totalWeight: data.totalWeight,
    actualWeight: data.actualWeight ?? null,
    vehicleNo: data.vehicleNo ?? null,
    notes: data.notes ?? null,
    companyId: req.tenant.companyId,
    createdById: req.auth.userId,
  });
  const fresh = await qOne(`${DISPATCH_ROW_SQL} WHERE d.\`id\` = ?`, [created.id]);
  const d = flatten(fresh);
  await logAudit(req, { entity: 'Dispatch', entityId: created.id, action: 'CREATE',
    summary: `Dispatch ${d.pcs} pcs · ${d.customerName ?? ''} · ${d.measure ?? ''} (PO ${d.poNumber ?? ''})`.replace(/\s+·\s+·/g, ' ·').trim() });
  notifyCompanyAdmins(req.tenant.companyId, {
    type: 'DISPATCH', title: 'New dispatch',
    body: [d.customerName, `${d.pcs} pcs`, d.vehicleNo].filter(Boolean).join(' · '),
    url: '/s/admin/dispatch', tag: 'dispatch',
  }, { push: false }).catch(() => {});
  res.status(201).json(d);
}));

/* PATCH /:id */
router.patch('/:id', requirePermission('dispatch'), asyncHandler(async (req, res) => {
  const data = updateSchema.parse(req.body);
  const existing = await qOne(
    `SELECT d.*, it.\`pcs\` AS item_pcs,
            (SELECT COALESCE(SUM(pp.\`pcs\`),0) FROM \`Production\` pp WHERE pp.\`poOrderItemId\` = d.\`poOrderItemId\`) AS produced,
            (SELECT COALESCE(SUM(dd.\`pcs\`),0) FROM \`Dispatch\` dd WHERE dd.\`poOrderItemId\` = d.\`poOrderItemId\` AND dd.\`id\` <> d.\`id\`) AS others
       FROM \`Dispatch\` d
       INNER JOIN \`PoOrderItem\` it ON it.\`id\` = d.\`poOrderItemId\`
       WHERE d.\`id\` = ? AND d.\`companyId\` = ?`,
    [req.params.id, req.tenant.companyId]
  );
  if (!existing) throw new AppError('Dispatch record not found', 404, 'NOT_FOUND');

  if (data.pcs !== undefined) {
    const available = Math.max(Number(existing.produced ?? 0) - Number(existing.others ?? 0), 0);
    if (data.pcs > available) {
      throw new AppError(`New pcs (${data.pcs}) exceeds available capacity (${available}).`, 400, 'PCS_EXCEEDS');
    }
  }

  const patch = {};
  if (data.dispatchDate !== undefined) patch.dispatchDate = data.dispatchDate;
  if (data.pcs          !== undefined) patch.pcs = data.pcs;
  if (data.weightPerPc  !== undefined) patch.weightPerPc = data.weightPerPc;
  if (data.totalWeight  !== undefined) patch.totalWeight = data.totalWeight;
  if (data.actualWeight !== undefined) patch.actualWeight = data.actualWeight ?? null;
  if (data.vehicleNo    !== undefined) patch.vehicleNo = data.vehicleNo ?? null;
  if (data.notes        !== undefined) patch.notes = data.notes ?? null;

  if (Object.keys(patch).length > 0) {
    const before = await snapshotEntity('Dispatch', existing.id);
    await update('Dispatch', existing.id, patch);
    await logAudit(req, { entity: 'Dispatch', entityId: existing.id, action: 'UPDATE',
      summary: `Edited dispatch — ${Object.keys(patch).join(', ')}`, before });
  }
  const fresh = await qOne(`${DISPATCH_ROW_SQL} WHERE d.\`id\` = ?`, [existing.id]);
  res.json(flatten(fresh));
}));

/* DELETE /:id */
router.delete('/:id', requirePermission('dispatch'), asyncHandler(async (req, res) => {
  const row = await qOne('SELECT `id` FROM `Dispatch` WHERE `id` = ? AND `companyId` = ?',
    [req.params.id, req.tenant.companyId]);
  if (!row) throw new AppError('Dispatch record not found', 404, 'NOT_FOUND');

  // Guard: a dispatch already committed to a packing list must NOT be deletable
  // directly — PackingListItem has ON DELETE CASCADE on dispatchId, so deleting
  // the dispatch would silently strip it from an already-issued (printed)
  // packing list and let the same goods be re-dispatched onto another one.
  // Force the user to delete that packing list first (a deliberate action).
  const onPl = await qOne(
    `SELECT p.\`plNumber\` AS plNumber
       FROM \`PackingListItem\` pli
       INNER JOIN \`PackingList\` p ON p.\`id\` = pli.\`packingListId\`
      WHERE pli.\`dispatchId\` = ?`,
    [row.id]
  );
  if (onPl) {
    throw new AppError(
      `This dispatch is part of packing list ${onPl.plNumber}. Delete that packing list first (Dispatch → Packing Lists), then delete the dispatch — this prevents it silently disappearing from an already-printed packing list.`,
      409, 'ON_PACKING_LIST'
    );
  }

  const info = await qOne(`${DISPATCH_ROW_SQL} WHERE d.\`id\` = ?`, [row.id]);
  const d = info ? flatten(info) : null;
  const before = await snapshotEntity('Dispatch', row.id);
  await del('Dispatch', row.id);
  await logAudit(req, { entity: 'Dispatch', entityId: row.id, action: 'DELETE',
    summary: d ? `Deleted dispatch ${d.pcs} pcs · ${d.customerName ?? ''} · ${d.measure ?? ''} (PO ${d.poNumber ?? ''})`.replace(/\s+·\s+·/g, ' ·').trim() : 'Deleted dispatch', before });
  res.status(204).end();
}));

export default router;
