// Sales Invoices — imported from an accounting export (Tally "List of Sales
// Vouchers"). Each invoice's due date = invoiceDate + the customer's credit
// terms (Customer.dueDays). Re-uploading the same file is idempotent (unique
// invoiceNumber per company). Powers the Debtor Aging + reminder views.
import { Router } from 'express';
import { z } from 'zod';
import { q, qOne, insert, update, txn } from '../lib/db.js';
import { AppError, asyncHandler } from '../lib/errors.js';
import { requireAuth, requirePermission, requireAnyPermission } from '../lib/auth.js';
import { resolveTenant } from '../lib/tenant.js';
import { round2, parseAmount, normName, addDays, inferDateOrder, parseDateWith, isCancelledName } from '../lib/invoicing.js';
import { createCustomerRecord } from '../lib/customers.js';

const router = Router();
router.use(requireAuth, resolveTenant);

/* ---------- shared shape for the client ---------- */
const flatten = (inv) => {
  const amount = Number(inv.amount) || 0;
  const paid = Number(inv.paidAmount) || 0;
  const balance = round2(amount - paid);
  let daysOverdue = null;
  if (inv.dueDate && balance > 0.01) {
    daysOverdue = Math.floor((Date.now() - new Date(inv.dueDate).getTime()) / 86400000);
  }
  const igst = Number(inv.igst) || 0;
  const cgst = Number(inv.cgst) || 0;
  const sgst = Number(inv.sgst) || 0;
  return {
    id: inv.id,
    invoiceNumber: inv.invoiceNumber,
    invoiceDate: inv.invoiceDate,
    customerId: inv.customerId,
    customerName: inv.customerName,
    customerCode: inv.customerCode ?? null,
    customerPhone: inv.customerPhone ?? null,
    itemDetails: inv.itemDetails,
    amount, paidAmount: paid, balance,
    // GST kept separately; `amount` already includes it (= invoice due).
    taxType: inv.taxType ?? null,
    taxableAmount: Number(inv.taxableAmount) || 0,
    igst, cgst, sgst,
    gst: round2(igst + cgst + sgst),
    docType: inv.docType ?? (amount < 0 ? 'CREDIT_NOTE' : 'INVOICE'),
    dueDate: inv.dueDate,
    status: inv.status,
    daysOverdue,
    needsAttention: !inv.customerId || !inv.dueDate,
  };
};

/* ---------- POST /import — parse the vouchers sheet (sent as a raw matrix) ---------- */
const importSchema = z.object({ rows: z.array(z.array(z.any())).max(20000) });

