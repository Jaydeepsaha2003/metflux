// Store / Warehouse — named stores plus a generic finished-goods stock ledger.
//
//   GET    /warehouses                 list stores
//   POST   /warehouses                 create a store
//   PATCH  /warehouses/:id             rename / activate-deactivate
//   GET    /warehouses/stock           stock on hand (Σ IN − Σ OUT) per store + spec
//   GET    /warehouses/so-lines        open SO lines to stock-out against (by spec)
//   POST   /warehouses/stock-in        send overproduced pcs from a PO line into a store
//   POST   /warehouses/stock-out       dispatch stock to a customer SO line (normal sale)
import { Router } from 'express';
import { z } from 'zod';
import { q, qOne, insert, update, txn } from '../lib/db.js';
import { AppError, asyncHandler } from '../lib/errors.js';
import { requireAuth, requirePermission } from '../lib/auth.js';
import { resolveTenant } from '../lib/tenant.js';
import { specKeyOf, pickSpec } from '../lib/warehouse.js';

const router = Router();
router.use(requireAuth, resolveTenant);

const w3 = (n) => +Number(n || 0).toFixed(3);

/* ---------- Warehouses CRUD ---------- */
router.get('/', requirePermission('dispatch'), asyncHandler(async (req, res) => {
  const rows = await q(
    'SELECT `id`, `name`, `isActive`, `notes` FROM `Warehouse` WHERE `companyId` = ? ORDER BY `isActive` DESC, `name` ASC',
    [req.tenant.companyId]
  );
  res.json({ items: rows.map((r) => ({ id: r.id, name: r.name, isActive: !!r.isActive, notes: r.notes ?? null })) });
}));

router.post('/', requirePermission('dispatch'), asyncHandler(async (req, res) => {
  const data = z.object({ name: z.string().trim().min(1).max(120), notes: z.string().trim().max(400).optional().nullable() }).parse(req.body);
  const dupe = await qOne('SELECT `id` FROM `Warehouse` WHERE `companyId` = ? AND `name` = ?', [req.tenant.companyId, data.name]);
  if (dupe) throw new AppError('A store with that name already exists', 409, 'DUPLICATE');
  const created = await insert('Warehouse', {
    companyId: req.tenant.companyId, name: data.name, notes: data.notes ?? null,
    isActive: 1, createdById: req.auth.userId,
  });
  res.status(201).json({ id: created.id, name: created.name, isActive: true, notes: created.notes ?? null });
}));

router.patch('/:id', requirePermission('dispatch'), asyncHandler(async (req, res) => {
  const data = z.object({
    name: z.string().trim().min(1).max(120).optional(),
    isActive: z.boolean().optional(),
    notes: z.string().trim().max(400).optional().nullable(),
  }).parse(req.body);
  const wh = await qOne('SELECT `id` FROM `Warehouse` WHERE `id` = ? AND `companyId` = ?', [req.params.id, req.tenant.companyId]);
  if (!wh) throw new AppError('Store not found', 404, 'NOT_FOUND');
  const patch = {};
  if (data.name !== undefined) patch.name = data.name;
  if (data.isActive !== undefined) patch.isActive = data.isActive ? 1 : 0;
  if (data.notes !== undefined) patch.notes = data.notes ?? null;
  if (Object.keys(patch).length) await update('Warehouse', wh.id, patch);
  res.json({ ok: true });
}));

/* ---------- Stock on hand ---------- */
// Grouped by warehouse + physical spec. Spec columns are all in GROUP BY (they
// fully determine specKey) so this is safe under ONLY_FULL_GROUP_BY.
router.get('/stock', requirePermission('dispatch'), asyncHandler(async (req, res) => {
  const { warehouseId } = z.object({ warehouseId: z.string().optional() }).parse(req.query);
  const params = [req.tenant.companyId];
  let where = 'sm.`companyId` = ?';
  if (warehouseId) { where += ' AND sm.`warehouseId` = ?'; params.push(warehouseId); }

  const rows = await q(
    `SELECT sm.\`warehouseId\` AS warehouseId, w.\`name\` AS warehouseName, sm.\`specKey\` AS specKey,
            sm.\`coreType\` AS coreType, sm.\`grade\` AS grade, sm.\`material\` AS material, sm.\`measure\` AS measure,
            sm.\`id1\` AS id1, sm.\`id2\` AS id2, sm.\`od1\` AS od1, sm.\`od2\` AS od2, sm.\`ht\` AS ht,
            MAX(sm.\`weightPerPc\`) AS weightPerPc,
            COALESCE(SUM(CASE WHEN sm.\`direction\` = 'IN' THEN sm.\`pcs\` ELSE -sm.\`pcs\` END), 0) AS onHand
       FROM \`StockMovement\` sm
       INNER JOIN \`Warehouse\` w ON w.\`id\` = sm.\`warehouseId\`
      WHERE ${where}
      GROUP BY sm.\`warehouseId\`, w.\`name\`, sm.\`specKey\`,
               sm.\`coreType\`, sm.\`grade\`, sm.\`material\`, sm.\`measure\`,
               sm.\`id1\`, sm.\`id2\`, sm.\`od1\`, sm.\`od2\`, sm.\`ht\`
      HAVING onHand > 0
      ORDER BY w.\`name\` ASC, sm.\`coreType\` ASC, sm.\`grade\` ASC, sm.\`measure\` ASC`,
    params
  );
  res.json({
    items: rows.map((r) => ({
      warehouseId: r.warehouseId, warehouseName: r.warehouseName, specKey: r.specKey,
      coreType: r.coreType, grade: r.grade, material: r.material, measure: r.measure,
      id1: r.id1, id2: r.id2, od1: r.od1, od2: r.od2, ht: r.ht,
      weightPerPc: Number(r.weightPerPc) || 0,
      onHand: Number(r.onHand) || 0,
      onHandWeight: w3((Number(r.onHand) || 0) * (Number(r.weightPerPc) || 0)),
    })),
  });
}));

