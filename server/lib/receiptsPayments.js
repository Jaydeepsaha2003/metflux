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
import { parseAmount, parseDateWith, isCancelledName, round2 } from './invoicing.js';
import { AppError } from './errors.js';

// Cash/Bank books here are exported in D/M/Y (Tally / Indian format). Default to
// DMY and only switch to MDY when the data itself proves it — a month-first
// value >12 with a valid day. (The generic inferDateOrder defaults ambiguous
// slash-dates to MDY, which flips 3/7/26 to 7-Mar; this keeps it 3-Jul.)
/** True for a carry/subtotal line rather than a real party.
 *  Exports write these many ways ("Op. Bal.", "B/F", "Balance c/f", "By Balance",
 *  "Sub Total"…). Importing one as a transaction wrecks the closing balance, so
 *  the test runs on a letters-only form and is fully anchored — a genuine party
 *  like "BF Enterprises" or "Total Solutions Pvt Ltd" is NOT matched. */
export const isBalanceOrTotalRow = (s) => {
  const n = String(s ?? '').toLowerCase().replace(/[^a-z]/g, '');
  if (!n) return false;
  return /^(?:(?:opening|closing|op|cl)?bal(?:ance)?|balance(?:bf|cf|broughtforward|carriedforward)?|(?:by|to)balance|b?f|c?f|bfwd|cfwd|broughtforward|carriedforward|(?:sub|grand|net|running)?total|totalbf|totalcf|difference(?:inopeningbalance)?)$/.test(n);
};

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
  // Diagnostics so nothing can vanish from an import without the user seeing it.
  const skipped = { balanceRows: 0, cancelled: 0, unreadableAmount: 0 };
  // A voucher that hits several ledger heads is printed as one dated line
  // followed by continuation lines with the Date and Vch cells left blank
  // (a GST payment split across CGST/SGST/IGST, for example). Those blanks
  // mean "same voucher as above", not "no date" — carried forward below.
  let carriedDate = '';
  let carriedVch = '';
  let continuationRows = 0;
  let statedOpening = null;   // from the statement's own opening/B-F line
  let statedClosing = null;   // from its closing/C-F line

  for (let i = headerIdx + 1; i < M.length; i++) {
    const r = M[i];
    const dateCell = (r[cDate] ?? '').trim();
    const vchCell = (r[cVch] ?? '').trim();
    if (dateCell) { carriedDate = dateCell; carriedVch = vchCell; }
    else if (carriedDate) continuationRows++;
    const rowDate = dateCell || carriedDate;
    const rowVch = dateCell ? vchCell : (vchCell || carriedVch);

    const account = (r[cAcct] ?? '').trim();
    if (!account) continue;
    if (isCancelledName(account)) { skipped.cancelled++; continue; }

    const receipt = parseAmount(r[cRcpt]);
    const payment = parseAmount(r[cPymt]);

    // Carry / subtotal lines are not transactions. Capture the figures (they let
    // us prove the import balances) and keep them out of the entry list.
    if (isBalanceOrTotalRow(account)) {
      skipped.balanceRows++;
      const n = String(account).toLowerCase().replace(/[^a-z]/g, '');
      const val = receipt !== 0 ? Math.abs(receipt) : Math.abs(payment);
      const isOpening = /^(?:opening|op)/.test(n) || n === 'bf' || n === 'bfwd' || n === 'balancebf' || n === 'broughtforward';
      const isClosing = /^(?:closing|cl)/.test(n) || n === 'cf' || n === 'cfwd' || n === 'balancecf' || n === 'carriedforward';
      if (val > 0 && isOpening && statedOpening == null) statedOpening = val;
      if (val > 0 && isClosing) statedClosing = val;
      continue;
    }

    // A row naming a party but carrying no readable figure is a parse failure,
    // not an empty line — surface it instead of dropping it quietly.
    if (receipt === 0 && payment === 0) {
      const hadText = String(r[cRcpt] ?? '').trim() || String(r[cPymt] ?? '').trim();
      if (hadText) skipped.unreadableAmount++;
      continue;
    }

    // A negative in one column is a reversal — book it on the opposite side
    // rather than discarding it.
    let side, amount;
    if (receipt !== 0) { side = receipt > 0 ? 'RECEIPT' : 'PAYMENT'; amount = Math.abs(receipt); }
    else { side = payment > 0 ? 'PAYMENT' : 'RECEIPT'; amount = Math.abs(payment); }

    dateStrs.push(rowDate);
    raw.push({ dateStr: rowDate, side, account, amount, vch: rowVch });
  }

  // Busy-style books print the balances as free text rather than as a row with
  // an amount column — "Opening Bal. = 1,92,318.97 Dr" above the header and
  // "Closing Bal. = 2,01,359.82 Dr" under the last line. Without these the
  // self-check below silently never runs, which defeats the point of it, so
  // scan the whole sheet for them. Dr is money in hand, Cr is overdrawn.
  const OPEN_BAL = /open[a-z]*\.?\s*bal[a-z]*\.?\s*[:=]?\s*([\d,]+(?:\.\d+)?)\s*(dr|cr)?/i;
  const CLOSE_BAL = /clos[a-z]*\.?\s*bal[a-z]*\.?\s*[:=]?\s*([\d,]+(?:\.\d+)?)\s*(dr|cr)?/i;
  const balanceLine = (text, re) => {
    const m = re.exec(text);
    if (!m) return null;
    const v = parseAmount(m[1]);
    return /^cr$/i.test(m[2] ?? '') ? -v : v;
  };
  for (let i = 0; i < M.length && (statedOpening == null || statedClosing == null); i++) {
    const text = M[i].join(' ');
    if (statedOpening == null) { const v = balanceLine(text, OPEN_BAL); if (v != null) statedOpening = v; }
    if (statedClosing == null) { const v = balanceLine(text, CLOSE_BAL); if (v != null) statedClosing = v; }
  }

  const order = bankBookDateOrder(dateStrs);
  const entries = raw.map((e) => ({ ...e, date: parseDateWith(e.dateStr, order) }));
  const undated = entries.filter((e) => !e.date).length;

  const receiptTotal = round2(entries.filter((e) => e.side === 'RECEIPT').reduce((s, e) => s + e.amount, 0));
  const paymentTotal = round2(entries.filter((e) => e.side === 'PAYMENT').reduce((s, e) => s + e.amount, 0));

  // Self-check: the statement's own opening + what we read should land on its own
  // closing figure. If it doesn't, the file was misread and the user must know.
  let check = null;
  if (statedClosing != null) {
    const expected = round2((statedOpening ?? 0) + receiptTotal - paymentTotal);
    check = {
      statedOpening: statedOpening == null ? null : round2(statedOpening),
      statedClosing: round2(statedClosing),
      computedClosing: expected,
      difference: round2(expected - statedClosing),
      matches: Math.abs(expected - statedClosing) <= 1,
    };
  }

  return { entries, asOn, skipped, undated, continuationRows, receiptTotal, paymentTotal, check };
};
