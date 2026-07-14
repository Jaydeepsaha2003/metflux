// Cashbook — account-head classification + a persistent Receipts & Payments
// summary. Bank-book rows are stored on import (via /store); classification
// (customer / supplier / other-with-category) is resolved live at query time so
// re-tagging a head instantly updates the summary.
import { Router } from 'express';
import { z } from 'zod';
import { q, qOne, insert, del, txn, newId } from '../lib/db.js';
import { AppError, asyncHandler } from '../lib/errors.js';
import { requireAuth, requireAnyPermission } from '../lib/auth.js';
import { resolveTenant } from '../lib/tenant.js';
import { round2, normName, allocatePaymentFifo, invoiceStatus } from '../lib/invoicing.js';
import { allocateSupplierPaymentFifo } from '../lib/billsReconcile.js';
import { parseBankBook } from '../lib/receiptsPayments.js';

const router = Router();
router.use(requireAuth, resolveTenant);
const PERM = ['receive_payments', 'manage_invoices'];

/* Open purchase bills grouped by normalized supplier name (FIFO order). */
const loadOpenPayablesBySupplier = async (companyId) => {
  const rows = await q(
    `SELECT \`id\`, \`supplierName\`, \`amount\`, \`paidAmount\`, \`invoiceDate\`
       FROM \`PurchaseInvoice\`
      WHERE \`companyId\` = ? AND \`status\` <> 'PAID'
      ORDER BY \`invoiceDate\` ASC, \`createdAt\` ASC`,
    [companyId]
  );
  const map = new Map();
  for (const r of rows) {
    const key = normName(r.supplierName);
    if (!key) continue;
    if (!map.has(key)) map.set(key, { displayName: r.supplierName, pending: 0, invoices: [] });
    const g = map.get(key);
    g.invoices.push(r);
    g.pending = round2(g.pending + (Number(r.amount) - Number(r.paidAmount)));
  }
  return map;
};

/* Build a live classifier: normKey → { type, category }. Customers & suppliers
   win over stored AccountHead rows (they're the source of truth once created). */
const buildClassifier = async (companyId) => {
  const [customers, suppliers, heads] = await Promise.all([
    q('SELECT `name` FROM `Customer` WHERE `companyId` = ?', [companyId]),
    q(`SELECT s.\`name\` FROM \`Supplier\` s
         INNER JOIN \`SupplierMembership\` sm ON sm.\`supplierId\` = s.\`id\`
        WHERE sm.\`companyId\` = ?`, [companyId]),
    q('SELECT `normKey`, `type`, `category` FROM `AccountHead` WHERE `companyId` = ?', [companyId]),
  ]);
  const cust = new Set(customers.map((c) => normName(c.name)).filter(Boolean));
  const supp = new Set(suppliers.map((s) => normName(s.name)).filter(Boolean));
  const headMap = new Map(heads.map((h) => [h.normKey, h]));
  return (account) => {
    const k = normName(account);
    if (cust.has(k)) return { type: 'CUSTOMER', category: 'Customer receipts' };
    if (supp.has(k)) return { type: 'SUPPLIER', category: 'Supplier payments' };
    const h = headMap.get(k);
    if (h) {
      if (h.type === 'CUSTOMER') return { type: 'CUSTOMER', category: 'Customer receipts' };
      if (h.type === 'SUPPLIER') return { type: 'SUPPLIER', category: 'Supplier payments' };
      return { type: 'OTHER', category: h.category || 'Other' };
    }
    return { type: 'UNCLASSIFIED', category: 'Unclassified' };
  };
};

/* ---------- Account heads ---------- */

// List defined OTHER heads + the distinct categories used (for the dropdown).
router.get('/account-heads', requireAnyPermission(...PERM), asyncHandler(async (req, res) => {
  const heads = await q(
    'SELECT `id`, `name`, `type`, `category` FROM `AccountHead` WHERE `companyId` = ? ORDER BY `name` ASC',
    [req.tenant.companyId]
  );
  const categories = [...new Set(heads.map((h) => h.category).filter(Boolean))].sort();
  res.json({ heads, categories });
}));

// Define / update an OTHER head (customer & supplier heads are created via their
// own endpoints so they land in those lists).
router.post('/account-heads', requireAnyPermission(...PERM), asyncHandler(async (req, res) => {
  const { name, category } = z.object({
    name: z.string().trim().min(1).max(200),
    category: z.string().trim().min(1).max(120),
  }).parse(req.body);
  const normKey = normName(name);
  if (!normKey) throw new AppError('Invalid account name', 400, 'BAD_NAME');

  const existing = await qOne(
    'SELECT `id` FROM `AccountHead` WHERE `companyId` = ? AND `normKey` = ?',
    [req.tenant.companyId, normKey]
  );
  if (existing) {
    await q('UPDATE `AccountHead` SET `name` = ?, `type` = \'OTHER\', `category` = ?, `updatedAt` = CURRENT_TIMESTAMP(3) WHERE `id` = ?',
      [name, category, existing.id]);
    return res.json({ id: existing.id, name, type: 'OTHER', category });
  }
  const row = await insert('AccountHead', {
    companyId: req.tenant.companyId, name, normKey, type: 'OTHER', category,
  });
  res.status(201).json({ id: row.id, name, type: 'OTHER', category });
}));

