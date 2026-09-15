// Dashboard — reskinned to the user's own mockup: a dark, full-bleed plant
// snapshot with a hairline-bordered KPI row, a monthly orders chart beside a
// top-customer ranking, and an employee performance table.
//
// Every figure, filter, drill-down link and permission behaves exactly as it
// did before the reskin; only the presentation moved. Two things are genuinely
// new and both are backed by real data: the KPI sparklines (from the new
// /dashboard/series endpoint) and the share-of-output bar, which is each
// worker's weight over the range total.
//
// Colours come from components/dashboard/theme.ts, which derives the whole
// palette from the domain's own --brand-*: Metflux renders the mockup's dark
// green, Toroflux the same design in its navy. It opens light to match the rest
// of the app; the mockup's Dark/Light switch persists per viewer.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Loader2, Trophy } from 'lucide-react';
import { useAuthStore, activeMembership, useHideCustomerNames } from '@/store/auth';
import { useBranding } from '@/store/branding';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useDebounced } from '@/hooks/useDebounced';
import { dashVars, readStoredMode, storeMode, type DashMode } from '@/components/dashboard/theme';
import { DashLabel, DashCaption, DashPanel, DashChip, DashSeg, Sparkline, DashBar } from '@/components/dashboard/ui';

type MonthlyPoint = { month: string; totalPcs: number; totalAmount: number; orderCount: number };

type Stats = {
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

type Series = {
  days: string[];
  salesOrders: number[];
  pendingProduction: number[];
  readyDispatch: number[];
  dispatched: number[];
  openReturns: number[];
};

type CustomerListResp = { items: { id: string; name: string; customerCode: string }[] };

type EmployeeRow = {
  rank: number; labourName: string; pcs: number; totalWeight: number;
  entries: number; distinctSizes: number; topSize: string | null; topSizePcs: number;
  sizes: { measure: string; pcs: number }[];
};
type EmployeeResp = { from: string; to: string; items: EmployeeRow[]; totalPcs: number; totalWeight: number };

const toISO = (d: Date) => {
  const off = d.getTimezoneOffset() * 60_000;
  return new Date(d.getTime() - off).toISOString().slice(0, 10);
};
const todayISO = () => toISO(new Date());
const startOfMonthISO = () => { const d = new Date(); return toISO(new Date(d.getFullYear(), d.getMonth(), 1)); };
const startOfYearISO = () => { const d = new Date(); return toISO(new Date(d.getFullYear(), 0, 1)); };
const daysAgoISO = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return toISO(d); };
const startOfWeekISO = () => {
  const d = new Date();
  const day = (d.getDay() + 6) % 7;     // Mon=0
  d.setDate(d.getDate() - day);
  return toISO(d);
};

type Preset = 'today' | 'week' | 'month' | 'last30' | 'ytd';
const PRESETS: { key: Preset; label: string; from: () => string; to: () => string }[] = [
  { key: 'today',  label: 'Today',        from: todayISO,             to: todayISO },
  { key: 'week',   label: 'This week',    from: startOfWeekISO,       to: todayISO },
  { key: 'month',  label: 'This month',   from: startOfMonthISO,      to: todayISO },
  { key: 'last30', label: 'Last 30 days', from: () => daysAgoISO(29), to: todayISO },
  { key: 'ytd',    label: 'YTD',          from: startOfYearISO,       to: todayISO },
];
const detectPreset = (from: string, to: string): Preset | null => {
  for (const p of PRESETS) if (p.from() === from && p.to() === to) return p.key;
  return null;
};

const fmtMoney = (n: number) => '₹' + n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtCompactMoney = (n: number) => {
  if (n >= 1e7) return `₹${(n / 1e7).toFixed(2)} Cr`;
  if (n >= 1e5) return `₹${(n / 1e5).toFixed(2)} L`;
  if (n >= 1e3) return `₹${(n / 1e3).toFixed(1)}K`;
  return fmtMoney(n);
};
const pcs = (n: number) => n.toLocaleString('en-IN');
const prettyDate = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
};

