// Bills Receivable — reconcile a Tally "Amount Receivable" export against the
// outstanding the system computes from imported sales invoices.
//
// Flow (two steps, no surprises):
//   1. POST /bills-receivable/preview  — match each party to a Customer, compare
//      the file's closing balance to the system's current pending, and return a
//      per-party table. POSTS NOTHING.
//   2. POST /bills-receivable/post     — for the parties the user confirmed,
//      record a receipt for (systemPending − fileBalance) and let the existing
//      FIFO allocator clear the oldest invoices down to exactly the file balance.
//
// Reuses the Payment / PaymentAllocation machinery wholesale, so a posted
// reconciliation shows up as ordinary payments and can be undone by deleting
// them (which reverses the allocations). No schema changes.
import { Router } from 'express';
import { z } from 'zod';
import { q, qOne, txn } from '../lib/db.js';
import { AppError, asyncHandler } from '../lib/errors.js';
import { requireAuth, requirePermission } from '../lib/auth.js';
import { resolveTenant } from '../lib/tenant.js';
import { round2, normName, parseAmount, allocatePaymentFifo } from '../lib/invoicing.js';
import { errMessage } from '../lib/importHelpers.js';

const router = Router();
router.use(requireAuth, resolveTenant);

const TOL = 0.01; // one-paisa tolerance, same as the rest of the accounting code

/* Locate the "Account / Balance" header inside a Tally export matrix and pull
 * out the data rows. The file has banner rows (company name, "Amount
 * Receivable", "As On : …") before the real header, and a trailing Total row. */
const parseReceivableMatrix = (rows) => {
  let headerIdx = -1;
  let accountCol = 0;
  let balanceCol = 1;
  let asOn = null;

  for (let i = 0; i < rows.length; i++) {
    const cells = rows[i] ?? [];
    // Capture the "As On : DD-MM-YYYY" date if present anywhere in the banner.
    if (!asOn) {
      const joined = cells.join(' ');
      const m = /as on\s*:?\s*(\d{1,2})[-/](\d{1,2})[-/](\d{4})/i.exec(joined);
      if (m) asOn = `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`; // YYYY-MM-DD
    }
    const lower = cells.map((c) => String(c ?? '').toLowerCase().trim());
    const aIdx = lower.findIndex((c) => c === 'account' || c === 'party' || c === 'particulars' || c === 'name');
    const bIdx = lower.findIndex((c) => c === 'balance' || c === 'amount' || c === 'closing balance');
    if (aIdx !== -1 && bIdx !== -1) {
      headerIdx = i; accountCol = aIdx; balanceCol = bIdx;
      break;
    }
  }
  if (headerIdx === -1) {
    throw new AppError('Could not find an "Account" / "Balance" header row in the file.', 400, 'BAD_FILE');
  }

  const parties = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const cells = rows[i] ?? [];
    const name = String(cells[accountCol] ?? '').trim();
    const balRaw = String(cells[balanceCol] ?? '').trim();
    if (!name && !balRaw) continue;                              // blank row
    if (/^total\b/i.test(name) || name.toLowerCase() === 'grand total') continue; // trailing total
    if (!name) continue;
    parties.push({ name, balance: round2(parseAmount(balRaw)) });
  }
  return { parties, asOn };
};

