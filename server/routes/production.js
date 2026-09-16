// Production records — list, record-against-pending-PO-item, edit, delete.
import { Router } from 'express';
import { z } from 'zod';
import { q, qOne, insert, update, del } from '../lib/db.js';
import { AppError, asyncHandler } from '../lib/errors.js';
import { requireAuth, requirePermission } from '../lib/auth.js';
import { resolveTenant } from '../lib/tenant.js';
import { logAudit, snapshotEntity } from '../lib/audit.js';
import { notifyCompanyAdmins } from '../lib/push.js';
import { producedPcsExpr, producedPcsFromRows, splitAmountsByEntry, unmatchedByHeight } from '../lib/splitProduction.js';

const router = Router();
router.use(requireAuth, resolveTenant);

const createSchema = z.object({
  poOrderItemId: z.string().min(1),
  prodDate: z.coerce.date(),
  pcs: z.coerce.number().int().positive(),
  weightPerPc: z.coerce.number().nonnegative(),
  totalWeight: z.coerce.number().nonnegative(),
  labourName: z.string().trim().min(1).max(120),
  notes: z.string().max(2000).optional().nullable(),
  // Split-width production: this run is one physical strip of a wider item
  // (e.g. the 40mm half of a 65mm item), not the full ordered height. See
  // lib/splitProduction.js for the matching/pay rule.
  splitHeight: z.coerce.number().positive().optional().nullable(),
});

const updateSchema = z.object({
  prodDate: z.coerce.date().optional(),
  pcs: z.coerce.number().int().positive().optional(),
  weightPerPc: z.coerce.number().nonnegative().optional(),
  totalWeight: z.coerce.number().nonnegative().optional(),
  labourName: z.string().trim().min(1).max(120).optional(),
  notes: z.string().max(2000).optional().nullable(),
  splitHeight: z.coerce.number().positive().optional().nullable(),
});

// Production rows joined with their parent PO item + PO + customer.
// totalAmount/rates come from the parent item; we surface them flat.
const PROD_ROW_SQL = `
  SELECT p.*,
         it.\`pcs\`         AS item_pcs,
         it.\`coreType\`    AS item_coreType,
         it.\`grade\`       AS item_grade,
         it.\`material\`    AS item_material,
         it.\`measure\`     AS item_measure,
         it.\`ht\`          AS item_ht,
         it.\`rateBasis\`   AS item_rateBasis,
         it.\`rateValue\`   AS item_rateValue,
         it.\`ratePerKg\`   AS item_ratePerKg,
         it.\`ratePerPc\`   AS item_ratePerPc,
         it.\`totalAmount\` AS item_totalAmount,
         po.\`poNumber\`    AS po_number,
         po.\`orderDate\`   AS po_orderDate,
         c.\`name\`         AS customer_name,
         c.\`customerCode\` AS customer_code
    FROM \`Production\` p
    INNER JOIN \`PoOrderItem\` it ON it.\`id\` = p.\`poOrderItemId\`
    INNER JOIN \`PoOrder\`    po ON po.\`id\` = it.\`poOrderId\`
    INNER JOIN \`Customer\`   c  ON c.\`id\`  = po.\`customerId\``;

const flatten = (r) => {
  const lineAmount = r.item_totalAmount ?? null;
  const isSplit = r.splitHeight != null;
  // Whole-piece rows keep the exact math they always had. A split row's real
  // amount depends on its sibling split rows (has the matching half arrived
  // yet?), which a single flattened row can't see — left null here and
  // filled in afterward by attachSplitAmounts() once all of an item's split
  // rows are in hand. See lib/splitProduction.js.
  const proRataAmount = (!isSplit && lineAmount != null && r.item_pcs > 0)
    ? +(lineAmount * (r.pcs / r.item_pcs)).toFixed(2)
    : null;
  return {
    id: r.id,
    poOrderItemId: r.poOrderItemId,
    poNumber: r.po_number,
    customerName: r.customer_name,
    customerCode: r.customer_code,
    orderDate: r.po_orderDate,
    coreType: r.item_coreType,
    grade: r.item_grade,
    material: r.item_material,
    measure: r.item_measure,
    itemPcs: r.item_pcs,
    itemHt: r.item_ht,
    prodDate: r.prodDate,
    pcs: r.pcs,
    weightPerPc: r.weightPerPc,
    totalWeight: r.totalWeight,
    labourName: r.labourName,
    notes: r.notes,
    createdAt: r.createdAt,
    rateBasis:   r.item_rateBasis ?? null,
    rateValue:   r.item_rateValue ?? null,
    ratePerKg:   r.item_ratePerKg ?? null,
    ratePerPc:   r.item_ratePerPc ?? null,
    lineAmount,
    splitHeight: r.splitHeight ?? null,
    amount:      proRataAmount,
  };
};

