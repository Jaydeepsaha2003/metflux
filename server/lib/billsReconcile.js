// Shared helpers for Bills Receivable / Bills Payable reconciliation.
//   • parseBalanceMatrix     — read a Tally "Amount Receivable/Payable" export
//   • classifyAdjustment     — decide what a party's row means once posted
//   • allocateSupplierPaymentFifo — payable twin of allocatePaymentFifo
import { round2, parseAmount, invoiceStatus } from './invoicing.js';
import { AppError } from './errors.js';

const TOL = 0.01; // one-paisa tolerance, matching the rest of the accounting code

/**
 * Pull party balances out of a Tally outstanding-statement matrix. These files
 * have banner rows (company name, "Amount Receivable", "As On : DD-MM-YYYY")
 * before an "Account / Balance" header, then one row per party, then a Total.
 * Returns { parties: [{ name, balance }], asOn: 'YYYY-MM-DD' | null }.
 */
export const parseBalanceMatrix = (rows) => {
  let headerIdx = -1;
  let accountCol = 0;
  let balanceCol = 1;
  let asOn = null;

  for (let i = 0; i < rows.length; i++) {
    const cells = rows[i] ?? [];
    if (!asOn) {
      const m = /as on\s*:?\s*(\d{1,2})[-/](\d{1,2})[-/](\d{4})/i.exec(cells.join(' '));
      if (m) asOn = `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    }
    const lower = cells.map((c) => String(c ?? '').toLowerCase().trim());
    const aIdx = lower.findIndex((c) => c === 'account' || c === 'party' || c === 'particulars' || c === 'name');
    const bIdx = lower.findIndex((c) => c === 'balance' || c === 'amount' || c === 'closing balance');
    if (aIdx !== -1 && bIdx !== -1) { headerIdx = i; accountCol = aIdx; balanceCol = bIdx; break; }
  }
  if (headerIdx === -1) {
    throw new AppError('Could not find an "Account" / "Balance" header row in the file.', 400, 'BAD_FILE');
  }

  const parties = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const cells = rows[i] ?? [];
    const name = String(cells[accountCol] ?? '').trim();
    const balRaw = String(cells[balanceCol] ?? '').trim();
    if (!name && !balRaw) continue;                                  // blank row
    if (/^total\b/i.test(name) || name.toLowerCase() === 'grand total') continue; // trailing total
    if (!name) continue;
    parties.push({ name, balance: round2(parseAmount(balRaw)) });
  }
  return { parties, asOn };
};

/**
 * Compare what the system currently shows pending for a party against the file's
 * closing balance, and decide the action:
 *   post      — system shows MORE than the file → post a payment/receipt for the
 *               difference to clear oldest bills down to the file balance
 *   ok        — system already equals the file (nothing to do)
 *   shortfall — file shows MORE than the system knows (a missing bill / opening
 *               balance) → a payment can't fix it; report and leave untouched
 */
export const classifyAdjustment = (systemPending, fileBalance) => {
  const adjustment = round2(systemPending - fileBalance);
  let action = 'ok';
  if (adjustment > TOL) action = 'post';
  else if (adjustment < -TOL) action = 'shortfall';
  return { adjustment, action };
};

/**
 * Allocate up to `amount` of a supplier payment across that supplier's open
 * purchase bills, oldest invoiceDate first. `invoices` is the caller-supplied,
 * already name-matched and date-sorted list of PurchaseInvoice rows (matching is
 * done in JS on normalized supplierName, since PurchaseInvoice has no Supplier
 * FK). Writes SupplierPaymentAllocation rows and bumps each bill's paidAmount +
 * status. `db` is a txn handle. Returns the total applied.
 */
export const allocateSupplierPaymentFifo = async (db, { companyId, paymentId, amount, invoices }) => {
  if (amount <= 0 || !Array.isArray(invoices) || !invoices.length) return 0;
  let remaining = round2(amount);
  let allocated = 0;
  for (const inv of invoices) {
    if (remaining <= TOL) break;
    const balance = round2(Number(inv.amount) - Number(inv.paidAmount));
    if (balance <= TOL) continue; // skip settled bills and debit notes (negative balance)
    const applied = round2(Math.min(remaining, balance));
    await db.insert('SupplierPaymentAllocation', {
      companyId, supplierPaymentId: paymentId, purchaseInvoiceId: inv.id, amount: applied,
    });
    const newPaid = round2(Number(inv.paidAmount) + applied);
    await db.update('PurchaseInvoice', inv.id, {
      paidAmount: newPaid,
      status: invoiceStatus(inv.amount, newPaid),
    });
    remaining = round2(remaining - applied);
    allocated = round2(allocated + applied);
  }
  return allocated;
};
