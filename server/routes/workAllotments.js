// Work Allotment slips — assigned labour for pending PO items.
// Records are auto-deleted after 7 days via lazy cleanup on every list call.
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/db.js';
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

const itemInclude = {
  include: {
    poOrderItem: { include: { poOrder: { include: { customer: true } } } },
    labour:      { select: { id: true, name: true } },
  },
};

const flattenItem = (it) => ({
  id:           it.id,
  poOrderItemId: it.poOrderItemId,
  poNumber:     it.poOrderItem?.poOrder?.poNumber ?? null,
  orderDate:    it.poOrderItem?.poOrder?.orderDate ?? null,
  customerName: it.poOrderItem?.poOrder?.customer?.name ?? null,
  coreType:     it.poOrderItem?.coreType ?? null,
  grade:        it.poOrderItem?.grade ?? null,
  material:     it.poOrderItem?.material ?? null,
  measure:      it.poOrderItem?.measure ?? null,
  flux:         it.poOrderItem?.flux ?? null,
  turns:        it.poOrderItem?.turns ?? null,
  testVoltage:  it.poOrderItem?.testVoltage ?? null,
  testCurrent:  it.poOrderItem?.testCurrent ?? null,
  pcs:          it.pcs,
  labourId:     it.labourId,
  labourName:   it.labour?.name ?? null,
});

const flattenWa = (wa) => ({
  id:        wa.id,
  waNumber:  wa.waNumber,
  waDate:    wa.waDate,
  remarks:   wa.remarks,
  createdAt: wa.createdAt,
  updatedAt: wa.updatedAt,
  itemCount: wa.items?.length ?? 0,
  totalPcs:  (wa.items ?? []).reduce((s, i) => s + (i.pcs ?? 0), 0),
  items:     (wa.items ?? []).map(flattenItem),
});

// Lazy cleanup — deletes WAs older than RETENTION_DAYS for the active company.
// Cheap (one query) and runs on every list call. Cascades to items via FK.
const cleanupExpired = async (companyId) => {
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
  await prisma.workAllotment.deleteMany({
    where: { companyId, createdAt: { lt: cutoff } },
  });
};

/* ---------- /pending — PO items still awaiting production ---------- */
router.get('/pending', requirePermission('assign_work'), asyncHandler(async (req, res) => {
  const { search } = z.object({ search: z.string().trim().max(120).optional() }).parse(req.query);

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
      poOrder:     { include: { customer: true } },
      productions: { select: { pcs: true } },
    },
  });

  const pending = items
    .map((it) => {
      const produced  = it.productions.reduce((s, p) => s + p.pcs, 0);
      const remaining = Math.max(it.pcs - produced, 0);
      return {
        id:           it.id,
        poNumber:     it.poOrder.poNumber,
        customerName: it.poOrder.customer.name,
        orderDate:    it.poOrder.orderDate,
        coreType:     it.coreType,
        grade:        it.grade,
        material:     it.material,
        measure:      it.measure,
        flux:         it.flux,
        turns:        it.turns,
        testVoltage:  it.testVoltage,
        testCurrent:  it.testCurrent,
        orderedPcs:   it.pcs,
        producedPcs:  produced,
        remainingPcs: remaining,
      };
    })
    .filter((x) => x.remainingPcs > 0);

  res.json({ items: pending });
}));

/* ---------- GET / — generated WAs (≤ 7 days old after cleanup) ---------- */
router.get('/', requirePermission('assign_work'), asyncHandler(async (req, res) => {
  await cleanupExpired(req.tenant.companyId);

  const { search } = z.object({ search: z.string().trim().max(120).optional() }).parse(req.query);

  const was = await prisma.workAllotment.findMany({
    where: {
      companyId: req.tenant.companyId,
      ...(search
        ? {
            OR: [
              { waNumber: { contains: search } },
              { items: { some: { labour:      { name: { contains: search } } } } },
              { items: { some: { poOrderItem: { poOrder: { poNumber: { contains: search } } } } } },
              { items: { some: { poOrderItem: { poOrder: { customer: { name: { contains: search } } } } } } },
              { items: { some: { poOrderItem: { measure: { contains: search } } } } },
            ],
          }
        : {}),
    },
    orderBy: { createdAt: 'desc' },
    include: { items: itemInclude },
  });

  res.json({ items: was.map(flattenWa) });
}));

/* ---------- GET /:id ---------- */
router.get('/:id', requirePermission('assign_work'), asyncHandler(async (req, res) => {
  const wa = await prisma.workAllotment.findFirst({
    where: { id: req.params.id, companyId: req.tenant.companyId },
    include: { items: itemInclude },
  });
  if (!wa) throw new AppError('Work allotment not found', 404, 'NOT_FOUND');
  res.json(flattenWa(wa));
}));

/* ---------- POST / — create new WA ---------- */
router.post('/', requirePermission('assign_work'), asyncHandler(async (req, res) => {
  const data = createSchema.parse(req.body);

  // Validate every PO item exists in this company + pcs ≤ remaining.
  const itemIds = data.items.map((i) => i.poOrderItemId);
  const poItems = await prisma.poOrderItem.findMany({
    where: {
      id: { in: itemIds },
      poOrder: { companyId: req.tenant.companyId },
    },
    include: { productions: { select: { pcs: true } } },
  });
  if (poItems.length !== itemIds.length) {
    throw new AppError('One or more PO items not found', 404, 'NOT_FOUND');
  }

  for (const inputItem of data.items) {
    const po = poItems.find((p) => p.id === inputItem.poOrderItemId);
    if (po.status === 'CANCELLED') {
      throw new AppError('PO item is cancelled', 400, 'ITEM_CANCELLED');
    }
    const produced  = po.productions.reduce((s, x) => s + x.pcs, 0);
    const remaining = Math.max(po.pcs - produced, 0);
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
    const found = await prisma.labour.findMany({
      where: {
        id: { in: labourIds },
        companies: { some: { companyId: req.tenant.companyId } },
      },
      select: { id: true },
    });
    if (found.length !== labourIds.length) {
      throw new AppError('One or more workers not assigned to this company', 400, 'BAD_LABOUR');
    }
  }

  const wa = await prisma.workAllotment.create({
    data: {
      waNumber:    data.waNumber,
      waDate:      data.waDate,
      remarks:     data.remarks ?? null,
      companyId:   req.tenant.companyId,
      createdById: req.auth.userId,
      items: {
        create: data.items.map((i) => ({
          poOrderItemId: i.poOrderItemId,
          pcs:           i.pcs,
          labourId:      i.labourId ?? null,
        })),
      },
    },
    include: { items: itemInclude },
  });

  res.status(201).json(flattenWa(wa));
}));

/* ---------- DELETE /:id ---------- */
router.delete('/:id', requirePermission('assign_work'), asyncHandler(async (req, res) => {
  const wa = await prisma.workAllotment.findFirst({
    where: { id: req.params.id, companyId: req.tenant.companyId },
  });
  if (!wa) throw new AppError('Work allotment not found', 404, 'NOT_FOUND');
  await prisma.workAllotment.delete({ where: { id: wa.id } });
  res.status(204).end();
}));

export default router;
