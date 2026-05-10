// Labour/worker management. A Labour record is global; LabourMembership
// links them to one or more companies. The /dropdown endpoint returns only
// workers assigned to the current company, used by the production form.
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/db.js';
import { AppError, asyncHandler } from '../lib/errors.js';
import { requireAuth, requirePermission, requireAnyPermission } from '../lib/auth.js';
import { resolveTenant } from '../lib/tenant.js';

const router = Router();
router.use(requireAuth, resolveTenant);

const bodySchema = z.object({
  name: z.string().trim().min(1).max(120),
  phone: z.string().trim().max(40).optional().nullable(),
  isActive: z.boolean().optional(),
  companyIds: z.array(z.string()).min(1, 'Assign to at least one company'),
});

/* ---------- GET /dropdown — workers for active company (for production form) ---------- */
router.get('/dropdown', requireAnyPermission('rec_production', 'assign_work'), asyncHandler(async (req, res) => {
  const rows = await prisma.labour.findMany({
    where: {
      isActive: true,
      companies: { some: { companyId: req.tenant.companyId } },
    },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  });
  res.json({ labours: rows });
}));

/* ---------- GET / — list all labours visible to platform admins, or company-scoped ---------- */
router.get('/', requirePermission('add_staff'), asyncHandler(async (req, res) => {
  const { search } = z.object({ search: z.string().trim().max(120).optional() }).parse(req.query);

  const labours = await prisma.labour.findMany({
    where: {
      companies: { some: { companyId: req.tenant.companyId } },
      ...(search ? { name: { contains: search } } : {}),
    },
    include: {
      companies: { include: { company: { select: { id: true, name: true } } } },
    },
    orderBy: { name: 'asc' },
  });

  res.json({ labours });
}));

/* ---------- GET /:id ---------- */
router.get('/:id', requirePermission('add_staff'), asyncHandler(async (req, res) => {
  const labour = await prisma.labour.findFirst({
    where: {
      id: req.params.id,
      companies: { some: { companyId: req.tenant.companyId } },
    },
    include: {
      companies: { include: { company: { select: { id: true, name: true } } } },
    },
  });
  if (!labour) throw new AppError('Labour not found', 404, 'NOT_FOUND');
  res.json(labour);
}));

/* ---------- POST / — create + assign to companies ---------- */
router.post('/', requirePermission('add_staff'), asyncHandler(async (req, res) => {
  const { name, phone, companyIds } = bodySchema.parse(req.body);

  const labour = await prisma.labour.create({
    data: {
      name,
      phone: phone ?? null,
      companies: {
        create: companyIds.map((cid) => ({ companyId: cid })),
      },
    },
    include: {
      companies: { include: { company: { select: { id: true, name: true } } } },
    },
  });
  res.status(201).json(labour);
}));

/* ---------- PATCH /:id ---------- */
router.patch('/:id', requirePermission('add_staff'), asyncHandler(async (req, res) => {
  const { name, phone, isActive, companyIds } = bodySchema.partial().extend({
    companyIds: z.array(z.string()).min(1).optional(),
  }).parse(req.body);

  const existing = await prisma.labour.findFirst({
    where: {
      id: req.params.id,
      companies: { some: { companyId: req.tenant.companyId } },
    },
  });
  if (!existing) throw new AppError('Labour not found', 404, 'NOT_FOUND');

  const labour = await prisma.$transaction(async (tx) => {
    if (companyIds !== undefined) {
      await tx.labourMembership.deleteMany({ where: { labourId: existing.id } });
      await tx.labourMembership.createMany({
        data: companyIds.map((cid) => ({ labourId: existing.id, companyId: cid })),
        skipDuplicates: true,
      });
    }
    return tx.labour.update({
      where: { id: existing.id },
      data: {
        ...(name !== undefined ? { name } : {}),
        ...(phone !== undefined ? { phone: phone ?? null } : {}),
        ...(isActive !== undefined ? { isActive } : {}),
      },
      include: {
        companies: { include: { company: { select: { id: true, name: true } } } },
      },
    });
  });

  res.json(labour);
}));

/* ---------- DELETE /:id ---------- */
router.delete('/:id', requirePermission('add_staff'), asyncHandler(async (req, res) => {
  const existing = await prisma.labour.findFirst({
    where: {
      id: req.params.id,
      companies: { some: { companyId: req.tenant.companyId } },
    },
  });
  if (!existing) throw new AppError('Labour not found', 404, 'NOT_FOUND');
  await prisma.labour.delete({ where: { id: existing.id } });
  res.status(204).end();
}));

export default router;
