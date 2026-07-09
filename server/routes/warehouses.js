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
import { q, qOne, insert, update, del, txn } from '../lib/db.js';
import { AppError, asyncHandler } from '../lib/errors.js';
import { requireAuth, requirePermission, requireAnyPermission } from '../lib/auth.js';
import { resolveTenant } from '../lib/tenant.js';
import { specKeyOf, pickSpec } from '../lib/warehouse.js';

const router = Router();
router.use(requireAuth, resolveTenant);

const w3 = (n) => +Number(n || 0).toFixed(3);

/* ---------- Warehouses CRUD ---------- */
// Listing stores is also needed by the Production → Rejection screen.
router.get('/', requireAnyPermission('rec_production', 'dispatch'), asyncHandler(async (req, res) => {
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
  if (data.name !== undefined) {
    const dupe = await qOne('SELECT `id` FROM `Warehouse` WHERE `companyId` = ? AND `name` = ? AND `id` <> ?', [req.tenant.companyId, data.name, wh.id]);
    if (dupe) throw new AppError('A store with that name already exists', 409, 'DUPLICATE');
    patch.name = data.name;
  }
  if (data.isActive !== undefined) patch.isActive = data.isActive ? 1 : 0;
  if (data.notes !== undefined) patch.notes = data.notes ?? null;
  if (Object.keys(patch).length) await update('Warehouse', wh.id, patch);
  res.json({ ok: true });
}));

/* ---------- Delete a store (only when it has no stock movements) ---------- */
router.delete('/:id', requirePermission('dispatch'), asyncHandler(async (req, res) => {
  const wh = await qOne('SELECT `id` FROM `Warehouse` WHERE `id` = ? AND `companyId` = ?', [req.params.id, req.tenant.companyId]);
  if (!wh) throw new AppError('Store not found', 404, 'NOT_FOUND');
  const used = await qOne('SELECT COUNT(*) AS n FROM `StockMovement` WHERE `warehouseId` = ? AND `companyId` = ?', [wh.id, req.tenant.companyId]);
  if (Number(used?.n ?? 0) > 0) {
    throw new AppError('Cannot delete — this store has stock records. Only empty stores (no items) can be deleted.', 400, 'HAS_STOCK');
  }
  await del('Warehouse', wh.id);
  res.json({ ok: true });
}));

