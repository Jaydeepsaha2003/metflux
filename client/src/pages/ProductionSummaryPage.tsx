// Production Summary — filterable report of production by employee, with type,
// size/measure, pcs, weight and amount. Filter by date range, employee and
// customer; download the filtered set as Excel.
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Factory, Loader2, Download, Search } from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { downloadXlsx, todayStamp } from '@/lib/excel';
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

export const ProductionSummaryPage = () => {
  const hideNames = useHideCustomerNames();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [labour, setLabour] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [search, setSearch] = useState('');

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

  const onExport = () => {
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
    <div className="space-y-5 max-w-full">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Factory className="h-5 w-5 text-brand-600" /> Production Summary
        </h1>
        <button onClick={onExport} disabled={!items.length} className="btn-ghost border border-slate-300 text-emerald-700 hover:bg-emerald-50 disabled:opacity-50">
          <Download className="h-4 w-4" /> Excel
        </button>
      </div>

      {/* Filters */}
      <div className="card p-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
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

      {/* Summary cards */}
      {totals && (
        <div className="grid grid-cols-3 gap-3">
          <Stat label="Total Pcs" value={totals.pcs.toLocaleString('en-IN')} />
          <Stat label="Total Weight (kg)" value={totals.weight.toFixed(3)} tone="brand" />
          <Stat label="Total Amount" value={inr(totals.amount)} tone="brand" />
        </div>
      )}

      <div className="card overflow-hidden">
        {isLoading ? (
          <div className="py-12 text-center text-slate-400"><Loader2 className="h-5 w-5 animate-spin mx-auto" /></div>
        ) : !items.length ? (
          <div className="py-12 text-center text-sm text-slate-400">No production records for these filters.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm whitespace-nowrap">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2.5">Date</th>
                  <th className="px-3 py-2.5">Employee</th>
                  <th className="px-3 py-2.5">Type</th>
                  <th className="px-3 py-2.5">Grade</th>
                  <th className="px-3 py-2.5">Material</th>
                  <th className="px-3 py-2.5">Measure</th>
                  <th className="px-3 py-2.5 text-right">Pcs</th>
                  <th className="px-3 py-2.5 text-right">Weight (kg)</th>
                  <th className="px-3 py-2.5 text-right">Amount</th>
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
        )}
      </div>
    </div>
  );
};

const Stat = ({ label, value, tone }: { label: string; value: string; tone?: 'brand' }) => (
  <div className="card p-3">
    <div className="text-[11px] uppercase tracking-wide text-slate-500">{label}</div>
    <div className={cn('mt-0.5 text-xl font-bold tabular-nums', tone === 'brand' ? 'text-brand-700' : 'text-slate-900')}>{value}</div>
  </div>
);