/* ---------- POST /preview — match + compute, write nothing ---------- */
router.post('/preview', requirePermission('manage_invoices'), asyncHandler(async (req, res) => {
  const { rows } = z.object({ rows: z.array(z.array(z.any())).max(10000) }).parse(req.body);
  const { parties, asOn } = parseReceivableMatrix(rows);

  // Customer lookup by normalized name.
  const customers = await q('SELECT `id`, `name`, `customerCode` FROM `Customer` WHERE `companyId` = ?', [req.tenant.companyId]);
  const byName = new Map();
  for (const c of customers) {
    const k = normName(c.name);
    if (k && !byName.has(k)) byName.set(k, c);
  }

  // System pending per customer = SUM(amount − paidAmount) over non-PAID invoices.
  const pendingRows = await q(
    `SELECT \`customerId\` AS customerId, SUM(\`amount\` - \`paidAmount\`) AS pending
       FROM \`SalesInvoice\`
      WHERE \`companyId\` = ? AND \`status\` <> 'PAID' AND \`customerId\` IS NOT NULL
      GROUP BY \`customerId\``,
    [req.tenant.companyId]
  );
  const pendingByCustomer = new Map(pendingRows.map((r) => [r.customerId, round2(Number(r.pending))]));

  const items = parties.map((p) => {
    const customer = byName.get(normName(p.name));
    if (!customer) {
      return { name: p.name, matched: false, fileBalance: p.balance };
    }
    const systemPending = pendingByCustomer.get(customer.id) ?? 0;
    const adjustment = round2(systemPending - p.balance);
    // What the row means once posted:
    //   post     — receipt of `adjustment` clears invoices down to fileBalance
    //   ok       — system already matches the file (nothing to do)
    //   shortfall — file shows MORE owed than the system knows; can't be cleared
    //               with a receipt (a missing invoice / opening balance), report it
    let action = 'ok';
    if (adjustment > TOL) action = 'post';
    else if (adjustment < -TOL) action = 'shortfall';
    return {
      name: p.name,
      matched: true,
      customerId: customer.id,
      customerCode: customer.customerCode,
      customerName: customer.name,
      fileBalance: p.balance,
      systemPending,
      adjustment,
      action,
    };
  });

  const sum = (pred, pick) => round2(items.filter(pred).reduce((s, x) => s + pick(x), 0));
  res.json({
    asOn,
    defaultReference: asOn ? `Receivable reconciliation as on ${asOn}` : 'Receivable reconciliation',
    items,
    summary: {
      total:        items.length,
      matched:      items.filter((x) => x.matched).length,
      unmatched:    items.filter((x) => !x.matched).length,
      toPost:       items.filter((x) => x.action === 'post').length,
      alreadyOk:    items.filter((x) => x.action === 'ok').length,
      shortfalls:   items.filter((x) => x.action === 'shortfall').length,
      fileTotal:    round2(items.reduce((s, x) => s + (x.fileBalance ?? 0), 0)),
      postTotal:    sum((x) => x.action === 'post', (x) => x.adjustment),
    },
  });
}));

/* ---------- POST /post — record the confirmed reconciling receipts ---------- */
router.post('/post', requirePermission('manage_invoices'), asyncHandler(async (req, res) => {
  const { paymentDate, reference, entries } = z.object({
    paymentDate: z.coerce.date(),
    reference:   z.string().trim().max(120).optional().nullable(),
    entries: z.array(z.object({
      customerId: z.string().min(1),
      amount:     z.coerce.number().positive(),
    })).min(1).max(5000),
  }).parse(req.body);

  let recorded = 0, allocatedTotal = 0;
  const errors = [];

  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    const customer = await qOne('SELECT `id`, `name` FROM `Customer` WHERE `id` = ? AND `companyId` = ?', [e.customerId, req.tenant.companyId]);
    if (!customer) { errors.push({ customerId: e.customerId, message: 'Customer not found' }); continue; }

    // Clamp to the customer's live pending so a stale preview can never create an
    // unallocated advance / overpay the ledger.
    const pend = await qOne(
      `SELECT SUM(\`amount\` - \`paidAmount\`) AS pending
         FROM \`SalesInvoice\`
        WHERE \`companyId\` = ? AND \`customerId\` = ? AND \`status\` <> 'PAID'`,
      [req.tenant.companyId, customer.id]
    );
    const pending = round2(Number(pend?.pending ?? 0));
    const amount = round2(Math.min(e.amount, pending));
    if (amount <= TOL) { continue; } // nothing left to clear (e.g. paid since preview)

    try {
      const r = await txn(async (tx) => {
        const pay = await tx.insert('Payment', {
          companyId:       req.tenant.companyId,
          customerId:      customer.id,
          customerName:    customer.name,
          amount,
          allocatedAmount: 0,
          paymentDate,
          method:    'RECONCILE',
          reference: reference ?? null,
          notes:     'Bills Receivable reconciliation',
          createdById: req.auth.userId,
        });
        const allocated = await allocatePaymentFifo(tx, { companyId: req.tenant.companyId, customerId: customer.id, paymentId: pay.id, amount });
        if (allocated > 0) await tx.update('Payment', pay.id, { allocatedAmount: allocated });
        return allocated;
      });
      recorded++;
      allocatedTotal = round2(allocatedTotal + r);
    } catch (err) {
      errors.push({ customerId: e.customerId, name: customer.name, message: errMessage(err) });
    }
  }

  res.json({ recorded, allocated: round2(allocatedTotal), errors: errors.slice(0, 100) });
}));

export default router;