router.delete('/account-heads/:id', requireAnyPermission(...PERM), asyncHandler(async (req, res) => {
  const row = await qOne('SELECT `id` FROM `AccountHead` WHERE `id` = ? AND `companyId` = ?', [req.params.id, req.tenant.companyId]);
  if (!row) throw new AppError('Not found', 404, 'NOT_FOUND');
  await del('AccountHead', row.id);
  res.status(204).end();
}));

/* ---------- Selectable accounts (for the journal-voucher picker) ---------- */
// Every named account the user might post a journal against: customers,
// suppliers, defined OTHER heads, plus any party already seen in the cashbook.
router.get('/accounts', requireAnyPermission(...PERM), asyncHandler(async (req, res) => {
  const companyId = req.tenant.companyId;
  const [customers, suppliers, heads, cbNames] = await Promise.all([
    q('SELECT `name` FROM `Customer` WHERE `companyId` = ?', [companyId]),
    q(`SELECT s.\`name\` FROM \`Supplier\` s
         INNER JOIN \`SupplierMembership\` sm ON sm.\`supplierId\` = s.\`id\`
        WHERE sm.\`companyId\` = ?`, [companyId]),
    q("SELECT `name` FROM `AccountHead` WHERE `companyId` = ? AND `type` = 'OTHER'", [companyId]),
    q('SELECT DISTINCT `account` FROM `CashbookEntry` WHERE `companyId` = ?', [companyId]).catch(() => []),
  ]);
  const seen = new Set();
  const items = [];
  const add = (name, type) => {
    const k = normName(name);
    if (!k || seen.has(k)) return;
    seen.add(k); items.push({ name, type });
  };
  customers.forEach((c) => add(c.name, 'CUSTOMER'));
  suppliers.forEach((s) => add(s.name, 'SUPPLIER'));
  heads.forEach((h) => add(h.name, 'OTHER'));
  cbNames.forEach((r) => add(r.account, 'OTHER'));
  items.sort((a, b) => a.name.localeCompare(b.name));
  res.json({ items });
}));

/* ---------- Journal vouchers — manual single-legged ledger adjustments ----------
   A voucher posts a Debit or Credit against ONE account. It flows into the party
   ledger and the Amount Receivable / Payable aging (Debit = they owe us more,
   Credit = we owe them more) but NOT into the Cashbook Summary (no cash moved). */
const nextJvNumber = async (companyId, db = { q }) => {
  const rows = await db.q("SELECT `voucherNo` FROM `JournalVoucher` WHERE `companyId` = ? AND `source` = 'SUSPENSE'", [companyId]);
  let max = 0;
  for (const r of rows) { const m = /(\d+)\s*$/.exec(r.voucherNo || ''); if (m) max = Math.max(max, parseInt(m[1], 10)); }
  return `SE/${String(max + 1).padStart(4, '0')}`;
};

router.get('/journal', requireAnyPermission(...PERM), asyncHandler(async (req, res) => {
  const rows = await q(
    "SELECT `id`, `voucherNo`, `entryDate`, `account`, `side`, `amount`, `narration`, `createdAt` FROM `JournalVoucher` WHERE `companyId` = ? AND `source` = 'SUSPENSE' ORDER BY `entryDate` DESC, `createdAt` DESC LIMIT 500",
    [req.tenant.companyId]
  );
  res.json({ items: rows });
}));

router.post('/journal', requireAnyPermission(...PERM), asyncHandler(async (req, res) => {
  const { account, side, amount, entryDate, narration } = z.object({
    account: z.string().trim().min(1).max(200),
    side: z.enum(['DEBIT', 'CREDIT']),
    amount: z.coerce.number().positive().max(1e12),
    entryDate: z.coerce.date().optional(),
    narration: z.string().trim().max(400).optional().nullable(),
  }).parse(req.body);
  const companyId = req.tenant.companyId;
  const normKey = normName(account);
  if (!normKey) throw new AppError('Invalid account name', 400, 'BAD_NAME');

  const row = await txn(async (tx) => {
    const voucherNo = await nextJvNumber(companyId, tx);
    return tx.insert('JournalVoucher', {
      companyId, voucherNo, entryDate: entryDate ?? new Date(),
      account, normKey, side, amount: round2(amount),
      narration: narration || null, createdById: req.auth.userId,
    });
  });
  res.status(201).json({ id: row.id });
}));

