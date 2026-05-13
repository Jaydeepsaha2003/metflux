// Labour/worker management. A Labour record is global; LabourMembership
// links them to one or more companies. The /dropdown endpoint returns only
// workers assigned to the current company, used by the production form.
import { Router } from 'express';
import { z } from 'zod';
import { q, qOne, insert, update, del, txn } from '../lib/db.js';
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

// Returns a labour row + its company memberships in the shape the front-end
// expects: { ..., companies: [{ company: {id, name}, ... }, ...] }.
const loadCompanies = async (labourId) => {
  const rows = await q(
    `SELECT lm.\`id\` AS lm_id, lm.\`labourId\`, lm.\`companyId\`, lm.\`createdAt\`,
            c.\`id\` AS c_id, c.\`name\` AS c_name
       FROM \`LabourMembership\` lm
       INNER JOIN \`Company\` c ON c.\`id\` = lm.\`companyId\`
      WHERE lm.\`labourId\` = ?`,
    [labourId]
  );
  return rows.map((r) => ({
    id: r.lm_id,
    labourId: r.labourId,
    companyId: r.companyId,
    createdAt: r.createdAt,
    company: { id: r.c_id, name: r.c_name },
  }));
};

const withCompanies = async (labour) => {
  if (!labour) return labour;
  return { ...labour, companies: await loadCompanies(labour.id) };
};

// True iff the given labour is currently assigned to the active tenant.
const isLabourInTenant = (labourId, companyId) => qOne(
  'SELECT `id` FROM `LabourMembership` WHERE `labourId` = ? AND `companyId` = ?',
  [labourId, companyId]
);

/* ---------- GET /dropdown — workers for active company (for production form) ---------- */
router.get('/dropdown', requireAnyPermission('rec_production', 'assign_work'), asyncHandler(async (req, res) => {
  const rows = await q(
    `SELECT l.\`id\`, l.\`name\`
       FROM \`Labour\` l
       INNER JOIN \`LabourMembership\` lm ON lm.\`labourId\` = l.\`id\`
      WHERE l.\`isActive\` = 1 AND lm.\`companyId\` = ?
      ORDER BY l.\`name\` ASC`,
    [req.tenant.companyId]
  );
  res.json({ labours: rows });
}));

/* ---------- GET / — labours visible to active company ---------- */
router.get('/', requirePermission('add_staff'), asyncHandler(async (req, res) => {
  const { search } = z.object({ search: z.string().trim().max(120).optional() }).parse(req.query);

  let sql = `SELECT DISTINCT l.* FROM \`Labour\` l
             INNER JOIN \`LabourMembership\` lm ON lm.\`labourId\` = l.\`id\`
             WHERE lm.\`companyId\` = ?`;
  const params = [req.tenant.companyId];
  if (search) { sql += ' AND l.`name` LIKE ?'; params.push(`%${search}%`); }
  sql += ' ORDER BY l.`name` ASC';
  const rows = await q(sql, params);
  const labours = await Promise.all(rows.map(withCompanies));
  res.json({ labours });
}));

/* ---------- GET /:id ---------- */
router.get('/:id', requirePermission('add_staff'), asyncHandler(async (req, res) => {
  const lm = await isLabourInTenant(req.params.id, req.tenant.companyId);
  if (!lm) throw new AppError('Labour not found', 404, 'NOT_FOUND');
  const labour = await qOne('SELECT * FROM `Labour` WHERE `id` = ?', [req.params.id]);
  if (!labour) throw new AppError('Labour not found', 404, 'NOT_FOUND');
  res.json(await withCompanies(labour));
}));

/* ---------- POST / — create + assign to companies ---------- */
router.post('/', requirePermission('add_staff'), asyncHandler(async (req, res) => {
  const { name, phone, companyIds } = bodySchema.parse(req.body);

  const labour = await txn(async (tx) => {
    const created = await tx.insert('Labour', { name, phone: phone ?? null });
    for (const cid of companyIds) {
      await tx.insert('LabourMembership', { labourId: created.id, companyId: cid });
    }
    return created;
  });
  res.status(201).json(await withCompanies(labour));
}));

/* ---------- PATCH /:id ---------- */
router.patch('/:id', requirePermission('add_staff'), asyncHandler(async (req, res) => {
  const { name, phone, isActive, companyIds } = bodySchema.partial().extend({
    companyIds: z.array(z.string()).min(1).optional(),
  }).parse(req.body);

  const lm = await isLabourInTenant(req.params.id, req.tenant.companyId);
  if (!lm) throw new AppError('Labour not found', 404, 'NOT_FOUND');

  const labour = await txn(async (tx) => {
    if (companyIds !== undefined) {
      await tx.q('DELETE FROM `LabourMembership` WHERE `labourId` = ?', [req.params.id]);
      const seen = new Set();
      for (const cid of companyIds) {
        if (seen.has(cid)) continue;
        seen.add(cid);
        await tx.insert('LabourMembership', { labourId: req.params.id, companyId: cid });
      }
    }
    const patch = {};
    if (name !== undefined) patch.name = name;
    if (phone !== undefined) patch.phone = phone ?? null;
    if (isActive !== undefined) patch.isActive = isActive;
    if (Object.keys(patch).length) await tx.update('Labour', req.params.id, patch);
    return tx.qOne('SELECT * FROM `Labour` WHERE `id` = ?', [req.params.id]);
  });
  res.json(await withCompanies(labour));
}));

/* ---------- DELETE /:id ---------- */
router.delete('/:id', requirePermission('add_staff'), asyncHandler(async (req, res) => {
  const lm = await isLabourInTenant(req.params.id, req.tenant.companyId);
  if (!lm) throw new AppError('Labour not found', 404, 'NOT_FOUND');
  await del('Labour', req.params.id);
  res.status(204).end();
}));

export default router;
