// Receivable / Payable reconciliation — upload the accounting package's
// "Amount Receivable" and "Amount Payable" statements and see, party by party,
// where this system disagrees with them.
//
// Read-only: it never posts or adjusts anything. Its whole job is to tell the
// user exactly which parties are wrong and by how much.
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../lib/errors.js';
import { requireAuth, requireAnyPermission } from '../lib/auth.js';
import { resolveTenant } from '../lib/tenant.js';
import { round2, normName } from '../lib/invoicing.js';
import { parseBalanceMatrix } from '../lib/billsReconcile.js';
import { loadPartyBalances, sideBalance } from '../lib/partyBalances.js';

const router = Router();
router.use(requireAuth, resolveTenant);
const PERM = ['view_reconciliation', 'view_debtor_aging', 'view_creditor_aging', 'receive_payments', 'manage_invoices'];

const matrix = z.array(z.array(z.any())).max(20000);

/** Join one uploaded statement against the system's own party balances. */
const compareSide = (parsed, balances, side, tolerance) => {
  const rows = [];
  const seen = new Set();

  for (const p of parsed.parties) {
    const nk = normName(p.name);
    if (!nk) continue;
    seen.add(nk);
    const sys = balances.get(nk);
    const systemBalance = round2(sideBalance(sys, side));
    const fileBalance = round2(p.balance);
    const difference = round2(systemBalance - fileBalance);
    let status;
    if (!sys) status = 'MISSING_IN_SYSTEM';
    else if (Math.abs(difference) <= tolerance) status = 'MATCH';
    else if (Math.abs(systemBalance) < tolerance) status = 'MISSING_IN_SYSTEM';
    else status = 'DIFFERS';
    rows.push({ name: p.name, systemName: sys?.name ?? null, fileBalance, systemBalance, difference, status });
  }

  // Parties the system carries a balance for that the statement doesn't list at
  // all — just as much an error as a mismatch, and easy to miss.
  for (const [nk, sys] of balances) {
    if (seen.has(nk)) continue;
    const systemBalance = round2(sideBalance(sys, side));
    if (Math.abs(systemBalance) <= tolerance) continue;
    rows.push({
      name: sys.name, systemName: sys.name, fileBalance: 0,
      systemBalance, difference: systemBalance, status: 'MISSING_IN_FILE',
    });
  }

  // Worst discrepancies first — that's the working order.
  const rank = { DIFFERS: 0, MISSING_IN_SYSTEM: 1, MISSING_IN_FILE: 2, MATCH: 3 };
  rows.sort((a, b) => (rank[a.status] - rank[b.status]) || (Math.abs(b.difference) - Math.abs(a.difference)));

  const sum = (f) => round2(rows.reduce((s, r) => s + f(r), 0));
  const count = (st) => rows.filter((r) => r.status === st).length;
  return {
    asOn: parsed.asOn,
    rows,
    totals: {
      file: sum((r) => r.fileBalance),
      system: sum((r) => r.systemBalance),
      difference: sum((r) => r.difference),
      parties: rows.length,
      matched: count('MATCH'),
      differs: count('DIFFERS'),
      missingInSystem: count('MISSING_IN_SYSTEM'),
      missingInFile: count('MISSING_IN_FILE'),
    },
  };
};

/* ---------- POST /compare ----------
   Body: { receivableRows?, payableRows?, tolerance? } — either side may be
   omitted so a user can reconcile just one. */
router.post('/compare', requireAnyPermission(...PERM), asyncHandler(async (req, res) => {
  const { receivableRows, payableRows, tolerance } = z.object({
    receivableRows: matrix.optional(),
    payableRows: matrix.optional(),
    tolerance: z.coerce.number().min(0).max(10000).default(1),
  }).parse(req.body);

  const balances = await loadPartyBalances(req.tenant.companyId);

  const receivable = receivableRows
    ? compareSide(parseBalanceMatrix(receivableRows), balances, 'RECEIVABLE', tolerance)
    : null;
  const payable = payableRows
    ? compareSide(parseBalanceMatrix(payableRows), balances, 'PAYABLE', tolerance)
    : null;

  res.json({ receivable, payable, tolerance });
}));

export default router;