router.delete('/journal/:id', requireAnyPermission(...PERM), asyncHandler(async (req, res) => {
  const row = await qOne("SELECT `id` FROM `JournalVoucher` WHERE `id` = ? AND `companyId` = ? AND `source` = 'SUSPENSE'", [req.params.id, req.tenant.companyId]);
  if (!row) throw new AppError('Not found', 404, 'NOT_FOUND');
  await del('JournalVoucher', row.id);
  res.status(204).end();
}));

/* ---------- Store the uploaded cashbook (for the summary) ---------- */

// Replaces any existing entries whose date falls inside the uploaded file's
// date span, then inserts every parsed row. Idempotent per period.
router.post('/store', requireAnyPermission(...PERM), asyncHandler(async (req, res) => {
  const { rows } = z.object({ rows: z.array(z.array(z.any())).max(50000) }).parse(req.body);
  const { entries } = parseBankBook(rows);
  const companyId = req.tenant.companyId;
  if (!entries.length) return res.json({ stored: 0 });

  const times = entries.map((e) => e.date).filter(Boolean).map((d) => +d);
  const max = times.length ? new Date(Math.max(...times)) : new Date();

  // INSERT IGNORE against the unique dedupe index — duplicate rows are skipped,
  // so re-importing the same book (or overlapping books) never double-counts.
  let stored = 0;
  const CHUNK = 400;
  for (let i = 0; i < entries.length; i += CHUNK) {
    const slice = entries.slice(i, i + CHUNK);
    const placeholders = slice.map(() => '(?,?,?,?,?,?,?,?)').join(',');
    const params = [];
    for (const e of slice) {
      params.push(newId(), companyId, e.date ?? max, e.side, e.account.slice(0, 200), normName(e.account).slice(0, 200), round2(e.amount), (e.vch || '').slice(0, 80));
    }
    const r = await q(
      'INSERT IGNORE INTO `CashbookEntry` (`id`,`companyId`,`entryDate`,`side`,`account`,`normKey`,`amount`,`vch`) VALUES ' + placeholders,
      params
    );
    stored += r?.affectedRows ?? 0;
  }
  res.json({ stored, skipped: entries.length - stored });
}));

/* ---------- Summary ---------- */

router.get('/summary', requireAnyPermission(...PERM), asyncHandler(async (req, res) => {
  const { from, to, groupBy } = z.object({
    from: z.string().optional(),
    to: z.string().optional(),
    groupBy: z.enum(['account', 'category']).default('category'),
  }).parse(req.query);

  const where = ['`companyId` = ?'];
  const params = [req.tenant.companyId];
  if (from) { where.push('`entryDate` >= ?'); params.push(new Date(from)); }
  if (to) { where.push('`entryDate` <= ?'); params.push(new Date(new Date(to).getTime() + 86400000 - 1)); }

  const rows = await q(
    `SELECT \`entryDate\`, \`side\`, \`account\`, \`amount\` FROM \`CashbookEntry\` WHERE ${where.join(' AND ')}`,
    params
  );

  const classify = await buildClassifier(req.tenant.companyId);
  const groups = new Map();
  let totalRcpt = 0, totalPymt = 0;
  for (const r of rows) {
    const cls = classify(r.account);
    const key = groupBy === 'account' ? r.account : cls.category;
    if (!groups.has(key)) groups.set(key, { key, category: cls.category, type: cls.type, receipts: 0, payments: 0, count: 0 });
    const g = groups.get(key);
    const amt = Number(r.amount) || 0;
    if (r.side === 'RECEIPT') { g.receipts = round2(g.receipts + amt); totalRcpt = round2(totalRcpt + amt); }
    else { g.payments = round2(g.payments + amt); totalPymt = round2(totalPymt + amt); }
    g.count++;
  }
  const items = [...groups.values()]
    .map((g) => ({ ...g, net: round2(g.receipts - g.payments) }))
    .sort((a, b) => (b.receipts + b.payments) - (a.receipts + a.payments));

  res.json({
    groupBy,
    items,
    totals: { receipts: totalRcpt, payments: totalPymt, net: round2(totalRcpt - totalPymt), count: rows.length },
  });
}));

