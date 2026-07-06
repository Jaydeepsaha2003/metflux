// Master list of grade + material combinations for the PO entry dropdowns.
import { Router } from 'express';
import { z } from 'zod';
import { q, qOne, insert, update, del } from '../lib/db.js';
import { AppError, asyncHandler } from '../lib/errors.js';
import { requireAuth, requirePermission } from '../lib/auth.js';
import { resolveTenant } from '../lib/tenant.js';
import { importBody, cellPick, rowIsBlank, errMessage } from '../lib/importHelpers.js';

const router = Router();
router.use(requireAuth, resolveTenant);

const CORE_TYPES = ['TOROIDAL', 'RECTANGULAR', 'NANO', 'COMPOSITE'];
const parseCore = (s) => {
  const a = String(s || '').split(',').map((x) => x.trim()).filter((x) => CORE_TYPES.includes(x));
  return a.length ? a : CORE_TYPES.slice(); // legacy rows → applies to all
};
const num = (v) => (v == null || v === '' || Number.isNaN(Number(v)) ? null : Number(v));

/* ---------- GET /api/material-grades — grouped { grade, materials, coreTypes, nano offsets } ---------- */
router.get('/', asyncHandler(async (req, res) => {
  const rows = await q(
    'SELECT * FROM `MaterialGrade` WHERE `companyId` = ? ORDER BY `grade` ASC, `material` ASC',
    [req.tenant.companyId]
  );
  const map = new Map();
  for (const r of rows) {
    if (!map.has(r.grade)) {
      map.set(r.grade, {
        grade: r.grade, materials: [],
        coreTypes: parseCore(r.coreTypes),
        nanoIdOff: num(r.nanoIdOff), nanoOdOff: num(r.nanoOdOff), nanoHtOff: num(r.nanoHtOff),
      });
    }
    map.get(r.grade).materials.push({ id: r.id, material: r.material });
  }
  res.json({ grades: [...map.values()] });
}));

/* ---------- GET /api/material-grades/_flat — flat list for the admin table ---------- */
router.get('/_flat', asyncHandler(async (req, res) => {
  const rows = await q(
    'SELECT * FROM `MaterialGrade` WHERE `companyId` = ? ORDER BY `grade` ASC, `material` ASC',
    [req.tenant.companyId]
  );
  const items = rows.map((r) => ({
    id: r.id, grade: r.grade, material: r.material, createdAt: r.createdAt,
    coreTypes: parseCore(r.coreTypes),
    nanoIdOff: num(r.nanoIdOff), nanoOdOff: num(r.nanoOdOff), nanoHtOff: num(r.nanoHtOff),
  }));
  res.json({ items });
}));

const upsertSchema = z.object({
  grade: z.string().trim().min(1).max(80),
  material: z.string().trim().min(1).max(120),
  coreTypes: z.array(z.enum(['TOROIDAL', 'RECTANGULAR', 'NANO', 'COMPOSITE'])).optional(),
  nanoIdOff: z.coerce.number().optional().nullable(),
  nanoOdOff: z.coerce.number().optional().nullable(),
  nanoHtOff: z.coerce.number().optional().nullable(),
});

// Core types + nano offsets are grade-level — keep every row of a grade in sync.
const syncGradeAttrs = (companyId, grade, d) => q(
  'UPDATE `MaterialGrade` SET `coreTypes` = ?, `nanoIdOff` = ?, `nanoOdOff` = ?, `nanoHtOff` = ? WHERE `companyId` = ? AND `grade` = ?',
  [(d.coreTypes && d.coreTypes.length ? d.coreTypes : CORE_TYPES).join(','), num(d.nanoIdOff), num(d.nanoOdOff), num(d.nanoHtOff), companyId, grade]
);

