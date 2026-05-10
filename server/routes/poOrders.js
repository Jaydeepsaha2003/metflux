// Purchase Order entry, listing, and detail. Ported from .NET New_PO_Order.
// Header (PoOrder) + many lines (PoOrderItem) saved in one transaction.
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/db.js';
import { AppError, asyncHandler } from '../lib/errors.js';
import { requireAuth, requirePermission } from '../lib/auth.js';
import { resolveTenant, tenantWhere } from '../lib/tenant.js';

const router = Router();
router.use(requireAuth, resolveTenant);

const itemSchema = z.object({
  coreType: z.enum(['TOROIDAL', 'RECTANGULAR']),
  grade: z.string().trim().min(1).max(80),
  material: z.string().trim().min(1).max(120),
  measure: z.string().trim().min(1).max(160),
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
  // Toroidal flux-test calibration — optional; only sent for toroidal items.
  turns:       z.coerce.number().int().positive().optional().nullable(),
  flux:        z.coerce.number().positive().optional().nullable(),
  ateCm:       z.coerce.number().nonnegative().optional().nullable(),
  testVoltage: z.coerce.number().nonnegative().optional().nullable(),
  testCurrent: z.coerce.number().nonnegative().optional().nullable(),
  // Pricing — only rateBasis + rateValue are user-entered. Server derives
  // ratePerKg / ratePerPc / totalAmount so the two views are always consistent.
  rateBasis: z.enum(['PER_KG', 'PER_PCS']).optional().nullable(),
  rateValue: z.coerce.number().nonnegative().optional().nullable(),
});

// Returns the three derived rate values from a (basis, value, weightPerPc, pcs,
// totalWeight) tuple. Skips division-by-zero when weightPerPc is 0.
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

/* ---------- POST /api/po-orders — create ---------- */
router.post('/', requirePermission('add_po'), asyncHandler(async (req, res) => {
  const data = createSchema.parse(req.body);

  // Customer must belong to active tenant.
  const customer = await prisma.customer.findFirst({
    where: tenantWhere(req, { id: data.customerId }),
  });
  if (!customer) throw new AppError('Customer not found', 400, 'BAD_CUSTOMER');

  const dup = await prisma.poOrder.findUnique({
    where: { companyId_poNumber: { companyId: req.tenant.companyId, poNumber: data.poNumber } },
  });
  if (dup) throw new AppError('PO number already exists in this company', 409, 'PO_DUPLICATE');

  const created = await prisma.poOrder.create({
    data: {
      poNumber: data.poNumber,
      orderDate: data.orderDate,
      deliveryDays: data.deliveryDays,
      deliveryDate: data.deliveryDate,
      notes: data.notes ?? null,
      companyId: req.tenant.companyId,
      customerId: customer.id,
      createdById: req.auth.userId,
      items: {
        create: data.items.map((it) => {
          const derived = deriveRate(it);
          return {
            coreType: it.coreType,
            grade: it.grade,
            material: it.material,
            measure: it.measure,
            id1: it.id1,
            id2: it.id2 ?? null,
            od1: it.od1,
            od2: it.od2 ?? null,
            ht: it.ht,
            builtup: it.builtup ?? null,
            weightPerPc: it.weightPerPc,
            pcs: it.pcs,
            totalWeight: it.totalWeight,
            coreAc: it.coreAc ?? null,
            coreMl: it.coreMl ?? null,
            d13: it.d13 ?? null,
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
          };
        }),
      },
    },
    include: { items: true, customer: true },
  });

  res.status(201).json(created);
}));

/* ---------- GET /api/po-orders — list ---------- */
router.get('/', requirePermission('view_po'), asyncHandler(async (req, res) => {
  const { page, pageSize, search } = z.object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
    search: z.string().trim().max(120).optional(),
  }).parse(req.query);

  const where = tenantWhere(req, search
    ? { OR: [
        { poNumber: { contains: search } },
        { customer: { name: { contains: search } } },
        { items: { some: { measure:  { contains: search } } } },
        { items: { some: { grade:    { contains: search } } } },
        { items: { some: { material: { contains: search } } } },
      ] }
    : {});

  const [items, total] = await Promise.all([
    prisma.poOrder.findMany({
      where, orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize, take: pageSize,
      include: {
        customer: { select: { id: true, name: true } },
        _count: { select: { items: true } },
      },
    }),
    prisma.poOrder.count({ where }),
  ]);

  res.json({ items, total, page, pageSize });
}));

/* ---------- ITEMS — flat view across all POs in the active company ----------
   These routes MUST come before /:id so "items" isn't matched as an order id. */