router.post('/import', requireAnyPermission('view_sales_register', 'manage_invoices'), asyncHandler(async (req, res) => {
  const { rows } = importSchema.parse(req.body);
  const matrix = rows.map((r) => (Array.isArray(r) ? r.map((c) => String(c ?? '').trim()) : []));

  // Locate the header row (banner rows precede it in a Tally export).
  let headerIdx = matrix.findIndex((r) => {
    const j = r.join(' ').toLowerCase();
    return /vch|bill|voucher|invoice/.test(j) && /particular|party|customer|date/.test(j);
  });
  if (headerIdx < 0) headerIdx = matrix.findIndex((r) => r.some((c) => /^date$/i.test(c)));
  if (headerIdx < 0) {
    throw new AppError('Could not find the column header row (expected Date, Vch/Bill No, Particulars, Amount).', 400, 'NO_HEADER');
  }
  const header = matrix[headerIdx].map((c) => c.toLowerCase());
  const findCol = (...keys) => {
    for (const k of keys) { const i = header.findIndex((h) => h.includes(k)); if (i >= 0) return i; }
    return -1;
  };
  const cDate = findCol('date');
  const cVch  = findCol('vch', 'bill', 'voucher', 'invoice');
  const cPart = findCol('particular', 'party', 'customer', 'account');
  const cItem = findCol('item', 'description', 'detail');
  const cAmt  = findCol('amount', 'value', 'total');
  if (cVch < 0 || cAmt < 0) {
    throw new AppError('The sheet needs a Vch/Bill No column and an Amount column.', 400, 'BAD_HEADER');
  }
  // Optional Sales-Register columns: tax type + the GST breakdown. Absent in
  // the plainer voucher export (then these stay -1 and we just store zeros).
  const cType    = findCol('type');
  const cSale    = findCol('sale');
  const cTaxable = findCol('taxable');
  const cIgst    = findCol('igst');
  const cCgst    = findCol('cgst');
  const cSgst    = findCol('sgst');
  const cOther   = findCol('other');
  const cGstin   = findCol('gstin', 'tin');   // for auto-creating customers
  const cMobile  = findCol('mobile');
  const cell = (r, i) => (i >= 0 ? (r[i] ?? '').trim() : '');

  // A trailing totals row carries no Vch No and instead has "Total" in the
  // Type/Account column, or a "Total Tax Amount" banner. Always ignored.
  const isTotalsRow = (r, vch) => {
    if (vch) return false;
    const joined = r.join(' ').toLowerCase();
    return /grand\s*total/.test(joined)
      || /total\s*tax\s*amount/.test(joined)
      || /^total$/i.test(cell(r, cType))
      || /^total\b/i.test(cell(r, cPart));
  };

  // Group line items into invoices. A row with a Vch No starts a new invoice;
  // blank-Vch rows that still carry an item are continuation lines we sum in.
  const invoices = [];
  let cur = null;
  for (let i = headerIdx + 1; i < matrix.length; i++) {
    const r = matrix[i];
    const vch  = (r[cVch] ?? '').trim();
    const date = cDate >= 0 ? (r[cDate] ?? '').trim() : '';
    const part = cPart >= 0 ? (r[cPart] ?? '').trim() : '';
    const item = cItem >= 0 ? (r[cItem] ?? '').trim() : '';
    const amt  = parseAmount(r[cAmt]);
    if (isTotalsRow(r, vch)) { cur = null; continue; }
    if (vch) {
      cur = {
        invoiceNumber: vch, dateStr: date, customerName: part,
        items: item ? [item] : [], amount: amt,
        taxType:       cell(r, cType) || null,
        saleAmount:    parseAmount(r[cSale]),
        taxableAmount: parseAmount(r[cTaxable]),
        igst:          parseAmount(r[cIgst]),
        cgst:          parseAmount(r[cCgst]),
        sgst:          parseAmount(r[cSgst]),
        otherAmount:   parseAmount(r[cOther]),
        gstin:         cell(r, cGstin) || null,
        phone:         cell(r, cMobile) || null,
      };
      invoices.push(cur);
    } else if (cur && item) {
      cur.amount = round2(cur.amount + amt);
      cur.items.push(item);
    }
  }

  // Build lookups: customer-by-name + existing invoice numbers (dedupe).
  const customers = await q('SELECT `id`, `name`, `dueDays` FROM `Customer` WHERE `companyId` = ?', [req.tenant.companyId]);
  const byName = new Map();
  const byId = new Map();
  for (const c of customers) { byId.set(c.id, c); const k = normName(c.name); if (k && !byName.has(k)) byName.set(k, c); }
  // Existing rows keyed by invoice number — we re-parse their date on re-import
  // so a wrong date from an earlier import (month/day swap) gets corrected.
  const existingRows = await q('SELECT `id`, `invoiceNumber`, `invoiceDate`, `customerId` FROM `SalesInvoice` WHERE `companyId` = ?', [req.tenant.companyId]);
  const existingByNum = new Map(existingRows.map((r) => [r.invoiceNumber, r]));

  // Decide the date order once for the file — the register mixes month-first
  // invoices (4/1/25 = 1 Apr) with day-first credit notes (13-06-2025 = 13 Jun);
  // an unambiguous component (>12) still wins per row.
  const dateOrder = inferDateOrder(invoices.map((inv) => inv.dateStr));

  let imported = 0, skippedDuplicates = 0, datesFixed = 0, cancelled = 0, customersCreated = 0, unmatchedCustomers = 0, missingDueDays = 0;
  const errors = [];
  const seen = new Set();

  for (const inv of invoices) {
    try {
      if (!inv.invoiceNumber || seen.has(inv.invoiceNumber)) { continue; }
      seen.add(inv.invoiceNumber);

      // Cancelled voucher → never an invoice. Skip it, and remove it if a prior
      // import had saved it.
      if (isCancelledName(inv.customerName)) {
        const prior = existingByNum.get(inv.invoiceNumber);
        if (prior) {
          await q('DELETE FROM `PaymentAllocation` WHERE `salesInvoiceId` = ?', [prior.id]);
          await q('DELETE FROM `SalesInvoice` WHERE `id` = ?', [prior.id]);
        }
        cancelled++;
        continue;
      }

      const date = parseDateWith(inv.dateStr, dateOrder);

      // Already imported → don't re-insert, but correct its date if it changed.
      const prior = existingByNum.get(inv.invoiceNumber);
      if (prior) {
        if (date) {
          const cur = prior.invoiceDate ? new Date(prior.invoiceDate) : null;
          if (!cur || cur.getTime() !== date.getTime()) {
            const patch = { invoiceDate: date };
            const c = prior.customerId ? byId.get(prior.customerId) : null;
            if (c?.dueDays != null) patch.dueDate = addDays(date, Number(c.dueDays));
            await update('SalesInvoice', prior.id, patch);
            datesFixed++;
          } else { skippedDuplicates++; }
        } else { skippedDuplicates++; }
        continue;
      }

      if (!date) { errors.push({ invoiceNumber: inv.invoiceNumber, message: `Unreadable date "${inv.dateStr || '(blank)'}"` }); continue; }

      // Match the customer by name; auto-create one (with GSTIN/phone/state from
      // the register) when there's no match, then link the invoice to it.
      let match = inv.customerName ? byName.get(normName(inv.customerName)) : null;
      if (!match && inv.customerName) {
        match = await createCustomerRecord({
          companyId: req.tenant.companyId, createdById: req.auth.userId,
          name: inv.customerName, gstNumber: inv.gstin, phone: inv.phone,
        });
        byName.set(normName(match.name), match);   // cache for later rows
        byId.set(match.id, match);
        customersCreated++;
      }
      let dueDate = null;
      if (!match) unmatchedCustomers++;
      else if (match.dueDays == null) missingDueDays++;
      else dueDate = addDays(date, Number(match.dueDays));

      await insert('SalesInvoice', {
        companyId: req.tenant.companyId,
        invoiceNumber: inv.invoiceNumber.slice(0, 80),
        invoiceDate: date,
        customerId: match?.id ?? null,
        customerName: (inv.customerName || match?.name || '—').slice(0, 200),
        itemDetails: inv.items.join(' | ').slice(0, 400) || null,
        amount: round2(inv.amount),
        docType: round2(inv.amount) < 0 ? 'CREDIT_NOTE' : 'INVOICE',
        taxType: inv.taxType ? String(inv.taxType).slice(0, 40) : null,
        saleAmount: round2(inv.saleAmount || 0),
        taxableAmount: round2(inv.taxableAmount || 0),
        igst: round2(inv.igst || 0),
        cgst: round2(inv.cgst || 0),
        sgst: round2(inv.sgst || 0),
        otherAmount: round2(inv.otherAmount || 0),
        dueDate,
        paidAmount: 0,
        status: 'UNPAID',
        createdById: req.auth.userId,
      });
      imported++;
    } catch (e) {
      errors.push({ invoiceNumber: inv.invoiceNumber, message: e?.message ?? 'Insert failed' });
    }
  }

  res.json({
    imported, skippedDuplicates, datesFixed, cancelled, customersCreated, unmatchedCustomers, missingDueDays,
    totalInvoicesInFile: invoices.length,
    errors: errors.slice(0, 100),
  });
}));

