// Lorry Receipt (LR / transport consignment) module.
//   GET  /lorry-receipts            — record book (list, search, paginate)
//   GET  /lorry-receipts/next-number — next LR no in the BL-#### series
//   GET  /lorry-receipts/:id        — one LR
//   POST /lorry-receipts            — create (auto number if blank, auto freight)
//   PUT  /lorry-receipts/:id        — edit
//   DELETE /lorry-receipts/:id      — delete
//   GET/POST /lorry-receipts/parties — consignor/consignee master (autocomplete)
import { Router } from 'express';
import { z } from 'zod';
import { q, qOne, insert, update, del, newId } from '../lib/db.js';
import { AppError, asyncHandler } from '../lib/errors.js';
import { requireAuth, requirePermission } from '../lib/auth.js';
import { resolveTenant } from '../lib/tenant.js';
import { logAudit } from '../lib/audit.js';

const router = Router();
router.use(requireAuth, resolveTenant);

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

/* Freight = charged-weight × rate + fixed heads + risk (a % of declared value). */
const computeTotal = (d) => {
  const base = round2(Number(d.chargedWt || 0) * Number(d.rate || 0));
  const risk = round2(Number(d.valueDeclare || 0) * Number(d.riskFovPct || 0) / 100);
  return { riskFovAmount: risk, totalValue: round2(base + Number(d.stCh || 0) + Number(d.hamali || 0) + Number(d.otherCh || 0) + Number(d.ddCh || 0) + risk) };
};

/* ---------- LR number series: BL-0001, BL-0002 … ---------- */
const nextLrNo = async (companyId) => {
  const rows = await q('SELECT `lrNo` FROM `LorryReceipt` WHERE `companyId` = ?', [companyId]);
  let max = 0;
  for (const r of rows) {
    const m = /(\d+)\s*$/.exec(String(r.lrNo || ''));
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `BL-${String(max + 1).padStart(4, '0')}`;
};

/* ---------- party master (consignor / consignee autocomplete) ---------- */
const partySchema = z.object({
  name:    z.string().trim().min(1).max(255),
  address: z.string().trim().max(500).optional().nullable(),
  mobile:  z.string().trim().max(60).optional().nullable(),
  gstin:   z.string().trim().max(40).optional().nullable(),
});

router.get('/parties', requirePermission('view_lr'), asyncHandler(async (req, res) => {
  const rows = await q('SELECT `id`,`name`,`address`,`mobile`,`gstin` FROM `LrParty` WHERE `companyId` = ? ORDER BY `name` ASC', [req.tenant.companyId]);
  res.json({ items: rows });
}));

router.post('/parties', requirePermission('add_lr'), asyncHandler(async (req, res) => {
  const data = partySchema.parse(req.body);
  const existing = await qOne('SELECT * FROM `LrParty` WHERE `companyId` = ? AND `name` = ?', [req.tenant.companyId, data.name]);
  if (existing) {
    const row = await update('LrParty', existing.id, { address: data.address ?? existing.address, mobile: data.mobile ?? existing.mobile, gstin: data.gstin ?? existing.gstin });
    return res.json(row);
  }
  const row = await insert('LrParty', { companyId: req.tenant.companyId, ...data });
  res.status(201).json(row);
}));

/* ---------- LR record book ---------- */
router.get('/next-number', requirePermission('add_lr'), asyncHandler(async (req, res) => {
  res.json({ lrNo: await nextLrNo(req.tenant.companyId) });
}));

router.get('/', requirePermission('view_lr'), asyncHandler(async (req, res) => {
  const { page, pageSize, search } = z.object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(10000).default(50),
    search: z.string().trim().max(120).optional(),
  }).parse(req.query);
  const skip = (page - 1) * pageSize;
  let where = '`companyId` = ?';
  const params = [req.tenant.companyId];
  if (search) {
    const like = `%${search}%`;
    where += ' AND (`lrNo` LIKE ? OR `consignorName` LIKE ? OR `consigneeName` LIKE ? OR `fromLoc` LIKE ? OR `toLoc` LIKE ? OR `invNo` LIKE ? OR `vehNo` LIKE ?)';
    params.push(like, like, like, like, like, like, like);
  }
  const [items, totalRow] = await Promise.all([
    q(`SELECT * FROM \`LorryReceipt\` WHERE ${where} ORDER BY \`lrDate\` DESC, \`createdAt\` DESC LIMIT ? OFFSET ?`, [...params, pageSize, skip]),
    qOne(`SELECT COUNT(*) n FROM \`LorryReceipt\` WHERE ${where}`, params),
  ]);
  res.json({ items, total: Number(totalRow?.n ?? 0), page, pageSize });
}));

router.get('/:id', requirePermission('view_lr'), asyncHandler(async (req, res) => {
  const row = await qOne('SELECT * FROM `LorryReceipt` WHERE `id` = ? AND `companyId` = ?', [req.params.id, req.tenant.companyId]);
  if (!row) throw new AppError('LR not found', 404, 'NOT_FOUND');
  res.json(row);
}));

