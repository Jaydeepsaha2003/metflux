// Customer returns — track items coming back for rework, then re-dispatched.
// Lifecycle: PENDING → RECEIVED → IN_REWORK → REDISPATCHED → CLOSED
// (CANCELLED is also possible from PENDING/RECEIVED).
//
// Returns reference an SO / Invoice / WO number (free-text) so the user can
// type whatever they have on the customer's complaint. Items reference real
// PoOrderItems so we can pull measure/grade/wt-per-pc consistently.
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/db.js';
import { AppError, asyncHandler } from '../lib/errors.js';
import { requireAuth, requireAnyPermission } from '../lib/auth.js';
import { resolveTenant } from '../lib/tenant.js';

const router = Router();
router.use(requireAuth, resolveTenant);

const itemSchema = z.object({
  poOrderItemId: z.string().min(1),
  pcs:           z.coerce.number().int().positive(),
  reason:        z.string().trim().max(300).optional().nullable(),
});

const createSchema = z.object({
  returnNumber:   z.string().trim().min(1).max(60),
  returnDate:     z.coerce.date(),
  referenceType:  z.enum(['SO_NUMBER', 'INVOICE_NUMBER', 'WO_NUMBER']),
  referenceValue: z.string().trim().min(1).max(80),
  customerId:     z.string().min(1),
  reason:         z.string().trim().max(400).optional().nullable(),
  notes:          z.string().trim().max(2000).optional().nullable(),
  items:          z.array(itemSchema).min(1, 'Add at least one returned item'),
});

const updateSchema = z.object({
  returnNumber:   z.string().trim().min(1).max(60).optional(),
  returnDate:     z.coerce.date().optional(),
  referenceType:  z.enum(['SO_NUMBER', 'INVOICE_NUMBER', 'WO_NUMBER']).optional(),
  referenceValue: z.string().trim().min(1).max(80).optional(),
  reason:         z.string().trim().max(400).optional().nullable(),
  notes:          z.string().trim().max(2000).optional().nullable(),
});

const itemInclude = {
  include: {
    poOrderItem: { include: { poOrder: { include: { customer: true } } } },
  },
};

const flattenItem = (it) => ({
  id:             it.id,
  poOrderItemId:  it.poOrderItemId,
  pcs:            it.pcs,
  reason:         it.reason,
  poNumber:       it.poOrderItem?.poOrder?.poNumber ?? null,
  coreType:       it.poOrderItem?.coreType ?? null,
  grade:          it.poOrderItem?.grade ?? null,
  material:       it.poOrderItem?.material ?? null,
  measure:        it.poOrderItem?.measure ?? null,
  weightPerPc:    it.poOrderItem?.weightPerPc ?? null,
});

const flattenReturn = (r) => ({
  id:               r.id,
  returnNumber:     r.returnNumber,
  returnDate:       r.returnDate,
  referenceType:    r.referenceType,
  referenceValue:   r.referenceValue,
  status:           r.status,
  receivedAt:       r.receivedAt,
  reworkAt:         r.reworkAt,
  redispatchAt:     r.redispatchAt,
  redispatchVehicle: r.redispatchVehicle,
  closedAt:         r.closedAt,
  reason:           r.reason,
  notes:            r.notes,
  createdAt:        r.createdAt,
  updatedAt:        r.updatedAt,
  customerId:       r.customerId,
  customerName:     r.customer?.name ?? null,
  itemCount:        r.items?.length ?? 0,
  totalPcs:         (r.items ?? []).reduce((s, i) => s + (i.pcs ?? 0), 0),
  items:            (r.items ?? []).map(flattenItem),
});

