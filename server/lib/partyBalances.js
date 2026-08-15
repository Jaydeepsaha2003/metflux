// Ledger-basis balance per trading party — the single figure that Amount
// Receivable, Amount Payable and the Party Ledger all agree on.
//
//   lRecv = Σ sales invoices − Σ cash-book receipts + Σ journal (Dr − Cr)
//   lPay  = Σ purchase bills − Σ cash-book payments
//   netReceivable = lRecv − lPay          (positive → they owe us,  Dr)
//   netPayable    = −netReceivable        (positive → we owe them,  Cr)
//
// GROSS invoices ± the actual bank book, NOT the point-in-time payment
// allocation, which drifts. Mirrors the computation inside the two aging
// endpoints so a reconciliation compares like with like.
import { q } from './db.js';
import { round2, normName } from './invoicing.js';

export const loadPartyBalances = async (companyId) => {
  const siSum = new Map();   // nk -> Σ SalesInvoice.amount
  const piSum = new Map();   // nk -> Σ PurchaseInvoice.amount
  const rcpt  = new Map();   // nk -> Σ cash-book receipts
  const pay   = new Map();   // nk -> Σ cash-book payments
  const jv    = new Map();   // nk -> Σ journal (Debit − Credit)
  const nameByNk = new Map();
  const addName = (nk, nm) => { if (nk && nm && !nameByNk.has(nk)) nameByNk.set(nk, nm); };

  for (const r of await q('SELECT `customerName` nm, COALESCE(SUM(`amount`),0) s FROM `SalesInvoice` WHERE `companyId` = ? GROUP BY `customerName`', [companyId])) {
    const nk = normName(r.nm); if (!nk) continue;
    addName(nk, r.nm); siSum.set(nk, round2((siSum.get(nk) || 0) + Number(r.s)));
  }
  for (const r of await q('SELECT `supplierName` nm, COALESCE(SUM(`amount`),0) s FROM `PurchaseInvoice` WHERE `companyId` = ? GROUP BY `supplierName`', [companyId])) {
    const nk = normName(r.nm); if (!nk) continue;
    addName(nk, r.nm); piSum.set(nk, round2((piSum.get(nk) || 0) + Number(r.s)));
  }
  try {
    for (const r of await q("SELECT `normKey` k, `account` nm, `side`, COALESCE(SUM(`amount`),0) s FROM `CashbookEntry` WHERE `companyId` = ? GROUP BY `normKey`, `account`, `side`", [companyId])) {
      const nk = r.k; if (!nk) continue;
      addName(nk, r.nm);
      const m = r.side === 'RECEIPT' ? rcpt : pay;
      m.set(nk, round2((m.get(nk) || 0) + Number(r.s)));
    }
  } catch { /* cashbook table absent on minimal installs */ }
  try {
    for (const r of await q("SELECT `normKey` k, `account` nm, `side`, COALESCE(SUM(`amount`),0) s FROM `JournalVoucher` WHERE `companyId` = ? GROUP BY `normKey`, `account`, `side`", [companyId])) {
      const nk = r.k; if (!nk) continue;
      addName(nk, r.nm);
      const d = r.side === 'DEBIT' ? Number(r.s) : -Number(r.s);
      jv.set(nk, round2((jv.get(nk) || 0) + d));
    }
  } catch { /* JournalVoucher table absent on minimal installs */ }

  // Who legitimately belongs on each side (same rule as the aging reports):
  // a registered record, or anyone we've actually billed / been billed by.
  const custByNk = new Map();
  for (const r of await q('SELECT `id`, `name`, `customerCode` FROM `Customer` WHERE `companyId` = ?', [companyId])) {
    const nk = normName(r.name); if (!nk) continue;
    addName(nk, r.name); if (!custByNk.has(nk)) custByNk.set(nk, r);
  }
  const suppNk = new Set();
  for (const r of await q('SELECT s.`name` FROM `Supplier` s INNER JOIN `SupplierMembership` sm ON sm.`supplierId` = s.`id` WHERE sm.`companyId` = ?', [companyId])) {
    const nk = normName(r.name); if (!nk) continue;
    addName(nk, r.name); suppNk.add(nk);
  }

  const all = new Set([...siSum.keys(), ...piSum.keys(), ...rcpt.keys(), ...pay.keys(), ...jv.keys(), ...custByNk.keys(), ...suppNk]);
  const byNk = new Map();
  for (const nk of all) {
    const lRecv = round2((siSum.get(nk) || 0) - (rcpt.get(nk) || 0) + (jv.get(nk) || 0));
    const lPay  = round2((piSum.get(nk) || 0) - (pay.get(nk) || 0));
    const net   = round2(lRecv - lPay);
    byNk.set(nk, {
      nk,
      name: nameByNk.get(nk) || nk,
      isCustomer: custByNk.has(nk) || siSum.has(nk),
      isSupplier: suppNk.has(nk) || piSum.has(nk),
      netReceivable: net,
      netPayable: round2(-net),
      salesTotal: round2(siSum.get(nk) || 0),
      purchaseTotal: round2(piSum.get(nk) || 0),
      receiptTotal: round2(rcpt.get(nk) || 0),
      paymentTotal: round2(pay.get(nk) || 0),
      journalTotal: round2(jv.get(nk) || 0),
    });
  }
  return byNk;
};

/** What Amount Receivable / Amount Payable would actually SHOW for this party.
 *  A net that lands on the other side is not a negative balance here — those
 *  reports drop anyone who nets to zero-or-below (`if (c.total <= 0.01)`), since
 *  a supplier we owe belongs on Payable, not as a negative Receivable. Mirroring
 *  that keeps a reconciliation comparing like with like; without it the system
 *  column shows negatives the report never displays, and a statement that
 *  rightly omits the party looks like a discrepancy. */
export const sideBalance = (p, side) => {
  if (!p) return 0;
  const raw = side === 'RECEIVABLE'
    ? (p.isCustomer ? p.netReceivable : 0)
    : (p.isSupplier ? p.netPayable : 0);
  return raw > 0.01 ? raw : 0;
};

/** True when the party's balance sits on the OTHER side — worth saying so
 *  rather than silently showing nothing. */
export const belongsToOtherSide = (p, side) => {
  if (!p) return false;
  return side === 'RECEIVABLE' ? p.netPayable > 0.01 : p.netReceivable > 0.01;
};
