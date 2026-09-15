// Split-width production — a wide core sometimes can't be made in one run,
// so it's produced as two (or more) narrower strips that get stacked/joined
// into one finished piece before dispatch. Example: a 65mm-tall item is
// produced as a 40mm run today and a 25mm run next week; only once BOTH
// exist does a real, dispatchable piece exist.
//
// Decided per production batch, not on the Sales Order line — the order
// still just says the full height (e.g. 65); Production.splitHeight (added
// by migrate-split-production.js) marks a row as one partial run of that
// height. NULL splitHeight = an ordinary whole-piece run, entirely unchanged
// from before this feature existed.
//
// Matching rule: with two (or more) distinct splitHeight values recorded
// against the same PoOrderItem, the number of COMPLETE finished pieces is
// the SMALLEST running total among them — you can't have more finished
// 65mm pieces than you have of whichever half is scarcer. Whatever's left
// over on the larger pile is real material sitting as work-in-progress,
// waiting for its match.
//
// Job amount rule (per the user's explicit choice): a split run earns
// nothing on its own. The moment a new run completes additional matched
// sets, the FULL per-piece rate for those newly-completed sets is credited
// entirely to the run that just closed the gap — never split proportionally
// between the two halves, and never paid twice for the same finished piece.

/** SQL fragment: pieces truly finished against the item referenced by
 *  `<alias>.id` — whole-piece runs, plus the matched (smaller-pile) count
 *  from any split runs. Embed directly in a larger query; takes no
 *  parameters of its own (the alias must already be in scope).
 *
 *  "Smallest pile" is written as GROUP BY + ORDER BY + LIMIT 1 rather than
 *  the more obvious MIN() over a derived table, because a derived table may
 *  not reference the outer query's alias (that is a LATERAL join). MySQL 8
 *  happens to accept it; MariaDB — which the production hosting runs —
 *  rejects it outright with "Unknown column '<alias>.id'", which surfaced as
 *  every production/dispatch screen going blank. A correlated *scalar*
 *  subquery like this one is plain SQL that both engines accept.
 *
 *  The >= 2 distinct-heights gate lives in the WHERE clause: with fewer than
 *  two heights nothing qualifies, the subquery yields NULL, and COALESCE
 *  turns that into 0 — nothing is finished until a second height exists. */
export const producedPcsExpr = (alias) => `(
  COALESCE((
    SELECT SUM(pw.\`pcs\`) FROM \`Production\` pw
     WHERE pw.\`poOrderItemId\` = ${alias}.\`id\` AND pw.\`splitHeight\` IS NULL
  ), 0)
  +
  COALESCE((
    SELECT SUM(ps.\`pcs\`)
      FROM \`Production\` ps
     WHERE ps.\`poOrderItemId\` = ${alias}.\`id\` AND ps.\`splitHeight\` IS NOT NULL
       AND (
         SELECT COUNT(DISTINCT ps2.\`splitHeight\`) FROM \`Production\` ps2
          WHERE ps2.\`poOrderItemId\` = ${alias}.\`id\` AND ps2.\`splitHeight\` IS NOT NULL
       ) >= 2
     GROUP BY ps.\`splitHeight\`
     ORDER BY SUM(ps.\`pcs\`) ASC
     LIMIT 1
  ), 0)
)`;

/** Same rule, computed in JS from already-fetched rows — for the one place
 *  (POST /production) that has the item's production rows in hand already
 *  and would rather not issue a second query. `rows` = every Production row
 *  for one PoOrderItem, each with at least `pcs` and `splitHeight`. */
export const producedPcsFromRows = (rows) => {
  const whole = rows.filter((r) => r.splitHeight == null).reduce((s, r) => s + Number(r.pcs || 0), 0);
  const byHeight = new Map();
  for (const r of rows) {
    if (r.splitHeight == null) continue;
    byHeight.set(r.splitHeight, (byHeight.get(r.splitHeight) ?? 0) + Number(r.pcs || 0));
  }
  const matched = byHeight.size >= 2 ? Math.min(...byHeight.values()) : 0;
  return whole + matched;
};

/**
 * Per-entry job amount for a set of split-production rows against ONE item,
 * replayed in chronological order so amount always lands on whichever entry
 * actually closed the gap — the same finished piece is never paid for twice,
 * and reordering/backfilling old entries can change who gets credited (which
 * is correct: the ledger is the actual sequence of events, not a snapshot).
 *
 * `rows`: split rows only (splitHeight != null) for one item, each needing
 * `id`, `pcs`, `splitHeight`, `createdAt`.
 * `ratePerPiece`: the item's totalAmount / item's ordered pcs — the rupee
 * value of ONE fully finished piece.
 * Returns a Map<rowId, matchedAmount> — 0 for a row that didn't complete
 * anything new.
 */
export const splitAmountsByEntry = (rows, ratePerPiece) => {
  const sorted = [...rows].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  const running = new Map(); // splitHeight -> cumulative pcs so far
  const result = new Map();
  let matchedSoFar = 0;
  for (const r of sorted) {
    running.set(r.splitHeight, (running.get(r.splitHeight) ?? 0) + Number(r.pcs || 0));
    const distinctHeights = running.size;
    const newMatched = distinctHeights >= 2 ? Math.min(...running.values()) : 0;
    const justCompleted = Math.max(0, newMatched - matchedSoFar);
    matchedSoFar = newMatched;
    result.set(r.id, ratePerPiece != null ? +(justCompleted * ratePerPiece).toFixed(2) : null);
  }
  return result;
};

/** How many pcs of `splitHeight`'s pile are still waiting for a match, for
 *  one item — the "50 pcs of the 40mm half still waiting" figure shown to
 *  the operator so nobody mistakes an unmatched pile for a finished order. */
export const unmatchedByHeight = (rows) => {
  const byHeight = new Map();
  for (const r of rows) {
    if (r.splitHeight == null) continue;
    byHeight.set(r.splitHeight, (byHeight.get(r.splitHeight) ?? 0) + Number(r.pcs || 0));
  }
  if (byHeight.size < 2) {
    // Nothing to match against yet — the whole pile (if any) is unmatched.
    return [...byHeight.entries()].map(([splitHeight, pcs]) => ({ splitHeight, pcs, matched: 0, unmatched: pcs }));
  }
  const matched = Math.min(...byHeight.values());
  return [...byHeight.entries()].map(([splitHeight, pcs]) => ({ splitHeight, pcs, matched, unmatched: pcs - matched }));
};
