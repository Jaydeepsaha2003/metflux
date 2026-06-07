// Work Allotment slips — assigned labour for pending PO items.
// Records are auto-deleted after 7 days via lazy cleanup on every list call.
import { Router } from 'express';
import { z } from 'zod';
import { q, qOne, insert, del, txn } from '../lib/db.js';
import { AppError, asyncHandler } from '../lib/errors.js';
import { requireAuth, requirePermission } from '../lib/auth.js';
import { resolveTenant } from '../lib/tenant.js';

const router = Router();
router.use(requireAuth, resolveTenant);

const RETENTION_DAYS = 7;

const itemSchema = z.object({
  poOrderItemId: z.string().min(1),
  pcs:           z.coerce.number().int().positive(),
  labourId:      z.string().min(1).optional().nullable(),
});

const createSchema = z.object({
  waNumber: z.string().trim().min(1).max(60),
  waDate:   z.coerce.date(),
  remarks:  z.string().trim().max(300).optional().nullable(),
  items:    z.array(itemSchema).min(1),
});

const flattenItem = (it) => ({
  id:           it.id,
  poOrderItemId: it.poOrderItemId,
  poNumber:     it.po_number ?? null,
  orderDate:    it.po_orderDate ?? null,
  customerCode: it.customer_code ?? null,
  coreType:     it.item_coreType ?? null,
  grade:        it.item_grade ?? null,
  material:     it.item_material ?? null,
  measure:      it.item_measure ?? null,
  flux:         it.item_flux ?? null,
  turns:        it.item_turns ?? null,
  testVoltage:  it.item_testVoltage ?? null,
  testCurrent:  it.item_testCurrent ?? null,
  pcs:          it.pcs,
  labourId:     it.labourId,
  labourName:   it.labour_name ?? null,
});

const loadItemsForWas = async (waIds) => {
  if (waIds.length === 0) return new Map();
  const placeholders = waIds.map(() => '?').join(',');
  const rows = await q(
    `SELECT wai.*,
            it.\`coreType\`    AS item_coreType,
            it.\`grade\`       AS item_grade,
            it.\`material\`    AS item_material,
            it.\`measure\`     AS item_measure,
            it.\`flux\`        AS item_flux,
            it.\`turns\`       AS item_turns,
            it.\`testVoltage\` AS item_testVoltage,
            it.\`testCurrent\` AS item_testCurrent,
            po.\`poNumber\`      AS po_number,
            po.\`orderDate\`     AS po_orderDate,
            c.\`customerCode\`   AS customer_code,
            l.\`name\`           AS labour_name
       FROM \`WorkAllotmentItem\` wai
       INNER JOIN \`PoOrderItem\` it ON it.\`id\` = wai.\`poOrderItemId\`
       INNER JOIN \`PoOrder\`     po ON po.\`id\` = it.\`poOrderId\`
       INNER JOIN \`Customer\`    c  ON c.\`id\`  = po.\`customerId\`
       LEFT  JOIN \`Labour\`     l  ON l.\`id\`  = wai.\`labourId\`
       WHERE wai.\`workAllotmentId\` IN (${placeholders})`,
    waIds
  );
  const by = new Map();
  for (const r of rows) {
    if (!by.has(r.workAllotmentId)) by.set(r.workAllotmentId, []);
    by.get(r.workAllotmentId).push(r);
  }
  return by;
};

const flattenWa = (wa, itemRows = []) => ({
  id:        wa.id,
  waNumber:  wa.waNumber,
  waDate:    wa.waDate,
  remarks:   wa.remarks,
  createdAt: wa.createdAt,
  updatedAt: wa.updatedAt,
  itemCount: itemRows.length,
  totalPcs:  itemRows.reduce((s, i) => s + (i.pcs ?? 0), 0),
  items:     itemRows.map(flattenItem),
});

const cleanupExpired = async (companyId) => {
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
  await q('DELETE FROM `WorkAllotment` WHERE `companyId` = ? AND `createdAt` < ?',
    [companyId, cutoff]);
};

