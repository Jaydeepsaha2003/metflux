import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

export type CardRate = {
  id: string;
  grade: string;
  coreType: string;
  rateBasis: 'PER_KG' | 'PER_PCS';
  rateValue: number;
};

/**
 * The agreed rate for this customer and grade, if one has been recorded.
 *
 * The server prefers a row naming this exact core type and falls back to the
 * customer's blanket rate for the grade, so the caller just asks and takes
 * what comes back. No rate is a normal answer, not an error — most
 * customer/grade pairs have never been priced.
 *
 * Idle until there is both a customer and a grade to ask about, which is why
 * the quotation and edit screens can pass no customer at all and simply get
 * nothing.
 */
export const useCustomerRate = (
  customerId: string | undefined,
  grade: string | undefined,
  coreType: string,
) => {
  const enabled = Boolean(customerId && grade);
  const { data } = useQuery({
    queryKey: ['customer-rate', customerId, grade, coreType],
    queryFn: () => api<{ rate: CardRate | null }>(
      `/customer-rates/lookup?customerId=${encodeURIComponent(customerId!)}`
      + `&grade=${encodeURIComponent(grade!)}&coreType=${encodeURIComponent(coreType)}`
    ),
    enabled,
    staleTime: 60_000,
  });
  return enabled ? (data?.rate ?? null) : null;
};

/**
 * Fill the rate fields from the card, but never over the top of a figure
 * someone has already typed.
 *
 * `touched` is the caller's own "the user has edited this" flag. Without it an
 * arriving lookup would overwrite a deliberate override the moment the request
 * resolved — the rate would appear to revert itself a second after being
 * typed, which is exactly the behaviour that makes people distrust auto-fill.
 *
 * Re-fills whenever the card rate actually changes (a different grade, a
 * different customer), so switching grade mid-entry still picks the new rate
 * up rather than leaving the previous grade's figure sitting there.
 */
export const useAutoFillRate = (
  rate: CardRate | null,
  touched: boolean,
  apply: (r: CardRate) => void,
) => {
  const lastApplied = useRef<string | null>(null);
  // The callback is re-created every render by callers; keeping it in a ref
  // means the effect can depend on the rate alone rather than re-running (and
  // re-filling) on every keystroke elsewhere in the form.
  const applyRef = useRef(apply);
  applyRef.current = apply;

  useEffect(() => {
    if (!rate || touched) return;
    const key = `${rate.id}:${rate.rateBasis}:${rate.rateValue}`;
    if (lastApplied.current === key) return;
    lastApplied.current = key;
    applyRef.current(rate);
  }, [rate, touched]);
};
