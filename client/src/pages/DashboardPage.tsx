// Dashboard — KPIs + employee performance table.
// Mobile-first: KPI cards stack 2-up on phones, tables become cards.
import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Factory, Truck, Package, RotateCcw, FileText, Users2, Trophy, Loader2,
  CalendarRange, RotateCw, User, TrendingUp,
} from 'lucide-react';
import { useAuthStore, activeMembership, useHideCustomerNames } from '@/store/auth';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { SearchableSelect } from '@/components/SearchableSelect';

type MonthlyPoint = {
  month: string;        // 'YYYY-MM'
  totalPcs: number;
  totalAmount: number;
  orderCount: number;
};

type Stats = {
  range:             { from: string; to: string };
  salesOrders:       { count: number; pcs: number; kg: number; customers: number; amount: number; toroidalPcs: number; rectangularPcs: number };
  pendingProduction: { pcs: number; kg: number; amount: number };
  readyDispatch:     { pcs: number; kg: number; amount: number };
  dispatched:        { count: number; pcs: number; kg: number; amount: number };
  openReturns:       number;
  overdueItems:      number;
  topCustomers:      {
    id: string;
    name: string;
    customerCode: string | null;
    amount: number;
    pcs: number;
    kg: number;
    toroidalPcs: number;
    rectangularPcs: number;
  }[];
};

type CustomerListResp = { items: { id: string; name: string; customerCode: string }[] };

type EmployeeRow = {
  rank: number;
  labourName: string;
  pcs: number;
  totalWeight: number;
  entries: number;
  distinctSizes: number;
  topSize: string | null;
  topSizePcs: number;
  sizes: { measure: string; pcs: number }[];
};
type EmployeeResp = {
  from: string; to: string;
  items: EmployeeRow[];
  totalPcs: number; totalWeight: number;
};

const toISO = (d: Date) => {
  const off = d.getTimezoneOffset() * 60_000;
  return new Date(d.getTime() - off).toISOString().slice(0, 10);
};
const todayISO = () => toISO(new Date());
const startOfMonthISO = () => {
  const d = new Date();
  return toISO(new Date(d.getFullYear(), d.getMonth(), 1));
};
const startOfYearISO = () => {
  const d = new Date();
  return toISO(new Date(d.getFullYear(), 0, 1));
};
const daysAgoISO = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return toISO(d);
};
const startOfWeekISO = () => {
  const d = new Date();
  const day = (d.getDay() + 6) % 7;     // Mon=0
  d.setDate(d.getDate() - day);
  return toISO(d);
};

type Preset = 'today' | 'week' | 'month' | 'last30' | 'ytd';
const PRESETS: { key: Preset; label: string; from: () => string; to: () => string }[] = [
  { key: 'today',  label: 'Today',        from: todayISO,         to: todayISO },
  { key: 'week',   label: 'This week',    from: startOfWeekISO,   to: todayISO },
  { key: 'month',  label: 'This month',   from: startOfMonthISO,  to: todayISO },
  { key: 'last30', label: 'Last 30 days', from: () => daysAgoISO(29), to: todayISO },
  { key: 'ytd',    label: 'YTD',          from: startOfYearISO,   to: todayISO },
];
const detectPreset = (from: string, to: string): Preset | null => {
  for (const p of PRESETS) if (p.from() === from && p.to() === to) return p.key;
  return null;
};


const fmtMoney = (n: number) =>
  '₹' + n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtCompactMoney = (n: number) => {
  if (n >= 1e7) return `₹${(n / 1e7).toFixed(2)} Cr`;
  if (n >= 1e5) return `₹${(n / 1e5).toFixed(2)} L`;
  if (n >= 1e3) return `₹${(n / 1e3).toFixed(1)}K`;
  return fmtMoney(n);
};

