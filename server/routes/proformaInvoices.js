// Proforma invoices — the export document a buyer is sent before an order, carrying
// the shipment, commercial and bank particulars an overseas buyer and their bank
// ask for. It touches nothing downstream (no order, production or accounts); it is
// a document, numbered MEI/PI/n/FY, that the app can print as an Excel sheet.
//
// Reading follows the quotation permissions and so does writing: a PI is the export
// form of a quotation, and the same people prepare both.
import { Router } from 'express';
import { z } from 'zod';
import { q, qOne, insert, update, del } from '../lib/db.js';
import { AppError, asyncHandler } from '../lib/errors.js';
import { requireAuth, requireAnyPermission } from '../lib/auth.js';
import { resolveTenant } from '../lib/tenant.js';
import { logAudit } from '../lib/audit.js';

const router = Router();
router.use(requireAuth, resolveTenant);

const READ = ['view_quotation', 'view_po'];
const WRITE = ['add_quotation', 'add_po'];

const money = (v) => Math.round((Number(v) || 0) * 100) / 100;

const itemSchema = z.object({
  desc: z.string().trim().min(1).max(300),
  grade: z.string().trim().max(120).optional().default(''),
  hsn: z.string().trim().max(20).optional().default(''),
  qty: z.coerce.number().nonnegative(),
  unit: z.string().trim().max(20).optional().default('Pcs'),
  netWtUnit: z.coerce.number().nonnegative().optional().default(0),
  price: z.coerce.number().nonnegative(),
});

/* Every other field on the form is free text or a number the document only prints,
   so it passes through untouched; the items and the money that decides the total
   are the parts worth checking. */
const dataSchema = z.object({
  items: z.array(itemSchema).min(1, 'Add at least one item').max(50),
  packingPct: z.coerce.number().min(0).max(1).optional().default(0),
  freight: z.coerce.number().min(0).optional().default(0),
  insurance: z.coerce.number().min(0).optional().default(0),
  otherAmount: z.coerce.number().min(0).optional().default(0),
  discount: z.coerce.number().optional().default(0),
  buyerName: z.string().trim().min(1, 'Buyer name is required').max(200),
}).passthrough();

/* Dates travel as 'YYYY-MM-DD' text, both ways. A DATE column read through the driver
   comes back as local midnight, and turning that into an ISO string moves it a day
   earlier on any server east of Greenwich — including this one. */
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}/, 'Use a date as YYYY-MM-DD').transform((v) => v.slice(0, 10));

const saveSchema = z.object({
  piNumber: z.string().trim().min(1).max(60).optional(),
  piDate: day,
  validUntil: day.optional().nullable(),
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, 'Use a 3-letter currency code').default('USD'),
  data: dataSchema,
});

/** Grand total, worked out here rather than trusted from the browser: it is the
 *  figure the register shows and the buyer pays against. Mirrors the sheet. */
const grandTotal = (d) => {
  const goods = d.items.reduce((s, it) => s + money(it.qty * it.price), 0);
  return money(goods + money(goods * d.packingPct) + d.freight + d.insurance + d.otherAmount - Math.abs(d.discount));
};

const companyPrefix = (name) => {
  const words = String(name ?? '').trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) return words.map((w) => w[0]).join('').slice(0, 4).toUpperCase();
  return String(name ?? 'CO').slice(0, 3).toUpperCase();
};
const fyLabel = (date) => {
  const d = new Date(date);                       // 'YYYY-MM-DD' parses as UTC midnight
  const y = d.getUTCFullYear();
  const start = d.getUTCMonth() >= 3 ? y : y - 1;
  return `${start}-${String(start + 1).slice(2)}`;
};

/** MEI/PI/008/2026-27 — three-digit serial, restarting each financial year. */
const nextPiNo = async (companyId, date) => {
  const company = await qOne('SELECT `name` FROM `Company` WHERE `id` = ?', [companyId]);
  const prefix = companyPrefix(company?.name ?? '');
  const fy = fyLabel(date);
  const rows = await q('SELECT `piNumber` FROM `ProformaInvoice` WHERE `companyId` = ? AND `piNumber` LIKE ?', [companyId, `${prefix}/PI/%/${fy}`]);
  const re = new RegExp(`^${prefix}/PI/(\\d+)/${fy}$`);
  const max = rows.reduce((m, r) => Math.max(m, parseInt(re.exec(r.piNumber ?? '')?.[1] ?? '0', 10)), 0);
  return `${prefix}/PI/${String(max + 1).padStart(3, '0')}/${fy}`;
};

