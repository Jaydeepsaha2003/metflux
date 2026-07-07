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
  // Contra netting — a party that is BOTH a supplier and a customer has their
  // payable offset against what they owe us (their sales receivable), so the
  // aging shows the single net position. Receivable summed per normalized name.
  const recvRows = await q(
    `SELECT \`customerName\`, \`amount\`, \`paidAmount\`
       FROM \`SalesInvoice\`
      WHERE \`companyId\` = ? AND \`status\` <> 'PAID'`,
    [req.tenant.companyId]
  );
  const receivableByName = new Map();
  for (const s of recvRows) {
    const bal = round2(Number(s.amount) - Number(s.paidAmount));
    if (Math.abs(bal) <= 0.01) continue;
    const nk = normName(s.customerName);
    if (!nk) continue;
    receivableByName.set(nk, round2((receivableByName.get(nk) || 0) + bal));
  }

  // Unapplied advances — the ledger counts these but invoice balances can't
  // (an over-receipt never drives a bill below zero; the excess lives on the
  // Payment record as amount − allocatedAmount). Fold them in so Amount Payable
  // reconciles with the account ledger:
  //   • customer advance (money we hold for them, unapplied receipts) → we owe
  //     it back → ADDS to payable.
  //   • supplier advance (money we prepaid them, unapplied payments) → they owe
  //     us → REDUCES payable (behaves like a credit note).
  const custAdvByName = new Map(); // nk -> { name, adv }
  const supAdvByName = new Map();  // nk -> adv
  try {
    const advRows = await q(
      `SELECT c.\`name\` nm, COALESCE(SUM(p.\`amount\` - p.\`allocatedAmount\`), 0) adv
         FROM \`Payment\` p INNER JOIN \`Customer\` c ON c.\`id\` = p.\`customerId\`
        WHERE p.\`companyId\` = ? GROUP BY c.\`name\``,
      [req.tenant.companyId]
    );
    for (const r of advRows) {
      const nk = normName(r.nm); const v = round2(Number(r.adv));
      if (nk && v > 0.01) custAdvByName.set(nk, { name: r.nm, adv: round2((custAdvByName.get(nk)?.adv || 0) + v) });
    }
  } catch { /* Payment table absent on minimal installs */ }
  try {
    const advRows = await q(
      `SELECT \`supplierName\` nm, COALESCE(SUM(\`amount\` - \`allocatedAmount\`), 0) adv
         FROM \`SupplierPayment\` WHERE \`companyId\` = ? GROUP BY \`supplierName\``,
      [req.tenant.companyId]
    );
    for (const r of advRows) {
      const nk = normName(r.nm); const v = round2(Number(r.adv));
      if (nk && v > 0.01) supAdvByName.set(nk, round2((supAdvByName.get(nk) || 0) + v));
    }
  } catch { /* SupplierPayment table absent on minimal installs */ }

  // Supplier credit terms (dueDays) per normalized name — drives due-based
  // aging. Read live from the Supplier record so changing terms re-syncs the
  // buckets immediately (no stored due date on the bill).
  const dueDaysByName = new Map();
  const supRows = await q(
    `SELECT s.\`name\`, s.\`dueDays\`
       FROM \`Supplier\` s
       INNER JOIN \`SupplierMembership\` sm ON sm.\`supplierId\` = s.\`id\`
      WHERE sm.\`companyId\` = ?`,
    [req.tenant.companyId]
  );
  for (const s of supRows) {
    const k = normName(s.name);
    if (k && s.dueDays != null) dueDaysByName.set(k, Number(s.dueDays));
  }

  const now = new Date();
  const todayMid = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const DAY = 86400000;

  // Pass 1 — split each supplier's rows into open bills (positive) and a running
  // credit total (debit notes, negative). Bills are aged from their DUE date
  // (bill date + supplier credit terms) when terms are set, else by bill date.
  const groups = new Map();
  for (const p of rows) {
    const balance = round2(Number(p.amount) - Number(p.paidAmount));
    if (Math.abs(balance) <= 0.01) continue; // skip settled
    const key = normName(p.supplierName) || `__x__:${p.supplierName}`;
    if (!groups.has(key)) groups.set(key, { supplierName: p.supplierName, credit: 0, bills: [] });
    const g = groups.get(key);
    const bill = new Date(p.invoiceDate);
    const billMid = Date.UTC(bill.getUTCFullYear(), bill.getUTCMonth(), bill.getUTCDate());
    const dd = dueDaysByName.get(normName(p.supplierName));
    const anchorMid = dd != null ? billMid + dd * DAY : billMid; // due date if terms set
    const ageDays = Math.max(0, Math.floor((todayMid - anchorMid) / DAY));
    if (balance < 0) g.credit = round2(g.credit - balance); // debit note magnitude
    else g.bills.push({ id: p.id, invoiceNumber: p.invoiceNumber, invoiceDate: p.invoiceDate, balance, ageDays, docType: p.docType });
  }

  // Pass 2 — knock each supplier's credit (debit notes + contra receivable) off
  // their OLDEST open bills FIFO, then bucket the remaining balances.
  const suppliers = [];
  const handled = new Set();
  for (const g of groups.values()) {
    const nk = normName(g.supplierName);
    handled.add(nk);
    g.bills.sort((a, b) => new Date(a.invoiceDate) - new Date(b.invoiceDate));
    const contra = Math.max(0, receivableByName.get(nk) || 0);
    const supAdv = supAdvByName.get(nk) || 0;   // we prepaid them → reduces payable
    const custAdv = custAdvByName.get(nk)?.adv || 0; // we hold their money → adds to payable
    let remaining = round2(g.credit + contra + supAdv);
    for (const bill of g.bills) {
      if (remaining <= 0.01) break;
      const applied = Math.min(remaining, bill.balance);
      bill.balance = round2(bill.balance - applied);
      remaining = round2(remaining - applied);
    }

    const s = { supplierName: g.supplierName, contra, b0_30: 0, b31_60: 0, b61_90: 0, b90: 0, total: 0, oldestDays: 0, invoices: [] };
    for (const bill of g.bills) {
      if (bill.balance <= 0.01) continue; // squared off by credit / contra
      if (bill.ageDays <= 30)      s.b0_30 = round2(s.b0_30 + bill.balance);
      else if (bill.ageDays <= 60) s.b31_60 = round2(s.b31_60 + bill.balance);
      else if (bill.ageDays <= 90) s.b61_90 = round2(s.b61_90 + bill.balance);
      else                         s.b90 = round2(s.b90 + bill.balance);
      if (bill.ageDays > s.oldestDays) s.oldestDays = bill.ageDays;
      s.invoices.push({ id: bill.id, invoiceNumber: bill.invoiceNumber, invoiceDate: bill.invoiceDate, balance: bill.balance, ageDays: bill.ageDays, docType: bill.docType });
    }
    if (remaining > 0.01) {
      // Supplier in net credit (we're owed / advanced) — one summary line.
      s.b0_30 = round2(s.b0_30 - remaining);
      s.invoices.push({ id: `credit:${g.supplierName}`, invoiceNumber: 'Credit / Advance', invoiceDate: null, balance: round2(-remaining), ageDays: 0, docType: null });
    }
    if (custAdv > 0.01) {
      // Customer advance we're holding for this same party — we owe it back.
      s.b0_30 = round2(s.b0_30 + custAdv);
      s.invoices.push({ id: `advance:${g.supplierName}`, invoiceNumber: 'Advance received', invoiceDate: null, balance: round2(custAdv), ageDays: 0, docType: null });
    }
    s.total = round2(s.b0_30 + s.b31_60 + s.b61_90 + s.b90);
    // Drop anyone who nets to zero-or-below: fully netted, or a net-receivable
    // party (their sales outweigh our purchases) who belongs on the Debtor report.
    if (s.total <= 0.01) continue;
    suppliers.push(s);
  }

  // Parties we hold a customer advance for but who have no open purchase bills —
  // still net creditors (we owe them the advance), so surface them here too.
  for (const [nk, { name, adv }] of custAdvByName) {
    if (handled.has(nk) || adv <= 0.01) continue;
    const net = round2(adv - Math.max(0, receivableByName.get(nk) || 0) - (supAdvByName.get(nk) || 0));
    if (net <= 0.01) continue;
    suppliers.push({
      supplierName: name, contra: 0, b0_30: net, b31_60: 0, b61_90: 0, b90: 0, total: net, oldestDays: 0,
      invoices: [{ id: `advance:${name}`, invoiceNumber: 'Advance received', invoiceDate: null, balance: net, ageDays: 0, docType: null }],
    });
  }
  suppliers.sort((a, b) => b.total - a.total);
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
