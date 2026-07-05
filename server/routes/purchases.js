// Purchase register — supplier bills + debit notes, imported from the
// accounting "Purchase Register" export. `amount` is the payable (incl. GST,
// net of TDS); `tds` is the register's "Other Amount". A negative row is a
// debit note. Re-importing the same file is idempotent (unique Vch/Bill No).
import { Router } from 'express';
import { z } from 'zod';
import { q, qOne, insert } from '../lib/db.js';
import { AppError, asyncHandler } from '../lib/errors.js';
import { requireAuth, requirePermission, requireAnyPermission } from '../lib/auth.js';
import { resolveTenant } from '../lib/tenant.js';
import { round2, parseAmount, inferDateOrder, parseDateWith, isCancelledName, normName } from '../lib/invoicing.js';

const router = Router();
router.use(requireAuth, resolveTenant);

const flatten = (p) => {
  const igst = Number(p.igst) || 0, cgst = Number(p.cgst) || 0, sgst = Number(p.sgst) || 0;
  return {
    id: p.id,
    invoiceNumber: p.invoiceNumber,
    invoiceDate: p.invoiceDate,
    supplierName: p.supplierName,
    gstin: p.gstin ?? null,
    taxType: p.taxType ?? null,
    amount: Number(p.amount) || 0,
    purchaseAmount: Number(p.purchaseAmount) || 0,
    taxableAmount: Number(p.taxableAmount) || 0,
    igst, cgst, sgst,
    gst: round2(igst + cgst + sgst),
    tds: Number(p.tds) || 0,
    docType: p.docType,
    createdAt: p.createdAt,
  };
};

