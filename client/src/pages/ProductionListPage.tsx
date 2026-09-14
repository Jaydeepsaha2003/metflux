// All production records — filterable, dense ERP-style table with per-row
// edit/delete. Mirrors the .NET Modify_Production grid.
//
// Reskinned to match the user's own colour mockup (dark brand-900 bands,
// Archivo labels, JetBrains Mono figures) — see components/production/erp.tsx
// for the shared tokens and the colour-mapping rationale. Data fetching,
// pagination, search, and the edit/delete actions are unchanged from before.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Search, Pencil, Trash2, Factory, Download, Loader2, X } from 'lucide-react';
import { api } from '@/lib/api';
import { useConfirm } from '@/hooks/useConfirm';
import { Pagination } from '@/components/Pagination';
import { SearchableSelect } from '@/components/SearchableSelect';
import { downloadXlsx, todayStamp } from '@/lib/excel';
import { useHideCustomerNames } from '@/store/auth';
import {
  ErpCard, ErpLabel, ErpStat, ErpStatStrip, ErpTh, ErpSegmented, CoreTypeChip, ProductionTabs, ErpMobileHeader,
} from '@/components/production/erp';

type Row = {
  id: string;
  poNumber: string;
  customerName: string;
  customerCode: string | null;
  coreType: 'TOROIDAL' | 'RECTANGULAR';
  grade: string;
  material: string;
  measure: string;
  itemPcs: number;
  prodDate: string;
  pcs: number;
  weightPerPc: number;
  totalWeight: number;
  labourName: string;
  amount: number | null;
};
type Aggregates = {
  records: number; pcs: number; weight: number; amount: number;
  unratedCount: number; poCount: number; labourCount: number;
};
type ListResp = { items: Row[]; total: number; aggregates: Aggregates; labours: string[] };
type CoreFilter = 'ALL' | 'TOROIDAL' | 'RECTANGULAR';

const formatDate = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
};
const pcsFmt = (n: number) => n.toLocaleString('en-IN');
const kg = (n: number) => n.toFixed(3);
const inr = (n: number) => '₹' + n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const PAGE_SIZE = 20;

