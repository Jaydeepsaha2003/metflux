export type Stats = {
  range:             { from: string; to: string };
  salesOrders:       { count: number; pcs: number; kg: number; customers: number; amount: number; toroidalPcs: number; rectangularPcs: number };
  pendingProduction: { pcs: number; kg: number; amount: number };
  readyDispatch:     { pcs: number; kg: number; amount: number };
  dispatched:        { count: number; pcs: number; kg: number; amount: number };
  openReturns:       number;
  overdueItems:      number;
  topCustomers:      {
    id: string; name: string; customerCode: string | null;
    amount: number; pcs: number; kg: number; toroidalPcs: number; rectangularPcs: number;
  }[];
};

export type Series = {
  days: string[];
  salesOrders: number[];
  pendingProduction: number[];
  readyDispatch: number[];
  dispatched: number[];
  openReturns: number[];
};

const DAY = 86_400_000;
const dateStamp = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return NaN;
  const stamp = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(stamp) && new Date(stamp).toISOString().slice(0, 10) === value ? stamp : NaN;
};

/** Adjacent equal-length calendar periods, independent of DST. */
export function previousRange(from: string, to: string) {
  const start = dateStamp(from), end = dateStamp(to);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  const days = Math.round((end - start) / DAY) + 1;
  const iso = (stamp: number) => new Date(stamp).toISOString().slice(0, 10);
  return { from: iso(start - days * DAY), to: iso(start - DAY), days };
}

export function percentChange(current: number, previous: number): number | null {
  return previous > 0 ? ((current - previous) / previous) * 100 : null;
}

/** Uses only observed dates: future days must not depress the measured pace. */
export function flowAnalysis(series: Series, today: string) {
  const indexes = series.days.map((day, i) => ({ day, i })).filter(({ day }) => day <= today);
  const sum = (values: number[]) => indexes.reduce((total, { i }) => total + (values[i] ?? 0), 0);
  const produced = sum(series.pendingProduction);
  const dispatched = sum(series.dispatched);
  const activeDays = indexes.filter(({ i }) => (series.pendingProduction[i] ?? 0) > 0).length;
  const peak = indexes.reduce<{ day: string; pcs: number } | null>((best, { day, i }) => {
    const pcs = series.pendingProduction[i] ?? 0;
    return pcs > (best?.pcs ?? 0) ? { day, pcs } : best;
  }, null);
  return { produced, dispatched, net: produced - dispatched, activeDays,
    days: indexes.length, dailyPace: indexes.length ? produced / indexes.length : null,
    peak, from: indexes[0]?.day, to: indexes.at(-1)?.day };
}

export function coreMix(stats: Stats) {
  const total = stats.salesOrders.pcs;
  return [
    { label: 'Toroidal', value: stats.salesOrders.toroidalPcs, color: 'var(--d-toro)' },
    { label: 'Rectangular', value: stats.salesOrders.rectangularPcs, color: 'var(--d-rect)' },
    { label: 'Other', value: Math.max(0, total - stats.salesOrders.toroidalPcs - stats.salesOrders.rectangularPcs), color: 'var(--d-faint)' },
  ].map((item) => ({ ...item, share: total > 0 ? item.value / total * 100 : 0 }));
}