/* ---------- GET /summary — dashboard cards ---------- */
router.get('/summary', requireAnyPermission('view_sales_register', 'manage_invoices'), asyncHandler(async (req, res) => {
  const row = await qOne(
    `SELECT
       COUNT(*) AS total,
       COALESCE(SUM(\`amount\` - \`paidAmount\`), 0) AS outstanding,
       COALESCE(SUM(CASE WHEN \`status\` <> 'PAID' AND \`dueDate\` IS NOT NULL AND \`dueDate\` < NOW()
                         THEN \`amount\` - \`paidAmount\` ELSE 0 END), 0) AS overdue,
       SUM(CASE WHEN \`status\` <> 'PAID' THEN 1 ELSE 0 END) AS openCount,
       SUM(CASE WHEN \`customerId\` IS NULL OR \`dueDate\` IS NULL THEN 1 ELSE 0 END) AS attention
     FROM \`SalesInvoice\` WHERE \`companyId\` = ?`,
    [req.tenant.companyId]
  );
  res.json({
    totalInvoices: Number(row?.total ?? 0),
    outstanding: round2(Number(row?.outstanding ?? 0)),
    overdue: round2(Number(row?.overdue ?? 0)),
    openCount: Number(row?.openCount ?? 0),
    attention: Number(row?.attention ?? 0),
  });
}));

