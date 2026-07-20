// Packing list records — one PL can cover multiple dispatches.
// PackingListItem is the join table (each dispatch belongs to at most one PL).
import { Router } from 'express';
import { z } from 'zod';
import { q, qOne, insert, update, del, txn } from '../lib/db.js';
import { AppError, asyncHandler } from '../lib/errors.js';
import { requireAuth, requirePermission } from '../lib/auth.js';
import { resolveTenant } from '../lib/tenant.js';
import { logAudit, snapshotEntity } from '../lib/audit.js';

const router = Router();
router.use(requireAuth, resolveTenant);

const createSchema = z.object({
  dispatchIds: z.array(z.string().min(1)).min(1),
  plNumber:    z.string().trim().max(80).optional().nullable(), // ignored — WO No. is server-assigned & immutable
  plDate:      z.coerce.date(),
  invoiceNo:   z.string().trim().max(80).optional().nullable(),
  invoiceDate: z.coerce.date().optional().nullable(),
  testedBy:    z.string().trim().max(120).optional().nullable(),
  approvedBy:  z.string().trim().max(120).optional().nullable(),
  remarks:     z.string().trim().max(200).optional().nullable(),
});

const updateSchema = z.object({
  plNumber:    z.string().trim().max(80).optional().nullable(), // ignored — WO No. is server-assigned & immutable
  plDate:      z.coerce.date(),
  invoiceNo:   z.string().trim().max(80).optional().nullable(),
  invoiceDate: z.coerce.date().optional().nullable(),
  testedBy:    z.string().trim().max(120).optional().nullable(),
  approvedBy:  z.string().trim().max(120).optional().nullable(),
  remarks:     z.string().trim().max(200).optional().nullable(),
});

/** WO-number prefix from the company name — e.g. "TOROFLUX" → "TORWO". */
const woPrefix = (name) => `${String(name ?? '').slice(0, 3).toUpperCase()}WO`;

/** Next sequential WO No. for a company, e.g. "TORWO-007". `db` is either the
 *  module helpers ({ q, qOne }) or a txn handle — both expose q/qOne. Computing
 *  this inside the insert txn keeps the series gap-free; a unique index on
 *  (companyId, plNumber) is the final guard against a concurrent collision. */