/* ---------- POST /import ---------- */
router.post('/import', requireAnyPermission('view_purchase_register', 'manage_invoices'), asyncHandler(async (req, res) => {
  const { rows } = z.object({ rows: z.array(z.array(z.any())).max(20000) }).parse(req.body);
  const matrix = rows.map((r) => (Array.isArray(r) ? r.map((c) => String(c ?? '').trim()) : []));

  let headerIdx = matrix.findIndex((r) => {
    const j = r.join(' ').toLowerCase();
    return /vch|bill|voucher|invoice/.test(j) && /account|party|supplier|particular|date/.test(j);
  });
  if (headerIdx < 0) headerIdx = matrix.findIndex((r) => r.some((c) => /^date$/i.test(c)));
  if (headerIdx < 0) throw new AppError('Could not find the column header row (expected Date, Vch/Bill No, Account, Total Amount).', 400, 'NO_HEADER');

  const header = matrix[headerIdx].map((c) => c.toLowerCase());
  const findCol = (...keys) => { for (const k of keys) { const i = header.findIndex((h) => h.includes(k)); if (i >= 0) return i; } return -1; };
  const cDate    = findCol('date');
  const cVch     = findCol('vch', 'bill', 'voucher', 'invoice');
  const cAcct    = findCol('account', 'party', 'supplier', 'particular', 'name');
  const cGstin   = findCol('gstin', 'tin');
  const cType    = findCol('type');
  const cTotal   = findCol('total amount', 'total');
  const cPurc    = findCol('purc', 'purchase');
  const cTaxable = findCol('taxable');
  const cIgst    = findCol('igst');
  const cCgst    = findCol('cgst');
  const cSgst    = findCol('sgst');
  const cOther   = findCol('other');   // = TDS
  const cDue     = findCol('due date', 'payment due', 'due dt');
  if (cVch < 0 || cTotal < 0) throw new AppError('The sheet needs a Vch/Bill No column and a Total Amount column.', 400, 'BAD_HEADER');

  const cell = (r, i) => (i >= 0 ? (r[i] ?? '').trim() : '');
  const isTotalsRow = (r, vch) => {
    if (vch) return false;
    const j = r.join(' ').toLowerCase();
    return /grand\s*total/.test(j) || /total\s*tax\s*amount/.test(j) || /^total$/i.test(cell(r, cType)) || /^total\b/i.test(cell(r, cAcct));
  };

  const invoices = [];
  for (let i = headerIdx + 1; i < matrix.length; i++) {
    const r = matrix[i];
    const vch = cell(r, cVch);
    if (isTotalsRow(r, vch) || !vch) continue;
    invoices.push({
      invoiceNumber: vch,
      dateStr: cell(r, cDate),
      dueStr: cell(r, cDue),
      supplierName: cell(r, cAcct),
      gstin: cell(r, cGstin) || null,
      taxType: cell(r, cType) || null,
      amount: parseAmount(r[cTotal]),
      purchaseAmount: parseAmount(r[cPurc]),
      taxableAmount: parseAmount(r[cTaxable]),
      igst: parseAmount(r[cIgst]),
      cgst: parseAmount(r[cCgst]),
      sgst: parseAmount(r[cSgst]),
      tds: parseAmount(r[cOther]),
    });
  }

  // Decide the date order once for the whole file (this register is day-first).
  const dateOrder = inferDateOrder(invoices.map((i) => i.dateStr));

  const existingRows = await q('SELECT `id`, `invoiceNumber` FROM `PurchaseInvoice` WHERE `companyId` = ?', [req.tenant.companyId]);
  const existingByNum = new Map(existingRows.map((r) => [r.invoiceNumber, r.id]));
  let imported = 0, skippedDuplicates = 0, debitNotes = 0, cancelled = 0;
  const errors = [];
  const seen = new Set();

  for (const inv of invoices) {
    try {
      if (seen.has(inv.invoiceNumber)) continue;
      seen.add(inv.invoiceNumber);

      // Cancelled voucher → skip, and remove it if a prior import saved it.
      if (isCancelledName(inv.supplierName)) {
        const id = existingByNum.get(inv.invoiceNumber);
        if (id) await q('DELETE FROM `PurchaseInvoice` WHERE `id` = ?', [id]);
        cancelled++;
        continue;
      }

      if (existingByNum.has(inv.invoiceNumber)) { skippedDuplicates++; continue; }
      const date = parseDateWith(inv.dateStr, dateOrder);
      if (!date) { errors.push({ invoiceNumber: inv.invoiceNumber, message: `Unreadable date "${inv.dateStr || '(blank)'}"` }); continue; }
      const dueDate = inv.dueStr ? parseDateWith(inv.dueStr, dateOrder) : null;
      const docType = round2(inv.amount) < 0 ? 'DEBIT_NOTE' : 'INVOICE';
      if (docType === 'DEBIT_NOTE') debitNotes++;
      await insert('PurchaseInvoice', {
        companyId: req.tenant.companyId,
        invoiceNumber: inv.invoiceNumber.slice(0, 80),
        invoiceDate: date,
        dueDate,
        supplierName: (inv.supplierName || '—').slice(0, 200),
        gstin: inv.gstin ? inv.gstin.slice(0, 40) : null,
        taxType: inv.taxType ? inv.taxType.slice(0, 40) : null,
        amount: round2(inv.amount),
        purchaseAmount: round2(inv.purchaseAmount || 0),
        taxableAmount: round2(inv.taxableAmount || 0),
        igst: round2(inv.igst || 0), cgst: round2(inv.cgst || 0), sgst: round2(inv.sgst || 0),
        tds: round2(inv.tds || 0),
        docType,
        createdById: req.auth.userId,
      });
      imported++;
    } catch (e) {
      errors.push({ invoiceNumber: inv.invoiceNumber, message: e?.message ?? 'Insert failed' });
    }
  }

  res.json({ imported, skippedDuplicates, debitNotes, cancelled, totalInFile: invoices.length, errors: errors.slice(0, 100) });
}));