/* ---------- GET /aging — per-customer aging buckets (powers reminders) ---------- */
router.get('/aging', requireAnyPermission('view_debtor_aging', 'manage_invoices'), asyncHandler(async (req, res) => {
  const rows = await q(
    `SELECT si.*, c.\`name\` AS cName, c.\`phone\` AS cPhone, c.\`customerCode\` AS cCode, c.\`dueDays\` AS cDueDays, c.\`email\` AS cEmail
       FROM \`SalesInvoice\` si
       LEFT JOIN \`Customer\` c ON c.\`id\` = si.\`customerId\`
      WHERE si.\`companyId\` = ? AND si.\`status\` <> 'PAID'`,
    [req.tenant.companyId]
  );
  // Ledger-basis net per party — the report total is reconciled to THIS figure
  // so Amount Receivable always equals the account ledger's closing balance. It
  // is computed exactly like the ledger: GROSS invoices (all statuses) ± the
  // actual bank/cash book — NOT the point-in-time payment allocation, which
  // drifts. (Cash-book payments already cover refunds / money paid back, so no
  // separate refund pass is needed.)
  //   netReceivable = (Σ sales − Σ receipts) − (Σ purchases − Σ payments)  [Dr]
  const siSumByName = new Map(); // nk -> Σ SalesInvoice.amount (signed)
  const piSumByName = new Map(); // nk -> Σ PurchaseInvoice.amount (signed)
  const rcptByName = new Map();  // nk -> Σ cash-book receipts
  const payByName = new Map();   // nk -> Σ cash-book payments
  const jvByName = new Map();    // nk -> Σ journal (Debit − Credit), a receivable delta
  const nameByNk = new Map();    // nk -> display name
  const addName = (nk, nm) => { if (nk && nm && !nameByNk.has(nk)) nameByNk.set(nk, nm); };
  {
    const siRows = await q('SELECT `customerName` nm, COALESCE(SUM(`amount`),0) s FROM `SalesInvoice` WHERE `companyId` = ? GROUP BY `customerName`', [req.tenant.companyId]);
    for (const r of siRows) { const nk = normName(r.nm); if (!nk) continue; addName(nk, r.nm); siSumByName.set(nk, round2((siSumByName.get(nk) || 0) + Number(r.s))); }
    const piRows = await q('SELECT `supplierName` nm, COALESCE(SUM(`amount`),0) s FROM `PurchaseInvoice` WHERE `companyId` = ? GROUP BY `supplierName`', [req.tenant.companyId]);
    for (const r of piRows) { const nk = normName(r.nm); if (!nk) continue; addName(nk, r.nm); piSumByName.set(nk, round2((piSumByName.get(nk) || 0) + Number(r.s))); }
    try {
      const cbRows = await q("SELECT `normKey` k, `side`, COALESCE(SUM(`amount`),0) s FROM `CashbookEntry` WHERE `companyId` = ? GROUP BY `normKey`, `side`", [req.tenant.companyId]);
      for (const r of cbRows) { const nk = r.k; if (!nk) continue; if (r.side === 'RECEIPT') rcptByName.set(nk, round2((rcptByName.get(nk) || 0) + Number(r.s))); else payByName.set(nk, round2((payByName.get(nk) || 0) + Number(r.s))); }
    } catch { /* cashbook table absent on minimal installs */ }
    try {
      const jvRows = await q("SELECT `normKey` k, `account` nm, `side`, COALESCE(SUM(`amount`),0) s FROM `JournalVoucher` WHERE `companyId` = ? GROUP BY `normKey`, `account`, `side`", [req.tenant.companyId]);
      for (const r of jvRows) { const nk = r.k; if (!nk) continue; addName(nk, r.nm); const d = r.side === 'DEBIT' ? Number(r.s) : -Number(r.s); jvByName.set(nk, round2((jvByName.get(nk) || 0) + d)); }
    } catch { /* JournalVoucher table absent on minimal installs */ }
  }
  // Only real trading parties belong on the aging. A cash-book head classified
  // as Other/Expense (e.g. Salary, Rent) has payments but is NOT a customer —
  // its payment must not read as a receivable. Restrict to customers + suppliers
  // so expense/unclassified heads never leak onto the report.
  const partySet = new Set();
  const custByName = new Map(); // nk -> customer record, to resolve net-only parties
  for (const r of await q('SELECT `id`, `name`, `customerCode`, `phone`, `dueDays`, `email` FROM `Customer` WHERE `companyId` = ?', [req.tenant.companyId])) {
    const nk = normName(r.name); if (!nk) continue; partySet.add(nk);
    if (!custByName.has(nk)) custByName.set(nk, r);
  }
  for (const r of await q('SELECT s.`name` FROM `Supplier` s INNER JOIN `SupplierMembership` sm ON sm.`supplierId` = s.`id` WHERE sm.`companyId` = ?', [req.tenant.companyId])) { const nk = normName(r.name); if (nk) partySet.add(nk); }

  const lPayOf = (nk) => round2((piSumByName.get(nk) || 0) - (payByName.get(nk) || 0));
  const netReceivableByName = new Map(); // nk -> they owe us (positive), ledger basis
  for (const nk of new Set([...siSumByName.keys(), ...piSumByName.keys(), ...rcptByName.keys(), ...payByName.keys(), ...jvByName.keys()])) {
    // CUSTOMERS ONLY. A registered customer, or anyone we've raised a sales
    // invoice to. Supplier-only parties (e.g. one we've prepaid) and cash-book
    // heads (expense/other/unclassified) never belong on Amount Receivable —
    // their position lives on Amount Payable / the ledger, not here.
    if (!(custByName.has(nk) || siSumByName.has(nk))) continue;
    // Journal Debit adds to receivable (like a sale), Credit subtracts — same as
    // the ledger, so aging stays reconciled with it.
    const lRecv = round2((siSumByName.get(nk) || 0) - (rcptByName.get(nk) || 0) + (jvByName.get(nk) || 0));
    netReceivableByName.set(nk, round2(lRecv - lPayOf(nk)));
  }

  const now = new Date();
  const todayMid = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const daysOverdue = (dueIso) => {
    if (!dueIso) return null;
    const due = new Date(dueIso);
    return Math.floor((todayMid - Date.UTC(due.getUTCFullYear(), due.getUTCMonth(), due.getUTCDate())) / 86400000);
  };

  // Pass 1 — split each customer's rows into open bills (positive balance) and a
  // running credit total (sales returns / credit notes / advances, negative).
  const groups = new Map();
  for (const inv of rows) {
    const balance = round2(Number(inv.amount) - Number(inv.paidAmount));
    if (Math.abs(balance) <= 0.01) continue; // settled
    const key = inv.customerId ?? `__x__:${inv.customerName}`;
    if (!groups.has(key)) {
      groups.set(key, {
        customerId: inv.customerId ?? null,
        customerName: inv.cName ?? inv.customerName,
        customerCode: inv.cCode ?? null,
        phone: inv.cPhone ?? null,
        dueDays: inv.cDueDays ?? null,
        email: inv.cEmail ?? null,
        credit: 0, bills: [],
      });
    }
    const g = groups.get(key);
    // Effective due date from the customer's CURRENT credit terms, so changing
    // dueDays re-syncs aging immediately (falls back to the stored dueDate).
    const effDue = inv.cDueDays != null && inv.invoiceDate
      ? addDays(new Date(inv.invoiceDate), Number(inv.cDueDays))
      : inv.dueDate;
    if (balance < 0) g.credit = round2(g.credit - balance); // accumulate magnitude
    else g.bills.push({ id: inv.id, invoiceNumber: inv.invoiceNumber, invoiceDate: inv.invoiceDate, dueDate: effDue, balance });
  }

  // Pass 2 — bucket each customer's open bills by overdue days, then reconcile
  // the total to the ledger-basis net receivable: reduce the OLDEST bills first
  // when the net is below the gross open bills (returns, receipts, contra
  // payable), or add a single "Advance / On account" line when the net is higher
  // (a prepayment we made them). This guarantees the total matches the ledger.
  const customers = [];
  const handled = new Set();
  for (const g of groups.values()) {
    g.bills.sort((a, b) => {
      const ad = a.dueDate ? new Date(a.dueDate).getTime() : Infinity;
      const bd = b.dueDate ? new Date(b.dueDate).getTime() : Infinity;
      if (ad !== bd) return ad - bd;
      return new Date(a.invoiceDate).getTime() - new Date(b.invoiceDate).getTime();
    });
    const nk = normName(g.customerName);
    handled.add(nk);
    const contra = Math.max(0, lPayOf(nk)); // for the "net of purchases" info badge

    // If the sales invoices weren't linked to a customer record, try to resolve
    // one by normalized name; only truly unresolved names stay flagged.
    const resolved = g.customerId ? null : custByName.get(nk);
    const c = {
      customerId: g.customerId ?? resolved?.id ?? null,
      customerName: g.customerName, customerCode: g.customerCode ?? resolved?.customerCode ?? null,
      phone: g.phone ?? resolved?.phone ?? null, dueDays: g.dueDays ?? resolved?.dueDays ?? null,
      email: g.email ?? resolved?.email ?? null, contra,
      // Unmatched = real sales invoices with no customer link (fix on Invoices).
      unmatched: !g.customerId && !resolved,
      notDue: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90: 0, noTerms: 0, total: 0,
      maxDaysOverdue: 0, invoices: [],
    };

    const grossBills = round2(g.bills.reduce((a, b) => a + b.balance, 0));
    const target = netReceivableByName.has(nk) ? netReceivableByName.get(nk) : round2(grossBills - g.credit);
    // Reduce oldest bills first when the ledger net is below the gross bills.
    let reduce = round2(grossBills - Math.max(target, 0));
    for (const bill of g.bills) {
      let bal = bill.balance;
      if (reduce > 0.01) { const cut = Math.min(reduce, bal); bal = round2(bal - cut); reduce = round2(reduce - cut); }
      if (bal <= 0.01) continue;
      const days = daysOverdue(bill.dueDate);
      if (days == null) c.noTerms = round2(c.noTerms + bal);
      else if (days <= 0) c.notDue = round2(c.notDue + bal);
      else if (days <= 30) c.d1_30 = round2(c.d1_30 + bal);
      else if (days <= 60) c.d31_60 = round2(c.d31_60 + bal);
      else if (days <= 90) c.d61_90 = round2(c.d61_90 + bal);
      else c.d90 = round2(c.d90 + bal);
      if (days != null && days > c.maxDaysOverdue) c.maxDaysOverdue = days;
      c.invoices.push({ id: bill.id, invoiceNumber: bill.invoiceNumber, invoiceDate: bill.invoiceDate, dueDate: bill.dueDate, balance: bal, daysOverdue: days });
    }
    // Residual (advance/on-account, or net beyond the aged bills) as one line so
    // the buckets sum exactly to the ledger net receivable.
    const residual = round2(target - round2(c.notDue + c.d1_30 + c.d31_60 + c.d61_90 + c.d90 + c.noTerms));
    if (Math.abs(residual) > 0.01) {
      c.notDue = round2(c.notDue + residual);
      c.invoices.push({ id: `onacct:${g.customerId ?? g.customerName}`, invoiceNumber: residual >= 0 ? 'Advance / On account' : 'Credit / Advance', invoiceDate: null, dueDate: null, balance: residual, daysOverdue: null });
    }
    c.total = round2(c.notDue + c.d1_30 + c.d31_60 + c.d61_90 + c.d90 + c.noTerms);
    // Drop anyone who nets to zero-or-below: fully squared off, or a net-payable
    // party (advance / contra) who belongs on the Creditor report.
    if (c.total <= 0.01) continue;
    customers.push(c);
  }

  // Net-receivable parties with no open sales bills (a prepayment we made, or net
  // after full contra) — still debtors, surfaced from the ledger net.
  for (const [nk, net] of netReceivableByName) {
    if (handled.has(nk) || net <= 0.01) continue;
    const cust = custByName.get(nk); // resolve a real customer if the name matches
    const name = cust?.name || nameByNk.get(nk) || nk;
    customers.push({
      customerId: cust?.id ?? null, customerName: name, customerCode: cust?.customerCode ?? null,
      phone: cust?.phone ?? null, dueDays: cust?.dueDays ?? null, email: cust?.email ?? null, contra: 0,
      // A net/advance line is a real position, not an unlinked invoice — never flag it red.
      unmatched: false,
      notDue: net, d1_30: 0, d31_60: 0, d61_90: 0, d90: 0, noTerms: 0, total: net, maxDaysOverdue: 0,
      invoices: [{ id: `onacct:${name}`, invoiceNumber: 'Advance / On account', invoiceDate: null, dueDate: null, balance: net, daysOverdue: null }],
    });
  }

  customers.sort((a, b) => b.total - a.total);
  const totals = customers.reduce((t, g) => ({
    notDue: round2(t.notDue + g.notDue), d1_30: round2(t.d1_30 + g.d1_30),
    d31_60: round2(t.d31_60 + g.d31_60), d61_90: round2(t.d61_90 + g.d61_90),
    d90: round2(t.d90 + g.d90), noTerms: round2(t.noTerms + g.noTerms), total: round2(t.total + g.total),
  }), { notDue: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90: 0, noTerms: 0, total: 0 });

  res.json({ customers, totals });
}));

