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
const PROFORMA_KEY = 'proforma_settings';

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

/* Exporter, bank and terms for the proforma invoice — set once, printed on every PI.
   Free text throughout: what a foreign bank wants spelled out is the bank's business. */
const text = (n) => z.string().max(n).optional().default('');
const proformaSchema = z.object({
  address: text(400), phone: text(120), email: text(160), gstin: text(40), pan: text(20),
  iec: text(20), lutArn: text(40), adCode: text(40), rcmc: text(60),
  beneficiary: text(160), bankName: text(160), bankBranch: text(300), accountNo: text(60),
  ifsc: text(40), swift: text(40), intermediaryBank: text(300), signatory: text(120),
  // Export test certificate: printed on every certificate.
  tcFormatNo: text(60), tcWorks: text(160), tcTestMethod: text(1000), tcCertification: text(1000),
  tcTestedBy: text(120), tcApprovedBy: text(120),
  terms: z.array(z.object({
    title: z.string().trim().max(80), text: z.string().max(1500), print: z.boolean().default(true),
  })).max(30).optional().default([]),
  // The company's own drop-down options, keyed by list (see client proformaLists EDITABLE_LISTS).
  lists: z.record(z.string().max(40), z.array(z.string().trim().min(1).max(160)).max(200)).optional().default({}),
}).strip();
const PROFORMA_EMPTY = {
  address: '', phone: '', email: '', gstin: '', pan: '', iec: '', lutArn: '', adCode: '', rcmc: '',
  beneficiary: '', bankName: '', bankBranch: '', accountNo: '', ifsc: '', swift: '', intermediaryBank: '',
  signatory: '', terms: [], lists: {},
  tcFormatNo: '', tcWorks: '', tcTestMethod: '', tcCertification: '', tcTestedBy: '', tcApprovedBy: '',
};

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

/* GET /api/company-settings/proforma — exporter, bank and terms for the PI. */
router.get('/proforma', asyncHandler(async (req, res) => {
  const saved = await readSetting(req.tenant.companyId, PROFORMA_KEY);
  res.json({ ...PROFORMA_EMPTY, ...(saved ?? {}) });
}));

/* PUT /api/company-settings/proforma — company admin only. */
router.put('/proforma', requireRole('COMPANY_ADMIN'), asyncHandler(async (req, res) => {
  const data = proformaSchema.parse(req.body ?? {});
  await writeSetting(req.tenant.companyId, PROFORMA_KEY, JSON.stringify(data));
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
