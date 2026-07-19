// Production records — list, record-against-pending-PO-item, edit, delete.
import { Router } from 'express';
import { z } from 'zod';
import { q, qOne, insert, update, del } from '../lib/db.js';
import { AppError, asyncHandler } from '../lib/errors.js';
import { requireAuth, requirePermission } from '../lib/auth.js';
import { resolveTenant } from '../lib/tenant.js';
import { logAudit, snapshotEntity } from '../lib/audit.js';
import { notifyCompanyAdmins } from '../lib/push.js';

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
});

const updateSchema = z.object({
  prodDate: z.coerce.date().optional(),
  pcs: z.coerce.number().int().positive().optional(),
  weightPerPc: z.coerce.number().nonnegative().optional(),
  totalWeight: z.coerce.number().nonnegative().optional(),
  labourName: z.string().trim().min(1).max(120).optional(),
  notes: z.string().max(2000).optional().nullable(),
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
  const proRataAmount = (lineAmount != null && r.item_pcs > 0)
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
    amount:      proRataAmount,
  };
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
            (SELECT COALESCE(SUM(pp.\`pcs\`),0) FROM \`Production\` pp WHERE pp.\`poOrderItemId\` = it.\`id\`) AS produced
       FROM \`PoOrderItem\` it
       INNER JOIN \`PoOrder\`  po ON po.\`id\` = it.\`poOrderId\`
       INNER JOIN \`Customer\` c  ON c.\`id\`  = po.\`customerId\`
       WHERE ${where}
       ORDER BY it.\`createdAt\` DESC`,
    params
  );

  const pending = rows.map((it) => {
    const produced = Number(it.produced ?? 0);
    const remaining = Math.max(it.pcs - produced, 0);
    const pendingAmount = (it.totalAmount != null && it.pcs > 0)
      ? +(it.totalAmount * (remaining / it.pcs)).toFixed(2)
      : null;
    return {
      id: it.id,
      poNumber: it.po_number,
      customerName: it.customer_name,
      customerCode: it.customer_code,
      orderDate: it.po_orderDate,
      deliveryDate: it.po_deliveryDate,
      coreType: it.coreType, grade: it.grade, material: it.material, measure: it.measure,
      weightPerPc: it.weightPerPc,
      orderedPcs: it.pcs,
      producedPcs: produced,
      remainingPcs: remaining,
      rateBasis:   it.rateBasis   ?? null,
      rateValue:   it.rateValue   ?? null,
      totalAmount: it.totalAmount ?? null,
      pendingAmount,
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
  const { page, pageSize, search } = z.object({
    page: z.coerce.number().int().min(1).default(1),
    // Generous cap so the "Excel" button (pulls every filtered row at once)
    // works without paging. Normal browsing uses pageSize=20.
    pageSize: z.coerce.number().int().min(1).max(10000).default(50),
    search: z.string().trim().max(120).optional(),
  }).parse(req.query);
  const skip = (page - 1) * pageSize;

  let where = 'p.`companyId` = ?';
  const params = [req.tenant.companyId];
  if (search) {
    const like = `%${search}%`;
    where += ' AND (p.`labourName` LIKE ? OR po.`poNumber` LIKE ? OR c.`name` LIKE ? OR it.`grade` LIKE ? OR it.`material` LIKE ? OR it.`measure` LIKE ?)';
    params.push(like, like, like, like, like, like);
  }

  const [rows, totalRow] = await Promise.all([
    q(`${PROD_ROW_SQL} WHERE ${where} ORDER BY p.\`prodDate\` DESC LIMIT ? OFFSET ?`,
      [...params, pageSize, skip]),
    qOne(
      `SELECT COUNT(*) AS n FROM \`Production\` p
        INNER JOIN \`PoOrderItem\` it ON it.\`id\` = p.\`poOrderItemId\`
        INNER JOIN \`PoOrder\` po ON po.\`id\` = it.\`poOrderId\`
        INNER JOIN \`Customer\` c ON c.\`id\` = po.\`customerId\`
        WHERE ${where}`, params),
  ]);

  res.json({ items: rows.map(flatten), total: Number(totalRow?.n ?? 0), page, pageSize });
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

  const rows = await q(`${PROD_ROW_SQL} WHERE ${where} ORDER BY p.\`prodDate\` DESC LIMIT 20000`, params);
  const items = rows.map(flatten);
  const totals = items.reduce((t, r) => ({
    pcs:    t.pcs + (Number(r.pcs) || 0),
    weight: +(t.weight + (Number(r.totalWeight) || 0)).toFixed(3),
    amount: +(t.amount + (Number(r.amount) || 0)).toFixed(2),
  }), { pcs: 0, weight: 0, amount: 0 });
  const labours = await q(
    "SELECT DISTINCT `labourName` FROM `Production` WHERE `companyId` = ? AND `labourName` <> '' ORDER BY `labourName` ASC",
    [req.tenant.companyId]
  );
  res.json({ items, totals, labours: labours.map((r) => r.labourName) });
}));

/* GET /:id */
router.get('/:id', requirePermission('view_po'), asyncHandler(async (req, res) => {
  const row = await qOne(
    `${PROD_ROW_SQL} WHERE p.\`id\` = ? AND p.\`companyId\` = ?`,
    [req.params.id, req.tenant.companyId]
  );
  if (!row) throw new AppError('Production record not found', 404, 'NOT_FOUND');
  // othersPcs = sum of OTHER production records for the same PO item (needed for excess-production check on edit).
  const othersRow = await qOne(
    'SELECT COALESCE(SUM(`pcs`),0) AS n FROM `Production` WHERE `poOrderItemId` = ? AND `id` <> ?',
    [row.poOrderItemId, row.id]
  );
  res.json({ ...flatten(row), othersPcs: Number(othersRow?.n ?? 0) });
}));

/* POST / */
router.post('/', requirePermission('rec_production'), asyncHandler(async (req, res) => {
  const data = createSchema.parse(req.body);

  const item = await qOne(
    `SELECT it.*, po.\`orderDate\` AS po_orderDate,
            (SELECT COALESCE(SUM(pp.\`pcs\`),0) FROM \`Production\` pp WHERE pp.\`poOrderItemId\` = it.\`id\`) AS produced
       FROM \`PoOrderItem\` it
       INNER JOIN \`PoOrder\` po ON po.\`id\` = it.\`poOrderId\`
       WHERE it.\`id\` = ? AND po.\`companyId\` = ?`,
    [data.poOrderItemId, req.tenant.companyId]
  );
  if (!item) throw new AppError('PO item not found', 404, 'NOT_FOUND');
  if (item.status === 'CANCELLED') throw new AppError('PO item is cancelled', 400, 'ITEM_CANCELLED');

  const produced = Number(item.produced ?? 0);
  // Excess production is allowed — more pcs than ordered can be recorded and
  // will be available for dispatch (readyPcs = produced - dispatched, uncapped).
  if (new Date(data.prodDate) < new Date(item.po_orderDate)) {
    throw new AppError('Production date cannot be before order date', 400, 'BAD_DATE');
  }

  const created = await insert('Production', {
    poOrderItemId: data.poOrderItemId,
    prodDate: data.prodDate,
    pcs: data.pcs,
    weightPerPc: data.weightPerPc,
    totalWeight: data.totalWeight,
    labourName: data.labourName,
    notes: data.notes ?? null,
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
    `SELECT p.*, it.\`pcs\` AS item_pcs, po.\`orderDate\` AS po_orderDate,
            (SELECT COALESCE(SUM(pp.\`pcs\`),0) FROM \`Production\` pp WHERE pp.\`poOrderItemId\` = p.\`poOrderItemId\` AND pp.\`id\` <> p.\`id\`) AS others
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