/* Split rows' amounts depend on siblings the current query may not have
   fetched (a date-filtered Summary view, a paginated Modify page, …), so
   correctness requires re-reading EVERY split row ever recorded against
   each affected item — not just the ones on screen — and replaying them in
   order. Cheap in the common case: a no-op unless the result actually
   contains a split row. Mutates and returns `items`. */
const attachSplitAmounts = async (items) => {
  const splitItemIds = [...new Set(items.filter((i) => i.splitHeight != null).map((i) => i.poOrderItemId))];
  if (!splitItemIds.length) return items;
  const placeholders = splitItemIds.map(() => '?').join(',');
  const allSplitRows = await q(
    `SELECT \`id\`, \`poOrderItemId\`, \`pcs\`, \`splitHeight\`, \`createdAt\`
       FROM \`Production\` WHERE \`poOrderItemId\` IN (${placeholders}) AND \`splitHeight\` IS NOT NULL`,
    splitItemIds
  );
  const rowsByItem = new Map();
  for (const r of allSplitRows) {
    if (!rowsByItem.has(r.poOrderItemId)) rowsByItem.set(r.poOrderItemId, []);
    rowsByItem.get(r.poOrderItemId).push(r);
  }
  // Any item row already carries its own item's rate/pcs — grab one per item.
  const rateByItem = new Map();
  for (const it of items) {
    if (it.splitHeight == null || rateByItem.has(it.poOrderItemId)) continue;
    rateByItem.set(it.poOrderItemId, (it.lineAmount != null && it.itemPcs > 0) ? it.lineAmount / it.itemPcs : null);
  }
  const amountsByItem = new Map();
  for (const [poOrderItemId, rows] of rowsByItem) {
    amountsByItem.set(poOrderItemId, splitAmountsByEntry(rows, rateByItem.get(poOrderItemId) ?? null));
  }
  for (const it of items) {
    if (it.splitHeight == null) continue;
    const m = amountsByItem.get(it.poOrderItemId);
    it.amount = m ? (m.get(it.id) ?? null) : null;
  }
  return items;
};