const nextPlNumber = async (companyId, db) => {
  const company = await db.qOne('SELECT `name` FROM `Company` WHERE `id` = ?', [companyId]);
  const prefix = woPrefix(company?.name ?? '');
  const rows = await db.q(
    'SELECT `plNumber` FROM `PackingList` WHERE `companyId` = ? AND `plNumber` LIKE ?',
    [companyId, `${prefix}-%`]
  );
  let max = 0;
  for (const r of rows) {
    const m = /-(\d+)$/.exec(r.plNumber ?? '');
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `${prefix}-${String(max + 1).padStart(3, '0')}`;
};

const flattenDispatch = (d) => ({
  id:            d.id,
  poOrderItemId: d.poOrderItemId,
  dispatchDate:  d.dispatchDate,
  pcs:           d.pcs,
  weightPerPc:   d.weightPerPc,
  totalWeight:   d.totalWeight,
  actualWeight:  d.actualWeight ?? null,
  vehicleNo:     d.vehicleNo,
  poNumber:      d.po_number      ?? null,
  orderDate:     d.po_orderDate   ?? null,
  customerName:  d.customer_name  ?? null,
  customerCode:  d.customer_code  ?? null,
  customerState: d.customer_state ?? null,
  customerPhone: d.customer_phone ?? null,
  coreType:      d.item_coreType  ?? null,
  grade:         d.item_grade     ?? null,
  material:      d.item_material  ?? null,
  measure:       d.item_measure   ?? null,
  id1:           d.item_id1 ?? null,
  id2:           d.item_id2 ?? null,
  od1:           d.item_od1 ?? null,
  od2:           d.item_od2 ?? null,
  ht:            d.item_ht ?? null,
  itemPcs:       d.item_pcs ?? null,
  turns:         d.item_turns       ?? null,
  flux:          d.item_flux        ?? null,
  testVoltage:   d.item_testVoltage ?? null,
  testCurrent:   d.item_testCurrent ?? null,
  ratePerPc:     d.item_ratePerPc   ?? null,
});

// Load all dispatches that belong to the given packing-list ids, with
// joined PO + Customer + PoOrderItem columns.
const loadDispatchesForPls = async (plIds) => {
  if (plIds.length === 0) return new Map();
  const placeholders = plIds.map(() => '?').join(',');
  const rows = await q(
    `SELECT pli.\`packingListId\` AS plId,
            d.\`id\` AS id, d.\`poOrderItemId\` AS poOrderItemId,
            d.\`dispatchDate\` AS dispatchDate, d.\`pcs\` AS pcs,
            d.\`weightPerPc\` AS weightPerPc, d.\`totalWeight\` AS totalWeight,
            d.\`actualWeight\` AS actualWeight, d.\`vehicleNo\` AS vehicleNo,
            it.\`coreType\` AS item_coreType, it.\`grade\` AS item_grade,
            it.\`material\` AS item_material, it.\`measure\` AS item_measure,
            it.\`id1\` AS item_id1, it.\`id2\` AS item_id2,
            it.\`od1\` AS item_od1, it.\`od2\` AS item_od2,
            it.\`ht\` AS item_ht, it.\`pcs\` AS item_pcs,
            it.\`turns\` AS item_turns, it.\`flux\` AS item_flux,
            it.\`testVoltage\` AS item_testVoltage, it.\`testCurrent\` AS item_testCurrent,
            it.\`ratePerPc\` AS item_ratePerPc,
            po.\`poNumber\` AS po_number, po.\`orderDate\` AS po_orderDate,
            c.\`name\` AS customer_name, c.\`customerCode\` AS customer_code,
            c.\`state\` AS customer_state, c.\`phone\` AS customer_phone
       FROM \`PackingListItem\` pli
       INNER JOIN \`Dispatch\`    d  ON d.\`id\`  = pli.\`dispatchId\`
       INNER JOIN \`PoOrderItem\` it ON it.\`id\` = d.\`poOrderItemId\`
       INNER JOIN \`PoOrder\`     po ON po.\`id\` = it.\`poOrderId\`
       INNER JOIN \`Customer\`    c  ON c.\`id\`  = po.\`customerId\`
       WHERE pli.\`packingListId\` IN (${placeholders})
       ORDER BY d.\`dispatchDate\` ASC`,
    plIds
  );
  const byPl = new Map();
  for (const r of rows) {
    if (!byPl.has(r.plId)) byPl.set(r.plId, []);
    byPl.get(r.plId).push(r);
  }
  return byPl;
};

const flattenPl = (pl, dispatchRows = []) => {
  const dispatches = dispatchRows.map(flattenDispatch);
  const totalPcs    = dispatches.reduce((s, d) => s + (d.pcs ?? 0), 0);
  const totalWeight = dispatches.reduce((s, d) => s + (d.totalWeight ?? 0), 0);
  const first = dispatches[0] ?? {};
  return {
    id:           pl.id,
    plNumber:     pl.plNumber,
    plDate:       pl.plDate,
    invoiceNo:    pl.invoiceNo ?? null,
    invoiceDate:  pl.invoiceDate ?? null,
    testedBy:     pl.testedBy,
    approvedBy:   pl.approvedBy,
    remarks:      pl.remarks,
    createdAt:    pl.createdAt,
    updatedAt:    pl.updatedAt,
    itemCount:    dispatches.length,
    totalPcs,
    totalWeight,
    poNumber:     first.poNumber ?? null,
    customerName: first.customerName ?? null,
    customerCode: first.customerCode ?? null,
    dispatchDate: first.dispatchDate ?? null,
    dispatches,
  };
};

/* GET /packing-lists/pending — dispatches with no packing list yet */
router.get('/pending', requirePermission('dispatch'), asyncHandler(async (req, res) => {
  const { search } = z.object({ search: z.string().trim().max(120).optional() }).parse(req.query);

  let where = 'd.`companyId` = ? AND pli.`id` IS NULL';
  const params = [req.tenant.companyId];
  if (search) {
    const like = `%${search}%`;
    where += ' AND (po.`poNumber` LIKE ? OR c.`name` LIKE ? OR it.`measure` LIKE ? OR d.`vehicleNo` LIKE ?)';
    params.push(like, like, like, like);
  }

  const rows = await q(
    `SELECT d.*, it.\`coreType\`, it.\`grade\`, it.\`material\`,
            po.\`poNumber\`, c.\`name\` AS customerName, c.\`customerCode\` AS customerCode
       FROM \`Dispatch\` d
       LEFT JOIN \`PackingListItem\` pli ON pli.\`dispatchId\` = d.\`id\`
       INNER JOIN \`PoOrderItem\` it ON it.\`id\` = d.\`poOrderItemId\`
       INNER JOIN \`PoOrder\`     po ON po.\`id\` = it.\`poOrderId\`
       INNER JOIN \`Customer\`    c  ON c.\`id\`  = po.\`customerId\`
       WHERE ${where}
       ORDER BY d.\`dispatchDate\` DESC`,
    params
  );

  const items = rows.map((d) => ({
    id:           d.id,
    poNumber:     d.poNumber,
    customerName: d.customerName,
    customerCode: d.customerCode,
    coreType:     d.coreType,
    grade:        d.grade,
    material:     d.material,
    dispatchDate: d.dispatchDate,
    pcs:          d.pcs,
    totalWeight:  d.totalWeight,
    vehicleNo:    d.vehicleNo,
  }));
  res.json({ items });
}));

/* GET /packing-lists/next-number — the WO No. the next saved PL will receive.
   Registered before /:plId so "next-number" isn't captured as an id. */
router.get('/next-number', requirePermission('dispatch'), asyncHandler(async (req, res) => {
  const plNumber = await nextPlNumber(req.tenant.companyId, { q, qOne });
  res.json({ plNumber });
}));

/* GET /packing-lists */
router.get('/', requirePermission('dispatch'), asyncHandler(async (req, res) => {
  const { search } = z.object({ search: z.string().trim().max(120).optional() }).parse(req.query);

  let where = 'pl.`companyId` = ?';
  const params = [req.tenant.companyId];
  if (search) {
    const like = `%${search}%`;
    // Use EXISTS subquery so search across joined dispatch/po/customer works.
    where += ` AND (
      pl.\`plNumber\` LIKE ?
      OR pl.\`testedBy\` LIKE ?
      OR pl.\`approvedBy\` LIKE ?
      OR EXISTS (
        SELECT 1 FROM \`PackingListItem\` pli
        INNER JOIN \`Dispatch\` d ON d.\`id\` = pli.\`dispatchId\`
        INNER JOIN \`PoOrderItem\` it ON it.\`id\` = d.\`poOrderItemId\`
        INNER JOIN \`PoOrder\` po ON po.\`id\` = it.\`poOrderId\`
        INNER JOIN \`Customer\` c ON c.\`id\` = po.\`customerId\`
        WHERE pli.\`packingListId\` = pl.\`id\`
          AND (po.\`poNumber\` LIKE ? OR c.\`name\` LIKE ? OR it.\`measure\` LIKE ?)
      )
    )`;
    params.push(like, like, like, like, like, like);
  }

  const pls = await q(
    `SELECT * FROM \`PackingList\` pl WHERE ${where} ORDER BY pl.\`plDate\` DESC`,
    params
  );
  const byPl = await loadDispatchesForPls(pls.map((p) => p.id));
  res.json({ items: pls.map((p) => flattenPl(p, byPl.get(p.id) ?? [])) });
}));

/* GET /:plId */
router.get('/:plId', requirePermission('dispatch'), asyncHandler(async (req, res) => {
  const pl = await qOne(
    'SELECT * FROM `PackingList` WHERE `id` = ? AND `companyId` = ?',
    [req.params.plId, req.tenant.companyId]
  );
  if (!pl) throw new AppError('Packing list not found', 404, 'NOT_FOUND');
  const byPl = await loadDispatchesForPls([pl.id]);
  res.json(flattenPl(pl, byPl.get(pl.id) ?? []));
}));

/* POST /packing-lists */
router.post('/', requirePermission('dispatch'), asyncHandler(async (req, res) => {
  const data = createSchema.parse(req.body);

  const placeholders = data.dispatchIds.map(() => '?').join(',');
  const dispatches = await q(
    `SELECT \`id\` FROM \`Dispatch\` WHERE \`id\` IN (${placeholders}) AND \`companyId\` = ?`,
    [...data.dispatchIds, req.tenant.companyId]
  );
  if (dispatches.length !== data.dispatchIds.length) {
    throw new AppError('One or more dispatches not found', 404, 'NOT_FOUND');
  }

  const alreadyLinked = await qOne(
    `SELECT \`id\` FROM \`PackingListItem\` WHERE \`dispatchId\` IN (${placeholders}) LIMIT 1`,
    data.dispatchIds
  );
  if (alreadyLinked) {
    throw new AppError('One or more dispatches already belong to a packing list', 409, 'CONFLICT');
  }

  const plId = await txn(async (tx) => {
    // WO No. is assigned by the server, sequentially per company, so it can
    // never duplicate (a unique index backs this up). The client no longer
    // sends it; any value it does send is ignored.
    const plNumber = await nextPlNumber(req.tenant.companyId, tx);
    const pl = await tx.insert('PackingList', {
      plNumber,
      plDate:      data.plDate,
      invoiceNo:   data.invoiceNo ?? null,
      invoiceDate: data.invoiceDate ?? null,
      testedBy:    data.testedBy ?? null,
      approvedBy:  data.approvedBy ?? null,
      remarks:     data.remarks ?? null,
      companyId:   req.tenant.companyId,
      createdById: req.auth.userId,
    });
    for (const did of data.dispatchIds) {
      await tx.insert('PackingListItem', { packingListId: pl.id, dispatchId: did });
    }
    return pl.id;
  });

  const pl = await qOne('SELECT * FROM `PackingList` WHERE `id` = ?', [plId]);
  const byPl = await loadDispatchesForPls([plId]);
  res.status(201).json(flattenPl(pl, byPl.get(plId) ?? []));
}));

/* PUT /:plId */
router.put('/:plId', requirePermission('dispatch'), asyncHandler(async (req, res) => {
  const data = updateSchema.parse(req.body);
  const pl = await qOne(
    'SELECT `id` FROM `PackingList` WHERE `id` = ? AND `companyId` = ?',
    [req.params.plId, req.tenant.companyId]
  );
  if (!pl) throw new AppError('Packing list not found', 404, 'NOT_FOUND');

  // WO No. is immutable once assigned — intentionally not updated here.
  await update('PackingList', pl.id, {
    plDate:      data.plDate,
    invoiceNo:   data.invoiceNo   ?? null,
    invoiceDate: data.invoiceDate ?? null,
    testedBy:    data.testedBy    ?? null,
    approvedBy:  data.approvedBy  ?? null,
    remarks:     data.remarks     ?? null,
  });

  const fresh = await qOne('SELECT * FROM `PackingList` WHERE `id` = ?', [pl.id]);
  const byPl = await loadDispatchesForPls([pl.id]);
  res.json(flattenPl(fresh, byPl.get(pl.id) ?? []));
}));

/* DELETE /:plId */
router.delete('/:plId', requirePermission('dispatch'), asyncHandler(async (req, res) => {
  const pl = await qOne(
    'SELECT `id`, `plNumber` FROM `PackingList` WHERE `id` = ? AND `companyId` = ?',
    [req.params.plId, req.tenant.companyId]
  );
  if (!pl) throw new AppError('Packing list not found', 404, 'NOT_FOUND');
  const before = await snapshotEntity('PackingList', pl.id);
  await del('PackingList', pl.id);
  await logAudit(req, { entity: 'PackingList', entityId: pl.id, action: 'DELETE', summary: `Deleted packing list ${pl.plNumber}`, before });
  res.status(204).end();
}));

export default router;
