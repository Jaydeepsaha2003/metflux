// Shared sales-invoice helpers: money rounding, invoice status, the Tally-style
// date/amount/name parsers used by the importer, and the FIFO payment allocator.

/** Round to 2 dp, dodging binary float drift (e.g. 1.005 → 1.01). */
export const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

/** Invoice status from amount vs paid (1/10-paisa tolerance on the float math). */
export const invoiceStatus = (amount, paid) => {
  const a = round2(amount);
  const p = round2(paid);
  if (p <= 0.001) return 'UNPAID';
  if (p + 0.01 >= a) return 'PAID';
  return 'PARTIAL';
};

/** Parse "8,775.00" / "₹ 1,234" → number. Returns 0 when not a number. */
export const parseAmount = (v) => {
  const n = Number(String(v ?? '').replace(/[,\s₹]/g, ''));
  return Number.isFinite(n) ? n : 0;
};

/** Parse a M/D/YY or D-M-YYYY style date → UTC Date (midnight), or null.
 *  The vouchers export uses M/D/YY (e.g. 4/2/26 = 2 Apr 2026). */
export const parseDMY = (s) => {
  const m = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/.exec(String(s ?? '').trim());
  if (!m) return null;
  let mo = +m[1], d = +m[2], y = +m[3];
  if (y < 100) y += 2000;
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, mo - 1, d, 0, 0, 0));
  return Number.isNaN(dt.getTime()) ? null : dt;
};

/** Normalize a party name for matching: drop "M/S", punctuation, case, spacing. */
export const normName = (s) =>
  String(s ?? '')
    .toUpperCase()
    .replace(/^M\/?S[\s.]+/, '')
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();

/** invoiceDate + n days (kept in UTC to match parseDMY). */
export const addDays = (date, days) => new Date(new Date(date).getTime() + days * 86400000);

/**
 * Allocate up to `amount` of a payment across the customer's open invoices,
 * oldest due-date first (invoices with no due date come last). Writes
 * PaymentAllocation rows and bumps each invoice's paidAmount + status.
 * `db` is a txn handle exposing q / insert / update. Returns the total applied.
 */
export const allocatePaymentFifo = async (db, { companyId, customerId, paymentId, amount }) => {
  if (!customerId || amount <= 0) return 0;
  const open = await db.q(
    `SELECT * FROM \`SalesInvoice\`
       WHERE \`companyId\` = ? AND \`customerId\` = ? AND \`status\` <> 'PAID'
       ORDER BY (\`dueDate\` IS NULL), \`dueDate\` ASC, \`invoiceDate\` ASC, \`createdAt\` ASC`,
    [companyId, customerId]
  );
  let remaining = round2(amount);
  let allocated = 0;
  for (const inv of open) {
    if (remaining <= 0.01) break;
    const balance = round2(Number(inv.amount) - Number(inv.paidAmount));
    if (balance <= 0.01) continue;
    const applied = round2(Math.min(remaining, balance));
    await db.insert('PaymentAllocation', {
      companyId, paymentId, salesInvoiceId: inv.id, amount: applied,
    });
    const newPaid = round2(Number(inv.paidAmount) + applied);
    await db.update('SalesInvoice', inv.id, {
      paidAmount: newPaid,
      status: invoiceStatus(inv.amount, newPaid),
    });
    remaining = round2(remaining - applied);
    allocated = round2(allocated + applied);
  }
  return allocated;
};
