// Party-wise ledger — a running account statement for one trading party,
// assembled from the SAME four sources the Amount Receivable / Payable reports
// reconcile to, so a party's closing balance always equals their aged balance:
//   Dr (they owe us):  sales invoices, payments we made to them (cash book OUT)
//   Cr (we owe them):  receipts from them (cash book IN), purchase bills
//   Journal:           DEBIT adds to receivable, CREDIT subtracts
// Parties are keyed by normalized name (normName), exactly like the reconciler.
import { Router } from 'express';
import { z } from 'zod';
import { q } from '../lib/db.js';
import { asyncHandler, AppError } from '../lib/errors.js';
import { requireAuth, requireAnyPermission } from '../lib/auth.js';
import { resolveTenant } from '../lib/tenant.js';
import { round2, normName } from '../lib/invoicing.js';

const router = Router();
router.use(requireAuth, resolveTenant);
const PERM = ['view_party_ledger', 'view_debtor_aging', 'view_creditor_aging', 'view_sales_register', 'view_purchase_register', 'receive_payments', 'manage_invoices'];

/* Build the company's party map: normKey -> { name, isCustomer, isSupplier }.
   Display name prefers the Customer master, then Supplier, then a document name. */
const loadParties = async (companyId) => {
  const byKey = new Map();
  const put = (rawName, flag) => {
    const nk = normName(rawName);
    if (!nk) return;
    const cur = byKey.get(nk) || { key: nk, name: rawName, isCustomer: false, isSupplier: false, _src: 0 };
    // Prefer a "stronger" name source: customer(3) > supplier(2) > document(1).
    const rank = flag === 'customer' ? 3 : flag === 'supplier' ? 2 : 1;
    if (rank > cur._src) { cur.name = rawName; cur._src = rank; }
    if (flag === 'customer') cur.isCustomer = true;
    if (flag === 'supplier') cur.isSupplier = true;
    byKey.set(nk, cur);
  };
  for (const r of await q('SELECT `name` FROM `Customer` WHERE `companyId` = ?', [companyId])) put(r.name, 'customer');
  for (const r of await q('SELECT s.`name` FROM `Supplier` s INNER JOIN `SupplierMembership` sm ON sm.`supplierId` = s.`id` WHERE sm.`companyId` = ?', [companyId])) put(r.name, 'supplier');
  for (const r of await q('SELECT DISTINCT `customerName` n FROM `SalesInvoice` WHERE `companyId` = ?', [companyId])) put(r.n, 'doc');
  for (const r of await q('SELECT DISTINCT `supplierName` n FROM `PurchaseInvoice` WHERE `companyId` = ?', [companyId]).catch(() => [])) put(r.n, 'doc');
  return byKey;
};

/* Current net balance per party (Dr positive = they owe us). Same math as aging. */
const loadBalances = async (companyId) => {
  const bal = new Map();
  const add = (nk, delta) => { if (nk) bal.set(nk, round2((bal.get(nk) || 0) + delta)); };
  for (const r of await q('SELECT `customerName` n, COALESCE(SUM(`amount`),0) s FROM `SalesInvoice` WHERE `companyId` = ? GROUP BY `customerName`', [companyId])) add(normName(r.n), Number(r.s));
  for (const r of await q('SELECT `supplierName` n, COALESCE(SUM(`amount`),0) s FROM `PurchaseInvoice` WHERE `companyId` = ? GROUP BY `supplierName`', [companyId]).catch(() => [])) add(normName(r.n), -Number(r.s));
  for (const r of await q("SELECT `normKey` k, `side`, COALESCE(SUM(`amount`),0) s FROM `CashbookEntry` WHERE `companyId` = ? GROUP BY `normKey`, `side`", [companyId]).catch(() => [])) add(r.k, r.side === 'RECEIPT' ? -Number(r.s) : Number(r.s));
  for (const r of await q("SELECT `normKey` k, `side`, COALESCE(SUM(`amount`),0) s FROM `JournalVoucher` WHERE `companyId` = ? GROUP BY `normKey`, `side`", [companyId]).catch(() => [])) add(r.k, r.side === 'DEBIT' ? Number(r.s) : -Number(r.s));
  return bal;
};

/* ---------- GET /party-ledger/parties — selector list with net balance ---------- */
router.get('/parties', requireAnyPermission(...PERM), asyncHandler(async (req, res) => {
  const { search } = z.object({ search: z.string().trim().max(120).optional() }).parse(req.query);
  const [parties, balances] = await Promise.all([loadParties(req.tenant.companyId), loadBalances(req.tenant.companyId)]);
  let list = [...parties.values()].map((p) => ({
    key: p.key, name: p.name, isCustomer: p.isCustomer, isSupplier: p.isSupplier,
    balance: round2(balances.get(p.key) || 0),
  }));
  if (search) {
    const s = search.toUpperCase();
    list = list.filter((p) => p.name.toUpperCase().includes(s) || p.key.includes(normName(search)));
  }
  list.sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance) || a.name.localeCompare(b.name));
  res.json({ parties: list.slice(0, 500) });
}));