/* ---------- GET / — paginated list ---------- */
router.get('/', requireAnyPermission('view_sales_register', 'manage_invoices'), asyncHandler(async (req, res) => {
  const { page, pageSize, search, status, filter, docType } = z.object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(10000).default(50),
    search: z.string().trim().max(120).optional(),
    status: z.enum(['UNPAID', 'PARTIAL', 'PAID', 'OVERDUE', 'ALL']).default('ALL'),
    filter: z.enum(['ALL', 'ATTENTION']).default('ALL'),
    docType: z.enum(['ALL', 'INVOICE', 'CREDIT_NOTE']).default('ALL'),
  }).parse(req.query);
  const skip = (page - 1) * pageSize;

  let where = 'si.`companyId` = ?';
  const params = [req.tenant.companyId];
  if (status === 'OVERDUE') where += " AND si.`status` <> 'PAID' AND si.`dueDate` IS NOT NULL AND si.`dueDate` < NOW()";
  else if (status !== 'ALL') { where += ' AND si.`status` = ?'; params.push(status); }
  if (filter === 'ATTENTION') where += ' AND (si.`customerId` IS NULL OR si.`dueDate` IS NULL)';
  if (docType !== 'ALL') { where += ' AND si.`docType` = ?'; params.push(docType); }
  if (search) { const like = `%${search}%`; where += ' AND (si.`invoiceNumber` LIKE ? OR si.`customerName` LIKE ?)'; params.push(like, like); }

  const base = `FROM \`SalesInvoice\` si LEFT JOIN \`Customer\` c ON c.\`id\` = si.\`customerId\` WHERE ${where}`;
  const [rows, totalRow, agg] = await Promise.all([
    q(`SELECT si.*, c.\`customerCode\` AS customerCode, c.\`phone\` AS customerPhone ${base}
        ORDER BY si.\`invoiceDate\` DESC, si.\`createdAt\` DESC LIMIT ? OFFSET ?`, [...params, pageSize, skip]),
    qOne(`SELECT COUNT(*) AS n ${base}`, params),
    qOne(`SELECT COALESCE(SUM(si.\`amount\`),0) AS amt, COALESCE(SUM(si.\`paidAmount\`),0) AS paid ${base}`, params),
  ]);

  res.json({
    items: rows.map(flatten),
    total: Number(totalRow?.n ?? 0), page, pageSize,
    totals: {
      amount: round2(Number(agg?.amt ?? 0)),
      paid: round2(Number(agg?.paid ?? 0)),
      balance: round2(Number(agg?.amt ?? 0) - Number(agg?.paid ?? 0)),
    },
  });
}));

