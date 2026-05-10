// Dispatch records — track shipments of produced goods to customers.
// Constraint: sum(dispatch.pcs) ≤ sum(production.pcs) for the same PO item.
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/db.js';
import { AppError, asyncHandler } from '../lib/errors.js';
import { requireAuth, requirePermission } from '../lib/auth.js';
import { resolveTenant, tenantWhere } from '../lib/tenant.js';

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

const flatten = (d) => {
  const item = d.poOrderItem;
  // Pro-rate the line amount onto this dispatch batch.
  const lineAmount = item?.totalAmount ?? null;
  const proRataAmount = (lineAmount != null && item.pcs > 0)
    ? +(lineAmount * (d.pcs / item.pcs)).toFixed(2)
    : null;
  return {
    id: d.id,
    poOrderItemId: d.poOrderItemId,
    poNumber: item.poOrder.poNumber,
    orderDate: item.poOrder.orderDate,
    customerId: item.poOrder.customerId,
    customerName: item.poOrder.customer.name,
    customerState: item.poOrder.customer.state ?? null,
    coreType: item.coreType,
    grade: item.grade,
    material: item.material,
    measure: item.measure,
    // Dimensions for packing list
    id1: item.id1,
    id2: item.id2 ?? null,
    od1: item.od1,
    od2: item.od2 ?? null,
    ht: item.ht,
    itemPcs: item.pcs,
    dispatchDate: d.dispatchDate,
    pcs: d.pcs,
    weightPerPc: d.weightPerPc,
    totalWeight: d.totalWeight,
    actualWeight: d.actualWeight ?? null,
    vehicleNo: d.vehicleNo,
    notes: d.notes,
    createdAt: d.createdAt,
    rateBasis:   item.rateBasis ?? null,
    rateValue:   item.rateValue ?? null,
    ratePerKg:   item.ratePerKg ?? null,
    ratePerPc:   item.ratePerPc ?? null,
    lineAmount,
    amount:      proRataAmount,
    // Flux-test calibration — used by the Testing Report.
    turns:       item.turns       ?? null,
    flux:        item.flux        ?? null,
    ateCm:       item.ateCm       ?? null,
    testVoltage: item.testVoltage ?? null,
    testCurrent: item.testCurrent ?? null,
    poOrderId:   item.poOrder?.id ?? null,
  };
};

const withRelations = {
  include: {
    poOrderItem: { include: { poOrder: { include: { customer: true } } } },
  },
};

/* ---------- GET /ready — PO items that have produced but undispatched pcs ---------- */
router.get('/ready', requirePermission('dispatch'), asyncHandler(async (req, res) => {
  const search = z.object({ search: z.string().trim().max(120).optional() })
    .parse(req.query).search;

  const items = await prisma.poOrderItem.findMany({
    where: {
      status: 'ACTIVE',
      poOrder: { companyId: req.tenant.companyId },
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
    },
    orderBy: { createdAt: 'desc' },
    include: {
      poOrder: { include: { customer: true } },
      productions: { select: { pcs: true } },
      dispatches: { select: { pcs: true } },
    },
  });

  const ready = items
    .map((it) => {
      const produced = it.productions.reduce((s, p) => s + p.pcs, 0);
      const dispatched = it.dispatches.reduce((s, d) => s + d.pcs, 0);
      const readyPcs = Math.max(produced - dispatched, 0);
      const readyAmount = (it.totalAmount != null && it.pcs > 0)
        ? +(it.totalAmount * (readyPcs / it.pcs)).toFixed(2)
        : null;
      return {
        id: it.id,
        poNumber: it.poOrder.poNumber,
        customerName: it.poOrder.customer.name,
        deliveryDate: it.poOrder.deliveryDate,
        coreType: it.coreType,
        grade: it.grade,
        material: it.material,
        measure: it.measure,
        weightPerPc: it.weightPerPc,
        orderedPcs: it.pcs,
        producedPcs: produced,
        dispatchedPcs: dispatched,
        readyPcs,
        rateBasis:   it.rateBasis   ?? null,
        rateValue:   it.rateValue   ?? null,
        totalAmount: it.totalAmount ?? null,
        readyAmount,
      };
    })
    .filter((x) => x.readyPcs > 0);

  res.json({ items: ready });
}));