/* ---------- Candidate SO lines for a stock-out ---------- */
// Active PO items, optionally filtered to those matching a stock spec, with how
// much is still undispatched — the order(s) you can fulfil from stock.
router.get('/so-lines', requirePermission('dispatch'), asyncHandler(async (req, res) => {
  const { specKey } = z.object({ specKey: z.string().optional() }).parse(req.query);
  const rows = await q(
    `SELECT it.*, po.\`poNumber\` AS po_number, po.\`orderDate\` AS po_orderDate,
            c.\`name\` AS customer_name, c.\`customerCode\` AS customer_code,
            (SELECT COALESCE(SUM(dd.\`pcs\`),0) FROM \`Dispatch\` dd WHERE dd.\`poOrderItemId\` = it.\`id\`) AS dispatched
       FROM \`PoOrderItem\` it
       INNER JOIN \`PoOrder\` po ON po.\`id\` = it.\`poOrderId\`
       INNER JOIN \`Customer\` c ON c.\`id\` = po.\`customerId\`
      WHERE po.\`companyId\` = ? AND it.\`status\` = 'ACTIVE'
      ORDER BY po.\`orderDate\` ASC`,
    [req.tenant.companyId]
  );
  const items = rows
    .map((it) => ({
      id: it.id,
      poNumber: it.po_number,
      orderDate: it.po_orderDate,
      customerName: it.customer_name,
      customerCode: it.customer_code,
      coreType: it.coreType, grade: it.grade, material: it.material, measure: it.measure,
      id1: it.id1, id2: it.id2, od1: it.od1, od2: it.od2, ht: it.ht,
      weightPerPc: Number(it.weightPerPc) || 0,
      orderedPcs: Number(it.pcs) || 0,
      dispatchedPcs: Number(it.dispatched) || 0,
      remainingPcs: Math.max((Number(it.pcs) || 0) - (Number(it.dispatched) || 0), 0),
      specKey: specKeyOf(it),
    }))
    .filter((x) => (specKey ? x.specKey === specKey : true));
  res.json({ items });
}));

/* ---------- Stock IN — send overproduced pcs from a PO line into a store ---------- */
router.post('/stock-in', requirePermission('dispatch'), asyncHandler(async (req, res) => {
  const data = z.object({
    warehouseId:   z.string().min(1),
    poOrderItemId: z.string().min(1),
    pcs:           z.coerce.number().int().positive(),
    movementDate:  z.coerce.date().optional(),
    notes:         z.string().trim().max(400).optional().nullable(),
  }).parse(req.body);

  const wh = await qOne('SELECT `id` FROM `Warehouse` WHERE `id` = ? AND `companyId` = ? AND `isActive` = 1', [data.warehouseId, req.tenant.companyId]);
  if (!wh) throw new AppError('Store not found or inactive', 404, 'NOT_FOUND');

  const item = await qOne(
    `SELECT it.*,
            (SELECT COALESCE(SUM(pp.\`pcs\`),0) FROM \`Production\` pp WHERE pp.\`poOrderItemId\` = it.\`id\`) AS produced,
            (SELECT COALESCE(SUM(dd.\`pcs\`),0) FROM \`Dispatch\`   dd WHERE dd.\`poOrderItemId\` = it.\`id\`) AS dispatched,
            (SELECT COALESCE(SUM(sm.\`pcs\`),0) FROM \`StockMovement\` sm WHERE sm.\`poOrderItemId\` = it.\`id\` AND sm.\`direction\` = 'IN') AS stockedIn
       FROM \`PoOrderItem\` it
       INNER JOIN \`PoOrder\` po ON po.\`id\` = it.\`poOrderId\`
      WHERE it.\`id\` = ? AND po.\`companyId\` = ?`,
    [data.poOrderItemId, req.tenant.companyId]
  );
  if (!item) throw new AppError('PO item not found', 404, 'NOT_FOUND');
  if (item.status === 'CANCELLED') throw new AppError('PO item is cancelled', 400, 'ITEM_CANCELLED');

  const available = Math.max(Number(item.produced ?? 0) - Number(item.dispatched ?? 0) - Number(item.stockedIn ?? 0), 0);
  if (data.pcs > available) {
    throw new AppError(`Pcs to store (${data.pcs}) exceeds available produced pcs (${available}).`, 400, 'PCS_EXCEEDS');
  }

  const spec = pickSpec(item);
  const weightPerPc = Number(item.weightPerPc) || 0;
  const created = await insert('StockMovement', {
    companyId: req.tenant.companyId,
    warehouseId: data.warehouseId,
    direction: 'IN',
    poOrderItemId: data.poOrderItemId,
    dispatchId: null,
    specKey: specKeyOf(item),
    ...spec,
    weightPerPc,
    pcs: data.pcs,
    totalWeight: w3(data.pcs * weightPerPc),
    movementDate: data.movementDate ?? new Date(),
    notes: data.notes ?? null,
    createdById: req.auth.userId,
  });
  res.status(201).json({ id: created.id, stored: data.pcs });
}));

