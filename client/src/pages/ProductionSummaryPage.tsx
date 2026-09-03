// Production Summary — filterable report of production by employee, with type,
// size/measure, pcs, weight and amount. Filter by date range, employee and
// customer; download the filtered set as Excel.
import { Fragment, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Factory, Loader2, Download, Search, ChevronDown, ChevronRight, Users, List } from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { downloadXlsx, todayStamp } from '@/lib/excel';
import { downloadGroupedXlsx, type Cell } from '@/lib/xlsxGrouped';
import { SearchableSelect } from '@/components/SearchableSelect';
import { useHideCustomerNames } from '@/store/auth';

type Row = {
  id: string; prodDate: string; poNumber: string;
  customerName: string; customerCode: string | null;
  labourName: string; coreType: 'TOROIDAL' | 'RECTANGULAR';
  grade: string; material: string; measure: string;
  pcs: number; weightPerPc: number; totalWeight: number; amount: number | null;
};
type SummaryResp = { items: Row[]; totals: { pcs: number; weight: number; amount: number }; labours: string[] };

const inr = (n: number | null) => (n == null ? '—' : '₹' + Number(n).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 }));
const fmt = (iso: string) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }); };
const kg = (n: number) => n.toFixed(3);

/* Day key from the LOCAL date parts, not toISOString() — an entry logged in the
   evening IST would otherwise fall into the previous UTC day and be counted
   against the wrong shift. This matches what fmt() renders. */
const dayKey = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

type SizeAgg = { key: string; measure: string; coreType: Row['coreType']; grade: string; material: string; pcs: number; weight: number; amount: number };
type DayAgg = { key: string; iso: string; pcs: number; weight: number; amount: number; sizes: SizeAgg[] };
type EmpAgg = { name: string; pcs: number; weight: number; amount: number; days: DayAgg[] };

/* Employee -> day -> size. Rounding is applied once at the end of each bucket:
   rounding while accumulating drifts by a gram or two over a month. */
const groupByEmployee = (rows: Row[]): EmpAgg[] => {
  const emps = new Map<string, { name: string; pcs: number; weight: number; amount: number; days: Map<string, { iso: string; pcs: number; weight: number; amount: number; sizes: Map<string, SizeAgg> }> }>();
  for (const r of rows) {
    const name = (r.labourName || '').trim() || '(no employee recorded)';
    let e = emps.get(name);
    if (!e) { e = { name, pcs: 0, weight: 0, amount: 0, days: new Map() }; emps.set(name, e); }
    const dk = dayKey(r.prodDate);
    let d = e.days.get(dk);
    if (!d) { d = { iso: r.prodDate, pcs: 0, weight: 0, amount: 0, sizes: new Map() }; e.days.set(dk, d); }
    const sk = `${r.coreType}|${r.grade}|${r.material}|${r.measure}`;
    let z = d.sizes.get(sk);
    if (!z) { z = { key: sk, measure: r.measure, coreType: r.coreType, grade: r.grade, material: r.material, pcs: 0, weight: 0, amount: 0 }; d.sizes.set(sk, z); }
    const w = Number(r.totalWeight) || 0;
    const a = Number(r.amount) || 0;
    const pcs = Number(r.pcs) || 0;
    z.pcs += pcs; z.weight += w; z.amount += a;
    d.pcs += pcs; d.weight += w; d.amount += a;
    e.pcs += pcs; e.weight += w; e.amount += a;
  }
  const round = <T extends { weight: number; amount: number }>(o: T): T => ({ ...o, weight: +o.weight.toFixed(3), amount: +o.amount.toFixed(2) });
  return [...emps.values()]
    .map((e) => round({
      ...e,
      days: [...e.days.entries()]
        .map(([key, d]) => round({
          key, iso: d.iso, pcs: d.pcs, weight: d.weight, amount: d.amount,
          sizes: [...d.sizes.values()].map(round).sort((a, b) => b.weight - a.weight),
        }))
        .sort((a, b) => b.key.localeCompare(a.key)),   // newest day first
    }))
    .sort((a, b) => b.weight - a.weight);              // biggest producer first
};