/* ---------- /pending — items still awaiting production ---------- */
router.get('/pending', requirePermission('rec_production'), asyncHandler(async (req, res) => {
  const search = z.object({ search: z.string().trim().max(120).optional() })
    .parse(req.query).search;

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
            po.\`orderDate\`    AS po_orderDate,
            po.\`deliveryDate\` AS po_deliveryDate,
            c.\`name\`          AS customer_name,
            c.\`customerCode\`  AS customer_code,
            ${producedPcsExpr('it')} AS produced
       FROM \`PoOrderItem\` it
       INNER JOIN \`PoOrder\`  po ON po.\`id\` = it.\`poOrderId\`
       INNER JOIN \`Customer\` c  ON c.\`id\`  = po.\`customerId\`
       WHERE ${where}
       ORDER BY it.\`createdAt\` DESC`,
    params
  );

  // Split state per item — so the operator picking an item that already has
  // an unmatched split pile (e.g. 50 pcs of a 40mm half with no 25mm match
  // yet) can see that before recording another run against it, rather than
  // guessing or re-typing a height that doesn't actually match.
  const splitRows = rows.length
    ? await q(
        `SELECT \`poOrderItemId\`, \`pcs\`, \`splitHeight\` FROM \`Production\`
          WHERE \`splitHeight\` IS NOT NULL AND \`poOrderItemId\` IN (${rows.map(() => '?').join(',')})`,
        rows.map((r) => r.id)
      )
    : [];
  const splitByItem = new Map();
  for (const r of splitRows) {
    if (!splitByItem.has(r.poOrderItemId)) splitByItem.set(r.poOrderItemId, []);
    splitByItem.get(r.poOrderItemId).push(r);
  }

  const pending = rows.map((it) => {
    const produced = Number(it.produced ?? 0);
    const remaining = Math.max(it.pcs - produced, 0);
    const pendingAmount = (it.totalAmount != null && it.pcs > 0)
      ? +(it.totalAmount * (remaining / it.pcs)).toFixed(2)
      : null;
    const splits = splitByItem.get(it.id);
    return {
      id: it.id,
      poNumber: it.po_number,
      customerName: it.customer_name,
      customerCode: it.customer_code,
      orderDate: it.po_orderDate,
      deliveryDate: it.po_deliveryDate,
      coreType: it.coreType, grade: it.grade, material: it.material, measure: it.measure,
      // Raw dims (not just the composed measure string) so the client can
      // recompute weight for a chosen split height the same way calc.ts
      // already computes it for the full piece.
      id1: it.id1, id2: it.id2, od1: it.od1, od2: it.od2, ht: it.ht,
      weightPerPc: it.weightPerPc,
      // Needed so a split-height run re-weighs on the factor this line was
      // booked with rather than the house default.
      stackFactor: it.stackFactor ?? null,
      orderedPcs: it.pcs,
      producedPcs: produced,
      remainingPcs: remaining,
      rateBasis:   it.rateBasis   ?? null,
      rateValue:   it.rateValue   ?? null,
      totalAmount: it.totalAmount ?? null,
      pendingAmount,
      splitInfo: splits ? unmatchedByHeight(splits) : [],
    };
  }).filter((x) => x.remainingPcs > 0);

  res.json({ items: pending });
}));

/* GET /api/production/_meta/labours — must come before /:id */
router.get('/_meta/labours', requirePermission('rec_production'), asyncHandler(async (req, res) => {
  const rows = await q(
    'SELECT DISTINCT `labourName` FROM `Production` WHERE `companyId` = ? ORDER BY `labourName` ASC LIMIT 200',
    [req.tenant.companyId]
  );
  res.json({ labours: rows.map((r) => r.labourName) });
}));