/* /pending — PO items still awaiting production */
router.get('/pending', requirePermission('assign_work'), asyncHandler(async (req, res) => {
  const { search } = z.object({ search: z.string().trim().max(120).optional() }).parse(req.query);

  let where = 'po.`companyId` = ? AND it.`status` = ?';
  const params = [req.tenant.companyId, 'ACTIVE'];
  if (search) {
    const like = `%${search}%`;
    where += ' AND (po.`poNumber` LIKE ? OR c.`name` LIKE ? OR it.`grade` LIKE ? OR it.`material` LIKE ? OR it.`measure` LIKE ?)';
    params.push(like, like, like, like, like);
  }

  const rows = await q(
    `SELECT it.*,
            po.\`poNumber\`    AS po_number,
            po.\`orderDate\`   AS po_orderDate,
            c.\`customerCode\` AS customer_code,
            (SELECT COALESCE(SUM(pp.\`pcs\`),0) FROM \`Production\` pp WHERE pp.\`poOrderItemId\` = it.\`id\`) AS produced
       FROM \`PoOrderItem\` it
       INNER JOIN \`PoOrder\`  po ON po.\`id\` = it.\`poOrderId\`
       INNER JOIN \`Customer\` c  ON c.\`id\`  = po.\`customerId\`
       WHERE ${where}
       ORDER BY it.\`createdAt\` DESC`,
    params
  );

  const pending = rows.map((it) => {
    const produced  = Number(it.produced ?? 0);
    const remaining = Math.max(it.pcs - produced, 0);
    return {
      id:           it.id,
      poNumber:     it.po_number,
      customerCode: it.customer_code,
      orderDate:    it.po_orderDate,
      coreType:     it.coreType, grade: it.grade, material: it.material, measure: it.measure,
      flux:         it.flux, turns: it.turns,
      testVoltage:  it.testVoltage, testCurrent: it.testCurrent,
      orderedPcs:   it.pcs,
      producedPcs:  produced,
      remainingPcs: remaining,
    };
  }).filter((x) => x.remainingPcs > 0);

  res.json({ items: pending });
}));

/* GET / */
router.get('/', requirePermission('assign_work'), asyncHandler(async (req, res) => {
  await cleanupExpired(req.tenant.companyId);
  const { search } = z.object({ search: z.string().trim().max(120).optional() }).parse(req.query);

  let where = 'wa.`companyId` = ?';
  const params = [req.tenant.companyId];
  if (search) {
    const like = `%${search}%`;
    where += ` AND (
      wa.\`waNumber\` LIKE ?
      OR EXISTS (
        SELECT 1 FROM \`WorkAllotmentItem\` wai
        INNER JOIN \`PoOrderItem\` it ON it.\`id\` = wai.\`poOrderItemId\`
        INNER JOIN \`PoOrder\` po ON po.\`id\` = it.\`poOrderId\`
        INNER JOIN \`Customer\` c ON c.\`id\` = po.\`customerId\`
        LEFT  JOIN \`Labour\`   l ON l.\`id\` = wai.\`labourId\`
        WHERE wai.\`workAllotmentId\` = wa.\`id\`
          AND (po.\`poNumber\` LIKE ? OR c.\`name\` LIKE ? OR it.\`measure\` LIKE ? OR l.\`name\` LIKE ?)
      )
    )`;
    params.push(like, like, like, like, like);
  }

  const was = await q(
    `SELECT * FROM \`WorkAllotment\` wa WHERE ${where} ORDER BY wa.\`createdAt\` DESC`,
    params
  );
  const byWa = await loadItemsForWas(was.map((w) => w.id));
  res.json({ items: was.map((w) => flattenWa(w, byWa.get(w.id) ?? [])) });
}));