/* ---------- Stock OUT — dispatch stock to a customer SO line (normal sale) ---------- */
router.post('/stock-out', requirePermission('dispatch'), asyncHandler(async (req, res) => {
  const data = z.object({
    warehouseId:   z.string().min(1),
    specKey:       z.string().min(1),
    poOrderItemId: z.string().min(1),   // target SO line to fulfil
    pcs:           z.coerce.number().int().positive(),
    dispatchDate:  z.coerce.date(),
    vehicleNo:     z.string().trim().max(80).optional().nullable(),
    actualWeight:  z.coerce.number().nonnegative().optional().nullable(),
    notes:         z.string().trim().max(400).optional().nullable(),
  }).parse(req.body);

  // Target SO line must belong to this company and be active.
  const target = await qOne(
    `SELECT it.\`id\`, it.\`status\` FROM \`PoOrderItem\` it
       INNER JOIN \`PoOrder\` po ON po.\`id\` = it.\`poOrderId\`
      WHERE it.\`id\` = ? AND po.\`companyId\` = ?`,
    [data.poOrderItemId, req.tenant.companyId]
  );
  if (!target) throw new AppError('Target SO line not found', 404, 'NOT_FOUND');
  if (target.status === 'CANCELLED') throw new AppError('Target SO line is cancelled', 400, 'ITEM_CANCELLED');

  // Stock on hand for this store + spec.
  const onHandRow = await qOne(
    `SELECT COALESCE(SUM(CASE WHEN \`direction\` = 'IN' THEN \`pcs\` ELSE -\`pcs\` END), 0) AS onHand
       FROM \`StockMovement\` WHERE \`companyId\` = ? AND \`warehouseId\` = ? AND \`specKey\` = ?`,
    [req.tenant.companyId, data.warehouseId, data.specKey]
  );
  const onHand = Number(onHandRow?.onHand ?? 0);
  if (data.pcs > onHand) throw new AppError(`Pcs (${data.pcs}) exceeds stock on hand (${onHand}).`, 400, 'PCS_EXCEEDS');

  // Authoritative spec snapshot from an IN movement of this spec.
  const src = await qOne(
    `SELECT * FROM \`StockMovement\`
      WHERE \`companyId\` = ? AND \`warehouseId\` = ? AND \`specKey\` = ? AND \`direction\` = 'IN'
      ORDER BY \`createdAt\` DESC LIMIT 1`,
    [req.tenant.companyId, data.warehouseId, data.specKey]
  );
  if (!src) throw new AppError('No stock found for that spec', 404, 'NOT_FOUND');
  const spec = pickSpec(src);
  const weightPerPc = Number(src.weightPerPc) || 0;
  const totalWeight = w3(data.pcs * weightPerPc);

  const result = await txn(async (tx) => {
    // A warehouse-sourced dispatch — still tied to the customer's SO line, so it
    // flows into packing & sales invoices exactly like a production dispatch.
    const dispatch = await tx.insert('Dispatch', {
      poOrderItemId: data.poOrderItemId,
      dispatchDate: data.dispatchDate,
      pcs: data.pcs,
      weightPerPc,
      totalWeight,
      actualWeight: data.actualWeight ?? null,
      vehicleNo: data.vehicleNo ?? null,
      notes: data.notes ?? null,
      sourceType: 'WAREHOUSE',
      warehouseId: data.warehouseId,
      companyId: req.tenant.companyId,
      createdById: req.auth.userId,
    });
    await tx.insert('StockMovement', {
      companyId: req.tenant.companyId,
      warehouseId: data.warehouseId,
      direction: 'OUT',
      poOrderItemId: data.poOrderItemId,
      dispatchId: dispatch.id,
      specKey: data.specKey,
      ...spec,
      weightPerPc,
      pcs: data.pcs,
      totalWeight,
      movementDate: data.dispatchDate,
      vehicleNo: data.vehicleNo ?? null,
      notes: data.notes ?? null,
      createdById: req.auth.userId,
    });
    return dispatch.id;
  });

  res.status(201).json({ dispatchId: result, dispatched: data.pcs });
}));

export default router;
