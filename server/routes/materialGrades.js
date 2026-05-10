// Master list of grade + material combinations for the PO entry dropdowns.
// Ported from .NET material_grade_list table.
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/db.js';
import { AppError, asyncHandler } from '../lib/errors.js';
import { requireAuth, requirePermission } from '../lib/auth.js';
import { resolveTenant, tenantWhere } from '../lib/tenant.js';

const router = Router();
router.use(requireAuth, resolveTenant);

/* ---------- GET /api/material-grades — grouped { grade: [materials] } ---------- */
router.get('/', asyncHandler(async (req, res) => {
  const rows = await prisma.materialGrade.findMany({
    where: tenantWhere(req),
    orderBy: [{ grade: 'asc' }, { material: 'asc' }],
  });
  // Group by grade for the form's cascading dropdowns.
  const map = new Map();
  for (const r of rows) {
    if (!map.has(r.grade)) map.set(r.grade, []);
    map.get(r.grade).push({ id: r.id, material: r.material });
  }
  const grades = Array.from(map, ([grade, materials]) => ({ grade, materials }));
  res.json({ grades });
}));

/* ---------- GET /api/material-grades/_flat — flat list for the admin table ---------- */
router.get('/_flat', asyncHandler(async (req, res) => {
  const items = await prisma.materialGrade.findMany({
    where: tenantWhere(req),
    orderBy: [{ grade: 'asc' }, { material: 'asc' }],
  });
  res.json({ items });
}));

const upsertSchema = z.object({
  grade: z.string().trim().min(1).max(80),
  material: z.string().trim().min(1).max(120),
});

/* ---------- POST /api/material-grades — add a grade/material combo ---------- */
router.post('/', requirePermission('add_material'), asyncHandler(async (req, res) => {
  const { grade, material } = upsertSchema.parse(req.body);
  const created = await prisma.materialGrade.upsert({
    where: { companyId_grade_material: { companyId: req.tenant.companyId, grade, material } },
    create: { grade, material, companyId: req.tenant.companyId },
    update: {},
  });
  res.status(201).json(created);
}));

/* ---------- PATCH /api/material-grades/:id — edit grade or material ---------- */
router.patch('/:id', requirePermission('add_material'), asyncHandler(async (req, res) => {
  const data = upsertSchema.partial().parse(req.body);
  const row = await prisma.materialGrade.findFirst({ where: tenantWhere(req, { id: req.params.id }) });
  if (!row) throw new AppError('Not found', 404, 'NOT_FOUND');
  const updated = await prisma.materialGrade.update({ where: { id: row.id }, data });
  res.json(updated);
}));

/* ---------- DELETE /api/material-grades/:id ---------- */
router.delete('/:id', requirePermission('add_material'), asyncHandler(async (req, res) => {
  const row = await prisma.materialGrade.findFirst({ where: tenantWhere(req, { id: req.params.id }) });
  if (!row) throw new AppError('Not found', 404, 'NOT_FOUND');
  await prisma.materialGrade.delete({ where: { id: row.id } });
  res.status(204).end();
}));

export default router;