export const DashboardPage = () => {
  const user = useAuthStore((s) => s.user);
  const active = useAuthStore(activeMembership);
  const hideNames = useHideCustomerNames();
  const brandColor = useBranding((st) => st.brandColor);

  const [mode, setMode] = useState<DashMode>(readStoredMode);
  const pickMode = (m: DashMode) => { setMode(m); storeMode(m); };
  // brandColor is only the recompute trigger — dashVars reads the live
  // --brand-* off <html> so the Dashboard matches whatever the app applied.
  const vars = useMemo(() => dashVars(mode), [brandColor, mode]);

  /* One date range + one customer filter govern the whole dashboard. */
  const [from, setFrom] = useState(startOfMonthISO());
  const [to, setTo]     = useState(todayISO());
  const [customerId, setCustomerId] = useState('');
  const [empSearch, setEmpSearch] = useState('');
  const debouncedEmpSearch = useDebounced(empSearch);

  /* Drill-down links carry the dashboard's own filters, so the target page opens
     on exactly the slice the card counted rather than its own defaults. Cards
     whose figure is deliberately all-time (backlog, ready-to-dispatch, returns)
     pass no dates — filtering those by order date would contradict the number. */
  const drillQuery = (opts: { dates?: boolean } = {}) => {
    const q = new URLSearchParams();
    if (opts.dates !== false) { if (from) q.set('from', from); if (to) q.set('to', to); }
    if (customerId) q.set('customerId', customerId);
    const qs = q.toString();
    return qs ? `?${qs}` : '';
  };

  const activePreset = detectPreset(from, to);
  const resetRange = () => { setFrom(startOfMonthISO()); setTo(todayISO()); };

  const { data: customerList } = useQuery({
    queryKey: ['dashboard-customer-options', active?.companyId],
    queryFn: () => api<CustomerListResp>('/customers?pageSize=500'),
  });
  const customerOptions = [
    { value: '', label: 'All customers' },
    ...(customerList?.items ?? []).map((c) => ({
      value: c.id,
      label: hideNames ? c.customerCode : `${c.customerCode} · ${c.name}`,
    })),
  ];

  const qs = `from=${from}&to=${to}${customerId ? `&customerId=${customerId}` : ''}`;
  // A plant dashboard is left open on a screen, so it refreshes itself. Only
  // while the tab is actually in front — react-query does not poll a
  // backgrounded tab, which keeps idle browsers off the server.
  const live = { refetchInterval: 60_000 };

  const { data: stats, isLoading: loadingStats } = useQuery({
    queryKey: ['dashboard-stats', from, to, customerId, active?.companyId],
    queryFn: () => api<Stats>(`/dashboard/stats?${qs}`),
    ...live,
  });
  const { data: series } = useQuery({
    queryKey: ['dashboard-series', from, to, customerId, active?.companyId],
    queryFn: () => api<Series>(`/dashboard/series?${qs}`),
    ...live,
  });
  const { data: monthlyData } = useQuery({
    queryKey: ['dashboard-monthly', customerId, active?.companyId],
    queryFn: () => api<{ data: MonthlyPoint[] }>(`/dashboard/monthly${customerId ? `?customerId=${customerId}` : ''}`),
    ...live,
  });
  const { data: empData, isLoading: loadingEmps } = useQuery({
    queryKey: ['dashboard-employees', from, to, customerId, active?.companyId],
    queryFn: () => api<EmployeeResp>(`/dashboard/employees?${qs}`),
    ...live,
  });

  const empItems = (empData?.items ?? []).filter((row) =>
    !debouncedEmpSearch.trim() || row.labourName.toLowerCase().includes(debouncedEmpSearch.toLowerCase())
  );
  const empTotalWeight = empData?.totalWeight ?? 0;
  const topCustomerMax = Math.max(...(stats?.topCustomers ?? []).map((c) => c.amount), 1);
  const selectedCustomer = customerOptions.find((o) => o.value === customerId)?.label ?? 'All customers';

  return (
    // Full-bleed: the shell pads every page by 16/24px, which the mockup's
    // edge-to-edge ground has to cancel before painting its own.
    <div
      style={vars as React.CSSProperties}
      className="-m-4 min-h-[calc(100vh-4rem)] bg-[var(--d-bg)] p-3 text-[var(--d-text)] sm:-m-6 sm:p-4"
    >
      <div className="mx-auto flex max-w-[1700px] flex-col gap-2.5">

        {/* ── Header ─────────────────────────────────────────────── */}
        <header className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 flex-col gap-1">
            <DashLabel>{active?.companyName ?? 'Metflux'} operations</DashLabel>
            <div className="flex flex-wrap items-baseline gap-2.5">
              <h1 className="text-[20px] font-extrabold leading-none tracking-tight sm:text-[23px]">Plant snapshot</h1>
              <span className="text-[12px] text-[var(--d-muted)]">
                {user?.name ? `Welcome back, ${user.name.split(' ')[0]}` : ''}
                {active?.companyName ? ` · ${active.companyName}` : ''}
              </span>
            </div>
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <label className="flex min-w-0 flex-col gap-1.5">
              <DashLabel>Customer</DashLabel>
              <select
                value={customerId}
                onChange={(e) => setCustomerId(e.target.value)}
                className="h-8 min-w-[190px] rounded-[3px] border border-[var(--d-line)] bg-[var(--d-raised)] px-2 text-[12px] text-[var(--d-text)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--d-accent)]"
              >
                {customerOptions.map((o) => (
                  <option key={o.value} value={o.value} style={{ background: 'var(--d-panel)', color: 'var(--d-text)' }}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex flex-col gap-1.5">
              <DashLabel>Screen</DashLabel>
              <div className="inline-flex rounded-[3px] border border-[var(--d-line)] bg-[var(--d-raised)] p-0.5">
                <DashSeg active={mode === 'dark'} onClick={() => pickMode('dark')}>Dark</DashSeg>
                <DashSeg active={mode === 'light'} onClick={() => pickMode('light')}>Light</DashSeg>
              </div>
            </div>
          </div>
        </header>

        {/* ── Range bar ──────────────────────────────────────────── */}
        <DashPanel className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2">
          <DashLabel>Range</DashLabel>
          <div className="flex flex-wrap gap-1">
            {PRESETS.map((p) => (
              <DashSeg
                key={p.key}
                active={activePreset === p.key}
                onClick={() => { setFrom(p.from()); setTo(p.to()); }}
              >
                {p.label}
              </DashSeg>
            ))}
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-1.5">
            <input
              type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)}
              className="h-8 rounded-[3px] border border-[var(--d-line)] bg-[var(--d-raised)] px-2 text-[12px] text-[var(--d-text)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--d-accent)]"
            />
            <span className="text-[12px] text-[var(--d-muted)]">→</span>
            <input
              type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)}
              className="h-8 rounded-[3px] border border-[var(--d-line)] bg-[var(--d-raised)] px-2 text-[12px] text-[var(--d-text)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--d-accent)]"
            />
            <button
              type="button" onClick={resetRange} title="Reset to this month"
              className="h-8 rounded-[3px] border border-[var(--d-line)] px-2.5 text-[10.5px] font-extrabold uppercase tracking-[0.06em] text-[var(--d-muted)] hover:text-[var(--d-text)]"
            >
              Reset
            </button>
          </div>
        </DashPanel>

        {/* ── KPI row ────────────────────────────────────────────── */}
        {loadingStats && !stats ? (
          <DashPanel className="flex items-center justify-center gap-2 py-10 text-[var(--d-muted)]">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </DashPanel>
        ) : !stats ? null : (
          <section className="grid grid-cols-2 gap-2.5 lg:grid-cols-3 xl:grid-cols-5">
            <KpiCard
              label="Sales orders"
              figure={pcs(stats.salesOrders.pcs)}
              meta={`${stats.salesOrders.kg.toFixed(1)} kg · ${stats.salesOrders.customers} customers`}
              spark={series?.salesOrders}
              to={`/po/summary?status=ACTIVE${drillQuery().replace('?', '&')}`}
              title="Pcs from active Sales Orders created in the selected range. Opens SO Summary on the same slice."
              chips={<>
                <DashChip tone="accent">{fmtCompactMoney(stats.salesOrders.amount)}</DashChip>
                {stats.salesOrders.toroidalPcs > 0 && <DashChip tone="toro">Toro {pcs(stats.salesOrders.toroidalPcs)}</DashChip>}
                {stats.salesOrders.rectangularPcs > 0 && <DashChip tone="rect">Rect {pcs(stats.salesOrders.rectangularPcs)}</DashChip>}
              </>}
            />
            <KpiCard
              label="Pending production"
              figure={pcs(stats.pendingProduction.pcs)}
              meta={`${stats.pendingProduction.kg.toFixed(1)} kg not yet produced`}
              spark={series?.pendingProduction}
              to={`/po/summary${drillQuery({ dates: false })}`}
              title="Pcs not yet produced across ALL Sales Orders, regardless of date — the full current backlog. The trend shows pcs produced per day in the selected range."
              chips={<>
                <DashChip tone="warn">{fmtCompactMoney(stats.pendingProduction.amount)}</DashChip>
                <DashCaption>backlog, all dates</DashCaption>
              </>}
            />
            <KpiCard
              label="Ready to dispatch"
              figure={pcs(stats.readyDispatch.pcs)}
              meta={`${stats.readyDispatch.kg.toFixed(1)} kg produced, not shipped`}
              spark={series?.readyDispatch}
              to={`/po/summary?status=ACTIVE${drillQuery({ dates: false }).replace('?', '&')}`}
              title="Pcs produced but not yet dispatched across ALL Sales Orders — ready to ship now. The trend shows the daily net movement into that pile."
              chips={<>
                <DashChip tone="accent">{fmtCompactMoney(stats.readyDispatch.amount)}</DashChip>
                <DashCaption>in stock, all dates</DashCaption>
              </>}
            />
            <KpiCard
              label="Dispatched"
              figure={pcs(stats.dispatched.pcs)}
              meta={`${stats.dispatched.kg.toFixed(1)} kg shipped in range`}
              spark={series?.dispatched}
              to={`/dispatch${drillQuery()}`}
              title="Pcs dispatched within the selected date range. Opens the dispatch records on the same slice."
              chips={<>
                <DashChip tone="accent">{fmtCompactMoney(stats.dispatched.amount)}</DashChip>
                <DashCaption>{stats.dispatched.count} dispatch notes</DashCaption>
              </>}
            />
            <KpiCard
              label="Open returns"
              figure={String(stats.openReturns)}
              unit="requests"
              meta="Across all time, not date filtered"
              spark={series?.openReturns}
              to="/returns"
              title="Open return requests across all time — deliberately not filtered by the date range."
              chips={stats.openReturns
                ? <>
                    <DashChip tone="danger">Needs attention</DashChip>
                    {stats.overdueItems > 0 && <DashChip tone="warn">{stats.overdueItems} overdue</DashChip>}
                  </>
                : <DashChip tone="accent">All clear</DashChip>}
            />
          </section>
        )}

        {/* ── Monthly orders + Top customers ─────────────────────── */}
        <section className="grid grid-cols-1 gap-2.5 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
          <DashPanel className="min-w-0 p-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h2 className="text-[15px] font-extrabold tracking-tight">Monthly orders</h2>
                <DashCaption className="mt-0.5">Last 12 months · pcs ordered against order value</DashCaption>
              </div>
              {stats && (
                <div className="text-right">
                  <DashLabel>{monthlyData?.data.length ? monthShortLong(monthlyData.data[monthlyData.data.length - 1].month) : ''}</DashLabel>
                  <div className="mt-1 font-num text-[19px] font-extrabold leading-none tracking-tight tabular-nums">
                    {pcs(stats.salesOrders.pcs)} <span className="text-[12px] font-bold text-[var(--d-muted)]">pcs</span>
                  </div>
                  <div className="mt-0.5 text-[11.5px] font-bold tabular-nums text-[var(--d-accent)]">
                    {fmtCompactMoney(stats.salesOrders.amount)}
                  </div>
                </div>
              )}
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-3">
              <span className="flex items-center gap-1.5 text-[11.5px] text-[var(--d-muted)]">
                <span className="inline-block h-2.5 w-4 rounded-[2px]" style={{ backgroundColor: 'var(--d-accent)' }} /> Pcs ordered
              </span>
              <span className="flex items-center gap-1.5 text-[11.5px] text-[var(--d-muted)]">
                <span className="inline-block h-0.5 w-5 rounded" style={{ backgroundColor: 'var(--d-muted)' }} /> Order value
              </span>
            </div>
            {monthlyData ? <MonthlyChart data={monthlyData.data} /> : (
              <div className="py-16 text-center text-[12px] text-[var(--d-muted)]">Loading chart…</div>
            )}
          </DashPanel>

          <DashPanel className="flex min-w-0 flex-col p-3">
            <h2 className="text-[15px] font-extrabold tracking-tight">Top customers</h2>
            <DashCaption className="mt-0.5">By order value in range</DashCaption>
            {!stats?.topCustomers.length ? (
              <div className="py-10 text-center text-[12px] text-[var(--d-muted)]">No orders in this range.</div>
            ) : (
              <ol className="mt-2.5 flex max-h-[292px] flex-col gap-2 overflow-y-auto pr-1">
                {stats.topCustomers.map((c, i) => (
                  <li key={c.id} className="flex flex-col gap-1">
                    <div className="flex items-baseline gap-2">
                      <span className="w-3 shrink-0 text-right font-mono text-[11px] font-bold tabular-nums text-[var(--d-faint)]">{i + 1}</span>
                      <span className="font-mono text-[11.5px] font-bold text-[var(--d-accent)]">{c.customerCode ?? '—'}</span>
                      {!hideNames && <span className="min-w-0 flex-1 truncate text-[12.5px]">{c.name}</span>}
                      <span className="ml-auto shrink-0 text-[12.5px] font-bold tabular-nums">{fmtCompactMoney(c.amount)}</span>
                    </div>
                    <DashBar pct={(c.amount / topCustomerMax) * 100} />
                    <div className="flex flex-wrap items-center gap-1.5 pl-5">
                      <DashCaption>{pcs(c.pcs)} pcs · {c.kg.toFixed(1)} kg</DashCaption>
                      {c.toroidalPcs > 0 && <DashChip tone="toro">Toro {pcs(c.toroidalPcs)}</DashChip>}
                      {c.rectangularPcs > 0 && <DashChip tone="rect">Rect {pcs(c.rectangularPcs)}</DashChip>}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </DashPanel>
        </section>

        {/* ── Employee performance ───────────────────────────────── */}
        <DashPanel className="overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 p-3">
            <div>
              <h2 className="text-[15px] font-extrabold tracking-tight">Employee performance</h2>
              <DashCaption className="mt-0.5">Production entries in range, ranked by weight</DashCaption>
            </div>
            <input
              value={empSearch}
              onChange={(e) => setEmpSearch(e.target.value)}
              placeholder="Search worker"
              className="h-8 w-44 rounded-[3px] border border-[var(--d-line)] bg-[var(--d-raised)] px-2.5 text-[12px] text-[var(--d-text)] outline-none placeholder:text-[var(--d-faint)] focus-visible:ring-2 focus-visible:ring-[var(--d-accent)] sm:w-56"
            />
          </div>

          {loadingEmps && !empData ? (
            <div className="flex items-center justify-center gap-2 py-10 text-[var(--d-muted)]">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : !empItems.length ? (
            <div className="py-10 text-center text-[12.5px] text-[var(--d-muted)]">
              {empSearch.trim() ? 'No worker matches that search.' : 'No production records in this date range.'}
            </div>
          ) : (
            <>
              {/* Desktop table */}
              <div className="hidden overflow-x-auto md:block">
                <table className="w-full min-w-[820px] whitespace-nowrap text-[12.5px]">
                  <thead>
                    <tr className="border-y border-[var(--d-line)]">
                      <Th className="w-14 pl-4 text-center">Rank</Th>
                      <Th>Worker</Th>
                      <Th align="right">Total kg</Th>
                      <Th align="right">Pcs</Th>
                      <Th className="w-[200px]">Share of output</Th>
                      <Th align="right">Entries</Th>
                      <Th align="right">Sizes</Th>
                      <Th className="pr-4">Top size</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {empItems.map((row) => {
                      const share = empTotalWeight > 0 ? (row.totalWeight / empTotalWeight) * 100 : 0;
                      return (
                        <tr key={row.labourName} className="border-b border-[var(--d-line-soft)] last:border-b-0">
                          <td className="py-2 pl-4 text-center">
                            {row.rank === 1 ? (
                              <span className="inline-flex items-center gap-1 rounded-[3px] border px-1.5 py-[3px] text-[10.5px] font-bold"
                                style={{ backgroundColor: 'var(--d-accent-dim)', color: 'var(--d-accent)', borderColor: 'var(--d-accent-line)' }}>
                                <Trophy className="h-3 w-3" /> 1
                              </span>
                            ) : (
                              <span className="font-mono text-[11.5px] tabular-nums text-[var(--d-muted)]">{row.rank}</span>
                            )}
                          </td>
                          <td className="py-2 font-semibold">{row.labourName}</td>
                          <td className="py-2 pr-3 text-right font-mono font-bold tabular-nums">{row.totalWeight.toFixed(3)}</td>
                          <td className="py-2 pr-3 text-right font-mono tabular-nums text-[var(--d-muted)]">{pcs(row.pcs)}</td>
                          <td className="py-2 pr-4">
                            <div className="flex items-center gap-2">
                              <span className="min-w-0 flex-1"><DashBar pct={share} /></span>
                              <span className="w-11 shrink-0 text-right font-mono text-[11px] tabular-nums text-[var(--d-muted)]">{share.toFixed(1)}%</span>
                            </div>
                          </td>
                          <td className="py-2 pr-3 text-right font-mono tabular-nums text-[var(--d-muted)]">{row.entries}</td>
                          <td className="py-2 pr-3 text-right font-mono tabular-nums text-[var(--d-muted)]">{row.distinctSizes}</td>
                          <td className="py-2 pr-4 font-mono text-[11.5px] tabular-nums text-[var(--d-muted)]">
                            {row.topSize ? `${row.topSize} (${pcs(row.topSizePcs)})` : '—'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-[var(--d-line)]">
                      <td colSpan={2} className="py-2 pl-4"><DashLabel>Total</DashLabel></td>
                      <td className="py-2 pr-3 text-right font-mono font-bold tabular-nums">{empTotalWeight.toFixed(3)}</td>
                      <td className="py-2 pr-3 text-right font-mono font-bold tabular-nums">{pcs(empData?.totalPcs ?? 0)}</td>
                      <td colSpan={4} />
                    </tr>
                  </tfoot>
                </table>
              </div>

              {/* Phone cards */}
              <div className="md:hidden">
                {empItems.map((row) => {
                  const share = empTotalWeight > 0 ? (row.totalWeight / empTotalWeight) * 100 : 0;
                  return (
                    <div key={row.labourName} className="border-t border-[var(--d-line-soft)] px-3 py-2.5">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="font-mono text-[11px] tabular-nums text-[var(--d-faint)]">#{row.rank}</span>
                          <span className="truncate text-[13px] font-semibold">{row.labourName}</span>
                        </div>
                        <div className="shrink-0 text-right">
                          <div className="font-mono text-[13px] font-bold tabular-nums">{row.totalWeight.toFixed(3)} kg</div>
                          <div className="font-mono text-[10.5px] tabular-nums text-[var(--d-muted)]">{pcs(row.pcs)} pcs</div>
                        </div>
                      </div>
                      <div className="mt-1.5 flex items-center gap-2">
                        <span className="min-w-0 flex-1"><DashBar pct={share} /></span>
                        <span className="font-mono text-[10.5px] tabular-nums text-[var(--d-muted)]">{share.toFixed(1)}%</span>
                      </div>
                      {row.sizes.length > 0 && (
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {row.sizes.slice(0, 4).map((s) => (
                            <DashChip key={s.measure}>{s.measure} ×{pcs(s.pcs)}</DashChip>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
                <div className="flex justify-between border-t border-[var(--d-line)] px-3 py-2">
                  <DashLabel>Total</DashLabel>
                  <span className="font-mono text-[12px] font-bold tabular-nums">
                    {pcs(empData?.totalPcs ?? 0)} pcs · {empTotalWeight.toFixed(3)} kg
                  </span>
                </div>
              </div>
            </>
          )}
        </DashPanel>

        {/* ── Footer ─────────────────────────────────────────────── */}
        <div className="flex flex-wrap items-center justify-between gap-2 pb-1 text-[11px] text-[var(--d-faint)]">
          <span>{prettyDate(from)} – {prettyDate(to)} · {selectedCustomer}</span>
          <span>Live · figures refresh every 60 s</span>
        </div>
      </div>
    </div>
  );
};

const monthShortLong = (m: string) => {
  const [y, mo] = m.split('-');
  return new Date(+y, +mo - 1, 1).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }).toUpperCase();
};

const Th = ({ children, align = 'left', className }: {
  children?: React.ReactNode; align?: 'left' | 'right'; className?: string;
}) => (
  <th className={cn('py-2 pr-3 font-extrabold uppercase', align === 'right' && 'text-right', className)}>
    <span className="text-[10px] tracking-[0.11em] text-[var(--d-muted)]">{children}</span>
  </th>
);

/** One KPI tile. The whole card is the drill-down link it always was; `title`
 *  carries the explanation the old info tooltip held. */
const KpiCard = ({ label, figure, unit = 'pcs', meta, spark, chips, to, title }: {
  label: string; figure: string; unit?: string; meta: string;
  spark?: number[]; chips: React.ReactNode; to: string; title: string;
}) => (
  <Link
    to={to}
    title={title}
    className="group flex cursor-pointer flex-col gap-1 rounded-lg border border-[var(--d-line)] bg-[var(--d-panel)] px-3 py-2.5 shadow-sm transition-colors duration-200 hover:border-[var(--d-accent-line)] hover:bg-[var(--d-raised)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--d-accent)] motion-reduce:transition-none"
  >
    <DashLabel>{label}</DashLabel>
    <div className="flex items-baseline gap-1.5">
      <span className="font-num text-[26px] font-extrabold leading-none tracking-tight tabular-nums">{figure}</span>
      <span className="text-[11px] text-[var(--d-muted)]">{unit}</span>
    </div>
    <DashCaption className="truncate">{meta}</DashCaption>
    {spark && spark.length > 1 && <Sparkline values={spark} />}
    <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-1">{chips}</div>
  </Link>
);

/* ── Monthly orders chart ──────────────────────────────────────────
   Same responsive SVG as before — measured container, 1 unit = 1px, hover
   tooltip, thinned month labels on narrow screens. Only the palette moved onto
   the dashboard's CSS variables so it reads correctly in both modes. */
const MonthlyChart = ({ data }: { data: MonthlyPoint[] }) => {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [vw, setVw] = useState(900);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w) setVw(Math.max(320, Math.round(w)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  if (!data.length) return null;

  const narrow = vw < 480;
  const VW = vw, VH = narrow ? 178 : 208;
  const PL = narrow ? 32 : 46, PR = narrow ? 38 : 56, PT = 10, PB = narrow ? 26 : 28;
  const IW = VW - PL - PR;
  const IH = VH - PT - PB;

  const maxPcs = Math.max(...data.map((d) => d.totalPcs), 1);
  const maxAmt = Math.max(...data.map((d) => d.totalAmount), 1);
  const N = data.length;
  const slotW = IW / N;
  const barW = Math.max(slotW * 0.52, 6);

  const xc = (i: number) => PL + i * slotW + slotW / 2;
  const xb = (i: number) => PL + i * slotW + (slotW - barW) / 2;
  const yp = (v: number) => PT + IH * (1 - v / maxPcs);
  const ya = (v: number) => PT + IH * (1 - v / maxAmt);

  const linePath = data.map((d, i) => `${i === 0 ? 'M' : 'L'}${xc(i).toFixed(1)},${ya(d.totalAmount).toFixed(1)}`).join(' ');
  const areaPath = [
    ...data.map((d, i) => `${i === 0 ? 'M' : 'L'}${xc(i).toFixed(1)},${ya(d.totalAmount).toFixed(1)}`),
    `L${xc(N - 1).toFixed(1)},${(PT + IH).toFixed(1)}`,
    `L${xc(0).toFixed(1)},${(PT + IH).toFixed(1)}`,
    'Z',
  ].join(' ');

  const fmtN = (v: number) => (v === 0 ? '0' : v >= 1000 ? `${+(v / 1000).toFixed(1)}k` : String(Math.round(v)));
  const fmtA = (v: number) =>
    v === 0 ? '0'
      : v >= 1e7 ? `₹${(v / 1e7).toFixed(1)}Cr`
      : v >= 1e5 ? `₹${(v / 1e5).toFixed(1)}L`
      : v >= 1e3 ? `₹${(v / 1e3).toFixed(0)}k`
      : `₹${v}`;

  const monthShort = (m: string) => {
    const [y, mo] = m.split('-');
    return new Date(+y, +mo - 1, 1).toLocaleDateString('en-GB', { month: 'short' });
  };

  const ticks = [0.25, 0.5, 0.75, 1];
  const hovered = hoverIdx !== null ? data[hoverIdx] : null;
  const tipX = hoverIdx !== null ? Math.max(66, Math.min(VW - 66, xc(hoverIdx))) : 0;

  return (
    <div ref={wrapRef} className="mt-1 w-full">
      <svg viewBox={`0 0 ${VW} ${VH}`} width="100%" height={VH} className="block select-none">
        <defs>
          <linearGradient id="dashAmtGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--d-muted)" stopOpacity="0.16" />
            <stop offset="100%" stopColor="var(--d-muted)" stopOpacity="0" />
          </linearGradient>
        </defs>

        {ticks.map((f) => (
          <line key={f} x1={PL} y1={PT + IH * (1 - f)} x2={PL + IW} y2={PT + IH * (1 - f)}
            stroke="var(--d-grid)" strokeWidth="0.5" />
        ))}
        <line x1={PL} y1={PT + IH} x2={PL + IW} y2={PT + IH} stroke="var(--d-line)" strokeWidth="1" />
        <line x1={PL} y1={PT} x2={PL} y2={PT + IH} stroke="var(--d-line)" strokeWidth="1" />

        {data.map((d, i) => (
          <rect key={i}
            x={xb(i).toFixed(1)} y={yp(d.totalPcs).toFixed(1)}
            width={barW} height={Math.max(1, PT + IH - yp(d.totalPcs))}
            fill="var(--d-accent)" opacity={hoverIdx === i ? 1 : 0.82}
            rx="3" style={{ transition: 'opacity 0.15s' }}
          />
        ))}

        <path d={areaPath} fill="url(#dashAmtGrad)" />
        <path d={linePath} fill="none" stroke="var(--d-muted)" strokeWidth="1.6" strokeLinejoin="round" />
        {data.map((d, i) => (
          <circle key={i} cx={xc(i).toFixed(1)} cy={ya(d.totalAmount).toFixed(1)} r={hoverIdx === i ? 3.4 : 2.4}
            fill="var(--d-text)" style={{ transition: 'r 0.1s' }} />
        ))}

        {data.map((_, i) => (
          <rect key={`hz${i}`} x={PL + i * slotW} y={PT} width={slotW} height={IH} fill="transparent"
            onMouseEnter={() => setHoverIdx(i)} onMouseLeave={() => setHoverIdx(null)} />
        ))}

        {data.map((d, i) => {
          if (slotW < 30 && i % 2 !== 0) return null;
          return (
            <text key={i} x={xc(i).toFixed(1)} y={VH - 8} textAnchor="middle" fontSize="10" fill="var(--d-faint)">
              {monthShort(d.month)}
            </text>
          );
        })}

        {[0, ...ticks].map((f, j) => (
          <text key={j} x={PL - 6} y={(PT + IH * (1 - f) + 4).toFixed(1)} textAnchor="end" fontSize="9" fill="var(--d-faint)">
            {fmtN(maxPcs * f)}
          </text>
        ))}
        {[0, ...ticks].map((f, j) => (
          <text key={j} x={PL + IW + 6} y={(PT + IH * (1 - f) + 4).toFixed(1)} textAnchor="start" fontSize="9" fill="var(--d-faint)">
            {fmtA(maxAmt * f)}
          </text>
        ))}

        {hovered && (
          <g>
            <line x1={tipX} y1={PT} x2={tipX} y2={PT + IH} stroke="var(--d-muted)" strokeWidth="1" strokeDasharray="3,2" />
            <rect x={tipX - 62} y={PT} width={124} height={40} rx="4" fill="var(--d-raised)" stroke="var(--d-line)" />
            <text x={tipX} y={PT + 15} textAnchor="middle" fontSize="10.5" fill="var(--d-text)" fontWeight="700">
              {monthShort(hovered.month)}: {hovered.totalPcs.toLocaleString('en-IN')} pcs
            </text>
            <text x={tipX} y={PT + 29} textAnchor="middle" fontSize="10" fill="var(--d-accent)">
              ₹{hovered.totalAmount.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
              {hovered.orderCount > 0 && ` · ${hovered.orderCount} SO`}
            </text>
          </g>
        )}
      </svg>
    </div>
  );
};
