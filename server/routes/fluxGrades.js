// Flux-test calibration table — per-grade ATe/cm at given flux densities,
// split by core type (toroidal / rectangular) since the BH curve can differ.
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/db.js';
import { AppError, asyncHandler } from '../lib/errors.js';
import { requireAuth, requirePermission } from '../lib/auth.js';
import { resolveTenant, tenantWhere } from '../lib/tenant.js';

const router = Router();
router.use(requireAuth, resolveTenant);

const inputSchema = z.object({
  grade:    z.string().trim().min(1).max(80),
  flux:     z.coerce.number().positive().max(10),
  coreType: z.enum(['TOROIDAL', 'RECTANGULAR']),
  ateCm:    z.coerce.number().nonnegative().max(50).optional(),
  notes:    z.string().trim().max(200).optional().nullable(),
});

/* ---------- GET /api/flux-grades — flat list ---------- */
router.get('/', asyncHandler(async (req, res) => {
  const items = await prisma.fluxGrade.findMany({
    where: tenantWhere(req),
    orderBy: [{ grade: 'asc' }, { coreType: 'asc' }, { flux: 'asc' }],
  });
  res.json({ items });
}));

/* ---------- GET /api/flux-grades/grouped — for the calculator ---------- */
/* Optional ?coreType=TOROIDAL|RECTANGULAR filters to one core type.        */
router.get('/grouped', asyncHandler(async (req, res) => {
  const { coreType } = z.object({
    coreType: z.enum(['TOROIDAL', 'RECTANGULAR']).optional(),
  }).parse(req.query);

  const rows = await prisma.fluxGrade.findMany({
    where: tenantWhere(req, coreType ? { coreType } : {}),
    orderBy: [{ grade: 'asc' }, { flux: 'asc' }],
  });

  const map = new Map();
  for (const r of rows) {
    if (!map.has(r.grade)) map.set(r.grade, []);
    map.get(r.grade).push({ id: r.id, flux: r.flux, ateCm: r.ateCm, coreType: r.coreType });
  }
  res.json({ grades: Array.from(map, ([grade, points]) => ({ grade, points })) });
}));

/* ---------- POST /api/flux-grades — create new row ---------- */
router.post('/', requirePermission('add_material'), asyncHandler(async (req, res) => {
  const { grade, flux, coreType, ateCm, notes } = inputSchema.parse(req.body);

  const existing = await prisma.fluxGrade.findUnique({
    where: {
      companyId_grade_flux_coreType: {
        companyId: req.tenant.companyId, grade, flux, coreType,
      },
    },
  });
  if (existing) {
    throw new AppError(
      `${grade} @ ${flux} T (${coreType}) already exists — edit it from the table`,
      409, 'DUPLICATE'
    );
  }

  const created = await prisma.fluxGrade.create({
    data: {
      grade, flux, coreType,
      ateCm: ateCm ?? 0,
      notes: notes ?? null,
      companyId: req.tenant.companyId,
    },
  });
  res.status(201).json(created);
}));

/* ---------- PATCH /api/flux-grades/:id ---------- */
router.patch('/:id', requirePermission('add_material'), asyncHandler(async (req, res) => {
  const data = inputSchema.partial().parse(req.body);
  const row = await prisma.fluxGrade.findFirst({ where: tenantWhere(req, { id: req.params.id }) });
  if (!row) throw new AppError('Not found', 404, 'NOT_FOUND');

  // If any unique-key field changed, ensure no collision with another row.
  const keyChanged = ['grade', 'flux', 'coreType'].some(
    (k) => data[k] !== undefined && data[k] !== row[k]
  );
  if (keyChanged) {
    const conflict = await prisma.fluxGrade.findFirst({
      where: tenantWhere(req, {
        grade:    data.grade    ?? row.grade,
        flux:     data.flux     ?? row.flux,
        coreType: data.coreType ?? row.coreType,
        NOT: { id: row.id },
      }),
    });
    if (conflict) throw new AppError('Another row already uses that grade + flux + core type', 409, 'DUPLICATE');
  }

  const updated = await prisma.fluxGrade.update({ where: { id: row.id }, data });
  res.json(updated);
}));

/* ---------- DELETE /api/flux-grades/:id ---------- */
router.delete('/:id', requirePermission('add_material'), asyncHandler(async (req, res) => {
  const row = await prisma.fluxGrade.findFirst({ where: tenantWhere(req, { id: req.params.id }) });
  if (!row) throw new AppError('Not found', 404, 'NOT_FOUND');
  await prisma.fluxGrade.delete({ where: { id: row.id } });
  res.status(204).end();
}));

