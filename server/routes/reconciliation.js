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
import { loadPartyBalances, sideBalance, belongsToOtherSide } from '../lib/partyBalances.js';

const router = Router();
router.use(requireAuth, resolveTenant);
const PERM = ['view_reconciliation', 'view_debtor_aging', 'view_creditor_aging', 'receive_payments', 'manage_invoices'];

const matrix = z.array(z.array(z.any())).max(20000);

/* A statement name that finds nothing is usually the SAME party spelled
   differently ("SHREE P.G. INTERNATIONAL" vs "SHREE PG INTERNATIONAL",
   "M/S LAN ENGINEERING AND TECHNOLOGIES" vs "LAN ENGINEERING & TECHNOLOGIES
   PVT. LTD."). Saying which existing party it probably is turns an unexplained
   difference into a one-click fix, so the near-match is computed and reported. */
// Words shared by half the register carry no identifying power. Matching on
// them alone pairs "SARTHI ENTERPRISES" with "K K ENTERPRISES", which is worse
// than offering nothing — a wrong lead costs more than a missing one.
const GENERIC = new Set([
  'ENTERPRISES', 'ENTERPRISE', 'INDUSTRIES', 'INDUSTRY', 'TRADERS', 'TRADING', 'COMPANY', 'CO',
  'PVT', 'PRIVATE', 'LTD', 'LIMITED', 'LLP', 'INC', 'CORPORATION', 'CORP', 'AND', 'THE',
  'SONS', 'BROTHERS', 'STORE', 'STORES', 'AGENCIES', 'AGENCY', 'ELECTRICALS', 'ELECTRIC',
  'ELECTRICAL', 'ENGINEERING', 'ENGINEERS', 'SALES', 'SERVICES', 'SOLUTIONS', 'PRODUCTS',
  'INTERNATIONAL', 'INDIA', 'NEW', 'SHREE', 'SHRI', 'SRI', 'STAFF', 'SALARY',
]);
const distinctive = (nk) =>
  new Set(String(nk).split(' ').filter((t) => t.length >= 3 && !GENERIC.has(t)));

const similarity = (a, b) => {
  // Punctuation-only differences ("SHREE P.G." vs "SHREE PG") survive nothing
  // token-based, because every remaining word is generic — compare the letters.
  const sa = String(a).replace(/ /g, ''), sb = String(b).replace(/ /g, '');
  if (sa && sa === sb) return 1;
  const [shortS, longS] = sa.length <= sb.length ? [sa, sb] : [sb, sa];
  if (shortS.length >= 8 && longS.startsWith(shortS)) return 0.9;   // "…CO" vs "…CO UNIT II"

  const A = distinctive(a), B = distinctive(b);
  if (!A.size || !B.size) return 0;
  let shared = 0;
  for (const t of A) if (B.has(t)) shared++;
  // A single shared word is a coincidence — "GARG STORE" and "GARG TRADERS" are
  // different firms. Two distinctive words in common is a real signal.
  if (shared < 2) return 0;
  return shared / Math.min(A.size, B.size);
};

const findNearMatch = (nk, balances, side) => {
  let best = null, bestScore = 0;
  for (const [candNk, p] of balances) {
    if (candNk === nk) continue;
    const score = similarity(nk, candNk);
    if (score > bestScore) { bestScore = score; best = p; }
  }
  if (!best || bestScore < 0.67) return null;
  return {
    name: best.name,
    score: Math.round(bestScore * 100),
    balance: round2(sideBalance(best, side)),
    otherSide: belongsToOtherSide(best, side),
  };
};

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

    // Explain the miss rather than just reporting it.
    let hint = null;
    if (status === 'MISSING_IN_SYSTEM') {
      if (sys && belongsToOtherSide(sys, side)) {
        hint = { kind: 'OTHER_SIDE', text: `Carried on Amount ${side === 'RECEIVABLE' ? 'Payable' : 'Receivable'} instead` };
      } else {
        const near = findNearMatch(nk, balances, side);
        if (near) hint = { kind: 'NEAR_MATCH', text: `Possibly the same party as "${near.name}"`, near };
        else hint = { kind: 'NO_RECORD', text: 'No invoices imported for this party' };
      }
    }
    rows.push({ name: p.name, systemName: sys?.name ?? null, fileBalance, systemBalance, difference, status, hint });
  }

  // Parties the system carries a balance for that the statement doesn't list at
  // all — just as much an error as a mismatch, and easy to miss.
  for (const [nk, sys] of balances) {
    if (seen.has(nk)) continue;
    const systemBalance = round2(sideBalance(sys, side));
    if (Math.abs(systemBalance) <= tolerance) continue;
    const near = findNearMatch(nk, new Map(parsed.parties.map((x) => [normName(x.name), { name: x.name, netReceivable: 0, netPayable: 0, isCustomer: true, isSupplier: true }])), side);
    rows.push({
      name: sys.name, systemName: sys.name, fileBalance: 0,
      systemBalance, difference: systemBalance, status: 'MISSING_IN_FILE',
      hint: near
        ? { kind: 'NEAR_MATCH', text: `Statement may list this as "${near.name}"`, near }
        : { kind: 'NO_RECORD', text: 'Statement does not list this party at all' },
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
