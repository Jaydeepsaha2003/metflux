// Dashboard — KPIs + employee performance table.
// Mobile-first: KPI cards stack 2-up on phones, tables become cards.
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Factory, Truck, Package, RotateCcw, FileText, TrendingUp, Users2, Trophy, Loader2,
} from 'lucide-react';
import { useAuthStore, activeMembership } from '@/store/auth';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';

type Stats = {
  soThisMonth:       { count: number; amount: number };
  soThisYear:        { count: number; amount: number };
  pendingProduction: { pcs: number; amount: number };
  readyDispatch:     { pcs: number; amount: number };
  dispatchThisMonth: { count: number; pcs: number; weight: number; amount: number };
  openReturns:       number;
  topCustomers:      { id: string; name: string; amount: number }[];
};

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

const todayISO = () => new Date().toISOString().slice(0, 10);
const startOfMonthISO = () => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
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

  const { data: stats, isLoading: loadingStats } = useQuery({
    queryKey: ['dashboard-stats', active?.companyId],
    queryFn: () => api<Stats>('/dashboard/stats'),
  });

  /* Employee filter — defaults to month-to-date */
  const [from, setFrom] = useState(startOfMonthISO());
  const [to, setTo]     = useState(todayISO());
  const [empSearch, setEmpSearch] = useState('');

  const { data: empData, isLoading: loadingEmps } = useQuery({
    queryKey: ['dashboard-employees', from, to, active?.companyId],
    queryFn: () => api<EmployeeResp>(`/dashboard/employees?from=${from}&to=${to}`),
  });

  const empItems = (empData?.items ?? []).filter((row) =>
    !empSearch.trim() || row.labourName.toLowerCase().includes(empSearch.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight">
          Welcome back, {user?.name?.split(' ')[0]}
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          {active?.companyName ? `Snapshot for ${active.companyName}.` : 'Pick a company to see its dashboard.'}
        </p>
      </div>

      {/* ── KPI cards ── */}
      <section>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Key metrics</h2>
        {loadingStats ? (
          <div className="card flex items-center justify-center gap-2 py-8 text-slate-400">
            <Loader2 className="h-5 w-5 animate-spin" /> Loading…
          </div>
        ) : !stats ? null : (
          <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4">
            <KpiCard
              icon={FileText} accent="brand"
              label="Sales Orders (this month)"
              primary={String(stats.soThisMonth.count)}
              secondary={fmtCompactMoney(stats.soThisMonth.amount)}
            />
            <KpiCard
              icon={TrendingUp} accent="emerald"
              label="Sales YTD"
              primary={String(stats.soThisYear.count)}
              secondary={fmtCompactMoney(stats.soThisYear.amount)}
            />
            <KpiCard
              icon={Factory} accent="amber"
              label="Pending production"
              primary={`${stats.pendingProduction.pcs.toLocaleString('en-IN')} pcs`}
              secondary={fmtCompactMoney(stats.pendingProduction.amount)}
            />
            <KpiCard
              icon={Package} accent="blue"
              label="Ready to dispatch"
              primary={`${stats.readyDispatch.pcs.toLocaleString('en-IN')} pcs`}
              secondary={fmtCompactMoney(stats.readyDispatch.amount)}
            />
            <KpiCard
              icon={Truck} accent="indigo"
              label="Dispatches (this month)"
              primary={String(stats.dispatchThisMonth.count)}
              secondary={`${stats.dispatchThisMonth.pcs} pcs · ${stats.dispatchThisMonth.weight.toFixed(1)} kg`}
              tertiary={fmtCompactMoney(stats.dispatchThisMonth.amount)}
            />
            <KpiCard
              icon={RotateCcw} accent={stats.openReturns ? 'rose' : 'slate'}
              label="Open returns"
              primary={String(stats.openReturns)}
              secondary={stats.openReturns ? 'Need attention' : 'All clear'}
            />
          </div>
        )}
      </section>

      {/* ── Top customers ── */}
      {stats && stats.topCustomers.length > 0 && (
        <section>
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Top customers (year-to-date)</h2>
          <div className="card divide-y divide-slate-100">
            {stats.topCustomers.map((c, i) => (
              <div key={c.id} className="flex items-center gap-3 px-4 py-2.5">
                <div className={cn(
                  'grid h-7 w-7 place-items-center rounded-full text-xs font-bold shrink-0',
                  i === 0 ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-600'
                )}>
                  {i + 1}
                </div>
                <div className="flex-1 min-w-0 truncate font-medium text-slate-900">{c.name}</div>
                <div className="font-mono text-sm font-semibold tabular-nums text-slate-700">{fmtCompactMoney(c.amount)}</div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── Employee performance ── */}
      <section>
        <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500 flex items-center gap-1.5">
            <Users2 className="h-3.5 w-3.5" /> Employee performance
          </h2>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3">
            <label className="block">
              <span className="text-[10px] uppercase tracking-wide text-slate-500 font-medium">From</span>
              <input className="input mt-0.5" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </label>
            <label className="block">
              <span className="text-[10px] uppercase tracking-wide text-slate-500 font-medium">To</span>
              <input className="input mt-0.5" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </label>
            <label className="col-span-2 sm:col-span-1 block">
              <span className="text-[10px] uppercase tracking-wide text-slate-500 font-medium">Worker</span>
              <input className="input mt-0.5" placeholder="Search worker…" value={empSearch} onChange={(e) => setEmpSearch(e.target.value)} />
            </label>
          </div>
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
                  <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
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
                        <td className="px-4 py-3 text-right tabular-nums font-mono text-slate-700">{row.totalWeight.toFixed(3)}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-slate-500">{row.entries}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-slate-500">{row.distinctSizes}</td>
                        <td className="px-4 py-3 text-slate-600 font-mono text-xs">
                          {row.topSize ? `${row.topSize} (${row.topSizePcs})` : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-slate-100 text-xs font-semibold tabular-nums">
                      <td colSpan={2} className="px-4 py-2 text-right uppercase tracking-wide text-slate-500">Total</td>
                      <td className="px-4 py-2 text-right">{empData?.totalPcs.toLocaleString('en-IN')}</td>
                      <td className="px-4 py-2 text-right font-mono">{empData?.totalWeight.toFixed(3)}</td>
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
                        <div className="font-mono tabular-nums font-semibold text-sm">{row.pcs.toLocaleString('en-IN')} pcs</div>
                        <div className="text-[10px] text-slate-500 font-mono tabular-nums">{row.totalWeight.toFixed(3)} kg</div>
                      </div>
                    </div>
                    {row.topSize && (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {row.sizes.slice(0, 4).map((s) => (
                          <span key={s.measure} className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-mono text-slate-700">
                            {s.measure} <span className="text-slate-500">×{s.pcs}</span>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
                <div className="bg-slate-50 px-4 py-2 text-xs font-semibold text-slate-600 flex justify-between">
                  <span>Total</span>
                  <span className="font-mono tabular-nums">
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

const ACCENTS = {
  brand:   'bg-brand-50 text-brand-700 ring-brand-100',
  emerald: 'bg-emerald-50 text-emerald-700 ring-emerald-100',
  amber:   'bg-amber-50 text-amber-700 ring-amber-100',
  blue:    'bg-blue-50 text-blue-700 ring-blue-100',
  indigo:  'bg-indigo-50 text-indigo-700 ring-indigo-100',
  rose:    'bg-rose-50 text-rose-700 ring-rose-100',
  slate:   'bg-slate-100 text-slate-600 ring-slate-200',
};

const KpiCard = ({
  icon: Icon, label, primary, secondary, tertiary, accent = 'slate',
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  primary: string;
  secondary?: string;
  tertiary?: string;
  accent?: keyof typeof ACCENTS;
}) => (
  <div className="card p-3 sm:p-4">
    <div className="flex items-start gap-3">
      <div className={cn('grid h-9 w-9 place-items-center rounded-lg ring-1 shrink-0', ACCENTS[accent])}>
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500 truncate">{label}</div>
        <div className="mt-0.5 text-lg sm:text-xl font-bold tracking-tight text-slate-900 tabular-nums">{primary}</div>
        {secondary && <div className="text-[11px] text-slate-500 truncate font-mono">{secondary}</div>}
        {tertiary && <div className="text-[11px] text-slate-400 truncate font-mono">{tertiary}</div>}
      </div>
    </div>
  </div>
);