const flattenItem = (it) => {
  // Sum produced + dispatched if relations were included; otherwise null so
  // the UI knows the data wasn't loaded for this query.
  const pcsProduced   = it.productions ? it.productions.reduce((s, p) => s + p.pcs, 0) : null;
  const pcsDispatched = it.dispatches  ? it.dispatches.reduce((s, d) => s + d.pcs, 0)  : null;
  return {
    id: it.id,
    poOrderId: it.poOrderId,
    poNumber: it.poOrder.poNumber,
    customerId: it.poOrder.customerId,
    customerName: it.poOrder.customer.name,
    orderDate: it.poOrder.orderDate,
    deliveryDate: it.poOrder.deliveryDate,
    coreType: it.coreType,
    grade: it.grade,
    material: it.material,
    measure: it.measure,
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
    pcsProduced,
    pcsDispatched,
    status: it.status,
    createdAt: it.createdAt,
  };
};

/* GET /api/po-orders/items — paginated flat list */
router.get('/items', requirePermission('view_po'), asyncHandler(async (req, res) => {
  const { page, pageSize, search, status } = z.object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(200).default(50),
    search: z.string().trim().max(120).optional(),
    status: z.enum(['ACTIVE', 'CANCELLED', 'ALL']).default('ACTIVE'),
  }).parse(req.query);

  const where = {
    poOrder: { companyId: req.tenant.companyId },
    ...(status !== 'ALL' ? { status } : {}),
    ...(search
      ? {
          OR: [
            { poOrder: { poNumber: { contains: search } } },
            { poOrder: { customer: { name: { contains: search } } } },
            { grade:    { contains: search } },
            { material: { contains: search } },
            { measure:  { contains: search } },
          ],
        }
      : {}),
  };

  const [items, total] = await Promise.all([
    prisma.poOrderItem.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        poOrder: { include: { customer: true } },
        productions: { select: { pcs: true } },
        dispatches:  { select: { pcs: true } },
      },
    }),
    prisma.poOrderItem.count({ where }),
  ]);

  res.json({ items: items.map(flattenItem), total, page, pageSize });
}));

/* GET /api/po-orders/items/:id — one item with PO meta + processed counts */
router.get('/items/:id', requirePermission('view_po'), asyncHandler(async (req, res) => {
  const it = await prisma.poOrderItem.findFirst({
    where: { id: req.params.id, poOrder: { companyId: req.tenant.companyId } },
    include: {
      poOrder: { include: { customer: true } },
      productions: { select: { pcs: true } },
      dispatches:  { select: { pcs: true } },
    },
  });
  if (!it) throw new AppError('Item not found', 404, 'NOT_FOUND');
  res.json(flattenItem(it));
}));

/* PATCH /api/po-orders/items/:id — edit fields of a single item.
   If pcs is being changed, validates that the new count is at least the
   amount already produced or dispatched (whichever is higher) so we never
   end up with an impossible "ordered < built" state. */
router.patch('/items/:id', requirePermission('add_po'), asyncHandler(async (req, res) => {
  const data = itemSchema.partial().parse(req.body);
  const it = await prisma.poOrderItem.findFirst({
    where: { id: req.params.id, poOrder: { companyId: req.tenant.companyId } },
    include: {
      productions: { select: { pcs: true } },
      dispatches:  { select: { pcs: true } },
    },
  });
  if (!it) throw new AppError('Item not found', 404, 'NOT_FOUND');
  if (it.status === 'CANCELLED') throw new AppError('Cannot edit a cancelled item', 400, 'ITEM_CANCELLED');

  if (data.pcs !== undefined) {
    const produced   = it.productions.reduce((s, p) => s + p.pcs, 0);
    const dispatched = it.dispatches.reduce((s, d) => s + d.pcs, 0);
    const minPcs = Math.max(produced, dispatched);
    if (data.pcs < minPcs) {
      throw new AppError(
        `New pcs (${data.pcs}) is below already produced/dispatched (${minPcs}). Reduce production or dispatch first.`,
        400, 'PCS_BELOW_PROCESSED'
      );
    }
  }

  // Recompute derived pricing when ANY input that feeds it has changed.
  // We use the patched value if present, otherwise the existing row's value.
  const rateInputsTouched =
    data.rateBasis !== undefined || data.rateValue !== undefined ||
    data.weightPerPc !== undefined || data.pcs !== undefined ||
    data.totalWeight !== undefined;

  let rateUpdate = {};
  if (rateInputsTouched) {
    const derived = deriveRate({
      rateBasis:   data.rateBasis   !== undefined ? data.rateBasis   : it.rateBasis,
      rateValue:   data.rateValue   !== undefined ? data.rateValue   : it.rateValue,
      weightPerPc: data.weightPerPc !== undefined ? data.weightPerPc : it.weightPerPc,
      pcs:         data.pcs         !== undefined ? data.pcs         : it.pcs,
      totalWeight: data.totalWeight !== undefined ? data.totalWeight : it.totalWeight,
    });
    rateUpdate = {
      ratePerKg:   derived.ratePerKg,
      ratePerPc:   derived.ratePerPc,
      totalAmount: derived.totalAmount,
    };
  }

  const updated = await prisma.poOrderItem.update({
    where: { id: it.id },
    data: { ...data, ...rateUpdate },
  });
  res.json(updated);
}));

