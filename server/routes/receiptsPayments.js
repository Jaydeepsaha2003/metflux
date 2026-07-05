// Receipts & Payments Register — one upload that reconciles the bank/cash book.
//
//   Receipts (money in)  → matched to a customer by name → FIFO-allocated to that
//                          customer's oldest open sales invoices.
//   Payments (money out) → matched to a supplier by name → FIFO-allocated to that
//                          supplier's oldest open purchase bills.
//
// Rows that don't match any party (salaries, expenses, etc.) are listed as
// unmatched and ignored. Nothing is written until the reviewed rows are posted.
// Replaces the separate Bills Receivable / Bills Payable uploads.
import { Router } from 'express';
import { z } from 'zod';
import { q, txn } from '../lib/db.js';
import { asyncHandler } from '../lib/errors.js';
import { requireAuth, requireAnyPermission } from '../lib/auth.js';
import { resolveTenant } from '../lib/tenant.js';
import { round2, normName, allocatePaymentFifo } from '../lib/invoicing.js';
import { allocateSupplierPaymentFifo } from '../lib/billsReconcile.js';
import { parseBankBook } from '../lib/receiptsPayments.js';
import { errMessage } from '../lib/importHelpers.js';

const router = Router();
router.use(requireAuth, resolveTenant);
const PERM = ['receive_payments', 'manage_invoices'];
const TOL = 0.01;

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

/* ---------- POST /preview — parse, match, compute; write nothing ---------- */
router.post('/preview', requireAnyPermission(...PERM), asyncHandler(async (req, res) => {
  const { rows } = z.object({ rows: z.array(z.array(z.any())).max(50000) }).parse(req.body);
  const { entries, asOn } = parseBankBook(rows);
  const companyId = req.tenant.companyId;

  // --- Customer side (receipts) ---
  const customers = await q('SELECT `id`, `name`, `customerCode` FROM `Customer` WHERE `companyId` = ?', [companyId]);
  const custByName = new Map();
  for (const c of customers) { const k = normName(c.name); if (k && !custByName.has(k)) custByName.set(k, c); }
  const pendRows = await q(
    `SELECT \`customerId\` AS id, SUM(\`amount\` - \`paidAmount\`) AS pending
       FROM \`SalesInvoice\`
      WHERE \`companyId\` = ? AND \`status\` <> 'PAID' AND \`customerId\` IS NOT NULL
      GROUP BY \`customerId\``, [companyId]);
  const pendByCust = new Map(pendRows.map((r) => [r.id, round2(Number(r.pending))]));

  // --- Supplier side (payments) ---
  const bySupplier = await loadOpenPayablesBySupplier(companyId);

  // Aggregate the register per party + side.
  const receipts = new Map(); // customerId -> { name, code, amount, matchedName }
  const payments = new Map(); // supplierKey -> { name, amount }
  const unmatched = [];       // { side, name, amount }

  for (const e of entries) {
    if (e.side === 'RECEIPT') {
      const c = custByName.get(normName(e.account));
      if (!c) { unmatched.push({ side: 'RECEIPT', name: e.account, amount: e.amount }); continue; }
      const cur = receipts.get(c.id) ?? { customerId: c.id, name: c.name, code: c.customerCode, amount: 0 };
      cur.amount = round2(cur.amount + e.amount);
      receipts.set(c.id, cur);
    } else {
      const key = normName(e.account);
      const g = bySupplier.get(key);
      if (!g) { unmatched.push({ side: 'PAYMENT', name: e.account, amount: e.amount }); continue; }
      const cur = payments.get(key) ?? { supplierKey: key, name: g.displayName, amount: 0 };
      cur.amount = round2(cur.amount + e.amount);
      payments.set(key, cur);
    }
  }

  const receiptItems = [...receipts.values()].map((r) => {
    const pending = pendByCust.get(r.customerId) ?? 0;
    return { ...r, side: 'RECEIPT', systemPending: pending, willApply: round2(Math.min(r.amount, Math.max(0, pending))) };
  });
  const paymentItems = [...payments.values()].map((p) => {
    const pending = bySupplier.get(p.supplierKey)?.pending ?? 0;
    return { ...p, side: 'PAYMENT', systemPending: round2(Math.max(0, pending)), willApply: round2(Math.min(p.amount, Math.max(0, pending))) };
  });

  // Roll unmatched up by name+side so a party paid 50 times shows once.
  const unmatchedAgg = new Map();
  for (const u of unmatched) {
    const k = `${u.side}|${normName(u.name)}`;
    const cur = unmatchedAgg.get(k) ?? { side: u.side, name: u.name, amount: 0 };
    cur.amount = round2(cur.amount + u.amount);
    unmatchedAgg.set(k, cur);
  }

  res.json({
    asOn,
    receipts: receiptItems,
    payments: paymentItems,
    unmatched: [...unmatchedAgg.values()],
    summary: {
      receiptCount: receiptItems.length,
      paymentCount: paymentItems.length,
      unmatchedCount: unmatchedAgg.size,
      receiptTotal: round2(receiptItems.reduce((s, x) => s + x.amount, 0)),
      paymentTotal: round2(paymentItems.reduce((s, x) => s + x.amount, 0)),
      receiptApply: round2(receiptItems.reduce((s, x) => s + x.willApply, 0)),
      paymentApply: round2(paymentItems.reduce((s, x) => s + x.willApply, 0)),
      unmatchedTotal: round2([...unmatchedAgg.values()].reduce((s, x) => s + x.amount, 0)),
    },
  });
}));

