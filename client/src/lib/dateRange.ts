// Shared date-range helpers for the Accounts date filter (and anywhere else
// that wants quick-pick ranges). Dates are plain 'YYYY-MM-DD' strings in the
// browser's local timezone, matching what <input type="date"> uses.
export const toISO = (d: Date) => {
  const off = d.getTimezoneOffset() * 60_000;
  return new Date(d.getTime() - off).toISOString().slice(0, 10);
};
export const todayISO = () => toISO(new Date());
export const yesterdayISO = () => {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return toISO(d);
};
export const startOfWeekISO = () => {
  const d = new Date();
  const day = (d.getDay() + 6) % 7; // Mon=0
  d.setDate(d.getDate() - day);
  return toISO(d);
};
export const startOfMonthISO = () => {
  const d = new Date();
  return toISO(new Date(d.getFullYear(), d.getMonth(), 1));
};
export const startOfLastMonthISO = () => {
  const d = new Date();
  return toISO(new Date(d.getFullYear(), d.getMonth() - 1, 1));
};
export const endOfLastMonthISO = () => {
  const d = new Date();
  return toISO(new Date(d.getFullYear(), d.getMonth(), 0));
};
export const startOfYearISO = () => {
  const d = new Date();
  return toISO(new Date(d.getFullYear(), 0, 1));
};
export const daysAgoISO = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return toISO(d);
};

/* ── Indian financial year: 1 Apr → 31 Mar ──────────────────────────────── */
/** Start year of the FY a date falls in (Jan–Mar belong to the previous one). */
export const fyOf = (d: Date = new Date()) => (d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1);
export const fyStartISO = (startYear: number) => toISO(new Date(startYear, 3, 1));
export const fyEndISO = (startYear: number) => toISO(new Date(startYear + 1, 2, 31));
/** "2026-27" */
export const fyLabel = (startYear: number) => `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`;
/** Quarter n (1–4) of an Indian FY: Q1 = Apr–Jun … Q4 = Jan–Mar. */
export const fyQuarter = (startYear: number, q: 1 | 2 | 3 | 4) => {
  const firstMonth = 3 + (q - 1) * 3;                       // 3 = April
  const from = new Date(startYear, firstMonth, 1);
  const to = new Date(startYear, firstMonth + 3, 0);        // day 0 = last of prev month
  return { from: toISO(from), to: toISO(to) };
};
/** The 12 months of an FY, in order, as pickable ranges. */
export const fyMonths = (startYear: number) =>
  Array.from({ length: 12 }, (_, i) => {
    const d = new Date(startYear, 3 + i, 1);
    return {
      key: `${d.getFullYear()}-${d.getMonth()}`,
      label: d.toLocaleDateString('en-GB', { month: 'short' }),
      year: d.getFullYear(),
      from: toISO(d),
      to: toISO(new Date(d.getFullYear(), d.getMonth() + 1, 0)),
    };
  });

/** Whole days covered by an inclusive range (0 when either end is open). */
export const rangeDays = (from: string, to: string) => {
  if (!from || !to) return 0;
  const a = new Date(from + 'T00:00:00').getTime();
  const b = new Date(to + 'T00:00:00').getTime();
  if (Number.isNaN(a) || Number.isNaN(b) || b < a) return 0;
  return Math.round((b - a) / 86400000) + 1;
};

/** Shift a closed range back/forward by its own length — the ◀ ▶ steppers. */
export const shiftRange = (from: string, to: string, dir: -1 | 1) => {
  const days = rangeDays(from, to);
  if (!days) return { from, to };
  const move = (iso: string) => {
    const d = new Date(iso + 'T00:00:00');
    d.setDate(d.getDate() + dir * days);
    return toISO(d);
  };
  return { from: move(from), to: move(to) };
};

export type DateRangePresetKey =
  | 'today' | 'yesterday' | 'week' | 'month' | 'lastMonth' | 'last30' | 'ytd' | 'all';

export type DateRangePreset = {
  key: DateRangePresetKey;
  label: string;
  from: () => string;
  to: () => string;
};

export const DATE_RANGE_PRESETS: DateRangePreset[] = [
  { key: 'today',     label: 'Today',          from: todayISO,             to: todayISO },
  { key: 'yesterday', label: 'Yesterday',      from: yesterdayISO,         to: yesterdayISO },
  { key: 'week',      label: 'This week',      from: startOfWeekISO,       to: todayISO },
  { key: 'month',     label: 'This month',     from: startOfMonthISO,      to: todayISO },
  { key: 'lastMonth', label: 'Last month',     from: startOfLastMonthISO,  to: endOfLastMonthISO },
  { key: 'last30',    label: 'Last 30 days',   from: () => daysAgoISO(29), to: todayISO },
  { key: 'ytd',       label: 'This year',      from: startOfYearISO,       to: todayISO },
  { key: 'all',       label: 'All time',       from: () => '',            to: () => '' },
];

export const detectDateRangePreset = (from: string, to: string): DateRangePresetKey | null => {
  for (const p of DATE_RANGE_PRESETS) if (p.from() === from && p.to() === to) return p.key;
  return null;
};

const fmtShort = (iso: string) => {
  const d = new Date(iso + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
};

/** Human label for a committed range, e.g. for a trigger button or chip. */
export const formatDateRangeLabel = (from: string, to: string): string => {
  const preset = detectDateRangePreset(from, to);
  if (preset) return DATE_RANGE_PRESETS.find((p) => p.key === preset)!.label;
  if (!from && !to) return 'All time';
  // Recognise whole financial years, quarters and months so the button reads
  // "FY 2026-27" or "Aug 2026" rather than a pair of dates.
  if (from && to) {
    for (const y of [fyOf(new Date(from + 'T00:00:00')), fyOf(new Date(from + 'T00:00:00')) - 1]) {
      if (from === fyStartISO(y) && to === fyEndISO(y)) return `FY ${fyLabel(y)}`;
      for (const q of [1, 2, 3, 4] as const) {
        const r = fyQuarter(y, q);
        if (from === r.from && to === r.to) return `Q${q} ${fyLabel(y)}`;
      }
    }
    const d = new Date(from + 'T00:00:00');
    if (!Number.isNaN(d.getTime())
      && from === toISO(new Date(d.getFullYear(), d.getMonth(), 1))
      && to === toISO(new Date(d.getFullYear(), d.getMonth() + 1, 0))) {
      return d.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
    }
  }
  if (from && !to) return `From ${fmtShort(from)}`;
  if (!from && to) return `Until ${fmtShort(to)}`;
  if (from === to) return fmtShort(from);
  return `${fmtShort(from)} – ${fmtShort(to)}`;
};