/* ---------- PATCH /:id — fix a flagged invoice (assign customer / set due date) ---------- */
router.patch('/:id', requireAnyPermission('view_sales_register', 'manage_invoices'), asyncHandler(async (req, res) => {
  const data = z.object({
    customerId: z.string().min(1).optional().nullable(),
    dueDate: z.coerce.date().optional().nullable(),
    notes: z.string().max(400).optional().nullable(),
  }).parse(req.body);

  const inv = await qOne('SELECT * FROM `SalesInvoice` WHERE `id` = ? AND `companyId` = ?', [req.params.id, req.tenant.companyId]);
  if (!inv) throw new AppError('Invoice not found', 404, 'NOT_FOUND');

  const patch = {};
  if (data.customerId !== undefined) {
    if (data.customerId) {
      const c = await qOne('SELECT `id`, `name`, `dueDays` FROM `Customer` WHERE `id` = ? AND `companyId` = ?', [data.customerId, req.tenant.companyId]);
      if (!c) throw new AppError('Customer not found', 400, 'BAD_CUSTOMER');
      patch.customerId = c.id;
      patch.customerName = c.name;
      // Auto-fill due date from the newly-linked customer's terms if not set.
      if (data.dueDate === undefined && !inv.dueDate && c.dueDays != null) {
        patch.dueDate = addDays(new Date(inv.invoiceDate), Number(c.dueDays));
      }
    } else {
      patch.customerId = null;
    }
  }
  if (data.dueDate !== undefined) patch.dueDate = data.dueDate;
  if (data.notes !== undefined) patch.notes = data.notes ?? null;

  await update('SalesInvoice', inv.id, patch);
  const fresh = await qOne(
    `SELECT si.*, c.\`customerCode\` AS customerCode, c.\`phone\` AS customerPhone
       FROM \`SalesInvoice\` si LEFT JOIN \`Customer\` c ON c.\`id\` = si.\`customerId\` WHERE si.\`id\` = ?`,
    [inv.id]
  );
  res.json(flatten(fresh));
}));

