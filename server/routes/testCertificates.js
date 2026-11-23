// Export test certificates — one per core size: nominal size ± tolerance, the
// permissible excitation current, and up to ten measured samples. A document only:
// it touches no order, stock or account. Numbered MEI/TC/2026-27/001 per FY.
// Shares the Proforma permissions (the Export group).
import { Router } from 'express';
import { z } from 'zod';
import { q, qOne, insert, update, del } from '../lib/db.js';
import { AppError, asyncHandler } from '../lib/errors.js';
import { requireAuth, requireAnyPermission } from '../lib/auth.js';
import { resolveTenant } from '../lib/tenant.js';
import { logAudit } from '../lib/audit.js';

const router = Router();
router.use(requireAuth, resolveTenant);

const READ = ['view_proforma'];
const WRITE = ['add_proforma'];

const reading = z.union([z.string().trim().max(20), z.number()]).transform((v) => String(v)).optional().default('');
const sample = z.object({ od: reading, id: reading, ht: reading, current: reading });

/* The specification and readings only print, so they pass through as text; the
   samples are bounded and the fields the register needs are checked. */
const dataSchema = z.object({
  customer: z.string().trim().min(1, 'Customer is required').max(200),
  piRef: z.string().trim().max(60).optional().default(''),
  od: z.coerce.number().positive('Nominal OD is required'),
  id: z.coerce.number().positive('Nominal ID is required'),
  ht: z.coerce.number().positive('Nominal HT is required'),
  odTol: z.coerce.number().min(0).default(0),
  idTol: z.coerce.number().min(0).default(0),
  htTol: z.coerce.number().min(0).default(0),
  permCurrent: z.coerce.number().positive('Permissible current is required'),
  samples: z.array(sample).max(10, 'At most 10 samples per certificate').default([]),
}).passthrough();

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}/, 'Use a date as YYYY-MM-DD').transform((v) => v.slice(0, 10));
const saveSchema = z.object({
  certNo: z.string().trim().min(1).max(60).optional(),
  certDate: day,
  data: dataSchema,
});

const num = (v) => (String(v ?? '').trim() === '' ? null : Number(v));
const fin = (v) => v !== null && Number.isFinite(v);

/** ACCEPTED when every sample tested is OK — the sheet's rule, worked out here for the register. */
const verdictOf = (d) => {
  let tested = 0, within = 0;
  for (const s of d.samples) {
    const od = num(s.od), id = num(s.id), ht = num(s.ht), cur = num(s.current);
    if (![od, id, ht, cur].every(fin)) continue;
    tested++;
    const dimOk = Math.abs(od - d.od) <= d.odTol && Math.abs(id - d.id) <= d.idTol && Math.abs(ht - d.ht) <= d.htTol;
    if (dimOk && cur <= d.permCurrent) within++;
  }
  return tested === 0 ? '' : within === tested ? 'ACCEPTED' : 'REJECTED';
};

const companyPrefix = (name) => {
  const words = String(name ?? '').trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) return words.map((w) => w[0]).join('').slice(0, 4).toUpperCase();
  return String(name ?? 'CO').slice(0, 3).toUpperCase();
};
const fyLabel = (date) => {
  const d = new Date(date);
  const y = d.getUTCFullYear();
  const start = d.getUTCMonth() >= 3 ? y : y - 1;
  return `${start}-${String(start + 1).slice(2)}`;
};

/** MEI/TC/2026-27/001 — three-digit serial, restarting each financial year. */
const nextCertNo = async (companyId, date) => {
  const company = await qOne('SELECT `name` FROM `Company` WHERE `id` = ?', [companyId]);
  const prefix = companyPrefix(company?.name ?? '');
  const fy = fyLabel(date);
  const rows = await q('SELECT `certNo` FROM `TestCertificate` WHERE `companyId` = ? AND `certNo` LIKE ?', [companyId, `${prefix}/TC/${fy}/%`]);
  const re = new RegExp(`^${prefix}/TC/${fy}/(\\d+)$`);
  const max = rows.reduce((m, r) => Math.max(m, parseInt(re.exec(r.certNo ?? '')?.[1] ?? '0', 10)), 0);
  return `${prefix}/TC/${fy}/${String(max + 1).padStart(3, '0')}`;
};

const COLS = "*, DATE_FORMAT(`certDate`, '%Y-%m-%d') AS certDay";
const getRow = (id, companyId) => qOne(`SELECT ${COLS} FROM \`TestCertificate\` WHERE \`id\` = ? AND \`companyId\` = ?`, [id, companyId]);
const shape = (r) => ({
  id: r.id, certNo: r.certNo, certDate: r.certDay, customer: r.customer, piRef: r.piRef,
  sizeLabel: r.sizeLabel, result: r.result, createdAt: r.createdAt,
});
const parseData = (r) => { try { return JSON.parse(r.data); } catch { return {}; } };
const columns = (d) => ({
  customer: d.customer, piRef: d.piRef ?? '', sizeLabel: `${d.od} × ${d.id} × ${d.ht}`, result: verdictOf(d),
});

