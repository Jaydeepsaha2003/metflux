// Production records — list, record-against-pending-PO-item, edit, delete.
// Ported from .NET Production + Modify_Production forms.
//
// Constraints (matching the legacy app):
//  - You can only record production against an ACTIVE PoOrderItem.
//  - sum(production.pcs for an item) cannot exceed poOrderItem.pcs.
//  - prodDate cannot be earlier than the PO's orderDate.
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

const flatten = (p) => {
  const item = p.poOrderItem;
  // Pro-rate the line amount onto this production batch:
  // (this batch's pcs / total ordered pcs) × line totalAmount.
  const lineAmount = item?.totalAmount ?? null;
  const proRataAmount = (lineAmount != null && item.pcs > 0)
    ? +(lineAmount * (p.pcs / item.pcs)).toFixed(2)
    : null;
  return {
    id: p.id,
    poOrderItemId: p.poOrderItemId,
    poNumber: item.poOrder.poNumber,
    customerName: item.poOrder.customer.name,
    orderDate: item.poOrder.orderDate,
    coreType: item.coreType,
    grade: item.grade,
    material: item.material,
    measure: item.measure,
    itemPcs: item.pcs,
    prodDate: p.prodDate,
    pcs: p.pcs,
    weightPerPc: p.weightPerPc,
    totalWeight: p.totalWeight,
    labourName: p.labourName,
    notes: p.notes,
    createdAt: p.createdAt,
    rateBasis:   item.rateBasis ?? null,
    rateValue:   item.rateValue ?? null,
    ratePerKg:   item.ratePerKg ?? null,
    ratePerPc:   item.ratePerPc ?? null,
    lineAmount,
    amount:      proRataAmount,
  };
};

/* ---------- /pending — items still awaiting production ---------- */
router.get('/pending', requirePermission('rec_production'), asyncHandler(async (req, res) => {
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
    },
  });

  const pending = items
    .map((it) => {
      const produced = it.productions.reduce((s, p) => s + p.pcs, 0);
      const remaining = Math.max(it.pcs - produced, 0);
      // Money still to make on this line: pro-rata totalAmount across remaining pcs.
      const pendingAmount = (it.totalAmount != null && it.pcs > 0)
        ? +(it.totalAmount * (remaining / it.pcs)).toFixed(2)
        : null;
      return {
        id: it.id,
        poNumber: it.poOrder.poNumber,
        customerName: it.poOrder.customer.name,
        orderDate: it.poOrder.orderDate,
        deliveryDate: it.poOrder.deliveryDate,
        coreType: it.coreType,
        grade: it.grade,
        material: it.material,
        measure: it.measure,
        weightPerPc: it.weightPerPc,
        orderedPcs: it.pcs,
        producedPcs: produced,
        remainingPcs: remaining,
        rateBasis:   it.rateBasis   ?? null,
        rateValue:   it.rateValue   ?? null,
        totalAmount: it.totalAmount ?? null,
        pendingAmount,
      };
    })
    .filter((x) => x.remainingPcs > 0);

  res.json({ items: pending });
}));

/* ---------- GET / — paginated list of production records ---------- */
router.get('/', requirePermission('view_po'), asyncHandler(async (req, res) => {
  const { page, pageSize, search } = z.object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(200).default(50),
    search: z.string().trim().max(120).optional(),
  }).parse(req.query);

  const where = tenantWhere(req, search
    ? {
        OR: [
          { labourName: { contains: search } },
          { poOrderItem: { poOrder: { poNumber: { contains: search } } } },
          { poOrderItem: { poOrder: { customer: { name: { contains: search } } } } },
          { poOrderItem: { grade:    { contains: search } } },
          { poOrderItem: { material: { contains: search } } },
          { poOrderItem: { measure:  { contains: search } } },
        ],
      }
    : {});

  const [items, total] = await Promise.all([
    prisma.production.findMany({
      where, orderBy: { prodDate: 'desc' },
      skip: (page - 1) * pageSize, take: pageSize,
      include: {
        poOrderItem: { include: { poOrder: { include: { customer: true } } } },
      },
    }),
    prisma.production.count({ where }),
  ]);

  res.json({ items: items.map(flatten), total, page, pageSize });
}));

/* ---------- GET /:id ---------- */
router.get('/:id', requirePermission('view_po'), asyncHandler(async (req, res) => {
  const p = await prisma.production.findFirst({
    where: tenantWhere(req, { id: req.params.id }),
    include: { poOrderItem: { include: { poOrder: { include: { customer: true } } } } },
  });
  if (!p) throw new AppError('Production record not found', 404, 'NOT_FOUND');
  res.json(flatten(p));
}));

