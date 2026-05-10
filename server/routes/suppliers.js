// Suppliers CRUD — scoped to active company. Mirrors customers.js but adds
// a numeric gstRate (% applicable on supplier invoices, e.g. 18 for steel).
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/db.js';
import { AppError, asyncHandler } from '../lib/errors.js';
import { requireAuth, requirePermission } from '../lib/auth.js';
import { resolveTenant, tenantWhere } from '../lib/tenant.js';

const router = Router();
router.use(requireAuth, resolveTenant);

const idParam = z.object({ id: z.string().min(1) });
const paginationQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(20),
  search: z.string().trim().max(120).optional(),
});

const supplierInput = z.object({
  name:      z.string().trim().min(1).max(160),
  email:     z.string().email().optional().nullable().or(z.literal('')),
  phone:     z.string().trim().max(40).optional().nullable(),
  address:   z.string().trim().max(400).optional().nullable(),
  gstNumber: z.string().trim().max(40).optional().nullable(),
  state:     z.string().trim().max(80).optional().nullable(),
  gstRate:   z.coerce.number().min(0).max(100).default(0),
  notes:     z.string().trim().max(2000).optional().nullable(),
}).transform((v) => ({
  ...v,
  email: v.email === '' ? null : v.email,
}));

const findOwned = async (req, id) => {
  const item = await prisma.supplier.findFirst({ where: tenantWhere(req, { id }) });
  if (!item) throw new AppError('Supplier not found', 404, 'NOT_FOUND');
  return item;
};

// GET /api/suppliers
router.get('/', requirePermission('add_supplier'), asyncHandler(async (req, res) => {
  const { page, pageSize, search } = paginationQuery.parse(req.query);
  const where = tenantWhere(req, search
    ? { OR: [
        { name:      { contains: search } },
        { email:     { contains: search } },
        { phone:     { contains: search } },
        { gstNumber: { contains: search } },
      ] }
    : {});

  const [items, total] = await Promise.all([
    prisma.supplier.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.supplier.count({ where }),
  ]);

  res.json({ items, total, page, pageSize });
}));

// GET /api/suppliers/:id
router.get('/:id', requirePermission('add_supplier'), asyncHandler(async (req, res) => {
  const { id } = idParam.parse(req.params);
  res.json(await findOwned(req, id));
}));

// POST /api/suppliers
router.post('/', requirePermission('add_supplier'), asyncHandler(async (req, res) => {
  const data = supplierInput.parse(req.body);
  const created = await prisma.supplier.create({
    data: { ...data, companyId: req.tenant.companyId, createdById: req.auth.userId },
  });
  res.status(201).json(created);
}));

// PATCH /api/suppliers/:id
router.patch('/:id', requirePermission('add_supplier'), asyncHandler(async (req, res) => {
  const { id } = idParam.parse(req.params);
  const data = supplierInput.partial().parse(req.body);
  await findOwned(req, id);
  res.json(await prisma.supplier.update({ where: { id }, data }));
}));

// DELETE /api/suppliers/:id
router.delete('/:id', requirePermission('add_supplier'), asyncHandler(async (req, res) => {
  const { id } = idParam.parse(req.params);
  await findOwned(req, id);
  await prisma.supplier.delete({ where: { id } });
  res.status(204).end();
}));

export default router;