/* ---------- POST /post — record the confirmed receipts + payments ---------- */
router.post('/post', requireAnyPermission(...PERM), asyncHandler(async (req, res) => {
  const { paymentDate, reference, receipts, payments } = z.object({
    paymentDate: z.coerce.date(),
    reference:   z.string().trim().max(120).optional().nullable(),
    receipts: z.array(z.object({ customerId: z.string().min(1), amount: z.coerce.number().positive() })).max(10000).default([]),
    payments: z.array(z.object({ supplierKey: z.string().min(1), amount: z.coerce.number().positive() })).max(10000).default([]),
  }).parse(req.body);

  const companyId = req.tenant.companyId;
  const ref = reference ?? 'Receipts & Payments import';
  let recRecv = 0, recPay = 0, allocRecv = 0, allocPay = 0;
  const errors = [];

  // Names for posted customers, so we can flag their stored cashbook rows posted.
  const custIds = [...new Set(receipts.map((r) => r.customerId))];
  const custName = new Map();
  if (custIds.length) {
    const rows = await q(`SELECT \`id\`, \`name\` FROM \`Customer\` WHERE \`companyId\` = ? AND \`id\` IN (${custIds.map(() => '?').join(',')})`, [companyId, ...custIds]);
    for (const r of rows) custName.set(r.id, r.name);
  }
  const markPosted = (side, normKey) => q(
    'UPDATE `CashbookEntry` SET `postedAt` = CURRENT_TIMESTAMP(3) WHERE `companyId` = ? AND `side` = ? AND `normKey` = ? AND `postedAt` IS NULL',
    [companyId, side, normKey]
  ).catch(() => {});

  // Receipts → customer sales invoices (FIFO).
  for (const e of receipts) {
    try {
      const alloc = await txn(async (tx) => {
        const pay = await tx.insert('Payment', {
          companyId, customerId: e.customerId, amount: round2(e.amount), allocatedAmount: 0,
          paymentDate, method: 'BANK', reference: ref, notes: 'Receipts & Payments import',
          createdById: req.auth.userId,
        });
        const a = await allocatePaymentFifo(tx, { companyId, customerId: e.customerId, paymentId: pay.id, amount: round2(e.amount) });
        if (a > 0) await tx.update('Payment', pay.id, { allocatedAmount: a });
        return a;
      });
      const nm = custName.get(e.customerId);
      if (nm) await markPosted('RECEIPT', normName(nm));
      recRecv++; allocRecv = round2(allocRecv + alloc);
    } catch (err) { errors.push({ side: 'RECEIPT', ref: e.customerId, message: errMessage(err) }); }
  }

  // Payments → supplier purchase bills (FIFO). Re-derive live bills per supplier.
  const bySupplier = await loadOpenPayablesBySupplier(companyId);
  for (const e of payments) {
    const g = bySupplier.get(e.supplierKey);
    if (!g) { errors.push({ side: 'PAYMENT', ref: e.supplierKey, message: 'No open bills' }); continue; }
    const amount = round2(Math.min(e.amount, g.pending));
    if (amount <= TOL) continue;
    try {
      const alloc = await txn(async (tx) => {
        const pay = await tx.insert('SupplierPayment', {
          companyId, supplierName: g.displayName, amount, allocatedAmount: 0,
          paymentDate, method: 'BANK', reference: ref, notes: 'Receipts & Payments import',
          createdById: req.auth.userId,
        });
        const a = await allocateSupplierPaymentFifo(tx, { companyId, paymentId: pay.id, amount, invoices: g.invoices });
        if (a > 0) await tx.update('SupplierPayment', pay.id, { allocatedAmount: a });
        return a;
      });
      await markPosted('PAYMENT', e.supplierKey);
      recPay++; allocPay = round2(allocPay + alloc);
    } catch (err) { errors.push({ side: 'PAYMENT', ref: e.supplierKey, message: errMessage(err) }); }
  }

  res.json({
    receipts: recRecv, payments: recPay,
    allocatedReceipts: allocRecv, allocatedPayments: allocPay,
    errors: errors.slice(0, 100),
  });
}));

export default router;
