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

/* ---------- GET /api/material-grades — grouped { grade: [materials] } ---------- */
router.get('/', asyncHandler(async (req, res) => {
  const rows = await q(
    'SELECT * FROM `MaterialGrade` WHERE `companyId` = ? ORDER BY `grade` ASC, `material` ASC',
    [req.tenant.companyId]
  );
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
  const items = await q(
    'SELECT * FROM `MaterialGrade` WHERE `companyId` = ? ORDER BY `grade` ASC, `material` ASC',
    [req.tenant.companyId]
  );
  res.json({ items });
}));

const upsertSchema = z.object({
  grade: z.string().trim().min(1).max(80),
  material: z.string().trim().min(1).max(120),
});

/* ---------- POST /api/material-grades — add a grade/material combo ---------- */
router.post('/', requirePermission('add_material'), asyncHandler(async (req, res) => {
  const { grade, material } = upsertSchema.parse(req.body);
  // Upsert on (companyId, grade, material).
  const existing = await qOne(
    'SELECT * FROM `MaterialGrade` WHERE `companyId` = ? AND `grade` = ? AND `material` = ?',
    [req.tenant.companyId, grade, material]
  );
  if (existing) return res.status(201).json(existing);
  const created = await insert('MaterialGrade', {
    grade, material, companyId: req.tenant.companyId,
  });
  res.status(201).json(created);
}));

/* ---------- PATCH /api/material-grades/:id — edit grade or material ---------- */
router.patch('/:id', requirePermission('add_material'), asyncHandler(async (req, res) => {
  const data = upsertSchema.partial().parse(req.body);
  const row = await qOne(
    'SELECT * FROM `MaterialGrade` WHERE `id` = ? AND `companyId` = ?',
    [req.params.id, req.tenant.companyId]
  );
  if (!row) throw new AppError('Not found', 404, 'NOT_FOUND');
  const updated = await update('MaterialGrade', row.id, data);
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
