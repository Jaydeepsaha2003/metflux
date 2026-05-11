// Packing list records — one PL can cover multiple dispatches.
// PackingListItem is the join table (each dispatch belongs to at most one PL).
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/db.js';
import { AppError, asyncHandler } from '../lib/errors.js';
import { requireAuth, requirePermission } from '../lib/auth.js';
import { resolveTenant, tenantWhere } from '../lib/tenant.js';

const router = Router();
router.use(requireAuth, resolveTenant);

const createSchema = z.object({
  dispatchIds: z.array(z.string().min(1)).min(1),
  plNumber:    z.string().trim().min(1).max(80),          // WO Number
  plDate:      z.coerce.date(),                            // WO Date
  invoiceNo:   z.string().trim().max(80).optional().nullable(),
  invoiceDate: z.coerce.date().optional().nullable(),
  testedBy:    z.string().trim().max(120).optional().nullable(),
  approvedBy:  z.string().trim().max(120).optional().nullable(),
  remarks:     z.string().trim().max(200).optional().nullable(),
});

const updateSchema = z.object({
  plNumber:    z.string().trim().min(1).max(80),
  plDate:      z.coerce.date(),
  invoiceNo:   z.string().trim().max(80).optional().nullable(),
  invoiceDate: z.coerce.date().optional().nullable(),
  testedBy:    z.string().trim().max(120).optional().nullable(),
  approvedBy:  z.string().trim().max(120).optional().nullable(),
  remarks:     z.string().trim().max(200).optional().nullable(),
});

const dispatchInclude = {
  include: {
    poOrderItem: { include: { poOrder: { include: { customer: true } } } },
  },
};

const withItems = {
  include: {
    items: {
      orderBy: { dispatch: { dispatchDate: 'asc' } },
      include: { dispatch: dispatchInclude },
    },
  },
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
  poNumber:      d.poOrderItem?.poOrder?.poNumber ?? null,
  orderDate:     d.poOrderItem?.poOrder?.orderDate ?? null,
  customerName:  d.poOrderItem?.poOrder?.customer?.name ?? null,
  customerState: d.poOrderItem?.poOrder?.customer?.state ?? null,
  customerPhone: d.poOrderItem?.poOrder?.customer?.phone ?? null,
  coreType:      d.poOrderItem?.coreType ?? null,
  grade:         d.poOrderItem?.grade ?? null,
  material:      d.poOrderItem?.material ?? null,
  measure:       d.poOrderItem?.measure ?? null,
  id1:           d.poOrderItem?.id1 ?? null,
  id2:           d.poOrderItem?.id2 ?? null,
  od1:           d.poOrderItem?.od1 ?? null,
  od2:           d.poOrderItem?.od2 ?? null,
  ht:            d.poOrderItem?.ht ?? null,
  itemPcs:       d.poOrderItem?.pcs ?? null,
  // Flux-test calibration — surfaced for the Testing Report when launched
  // from a saved packing list (plId flow).
  turns:       d.poOrderItem?.turns       ?? null,
  flux:        d.poOrderItem?.flux        ?? null,
  testVoltage: d.poOrderItem?.testVoltage ?? null,
  testCurrent: d.poOrderItem?.testCurrent ?? null,
});

const flattenPl = (pl) => {
  const dispatches = (pl.items ?? []).map((i) => flattenDispatch(i.dispatch));
  const totalPcs    = dispatches.reduce((s, d) => s + (d.pcs ?? 0), 0);
  const totalWeight = dispatches.reduce((s, d) => s + (d.totalWeight ?? 0), 0);
  // For list display: show first dispatch's customer / PO
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
    dispatchDate: first.dispatchDate ?? null,
    dispatches,
  };
};

/* GET /packing-lists/pending — dispatches with no packing list yet */
router.get('/pending', requirePermission('dispatch'), asyncHandler(async (req, res) => {
  const { search } = z.object({ search: z.string().trim().max(120).optional() }).parse(req.query);

  const dispatches = await prisma.dispatch.findMany({
    where: {
      companyId: req.tenant.companyId,
      packingListItem: null,
      ...(search ? {
        OR: [
          { poOrderItem: { poOrder: { poNumber: { contains: search } } } },
          { poOrderItem: { poOrder: { customer: { name: { contains: search } } } } },
          { poOrderItem: { measure: { contains: search } } },
          { vehicleNo: { contains: search } },
        ],
      } : {}),
    },
    orderBy: { dispatchDate: 'desc' },
    include: {
      poOrderItem: { include: { poOrder: { include: { customer: true } } } },
    },
  });

  const items = dispatches.map((d) => ({
    id:           d.id,
    poNumber:     d.poOrderItem.poOrder.poNumber,
    customerName: d.poOrderItem.poOrder.customer.name,
    coreType:     d.poOrderItem.coreType,
    grade:        d.poOrderItem.grade,
    material:     d.poOrderItem.material,
    dispatchDate: d.dispatchDate,
    pcs:          d.pcs,
    totalWeight:  d.totalWeight,
    vehicleNo:    d.vehicleNo,
  }));

  res.json({ items });
}));