/* ---------- GET /summary ---------- */
router.get('/summary', requireAnyPermission('view_purchase_register', 'manage_invoices'), asyncHandler(async (req, res) => {
  const row = await qOne(
    `SELECT COUNT(*) total,
       COALESCE(SUM(\`amount\`),0) totalAmount,
       COALESCE(SUM(\`igst\` + \`cgst\` + \`sgst\`),0) gst,
       COALESCE(SUM(\`tds\`),0) tds,
       SUM(CASE WHEN \`docType\` = 'DEBIT_NOTE' THEN 1 ELSE 0 END) debitNotes
     FROM \`PurchaseInvoice\` WHERE \`companyId\` = ?`, [req.tenant.companyId]);
  res.json({
    total: Number(row?.total ?? 0),
    totalAmount: round2(Number(row?.totalAmount ?? 0)),
    gst: round2(Number(row?.gst ?? 0)),
    tds: round2(Number(row?.tds ?? 0)),
    debitNotes: Number(row?.debitNotes ?? 0),
  });
}));

/* ---------- GET /aging — per-supplier payable aging ---------- */
// Purchase bills have no due date and suppliers have no credit terms, so bills
// are aged by BILL DATE (days since the invoice date). Debit notes (negative
// balance) net the total down and sit in the current 0–30 bucket. Suppliers are
// grouped by normalized name so name variants from the import don't split a row.
router.get('/aging', requireAnyPermission('view_creditor_aging', 'manage_invoices'), asyncHandler(async (req, res) => {
  const rows = await q(
    `SELECT \`id\`, \`invoiceNumber\`, \`invoiceDate\`, \`supplierName\`, \`amount\`, \`paidAmount\`, \`docType\`
       FROM \`PurchaseInvoice\`
      WHERE \`companyId\` = ? AND \`status\` <> 'PAID'`,
    [req.tenant.companyId]
  );
  const now = new Date();
  const todayMid = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const groups = new Map();

  for (const p of rows) {
    const balance = round2(Number(p.amount) - Number(p.paidAmount));
    if (Math.abs(balance) <= 0.01) continue; // skip settled
    const key = normName(p.supplierName) || `__x__:${p.supplierName}`;
    if (!groups.has(key)) {
      groups.set(key, {
        supplierName: p.supplierName,
        b0_30: 0, b31_60: 0, b61_90: 0, b90: 0, total: 0, oldestDays: 0, invoices: [],
      });
    }
    const g = groups.get(key);
    const bill = new Date(p.invoiceDate);
    const billMid = Date.UTC(bill.getUTCFullYear(), bill.getUTCMonth(), bill.getUTCDate());
    const ageDays = Math.max(0, Math.floor((todayMid - billMid) / 86400000));
    if (balance < 0)          g.b0_30 = round2(g.b0_30 + balance); // debit note — reduces, treat as current
    else if (ageDays <= 30)   g.b0_30 = round2(g.b0_30 + balance);
    else if (ageDays <= 60)   g.b31_60 = round2(g.b31_60 + balance);
    else if (ageDays <= 90)   g.b61_90 = round2(g.b61_90 + balance);
    else                      g.b90 = round2(g.b90 + balance);
    if (balance > 0 && ageDays > g.oldestDays) g.oldestDays = ageDays;
    g.total = round2(g.total + balance);
    g.invoices.push({ id: p.id, invoiceNumber: p.invoiceNumber, invoiceDate: p.invoiceDate, balance, ageDays, docType: p.docType });
  }

  const suppliers = [...groups.values()].sort((a, b) => b.total - a.total);
  for (const g of suppliers) g.invoices.sort((a, b) => new Date(a.invoiceDate) - new Date(b.invoiceDate));
  const totals = suppliers.reduce((t, g) => ({
    b0_30: round2(t.b0_30 + g.b0_30), b31_60: round2(t.b31_60 + g.b31_60),
    b61_90: round2(t.b61_90 + g.b61_90), b90: round2(t.b90 + g.b90), total: round2(t.total + g.total),
  }), { b0_30: 0, b31_60: 0, b61_90: 0, b90: 0, total: 0 });

  res.json({ suppliers, totals });
}));

/* ---------- GET / — paginated list ---------- */
const listFilters = (query) => {
  const { search, docType } = query;
  let where = '`companyId` = ?';
  const params = [];
  if (docType && docType !== 'ALL') { where += ' AND `docType` = ?'; params.push(docType); }
  if (search) { const like = `%${search}%`; where += ' AND (`invoiceNumber` LIKE ? OR `supplierName` LIKE ? OR `gstin` LIKE ?)'; params.push(like, like, like); }
  return { where, params };
};