/* ---------- GET / — paginated list ---------- */
router.get('/', requirePermission('dispatch'), asyncHandler(async (req, res) => {
  const { page, pageSize, search } = z.object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(200).default(50),
    search: z.string().trim().max(120).optional(),
  }).parse(req.query);

  const where = tenantWhere(req, search
    ? {
        OR: [
          { vehicleNo: { contains: search } },
          { poOrderItem: { poOrder: { poNumber: { contains: search } } } },
          { poOrderItem: { poOrder: { customer: { name: { contains: search } } } } },
          { poOrderItem: { grade:    { contains: search } } },
          { poOrderItem: { material: { contains: search } } },
          { poOrderItem: { measure:  { contains: search } } },
        ],
      }
    : {});

  const [items, total] = await Promise.all([
    prisma.dispatch.findMany({
      where, orderBy: { dispatchDate: 'desc' },
      skip: (page - 1) * pageSize, take: pageSize,
      ...withRelations,
    }),
    prisma.dispatch.count({ where }),
  ]);

  res.json({ items: items.map(flatten), total, page, pageSize });
}));

/* ---------- GET /:id ---------- */
router.get('/:id', requirePermission('dispatch'), asyncHandler(async (req, res) => {
  const d = await prisma.dispatch.findFirst({
    where: tenantWhere(req, { id: req.params.id }),
    ...withRelations,
  });
  if (!d) throw new AppError('Dispatch record not found', 404, 'NOT_FOUND');
  res.json(flatten(d));
}));

/* ---------- POST / ---------- */
router.post('/', requirePermission('dispatch'), asyncHandler(async (req, res) => {
  const data = createSchema.parse(req.body);

  const item = await prisma.poOrderItem.findFirst({
    where: { id: data.poOrderItemId, poOrder: { companyId: req.tenant.companyId } },
    include: {
      productions: { select: { pcs: true } },
      dispatches: { select: { pcs: true } },
    },
  });
  if (!item) throw new AppError('PO item not found', 404, 'NOT_FOUND');
  if (item.status === 'CANCELLED') throw new AppError('PO item is cancelled', 400, 'ITEM_CANCELLED');

  const produced = item.productions.reduce((s, p) => s + p.pcs, 0);
  const alreadyDispatched = item.dispatches.reduce((s, d) => s + d.pcs, 0);
  const available = Math.max(produced - alreadyDispatched, 0);

  if (data.pcs > available) {
    throw new AppError(
      `Dispatch pcs (${data.pcs}) exceeds available produced pcs (${available}).`,
      400, 'PCS_EXCEEDS'
    );
  }

  const created = await prisma.dispatch.create({
    data: {
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
    },
    ...withRelations,
  });
  res.status(201).json(flatten(created));
}));

/* ---------- PATCH /:id ---------- */
router.patch('/:id', requirePermission('dispatch'), asyncHandler(async (req, res) => {
  const data = updateSchema.parse(req.body);
  const d = await prisma.dispatch.findFirst({
    where: tenantWhere(req, { id: req.params.id }),
    include: {
      poOrderItem: {
        include: {
          productions: { select: { pcs: true } },
          dispatches: { select: { id: true, pcs: true } },
        },
      },
    },
  });
  if (!d) throw new AppError('Dispatch record not found', 404, 'NOT_FOUND');

  if (data.pcs !== undefined) {
    const produced = d.poOrderItem.productions.reduce((s, p) => s + p.pcs, 0);
    const otherDispatched = d.poOrderItem.dispatches
      .filter((x) => x.id !== d.id)
      .reduce((s, x) => s + x.pcs, 0);
    const available = Math.max(produced - otherDispatched, 0);
    if (data.pcs > available) {
      throw new AppError(
        `New pcs (${data.pcs}) exceeds available capacity (${available}).`,
        400, 'PCS_EXCEEDS'
      );
    }
  }

  const updated = await prisma.dispatch.update({
    where: { id: d.id },
    data: {
      ...(data.dispatchDate !== undefined ? { dispatchDate: data.dispatchDate } : {}),
      ...(data.pcs !== undefined ? { pcs: data.pcs } : {}),
      ...(data.weightPerPc !== undefined ? { weightPerPc: data.weightPerPc } : {}),
      ...(data.totalWeight !== undefined ? { totalWeight: data.totalWeight } : {}),
      ...(data.actualWeight !== undefined ? { actualWeight: data.actualWeight ?? null } : {}),
      ...(data.vehicleNo !== undefined ? { vehicleNo: data.vehicleNo ?? null } : {}),
      ...(data.notes !== undefined ? { notes: data.notes ?? null } : {}),
    },
    ...withRelations,
  });
  res.json(flatten(updated));
}));

/* ---------- DELETE /:id ---------- */
router.delete('/:id', requirePermission('dispatch'), asyncHandler(async (req, res) => {
  const d = await prisma.dispatch.findFirst({ where: tenantWhere(req, { id: req.params.id }) });
  if (!d) throw new AppError('Dispatch record not found', 404, 'NOT_FOUND');
  await prisma.dispatch.delete({ where: { id: d.id } });
  res.status(204).end();
}));

export default router;
