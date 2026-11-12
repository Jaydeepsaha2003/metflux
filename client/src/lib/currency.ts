// Quotation currencies. A quotation carries one ISO 4217 code; amounts are typed
// in it and are never converted. INR keeps the app's existing look (₹, Indian
// grouping, whole rupees on screen) so nothing that was already INR changes.
import { createContext, useContext } from 'react';

export const CURRENCIES = [
  'INR', 'USD', 'EUR', 'GBP', 'AED', 'SGD', 'AUD', 'CAD', 'JPY', 'CNY',
  'CHF', 'SAR', 'QAR', 'KWD', 'OMR', 'BHD', 'NZD', 'ZAR', 'MYR', 'THB', 'HKD', 'RUB', 'TRY',
] as const;

const names = new Intl.DisplayNames(['en'], { type: 'currency' });
export const currencyName = (code: string) => { try { return names.of(code) ?? code; } catch { return code; } };
export const currencyOptions = CURRENCIES.map((c) => ({ value: c, label: `${c} — ${currencyName(c)}` }));

/** The symbol Intl prefers for this code ("$", "€", "£"; or the code itself where there is none). */
export const currencySymbol = (code: string): string => {
  if (code === 'INR') return '₹';
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: code, currencyDisplay: 'narrowSymbol' })
      .formatToParts(0).find((p) => p.type === 'currency')?.value ?? code;
  } catch { return code; }
};

/** Decimals the currency is written with (JPY 0, KWD 3, most 2). */
const digits = (code: string) => {
  try { return new Intl.NumberFormat('en-US', { style: 'currency', currency: code }).resolvedOptions().maximumFractionDigits ?? 2; }
  catch { return 2; }
};

/** On-screen amount. Whole rupees for INR as before; the currency's own decimals otherwise,
 *  because rounding $0.45 a piece to "$0" would hide the whole price. */
export const fmtMoney = (n: number | null | undefined, code = 'INR'): string => {
  const v = Number(n) || 0;
  if (code === 'INR') return `₹${Math.round(v).toLocaleString('en-IN')}`;
  const d = digits(code);
  return `${currencySymbol(code)}${v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })}`;
};

/** Plain figure for print tables: two decimals, Indian grouping only for INR. */
export const fmtPlain = (n: number, code = 'INR') => {
  const d = code === 'INR' ? 2 : digits(code);
  return n.toLocaleString(code === 'INR' ? 'en-IN' : 'en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
};

/* The sub-forms shared with the Sales Order read the currency from here, so the
   Sales Order (no provider) stays rupees and the Quotation screen can override. */
export const CurrencyContext = createContext<string>('INR');
export const useCurrency = () => {
  const code = useContext(CurrencyContext);
  return { code, sym: currencySymbol(code), fmt: (n: number | null | undefined) => fmtMoney(n, code) };
};

/* "Amount in words", international grouping (thousand / million / billion).
   INR keeps its own lakh / crore version in the print page. */
const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven',
  'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
const below1000 = (n: number): string =>
  n < 20 ? ONES[n]
  : n < 100 ? TENS[Math.floor(n / 10)] + (n % 10 ? ` ${ONES[n % 10]}` : '')
  : `${ONES[Math.floor(n / 100)]} Hundred${n % 100 ? ` ${below1000(n % 100)}` : ''}`;

export const wordsIntl = (amount: number, code: string): string => {
  const d = digits(code);
  const whole = Math.floor(amount + 1e-9);
  const minor = Math.round((amount - whole) * 10 ** d);
  const parts: string[] = [];
  [[1e9, 'Billion'], [1e6, 'Million'], [1e3, 'Thousand']].forEach(([size, label]) => {
    const q = Math.floor(whole / (size as number)) % 1000;
    if (q) parts.push(`${below1000(q)} ${label}`);
  });
  if (whole % 1000) parts.push(below1000(whole % 1000));
  const text = parts.join(' ') || 'Zero';
  // Cheque style for the minor unit: minor-unit names differ too much to guess (cents, pence, fils).
  return `${currencyName(code)} ${text}${minor ? ` and ${String(minor).padStart(d, '0')}/${10 ** d}` : ''} Only`;
};