export const ProductionSummaryPage = () => {
  const hideNames = useHideCustomerNames();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [labour, setLabour] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [search, setSearch] = useState('');
  const [view, setView] = useState<'BY_EMPLOYEE' | 'ENTRIES'>('BY_EMPLOYEE');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggleEmp = (name: string) => setCollapsed((prev) => {
    const next = new Set(prev);
    if (next.has(name)) next.delete(name); else next.add(name);
    return next;
  });

  const qs = new URLSearchParams();
  if (from) qs.set('from', from);
  if (to) qs.set('to', to);
  if (labour) qs.set('labour', labour);
  if (customerId) qs.set('customerId', customerId);
  if (search.trim()) qs.set('search', search.trim());

  const { data, isLoading } = useQuery({
    queryKey: ['production-summary', from, to, labour, customerId, search],
    queryFn: () => api<SummaryResp>(`/production/summary?${qs.toString()}`),
  });

  const { data: customers } = useQuery({
    queryKey: ['customers-options'],
    queryFn: () => api<{ items: { id: string; name: string; customerCode: string }[] }>('/customers?pageSize=500'),
  });
  const customerOptions = (customers?.items ?? []).map((c) => ({ value: c.id, label: hideNames ? c.customerCode : `${c.customerCode} · ${c.name}` }));
  const labourOptions = (data?.labours ?? []).map((l) => ({ value: l, label: l }));

  const items = data?.items ?? [];
  const totals = data?.totals;
  const employees = useMemo(() => groupByEmployee(items), [items]);
  const allCollapsed = employees.length > 0 && employees.every((e) => collapsed.has(e.name));

  /* One row per (employee, day, size) under an employee subtotal — the same
     shape as the on-screen report, so the sheet can be read directly or
     pivoted. Day totals are deliberately NOT written as extra rows: mixing
     subtotals into the detail makes the weight column double-count when
     someone sums or pivots it. */
  const onExportByEmployee = () => {
    if (!employees.length) return;
    downloadGroupedXlsx({
      filename: `production-by-employee-${todayStamp()}`,
      sheetName: 'By Employee',
      headers: ['Employee', 'Date', 'Type', 'Grade', 'Material', 'Size', 'Pcs', 'Weight (kg)', 'Amount (₹)'],
      groups: employees.map((e) => ({
        summary: [e.name, `${e.days.length} day${e.days.length === 1 ? '' : 's'}`, '', '', '', '', e.pcs, e.weight, e.amount] as Cell[],
        rows: e.days.flatMap((d) => d.sizes.map((z) => [
          e.name, fmt(d.iso),
          z.coreType === 'TOROIDAL' ? 'Toroidal' : 'Rectangular',
          z.grade, z.material, z.measure, z.pcs, z.weight, z.amount,
        ] as Cell[])),
      })),
    });
  };

  const onExport = () => {
    if (view === 'BY_EMPLOYEE') return onExportByEmployee();
    if (!items.length) return;
    const rows = items.map((r) => ({
      Date: fmt(r.prodDate),
      Employee: r.labourName,
      'PO #': r.poNumber,
      'Customer Code': r.customerCode ?? '',
      ...(hideNames ? {} : { Customer: r.customerName }),
      Type: r.coreType,
      Grade: r.grade,
      Material: r.material,
      Measure: r.measure,
      Pcs: r.pcs,
      'Weight (kg)': r.totalWeight,
      'Amount (₹)': r.amount ?? '',
    }));
    downloadXlsx(`production-summary-${todayStamp()}`, 'Production Summary', rows);
  };

  return (
    <div className="space-y-4 sm:space-y-5 max-w-full">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight flex items-center gap-2">
          <Factory className="h-5 w-5 text-brand-600" /> Production Summary
        </h1>
        <button
          onClick={onExport}
          disabled={!items.length}
          className="btn-ghost w-full sm:w-auto justify-center border border-slate-300 text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
          title="Download the filtered rows as Excel"
        >
          <Download className="h-4 w-4" /> Excel
        </button>
      </div>

      {/* Filters */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <label className="block">
            <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-slate-500">From</span>
            <input type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-slate-500">To</span>
            <input type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-slate-500">Employee</span>
            <SearchableSelect value={labour} onChange={setLabour} options={labourOptions} placeholder="All employees" />
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-slate-500">Customer</span>
            <SearchableSelect value={customerId} onChange={setCustomerId} options={customerOptions} placeholder="All customers" />
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-slate-500">Search</span>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input className="input pl-9" placeholder="PO, grade, measure…" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
          </label>
        </div>
      </div>

      {/* Summary cards */}
      {totals && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Stat label="Total Pcs" value={totals.pcs.toLocaleString('en-IN')} />
          <Stat label="Total Weight (kg)" value={totals.weight.toFixed(3)} tone="brand" />
          <Stat label="Total Amount" value={inr(totals.amount)} tone="brand" className="col-span-2 sm:col-span-1" />
        </div>
      )}

      {/* View switcher */}
      {!isLoading && items.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="inline-flex rounded-lg border border-slate-300 bg-white p-0.5">
            {([['BY_EMPLOYEE', 'By employee', Users], ['ENTRIES', 'All entries', List]] as const).map(([k, label, Icon]) => (
              <button
                key={k}
                onClick={() => setView(k)}
                className={cn('inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors duration-200 motion-reduce:transition-none',
                  view === k ? 'bg-brand-600 text-white' : 'text-slate-600 hover:bg-slate-100')}
              >
                <Icon className="h-3.5 w-3.5" /> {label}
              </button>
            ))}
          </div>
          {view === 'BY_EMPLOYEE' && (
            <button
              onClick={() => setCollapsed(allCollapsed ? new Set() : new Set(employees.map((e) => e.name)))}
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
            >
              {allCollapsed ? 'Expand all' : 'Collapse all'}
            </button>
          )}
        </div>
      )}

      {/* Loading / empty */}
      {isLoading && (
        <div className="rounded-xl border border-slate-200 bg-white p-8 sm:p-10 text-center text-slate-400">
          <Loader2 className="h-5 w-5 animate-spin mx-auto" />
        </div>
      )}
      {!isLoading && !items.length && (
        <div className="rounded-xl border border-slate-200 bg-white p-8 sm:p-10 text-center text-sm text-slate-400">
          No production records for these filters.
        </div>
      )}

      {/* By employee — each person, each day, broken down by size */}
      {!isLoading && items.length > 0 && view === 'BY_EMPLOYEE' && (
        <div className="space-y-3">
          {employees.map((e) => {
            const open = !collapsed.has(e.name);
            return (
              <div key={e.name} className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                <button
                  onClick={() => toggleEmp(e.name)}
                  aria-expanded={open}
                  className="flex w-full items-center gap-2 bg-slate-50 px-3 py-2.5 text-left transition-colors duration-200 hover:bg-slate-100 motion-reduce:transition-none sm:px-4"
                >
                  {open ? <ChevronDown className="h-4 w-4 shrink-0 text-slate-400" /> : <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />}
                  <span className="min-w-0 flex-1 truncate text-sm font-bold text-slate-900">{e.name}</span>
                  <span className="hidden shrink-0 text-[11px] text-slate-500 sm:inline">
                    {e.days.length} day{e.days.length === 1 ? '' : 's'}
                  </span>
                  <span className="shrink-0 tabular-nums text-xs text-slate-600">{e.pcs.toLocaleString('en-IN')} pcs</span>
                  <span className="shrink-0 tabular-nums text-sm font-bold text-slate-900">{kg(e.weight)} kg</span>
                  <span className="hidden shrink-0 tabular-nums text-sm font-bold text-brand-700 sm:inline">{inr(e.amount)}</span>
                </button>

                {open && (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm whitespace-nowrap">
                      <thead className="bg-white text-left text-[10.5px] uppercase tracking-wide text-slate-400">
                        <tr className="border-b border-slate-100">
                          <th className="px-3 py-1.5 font-medium sm:px-4">Date / Size</th>
                          <th className="px-3 py-1.5 font-medium">Type</th>
                          <th className="px-3 py-1.5 font-medium">Grade</th>
                          <th className="px-3 py-1.5 font-medium">Material</th>
                          <th className="px-3 py-1.5 text-right font-medium">Pcs</th>
                          <th className="px-3 py-1.5 text-right font-medium">Weight (kg)</th>
                          <th className="px-3 py-1.5 text-right font-medium">Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        {e.days.map((d) => (
                          <Fragment key={d.key}>
                            <tr className="border-t border-slate-100 bg-slate-50/60">
                              <td className="px-3 py-2 font-semibold text-slate-700 sm:px-4">{fmt(d.iso)}</td>
                              <td colSpan={3} className="px-3 py-2 text-[11px] uppercase tracking-wide text-slate-400">Day total</td>
                              <td className="px-3 py-2 text-right tabular-nums font-semibold text-slate-700">{d.pcs.toLocaleString('en-IN')}</td>
                              <td className="px-3 py-2 text-right tabular-nums font-semibold text-slate-900">{kg(d.weight)}</td>
                              <td className="px-3 py-2 text-right tabular-nums font-semibold text-brand-700">{inr(d.amount)}</td>
                            </tr>
                            {d.sizes.map((z) => (
                              <tr key={z.key} className="border-t border-slate-50 hover:bg-slate-50/60">
                                <td className="px-3 py-2 pl-7 font-mono text-xs text-slate-600 sm:px-4 sm:pl-9">{z.measure}</td>
                                <td className="px-3 py-2">
                                  <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-medium', z.coreType === 'TOROIDAL' ? 'bg-amber-50 text-amber-700' : 'bg-rose-50 text-rose-700')}>
                                    {z.coreType === 'TOROIDAL' ? 'Toro' : 'Rect'}
                                  </span>
                                </td>
                                <td className="px-3 py-2 text-slate-600">{z.grade}</td>
                                <td className="px-3 py-2 text-slate-600">{z.material}</td>
                                <td className="px-3 py-2 text-right tabular-nums text-slate-700">{z.pcs.toLocaleString('en-IN')}</td>
                                <td className="px-3 py-2 text-right tabular-nums text-slate-800">{kg(z.weight)}</td>
                                <td className="px-3 py-2 text-right tabular-nums text-slate-600">{inr(z.amount)}</td>
                              </tr>
                            ))}
                          </Fragment>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Desktop table — md+ */}
      {!isLoading && items.length > 0 && view === 'ENTRIES' && (
        <div className="rounded-xl border border-slate-200 bg-white overflow-hidden hidden md:block">
          <div className="overflow-x-auto">
            <table className="w-full text-sm whitespace-nowrap">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2.5 font-medium">Date</th>
                  <th className="px-3 py-2.5 font-medium">Employee</th>
                  <th className="px-3 py-2.5 font-medium">Type</th>
                  <th className="px-3 py-2.5 font-medium">Grade</th>
                  <th className="px-3 py-2.5 font-medium">Material</th>
                  <th className="px-3 py-2.5 font-medium">Measure</th>
                  <th className="px-3 py-2.5 font-medium text-right">Pcs</th>
                  <th className="px-3 py-2.5 font-medium text-right">Weight (kg)</th>
                  <th className="px-3 py-2.5 font-medium text-right">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50/60">
                    <td className="px-3 py-2.5 text-slate-600">{fmt(r.prodDate)}</td>
                    <td className="px-3 py-2.5 font-medium text-slate-900">{r.labourName}</td>
                    <td className="px-3 py-2.5">
                      <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-medium', r.coreType === 'TOROIDAL' ? 'bg-amber-50 text-amber-700' : 'bg-rose-50 text-rose-700')}>
                        {r.coreType === 'TOROIDAL' ? 'Toro' : 'Rect'}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-slate-600">{r.grade}</td>
                    <td className="px-3 py-2.5 text-slate-600">{r.material}</td>
                    <td className="px-3 py-2.5 font-mono text-xs text-slate-600">{r.measure}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{r.pcs}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums font-medium">{r.totalWeight.toFixed(3)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-brand-700">{inr(r.amount)}</td>
                  </tr>
                ))}
              </tbody>
              {totals && (
                <tfoot>
                  <tr className="bg-slate-100 text-sm font-semibold tabular-nums">
                    <td colSpan={6} className="px-3 py-2.5 text-right uppercase tracking-wide text-slate-500">Total</td>
                    <td className="px-3 py-2.5 text-right">{totals.pcs.toLocaleString('en-IN')}</td>
                    <td className="px-3 py-2.5 text-right">{totals.weight.toFixed(3)}</td>
                    <td className="px-3 py-2.5 text-right text-brand-700">{inr(totals.amount)}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>
      )}

      {/* Mobile cards — < md */}
      {!isLoading && items.length > 0 && view === 'ENTRIES' && (
        <div className="space-y-3 md:hidden">
          {items.map((r) => (
            <div key={r.id} className="rounded-xl border border-slate-200 bg-white p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs text-slate-500">{fmt(r.prodDate)}</span>
                    <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-medium', r.coreType === 'TOROIDAL' ? 'bg-amber-50 text-amber-700' : 'bg-rose-50 text-rose-700')}>
                      {r.coreType === 'TOROIDAL' ? 'Toro' : 'Rect'}
                    </span>
                  </div>
                  <div className="mt-0.5 text-sm font-semibold text-slate-900 truncate">{r.labourName}</div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-sm font-semibold tabular-nums text-brand-700">{inr(r.amount)}</div>
                  <div className="text-[11px] text-slate-500">Amount</div>
                </div>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-slate-600">
                <span className="font-medium text-slate-700">{r.grade}</span>
                <span>{r.material}</span>
                <span className="font-mono text-slate-500">{r.measure}</span>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-1.5 text-center">
                <div className="rounded-md bg-slate-50 px-2 py-1">
                  <div className="text-[10px] font-medium text-slate-500">Pcs</div>
                  <div className="tabular-nums text-sm font-semibold text-slate-900">{r.pcs}</div>
                </div>
                <div className="rounded-md bg-slate-50 px-2 py-1">
                  <div className="text-[10px] font-medium text-slate-500">Weight (kg)</div>
                  <div className="tabular-nums text-sm font-semibold text-slate-900">{r.totalWeight.toFixed(3)}</div>
                </div>
              </div>
            </div>
          ))}
          {totals && (
            <div className="rounded-xl border border-slate-200 bg-slate-100 p-3">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Total</div>
              <div className="mt-1 grid grid-cols-3 gap-1.5 text-center">
                <div>
                  <div className="text-[10px] font-medium text-slate-500">Pcs</div>
                  <div className="tabular-nums text-sm font-bold text-slate-900">{totals.pcs.toLocaleString('en-IN')}</div>
                </div>
                <div>
                  <div className="text-[10px] font-medium text-slate-500">Weight</div>
                  <div className="tabular-nums text-sm font-bold text-slate-900">{totals.weight.toFixed(3)}</div>
                </div>
                <div>
                  <div className="text-[10px] font-medium text-slate-500">Amount</div>
                  <div className="tabular-nums text-sm font-bold text-brand-700">{inr(totals.amount)}</div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

const Stat = ({ label, value, tone, className }: { label: string; value: string; tone?: 'brand'; className?: string }) => (
  <div className={cn('rounded-xl border border-slate-200 bg-white p-3 sm:p-4', className)}>
    <div className="text-[11px] uppercase tracking-wide text-slate-500">{label}</div>
    <div className={cn('mt-0.5 text-lg sm:text-xl font-bold tabular-nums', tone === 'brand' ? 'text-brand-700' : 'text-slate-900')}>{value}</div>
  </div>
);
