// Customers CRUD — scoped to the active company. Copy this file as a template
// for any new tenant-scoped resource (invoices, products, etc.).
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/db.js';
import { AppError, asyncHandler } from '../lib/errors.js';
import { requireAuth, requireRole } from '../lib/auth.js';
import { resolveTenant, tenantWhere } from '../lib/tenant.js';

const router = Router();

router.use(requireAuth, resolveTenant);

const idParam = z.object({ id: z.string().min(1) });
const paginationQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(20),
  search: z.string().trim().max(120).optional(),
});
const customerInput = z.object({
  name: z.string().trim().min(1).max(160),
  email: z.string().email().optional().nullable().or(z.literal('')),
  phone: z.string().trim().max(40).optional().nullable(),
  address: z.string().trim().max(400).optional().nullable(),
  gstNumber: z.string().trim().max(40).optional().nullable(),
  gstRate: z.coerce.number().min(0).max(100).optional(),
  state: z.string().trim().max(80).optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
}).transform((v) => ({
  ...v,
  email: v.email === '' ? null : v.email,
}));

// Ensures the row belongs to the active tenant — used before update/delete.
const findOwned = async (req, id) => {
  const item = await prisma.customer.findFirst({ where: tenantWhere(req, { id }) });
  if (!item) throw new AppError('Customer not found', 404, 'NOT_FOUND');
  return item;
};

// GET /api/customers
router.get('/', asyncHandler(async (req, res) => {
  const { page, pageSize, search } = paginationQuery.parse(req.query);
  const where = tenantWhere(req, search
    ? { OR: [
        { name:  { contains: search } },
        { email: { contains: search } },
        { phone: { contains: search } },
      ] }
    : {});

  const [items, total] = await Promise.all([
    prisma.customer.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.customer.count({ where }),
  ]);

  res.json({ items, total, page, pageSize });
}));

// GET /api/customers/:id
router.get('/:id', asyncHandler(async (req, res) => {
  const { id } = idParam.parse(req.params);
  res.json(await findOwned(req, id));
}));

// POST /api/customers
router.post('/', requireRole('STAFF'), asyncHandler(async (req, res) => {
  const data = customerInput.parse(req.body);
  const created = await prisma.customer.create({
    data: { ...data, companyId: req.tenant.companyId, createdById: req.auth.userId },
  });
  res.status(201).json(created);
}));

// PATCH /api/customers/:id
router.patch('/:id', requireRole('STAFF'), asyncHandler(async (req, res) => {
  const { id } = idParam.parse(req.params);
  const data = customerInput.partial().parse(req.body);
  await findOwned(req, id);
  res.json(await prisma.customer.update({ where: { id }, data }));
}));

// DELETE /api/customers/:id — managers and up
router.delete('/:id', requireRole('MANAGER'), asyncHandler(async (req, res) => {
  const { id } = idParam.parse(req.params);
  await findOwned(req, id);
  await prisma.customer.delete({ where: { id } });
  res.status(204).end();
}));

export default router;