const lrSchema = z.object({
  lrNo:   z.string().trim().max(60).optional(),
  lrDate: z.coerce.date(),
  consignorName: z.string().trim().min(1).max(255),
  consignorAddress: z.string().trim().max(500).optional().nullable(),
  consignorGstin: z.string().trim().max(40).optional().nullable(),
  consignorMobile: z.string().trim().max(60).optional().nullable(),
  consigneeName: z.string().trim().min(1).max(255),
  consigneeAddress: z.string().trim().max(500).optional().nullable(),
  consigneeGstin: z.string().trim().max(40).optional().nullable(),
  consigneeMobile: z.string().trim().max(60).optional().nullable(),
  fromLoc: z.string().trim().max(120).optional().nullable(),
  toLoc:   z.string().trim().max(120).optional().nullable(),
  packages: z.coerce.number().int().min(0).default(0),
  packMethod: z.string().trim().max(80).optional().nullable(),
  particular: z.string().trim().max(300).optional().nullable(),
  actualWt: z.coerce.number().min(0).default(0),
  chargedWt: z.coerce.number().min(0).default(0),
  rate: z.coerce.number().min(0).default(0),
  stCh: z.coerce.number().min(0).default(0),
  riskFovPct: z.coerce.number().min(0).max(100).default(0),
  hamali: z.coerce.number().min(0).default(0),
  otherCh: z.coerce.number().min(0).default(0),
  ddCh: z.coerce.number().min(0).default(0),
  invNo: z.string().trim().max(80).optional().nullable(),
  invDate: z.coerce.date().optional().nullable(),
  ewayBillNo: z.string().trim().max(60).optional().nullable(),
  modeOfDispatch: z.string().trim().max(60).optional().nullable().default('BY ROAD'),
  paymentMode: z.enum(['PAID', 'TO-PAY', 'TBB']).default('TO-PAY'),
  valueDeclare: z.coerce.number().min(0).default(0),
  vehNo: z.string().trim().max(40).optional().nullable(),
  dispatchDate: z.coerce.date().optional().nullable(),
  amountRec: z.coerce.number().min(0).default(0),
  remark: z.string().trim().max(500).optional().nullable(),
});

const buildRow = (data, extra = {}) => {
  const { riskFovAmount, totalValue } = computeTotal(data);
  return {
    lrDate: data.lrDate,
    consignorName: data.consignorName, consignorAddress: data.consignorAddress ?? null, consignorGstin: data.consignorGstin ?? null, consignorMobile: data.consignorMobile ?? null,
    consigneeName: data.consigneeName, consigneeAddress: data.consigneeAddress ?? null, consigneeGstin: data.consigneeGstin ?? null, consigneeMobile: data.consigneeMobile ?? null,
    fromLoc: data.fromLoc ?? null, toLoc: data.toLoc ?? null,
    packages: data.packages, packMethod: data.packMethod ?? null, particular: data.particular ?? null,
    actualWt: data.actualWt, chargedWt: data.chargedWt, rate: data.rate,
    stCh: data.stCh, riskFovPct: data.riskFovPct, riskFovAmount, hamali: data.hamali, otherCh: data.otherCh, ddCh: data.ddCh, totalValue,
    invNo: data.invNo ?? null, invDate: data.invDate ?? null, ewayBillNo: data.ewayBillNo ?? null,
    modeOfDispatch: data.modeOfDispatch ?? 'BY ROAD', paymentMode: data.paymentMode, valueDeclare: data.valueDeclare,
    vehNo: data.vehNo ?? null, dispatchDate: data.dispatchDate ?? null, amountRec: data.amountRec, remark: data.remark ?? null,
    ...extra,
  };
};

router.post('/', requirePermission('add_lr'), asyncHandler(async (req, res) => {
  const data = lrSchema.parse(req.body);
  const lrNo = (data.lrNo || '').trim() || await nextLrNo(req.tenant.companyId);
  const clash = await qOne('SELECT `id` FROM `LorryReceipt` WHERE `companyId` = ? AND `lrNo` = ?', [req.tenant.companyId, lrNo]);
  if (clash) throw new AppError('That LR number already exists', 400, 'DUPLICATE_LR');
  const row = await insert('LorryReceipt', buildRow(data, { id: newId(), companyId: req.tenant.companyId, lrNo, createdById: req.auth.userId }));
  await logAudit(req, { entity: 'LorryReceipt', entityId: row.id, action: 'CREATE', summary: `LR ${lrNo} · ${data.consignorName} → ${data.consigneeName}` });
  res.status(201).json(row);
}));

router.put('/:id', requirePermission('add_lr'), asyncHandler(async (req, res) => {
  const data = lrSchema.parse(req.body);
  const existing = await qOne('SELECT * FROM `LorryReceipt` WHERE `id` = ? AND `companyId` = ?', [req.params.id, req.tenant.companyId]);
  if (!existing) throw new AppError('LR not found', 404, 'NOT_FOUND');
  const lrNo = (data.lrNo || '').trim() || existing.lrNo;
  if (lrNo !== existing.lrNo) {
    const clash = await qOne('SELECT `id` FROM `LorryReceipt` WHERE `companyId` = ? AND `lrNo` = ? AND `id` <> ?', [req.tenant.companyId, lrNo, existing.id]);
    if (clash) throw new AppError('That LR number already exists', 400, 'DUPLICATE_LR');
  }
  const row = await update('LorryReceipt', existing.id, buildRow(data, { lrNo }));
  await logAudit(req, { entity: 'LorryReceipt', entityId: existing.id, action: 'UPDATE', summary: `Edited LR ${lrNo}` });
  res.json(row);
}));

router.delete('/:id', requirePermission('add_lr'), asyncHandler(async (req, res) => {
  const existing = await qOne('SELECT `lrNo` FROM `LorryReceipt` WHERE `id` = ? AND `companyId` = ?', [req.params.id, req.tenant.companyId]);
  if (!existing) throw new AppError('LR not found', 404, 'NOT_FOUND');
  await del('LorryReceipt', req.params.id);
  await logAudit(req, { entity: 'LorryReceipt', entityId: req.params.id, action: 'DELETE', summary: `Deleted LR ${existing.lrNo}` });
  res.status(204).end();
}));

export default router;