/* ---------- Entries list (filterable) ---------- */
router.get('/entries', requireAnyPermission(...PERM), asyncHandler(async (req, res) => {
  const { from, to, side, type, search, page, pageSize, all } = z.object({
    from: z.string().optional(),
    to: z.string().optional(),
    side: z.enum(['ALL', 'RECEIPT', 'PAYMENT']).default('ALL'),
    type: z.enum(['ALL', 'CUSTOMER', 'SUPPLIER', 'OTHER', 'UNCLASSIFIED']).default('ALL'),
    search: z.string().trim().max(120).optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(200).default(50),
    all: z.enum(['1']).optional(), // return every matching row (for export)
  }).parse(req.query);
  const companyId = req.tenant.companyId;

  const where = ['`companyId` = ?'];
  const params = [companyId];
  if (from) { where.push('`entryDate` >= ?'); params.push(new Date(from)); }
  if (to) { where.push('`entryDate` <= ?'); params.push(new Date(new Date(to).getTime() + 86400000 - 1)); }
  if (side !== 'ALL') { where.push('`side` = ?'); params.push(side); }
  if (search) { where.push('`account` LIKE ?'); params.push(`%${search}%`); }

  const rows = await q(
    `SELECT \`id\`, \`entryDate\`, \`side\`, \`account\`, \`amount\`, \`vch\`, \`postedAt\`
       FROM \`CashbookEntry\` WHERE ${where.join(' AND ')}
      ORDER BY \`entryDate\` DESC, \`createdAt\` DESC`,
    params
  );
  const classify = await buildClassifier(companyId);
  let items = rows.map((r) => {
    const c = classify(r.account);
    return { id: r.id, entryDate: r.entryDate, side: r.side, account: r.account, amount: Number(r.amount), vch: r.vch, posted: !!r.postedAt, type: c.type, category: c.category };
  });
  if (type !== 'ALL') items = items.filter((i) => i.type === type);

  const total = items.length;
  const totals = {
    receipts: round2(items.filter((i) => i.side === 'RECEIPT').reduce((s, i) => s + i.amount, 0)),
    payments: round2(items.filter((i) => i.side === 'PAYMENT').reduce((s, i) => s + i.amount, 0)),
  };
  const start = (page - 1) * pageSize;
  res.json({ items: all ? items : items.slice(start, start + pageSize), total, page, pageSize, totals });
}));

/* ---------- Bulk reset — delete all cashbook-sourced receipts/payments + entries ---------- */
// Reverses invoice allocations for the receipts/payments the cashbook created
// (identified by their import notes), then clears the stored cashbook so the
// register can be re-imported cleanly. Manual Receive-Payments are untouched.
const CB_NOTES = ['Receipts & Payments import', 'Cashbook adjust (classified later)'];
router.post('/reset', requireAnyPermission(...PERM), asyncHandler(async (req, res) => {
  const companyId = req.tenant.companyId;
  let receipts = 0, payments = 0, entries = 0;
  await txn(async (tx) => {
    const pays = await tx.q('SELECT `id` FROM `Payment` WHERE `companyId` = ? AND `notes` IN (?,?)', [companyId, ...CB_NOTES]);
    for (const p of pays) {
      const allocs = await tx.q('SELECT * FROM `PaymentAllocation` WHERE `paymentId` = ?', [p.id]);
      for (const a of allocs) {
        const inv = await tx.qOne('SELECT * FROM `SalesInvoice` WHERE `id` = ?', [a.salesInvoiceId]);
        if (inv) { const np = Math.max(0, round2(Number(inv.paidAmount) - Number(a.amount))); await tx.update('SalesInvoice', inv.id, { paidAmount: np, status: invoiceStatus(inv.amount, np) }); }
      }
      await tx.q('DELETE FROM `PaymentAllocation` WHERE `paymentId` = ?', [p.id]);
      await tx.q('DELETE FROM `Payment` WHERE `id` = ?', [p.id]);
      receipts++;
    }
    const spays = await tx.q('SELECT `id` FROM `SupplierPayment` WHERE `companyId` = ? AND `notes` IN (?,?)', [companyId, ...CB_NOTES]);
    for (const p of spays) {
      const allocs = await tx.q('SELECT * FROM `SupplierPaymentAllocation` WHERE `supplierPaymentId` = ?', [p.id]);
      for (const a of allocs) {
        const inv = await tx.qOne('SELECT * FROM `PurchaseInvoice` WHERE `id` = ?', [a.purchaseInvoiceId]);
        if (inv) { const np = Math.max(0, round2(Number(inv.paidAmount) - Number(a.amount))); await tx.update('PurchaseInvoice', inv.id, { paidAmount: np, status: invoiceStatus(inv.amount, np) }); }
      }
      await tx.q('DELETE FROM `SupplierPaymentAllocation` WHERE `supplierPaymentId` = ?', [p.id]);
      await tx.q('DELETE FROM `SupplierPayment` WHERE `id` = ?', [p.id]);
      payments++;
    }
    const d = await tx.q('DELETE FROM `CashbookEntry` WHERE `companyId` = ?', [companyId]);
    entries = d?.affectedRows ?? 0;
  });
  res.json({ receipts, payments, entries });
}));