export const ProductionListPage = () => {
  const [search, setSearch] = useState('');
  const [coreType, setCoreType] = useState<CoreFilter>('ALL');
  const [labour, setLabour] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZE);
  const changePageSize = (n: number) => { setPageSize(n); setPage(1); };
  useEffect(() => { setPage(1); }, [search, coreType, labour]);
  const queryClient = useQueryClient();
  const { confirm, alert, confirmDialog } = useConfirm();
  const hideNames = useHideCustomerNames();

  const qs = new URLSearchParams();
  qs.set('search', search);
  qs.set('page', String(page));
  qs.set('pageSize', String(pageSize));
  if (coreType !== 'ALL') qs.set('coreType', coreType);
  if (labour) qs.set('labour', labour);

  const { data, isLoading } = useQuery({
    queryKey: ['production', search, coreType, labour, page, pageSize],
    queryFn: () => api<ListResp>(`/production?${qs.toString()}`),
  });

  const hasFilters = !!search || coreType !== 'ALL' || !!labour;
  const clearFilters = () => { setSearch(''); setCoreType('ALL'); setLabour(''); };

  const remove = useMutation({
    mutationFn: (id: string) => api(`/production/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['production'] }),
  });

  /* Export every matching production record to Excel — not just current page. */
  const [exporting, setExporting] = useState(false);
  const onExport = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const eqs = new URLSearchParams(qs); eqs.set('page', '1'); eqs.set('pageSize', '10000');
      const all = await api<ListResp>(`/production?${eqs.toString()}`);
      const rows = all.items.map((p) => ({
        'Date':        formatDate(p.prodDate),
        'PO #':        p.poNumber,
        'Customer Code': p.customerCode ?? '',
        ...(hideNames ? {} : { 'Customer': p.customerName }),
        'Labour':      p.labourName,
        'Type':        p.coreType,
        'Grade':       p.grade,
        'Material':    p.material,
        'Measure':     p.measure,
        'Pcs':         p.pcs,
        'Wt / pc':     p.weightPerPc,
        'Total Wt':    p.totalWeight,
        'Amount (₹)':  p.amount,
      }));
      downloadXlsx(`production-${todayStamp()}`, 'Production', rows);
    } catch (e) {
      alert({ title: 'Export failed', message: e instanceof Error ? e.message : 'Please try again.', tone: 'danger' });
    } finally {
      setExporting(false);
    }
  };

  const agg = data?.aggregates;
  const labourOptions = (data?.labours ?? []).map((l) => ({ value: l, label: l }));

  const onDelete = async (p: Row) => {
    const ok = await confirm({
      title: 'Delete production entry?',
      message: <>Delete production entry of <strong>{p.pcs} pcs</strong> by <strong>{p.labourName}</strong>?</>,
      tone: 'danger',
      confirmLabel: 'Delete',
    });
    if (ok) remove.mutate(p.id);
  };

  return (
    <div className="space-y-3 max-w-[1400px]">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="flex items-center gap-2 font-archivo text-xl font-extrabold tracking-tight text-slate-900 sm:text-2xl">
          <Factory className="h-5 w-5 text-brand-600" /> Production
        </h1>
        <div className="flex items-center gap-2">
          <button
            onClick={onExport}
            disabled={exporting || isLoading || !data?.items.length}
            className="btn-ghost text-emerald-700 hover:bg-emerald-50 disabled:opacity-50 flex-1 sm:flex-none justify-center"
            title="Download all matching rows as Excel"
          >
            {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            <span className="hidden sm:inline">Excel</span>
          </button>
          <Link to="/production/new" className="btn-primary flex-1 sm:flex-none justify-center">
            <Plus className="h-4 w-4" /> Record<span className="hidden sm:inline"> Production</span>
          </Link>
        </div>
      </div>

      <ProductionTabs />

      {agg && !isLoading && (
        <ErpMobileHeader
          subtitle="Current filter"
          primary={{ label: 'Job Amount, this filter', value: inr(agg.amount) }}
          stats={[{ label: 'Pieces', value: pcsFmt(agg.pcs) }, { label: 'Weight', value: `${kg(agg.weight)} kg` }]}
        />
      )}

      {/* overflow-visible: the Worker picker renders its menu as an
          absolutely-positioned child, and the card below clips by default. */}
      <ErpCard className="overflow-visible">
        {/* Filter toolbar — one row, matches the mockup's single-line layout. */}
        <div className="flex flex-col gap-2.5 p-3 lg:flex-row lg:items-center">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              className="input h-9 pl-9 text-sm"
              placeholder="PO #, customer, measure, grade, worker"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="flex flex-wrap items-center gap-2.5">
            <div>
              <ErpLabel className="mb-1 block">Core Type</ErpLabel>
              <ErpSegmented
                value={coreType}
                onChange={setCoreType}
                options={[{ value: 'ALL', label: 'All' }, { value: 'TOROIDAL', label: 'Toroidal' }, { value: 'RECTANGULAR', label: 'Rect.' }]}
              />
            </div>
            <div className="w-40">
              <ErpLabel className="mb-1 block">Worker</ErpLabel>
              <SearchableSelect value={labour} onChange={setLabour} options={labourOptions} placeholder="All workers" />
            </div>
            {hasFilters && (
              <button onClick={clearFilters} className="mt-4 flex items-center gap-1 font-archivo text-[11px] font-extrabold uppercase tracking-wide text-brand-700 hover:text-brand-800">
                <X className="h-3 w-3" /> Clear
              </button>
            )}
            <div className="mt-4 whitespace-nowrap text-[11px] text-slate-400">
              {data ? `${data.total} record${data.total === 1 ? '' : 's'}` : ''}
            </div>
          </div>
        </div>

        {/* KPI strip */}
        {agg && !isLoading && (
          <ErpStatStrip>
            <ErpStat label="Records" value={pcsFmt(agg.records)} caption="in the current filter" />
            <ErpStat label="Pieces Made" value={pcsFmt(agg.pcs)} caption={`across ${agg.poCount} sales order${agg.poCount === 1 ? '' : 's'}`} />
            <ErpStat label="Weight" value={`${kg(agg.weight)} kg`} caption="sum of pcs × wt/pc" />
            <ErpStat
              label="Job Amount" value={inr(agg.amount)} tone="brand"
              caption={agg.unratedCount > 0 ? `${agg.unratedCount} record${agg.unratedCount === 1 ? '' : 's'} ${agg.unratedCount === 1 ? 'has' : 'have'} no rate posted` : 'fully rated'}
            />
          </ErpStatStrip>
        )}

        {/* Desktop table */}
        <div className="hidden md:block overflow-x-auto border-t border-slate-100">
          <table className="w-full min-w-[1180px] text-[13px]">
            <thead>
              <tr>
                <ErpTh className="pl-3">Date</ErpTh>
                <ErpTh>PO #</ErpTh>
                <ErpTh>Code</ErpTh>
                <ErpTh>Customer</ErpTh>
                <ErpTh align="center">Type</ErpTh>
                <ErpTh>Grade</ErpTh>
                <ErpTh>Material</ErpTh>
                <ErpTh>Measure</ErpTh>
                <ErpTh align="right">Pcs</ErpTh>
                <ErpTh align="right">Wt / Pc</ErpTh>
                <ErpTh align="right">Total Wt</ErpTh>
                <ErpTh>Worker</ErpTh>
                <ErpTh align="right">Amount</ErpTh>
                <ErpTh className="w-24">Actions</ErpTh>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr><td colSpan={14} className="px-3 py-10 text-center text-slate-400">Loading…</td></tr>
              )}
              {!isLoading && data?.items.length === 0 && (
                <tr>
                  <td colSpan={14} className="px-3 py-10 text-center text-slate-400">
                    No production records{hasFilters ? ' for these filters' : ' yet'}.{' '}
                    {!hasFilters && (
                      <Link to="/production/new" className="font-medium text-brand-700 hover:text-brand-800">
                        Record your first one →
                      </Link>
                    )}
                  </td>
                </tr>
              )}
              {data?.items.map((p) => (
                <tr key={p.id} className="border-t border-slate-100 odd:bg-white even:bg-slate-50/40 hover:bg-brand-50/50">
                  <td className="px-2.5 py-2 pl-3 text-slate-600">{formatDate(p.prodDate)}</td>
                  <td className="px-2.5 py-2 font-jbmono text-xs">{p.poNumber}</td>
                  <td className="px-2.5 py-2 font-jbmono text-xs font-semibold text-brand-700">{p.customerCode ?? '—'}</td>
                  <td className="px-2.5 py-2 max-w-[160px] truncate" title={hideNames ? undefined : p.customerName}>
                    {hideNames ? <span className="text-slate-300">—</span> : p.customerName}
                  </td>
                  <td className="px-2.5 py-2 text-center"><CoreTypeChip coreType={p.coreType} /></td>
                  <td className="px-2.5 py-2 text-slate-700">{p.grade}</td>
                  <td className="px-2.5 py-2 text-slate-700">{p.material}</td>
                  <td className="px-2.5 py-2 font-jbmono text-xs text-slate-700">{p.measure}</td>
                  <td className="px-2.5 py-2 text-right font-jbmono tabular-nums">{pcsFmt(p.pcs)}</td>
                  <td className="px-2.5 py-2 text-right font-jbmono tabular-nums">{kg(p.weightPerPc)}</td>
                  <td className="px-2.5 py-2 text-right font-jbmono font-semibold tabular-nums">{kg(p.totalWeight)}</td>
                  <td className="px-2.5 py-2 font-medium text-slate-800">{p.labourName}</td>
                  <td className="px-2.5 py-2 text-right font-jbmono tabular-nums text-brand-700">
                    {p.amount != null ? inr(p.amount) : '—'}
                  </td>
                  <td className="px-2.5 py-2">
                    <div className="flex items-center justify-end gap-1">
                      <Link to={`/production/${p.id}`} className="rounded p-1.5 text-brand-700 hover:bg-brand-50" title="Edit">
                        <Pencil className="h-4 w-4" />
                      </Link>
                      <button
                        onClick={() => onDelete(p)}
                        className="rounded p-1.5 text-red-600 hover:bg-red-50"
                        title="Delete"
                        disabled={remove.isPending}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
            {agg && data && data.items.length > 0 && (
              <tfoot>
                {/* Real cells under their real columns (Date…Measure=8, Pcs,
                    Wt/pc, Total Wt, Worker, Amount, Actions=6) — a colSpan'd
                    label plus a separately-positioned numbers row would drift
                    out of alignment the moment a column's width changes. */}
                <tr className="bg-brand-900 text-white">
                  <td colSpan={8} className="px-2.5 py-2 pl-3 font-archivo text-[11px] font-bold uppercase tracking-wider">
                    Total · {agg.records} record{agg.records === 1 ? '' : 's'} · {agg.labourCount} worker{agg.labourCount === 1 ? '' : 's'}
                  </td>
                  <td className="px-2.5 py-2 text-right font-jbmono text-[13px] font-bold tabular-nums">{pcsFmt(agg.pcs)}</td>
                  <td></td>
                  <td className="px-2.5 py-2 text-right font-jbmono text-[13px] font-bold tabular-nums">{kg(agg.weight)}</td>
                  <td></td>
                  <td className="px-2.5 py-2 text-right font-jbmono text-[13px] font-bold tabular-nums">{inr(agg.amount)}</td>
                  <td></td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>

        {/* Mobile — card per record */}
        <div className="md:hidden divide-y divide-slate-100 border-t border-slate-100">
          {isLoading && <div className="px-4 py-10 text-center text-slate-400 text-sm">Loading…</div>}
          {!isLoading && data?.items.length === 0 && (
            <div className="px-4 py-10 text-center text-slate-400 text-sm">
              No production records{hasFilters ? ' for these filters' : ' yet'}.{' '}
              {!hasFilters && (
                <Link to="/production/new" className="font-medium text-brand-700 hover:text-brand-800">
                  Record your first one →
                </Link>
              )}
            </div>
          )}
          {data?.items.map((p) => (
            <div key={p.id} className="px-3 py-3 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="font-jbmono text-xs font-semibold text-slate-800">{p.poNumber}</span>
                    <CoreTypeChip coreType={p.coreType} />
                  </div>
                  <div className="mt-0.5 text-sm font-medium text-slate-900 truncate">
                    {hideNames
                      ? <span className="font-jbmono text-brand-700">{p.customerCode ?? '—'}</span>
                      : p.customerName}
                  </div>
                  <div className="mt-0.5 text-[11px] text-slate-500">
                    {formatDate(p.prodDate)} · {p.grade} · {p.material} · <span className="font-medium text-slate-600">{p.labourName}</span>
                  </div>
                  <div className="mt-0.5 font-jbmono text-xs text-slate-600 truncate">{p.measure}</div>
                </div>
                <div className="text-right shrink-0">
                  <div className="font-jbmono tabular-nums font-semibold text-sm">{pcsFmt(p.pcs)} pcs</div>
                  <div className="text-[10px] text-slate-500 font-jbmono tabular-nums">{kg(p.totalWeight)} kg</div>
                  {p.amount != null && (
                    <div className="text-[11px] font-jbmono text-brand-700 tabular-nums">{inr(p.amount)}</div>
                  )}
                </div>
              </div>
              <div className="flex justify-end gap-2 border-t border-slate-100 pt-2">
                <Link to={`/production/${p.id}`} className="btn-ghost border border-slate-300 text-sm flex-1 justify-center">
                  <Pencil className="h-4 w-4" /> Edit
                </Link>
                <button
                  onClick={() => onDelete(p)}
                  className="btn-ghost border border-red-200 text-red-600 text-sm flex-1 justify-center hover:bg-red-50"
                  disabled={remove.isPending}
                >
                  <Trash2 className="h-4 w-4" /> Delete
                </button>
              </div>
            </div>
          ))}
          {agg && data && data.items.length > 0 && (
            <div className="bg-brand-900 px-3 py-2.5 text-white">
              <div className="font-archivo text-[10.5px] font-extrabold uppercase tracking-wide text-brand-100/80">
                Total · {agg.records} record{agg.records === 1 ? '' : 's'} · {agg.labourCount} worker{agg.labourCount === 1 ? '' : 's'}
              </div>
              <div className="mt-1 grid grid-cols-3 gap-1.5 text-center">
                <div>
                  <div className="text-[9.5px] uppercase text-brand-100/70">Pcs</div>
                  <div className="font-jbmono text-sm font-bold tabular-nums">{pcsFmt(agg.pcs)}</div>
                </div>
                <div>
                  <div className="text-[9.5px] uppercase text-brand-100/70">Weight</div>
                  <div className="font-jbmono text-sm font-bold tabular-nums">{kg(agg.weight)}</div>
                </div>
                <div>
                  <div className="text-[9.5px] uppercase text-brand-100/70">Amount</div>
                  <div className="font-jbmono text-sm font-bold tabular-nums">{inr(agg.amount)}</div>
                </div>
              </div>
            </div>
          )}
        </div>

        {data && (
          <Pagination page={page} pageSize={pageSize} total={data.total} onPageChange={setPage} onPageSizeChange={changePageSize} />
        )}
      </ErpCard>
      {confirmDialog}
    </div>
  );
};