/* ---------- POST /api/flux-grades/bulk — upsert many rows in one request ----------
   Used by the Excel bulk-upload feature. Each row is upserted on the unique
   (companyId, grade, flux, coreType) key — existing rows get their ATe/cm and
   notes refreshed; new rows are created. */
router.post('/bulk', requirePermission('add_material'), asyncHandler(async (req, res) => {
  const { rows } = z.object({
    rows: z.array(inputSchema).min(1).max(500),
  }).parse(req.body);

  let inserted = 0;
  let updated  = 0;
  const errors = [];

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    try {
      const existing = await prisma.fluxGrade.findUnique({
        where: {
          companyId_grade_flux_coreType: {
            companyId: req.tenant.companyId, grade: r.grade, flux: r.flux, coreType: r.coreType,
          },
        },
      });
      await prisma.fluxGrade.upsert({
        where: {
          companyId_grade_flux_coreType: {
            companyId: req.tenant.companyId, grade: r.grade, flux: r.flux, coreType: r.coreType,
          },
        },
        create: {
          grade: r.grade, flux: r.flux, coreType: r.coreType,
          ateCm: r.ateCm ?? 0, notes: r.notes ?? null,
          companyId: req.tenant.companyId,
        },
        update: { ateCm: r.ateCm ?? 0, notes: r.notes ?? null },
      });
      if (existing) updated += 1; else inserted += 1;
    } catch (e) {
      errors.push({ row: i + 1, message: e.message });
    }
  }

  res.json({ inserted, updated, errors, total: rows.length });
}));

/* ---------- POST /api/flux-grades/seed — load reference defaults (TOROIDAL only) ---------- */
router.post('/seed', requirePermission('add_material'), asyncHandler(async (req, res) => {
  const DEFAULTS = [
    { grade: 'M4',       flux: 0.5, ateCm: 0.12  },
    { grade: 'M4',       flux: 1.0, ateCm: 0.22  },
    { grade: 'M4',       flux: 1.5, ateCm: 0.32  },
    { grade: 'M5',       flux: 0.5, ateCm: 0.15  },
    { grade: 'M5',       flux: 1.0, ateCm: 0.28  },
    { grade: 'M5',       flux: 1.5, ateCm: 0.40  },
    { grade: 'M3',       flux: 0.5, ateCm: 0.09  },
    { grade: 'M3',       flux: 1.0, ateCm: 0.18  },
    { grade: 'M3',       flux: 1.5, ateCm: 0.30  },
    { grade: 'M3',       flux: 1.7, ateCm: 0.45  },
    { grade: 'M3 (MOH)', flux: 0.5, ateCm: 0.08  },
    { grade: 'M3 (MOH)', flux: 1.0, ateCm: 0.15  },
    { grade: 'M3 (MOH)', flux: 1.5, ateCm: 0.26  },
    { grade: 'M3 (MOH)', flux: 1.7, ateCm: 0.35  },
    { grade: 'ZDKH',     flux: 0.5, ateCm: 0.07  },
    { grade: 'ZDKH',     flux: 1.0, ateCm: 0.12  },
    { grade: 'ZDKH',     flux: 1.5, ateCm: 0.22  },
    { grade: 'ZDKH',     flux: 1.7, ateCm: 0.32  },
    { grade: 'ZDMH',     flux: 0.5, ateCm: 0.065 },
    { grade: 'ZDMH',     flux: 1.0, ateCm: 0.10  },
    { grade: 'ZDMH',     flux: 1.5, ateCm: 0.20  },
    { grade: 'ZDMH',     flux: 1.7, ateCm: 0.30  },
  ];

  await prisma.$transaction(
    DEFAULTS.map((d) =>
      prisma.fluxGrade.upsert({
        where: {
          companyId_grade_flux_coreType: {
            companyId: req.tenant.companyId, grade: d.grade, flux: d.flux, coreType: 'TOROIDAL',
          },
        },
        create: { ...d, coreType: 'TOROIDAL', companyId: req.tenant.companyId },
        update: {},
      })
    )
  );
  res.json({ inserted: DEFAULTS.length, note: 'Toroidal defaults — clone to Rectangular if needed' });
}));

export default router;