/* ---------- Unified transactions — Sales / Purchase / notes / Receipts / Payments ---------- */
router.get('/transactions', requireAnyPermission(...PERM), asyncHandler(async (req, res) => {
  const { from, to, types, search } = z.object({
    from: z.string().optional(), to: z.string().optional(),
    types: z.string().optional(), search: z.string().trim().max(120).optional(),
  }).parse(req.query);
  const companyId = req.tenant.companyId;
  const want = types ? new Set(types.split(',')) : null;
  const on = (t) => !want || want.has(t);
  const like = search ? `%${search}%` : null;
  const dc = (col) => { let s = ''; const p = []; if (from) { s += ` AND ${col} >= ?`; p.push(new Date(from)); } if (to) { s += ` AND ${col} <= ?`; p.push(new Date(new Date(to).getTime() + 86400000 - 1)); } return { s, p }; };
  const out = [];

  if (on('SALE') || on('CREDIT_NOTE')) {
    try {
      const d = dc('`invoiceDate`');
      const p = [companyId, ...d.p]; let sql = "SELECT `invoiceNumber` ref, `invoiceDate` dt, `customerName` party, `amount` amt, `docType` doc FROM `SalesInvoice` WHERE `companyId` = ?" + d.s;
      if (like) { sql += ' AND `customerName` LIKE ?'; p.push(like); }
      for (const r of await q(sql, p)) { const t = r.doc === 'CREDIT_NOTE' ? 'CREDIT_NOTE' : 'SALE'; if (on(t)) out.push({ date: r.dt, type: t, party: r.party, ref: r.ref, amount: Number(r.amt) }); }
    } catch { /* table absent */ }
  }
  if (on('PURCHASE') || on('DEBIT_NOTE')) {
    try {
      const d = dc('`invoiceDate`');
      const p = [companyId, ...d.p]; let sql = "SELECT `invoiceNumber` ref, `invoiceDate` dt, `supplierName` party, `amount` amt, `docType` doc FROM `PurchaseInvoice` WHERE `companyId` = ?" + d.s;
      if (like) { sql += ' AND `supplierName` LIKE ?'; p.push(like); }
      for (const r of await q(sql, p)) { const t = r.doc === 'DEBIT_NOTE' ? 'DEBIT_NOTE' : 'PURCHASE'; if (on(t)) out.push({ date: r.dt, type: t, party: r.party, ref: r.ref, amount: Number(r.amt) }); }
    } catch { /* table absent */ }
  }
  if (on('RECEIPT') || on('PAYMENT')) {
    try {
      const d = dc('`entryDate`');
      const p = [companyId, ...d.p]; let sql = "SELECT `entryDate` dt, `account` party, `side`, `amount` amt, `vch` ref FROM `CashbookEntry` WHERE `companyId` = ?" + d.s;
      if (like) { sql += ' AND `account` LIKE ?'; p.push(like); }
      for (const r of await q(sql, p)) { const t = r.side === 'RECEIPT' ? 'RECEIPT' : 'PAYMENT'; if (on(t)) out.push({ date: r.dt, type: t, party: r.party, ref: r.ref, amount: Number(r.amt) }); }
    } catch { /* table absent */ }
  }

  const capped = out.length > 8000;
  res.json({ items: capped ? out.slice(0, 8000) : out, total: out.length, capped });
}));

/* ---------- Overview totals (Sales / Purchase / Receipts / Payments / notes) ---------- */
router.get('/overview', requireAnyPermission(...PERM), asyncHandler(async (req, res) => {
  const { from, to } = z.object({ from: z.string().optional(), to: z.string().optional() }).parse(req.query);
  const companyId = req.tenant.companyId;
  const clause = (col) => {
    let s = ''; const p = [];
    if (from) { s += ` AND ${col} >= ?`; p.push(new Date(from)); }
    if (to) { s += ` AND ${col} <= ?`; p.push(new Date(new Date(to).getTime() + 86400000 - 1)); }
    return { s, p };
  };
  const inv = clause('`invoiceDate`');
  const cb = clause('`entryDate`');
  let sales = 0, creditNote = 0, purchase = 0, debitNote = 0, receipts = 0, payments = 0;
  try {
    const r = await qOne(`SELECT COALESCE(SUM(CASE WHEN \`docType\`='CREDIT_NOTE' THEN 0 ELSE \`amount\` END),0) s, COALESCE(SUM(CASE WHEN \`docType\`='CREDIT_NOTE' THEN \`amount\` ELSE 0 END),0) cn FROM \`SalesInvoice\` WHERE \`companyId\`=?${inv.s}`, [companyId, ...inv.p]);
    sales = round2(Number(r?.s ?? 0)); creditNote = round2(Number(r?.cn ?? 0));
  } catch { /* table absent */ }
  try {
    const r = await qOne(`SELECT COALESCE(SUM(CASE WHEN \`docType\`='DEBIT_NOTE' THEN 0 ELSE \`amount\` END),0) p, COALESCE(SUM(CASE WHEN \`docType\`='DEBIT_NOTE' THEN \`amount\` ELSE 0 END),0) dn FROM \`PurchaseInvoice\` WHERE \`companyId\`=?${inv.s}`, [companyId, ...inv.p]);
    purchase = round2(Number(r?.p ?? 0)); debitNote = round2(Number(r?.dn ?? 0));
  } catch { /* table absent */ }
  try {
    const r = await qOne(`SELECT COALESCE(SUM(CASE WHEN \`side\`='RECEIPT' THEN \`amount\` ELSE 0 END),0) rc, COALESCE(SUM(CASE WHEN \`side\`='PAYMENT' THEN \`amount\` ELSE 0 END),0) py FROM \`CashbookEntry\` WHERE \`companyId\`=?${cb.s}`, [companyId, ...cb.p]);
    receipts = round2(Number(r?.rc ?? 0)); payments = round2(Number(r?.py ?? 0));
  } catch { /* table absent */ }
  res.json({ sales, purchase, receipts, payments, creditNote, debitNote, net: round2(receipts - payments) });
}));