/* GET / — paginated list */
router.get('/', requirePermission('view_po'), asyncHandler(async (req, res) => {
  const { page, pageSize, search, coreType, labour } = z.object({
    page: z.coerce.number().int().min(1).default(1),
    // Generous cap so the "Excel" button (pulls every filtered row at once)
    // works without paging. Normal browsing uses pageSize=20.
    pageSize: z.coerce.number().int().min(1).max(10000).default(50),
    search: z.string().trim().max(120).optional(),
    coreType: z.enum(['TOROIDAL', 'RECTANGULAR']).optional(),
    labour: z.string().trim().max(120).optional(),
  }).parse(req.query);
  const skip = (page - 1) * pageSize;

  let where = 'p.`companyId` = ?';
  const params = [req.tenant.companyId];
  if (search) {
    const like = `%${search}%`;
    where += ' AND (p.`labourName` LIKE ? OR po.`poNumber` LIKE ? OR c.`name` LIKE ? OR it.`grade` LIKE ? OR it.`material` LIKE ? OR it.`measure` LIKE ?)';
    params.push(like, like, like, like, like, like);
  }
  if (coreType) { where += ' AND it.`coreType` = ?'; params.push(coreType); }
  if (labour)   { where += ' AND p.`labourName` = ?'; params.push(labour); }

  const [rows, totalRow, aggRow, labours] = await Promise.all([
    q(`${PROD_ROW_SQL} WHERE ${where} ORDER BY p.\`prodDate\` DESC LIMIT ? OFFSET ?`,
      [...params, pageSize, skip]),
    qOne(
      `SELECT COUNT(*) AS n, COUNT(DISTINCT p.\`labourName\`) AS labourCount, COUNT(DISTINCT po.\`id\`) AS poCount
         FROM \`Production\` p
        INNER JOIN \`PoOrderItem\` it ON it.\`id\` = p.\`poOrderItemId\`
        INNER JOIN \`PoOrder\` po ON po.\`id\` = it.\`poOrderId\`
        INNER JOIN \`Customer\` c ON c.\`id\` = po.\`customerId\`
        WHERE ${where}`, params),
    // Job amount is pro-rated from the PARENT item's totalAmount (see flatten()
    // below), which SQL can't do directly — sum it in JS from the same rows
    // used for the flat total so the KPI strip always matches the table.
    // Also carries what attachSplitAmounts needs (id/poOrderItemId/splitHeight)
    // so a split row here is matched the same way as everywhere else, over
    // its FULL history — not just whatever this filter happens to catch.
    q(`SELECT p.\`id\`, p.\`poOrderItemId\`, p.\`splitHeight\`, p.\`pcs\`, p.\`totalWeight\`,
              it.\`pcs\` AS item_pcs, it.\`totalAmount\` AS item_totalAmount
         FROM \`Production\` p
        INNER JOIN \`PoOrderItem\` it ON it.\`id\` = p.\`poOrderItemId\`
        INNER JOIN \`PoOrder\` po ON po.\`id\` = it.\`poOrderId\`
        INNER JOIN \`Customer\` c ON c.\`id\` = po.\`customerId\`
        WHERE ${where}`, params),
    q(
      "SELECT DISTINCT `labourName` FROM `Production` WHERE `companyId` = ? AND `labourName` <> '' ORDER BY `labourName` ASC",
      [req.tenant.companyId]
    ),
  ]);

  let pcs = 0, weight = 0, amount = 0, unratedCount = 0;
  const aggItems = aggRow.map((r) => ({
    id: r.id, poOrderItemId: r.poOrderItemId, splitHeight: r.splitHeight ?? null,
    itemPcs: r.item_pcs, lineAmount: r.item_totalAmount ?? null,
    amount: (r.splitHeight == null && r.item_totalAmount != null && r.item_pcs > 0)
      ? +(Number(r.item_totalAmount) * (Number(r.pcs) / Number(r.item_pcs))).toFixed(2)
      : null,
  }));
  await attachSplitAmounts(aggItems);
  for (let i = 0; i < aggRow.length; i++) {
    const r = aggRow[i];
    pcs += Number(r.pcs) || 0;
    weight += Number(r.totalWeight) || 0;
    const a = aggItems[i].amount;
    if (a != null) amount += a; else unratedCount++;
  }

  res.json({
    items: await attachSplitAmounts(rows.map(flatten)),
    total: Number(totalRow?.n ?? 0),
    page, pageSize,
    aggregates: {
      records: Number(totalRow?.n ?? 0),
      pcs,
      weight: +weight.toFixed(3),
      amount: +amount.toFixed(2),
      unratedCount,
      poCount: Number(totalRow?.poCount ?? 0),
      labourCount: Number(totalRow?.labourCount ?? 0),
    },
    labours: labours.map((r) => r.labourName),
  });
}));

/* GET /summary — filtered production report (by date / employee / customer),
   with per-row amounts and grand totals. Powers the Production Summary page. */