/* POST /api/po-orders/items/:id/cancel — cancel the unprocessed remainder.
   - If nothing has been produced/dispatched yet → mark CANCELLED, keep pcs as-is.
   - If some pcs are already produced/dispatched → reduce ordered pcs to that
     count (effectively cancelling only the remaining/unprocessed portion).
   - If everything is already produced/dispatched → 400 NOTHING_TO_CANCEL. */
router.post('/items/:id/cancel', requirePermission('add_po'), asyncHandler(async (req, res) => {
  const it = await prisma.poOrderItem.findFirst({
    where: { id: req.params.id, poOrder: { companyId: req.tenant.companyId } },
    include: {
      productions: { select: { pcs: true } },
      dispatches:  { select: { pcs: true } },
    },
  });
  if (!it) throw new AppError('Item not found', 404, 'NOT_FOUND');
  if (it.status === 'CANCELLED') return res.status(204).end();

  const produced   = it.productions.reduce((s, p) => s + p.pcs, 0);
  const dispatched = it.dispatches.reduce((s, d) => s + d.pcs, 0);
  const processed = Math.max(produced, dispatched);
  const remaining = it.pcs - processed;

  if (remaining <= 0) {
    throw new AppError(
      `Nothing remaining to cancel — ${processed} pcs already produced/dispatched out of ${it.pcs}.`,
      400, 'NOTHING_TO_CANCEL'
    );
  }

  if (processed === 0) {
    // Nothing built yet — full cancel.
    await prisma.poOrderItem.update({
      where: { id: it.id },
      data: { status: 'CANCELLED' },
    });
  } else {
    // Partial cancel — keep the item active but shrink it to the processed count.
    const newWeightPerPc = it.weightPerPc;
    const newTotalWeight = +(processed * newWeightPerPc).toFixed(3);
    const derived = deriveRate({
      rateBasis: it.rateBasis,
      rateValue: it.rateValue,
      weightPerPc: newWeightPerPc,
      pcs: processed,
      totalWeight: newTotalWeight,
    });
    await prisma.poOrderItem.update({
      where: { id: it.id },
      data: {
        pcs: processed,
        totalWeight: newTotalWeight,
        ratePerKg:   derived.ratePerKg,
        ratePerPc:   derived.ratePerPc,
        totalAmount: derived.totalAmount,
      },
    });
  }
  res.status(204).end();
}));

/* ---------- GET /api/po-orders/summary — items with stage counts + test fields ----------
   Drives the SO Summary page. Per-item snapshot of ordered / produced /
   dispatched / pending plus the flux-test calibration values for the
   "View test data" expand panel. */
router.get('/summary', requirePermission('po_summary'), asyncHandler(async (req, res) => {
  const { page, pageSize, search, status } = z.object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(200).default(50),
    search: z.string().trim().max(120).optional(),
    status: z.enum(['ACTIVE', 'CANCELLED', 'ALL']).default('ACTIVE'),
  }).parse(req.query);

  const where = {
    poOrder: { companyId: req.tenant.companyId },
    ...(status !== 'ALL' ? { status } : {}),
    ...(search
      ? {
          OR: [
            { poOrder: { poNumber: { contains: search } } },
            { poOrder: { customer: { name: { contains: search } } } },
            { grade: { contains: search } },
            { material: { contains: search } },
            { measure: { contains: search } },
          ],
        }
      : {}),
  };

  const [items, total] = await Promise.all([
    prisma.poOrderItem.findMany({
      where,
      orderBy: [{ poOrder: { orderDate: 'desc' } }, { createdAt: 'desc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        poOrder: { include: { customer: true } },
        productions: { select: { pcs: true } },
        dispatches:  { select: { pcs: true } },
      },
    }),
    prisma.poOrderItem.count({ where }),
  ]);

  const enriched = items.map((it) => {
    const produced   = it.productions.reduce((s, p) => s + p.pcs, 0);
    const dispatched = it.dispatches.reduce((s, d) => s + d.pcs, 0);
    return {
      id:            it.id,
      poOrderId:     it.poOrderId,
      poNumber:      it.poOrder.poNumber,
      orderDate:     it.poOrder.orderDate,
      deliveryDate:  it.poOrder.deliveryDate,
      customerName:  it.poOrder.customer.name,
      coreType:      it.coreType,
      grade:         it.grade,
      material:      it.material,
      measure:       it.measure,
      pcsOrdered:    it.pcs,
      pcsProduced:   produced,
      pcsDispatched: dispatched,
      pcsPending:    Math.max(it.pcs - dispatched, 0),
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
    };
  });

  res.json({ items: enriched, total, page, pageSize });
}));

/* ---------- GET /api/po-orders/:id ---------- */
router.get('/:id', requirePermission('view_po'), asyncHandler(async (req, res) => {
  const po = await prisma.poOrder.findFirst({
    where: tenantWhere(req, { id: req.params.id }),
    include: { items: true, customer: true },
  });
  if (!po) throw new AppError('PO not found', 404, 'NOT_FOUND');
  res.json(po);
}));

export default router;