/* ---------- GET / — paginated list ---------- */
router.get('/', requireAnyPermission('manage_returns', 'dispatch'), asyncHandler(async (req, res) => {
  const { page, pageSize, search, status } = z.object({
    page:     z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(200).default(50),
    search:   z.string().trim().max(120).optional(),
    status:   z.enum(['PENDING', 'RECEIVED', 'IN_REWORK', 'REDISPATCHED', 'CLOSED', 'CANCELLED', 'ALL']).default('ALL'),
  }).parse(req.query);

  const where = {
    companyId: req.tenant.companyId,
    ...(status !== 'ALL' ? { status } : {}),
    ...(search
      ? {
          OR: [
            { returnNumber:   { contains: search } },
            { referenceValue: { contains: search } },
            { customer:  { name: { contains: search } } },
            { reason:    { contains: search } },
            { items: { some: { poOrderItem: { measure: { contains: search } } } } },
          ],
        }
      : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.return.findMany({
      where,
      orderBy: { returnDate: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { customer: true, items: itemInclude },
    }),
    prisma.return.count({ where }),
  ]);

  res.json({ items: rows.map(flattenReturn), total, page, pageSize });
}));

/* ---------- GET /:id ---------- */
router.get('/:id', requireAnyPermission('manage_returns', 'dispatch'), asyncHandler(async (req, res) => {
  const r = await prisma.return.findFirst({
    where: { id: req.params.id, companyId: req.tenant.companyId },
    include: { customer: true, items: itemInclude },
  });
  if (!r) throw new AppError('Return not found', 404, 'NOT_FOUND');
  res.json(flattenReturn(r));
}));

/* ---------- POST / ---------- */
router.post('/', requireAnyPermission('manage_returns', 'dispatch'), asyncHandler(async (req, res) => {
  const data = createSchema.parse(req.body);

  // Customer must belong to active tenant.
  const customer = await prisma.customer.findFirst({
    where: { id: data.customerId, companyId: req.tenant.companyId },
  });
  if (!customer) throw new AppError('Customer not found', 400, 'BAD_CUSTOMER');

  // Each PoOrderItem must belong to the same tenant.
  const itemIds = data.items.map((i) => i.poOrderItemId);
  const owned = await prisma.poOrderItem.findMany({
    where: { id: { in: itemIds }, poOrder: { companyId: req.tenant.companyId } },
    select: { id: true },
  });
  if (owned.length !== itemIds.length) {
    throw new AppError('One or more PO items not found', 404, 'NOT_FOUND');
  }

  // Return number must be unique within the company.
  const dup = await prisma.return.findUnique({
    where: { companyId_returnNumber: { companyId: req.tenant.companyId, returnNumber: data.returnNumber } },
  });
  if (dup) throw new AppError('Return number already exists in this company', 409, 'RETURN_DUPLICATE');

  const created = await prisma.return.create({
    data: {
      returnNumber:   data.returnNumber,
      returnDate:     data.returnDate,
      referenceType:  data.referenceType,
      referenceValue: data.referenceValue,
      reason:         data.reason ?? null,
      notes:          data.notes  ?? null,
      companyId:      req.tenant.companyId,
      customerId:     customer.id,
      createdById:    req.auth.userId,
      items: {
        create: data.items.map((i) => ({
          poOrderItemId: i.poOrderItemId,
          pcs:           i.pcs,
          reason:        i.reason ?? null,
        })),
      },
    },
    include: { customer: true, items: itemInclude },
  });

  res.status(201).json(flattenReturn(created));
}));

/* ---------- PATCH /:id — edit metadata only (not items, not status) ---------- */
router.patch('/:id', requireAnyPermission('manage_returns', 'dispatch'), asyncHandler(async (req, res) => {
  const data = updateSchema.parse(req.body);
  const r = await prisma.return.findFirst({
    where: { id: req.params.id, companyId: req.tenant.companyId },
  });
  if (!r) throw new AppError('Return not found', 404, 'NOT_FOUND');

  const updated = await prisma.return.update({
    where: { id: r.id },
    data: {
      ...(data.returnNumber   !== undefined ? { returnNumber:   data.returnNumber }   : {}),
      ...(data.returnDate     !== undefined ? { returnDate:     data.returnDate }     : {}),
      ...(data.referenceType  !== undefined ? { referenceType:  data.referenceType }  : {}),
      ...(data.referenceValue !== undefined ? { referenceValue: data.referenceValue } : {}),
      ...(data.reason         !== undefined ? { reason:         data.reason ?? null } : {}),
      ...(data.notes          !== undefined ? { notes:          data.notes  ?? null } : {}),
    },
    include: { customer: true, items: itemInclude },
  });
  res.json(flattenReturn(updated));
}));

/* ---------- POST /:id/transition — move through the lifecycle ---------- */
const transitionSchema = z.object({
  to: z.enum(['RECEIVED', 'IN_REWORK', 'REDISPATCHED', 'CLOSED', 'CANCELLED']),
  vehicleNo: z.string().trim().max(80).optional().nullable(),
});

const ALLOWED = {
  PENDING:      new Set(['RECEIVED', 'CANCELLED']),
  RECEIVED:     new Set(['IN_REWORK', 'CANCELLED']),
  IN_REWORK:    new Set(['REDISPATCHED']),
  REDISPATCHED: new Set(['CLOSED']),
  CLOSED:       new Set(),
  CANCELLED:    new Set(),
};

router.post('/:id/transition', requireAnyPermission('manage_returns', 'dispatch'), asyncHandler(async (req, res) => {
  const { to, vehicleNo } = transitionSchema.parse(req.body);
  const r = await prisma.return.findFirst({
    where: { id: req.params.id, companyId: req.tenant.companyId },
  });
  if (!r) throw new AppError('Return not found', 404, 'NOT_FOUND');

  if (!ALLOWED[r.status].has(to)) {
    throw new AppError(`Cannot transition ${r.status} → ${to}`, 400, 'BAD_TRANSITION');
  }

  const now = new Date();
  const stamp = {
    RECEIVED:     { receivedAt: now },
    IN_REWORK:    { reworkAt: now },
    REDISPATCHED: { redispatchAt: now, redispatchVehicle: vehicleNo ?? null },
    CLOSED:       { closedAt: now },
    CANCELLED:    { closedAt: now },
  }[to];

  const updated = await prisma.return.update({
    where: { id: r.id },
    data: { status: to, ...stamp },
    include: { customer: true, items: itemInclude },
  });
  res.json(flattenReturn(updated));
}));

/* ---------- DELETE /:id ---------- */
router.delete('/:id', requireAnyPermission('manage_returns', 'dispatch'), asyncHandler(async (req, res) => {
  const r = await prisma.return.findFirst({
    where: { id: req.params.id, companyId: req.tenant.companyId },
  });
  if (!r) throw new AppError('Return not found', 404, 'NOT_FOUND');
  await prisma.return.delete({ where: { id: r.id } });
  res.status(204).end();
}));

export default router;