/* ---------- Duplicate detection + removal (same party+side+date+amount) ---------- */
// A duplicate is the SAME party + side + date + amount + voucher. Different
// voucher/bill numbers are treated as separate genuine transactions.
router.get('/duplicates', requireAnyPermission(...PERM), asyncHandler(async (req, res) => {
  const companyId = req.tenant.companyId;
  const rows = await q(
    `SELECT MIN(\`account\`) AS account, \`side\`, DATE(\`entryDate\`) AS d, \`amount\`, \`vch\`, COUNT(*) AS c
       FROM \`CashbookEntry\` WHERE \`companyId\` = ?
      GROUP BY \`normKey\`, \`side\`, DATE(\`entryDate\`), \`amount\`, COALESCE(\`vch\`,'')
      HAVING COUNT(*) > 1 ORDER BY COUNT(*) DESC, \`amount\` DESC`,
    [companyId]
  );
  const items = rows.map((g) => ({ account: g.account, side: g.side, date: g.d, amount: Number(g.amount), vch: g.vch, count: Number(g.c), extra: Number(g.c) - 1 }));
  res.json({ items, groups: items.length, totalExtra: items.reduce((s, g) => s + g.extra, 0) });
}));

router.post('/dedupe', requireAnyPermission(...PERM), asyncHandler(async (req, res) => {
  const companyId = req.tenant.companyId;
  const r = await q(
    'DELETE c1 FROM `CashbookEntry` c1 JOIN `CashbookEntry` c2 ' +
    'ON c1.`companyId` = c2.`companyId` AND c1.`normKey` = c2.`normKey` AND c1.`side` = c2.`side` ' +
    "AND DATE(c1.`entryDate`) = DATE(c2.`entryDate`) AND c1.`amount` = c2.`amount` " +
    "AND COALESCE(c1.`vch`,'') = COALESCE(c2.`vch`,'') AND c1.`id` > c2.`id` " +
    'WHERE c1.`companyId` = ?',
    [companyId]
  );
  res.json({ removed: r?.affectedRows ?? 0 });
}));

/* ---------- Delete a single cashbook entry row ---------- */
router.delete('/entry/:id', requireAnyPermission(...PERM), asyncHandler(async (req, res) => {
  const row = await qOne('SELECT `id` FROM `CashbookEntry` WHERE `id` = ? AND `companyId` = ?', [req.params.id, req.tenant.companyId]);
  if (!row) throw new AppError('Entry not found', 404, 'NOT_FOUND');
  await del('CashbookEntry', row.id);
  res.json({ ok: true });
}));

/* ---------- Bulk delete cashbook entry rows (by id) ---------- */
// Removes the stored ledger/summary rows only (does not touch any posted
// Payment/SupplierPayment — use /reset for that). Scoped to the tenant.
router.post('/entries/bulk-delete', requireAnyPermission(...PERM), asyncHandler(async (req, res) => {
  const { ids } = z.object({ ids: z.array(z.string().min(1)).min(1).max(20000) }).parse(req.body);
  const companyId = req.tenant.companyId;
  let deleted = 0;
  const CHUNK = 500;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const batch = ids.slice(i, i + CHUNK);
    const ph = batch.map(() => '?').join(',');
    const r = await q(`DELETE FROM \`CashbookEntry\` WHERE \`companyId\` = ? AND \`id\` IN (${ph})`, [companyId, ...batch]);
    deleted += r?.affectedRows ?? 0;
  }
  res.json({ deleted });
}));

