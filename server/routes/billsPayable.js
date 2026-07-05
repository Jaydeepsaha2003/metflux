// Bills Payable — reconcile a Tally "Amount Payable" export against the
// outstanding the system computes from imported purchase bills.
//
// Mirrors Bills Receivable, but the payable side is keyed by supplier NAME: the
// Purchase Register stores the supplier as a string (no Supplier FK), so bills
// are matched to a party by normalized name, the same way the import groups them.
//
//   1. POST /bills-payable/preview — match each party to its purchase bills,
//      compare the file's closing balance to the system's pending. Writes nothing.
//   2. POST /bills-payable/post    — record one SupplierPayment per confirmed
//      party for (systemPending − fileBalance), FIFO-allocated to oldest bills.
import { Router } from 'express';
import { z } from 'zod';
import { q, txn } from '../lib/db.js';
import { asyncHandler } from '../lib/errors.js';
import { requireAuth, requireAnyPermission } from '../lib/auth.js';
import { resolveTenant } from '../lib/tenant.js';
import { round2, normName } from '../lib/invoicing.js';
import { parseBalanceMatrix, classifyAdjustment, allocateSupplierPaymentFifo } from '../lib/billsReconcile.js';
import { errMessage } from '../lib/importHelpers.js';

const router = Router();
router.use(requireAuth, resolveTenant);

const TOL = 0.01;

/* Group all non-PAID purchase bills for the company by normalized supplier name.
 * Returns Map<normKey, { displayName, pending, invoices[] }> with invoices sorted
 * oldest bill first (FIFO order). */
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

/* ---------- POST /preview — match + compute, write nothing ---------- */
router.post('/preview', requireAnyPermission('view_bills_payable', 'manage_invoices'), asyncHandler(async (req, res) => {
  const { rows } = z.object({ rows: z.array(z.array(z.any())).max(10000) }).parse(req.body);
  const { parties, asOn } = parseBalanceMatrix(rows);

  const bySupplier = await loadOpenPayablesBySupplier(req.tenant.companyId);

  const matchedKeys = new Set();
  const items = parties.map((p) => {
    const key = normName(p.name);
    const g = bySupplier.get(key);
    if (!g) return { name: p.name, matched: false, fileBalance: p.balance };
    matchedKeys.add(key);
    const systemPending = round2(Math.max(0, g.pending));
    const { adjustment, action } = classifyAdjustment(systemPending, p.balance);
    return {
      name: p.name,
      matched: true,
      supplierKey: key,
      supplierName: g.displayName,
      fileBalance: p.balance,
      systemPending,
      adjustment,
      action,
    };
  });

  // Suppliers with open bills but ABSENT from the file. The file only lists
  // suppliers still owed, so absence means Tally has them fully paid — clear
  // their open bills to ₹0 to match.
  for (const [key, g] of bySupplier) {
    const pending = round2(Math.max(0, g.pending));
    if (matchedKeys.has(key) || pending <= TOL) continue;
    items.push({
      name: g.displayName,
      matched: true,
      absent: true,
      supplierKey: key,
      supplierName: g.displayName,
      fileBalance: 0,
      systemPending: pending,
      adjustment: pending,
      action: 'clear',
    });
  }

  const sum = (pred, pick) => round2(items.filter(pred).reduce((s, x) => s + pick(x), 0));
  res.json({
    asOn,
    defaultReference: asOn ? `Payable reconciliation as on ${asOn}` : 'Payable reconciliation',
    items,
    summary: {
      total:      items.length,
      matched:    items.filter((x) => x.matched).length,
      unmatched:  items.filter((x) => !x.matched).length,
      toPost:     items.filter((x) => x.action === 'post').length,
      toClear:    items.filter((x) => x.action === 'clear').length,
      alreadyOk:  items.filter((x) => x.action === 'ok').length,
      shortfalls: items.filter((x) => x.action === 'shortfall').length,
      fileTotal:  round2(items.reduce((s, x) => s + (x.fileBalance ?? 0), 0)),
      postTotal:  sum((x) => x.action === 'post' || x.action === 'clear', (x) => x.adjustment),
    },
  });
}));

/* ---------- POST /post — record the confirmed reconciling payments ---------- */
router.post('/post', requireAnyPermission('view_bills_payable', 'manage_invoices'), asyncHandler(async (req, res) => {
  const { paymentDate, reference, entries } = z.object({
    paymentDate: z.coerce.date(),
    reference:   z.string().trim().max(120).optional().nullable(),
    entries: z.array(z.object({
      supplierKey: z.string().min(1),
      amount:      z.coerce.number().positive(),
    })).min(1).max(5000),
  }).parse(req.body);

  // Re-derive the live open bills per supplier so a stale preview can't overpay.
  const bySupplier = await loadOpenPayablesBySupplier(req.tenant.companyId);

  let recorded = 0, allocatedTotal = 0;
  const errors = [];

  for (const e of entries) {
    const g = bySupplier.get(e.supplierKey);
    if (!g) { errors.push({ supplierKey: e.supplierKey, message: 'Supplier has no open bills' }); continue; }
    const amount = round2(Math.min(e.amount, g.pending));
    if (amount <= TOL) continue; // nothing left to clear

    try {
      const allocated = await txn(async (tx) => {
        const pay = await tx.insert('SupplierPayment', {
          companyId:       req.tenant.companyId,
          supplierName:    g.displayName,
          amount,
          allocatedAmount: 0,
          paymentDate,
          method:    'RECONCILE',
          reference: reference ?? null,
          notes:     'Bills Payable reconciliation',
          createdById: req.auth.userId,
        });
        const alloc = await allocateSupplierPaymentFifo(tx, {
          companyId: req.tenant.companyId, paymentId: pay.id, amount, invoices: g.invoices,
        });
        if (alloc > 0) await tx.update('SupplierPayment', pay.id, { allocatedAmount: alloc });
        return alloc;
      });
      recorded++;
      allocatedTotal = round2(allocatedTotal + allocated);
    } catch (err) {
      errors.push({ supplierKey: e.supplierKey, name: g.displayName, message: errMessage(err) });
    }
  }

  res.json({ recorded, allocated: round2(allocatedTotal), errors: errors.slice(0, 100) });
}));

export default router;