/** Every read goes through here so the dates arrive already as text. */
const COLS = "*, DATE_FORMAT(`piDate`, '%Y-%m-%d') AS piDay, DATE_FORMAT(`validUntil`, '%Y-%m-%d') AS validDay";
const getRow = (id, companyId) => qOne(`SELECT ${COLS} FROM \`ProformaInvoice\` WHERE \`id\` = ? AND \`companyId\` = ?`, [id, companyId]);
const shape = (r) => ({
  id: r.id,
  piNumber: r.piNumber,
  piDate: r.piDay,
  validUntil: r.validDay,
  currency: r.currency,
  buyerName: r.buyerName,
  grandTotal: Number(r.grandTotal),
  createdAt: r.createdAt,
});

router.get('/next-number', requireAnyPermission(...READ), asyncHandler(async (req, res) => {
  const date = req.query.date ? new Date(String(req.query.date)) : new Date();
  res.json({ piNumber: await nextPiNo(req.tenant.companyId, date) });
}));

router.get('/', requireAnyPermission(...READ), asyncHandler(async (req, res) => {
  const { page, pageSize, search } = z.object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(500).default(20),
    search: z.string().trim().max(120).optional(),
  }).parse(req.query);
  let where = '`companyId` = ?';
  const params = [req.tenant.companyId];
  if (search) { where += ' AND (`piNumber` LIKE ? OR `buyerName` LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }
  const [rows, total] = await Promise.all([
    q(`SELECT ${COLS} FROM \`ProformaInvoice\` WHERE ${where} ORDER BY \`piDate\` DESC, \`createdAt\` DESC LIMIT ? OFFSET ?`, [...params, pageSize, (page - 1) * pageSize]),
    qOne(`SELECT COUNT(*) AS n FROM \`ProformaInvoice\` WHERE ${where}`, params),
  ]);
  res.json({ items: rows.map(shape), total: Number(total?.n ?? 0), page, pageSize });
}));

router.get('/:id', requireAnyPermission(...READ), asyncHandler(async (req, res) => {
  const r = await getRow(req.params.id, req.tenant.companyId);
  if (!r) throw new AppError('Proforma invoice not found', 404, 'NOT_FOUND');
  let data = {};
  try { data = JSON.parse(r.data); } catch { /* a damaged row still opens, empty, rather than not at all */ }
  res.json({ ...shape(r), data });
}));

const duplicate = (e) => e?.code === 'ER_DUP_ENTRY'
  ? new AppError('That PI number is already in use', 409, 'PI_DUPLICATE') : e;

router.post('/', requireAnyPermission(...WRITE), asyncHandler(async (req, res) => {
  const body = saveSchema.parse(req.body);
  const piNumber = body.piNumber || await nextPiNo(req.tenant.companyId, body.piDate);
  try {
    const row = await insert('ProformaInvoice', {
      companyId: req.tenant.companyId, piNumber, piDate: body.piDate, validUntil: body.validUntil ?? null,
      currency: body.currency, buyerName: body.data.buyerName, grandTotal: grandTotal(body.data),
      data: JSON.stringify(body.data), createdById: req.auth.userId,
    });
    await logAudit(req, { entity: 'ProformaInvoice', entityId: row.id, action: 'CREATE', summary: `PI ${piNumber} · ${body.data.buyerName} · ${body.data.items.length} item(s)` });
    res.status(201).json(shape(await getRow(row.id, req.tenant.companyId)));
  } catch (e) { throw duplicate(e); }
}));

router.put('/:id', requireAnyPermission(...WRITE), asyncHandler(async (req, res) => {
  const body = saveSchema.parse(req.body);
  const cur = await qOne('SELECT * FROM `ProformaInvoice` WHERE `id` = ? AND `companyId` = ?', [req.params.id, req.tenant.companyId]);
  if (!cur) throw new AppError('Proforma invoice not found', 404, 'NOT_FOUND');
  const piNumber = body.piNumber || cur.piNumber;
  try {
    await update('ProformaInvoice', cur.id, {
      piNumber, piDate: body.piDate, validUntil: body.validUntil ?? null, currency: body.currency,
      buyerName: body.data.buyerName, grandTotal: grandTotal(body.data), data: JSON.stringify(body.data),
    });
    await logAudit(req, { entity: 'ProformaInvoice', entityId: cur.id, action: 'UPDATE', summary: `Edited PI ${piNumber} · ${body.data.buyerName}` });
    res.json(shape(await getRow(cur.id, req.tenant.companyId)));
  } catch (e) { throw duplicate(e); }
}));

router.delete('/:id', requireAnyPermission(...WRITE), asyncHandler(async (req, res) => {
  const cur = await qOne('SELECT * FROM `ProformaInvoice` WHERE `id` = ? AND `companyId` = ?', [req.params.id, req.tenant.companyId]);
  if (!cur) throw new AppError('Proforma invoice not found', 404, 'NOT_FOUND');
  await del('ProformaInvoice', cur.id);
  await logAudit(req, { entity: 'ProformaInvoice', entityId: cur.id, action: 'DELETE', summary: `PI ${cur.piNumber}` });
  res.status(204).end();
}));

export default router;
