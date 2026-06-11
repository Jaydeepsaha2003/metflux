// Shared helpers for the bulk-Excel import endpoints. Rows arrive as objects
// keyed by the (trimmed) header cell, values already stringified by the client.
import { z } from 'zod';

export const importBody = z.object({
  rows: z.array(z.record(z.any())).max(5000),
});

/** First non-empty value among the given header aliases (case-insensitive). */
export const cellPick = (row, ...headers) => {
  for (const h of headers) {
    const key = Object.keys(row).find((rk) => rk.toLowerCase().trim() === h.toLowerCase().trim());
    if (key !== undefined) {
      const v = String(row[key] ?? '').trim();
      if (v !== '') return v;
    }
  }
  return undefined;
};

/** Parse a possibly comma-grouped number; undefined if blank or not a number. */
export const numOpt = (v) => {
  if (v === undefined || v === null || String(v).trim() === '') return undefined;
  const n = Number(String(v).replace(/[,\s₹]/g, ''));
  return Number.isFinite(n) ? n : undefined;
};

/** True when every cell in the row is blank. */
export const rowIsBlank = (row) =>
  !Object.values(row).some((v) => String(v ?? '').trim() !== '');

/** Pull the first useful message out of a thrown error (Zod, AppError, Error). */
export const errMessage = (e) => {
  if (e?.issues?.[0]?.message) return e.issues[0].message;     // ZodError
  if (e?.errors?.[0]?.message) return e.errors[0].message;     // older zod
  if (typeof e?.message === 'string') return e.message;
  return 'Invalid row';
};