router.get('/summary', requirePermission('view_po'), asyncHandler(async (req, res) => {
  const { from, to, labour, customerId, search } = z.object({
    from:       z.coerce.date().optional(),
    to:         z.coerce.date().optional(),
    labour:     z.string().trim().max(120).optional(),
    customerId: z.string().trim().max(191).optional(),
    search:     z.string().trim().max(120).optional(),
  }).parse(req.query);

  let where = 'p.`companyId` = ?';
  const params = [req.tenant.companyId];
  if (from) { where += ' AND p.`prodDate` >= ?'; params.push(from); }
  if (to)   { const end = new Date(to); end.setHours(23, 59, 59, 999); where += ' AND p.`prodDate` <= ?'; params.push(end); }
  if (labour)     { where += ' AND p.`labourName` = ?'; params.push(labour); }
  if (customerId) { where += ' AND po.`customerId` = ?'; params.push(customerId); }
  if (search) {
    const like = `%${search}%`;
    where += ' AND (p.`labourName` LIKE ? OR po.`poNumber` LIKE ? OR c.`name` LIKE ? OR it.`grade` LIKE ? OR it.`material` LIKE ? OR it.`measure` LIKE ?)';
    params.push(like, like, like, like, like, like);
  }

  const [rows, labours] = await Promise.all([
    q(`${PROD_ROW_SQL} WHERE ${where} ORDER BY p.\`prodDate\` DESC LIMIT 20000`, params),
    q(
      "SELECT DISTINCT `labourName` FROM `Production` WHERE `companyId` = ? AND `labourName` <> '' ORDER BY `labourName` ASC",
      [req.tenant.companyId]
    ),
  ]);
  const items = await attachSplitAmounts(rows.map(flatten));
  const totals = items.reduce((t, r) => ({
    pcs:    t.pcs + (Number(r.pcs) || 0),
    weight: +(t.weight + (Number(r.totalWeight) || 0)).toFixed(3),
    amount: +(t.amount + (Number(r.amount) || 0)).toFixed(2),
  }), { pcs: 0, weight: 0, amount: 0 });
  // This report is the one place that can legitimately ask for thousands of
  // rows at once, so it sends only the fields the page actually renders rather
  // than the full flattened row — the rate columns, notes, order dates and item
  // totals behind each entry go unused here and roughly double the payload.
  // The split-amount pass above needs the full shape, so trim afterwards.
  res.json({
    items: items.map((r) => ({
      id: r.id,
      prodDate: r.prodDate,
      poNumber: r.poNumber,
      customerName: r.customerName,
      customerCode: r.customerCode,
      labourName: r.labourName,
      coreType: r.coreType,
      grade: r.grade,
      material: r.material,
      measure: r.measure,
      pcs: r.pcs,
      weightPerPc: r.weightPerPc,
      totalWeight: r.totalWeight,
      amount: r.amount,
      splitHeight: r.splitHeight,
    })),
    totals,
    labours: labours.map((r) => r.labourName),
  });
}));

/* GET /:id */
router.get('/:id', requirePermission('view_po'), asyncHandler(async (req, res) => {
  const row = await qOne(
    `${PROD_ROW_SQL} WHERE p.\`id\` = ? AND p.\`companyId\` = ?`,
    [req.params.id, req.tenant.companyId]
  );
  if (!row) throw new AppError('Production record not found', 404, 'NOT_FOUND');
  // othersPcs = finished pcs from every OTHER production record on the same
  // PO item (used by the edit page's "N remaining" hint) — matched, not a
  // raw sum, so editing one half of a split doesn't get a phantom allowance
  // from its own still-unmatched sibling pile.
  const otherRows = await q(
    'SELECT `pcs`, `splitHeight` FROM `Production` WHERE `poOrderItemId` = ? AND `id` <> ?',
    [row.poOrderItemId, row.id]
  );
  const [flat] = await attachSplitAmounts([flatten(row)]);
  res.json({ ...flat, othersPcs: producedPcsFromRows(otherRows) });
}));