/* ---------- POST / — create new production entry ---------- */
router.post('/', requirePermission('rec_production'), asyncHandler(async (req, res) => {
  const data = createSchema.parse(req.body);

  const item = await prisma.poOrderItem.findFirst({
    where: {
      id: data.poOrderItemId,
      poOrder: { companyId: req.tenant.companyId },
    },
    include: {
      poOrder: { select: { orderDate: true } },
      productions: { select: { pcs: true } },
    },
  });
  if (!item) throw new AppError('PO item not found', 404, 'NOT_FOUND');
  if (item.status === 'CANCELLED') throw new AppError('PO item is cancelled', 400, 'ITEM_CANCELLED');

  // Pcs-vs-remaining check.
  const produced = item.productions.reduce((s, p) => s + p.pcs, 0);
  const remaining = Math.max(item.pcs - produced, 0);
  if (data.pcs > remaining) {
    throw new AppError(
      `Production pcs (${data.pcs}) exceeds remaining (${remaining}).`,
      400, 'PCS_EXCEEDS'
    );
  }

  // Date sanity — production cannot pre-date the PO.
  if (new Date(data.prodDate) < new Date(item.poOrder.orderDate)) {
    throw new AppError('Production date cannot be before order date', 400, 'BAD_DATE');
  }

  const created = await prisma.production.create({
    data: {
      poOrderItemId: data.poOrderItemId,
      prodDate: data.prodDate,
      pcs: data.pcs,
      weightPerPc: data.weightPerPc,
      totalWeight: data.totalWeight,
      labourName: data.labourName,
      notes: data.notes ?? null,
      companyId: req.tenant.companyId,
      createdById: req.auth.userId,
    },
  });
  res.status(201).json(created);
}));

/* ---------- PATCH /:id ---------- */
router.patch('/:id', requirePermission('modify_prod_qty'), asyncHandler(async (req, res) => {
  const data = updateSchema.parse(req.body);
  const p = await prisma.production.findFirst({
    where: tenantWhere(req, { id: req.params.id }),
    include: {
      poOrderItem: {
        include: {
          poOrder: { select: { orderDate: true } },
          productions: { select: { id: true, pcs: true } },
        },
      },
    },
  });
  if (!p) throw new AppError('Production record not found', 404, 'NOT_FOUND');

  // If pcs is being changed, ensure new value doesn't exceed item.pcs
  // when summed with the OTHER production records.
  if (data.pcs !== undefined) {
    const otherProduced = p.poOrderItem.productions
      .filter((x) => x.id !== p.id)
      .reduce((s, x) => s + x.pcs, 0);
    const maxAllowed = p.poOrderItem.pcs - otherProduced;
    if (data.pcs > maxAllowed) {
      throw new AppError(
        `New pcs (${data.pcs}) exceeds remaining capacity (${maxAllowed}) for this PO item.`,
        400, 'PCS_EXCEEDS'
      );
    }
  }

  if (data.prodDate !== undefined &&
      new Date(data.prodDate) < new Date(p.poOrderItem.poOrder.orderDate)) {
    throw new AppError('Production date cannot be before order date', 400, 'BAD_DATE');
  }

  const updated = await prisma.production.update({
    where: { id: p.id },
    data: { ...data, notes: data.notes === undefined ? undefined : (data.notes ?? null) },
  });
  res.json(updated);
}));

/* ---------- DELETE /:id ---------- */
router.delete('/:id', requirePermission('modify_prod_qty'), asyncHandler(async (req, res) => {
  const p = await prisma.production.findFirst({ where: tenantWhere(req, { id: req.params.id }) });
  if (!p) throw new AppError('Production record not found', 404, 'NOT_FOUND');
  await prisma.production.delete({ where: { id: p.id } });
  res.status(204).end();
}));

/* ---------- GET /_meta/labours — distinct labour names for autocomplete ---------- */
router.get('/_meta/labours', requirePermission('rec_production'), asyncHandler(async (req, res) => {
  const rows = await prisma.production.findMany({
    where: tenantWhere(req),
    distinct: ['labourName'],
    select: { labourName: true },
    orderBy: { labourName: 'asc' },
    take: 200,
  });
  res.json({ labours: rows.map((r) => r.labourName) });
}));

export default router;