/* GET /:id */
router.get('/:id', requirePermission('assign_work'), asyncHandler(async (req, res) => {
  const wa = await qOne(
    'SELECT * FROM `WorkAllotment` WHERE `id` = ? AND `companyId` = ?',
    [req.params.id, req.tenant.companyId]
  );
  if (!wa) throw new AppError('Work allotment not found', 404, 'NOT_FOUND');
  const byWa = await loadItemsForWas([wa.id]);
  res.json(flattenWa(wa, byWa.get(wa.id) ?? []));
}));

/* POST / */
router.post('/', requirePermission('assign_work'), asyncHandler(async (req, res) => {
  const data = createSchema.parse(req.body);

  const itemIds = data.items.map((i) => i.poOrderItemId);
  const placeholders = itemIds.map(() => '?').join(',');
  const poItems = await q(
    `SELECT it.*,
            (SELECT COALESCE(SUM(pp.\`pcs\`),0) FROM \`Production\` pp WHERE pp.\`poOrderItemId\` = it.\`id\`) AS produced
       FROM \`PoOrderItem\` it
       INNER JOIN \`PoOrder\` po ON po.\`id\` = it.\`poOrderId\`
       WHERE it.\`id\` IN (${placeholders}) AND po.\`companyId\` = ?`,
    [...itemIds, req.tenant.companyId]
  );
  if (poItems.length !== itemIds.length) {
    throw new AppError('One or more PO items not found', 404, 'NOT_FOUND');
  }

  for (const inputItem of data.items) {
    const po = poItems.find((p) => p.id === inputItem.poOrderItemId);
    if (po.status === 'CANCELLED') throw new AppError('PO item is cancelled', 400, 'ITEM_CANCELLED');
    const remaining = Math.max(po.pcs - Number(po.produced ?? 0), 0);
    if (inputItem.pcs > remaining) {
      throw new AppError(
        `Allotted pcs (${inputItem.pcs}) exceeds remaining (${remaining}) for one of the items.`,
        400, 'PCS_EXCEEDS'
      );
    }
  }

  // Validate any provided labourId belongs to this company.
  const labourIds = [...new Set(data.items.map((i) => i.labourId).filter(Boolean))];
  if (labourIds.length > 0) {
    const lph = labourIds.map(() => '?').join(',');
    const found = await q(
      `SELECT DISTINCT l.\`id\` FROM \`Labour\` l
        INNER JOIN \`LabourMembership\` lm ON lm.\`labourId\` = l.\`id\`
        WHERE l.\`id\` IN (${lph}) AND lm.\`companyId\` = ?`,
      [...labourIds, req.tenant.companyId]
    );
    if (found.length !== labourIds.length) {
      throw new AppError('One or more workers not assigned to this company', 400, 'BAD_LABOUR');
    }
  }

  const waId = await txn(async (tx) => {
    const wa = await tx.insert('WorkAllotment', {
      waNumber:    data.waNumber,
      waDate:      data.waDate,
      remarks:     data.remarks ?? null,
      companyId:   req.tenant.companyId,
      createdById: req.auth.userId,
    });
    for (const i of data.items) {
      await tx.insert('WorkAllotmentItem', {
        workAllotmentId: wa.id,
        poOrderItemId:   i.poOrderItemId,
        pcs:             i.pcs,
        labourId:        i.labourId ?? null,
      });
    }
    return wa.id;
  });

  const wa = await qOne('SELECT * FROM `WorkAllotment` WHERE `id` = ?', [waId]);
  const byWa = await loadItemsForWas([waId]);
  res.status(201).json(flattenWa(wa, byWa.get(waId) ?? []));
}));

/* DELETE /:id */
router.delete('/:id', requirePermission('assign_work'), asyncHandler(async (req, res) => {
  const wa = await qOne(
    'SELECT `id` FROM `WorkAllotment` WHERE `id` = ? AND `companyId` = ?',
    [req.params.id, req.tenant.companyId]
  );
  if (!wa) throw new AppError('Work allotment not found', 404, 'NOT_FOUND');
  await del('WorkAllotment', wa.id);
  res.status(204).end();
}));

export default router;