/* ---------- POST /api/material-grades — add a grade/material combo ---------- */
router.post('/', requirePermission('add_material'), asyncHandler(async (req, res) => {
  const data = upsertSchema.parse(req.body);
  const { grade, material } = data;
  const companyId = req.tenant.companyId;
  const csv = (data.coreTypes && data.coreTypes.length ? data.coreTypes : CORE_TYPES).join(',');
  const existing = await qOne(
    'SELECT * FROM `MaterialGrade` WHERE `companyId` = ? AND `grade` = ? AND `material` = ?',
    [companyId, grade, material]
  );
  let row = existing;
  if (!existing) {
    row = await insert('MaterialGrade', {
      grade, material, companyId,
      coreTypes: csv, nanoIdOff: num(data.nanoIdOff), nanoOdOff: num(data.nanoOdOff), nanoHtOff: num(data.nanoHtOff),
    });
  }
  // Apply the grade-level attributes to every row of this grade.
  await syncGradeAttrs(companyId, grade, data);
  res.status(201).json(row);
}));

/* ---------- PATCH /api/material-grades/:id — edit grade or material ---------- */
router.patch('/:id', requirePermission('add_material'), asyncHandler(async (req, res) => {
  const data = upsertSchema.partial().parse(req.body);
  const row = await qOne(
    'SELECT * FROM `MaterialGrade` WHERE `id` = ? AND `companyId` = ?',
    [req.params.id, req.tenant.companyId]
  );
  if (!row) throw new AppError('Not found', 404, 'NOT_FOUND');
  const patch = {};
  if (data.grade !== undefined) patch.grade = data.grade;
  if (data.material !== undefined) patch.material = data.material;
  const updated = Object.keys(patch).length ? await update('MaterialGrade', row.id, patch) : row;
  // Grade-level attrs sync across the (possibly renamed) grade.
  if (data.coreTypes !== undefined || data.nanoIdOff !== undefined || data.nanoOdOff !== undefined || data.nanoHtOff !== undefined) {
    await syncGradeAttrs(req.tenant.companyId, data.grade ?? row.grade, {
      coreTypes: data.coreTypes ?? parseCore(row.coreTypes),
      nanoIdOff: data.nanoIdOff !== undefined ? data.nanoIdOff : row.nanoIdOff,
      nanoOdOff: data.nanoOdOff !== undefined ? data.nanoOdOff : row.nanoOdOff,
      nanoHtOff: data.nanoHtOff !== undefined ? data.nanoHtOff : row.nanoHtOff,
    });
  }
  res.json(updated);
}));

/* ---------- POST /api/material-grades/import — bulk add grade/material combos ---------- */
router.post('/import', requirePermission('add_material'), asyncHandler(async (req, res) => {
  const { rows } = importBody.parse(req.body);
  let created = 0, updated = 0, skipped = 0;
  const errors = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNo = i + 2;
    if (rowIsBlank(row)) { skipped++; continue; }

    const gradeRaw = cellPick(row, 'Grade');
    const materialRaw = cellPick(row, 'Material');
    if (!gradeRaw || !materialRaw) {
      errors.push({ row: rowNo, name: gradeRaw || materialRaw, message: 'Both Grade and Material are required' });
      continue;
    }
    try {
      const { grade, material } = upsertSchema.parse({ grade: gradeRaw, material: materialRaw });
      const existing = await qOne(
        'SELECT `id` FROM `MaterialGrade` WHERE `companyId` = ? AND `grade` = ? AND `material` = ?',
        [req.tenant.companyId, grade, material]
      );
      if (existing) { skipped += 1; continue; } // identical combo already present
      await insert('MaterialGrade', { grade, material, companyId: req.tenant.companyId });
      created += 1;
    } catch (e) {
      errors.push({ row: rowNo, name: `${gradeRaw} / ${materialRaw}`, message: errMessage(e) });
    }
  }

  res.json({ created, updated, skipped, errors });
}));

/* ---------- DELETE /api/material-grades/:id ---------- */
router.delete('/:id', requirePermission('add_material'), asyncHandler(async (req, res) => {
  const row = await qOne(
    'SELECT `id` FROM `MaterialGrade` WHERE `id` = ? AND `companyId` = ?',
    [req.params.id, req.tenant.companyId]
  );
  if (!row) throw new AppError('Not found', 404, 'NOT_FOUND');
  await del('MaterialGrade', row.id);
  res.status(204).end();
}));

export default router;