/* ---------- POST /bulk-delete — delete many invoices at once ----------
   Body is either { ids: [...] } (explicit selection) or { all: true } plus the
   current list filters (delete every matching invoice across all pages). Each
   invoice's payment allocations are reversed, exactly like single delete. */
router.post('/bulk-delete', requireAnyPermission('view_sales_register', 'manage_invoices'), asyncHandler(async (req, res) => {
  const body = z.object({
    ids: z.array(z.string().min(1)).max(50000).optional(),
    all: z.boolean().optional(),
    status: z.enum(['UNPAID', 'PARTIAL', 'PAID', 'OVERDUE', 'ALL']).default('ALL'),
    search: z.string().trim().max(120).optional(),
    filter: z.enum(['ALL', 'ATTENTION']).default('ALL'),
    docType: z.enum(['ALL', 'INVOICE', 'CREDIT_NOTE']).default('ALL'),
  }).parse(req.body);

  // Resolve the target invoice ids, always re-scoped to the active company.
  let ids = [];
  if (body.all) {
    let where = 'si.`companyId` = ?';
    const params = [req.tenant.companyId];
    if (body.status === 'OVERDUE') where += " AND si.`status` <> 'PAID' AND si.`dueDate` IS NOT NULL AND si.`dueDate` < NOW()";
    else if (body.status !== 'ALL') { where += ' AND si.`status` = ?'; params.push(body.status); }
    if (body.filter === 'ATTENTION') where += ' AND (si.`customerId` IS NULL OR si.`dueDate` IS NULL)';
    if (body.docType !== 'ALL') { where += ' AND si.`docType` = ?'; params.push(body.docType); }
    if (body.search) { const like = `%${body.search}%`; where += ' AND (si.`invoiceNumber` LIKE ? OR si.`customerName` LIKE ?)'; params.push(like, like); }
    const rows = await q(`SELECT si.\`id\` FROM \`SalesInvoice\` si WHERE ${where}`, params);
    ids = rows.map((r) => r.id);
  } else if (body.ids?.length) {
    const ph = body.ids.map(() => '?').join(',');
    const rows = await q(
      `SELECT \`id\` FROM \`SalesInvoice\` WHERE \`companyId\` = ? AND \`id\` IN (${ph})`,
      [req.tenant.companyId, ...body.ids]
    );
    ids = rows.map((r) => r.id);
  } else {
    throw new AppError('Select at least one invoice to delete.', 400, 'NOTHING_SELECTED');
  }

  if (!ids.length) return res.json({ deleted: 0 });

  // Delete in batches so the IN(...) lists and the txn stay a sane size.
  const CHUNK = 500;
  await txn(async (tx) => {
    for (let i = 0; i < ids.length; i += CHUNK) {
      const batch = ids.slice(i, i + CHUNK);
      const ph = batch.map(() => '?').join(',');
      // Reverse each affected payment's allocated total in one grouped pass.
      const allocs = await tx.q(
        `SELECT \`paymentId\`, COALESCE(SUM(\`amount\`), 0) AS amt
           FROM \`PaymentAllocation\` WHERE \`salesInvoiceId\` IN (${ph}) GROUP BY \`paymentId\``,
        batch
      );
      for (const a of allocs) {
        await tx.q(
          'UPDATE `Payment` SET `allocatedAmount` = GREATEST(0, ROUND(`allocatedAmount` - ?, 2)) WHERE `id` = ?',
          [Number(a.amt) || 0, a.paymentId]
        );
      }
      await tx.q(`DELETE FROM \`PaymentAllocation\` WHERE \`salesInvoiceId\` IN (${ph})`, batch);
      await tx.q(`DELETE FROM \`SalesInvoice\` WHERE \`companyId\` = ? AND \`id\` IN (${ph})`, [req.tenant.companyId, ...batch]);
    }
  });

  res.json({ deleted: ids.length });
}));

/* ---------- DELETE /:id — remove an invoice, reversing any payment allocations ---------- */
router.delete('/:id', requireAnyPermission('view_sales_register', 'manage_invoices'), asyncHandler(async (req, res) => {
  const inv = await qOne('SELECT `id` FROM `SalesInvoice` WHERE `id` = ? AND `companyId` = ?', [req.params.id, req.tenant.companyId]);
  if (!inv) throw new AppError('Invoice not found', 404, 'NOT_FOUND');
  await txn(async (tx) => {
    const allocs = await tx.q('SELECT * FROM `PaymentAllocation` WHERE `salesInvoiceId` = ?', [inv.id]);
    for (const a of allocs) {
      const pay = await tx.qOne('SELECT * FROM `Payment` WHERE `id` = ?', [a.paymentId]);
      if (pay) await tx.update('Payment', pay.id, { allocatedAmount: Math.max(0, round2(Number(pay.allocatedAmount) - Number(a.amount))) });
    }
    await tx.q('DELETE FROM `PaymentAllocation` WHERE `salesInvoiceId` = ?', [inv.id]);
    await tx.q('DELETE FROM `SalesInvoice` WHERE `id` = ?', [inv.id]);
  });
  res.status(204).end();
}));

export default router;
