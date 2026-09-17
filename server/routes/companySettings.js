// Per-company settings (tenant-scoped). Currently holds the quotation Terms &
// Conditions + bank details, set once per company and reused on every quotation.
// Read by anyone in the company (the quotation print needs it); written only by
// company admins.
import { Router } from 'express';
import { z } from 'zod';
import { q, qOne, newId } from '../lib/db.js';
import { asyncHandler } from '../lib/errors.js';
import { requireAuth, requireRole } from '../lib/auth.js';
import { resolveTenant } from '../lib/tenant.js';

const router = Router();
router.use(requireAuth, resolveTenant);

const QUOTATION_KEY = 'quotation_settings';
const MATERIAL_PHYSICS_KEY = 'material_physics';

const quotationSchema = z.object({
  bankName:          z.string().max(160).optional().default(''),
  bankBranch:        z.string().max(160).optional().default(''),
  bankAccountName:   z.string().max(160).optional().default(''),
  bankAccountNumber: z.string().max(60).optional().default(''),
  bankIfsc:          z.string().max(40).optional().default(''),
  terms:             z.string().max(8000).optional().default(''),
  // Starting serial for the quotation number series (e.g. Toroflux → 131 means
  // the next quotation number is …/SQ/131/FY). Null/empty = start from 1.
  seriesStart:       z.coerce.number().int().min(1).max(9_999_999).optional().nullable(),
}).strip();

const EMPTY = { bankName: '', bankBranch: '', bankAccountName: '', bankAccountNumber: '', bankIfsc: '', terms: '', seriesStart: null };
const MATERIAL_PHYSICS_EMPTY = {
  CRGO: { density: 7.65, stackingFactor: 0.9603383931 },
  NANOCRYSTALLINE: { density: 7.30, stackingFactor: 0.7946072185 },
  AMORPHOUS: { density: 7.25, stackingFactor: 0.86 },
};

const materialPhysicsSchema = z.object({
  CRGO: z.object({ density: z.coerce.number().finite().gt(0).max(30), stackingFactor: z.coerce.number().finite().gt(0).lte(1) }),
  NANOCRYSTALLINE: z.object({ density: z.coerce.number().finite().gt(0).max(30), stackingFactor: z.coerce.number().finite().gt(0).lte(1) }),
  AMORPHOUS: z.object({ density: z.coerce.number().finite().gt(0).max(30), stackingFactor: z.coerce.number().finite().gt(0).lte(1) }),
}).strict();

const readSetting = async (companyId, key) => {
  const row = await qOne(
    'SELECT `settingValue` FROM `CompanySetting` WHERE `companyId` = ? AND `settingKey` = ?',
    [companyId, key]
  );
  if (!row?.settingValue) return null;
  try { return JSON.parse(row.settingValue); } catch { return null; }
};

const writeSetting = (companyId, key, value) => q(
  'INSERT INTO `CompanySetting` (`id`, `companyId`, `settingKey`, `settingValue`) VALUES (?, ?, ?, ?) ' +
  'ON DUPLICATE KEY UPDATE `settingValue` = VALUES(`settingValue`), `updatedAt` = CURRENT_TIMESTAMP(3)',
  [newId(), companyId, key, value]
);

/* GET /api/company-settings/quotation — current quotation T&C + bank details. */
router.get('/quotation', asyncHandler(async (req, res) => {
  const saved = await readSetting(req.tenant.companyId, QUOTATION_KEY);
  res.json({ ...EMPTY, ...(saved ?? {}) });
}));

/* PUT /api/company-settings/quotation — save them (company admin only). */
router.put('/quotation', requireRole('COMPANY_ADMIN'), asyncHandler(async (req, res) => {
  const data = quotationSchema.parse(req.body ?? {});
  await writeSetting(req.tenant.companyId, QUOTATION_KEY, JSON.stringify(data));
  res.json(data);
}));

/* GET /api/company-settings/material-physics — calculation defaults. */
router.get('/material-physics', asyncHandler(async (req, res) => {
  const saved = await readSetting(req.tenant.companyId, MATERIAL_PHYSICS_KEY);
  const valid = materialPhysicsSchema.safeParse(saved);
  const overrides = valid.success ? valid.data : {};
  res.json({
    CRGO: { ...MATERIAL_PHYSICS_EMPTY.CRGO, ...(overrides.CRGO ?? {}) },
    NANOCRYSTALLINE: { ...MATERIAL_PHYSICS_EMPTY.NANOCRYSTALLINE, ...(overrides.NANOCRYSTALLINE ?? {}) },
    AMORPHOUS: { ...MATERIAL_PHYSICS_EMPTY.AMORPHOUS, ...(overrides.AMORPHOUS ?? {}) },
  });
}));

/* PUT /api/company-settings/material-physics — company admin only. */
router.put('/material-physics', requireRole('COMPANY_ADMIN'), asyncHandler(async (req, res) => {
  const data = materialPhysicsSchema.parse(req.body ?? {});
  await writeSetting(req.tenant.companyId, MATERIAL_PHYSICS_KEY, JSON.stringify(data));
  res.json(data);
}));

export default router;