/* POST / */
router.post('/', requirePermission('rec_production'), asyncHandler(async (req, res) => {
  const data = createSchema.parse(req.body);

  const item = await qOne(
    `SELECT it.*, po.\`orderDate\` AS po_orderDate
       FROM \`PoOrderItem\` it
       INNER JOIN \`PoOrder\` po ON po.\`id\` = it.\`poOrderId\`
       WHERE it.\`id\` = ? AND po.\`companyId\` = ?`,
    [data.poOrderItemId, req.tenant.companyId]
  );
  if (!item) throw new AppError('PO item not found', 404, 'NOT_FOUND');
  if (item.status === 'CANCELLED') throw new AppError('PO item is cancelled', 400, 'ITEM_CANCELLED');

  // Excess production is allowed — more pcs than ordered can be recorded and
  // will be available for dispatch (readyPcs = produced - dispatched, uncapped).
  if (new Date(data.prodDate) < new Date(item.po_orderDate)) {
    throw new AppError('Production date cannot be before order date', 400, 'BAD_DATE');
  }
  // A split height is a PARTIAL run — it has to be smaller than the item's
  // own full height, or it isn't a split at all (record it as a normal,
  // whole-piece entry instead by leaving splitHeight out).
  if (data.splitHeight != null && item.ht != null && data.splitHeight >= item.ht) {
    throw new AppError(`Split height (${data.splitHeight}mm) must be less than the item's full height (${item.ht}mm).`, 400, 'BAD_SPLIT_HEIGHT');
  }

  const created = await insert('Production', {
    poOrderItemId: data.poOrderItemId,
    prodDate: data.prodDate,
    pcs: data.pcs,
    weightPerPc: data.weightPerPc,
    totalWeight: data.totalWeight,
    labourName: data.labourName,
    notes: data.notes ?? null,
    splitHeight: data.splitHeight ?? null,
    companyId: req.tenant.companyId,
    createdById: req.auth.userId,
  });
  await logAudit(req, { entity: 'Production', entityId: created.id, action: 'CREATE', summary: `Production ${data.pcs} pcs · ${data.labourName}` });
  notifyCompanyAdmins(req.tenant.companyId, {
    type: 'PRODUCTION', title: 'Production received',
    body: [`${data.pcs} pcs`, [item.grade, item.measure].filter(Boolean).join(' '), data.labourName].filter(Boolean).join(' · '),
    url: '/s/admin/production', tag: 'production-recv',
  }, { push: false }).catch(() => {});
  res.status(201).json(created);
}));

/* PATCH /:id */
router.patch('/:id', requirePermission('modify_prod_qty'), asyncHandler(async (req, res) => {
  const data = updateSchema.parse(req.body);
  const row = await qOne(
    `SELECT p.*, it.\`pcs\` AS item_pcs, it.\`ht\` AS item_ht, po.\`orderDate\` AS po_orderDate
       FROM \`Production\` p
       INNER JOIN \`PoOrderItem\` it ON it.\`id\` = p.\`poOrderItemId\`
       INNER JOIN \`PoOrder\`     po ON po.\`id\` = it.\`poOrderId\`
       WHERE p.\`id\` = ? AND p.\`companyId\` = ?`,
    [req.params.id, req.tenant.companyId]
  );
  if (!row) throw new AppError('Production record not found', 404, 'NOT_FOUND');

  // Excess production is allowed (confirmed by the user on the frontend).
  if (data.prodDate !== undefined && new Date(data.prodDate) < new Date(row.po_orderDate)) {
    throw new AppError('Production date cannot be before order date', 400, 'BAD_DATE');
  }
  const nextSplitHeight = data.splitHeight !== undefined ? data.splitHeight : row.splitHeight;
  if (nextSplitHeight != null && row.item_ht != null && nextSplitHeight >= row.item_ht) {
    throw new AppError(`Split height (${nextSplitHeight}mm) must be less than the item's full height (${row.item_ht}mm).`, 400, 'BAD_SPLIT_HEIGHT');
  }

  const before = await snapshotEntity('Production', row.id);
  const patch = { ...data };
  if (patch.notes !== undefined) patch.notes = patch.notes ?? null;
  const updated = await update('Production', row.id, patch);
  await logAudit(req, { entity: 'Production', entityId: row.id, action: 'UPDATE', summary: `Production ${updated.pcs} pcs · ${updated.labourName}`, before });
  res.json(updated);
}));

/* DELETE /:id */
router.delete('/:id', requirePermission('modify_prod_qty'), asyncHandler(async (req, res) => {
  const row = await qOne('SELECT `id` FROM `Production` WHERE `id` = ? AND `companyId` = ?',
    [req.params.id, req.tenant.companyId]);
  if (!row) throw new AppError('Production record not found', 404, 'NOT_FOUND');
  const before = await snapshotEntity('Production', row.id);
  await del('Production', row.id);
  await logAudit(req, { entity: 'Production', entityId: row.id, action: 'DELETE', summary: before?.row ? `Production ${before.row.pcs} pcs · ${before.row.labourName}` : 'Production', before });
  res.status(204).end();
}));

export default router;