/* ---------- GET /party-ledger?key=&from=&to= — the running statement ---------- */
router.get('/', requireAnyPermission(...PERM), asyncHandler(async (req, res) => {
  const { key, from, to } = z.object({
    key: z.string().trim().min(1),
    from: z.string().trim().optional(),
    to: z.string().trim().optional(),
  }).parse(req.query);
  const companyId = req.tenant.companyId;
  const nk = normName(key);
  if (!nk) throw new AppError('Party not found', 404, 'NOT_FOUND');

  const parties = await loadParties(companyId);
  const party = parties.get(nk);
  if (!party) throw new AppError('Party not found', 404, 'NOT_FOUND');

  const entries = [];
  const push = (date, type, voucherNo, particulars, debit, credit) => {
    if (!date) return;
    entries.push({ date: new Date(date).toISOString(), type, voucherNo: voucherNo || '', particulars: particulars || '', debit: round2(debit || 0), credit: round2(credit || 0) });
  };

  // Sales invoices (Dr, they owe us) / credit notes (Cr). Credit notes are
  // stored as CREDIT_NOTE and/or a negative amount.
  for (const r of await q('SELECT `invoiceNumber` vno, `invoiceDate` dt, `customerName` nm, `amount` amt, `docType` dt2 FROM `SalesInvoice` WHERE `companyId` = ?', [companyId])) {
    if (normName(r.nm) !== nk) continue;
    const amt = Number(r.amt);
    const mag = Math.abs(amt);
    if (r.dt2 === 'CREDIT_NOTE' || amt < 0) push(r.dt, 'Credit Note', r.vno, 'Credit note', 0, mag);
    else push(r.dt, 'Sales Invoice', r.vno, 'Sales', mag, 0);
  }
  // Purchase bills (Cr, we owe them) / debit notes (Dr, reduces payable).
  for (const r of await q('SELECT `invoiceNumber` vno, `invoiceDate` dt, `supplierName` nm, `amount` amt, `docType` dt2 FROM `PurchaseInvoice` WHERE `companyId` = ?', [companyId]).catch(() => [])) {
    if (normName(r.nm) !== nk) continue;
    const amt = Number(r.amt);
    const mag = Math.abs(amt);
    if (r.dt2 === 'CREDIT_NOTE' || amt < 0) push(r.dt, 'Debit Note', r.vno, 'Debit note', mag, 0);
    else push(r.dt, 'Purchase Bill', r.vno, 'Purchase', 0, mag);
  }
  // Cash book — receipts (Cr, they paid us) / payments (Dr, we paid them).
  for (const r of await q("SELECT `entryDate` dt, `side`, `amount` amt, `vch`, `account` acc FROM `CashbookEntry` WHERE `companyId` = ? AND `normKey` = ?", [companyId, nk]).catch(() => [])) {
    const amt = Number(r.amt);
    if (r.side === 'RECEIPT') push(r.dt, 'Receipt', r.vch, 'Received', 0, amt);
    else push(r.dt, 'Payment', r.vch, 'Paid', amt, 0);
  }
  // Journal vouchers.
  for (const r of await q("SELECT `entryDate` dt, `side`, `amount` amt, `voucherNo` vno, `narration` nar FROM `JournalVoucher` WHERE `companyId` = ? AND `normKey` = ?", [companyId, nk]).catch(() => [])) {
    const amt = Number(r.amt);
    if (r.side === 'DEBIT') push(r.dt, 'Journal', r.vno, r.nar || 'Journal (Dr)', amt, 0);
    else push(r.dt, 'Journal', r.vno, r.nar || 'Journal (Cr)', 0, amt);
  }

  entries.sort((a, b) => a.date.localeCompare(b.date) || a.type.localeCompare(b.type));

  const fromT = from ? new Date(from).getTime() : -Infinity;
  const toT = to ? new Date(to + 'T23:59:59.999Z').getTime() : Infinity;
  let opening = 0;
  const rows = [];
  let totDr = 0, totCr = 0;
  for (const e of entries) {
    const t = new Date(e.date).getTime();
    if (t < fromT) { opening = round2(opening + e.debit - e.credit); continue; }
    if (t > toT) continue;
    rows.push(e);
    totDr = round2(totDr + e.debit);
    totCr = round2(totCr + e.credit);
  }
  let bal = round2(opening);
  for (const e of rows) { bal = round2(bal + e.debit - e.credit); e.balance = bal; }

  res.json({
    party: { key: nk, name: party.name, isCustomer: party.isCustomer, isSupplier: party.isSupplier },
    openingBalance: round2(opening),
    closingBalance: round2(bal),
    totals: { debit: totDr, credit: totCr },
    rows,
  });
}));

export default router;
