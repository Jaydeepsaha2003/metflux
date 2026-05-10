// Admin tools — bulk data cleanup. COMPANY_ADMIN only (platform admins always
// pass via the role-rank check). Every operation is scoped to the active
// company so wiping in one tenant cannot affect another.
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/db.js';
import { asyncHandler } from '../lib/errors.js';
import { requireAuth, requireRole } from '../lib/auth.js';
import { resolveTenant } from '../lib/tenant.js';

const router = Router();
router.use(requireAuth, resolveTenant, requireRole('COMPANY_ADMIN'));

const TABLES = [
  'workAllotments', 'returns', 'packingLists', 'dispatches', 'productions', 'poOrders',
  'supplierOrders', 'customers', 'suppliers', 'labourMemberships', 'materialGrades', 'fluxGrades',
];

/* GET /api/admin/data-counts — current row counts per wipeable table for the
   active company. Drives the UI so users can see how much they're about to
   delete before they commit. */
router.get('/data-counts', asyncHandler(async (req, res) => {
  const cid = req.tenant.companyId;
  const [
    workAllotments, returns_, packingLists, dispatches, productions, poOrders,
    supplierOrders, customers, suppliers, labourMemberships, materialGrades, fluxGrades,
  ] = await Promise.all([
    prisma.workAllotment.count({ where: { companyId: cid } }),
    prisma.return.count({ where: { companyId: cid } }),
    prisma.packingList.count({ where: { companyId: cid } }),
    prisma.dispatch.count({ where: { companyId: cid } }),
    prisma.production.count({ where: { companyId: cid } }),
    prisma.poOrder.count({ where: { companyId: cid } }),
    prisma.supplierOrder.count({ where: { companyId: cid } }),
    prisma.customer.count({ where: { companyId: cid } }),
    prisma.supplier.count({ where: { companyId: cid } }),
    prisma.labourMembership.count({ where: { companyId: cid } }),
    prisma.materialGrade.count({ where: { companyId: cid } }),
    prisma.fluxGrade.count({ where: { companyId: cid } }),
  ]);
  res.json({
    counts: {
      workAllotments, returns: returns_, packingLists, dispatches, productions, poOrders,
      supplierOrders, customers, suppliers, labourMemberships, materialGrades, fluxGrades,
    },
  });
}));

/* POST /api/admin/wipe-data — delete selected tables for the active company.
   Body: { confirm: "DELETE", tables: string[] }. Tables are processed in a
   strict child-then-parent order so referential constraints can't blow up
   regardless of what the user picked. */
const wipeSchema = z.object({
  confirm: z.literal('DELETE'),
  tables:  z.array(z.enum(TABLES)).min(1),
});

router.post('/wipe-data', asyncHandler(async (req, res) => {
  const { tables } = wipeSchema.parse(req.body);
  const set = new Set(tables);
  const cid = req.tenant.companyId;
  const deleted = {};

  // Operations stack — children must be wiped before their FK parents.
  if (set.has('workAllotments')) deleted.workAllotments = (await prisma.workAllotment.deleteMany({ where: { companyId: cid } })).count;
  if (set.has('returns'))        deleted.returns        = (await prisma.return.deleteMany({ where: { companyId: cid } })).count;
  if (set.has('packingLists'))   deleted.packingLists   = (await prisma.packingList.deleteMany({ where: { companyId: cid } })).count;
  if (set.has('dispatches'))     deleted.dispatches     = (await prisma.dispatch.deleteMany({ where: { companyId: cid } })).count;
  if (set.has('productions'))    deleted.productions    = (await prisma.production.deleteMany({ where: { companyId: cid } })).count;
  if (set.has('poOrders'))       deleted.poOrders       = (await prisma.poOrder.deleteMany({ where: { companyId: cid } })).count;
  if (set.has('supplierOrders')) deleted.supplierOrders = (await prisma.supplierOrder.deleteMany({ where: { companyId: cid } })).count;

  // Master data — customers/suppliers/labours can only be wiped after the
  // operations that reference them. Prisma will throw a P2003 (FK) error if
  // the user picked these without picking the dependents — that's fine, we
  // surface the message rather than silently masking it.
  if (set.has('customers'))         deleted.customers         = (await prisma.customer.deleteMany({ where: { companyId: cid } })).count;
  if (set.has('suppliers'))         deleted.suppliers         = (await prisma.supplier.deleteMany({ where: { companyId: cid } })).count;
  if (set.has('labourMemberships')) deleted.labourMemberships = (await prisma.labourMembership.deleteMany({ where: { companyId: cid } })).count;
  if (set.has('materialGrades'))    deleted.materialGrades    = (await prisma.materialGrade.deleteMany({ where: { companyId: cid } })).count;
  if (set.has('fluxGrades'))        deleted.fluxGrades        = (await prisma.fluxGrade.deleteMany({ where: { companyId: cid } })).count;

  res.json({ ok: true, deleted });
}));

export default router;