/* ---------- Stock on hand ---------- */
// Grouped by warehouse + physical spec. Spec columns are all in GROUP BY (they
// fully determine specKey) so this is safe under ONLY_FULL_GROUP_BY.
router.get('/stock', requirePermission('dispatch'), asyncHandler(async (req, res) => {
  const { warehouseId } = z.object({ warehouseId: z.string().optional() }).parse(req.query);
  const params = [req.tenant.companyId];
  // Rejected stock is set aside — never part of sellable on-hand.
  let where = 'sm.`companyId` = ? AND sm.`isRejection` = 0';
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

/* ---------- Spec catalog (for the opening-stock dropdowns) ---------- */
// Distinct grade / material / measure combos ever ordered, with their dims — so
// opening stock can be picked from real items and its weight auto-computed.
router.get('/specs', requirePermission('dispatch'), asyncHandler(async (req, res) => {
  const rows = await q(
    `SELECT it.\`coreType\`, it.\`grade\`, it.\`material\`, it.\`measure\`,
            it.\`id1\`, it.\`id2\`, it.\`od1\`, it.\`od2\`, it.\`ht\`, it.\`weightPerPc\`
       FROM \`PoOrderItem\` it
       INNER JOIN \`PoOrder\` po ON po.\`id\` = it.\`poOrderId\`
      WHERE po.\`companyId\` = ?`,
    [req.tenant.companyId]
  );
  const map = new Map();
  for (const r of rows) {
    const key = specKeyOf(r);
    if (!map.has(key)) {
      map.set(key, {
        coreType: r.coreType, grade: r.grade, material: r.material, measure: r.measure,
        id1: r.id1, id2: r.id2, od1: r.od1, od2: r.od2, ht: r.ht,
        weightPerPc: Number(r.weightPerPc) || 0,
      });
    }
  }
  res.json({ items: [...map.values()] });
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

/* ---------- Opening stock — a manual IN with a user-entered spec (no PO line) ---------- */
router.post('/opening-stock', requirePermission('dispatch'), asyncHandler(async (req, res) => {
  const data = z.object({
    warehouseId: z.string().min(1),
    coreType:    z.enum(['TOROIDAL', 'RECTANGULAR', 'NANO', 'COMPOSITE']).optional(),
    grade:       z.string().trim().min(1).max(80),
    material:    z.string().trim().min(1).max(120),
    measure:     z.string().trim().max(160).optional().nullable(),
    id1: z.coerce.number().optional().nullable(),
    id2: z.coerce.number().optional().nullable(),
    od1: z.coerce.number().optional().nullable(),
    od2: z.coerce.number().optional().nullable(),
    ht:  z.coerce.number().optional().nullable(),
    weightPerPc: z.coerce.number().nonnegative().optional(),
    pcs:         z.coerce.number().int().positive(),
    movementDate: z.coerce.date().optional(),
    notes:       z.string().trim().max(400).optional().nullable(),
  }).parse(req.body);

  const wh = await qOne('SELECT `id` FROM `Warehouse` WHERE `id` = ? AND `companyId` = ? AND `isActive` = 1', [data.warehouseId, req.tenant.companyId]);
  if (!wh) throw new AppError('Store not found or inactive', 404, 'NOT_FOUND');

  const spec = {
    coreType: data.coreType ?? 'TOROIDAL',
    grade: data.grade, material: data.material,
    measure: data.measure ?? null,
    id1: data.id1 ?? null, id2: data.id2 ?? null,
    od1: data.od1 ?? null, od2: data.od2 ?? null, ht: data.ht ?? null,
  };
  const weightPerPc = Number(data.weightPerPc) || 0;
  const created = await insert('StockMovement', {
    companyId: req.tenant.companyId,
    warehouseId: data.warehouseId,
    direction: 'IN',
    poOrderItemId: null,
    dispatchId: null,
    specKey: specKeyOf(spec),
    ...spec,
    weightPerPc,
    pcs: data.pcs,
    totalWeight: w3(data.pcs * weightPerPc),
    movementDate: data.movementDate ?? new Date(),
    notes: data.notes ?? 'Opening stock',
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
       FROM \`StockMovement\` WHERE \`companyId\` = ? AND \`warehouseId\` = ? AND \`specKey\` = ? AND \`isRejection\` = 0`,
    [req.tenant.companyId, data.warehouseId, data.specKey]
  );
  const onHand = Number(onHandRow?.onHand ?? 0);
  if (data.pcs > onHand) throw new AppError(`Pcs (${data.pcs}) exceeds stock on hand (${onHand}).`, 400, 'PCS_EXCEEDS');

  // Authoritative spec snapshot from an IN movement of this spec.
  const src = await qOne(
    `SELECT * FROM \`StockMovement\`
      WHERE \`companyId\` = ? AND \`warehouseId\` = ? AND \`specKey\` = ? AND \`direction\` = 'IN' AND \`isRejection\` = 0
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

/* ---------- Rejection — move produced pcs into a store, set aside as rejected ----------
   A rejection is an IN flagged isRejection: it leaves the production floor (so it
   drops out of the dispatch-ready list) but is NOT sellable stock, so it never
   appears in stock-out. Available basis = produced − dispatched − all stock-INs. */
const REJ_PERM = ['rec_production', 'dispatch'];

router.get('/rejectable', requireAnyPermission(...REJ_PERM), asyncHandler(async (req, res) => {
  const { search } = z.object({ search: z.string().trim().max(120).optional() }).parse(req.query);
  let where = "po.`companyId` = ? AND it.`status` = 'ACTIVE'";
  const params = [req.tenant.companyId];
  if (search) {
    const like = `%${search}%`;
    where += ' AND (po.`poNumber` LIKE ? OR c.`name` LIKE ? OR it.`grade` LIKE ? OR it.`material` LIKE ? OR it.`measure` LIKE ?)';
    params.push(like, like, like, like, like);
  }
  const rows = await q(
    `SELECT it.*, po.\`poNumber\` AS po_number, c.\`name\` AS customer_name, c.\`customerCode\` AS customer_code,
            (SELECT COALESCE(SUM(pp.\`pcs\`),0) FROM \`Production\` pp WHERE pp.\`poOrderItemId\` = it.\`id\`) AS produced,
            (SELECT COALESCE(SUM(dd.\`pcs\`),0) FROM \`Dispatch\` dd WHERE dd.\`poOrderItemId\` = it.\`id\`) AS dispatched,
            (SELECT COALESCE(SUM(sm.\`pcs\`),0) FROM \`StockMovement\` sm WHERE sm.\`poOrderItemId\` = it.\`id\` AND sm.\`direction\` = 'IN') AS stockedIn
       FROM \`PoOrderItem\` it
       INNER JOIN \`PoOrder\` po ON po.\`id\` = it.\`poOrderId\`
       INNER JOIN \`Customer\` c ON c.\`id\` = po.\`customerId\`
      WHERE ${where}
      ORDER BY it.\`createdAt\` DESC`,
    params
  );
  const items = rows.map((it) => ({
    id: it.id, poNumber: it.po_number, customerName: it.customer_name, customerCode: it.customer_code,
    coreType: it.coreType, grade: it.grade, material: it.material, measure: it.measure,
    weightPerPc: Number(it.weightPerPc) || 0,
    availablePcs: Math.max(Number(it.produced || 0) - Number(it.dispatched || 0) - Number(it.stockedIn || 0), 0),
  })).filter((x) => x.availablePcs > 0);
  res.json({ items });
}));

router.post('/reject', requireAnyPermission(...REJ_PERM), asyncHandler(async (req, res) => {
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

  const available = Math.max(Number(item.produced || 0) - Number(item.dispatched || 0) - Number(item.stockedIn || 0), 0);
  if (data.pcs > available) throw new AppError(`Pcs to reject (${data.pcs}) exceeds available produced pcs (${available}).`, 400, 'PCS_EXCEEDS');

  const spec = pickSpec(item);
  const weightPerPc = Number(item.weightPerPc) || 0;
  const created = await insert('StockMovement', {
    companyId: req.tenant.companyId, warehouseId: data.warehouseId,
    direction: 'IN', isRejection: 1,
    poOrderItemId: data.poOrderItemId, dispatchId: null,
    specKey: specKeyOf(item), ...spec, weightPerPc,
    pcs: data.pcs, totalWeight: w3(data.pcs * weightPerPc),
    movementDate: data.movementDate ?? new Date(),
    notes: (data.notes && data.notes.trim()) ? data.notes.trim() : 'Rejection',
    createdById: req.auth.userId,
  });
  res.status(201).json({ id: created.id, rejected: data.pcs });
}));

router.get('/rejections', requireAnyPermission(...REJ_PERM), asyncHandler(async (req, res) => {
  const rows = await q(
    `SELECT sm.\`id\`, sm.\`pcs\`, sm.\`movementDate\`, sm.\`notes\`, sm.\`totalWeight\`,
            sm.\`coreType\`, sm.\`grade\`, sm.\`material\`, sm.\`measure\`,
            w.\`name\` AS warehouseName, po.\`poNumber\` AS poNumber, c.\`name\` AS customerName
       FROM \`StockMovement\` sm
       INNER JOIN \`Warehouse\` w ON w.\`id\` = sm.\`warehouseId\`
       LEFT JOIN \`PoOrderItem\` it ON it.\`id\` = sm.\`poOrderItemId\`
       LEFT JOIN \`PoOrder\` po ON po.\`id\` = it.\`poOrderId\`
       LEFT JOIN \`Customer\` c ON c.\`id\` = po.\`customerId\`
      WHERE sm.\`companyId\` = ? AND sm.\`isRejection\` = 1
      ORDER BY sm.\`movementDate\` DESC, sm.\`createdAt\` DESC LIMIT 200`,
    [req.tenant.companyId]
  );
  res.json({ items: rows.map((r) => ({
    id: r.id, pcs: Number(r.pcs) || 0, movementDate: r.movementDate, notes: r.notes,
    totalWeight: Number(r.totalWeight) || 0, warehouseName: r.warehouseName,
    coreType: r.coreType, grade: r.grade, material: r.material, measure: r.measure,
    poNumber: r.poNumber ?? null, customerName: r.customerName ?? null,
  })) });
}));

// Modify a rejection — change pcs, store, note or date.
router.patch('/rejections/:id', requireAnyPermission(...REJ_PERM), asyncHandler(async (req, res) => {
  const data = z.object({
    warehouseId:  z.string().min(1).optional(),
    pcs:          z.coerce.number().int().positive().optional(),
    movementDate: z.coerce.date().optional(),
    notes:        z.string().trim().max(400).optional().nullable(),
  }).parse(req.body);
  const row = await qOne("SELECT * FROM `StockMovement` WHERE `id` = ? AND `companyId` = ? AND `isRejection` = 1", [req.params.id, req.tenant.companyId]);
  if (!row) throw new AppError('Rejection not found', 404, 'NOT_FOUND');

  const patch = {};
  if (data.warehouseId && data.warehouseId !== row.warehouseId) {
    const wh = await qOne('SELECT `id` FROM `Warehouse` WHERE `id` = ? AND `companyId` = ? AND `isActive` = 1', [data.warehouseId, req.tenant.companyId]);
    if (!wh) throw new AppError('Store not found or inactive', 404, 'NOT_FOUND');
    patch.warehouseId = data.warehouseId;
  }
  if (data.pcs !== undefined && data.pcs !== row.pcs) {
    if (row.poOrderItemId) {
      // Available EXCLUDING this rejection's own pcs (they're being re-set).
      const item = await qOne(
        `SELECT (SELECT COALESCE(SUM(pp.\`pcs\`),0) FROM \`Production\` pp WHERE pp.\`poOrderItemId\` = ?) AS produced,
                (SELECT COALESCE(SUM(dd.\`pcs\`),0) FROM \`Dispatch\` dd WHERE dd.\`poOrderItemId\` = ?) AS dispatched,
                (SELECT COALESCE(SUM(sm.\`pcs\`),0) FROM \`StockMovement\` sm WHERE sm.\`poOrderItemId\` = ? AND sm.\`direction\` = 'IN' AND sm.\`id\` <> ?) AS otherIn`,
        [row.poOrderItemId, row.poOrderItemId, row.poOrderItemId, row.id]
      );
      const available = Math.max(Number(item?.produced || 0) - Number(item?.dispatched || 0) - Number(item?.otherIn || 0), 0);
      if (data.pcs > available) throw new AppError(`Pcs (${data.pcs}) exceeds available produced pcs (${available}).`, 400, 'PCS_EXCEEDS');
    }
    patch.pcs = data.pcs;
    patch.totalWeight = w3(data.pcs * (Number(row.weightPerPc) || 0));
  }
  if (data.movementDate !== undefined) patch.movementDate = data.movementDate;
  if (data.notes !== undefined) patch.notes = (data.notes && data.notes.trim()) ? data.notes.trim() : 'Rejection';
  if (Object.keys(patch).length) await update('StockMovement', row.id, patch);
  res.json({ ok: true });
}));

// Undo a rejection — returns those pcs to the production floor.
router.delete('/rejections/:id', requireAnyPermission(...REJ_PERM), asyncHandler(async (req, res) => {
  const row = await qOne("SELECT `id` FROM `StockMovement` WHERE `id` = ? AND `companyId` = ? AND `isRejection` = 1", [req.params.id, req.tenant.companyId]);
  if (!row) throw new AppError('Rejection not found', 404, 'NOT_FOUND');
  await del('StockMovement', row.id);
  res.json({ ok: true });
}));

export default router;