/* GET /packing-lists — all generated packing lists */
router.get('/', requirePermission('dispatch'), asyncHandler(async (req, res) => {
  const { search } = z.object({ search: z.string().trim().max(120).optional() }).parse(req.query);

  const lists = await prisma.packingList.findMany({
    where: {
      companyId: req.tenant.companyId,
      ...(search ? {
        OR: [
          { plNumber: { contains: search } },
          { items: { some: { dispatch: { poOrderItem: { poOrder: { poNumber: { contains: search } } } } } } },
          { items: { some: { dispatch: { poOrderItem: { poOrder: { customer: { name: { contains: search } } } } } } } },
          { items: { some: { dispatch: { poOrderItem: { measure: { contains: search } } } } } },
          { testedBy: { contains: search } },
          { approvedBy: { contains: search } },
        ],
      } : {}),
    },
    orderBy: { plDate: 'desc' },
    ...withItems,
  });

  res.json({ items: lists.map(flattenPl) });
}));

/* GET /packing-lists/:plId — single PL with full dispatch details */
router.get('/:plId', requirePermission('dispatch'), asyncHandler(async (req, res) => {
  const pl = await prisma.packingList.findFirst({
    where: { id: req.params.plId, companyId: req.tenant.companyId },
    ...withItems,
  });
  if (!pl) throw new AppError('Packing list not found', 404, 'NOT_FOUND');
  res.json(flattenPl(pl));
}));

/* POST /packing-lists — create new PL for one or more dispatches */
router.post('/', requirePermission('dispatch'), asyncHandler(async (req, res) => {
  const data = createSchema.parse(req.body);

  const dispatches = await prisma.dispatch.findMany({
    where: { id: { in: data.dispatchIds }, companyId: req.tenant.companyId },
  });
  if (dispatches.length !== data.dispatchIds.length) {
    throw new AppError('One or more dispatches not found', 404, 'NOT_FOUND');
  }

  const alreadyLinked = await prisma.packingListItem.findFirst({
    where: { dispatchId: { in: data.dispatchIds } },
  });
  if (alreadyLinked) {
    throw new AppError('One or more dispatches already belong to a packing list', 409, 'CONFLICT');
  }

  const pl = await prisma.packingList.create({
    data: {
      plNumber:    data.plNumber,
      plDate:      data.plDate,
      invoiceNo:   data.invoiceNo ?? null,
      invoiceDate: data.invoiceDate ?? null,
      testedBy:    data.testedBy ?? null,
      approvedBy:  data.approvedBy ?? null,
      remarks:     data.remarks ?? null,
      companyId:   req.tenant.companyId,
      createdById: req.auth.userId,
      items: {
        create: data.dispatchIds.map((did) => ({ dispatchId: did })),
      },
    },
    ...withItems,
  });

  res.status(201).json(flattenPl(pl));
}));

/* PUT /packing-lists/:plId — update metadata (number, date, names) */
router.put('/:plId', requirePermission('dispatch'), asyncHandler(async (req, res) => {
  const data = updateSchema.parse(req.body);
  const pl = await prisma.packingList.findFirst({
    where: { id: req.params.plId, companyId: req.tenant.companyId },
  });
  if (!pl) throw new AppError('Packing list not found', 404, 'NOT_FOUND');

  const updated = await prisma.packingList.update({
    where: { id: pl.id },
    data: {
      plNumber:   data.plNumber,
      plDate:     data.plDate,
      testedBy:   data.testedBy ?? null,
      approvedBy: data.approvedBy ?? null,
      remarks:    data.remarks ?? null,
    },
    ...withItems,
  });
  res.json(flattenPl(updated));
}));

/* DELETE /packing-lists/:plId */
router.delete('/:plId', requirePermission('dispatch'), asyncHandler(async (req, res) => {
  const pl = await prisma.packingList.findFirst({
    where: { id: req.params.plId, companyId: req.tenant.companyId },
  });
  if (!pl) throw new AppError('Packing list not found', 404, 'NOT_FOUND');
  await prisma.packingList.delete({ where: { id: pl.id } });
  res.status(204).end();
}));

export default router;