/* ---------- Account ledger — one party's whole journey ---------- */
router.get('/account-ledger', requireAnyPermission(...PERM), asyncHandler(async (req, res) => {
  const { name } = z.object({ name: z.string().trim().min(1).max(200) }).parse(req.query);
  const companyId = req.tenant.companyId;
  const key = normName(name);
  const items = [];
  const tot = { sale: 0, purchase: 0, creditNote: 0, debitNote: 0, receipt: 0, payment: 0 };
  try {
    const rows = await q('SELECT `invoiceNumber` ref, `invoiceDate` dt, `customerName` party, `amount` amt, `docType` doc FROM `SalesInvoice` WHERE `companyId` = ?', [companyId]);
    for (const r of rows) if (normName(r.party) === key) { const t = r.doc === 'CREDIT_NOTE' ? 'CREDIT_NOTE' : 'SALE'; const a = Math.abs(Number(r.amt)); items.push({ date: r.dt, type: t, ref: r.ref, amount: a }); if (t === 'SALE') tot.sale += a; else tot.creditNote += a; }
  } catch { /* absent */ }
  try {
    const rows = await q('SELECT `invoiceNumber` ref, `invoiceDate` dt, `supplierName` party, `amount` amt, `docType` doc FROM `PurchaseInvoice` WHERE `companyId` = ?', [companyId]);
    for (const r of rows) if (normName(r.party) === key) { const t = r.doc === 'DEBIT_NOTE' ? 'DEBIT_NOTE' : 'PURCHASE'; const a = Math.abs(Number(r.amt)); items.push({ date: r.dt, type: t, ref: r.ref, amount: a }); if (t === 'PURCHASE') tot.purchase += a; else tot.debitNote += a; }
  } catch { /* absent */ }
  try {
    const rows = await q('SELECT `id`, `entryDate` dt, `account` party, `side`, `amount` amt, `vch` ref FROM `CashbookEntry` WHERE `companyId` = ?', [companyId]);
    for (const r of rows) if (normName(r.party) === key) { const t = r.side === 'RECEIPT' ? 'RECEIPT' : 'PAYMENT'; const a = Math.abs(Number(r.amt)); items.push({ id: r.id, date: r.dt, type: t, ref: r.ref, amount: a }); if (t === 'RECEIPT') tot.receipt += a; else tot.payment += a; }
  } catch { /* absent */ }
  tot.journalDebit = 0; tot.journalCredit = 0;
  try {
    const rows = await q('SELECT `id`, `entryDate` dt, `account` party, `side`, `amount` amt, `voucherNo` ref, `narration`, `source` FROM `JournalVoucher` WHERE `companyId` = ?', [companyId]);
    // Only single-legged Suspense entries carry an `id` here (deletable from the
    // ledger modal); imported multi-line journal lines are read-only there —
    // deleting one line would unbalance its voucher.
    for (const r of rows) if (normName(r.party) === key) { const t = r.side === 'DEBIT' ? 'JOURNAL_DR' : 'JOURNAL_CR'; const a = Math.abs(Number(r.amt)); items.push({ id: r.source === 'SUSPENSE' ? r.id : undefined, date: r.dt, type: t, ref: r.ref, note: r.narration, amount: a }); if (t === 'JOURNAL_DR') tot.journalDebit += a; else tot.journalCredit += a; }
  } catch { /* JournalVoucher table absent on minimal installs */ }
  items.sort((a, b) => (a.date ? new Date(a.date).getTime() : 0) - (b.date ? new Date(b.date).getTime() : 0));
  const round = (n) => Math.round(n * 100) / 100;

  // Tally/Busy-style double-entry: for a party ledger, Debit = increases what
  // they owe us (Sales, Debit Note, money we Paid them, a journal Debit), Credit
  // = reduces it (Purchase, Credit Note, Receipts, a journal Credit). Running
  // balance carries Dr/Cr.
  const DEBIT = new Set(['SALE', 'DEBIT_NOTE', 'PAYMENT', 'JOURNAL_DR']);
  let bal = 0, totalDebit = 0, totalCredit = 0;
  for (const it of items) {
    const isDebit = DEBIT.has(it.type);
    it.debit = isDebit ? it.amount : 0;
    it.credit = isDebit ? 0 : it.amount;
    totalDebit = round(totalDebit + it.debit);
    totalCredit = round(totalCredit + it.credit);
    bal = round(bal + it.debit - it.credit);
    it.balance = Math.abs(bal);
    it.balanceType = bal >= 0 ? 'Dr' : 'Cr';
  }
  const closing = round(bal);
  const totals = Object.fromEntries(Object.entries(tot).map(([k, v]) => [k, round(v)]));
  totals.totalDebit = totalDebit;
  totals.totalCredit = totalCredit;
  totals.closing = Math.abs(closing);
  totals.closingType = closing >= 0 ? 'Dr' : 'Cr';
  res.json({ name, items, totals });
}));

/* ---------- Unclassified heads (from stored cashbook) ---------- */

