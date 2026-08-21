// Per-party outstanding on the LEDGER basis, aged.
//
// `SalesInvoice.paidAmount` is a point-in-time allocation and drifts — the aging
// reports say so explicitly and refuse to use it. What a party actually owes is
//
//     net = (Σ sales − Σ cash-book receipts + Σ journal Dr/Cr) − (Σ purchases − Σ payments)
//
// so anything that quotes a figure to the user (reports, reminders) must use
// that, or it reports money that has already been banked.
//
// The net is then walked against the party's open bills OLDEST-DUE-FIRST — the
// same reduction Amount Receivable performs — so the ages attached to it are the
// ages of the bills genuinely still outstanding, not of ones long since settled.
import { q } from './db.js';
import { round2, normName } from './invoicing.js';
import { loadPartyBalances, sideBalance } from './partyBalances.js';

const dayDiff = (a, b) => Math.floor((a - b) / 86400000);

export const loadReceivableAging = async (companyId, asOf = new Date()) => {
  const balances = await loadPartyBalances(companyId);

  const open = await q(
    `SELECT \`customerName\` nm, \`invoiceNumber\` v, \`invoiceDate\` d, \`dueDate\` due,
            \`amount\` amt, \`paidAmount\` paid
       FROM \`SalesInvoice\`
      WHERE \`companyId\` = ? AND \`status\` <> 'PAID'`,
    [companyId]
  ).catch(() => []);

  const byParty = new Map();
  for (const r of open) {
    const nk = normName(r.nm);
    if (!nk) continue;
    const bal = round2(Number(r.amt) - Number(r.paid));
    if (bal <= 0.01) continue;                       // settled or a credit note
    if (!byParty.has(nk)) byParty.set(nk, []);
    byParty.get(nk).push({ v: r.v, due: r.due ? new Date(r.due) : null, date: new Date(r.d), bal });
  }

  const today = new Date(asOf.getFullYear(), asOf.getMonth(), asOf.getDate());
  const out = [];

  for (const [nk, p] of balances) {
    const net = round2(sideBalance(p, 'RECEIVABLE'));
    if (net <= 0.01) continue;                       // nothing owed, or sits on Payable

    const bills = (byParty.get(nk) ?? []).sort((a, b) => {
      const ad = a.due ? a.due.getTime() : Infinity;
      const bd = b.due ? b.due.getTime() : Infinity;
      return ad - bd || a.date.getTime() - b.date.getTime();
    });

    // Everything the bank book has already covered comes off the oldest bills,
    // so what remains is what is really still open.
    const gross = round2(bills.reduce((s, b) => s + b.bal, 0));
    let reduce = round2(Math.max(gross - net, 0));

    let overdueAmt = 0, dueTodayAmt = 0, notDueAmt = 0;
    let overdueCount = 0, dueTodayCount = 0, maxDays = 0;

    for (const b of bills) {
      let bal = b.bal;
      if (reduce > 0.01) { const cut = Math.min(reduce, bal); bal = round2(bal - cut); reduce = round2(reduce - cut); }
      if (bal <= 0.01) continue;
      if (!b.due) { notDueAmt = round2(notDueAmt + bal); continue; }
      const days = dayDiff(today, new Date(b.due.getFullYear(), b.due.getMonth(), b.due.getDate()));
      if (days > 0) { overdueAmt = round2(overdueAmt + bal); overdueCount++; if (days > maxDays) maxDays = days; }
      else if (days === 0) { dueTodayAmt = round2(dueTodayAmt + bal); dueTodayCount++; }
      else notDueAmt = round2(notDueAmt + bal);
    }

    // Net above the aged bills is an advance / on-account credit, never overdue.
    const aged = round2(overdueAmt + dueTodayAmt + notDueAmt);
    if (net > aged + 0.01) notDueAmt = round2(notDueAmt + (net - aged));

    out.push({
      nk, name: p.name, net,
      overdueAmount: overdueAmt, overdueCount, maxDaysOverdue: maxDays,
      dueTodayAmount: dueTodayAmt, dueTodayCount,
      notDueAmount: notDueAmt,
    });
  }

  out.sort((a, b) => b.overdueAmount - a.overdueAmount || b.net - a.net);
  return out;
};

/** Roll the per-party aging into the figures a reminder quotes. */
export const summariseReceivable = (rows) => ({
  overdueAmount: round2(rows.reduce((s, r) => s + r.overdueAmount, 0)),
  overdueCount: rows.reduce((s, r) => s + r.overdueCount, 0),
  overdueParties: rows.filter((r) => r.overdueAmount > 0.01).length,
  dueTodayAmount: round2(rows.reduce((s, r) => s + r.dueTodayAmount, 0)),
  dueTodayCount: rows.reduce((s, r) => s + r.dueTodayCount, 0),
  totalOutstanding: round2(rows.reduce((s, r) => s + r.net, 0)),
  worst: rows.filter((r) => r.overdueAmount > 0.01).slice(0, 3)
    .map((r) => ({ name: r.name, amount: r.overdueAmount, days: r.maxDaysOverdue })),
});
