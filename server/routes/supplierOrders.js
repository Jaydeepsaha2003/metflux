// Supplier Purchase Orders — material orders we place WITH a supplier.
// Each order has many SupplierOrderItems carrying HSN code, qty, rate, amount.
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/db.js';
import { AppError, asyncHandler } from '../lib/errors.js';
import { requireAuth, requirePermission } from '../lib/auth.js';
import { resolveTenant, tenantWhere } from '../lib/tenant.js';

const router = Router();
router.use(requireAuth, resolveTenant);

const itemSchema = z.object({
  description: z.string().trim().min(1).max(300),
  hsnCode:     z.string().trim().max(20).optional().nullable(),
  qty:         z.coerce.number().positive(),
  unit:        z.string().trim().min(1).max(20),
  rate:        z.coerce.number().nonnegative(),
  amount:      z.coerce.number().nonnegative(),
});

const createSchema = z.object({
  poNumber:     z.string().trim().min(1).max(60),
  supplierId:   z.string().min(1),
  orderDate:    z.coerce.date(),
  expectedDate: z.coerce.date().optional().nullable(),
  notes:        z.string().max(2000).optional().nullable(),
  items:        z.array(itemSchema).min(1, 'Add at least one item'),
});

const updateSchema = z.object({
  poNumber:     z.string().trim().min(1).max(60),
  supplierId:   z.string().min(1),
  orderDate:    z.coerce.date(),
  expectedDate: z.coerce.date().optional().nullable(),
  status:       z.enum(['PENDING', 'PARTIAL', 'RECEIVED', 'CANCELLED']).optional(),
  notes:        z.string().max(2000).optional().nullable(),
  items:        z.array(itemSchema.extend({ id: z.string().optional() })).min(1),
});

const receiveSchema = z.object({
  // Map of itemId → received qty (cumulative, not delta).
  receipts: z.record(z.string(), z.coerce.number().min(0)),
});

const baseInclude = {
  items:    { orderBy: { createdAt: 'asc' } },
  supplier: { select: { id: true, name: true, gstNumber: true, gstRate: true, state: true, address: true } },
};

const findOwned = async (req, id) => {
  const po = await prisma.supplierOrder.findFirst({
    where: tenantWhere(req, { id }),
    include: baseInclude,
  });
  if (!po) throw new AppError('Supplier order not found', 404, 'NOT_FOUND');
  return po;
};

/* ---------- POST /api/supplier-orders ---------- */
router.post('/', requirePermission('add_supplier_po'), asyncHandler(async (req, res) => {
  const data = createSchema.parse(req.body);

  const supplier = await prisma.supplier.findFirst({
    where: tenantWhere(req, { id: data.supplierId }),
  });
  if (!supplier) throw new AppError('Supplier not found', 400, 'BAD_SUPPLIER');

  const dup = await prisma.supplierOrder.findUnique({
    where: { companyId_poNumber: { companyId: req.tenant.companyId, poNumber: data.poNumber } },
  });
  if (dup) throw new AppError('PO number already exists in this company', 409, 'PO_DUPLICATE');

  const created = await prisma.supplierOrder.create({
    data: {
      poNumber:     data.poNumber,
      orderDate:    data.orderDate,
      expectedDate: data.expectedDate ?? null,
      notes:        data.notes ?? null,
      companyId:    req.tenant.companyId,
      supplierId:   supplier.id,
      createdById:  req.auth.userId,
      items: {
        create: data.items.map((it) => ({
          description: it.description,
          hsnCode:     it.hsnCode ?? null,
          qty:         it.qty,
          unit:        it.unit,
          rate:        it.rate,
          amount:      it.amount,
        })),
      },
    },
    include: baseInclude,
  });

  res.status(201).json(created);
}));