router.get('/', requireAnyPermission('view_purchase_register', 'manage_invoices'), asyncHandler(async (req, res) => {
  const { page, pageSize, search, docType } = z.object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(10000).default(50),
    search: z.string().trim().max(120).optional(),
    docType: z.enum(['ALL', 'INVOICE', 'DEBIT_NOTE']).default('ALL'),
  }).parse(req.query);
  const skip = (page - 1) * pageSize;
  const { where, params } = listFilters({ search, docType });
  const full = [req.tenant.companyId, ...params];

  const [rows, totalRow, agg] = await Promise.all([
    q(`SELECT * FROM \`PurchaseInvoice\` WHERE ${where} ORDER BY \`invoiceDate\` DESC, \`createdAt\` DESC LIMIT ? OFFSET ?`, [...full, pageSize, skip]),
    qOne(`SELECT COUNT(*) n FROM \`PurchaseInvoice\` WHERE ${where}`, full),
    qOne(`SELECT COALESCE(SUM(\`amount\`),0) amt, COALESCE(SUM(\`tds\`),0) tds, COALESCE(SUM(\`igst\`+\`cgst\`+\`sgst\`),0) gst FROM \`PurchaseInvoice\` WHERE ${where}`, full),
  ]);

  res.json({
    items: rows.map(flatten),
    total: Number(totalRow?.n ?? 0), page, pageSize,
    totals: { amount: round2(Number(agg?.amt ?? 0)), tds: round2(Number(agg?.tds ?? 0)), gst: round2(Number(agg?.gst ?? 0)) },
  });
}));

/* ---------- POST /bulk-delete ---------- */
router.post('/bulk-delete', requireAnyPermission('view_purchase_register', 'manage_invoices'), asyncHandler(async (req, res) => {
  const body = z.object({
    ids: z.array(z.string().min(1)).max(50000).optional(),
    all: z.boolean().optional(),
    search: z.string().trim().max(120).optional(),
    docType: z.enum(['ALL', 'INVOICE', 'DEBIT_NOTE']).default('ALL'),
  }).parse(req.body);

  let ids = [];
  if (body.all) {
    const { where, params } = listFilters(body);
    const rows = await q(`SELECT \`id\` FROM \`PurchaseInvoice\` WHERE ${where}`, [req.tenant.companyId, ...params]);
    ids = rows.map((r) => r.id);
  } else if (body.ids?.length) {
    const ph = body.ids.map(() => '?').join(',');
    const rows = await q(`SELECT \`id\` FROM \`PurchaseInvoice\` WHERE \`companyId\` = ? AND \`id\` IN (${ph})`, [req.tenant.companyId, ...body.ids]);
    ids = rows.map((r) => r.id);
  } else {
    throw new AppError('Select at least one row to delete.', 400, 'NOTHING_SELECTED');
  }
  if (!ids.length) return res.json({ deleted: 0 });

  const CHUNK = 500;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const batch = ids.slice(i, i + CHUNK);
    const ph = batch.map(() => '?').join(',');
    await q(`DELETE FROM \`PurchaseInvoice\` WHERE \`companyId\` = ? AND \`id\` IN (${ph})`, [req.tenant.companyId, ...batch]);
  }
  res.json({ deleted: ids.length });
}));

/* ---------- DELETE /:id ---------- */
router.delete('/:id', requireAnyPermission('view_purchase_register', 'manage_invoices'), asyncHandler(async (req, res) => {
  const row = await qOne('SELECT `id` FROM `PurchaseInvoice` WHERE `id` = ? AND `companyId` = ?', [req.params.id, req.tenant.companyId]);
  if (!row) throw new AppError('Purchase entry not found', 404, 'NOT_FOUND');
  await q('DELETE FROM `PurchaseInvoice` WHERE `id` = ?', [row.id]);
  res.status(204).end();
}));

export default router;
