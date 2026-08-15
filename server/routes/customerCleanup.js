// "Not a customer" cleanup.
//
// A salary head or a supplier that got tagged Customer during a bank-book
// import starts showing on Amount Receivable: with no sales invoices to net
// against, a bank PAYMENT to them computes as
//     receivable = 0 − (0 − payment) = +payment
// and surfaces as an "Advance / On account" row. The row itself isn't stored —
// it's derived — so the only real fix is removing the wrong Customer record.
//
// Deliberately conservative: a record is offered for deletion ONLY when nothing
// anywhere refers to it. Anything referenced is listed separately with the
// reason, never silently skipped.
import { Router } from 'express';
import { z } from 'zod';
import { q, qOne, txn } from '../lib/db.js';
import { asyncHandler } from '../lib/errors.js';
import { requireAuth, requireAnyPermission } from '../lib/auth.js';
import { resolveTenant } from '../lib/tenant.js';
import { round2, normName } from '../lib/invoicing.js';
import { loadPartyBalances, sideBalance } from '../lib/partyBalances.js';
import { countCustomerRefs as countRefs, customerBlockers as blockersOf, deleteDerivedCustomerPayments } from '../lib/customerRefs.js';

const router = Router();
router.use(requireAuth, resolveTenant);
const PERM = ['view_debtor_aging', 'receive_payments', 'manage_invoices'];


/* ---------- GET /non-customers — who looks wrongly registered ---------- */
router.get('/non-customers', requireAnyPermission(...PERM), asyncHandler(async (req, res) => {
  const companyId = req.tenant.companyId;
  const customers = await q('SELECT `id`, `name`, `customerCode` FROM `Customer` WHERE `companyId` = ?', [companyId]);
  const balances = await loadPartyBalances(companyId);

  // Registered suppliers — a name on both lists is almost certainly a supplier
  // that was mis-tagged, which is worth saying out loud.
  const supplierNk = new Set(
    (await q('SELECT s.`name` FROM `Supplier` s INNER JOIN `SupplierMembership` sm ON sm.`supplierId` = s.`id` WHERE sm.`companyId` = ?', [companyId]))
      .map((r) => normName(r.name)).filter(Boolean)
  );

  const items = [];
  const blocked = [];
  for (const c of customers) {
    const counts = await countRefs(c.id);
    if (counts.SalesInvoice > 0) continue;          // a real customer — leave alone

    const nk = normName(c.name);
    const p = balances.get(nk);
    const showsOnAging = round2(sideBalance(p, 'RECEIVABLE'));
    // Nothing billed, nothing owing, nothing referencing it — not worth listing.
    if (!showsOnAging && !p?.paymentTotal && !p?.receiptTotal && !blockersOf(counts).length) continue;

    const why = [];
    if (supplierNk.has(nk)) why.push('also registered as a supplier');
    if ((p?.paymentTotal ?? 0) > 0 && !(p?.receiptTotal ?? 0)) why.push('only bank payments, never a receipt');
    if ((p?.purchaseTotal ?? 0) > 0) why.push('has purchase bills');
    if (!why.length) why.push('no sales invoices');

    const row = {
      id: c.id,
      name: c.name,
      customerCode: c.customerCode ?? null,
      showsOnAging,
      receiptTotal: round2(p?.receiptTotal ?? 0),
      paymentTotal: round2(p?.paymentTotal ?? 0),
      reason: why.join(' · '),
      blockers: blockersOf(counts),
    };
    (row.blockers.length ? blocked : items).push(row);
  }

  const bal = (a, b) => Math.abs(b.showsOnAging) - Math.abs(a.showsOnAging);
  items.sort(bal); blocked.sort(bal);
  res.json({
    items, blocked,
    totalOnAging: round2(items.reduce((s, r) => s + r.showsOnAging, 0)),
  });
}));

/* ---------- POST /non-customers/delete ---------- */
router.post('/non-customers/delete', requireAnyPermission(...PERM), asyncHandler(async (req, res) => {
  const { ids } = z.object({ ids: z.array(z.string().min(1)).min(1).max(5000) }).parse(req.body);

  let deleted = 0;
  const skipped = [];
  for (const id of ids) {
    const c = await qOne('SELECT `id`, `name` FROM `Customer` WHERE `id` = ? AND `companyId` = ?', [id, req.tenant.companyId]);
    if (!c) { skipped.push({ id, name: null, reason: 'not found' }); continue; }
    // Re-check at delete time — the list may be seconds stale, and an invoice
    // imported meanwhile must not be orphaned.
    const counts = await countRefs(c.id);
    const blockers = blockersOf(counts);
    if (blockers.length) { skipped.push({ id, name: c.name, reason: `still has ${blockers.join(', ')}` }); continue; }
    await txn(async (tx) => {
      await deleteDerivedCustomerPayments(tx, c.id);
      await tx.q('DELETE FROM `Customer` WHERE `id` = ?', [c.id]);
    });
    deleted++;
  }
  res.json({ deleted, skipped });
}));

export default router;