/* ---------- GET /api/supplier-orders ---------- */
router.get('/', requirePermission('view_supplier_po'), asyncHandler(async (req, res) => {
  const { page, pageSize, search, status } = z.object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(200).default(50),
    search: z.string().trim().max(120).optional(),
    status: z.enum(['PENDING', 'PARTIAL', 'RECEIVED', 'CANCELLED', 'ALL']).default('ALL'),
  }).parse(req.query);

  const where = tenantWhere(req, {
    ...(status !== 'ALL' ? { status } : {}),
    ...(search
      ? {
          OR: [
            { poNumber: { contains: search } },
            { supplier: { name: { contains: search } } },
            { items: { some: { description: { contains: search } } } },
            { items: { some: { hsnCode: { contains: search } } } },
          ],
        }
      : {}),
  });

  const [items, total] = await Promise.all([
    prisma.supplierOrder.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: baseInclude,
    }),
    prisma.supplierOrder.count({ where }),
  ]);

  res.json({ items, total, page, pageSize });
}));

/* ---------- GET /api/supplier-orders/:id ---------- */
router.get('/:id', requirePermission('view_supplier_po'), asyncHandler(async (req, res) => {
  res.json(await findOwned(req, req.params.id));
}));

/* ---------- PUT /api/supplier-orders/:id — full replace including items ---------- */
router.put('/:id', requirePermission('add_supplier_po'), asyncHandler(async (req, res) => {
  const data = updateSchema.parse(req.body);
  const existing = await findOwned(req, req.params.id);

  // Verify supplier still belongs to tenant.
  const supplier = await prisma.supplier.findFirst({
    where: tenantWhere(req, { id: data.supplierId }),
  });
  if (!supplier) throw new AppError('Supplier not found', 400, 'BAD_SUPPLIER');

  // Replace items in a transaction — easier than diffing.
  const updated = await prisma.$transaction(async (tx) => {
    await tx.supplierOrderItem.deleteMany({ where: { supplierOrderId: existing.id } });
    return tx.supplierOrder.update({
      where: { id: existing.id },
      data: {
        poNumber:     data.poNumber,
        orderDate:    data.orderDate,
        expectedDate: data.expectedDate ?? null,
        status:       data.status ?? existing.status,
        notes:        data.notes ?? null,
        supplierId:   supplier.id,
        items: {
          create: data.items.map((it) => ({
            description: it.description,
            hsnCode:     it.hsnCode ?? null,
            qty:         it.qty,
            unit:        it.unit,
            rate:        it.rate,
            amount:      it.amount,
          })),
        },
      },
      include: baseInclude,
    });
  });

  res.json(updated);
}));

/* ---------- POST /api/supplier-orders/:id/receive — record received quantities ---------- */
router.post('/:id/receive', requirePermission('add_supplier_po'), asyncHandler(async (req, res) => {
  const { receipts } = receiveSchema.parse(req.body);
  const po = await findOwned(req, req.params.id);

  // Apply each receipt; clamp to ordered qty so we never over-receive.
  await prisma.$transaction(async (tx) => {
    for (const item of po.items) {
      const cumulative = receipts[item.id];
      if (cumulative === undefined) continue;
      const clamped = Math.min(cumulative, item.qty);
      await tx.supplierOrderItem.update({
        where: { id: item.id },
        data: { receivedQty: clamped },
      });
    }
  });

  // Recompute order status from items.
  const fresh = await prisma.supplierOrder.findUnique({
    where: { id: po.id }, include: { items: true },
  });
  const allFull = fresh.items.every((it) => it.receivedQty >= it.qty);
  const anyPartial = fresh.items.some((it) => it.receivedQty > 0);
  const newStatus = allFull ? 'RECEIVED' : anyPartial ? 'PARTIAL' : 'PENDING';

  const updated = await prisma.supplierOrder.update({
    where: { id: po.id }, data: { status: newStatus }, include: baseInclude,
  });
  res.json(updated);
}));

/* ---------- DELETE /api/supplier-orders/:id ---------- */
router.delete('/:id', requirePermission('add_supplier_po'), asyncHandler(async (req, res) => {
  await findOwned(req, req.params.id);
  await prisma.supplierOrder.delete({ where: { id: req.params.id } });
  res.status(204).end();
}));

export default router;