export const DashboardPage = () => {
  const user = useAuthStore((s) => s.user);
  const active = useAuthStore(activeMembership);
  const hideNames = useHideCustomerNames();

  /* One date range + one customer filter govern the whole dashboard. */
  const [from, setFrom] = useState(startOfMonthISO());
  const [to, setTo]     = useState(todayISO());
  const [customerId, setCustomerId] = useState('');
  const [empSearch, setEmpSearch] = useState('');

  const activePreset = detectPreset(from, to);
  const applyPreset = (p: typeof PRESETS[number]) => {
    setFrom(p.from());
    setTo(p.to());
  };
  const resetRange = () => {
    setFrom(startOfMonthISO());
    setTo(todayISO());
  };

  /* Customer options for the filter — full list, cheap at this scale. */
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

  const { data: stats, isLoading: loadingStats } = useQuery({
    queryKey: ['dashboard-stats', from, to, customerId, active?.companyId],
    queryFn: () => api<Stats>(`/dashboard/stats?${qs}`),
  });

  const { data: monthlyData } = useQuery({
    queryKey: ['dashboard-monthly', customerId, active?.companyId],
    queryFn: () => api<{ data: MonthlyPoint[] }>(`/dashboard/monthly${customerId ? `?customerId=${customerId}` : ''}`),
  });

  const { data: empData, isLoading: loadingEmps } = useQuery({
    queryKey: ['dashboard-employees', from, to, customerId, active?.companyId],
    queryFn: () => api<EmployeeResp>(`/dashboard/employees?${qs}`),
  });

  const empItems = (empData?.items ?? []).filter((row) =>
    !empSearch.trim() || row.labourName.toLowerCase().includes(empSearch.toLowerCase())
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight">
            Welcome back, {user?.name?.split(' ')[0]}
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {active?.companyName ? `Snapshot for ${active.companyName}.` : 'Pick a company to see its dashboard.'}
          </p>
        </div>

        <div className="sm:w-72">
          <label className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
            <User className="h-3.5 w-3.5" /> Customer
          </label>
          <div className="mt-1">
            <SearchableSelect
              value={customerId}
              onChange={setCustomerId}
              options={customerOptions}
              placeholder="All customers"
              dense
            />
          </div>
        </div>
      </div>

      <DateRangeFilter
        from={from} to={to}
        onFrom={setFrom} onTo={setTo}
        activePreset={activePreset}
        onApplyPreset={applyPreset}
        onReset={resetRange}
      />

      {/* ── KPI cards ── */}
      <section>
        <h2 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
          <span className="inline-block h-3.5 w-1 rounded-sm bg-brand-400" />
          Key metrics
        </h2>
        {loadingStats ? (
          <div className="card flex items-center justify-center gap-2 py-8 text-slate-400">
            <Loader2 className="h-5 w-5 animate-spin" /> Loading…
          </div>
        ) : !stats ? null : (
          <div className="grid grid-cols-2 gap-2.5 sm:gap-3 md:grid-cols-3 lg:grid-cols-5">
            <KpiCard
              icon={FileText} accent="brand"
              label="Sales orders"
              primary={`${stats.salesOrders.pcs.toLocaleString('en-IN')} pcs`}
              meta={`${stats.salesOrders.kg.toFixed(1)} kg · ${stats.salesOrders.customers} cust.`}
              amount={fmtCompactMoney(stats.salesOrders.amount)}
              split={{ toroidal: stats.salesOrders.toroidalPcs, rectangular: stats.salesOrders.rectangularPcs }}
              info="Pcs from active Sales Orders created within the selected date range. Use the date filter above to change the period."
            />
            <KpiCard
              icon={Factory} accent="amber"
              label="Pending production"
              primary={`${stats.pendingProduction.pcs.toLocaleString('en-IN')} pcs`}
              meta={`${stats.pendingProduction.kg.toFixed(1)} kg`}
              amount={fmtCompactMoney(stats.pendingProduction.amount)}
              info="Total pcs not yet produced — across ALL Sales Orders regardless of date. This is your current full production backlog."
            />
            <KpiCard
              icon={Package} accent="blue"
              label="Ready to dispatch"
              primary={`${stats.readyDispatch.pcs.toLocaleString('en-IN')} pcs`}
              meta={`${stats.readyDispatch.kg.toFixed(1)} kg`}
              amount={fmtCompactMoney(stats.readyDispatch.amount)}
              info="Pcs produced but not yet dispatched — across ALL Sales Orders regardless of date. These are ready to ship right now."
            />
            <KpiCard
              icon={Truck} accent="indigo"
              label="Dispatched"
              primary={`${stats.dispatched.pcs.toLocaleString('en-IN')} pcs`}
              meta={`${stats.dispatched.kg.toFixed(1)} kg`}
              amount={fmtCompactMoney(stats.dispatched.amount)}
              info="Pcs dispatched within the selected date range. Use the date filter above to change the period."
            />
            <KpiCard
              icon={RotateCcw} accent={stats.openReturns ? 'rose' : 'slate'}
              label="Open returns"
              primary={String(stats.openReturns)}
              status={stats.openReturns ? 'Need attention' : 'All clear'}
              statusTone={stats.openReturns ? 'warn' : 'ok'}
              info="Total open return requests — across all time, not filtered by date."
            />
          </div>
        )}
      </section>

      {/* ── Top customers ── */}
      {stats && stats.topCustomers.length > 0 && (
        <section>
          <h2 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            <span className="inline-block h-3.5 w-1 rounded-sm bg-amber-400" />
            Top customers
          </h2>
          <div className="card divide-y divide-slate-100">
            {stats.topCustomers.map((c, i) => (
              <div key={c.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                <div className={cn(
                  'grid h-6 w-6 place-items-center rounded-full text-[11px] font-bold shrink-0',
                  i === 0 ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-600'
                )}>
                  {i + 1}
                </div>
                <div className="min-w-0 flex-1 truncate text-sm font-medium text-slate-900">
                  {hideNames
                    ? <span className="font-mono text-brand-700">{c.customerCode ?? '—'}</span>
                    : c.name}
                </div>
                <div className="text-xs tabular-nums text-slate-600">
                  {c.pcs.toLocaleString('en-IN')} pcs · {c.kg.toFixed(1)} kg
                </div>
                <div className="flex items-center gap-1">
                  {c.toroidalPcs > 0 && (
                    <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-emerald-700 ring-1 ring-emerald-100">
                      Toro {c.toroidalPcs.toLocaleString('en-IN')}
                    </span>
                  )}
                  {c.rectangularPcs > 0 && (
                    <span className="rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-blue-700 ring-1 ring-blue-100">
                      Rect {c.rectangularPcs.toLocaleString('en-IN')}
                    </span>
                  )}
                </div>
                <div className="text-xs font-semibold tabular-nums text-slate-800">{fmtCompactMoney(c.amount)}</div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── Monthly chart ── */}
      {monthlyData && (
        <section>
          <h2 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            <span className="inline-block h-3.5 w-1 rounded-sm bg-indigo-400" />
            <TrendingUp className="h-3.5 w-3.5 text-indigo-500" />
            Monthly orders — last 12 months
          </h2>
          <div className="card p-3 sm:p-4">
            <div className="mb-3 flex flex-wrap items-center gap-4 text-xs text-slate-600">
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-3 w-5 rounded-sm bg-indigo-400/80" />
                Pcs ordered
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-0.5 w-5 rounded bg-emerald-500" />
                Order amount (₹)
              </span>
            </div>
            <MonthlyChart data={monthlyData.data} />
          </div>
        </section>
      )}

      {/* ── Employee performance ── */}
      <section>
        <div className="mb-2 flex items-center justify-between gap-3">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500 flex items-center gap-2">
            <span className="inline-block h-3.5 w-1 rounded-sm bg-indigo-400" />
            <Users2 className="h-3.5 w-3.5 text-indigo-500" /> Employee performance
          </h2>
          <input
            className="input h-8 text-xs py-1 w-48 sm:w-56"
            placeholder="Search worker…"
            value={empSearch}
            onChange={(e) => setEmpSearch(e.target.value)}
          />
        </div>

        <div className="card overflow-hidden">
          {loadingEmps ? (
            <div className="flex items-center justify-center gap-2 py-10 text-slate-400">
              <Loader2 className="h-5 w-5 animate-spin" /> Loading…
            </div>
          ) : !empItems.length ? (
            <div className="py-10 text-center text-slate-400 text-sm">
              No production records in this date range.
            </div>
          ) : (
            <>
              {/* Desktop / tablet — table */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-sm whitespace-nowrap">
                  <thead className="bg-indigo-50/60 text-left text-xs font-semibold uppercase tracking-wide text-indigo-700/80">
                    <tr>
                      <th className="px-4 py-3 w-12 text-center">Rank</th>
                      <th className="px-4 py-3">Worker</th>
                      <th className="px-4 py-3 text-right">Pcs</th>
                      <th className="px-4 py-3 text-right">Total Kg</th>
                      <th className="px-4 py-3 text-right">Entries</th>
                      <th className="px-4 py-3 text-right">Distinct sizes</th>
                      <th className="px-4 py-3">Top size</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {empItems.map((row) => (
                      <tr key={row.labourName} className="hover:bg-slate-50">
                        <td className="px-4 py-3 text-center">
                          {row.rank === 1 ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
                              <Trophy className="h-3 w-3" /> 1
                            </span>
                          ) : (
                            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
                              {row.rank}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 font-medium">{row.labourName}</td>
                        <td className="px-4 py-3 text-right tabular-nums font-semibold">{row.pcs.toLocaleString('en-IN')}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-slate-700">{row.totalWeight.toFixed(3)}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-slate-500">{row.entries}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-slate-500">{row.distinctSizes}</td>
                        <td className="px-4 py-3 text-xs tabular-nums text-slate-600">
                          {row.topSize ? `${row.topSize} (${row.topSizePcs})` : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-slate-100 text-xs font-semibold tabular-nums">
                      <td colSpan={2} className="px-4 py-2 text-right uppercase tracking-wide text-slate-500">Total</td>
                      <td className="px-4 py-2 text-right">{empData?.totalPcs.toLocaleString('en-IN')}</td>
                      <td className="px-4 py-2 text-right">{empData?.totalWeight.toFixed(3)}</td>
                      <td colSpan={3}></td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              {/* Mobile — cards */}
              <div className="md:hidden divide-y divide-slate-100">
                {empItems.map((row) => (
                  <div key={row.labourName} className="px-4 py-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        {row.rank === 1 ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700 shrink-0">
                            <Trophy className="h-3 w-3" /> 1
                          </span>
                        ) : (
                          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600 shrink-0">
                            #{row.rank}
                          </span>
                        )}
                        <span className="font-semibold text-sm text-slate-900 truncate">{row.labourName}</span>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="tabular-nums font-semibold text-sm">{row.pcs.toLocaleString('en-IN')} pcs</div>
                        <div className="text-[10px] text-slate-500 tabular-nums">{row.totalWeight.toFixed(3)} kg</div>
                      </div>
                    </div>
                    {row.topSize && (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {row.sizes.slice(0, 4).map((s) => (
                          <span key={s.measure} className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] tabular-nums text-slate-700">
                            {s.measure} <span className="text-slate-500">×{s.pcs}</span>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
                <div className="bg-slate-50 px-4 py-2 text-xs font-semibold text-slate-600 flex justify-between">
                  <span>Total</span>
                  <span className="tabular-nums">
                    {empData?.totalPcs.toLocaleString('en-IN')} pcs · {empData?.totalWeight.toFixed(3)} kg
                  </span>
                </div>
              </div>
            </>
          )}
        </div>
      </section>
    </div>
  );
};

const DateRangeFilter = ({
  from, to, onFrom, onTo, activePreset, onApplyPreset, onReset,
}: {
  from: string;
  to: string;
  onFrom: (v: string) => void;
  onTo: (v: string) => void;
  activePreset: Preset | null;
  onApplyPreset: (p: typeof PRESETS[number]) => void;
  onReset: () => void;
}) => (
  <div className="card flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2">
    <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
      <CalendarRange className="h-3.5 w-3.5" /> Range
    </div>
    <div className="flex flex-wrap gap-1">
      {PRESETS.map((p) => (
        <button
          key={p.key}
          type="button"
          onClick={() => onApplyPreset(p)}
          className={cn(
            'rounded-md px-2 py-1 text-[11px] font-medium ring-1 transition',
            activePreset === p.key
              ? 'bg-brand-50 text-brand-700 ring-brand-200'
              : 'bg-white text-slate-600 ring-slate-200 hover:bg-slate-50',
          )}
        >
          {p.label}
        </button>
      ))}
    </div>
    <div className="ml-auto flex items-center gap-2">
      <input
        className="input h-8 text-xs py-1 w-[140px]"
        type="date"
        value={from}
        max={to}
        onChange={(e) => onFrom(e.target.value)}
      />
      <span className="text-slate-400 text-xs">→</span>
      <input
        className="input h-8 text-xs py-1 w-[140px]"
        type="date"
        value={to}
        min={from}
        onChange={(e) => onTo(e.target.value)}
      />
      <button
        type="button"
        onClick={onReset}
        title="Reset to this month"
        className="inline-flex items-center gap-1 rounded-md bg-white px-2 py-1 text-[11px] font-medium text-slate-500 ring-1 ring-slate-200 hover:bg-slate-50"
      >
        <RotateCw className="h-3 w-3" /> Reset
      </button>
    </div>
  </div>
);

const ACCENTS = {
  brand:   'bg-brand-50 text-brand-700 ring-brand-100',
  emerald: 'bg-emerald-50 text-emerald-700 ring-emerald-100',
  amber:   'bg-amber-50 text-amber-700 ring-amber-100',
  blue:    'bg-blue-50 text-blue-700 ring-blue-100',
  indigo:  'bg-indigo-50 text-indigo-700 ring-indigo-100',
  rose:    'bg-rose-50 text-rose-700 ring-rose-100',
  slate:   'bg-slate-100 text-slate-600 ring-slate-200',
};

/** Stronger colour for the 3-px stripe at the top of each KPI card. */
const TOP_BARS = {
  brand:   'bg-brand-400',
  emerald: 'bg-emerald-400',
  amber:   'bg-amber-400',
  blue:    'bg-blue-400',
  indigo:  'bg-indigo-400',
  rose:    'bg-rose-400',
  slate:   'bg-slate-300',
};

const STATUS_TONES = {
  ok:   'bg-emerald-50 text-emerald-700 ring-emerald-100',
  warn: 'bg-rose-50 text-rose-700 ring-rose-100',
};

/* ── InfoTip — hoverable (i) button with a viewport-safe tooltip ──
   The tooltip uses fixed positioning + measurement so it never gets clipped
   by a card's edge and never runs off the right side of the screen (the
   right-most KPI card would otherwise overflow the viewport). */
const InfoTip = ({ text }: { text: string }) => {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; arrow: number } | null>(null);

  useEffect(() => {
    if (!open || !btnRef.current) { setPos(null); return; }
    const W = 240, M = 8;   // tooltip width (w-60) + viewport margin
    const r = btnRef.current.getBoundingClientRect();
    const center = r.left + r.width / 2;
    const left = Math.max(M, Math.min(center - W / 2, window.innerWidth - M - W));
    setPos({ top: r.bottom + 8, left, arrow: center - left });
  }, [open]);

  return (
    <div className="inline-flex shrink-0" style={{ lineHeight: 0 }}>
      <button
        ref={btnRef}
        type="button"
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex h-[14px] w-[14px] items-center justify-center rounded-full bg-slate-200 text-slate-500 hover:bg-slate-300 text-[9px] font-bold leading-none transition"
      >
        i
      </button>
      {open && pos && (
        <div
          className="fixed z-50 w-60 rounded-lg bg-slate-800 text-white text-[11px] px-3 py-2 shadow-xl leading-snug pointer-events-none"
          style={{ top: pos.top, left: pos.left }}
        >
          {text}
          <div
            className="absolute bottom-full border-[5px] border-transparent border-b-slate-800"
            style={{ left: pos.arrow - 5 }}
          />
        </div>
      )}
    </div>
  );
};

const KpiCard = ({
  icon: Icon, label, primary, amount, meta, status, statusTone = 'ok', accent = 'slate', info, split,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  primary: string;
  amount?: string;
  meta?: string;
  status?: string;
  statusTone?: keyof typeof STATUS_TONES;
  accent?: keyof typeof ACCENTS;
  /** Tooltip text for the (i) button. */
  info?: string;
  /** Toroidal / Rectangular pcs breakdown shown as small tags. */
  split?: { toroidal: number; rectangular: number };
}) => (
  <div className="card relative flex flex-col p-3 pt-3.5">
    <span className={cn('absolute inset-x-0 top-0 h-1 rounded-t-xl', TOP_BARS[accent])} />
    <div className="flex items-center gap-2">
      <div className={cn('grid h-7 w-7 place-items-center rounded-md ring-1 shrink-0', ACCENTS[accent])}>
        <Icon className="h-3.5 w-3.5" />
      </div>
      <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 truncate flex-1 min-w-0">
        {label}
      </div>
      {info && <InfoTip text={info} />}
    </div>
    <div className="mt-1.5 text-lg font-bold tracking-tight text-slate-900 tabular-nums leading-tight">
      {primary}
    </div>
    {split && (split.toroidal > 0 || split.rectangular > 0) && (
      <div className="mt-1 flex items-center gap-1.5 flex-wrap">
        {split.toroidal > 0 && (
          <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[9px] font-semibold tabular-nums text-amber-700 ring-1 ring-amber-100">
            Toro {split.toroidal.toLocaleString('en-IN')}
          </span>
        )}
        {split.rectangular > 0 && (
          <span className="rounded bg-rose-50 px-1.5 py-0.5 text-[9px] font-semibold tabular-nums text-rose-700 ring-1 ring-rose-100">
            Rect {split.rectangular.toLocaleString('en-IN')}
          </span>
        )}
      </div>
    )}
    <div className="mt-2 flex items-center gap-1.5 flex-wrap">
      {amount && (
        <span className={cn(
          'inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-semibold tabular-nums ring-1',
          ACCENTS[accent],
        )}>
          {amount}
        </span>
      )}
      {!amount && status && (
        <span className={cn(
          'inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-semibold ring-1',
          STATUS_TONES[statusTone],
        )}>
          {status}
        </span>
      )}
      {meta && <span className="text-[10px] text-slate-500 tabular-nums">{meta}</span>}
    </div>
  </div>
);

/* ── MonthlyChart — pure SVG bar + line chart ── */
const MonthlyChart = ({ data }: { data: MonthlyPoint[] }) => {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [vw, setVw] = useState(900);

  // Measure the container so the SVG fills its full width at 1 unit = 1px
  // (no letterboxing) and grows with the screen instead of staying small.
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

  const VW = vw, VH = 260;
  const PL = 52, PR = 62, PT = 18, PB = 38;
  const IW = VW - PL - PR;
  const IH = VH - PT - PB;

  const maxPcs = Math.max(...data.map((d) => d.totalPcs), 1);
  const maxAmt = Math.max(...data.map((d) => d.totalAmount), 1);
  const N      = data.length;
  const slotW  = IW / N;
  const barW   = Math.max(slotW * 0.52, 6);

  const xc  = (i: number) => PL + i * slotW + slotW / 2;
  const xb  = (i: number) => PL + i * slotW + (slotW - barW) / 2;
  const yp  = (v: number) => PT + IH * (1 - v / maxPcs);
  const ya  = (v: number) => PT + IH * (1 - v / maxAmt);

  const linePath = data
    .map((d, i) => `${i === 0 ? 'M' : 'L'}${xc(i).toFixed(1)},${ya(d.totalAmount).toFixed(1)}`)
    .join(' ');

  const areaPath = [
    ...data.map((d, i) => `${i === 0 ? 'M' : 'L'}${xc(i).toFixed(1)},${ya(d.totalAmount).toFixed(1)}`),
    `L${xc(N - 1).toFixed(1)},${(PT + IH).toFixed(1)}`,
    `L${xc(0).toFixed(1)},${(PT + IH).toFixed(1)}`,
    'Z',
  ].join(' ');

  const fmtN = (v: number) =>
    v === 0 ? '0' : v >= 1000 ? `${+(v / 1000).toFixed(1)}k` : String(Math.round(v));
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
  const tipX    = hoverIdx !== null
    ? Math.max(66, Math.min(VW - 66, xc(hoverIdx)))
    : 0;

  return (
    <div ref={wrapRef} className="w-full">
    <svg viewBox={`0 0 ${VW} ${VH}`} width="100%" height={VH} className="select-none block">
      <defs>
        <linearGradient id="amtGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#10b981" stopOpacity="0.18" />
          <stop offset="100%" stopColor="#10b981" stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* Grid */}
      {ticks.map((f) => (
        <line key={f} x1={PL} y1={PT + IH * (1 - f)} x2={PL + IW} y2={PT + IH * (1 - f)}
          stroke="#e2e8f0" strokeWidth="0.5" />
      ))}
      <line x1={PL} y1={PT + IH} x2={PL + IW} y2={PT + IH} stroke="#cbd5e1" strokeWidth="1" />
      <line x1={PL} y1={PT}      x2={PL}       y2={PT + IH} stroke="#cbd5e1" strokeWidth="1" />

      {/* Bars — pcs */}
      {data.map((d, i) => {
        const barH = Math.max(1, PT + IH - yp(d.totalPcs));
        return (
          <rect key={i}
            x={xb(i).toFixed(1)} y={yp(d.totalPcs).toFixed(1)}
            width={barW} height={barH}
            fill={hoverIdx === i ? '#4f46e5' : '#818cf8'}
            rx="2"
            style={{ transition: 'fill 0.1s' }}
          />
        );
      })}

      {/* Area under amount line */}
      <path d={areaPath} fill="url(#amtGrad)" />

      {/* Amount line */}
      <path d={linePath} fill="none" stroke="#10b981" strokeWidth="2" strokeLinejoin="round" />
      {data.map((d, i) => (
        <circle key={i}
          cx={xc(i).toFixed(1)} cy={ya(d.totalAmount).toFixed(1)} r="3"
          fill={hoverIdx === i ? '#059669' : '#10b981'}
          style={{ transition: 'fill 0.1s' }}
        />
      ))}

      {/* Hover capture zones */}
      {data.map((_, i) => (
        <rect key={`hz${i}`}
          x={PL + i * slotW} y={PT} width={slotW} height={IH}
          fill="transparent"
          onMouseEnter={() => setHoverIdx(i)}
          onMouseLeave={() => setHoverIdx(null)}
        />
      ))}

      {/* X labels — drop every other one when slots get too narrow (mobile). */}
      {data.map((d, i) => {
        if (slotW < 30 && i % 2 !== 0) return null;
        return (
          <text key={i} x={xc(i).toFixed(1)} y={VH - 8}
            textAnchor="middle" fontSize="10" fill="#94a3b8">
            {monthShort(d.month)}
          </text>
        );
      })}

      {/* Left Y (pcs) */}
      {[0, ...ticks].map((f, j) => (
        <text key={j} x={PL - 6} y={(PT + IH * (1 - f) + 4).toFixed(1)}
          textAnchor="end" fontSize="9" fill="#6366f1">
          {fmtN(maxPcs * f)}
        </text>
      ))}

      {/* Right Y (amount) */}
      {[0, ...ticks].map((f, j) => (
        <text key={j} x={PL + IW + 6} y={(PT + IH * (1 - f) + 4).toFixed(1)}
          textAnchor="start" fontSize="9" fill="#10b981">
          {fmtA(maxAmt * f)}
        </text>
      ))}

      {/* Tooltip */}
      {hovered && (
        <g>
          <line x1={tipX} y1={PT} x2={tipX} y2={PT + IH}
            stroke="#64748b" strokeWidth="1" strokeDasharray="3,2" />
          <rect x={tipX - 62} y={PT} width={124} height={40} rx="5"
            fill="rgba(15,23,42,0.88)" />
          <text x={tipX} y={PT + 14} textAnchor="middle" fontSize="10.5" fill="white" fontWeight="600">
            {monthShort(hovered.month)}: {hovered.totalPcs.toLocaleString('en-IN')} pcs
          </text>
          <text x={tipX} y={PT + 29} textAnchor="middle" fontSize="10" fill="#6ee7b7">
            ₹{hovered.totalAmount.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
            {hovered.orderCount > 0 && ` · ${hovered.orderCount} SO`}
          </text>
        </g>
      )}
    </svg>
    </div>
  );
};
