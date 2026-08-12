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
  if (from && !to) return `From ${fmtShort(from)}`;
  if (!from && to) return `Until ${fmtShort(to)}`;
  if (from === to) return fmtShort(from);
  return `${fmtShort(from)} – ${fmtShort(to)}`;
};
