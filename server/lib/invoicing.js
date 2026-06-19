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

/** Inspect a set of date strings and decide whether they're day-first (D/M/Y,
 *  common in Indian exports like "15-04-2025") or month-first (M/D/Y, Tally's
 *  voucher export). Uses any unambiguous value (a component > 12) to decide;
 *  when everything is ambiguous, '-' leans day-first and '/' month-first. */
export const inferDateOrder = (strings) => {
  let dayFirst = 0, monthFirst = 0, slash = 0, dash = 0;
  for (const s of strings) {
    const m = /^(\d{1,2})([/\-.])(\d{1,2})[/\-.](\d{2,4})$/.exec(String(s ?? '').trim());
    if (!m) continue;
    const a = +m[1], b = +m[3];
    if (m[2] === '/') slash++; else dash++;
    if (a > 12 && b <= 12) dayFirst++;
    else if (b > 12 && a <= 12) monthFirst++;
  }
  if (dayFirst && !monthFirst) return 'DMY';
  if (monthFirst && !dayFirst) return 'MDY';
  if (dayFirst || monthFirst) return dayFirst >= monthFirst ? 'DMY' : 'MDY';
  return dash > slash ? 'DMY' : 'MDY';
};

/** Parse a date with a known component order ('DMY' | 'MDY'). An unambiguous
 *  component (>12) always wins; otherwise the given order decides. Also accepts
 *  an Excel serial number. → UTC midnight Date, or null. */
export const parseDateWith = (s, order = 'MDY') => {
  const str = String(s ?? '').trim();
  const m = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/.exec(str);
  if (!m) {
    const n = Number(str);
    if (Number.isInteger(n) && n > 20000 && n < 80000) return new Date(Date.UTC(1899, 11, 30) + n * 86400000);
    return null;
  }
  let a = +m[1], b = +m[2], y = +m[3];
  if (y < 100) y += 2000;
  let d, mo;
  if (a > 12 && b <= 12) { d = a; mo = b; }
  else if (b > 12 && a <= 12) { mo = a; d = b; }
  else if (order === 'DMY') { d = a; mo = b; } else { mo = a; d = b; }
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, mo - 1, d, 0, 0, 0));
  return Number.isNaN(dt.getTime()) ? null : dt;
};

/** True when the account/party name marks a cancelled voucher. The export
 *  writes it spaced out like "(C A N C E L L E D) - PARTY", so we strip
 *  non-letters before testing for cancelled / canceled. */
export const isCancelledName = (s) => /cancell?ed/.test(String(s ?? '').replace(/[^a-z]/gi, '').toLowerCase());

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

/**
 * Apply a payment to specific invoices the user picked ("bill to bill").
 * `allocations` is [{ salesInvoiceId, amount }]. Each requested amount is
 * clamped to that invoice's balance and to the payment's remaining funds;
 * invoices not belonging to the customer (or already paid) are skipped.
 * Anything left over stays as unallocated credit (advance). Returns the total
 * actually applied.
 */
export const allocatePaymentManual = async (db, { companyId, customerId, paymentId, amount, allocations }) => {
  if (!Array.isArray(allocations) || !allocations.length) return 0;
  let remaining = round2(amount);
  let allocated = 0;
  for (const a of allocations) {
    if (remaining <= 0.01) break;
    const inv = await db.qOne(
      'SELECT * FROM `SalesInvoice` WHERE `id` = ? AND `companyId` = ? AND `customerId` = ?',
      [a.salesInvoiceId, companyId, customerId]
    );
    if (!inv) continue;
    const balance = round2(Number(inv.amount) - Number(inv.paidAmount));
    if (balance <= 0.01) continue;
    const applied = round2(Math.min(remaining, balance, round2(Number(a.amount) || 0)));
    if (applied <= 0.01) continue;
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
