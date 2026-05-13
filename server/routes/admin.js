// Admin tools — bulk data cleanup. COMPANY_ADMIN only (platform admins always
// pass via the role-rank check). Every operation is scoped to the active
// company so wiping in one tenant cannot affect another.
import { Router } from 'express';
import { z } from 'zod';
import { q, qOne } from '../lib/db.js';
import { asyncHandler } from '../lib/errors.js';
import { requireAuth, requireRole } from '../lib/auth.js';
import { resolveTenant } from '../lib/tenant.js';

const router = Router();
router.use(requireAuth, resolveTenant, requireRole('COMPANY_ADMIN'));

const TABLES = [
  'workAllotments', 'returns', 'packingLists', 'dispatches', 'productions', 'poOrders',
  'supplierOrders', 'customers', 'suppliers', 'labourMemberships', 'materialGrades', 'fluxGrades',
];

// Maps the front-end's plural key → actual MySQL table name.
const TABLE_BY_KEY = {
  workAllotments:   'WorkAllotment',
  returns:          'Return',
  packingLists:     'PackingList',
  dispatches:       'Dispatch',
  productions:      'Production',
  poOrders:         'PoOrder',
  supplierOrders:   'SupplierOrder',
  customers:        'Customer',
  suppliers:        'Supplier',
  labourMemberships:'LabourMembership',
  materialGrades:   'MaterialGrade',
  fluxGrades:       'FluxGrade',
};

const countOne = async (table, companyId) => {
  const row = await qOne(`SELECT COUNT(*) AS n FROM \`${table}\` WHERE \`companyId\` = ?`, [companyId]);
  return Number(row?.n ?? 0);
};

/* GET /api/admin/data-counts */
router.get('/data-counts', asyncHandler(async (req, res) => {
  const cid = req.tenant.companyId;
  const counts = {};
  for (const [key, table] of Object.entries(TABLE_BY_KEY)) {
    counts[key] = await countOne(table, cid);
  }
  res.json({ counts });
}));

/* POST /api/admin/wipe-data — delete selected tables for the active company. */
const wipeSchema = z.object({
  confirm: z.literal('DELETE'),
  tables:  z.array(z.enum(TABLES)).min(1),
});

const deleteByCompany = async (table, companyId) => {
  const [res] = await (await import('../lib/db.js')).pool.query(
    `DELETE FROM \`${table}\` WHERE \`companyId\` = ?`,
    [companyId]
  );
  return res.affectedRows ?? 0;
};

router.post('/wipe-data', asyncHandler(async (req, res) => {
  const { tables } = wipeSchema.parse(req.body);
  const set = new Set(tables);
  const cid = req.tenant.companyId;
  const deleted = {};

  // Strict child-then-parent order so foreign keys can't blow up.
  const ORDER = [
    'workAllotments', 'returns', 'packingLists', 'dispatches', 'productions', 'poOrders',
    'supplierOrders', 'customers', 'suppliers', 'labourMemberships', 'materialGrades', 'fluxGrades',
  ];
  for (const key of ORDER) {
    if (!set.has(key)) continue;
    deleted[key] = await deleteByCompany(TABLE_BY_KEY[key], cid);
  }
  res.json({ ok: true, deleted });
}));

export default router;