// Heads in the stored cashbook that don't yet resolve to a customer/supplier/
// other. Shows totals + how much is still unposted (awaiting allocation).
router.get('/unclassified', requireAnyPermission(...PERM), asyncHandler(async (req, res) => {
  const companyId = req.tenant.companyId;
  const rows = await q(
    `SELECT \`normKey\`, \`side\`, MIN(\`account\`) AS account,
            SUM(\`amount\`) AS amt,
            SUM(CASE WHEN \`postedAt\` IS NULL THEN \`amount\` ELSE 0 END) AS unposted,
            COUNT(*) AS c
       FROM \`CashbookEntry\` WHERE \`companyId\` = ?
      GROUP BY \`normKey\`, \`side\``,
    [companyId]
  );
  const classify = await buildClassifier(companyId);
  const map = new Map();
  for (const r of rows) {
    if (classify(r.account).type !== 'UNCLASSIFIED') continue;
    const cur = map.get(r.normKey) ?? { normKey: r.normKey, name: r.account, receiptTotal: 0, paymentTotal: 0, unpostedReceipt: 0, unpostedPayment: 0, count: 0 };
    if (r.side === 'RECEIPT') { cur.receiptTotal = round2(cur.receiptTotal + Number(r.amt)); cur.unpostedReceipt = round2(cur.unpostedReceipt + Number(r.unposted)); }
    else { cur.paymentTotal = round2(cur.paymentTotal + Number(r.amt)); cur.unpostedPayment = round2(cur.unpostedPayment + Number(r.unposted)); }
    cur.count += Number(r.c);
    map.set(r.normKey, cur);
  }
  const items = [...map.values()].sort((a, b) => (b.receiptTotal + b.paymentTotal) - (a.receiptTotal + a.paymentTotal));
  res.json({ items });
}));

/* ---------- Adjust: allocate a head's still-unposted cashbook rows ----------
   Called after a head is classified as a customer/supplier so its historical
   receipts/payments settle against invoices, FIFO, without re-uploading. */
router.post('/adjust', requireAnyPermission(...PERM), asyncHandler(async (req, res) => {
  const { name } = z.object({ name: z.string().trim().min(1).max(200) }).parse(req.body);
  const companyId = req.tenant.companyId;
  const normKey = normName(name);
  const classify = await buildClassifier(companyId);
  const type = classify(name).type;
  let allocated = 0, posted = 0, amount = 0;

  if (type === 'CUSTOMER') {
    const custs = await q('SELECT `id`, `name` FROM `Customer` WHERE `companyId` = ?', [companyId]);
    const cust = custs.find((c) => normName(c.name) === normKey);
    const sum = await qOne("SELECT COALESCE(SUM(`amount`),0) AS amt, COUNT(*) AS c FROM `CashbookEntry` WHERE `companyId` = ? AND `side` = 'RECEIPT' AND `normKey` = ? AND `postedAt` IS NULL", [companyId, normKey]);
    amount = round2(Number(sum?.amt ?? 0));
    if (cust && amount > 0) {
      allocated = await txn(async (tx) => {
        const pay = await tx.insert('Payment', {
          companyId, customerId: cust.id, amount, allocatedAmount: 0,
          paymentDate: new Date(), method: 'BANK', reference: 'Cashbook adjust', notes: 'Cashbook adjust (classified later)', createdById: req.auth.userId,
        });
        const a = await allocatePaymentFifo(tx, { companyId, customerId: cust.id, paymentId: pay.id, amount });
        if (a > 0) await tx.update('Payment', pay.id, { allocatedAmount: a });
        return a;
      });
      const upd = await q("UPDATE `CashbookEntry` SET `postedAt` = CURRENT_TIMESTAMP(3) WHERE `companyId` = ? AND `side` = 'RECEIPT' AND `normKey` = ? AND `postedAt` IS NULL", [companyId, normKey]);
      posted = upd?.affectedRows ?? Number(sum?.c ?? 0);
    }
  } else if (type === 'SUPPLIER') {
    const bySupplier = await loadOpenPayablesBySupplier(companyId);
    const g = bySupplier.get(normKey);
    const sum = await qOne("SELECT COALESCE(SUM(`amount`),0) AS amt, COUNT(*) AS c FROM `CashbookEntry` WHERE `companyId` = ? AND `side` = 'PAYMENT' AND `normKey` = ? AND `postedAt` IS NULL", [companyId, normKey]);
    amount = round2(Number(sum?.amt ?? 0));
    if (g && amount > 0) {
      const apply = round2(Math.min(amount, g.pending));
      if (apply > 0.01) {
        allocated = await txn(async (tx) => {
          const pay = await tx.insert('SupplierPayment', {
            companyId, supplierName: g.displayName, amount: apply, allocatedAmount: 0,
            paymentDate: new Date(), method: 'BANK', reference: 'Cashbook adjust', notes: 'Cashbook adjust (classified later)', createdById: req.auth.userId,
          });
          const a = await allocateSupplierPaymentFifo(tx, { companyId, paymentId: pay.id, amount: apply, invoices: g.invoices });
          if (a > 0) await tx.update('SupplierPayment', pay.id, { allocatedAmount: a });
          return a;
        });
      }
      const upd = await q("UPDATE `CashbookEntry` SET `postedAt` = CURRENT_TIMESTAMP(3) WHERE `companyId` = ? AND `side` = 'PAYMENT' AND `normKey` = ? AND `postedAt` IS NULL", [companyId, normKey]);
      posted = upd?.affectedRows ?? Number(sum?.c ?? 0);
    }
  }

  res.json({ type, allocated: round2(allocated), posted, amount });
}));

export default router;
