// Parse a Busy/Tally-style "Journal Register" export (as a raw cell matrix) into
// balanced vouchers. Each voucher = a group of Dr/Cr lines that starts on a row
// carrying a Date; the following date-less rows are more lines of the same
// voucher. GST columns (Taxable/IGST/CGST/SGST) are voucher-level totals shown
// on the first line.

const num = (v) => {
  if (v == null) return 0;
  const s = String(v).replace(/[₹,\s"]/g, '').trim();
  if (!s || s === '-') return 0;
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
};

// dd-mm-yyyy or d-m-yyyy (also tolerates slashes).
const parseDMY = (v) => {
  const s = String(v ?? '').replace(/"/g, '').trim();
  const m = /^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})$/.exec(s);
  if (!m) return null;
  let [, d, mo, y] = m;
  if (y.length === 2) y = '20' + y;
  const dt = new Date(Date.UTC(+y, +mo - 1, +d));
  return Number.isNaN(dt.getTime()) ? null : dt;
};

const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

// Locate the header row + map our columns from its labels (order can vary).
const findHeader = (rows) => {
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const cells = (rows[i] || []).map((c) => norm(c));
    if (cells.includes('date') && cells.some((c) => c.startsWith('debit'))) {
      const find = (...names) => {
        for (const n of names) { const ix = cells.findIndex((c) => c === n || c.startsWith(n)); if (ix >= 0) return ix; }
        return -1;
      };
      return {
        row: i,
        col: {
          date: find('date'),
          vch: find('vchbillno', 'vchno', 'vch', 'billno'),
          account: find('account', 'particulars'),
          debit: find('debitrs', 'debit'),
          credit: find('creditrs', 'credit'),
          taxable: find('taxableamt', 'taxable'),
          igst: find('igst'),
          cgst: find('cgst'),
          sgst: find('sgst'),
        },
      };
    }
  }
  return null;
};

export const parseJournalRegister = (rows) => {
  if (!Array.isArray(rows) || !rows.length) return { vouchers: [], error: 'Empty file' };
  const hdr = findHeader(rows);
  if (!hdr) return { vouchers: [], error: 'Could not find the header row (need Date, Account, Debit, Credit columns).' };
  const c = hdr.col;
  const at = (row, ix) => (ix >= 0 ? row[ix] : undefined);

  const vouchers = [];
  let cur = null;
  for (let i = hdr.row + 1; i < rows.length; i++) {
    const row = rows[i] || [];
    const account = String(at(row, c.account) ?? '').trim();
    const debit = num(at(row, c.debit));
    const credit = num(at(row, c.credit));
    const dateRaw = String(at(row, c.date) ?? '').replace(/"/g, '').trim();
    const date = parseDMY(dateRaw);

    // A row with a Date starts a new voucher.
    if (date) {
      cur = {
        date, refNo: String(at(row, c.vch) ?? '').replace(/"/g, '').trim() || null,
        taxable: num(at(row, c.taxable)) || null, igst: num(at(row, c.igst)) || null,
        cgst: num(at(row, c.cgst)) || null, sgst: num(at(row, c.sgst)) || null,
        lines: [],
      };
      vouchers.push(cur);
    }
    if (!cur) continue;                 // rows before the first dated row
    if (!account && debit === 0 && credit === 0) continue; // blank / total row
    if (!account) continue;             // a value with no account — skip defensively
    // Ignore a trailing "Grand Total" style summary row.
    if (/^grand\s*total$/i.test(account)) continue;

    const side = debit >= credit && debit > 0 ? 'DEBIT' : (credit > 0 ? 'CREDIT' : 'DEBIT');
    const amount = side === 'DEBIT' ? debit : credit;
    if (amount <= 0) continue;
    cur.lines.push({ account, side, amount: Math.round(amount * 100) / 100 });
  }

  // Drop empty vouchers; compute balance flags.
  const clean = vouchers.filter((v) => v.lines.length > 0).map((v) => {
    const dr = v.lines.filter((l) => l.side === 'DEBIT').reduce((s, l) => s + l.amount, 0);
    const cr = v.lines.filter((l) => l.side === 'CREDIT').reduce((s, l) => s + l.amount, 0);
    return { ...v, debitTotal: Math.round(dr * 100) / 100, creditTotal: Math.round(cr * 100) / 100, balanced: Math.abs(dr - cr) <= 1 };
  });
  return { vouchers: clean };
};