router.get('/next-number', requireAnyPermission(...READ), asyncHandler(async (req, res) => {
  const date = req.query.date ? new Date(String(req.query.date)) : new Date();
  res.json({ certNo: await nextCertNo(req.tenant.companyId, date) });
}));

router.get('/', requireAnyPermission(...READ), asyncHandler(async (req, res) => {
  const { page, pageSize, search, full } = z.object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(500).default(20),
    search: z.string().trim().max(120).optional(),
    full: z.enum(['0', '1']).optional(),   // 1 = include each certificate's data (for a combined PDF)
  }).parse(req.query);
  let where = '`companyId` = ?';
  const params = [req.tenant.companyId];
  if (search) { where += ' AND (`certNo` LIKE ? OR `customer` LIKE ? OR `piRef` LIKE ? OR `sizeLabel` LIKE ?)'; params.push(...Array(4).fill(`%${search}%`)); }
  const [rows, total] = await Promise.all([
    q(`SELECT ${COLS} FROM \`TestCertificate\` WHERE ${where} ORDER BY \`certDate\` DESC, \`certNo\` DESC LIMIT ? OFFSET ?`, [...params, pageSize, (page - 1) * pageSize]),
    qOne(`SELECT COUNT(*) AS n FROM \`TestCertificate\` WHERE ${where}`, params),
  ]);
  res.json({ items: rows.map((r) => (full === '1' ? { ...shape(r), data: parseData(r) } : shape(r))), total: Number(total?.n ?? 0), page, pageSize });
}));

router.get('/:id', requireAnyPermission(...READ), asyncHandler(async (req, res) => {
  const r = await getRow(req.params.id, req.tenant.companyId);
  if (!r) throw new AppError('Test certificate not found', 404, 'NOT_FOUND');
  res.json({ ...shape(r), data: parseData(r) });
}));

const duplicate = (e) => e?.code === 'ER_DUP_ENTRY'
  ? new AppError('That certificate number is already in use', 409, 'TC_DUPLICATE') : e;

router.post('/', requireAnyPermission(...WRITE), asyncHandler(async (req, res) => {
  const body = saveSchema.parse(req.body);
  const certNo = body.certNo || await nextCertNo(req.tenant.companyId, body.certDate);
  try {
    const row = await insert('TestCertificate', {
      companyId: req.tenant.companyId, certNo, certDate: body.certDate, ...columns(body.data),
      data: JSON.stringify(body.data), createdById: req.auth.userId,
    });
    await logAudit(req, { entity: 'TestCertificate', entityId: row.id, action: 'CREATE', summary: `TC ${certNo} · ${body.data.customer} · ${columns(body.data).sizeLabel}` });
    res.status(201).json(shape(await getRow(row.id, req.tenant.companyId)));
  } catch (e) { throw duplicate(e); }
}));

router.put('/:id', requireAnyPermission(...WRITE), asyncHandler(async (req, res) => {
  const body = saveSchema.parse(req.body);
  const cur = await qOne('SELECT * FROM `TestCertificate` WHERE `id` = ? AND `companyId` = ?', [req.params.id, req.tenant.companyId]);
  if (!cur) throw new AppError('Test certificate not found', 404, 'NOT_FOUND');
  const certNo = body.certNo || cur.certNo;
  try {
    await update('TestCertificate', cur.id, { certNo, certDate: body.certDate, ...columns(body.data), data: JSON.stringify(body.data) });
    await logAudit(req, { entity: 'TestCertificate', entityId: cur.id, action: 'UPDATE', summary: `Edited TC ${certNo}` });
    res.json(shape(await getRow(cur.id, req.tenant.companyId)));
  } catch (e) { throw duplicate(e); }
}));

router.delete('/:id', requireAnyPermission(...WRITE), asyncHandler(async (req, res) => {
  const cur = await qOne('SELECT * FROM `TestCertificate` WHERE `id` = ? AND `companyId` = ?', [req.params.id, req.tenant.companyId]);
  if (!cur) throw new AppError('Test certificate not found', 404, 'NOT_FOUND');
  await del('TestCertificate', cur.id);
  await logAudit(req, { entity: 'TestCertificate', entityId: cur.id, action: 'DELETE', summary: `TC ${cur.certNo}` });
  res.status(204).end();
}));

export default router;
