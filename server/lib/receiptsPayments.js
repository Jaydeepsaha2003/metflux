// Parser for a Cash/Bank Book export (the "Receipts & Payments Register").
//
// Layout (Tally-style):
//   <company name>
//   Cash/Bank Book
//   Account : ...,From d-m-y to d-m-y
//   "Opening Bal. = ... Dr"
//   Date,Type,Vch/Bill No,Account,Receipt,Payment,Short Narration
//   <rows: a Receipt (money in, from a customer) OR a Payment (money out)>
//
// Each row with a Receipt amount is money received from that party (knock off
// their sales invoices); each row with a Payment amount is money paid to that
// party (knock off their purchase bills). Rows for expenses / salaries simply
// won't match any party and are reported as unmatched.
import { parseAmount, parseDateWith, isCancelledName } from './invoicing.js';
import { AppError } from './errors.js';

// Cash/Bank books here are exported in D/M/Y (Tally / Indian format). Default to
// DMY and only switch to MDY when the data itself proves it — a month-first
// value >12 with a valid day. (The generic inferDateOrder defaults ambiguous
// slash-dates to MDY, which flips 3/7/26 to 7-Mar; this keeps it 3-Jul.)
const bankBookDateOrder = (strings) => {
  let dayFirst = 0, monthFirst = 0;
  for (const s of strings) {
    const m = /^(\d{1,2})[/\-.](\d{1,2})[/\-.]\d{2,4}$/.exec(String(s ?? '').trim());
    if (!m) continue;
    const a = +m[1], b = +m[2];
    if (a > 12 && b <= 12) dayFirst++;
    else if (b > 12 && a <= 12) monthFirst++;
  }
  return monthFirst > dayFirst ? 'MDY' : 'DMY';
};

export const parseBankBook = (matrix) => {
  const M = matrix.map((r) => (Array.isArray(r) ? r.map((c) => String(c ?? '').trim()) : []));

  let headerIdx = M.findIndex((r) => {
    const j = r.join(' ').toLowerCase();
    return j.includes('date') && (j.includes('receipt') || j.includes('payment'));
  });
  if (headerIdx < 0) throw new AppError('Could not find the header row (expected Date, Account, Receipt, Payment).', 400, 'NO_HEADER');

  const header = M[headerIdx].map((c) => c.toLowerCase());
  const find = (...keys) => { for (const k of keys) { const i = header.findIndex((h) => h.includes(k)); if (i >= 0) return i; } return -1; };
  const cDate = find('date');
  const cVch  = find('vch', 'bill', 'voucher');
  const cAcct = find('account', 'party', 'particular');
  const cRcpt = find('receipt');
  const cPymt = find('payment');
  if (cAcct < 0 || cRcpt < 0 || cPymt < 0) {
    throw new AppError('The sheet needs Account, Receipt and Payment columns.', 400, 'BAD_HEADER');
  }

  // Grab the "as on" (period end) date from the "From x to y" line, if present.
  let asOn = null;
  for (let i = 0; i < headerIdx; i++) {
    const m = /to\s+(\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4})/i.exec(M[i].join(' '));
    if (m) { asOn = m[1]; break; }
  }

  const raw = [];
  const dateStrs = [];
  for (let i = headerIdx + 1; i < M.length; i++) {
    const r = M[i];
    const account = (r[cAcct] ?? '').trim();
    if (!account) continue;
    if (isCancelledName(account)) continue;
    const receipt = parseAmount(r[cRcpt]);
    const payment = parseAmount(r[cPymt]);
    if (receipt <= 0 && payment <= 0) continue;
    // A totals / opening line rarely has a party name; skip obvious ones.
    if (/^(opening|closing|grand\s*total|total)\b/i.test(account)) continue;
    const side = receipt > 0 ? 'RECEIPT' : 'PAYMENT';
    dateStrs.push(r[cDate] ?? '');
    raw.push({ dateStr: (r[cDate] ?? '').trim(), side, account, amount: side === 'RECEIPT' ? receipt : payment, vch: (r[cVch] ?? '').trim() });
  }

  const order = bankBookDateOrder(dateStrs);
  const entries = raw.map((e) => ({ ...e, date: parseDateWith(e.dateStr, order) }));
  return { entries, asOn };
};
