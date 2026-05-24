// Production records — list, record-against-pending-PO-item, edit, delete.
import { Router } from 'express';
import { z } from 'zod';
import { q, qOne, insert, update, del } from '../lib/db.js';
import { AppError, asyncHandler } from '../lib/errors.js';
import { requireAuth, requirePermission } from '../lib/auth.js';
import { resolveTenant } from '../lib/tenant.js';

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
    pageSize: z.coerce.number().int().min(1).max(200).default(50),
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

/* GET /:id */
router.get('/:id', requirePermission('view_po'), asyncHandler(async (req, res) => {
  const row = await qOne(
    `${PROD_ROW_SQL} WHERE p.\`id\` = ? AND p.\`companyId\` = ?`,
    [req.params.id, req.tenant.companyId]
  );
  if (!row) throw new AppError('Production record not found', 404, 'NOT_FOUND');
  res.json(flatten(row));
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
  const remaining = Math.max(item.pcs - produced, 0);
  if (data.pcs > remaining) {
    throw new AppError(`Production pcs (${data.pcs}) exceeds remaining (${remaining}).`, 400, 'PCS_EXCEEDS');
  }
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

  if (data.pcs !== undefined) {
    const maxAllowed = row.item_pcs - Number(row.others ?? 0);
    if (data.pcs > maxAllowed) {
      throw new AppError(`New pcs (${data.pcs}) exceeds remaining capacity (${maxAllowed}) for this PO item.`, 400, 'PCS_EXCEEDS');
    }
  }
  if (data.prodDate !== undefined && new Date(data.prodDate) < new Date(row.po_orderDate)) {
    throw new AppError('Production date cannot be before order date', 400, 'BAD_DATE');
  }

  const patch = { ...data };
  if (patch.notes !== undefined) patch.notes = patch.notes ?? null;
  const updated = await update('Production', row.id, patch);
  res.json(updated);
}));

/* DELETE /:id */
router.delete('/:id', requirePermission('modify_prod_qty'), asyncHandler(async (req, res) => {
  const row = await qOne('SELECT `id` FROM `Production` WHERE `id` = ? AND `companyId` = ?',
    [req.params.id, req.tenant.companyId]);
  if (!row) throw new AppError('Production record not found', 404, 'NOT_FOUND');
  await del('Production', row.id);
  res.status(204).end();
}));

export default router;
