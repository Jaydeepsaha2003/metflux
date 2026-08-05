// All production records — flat table with search and per-row edit/delete.
// Mirrors the .NET Modify_Production grid.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Search, Pencil, Trash2, Factory, Download, Loader2 } from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useConfirm } from '@/hooks/useConfirm';
import { Pagination } from '@/components/Pagination';
import { downloadXlsx, todayStamp } from '@/lib/excel';
import { useHideCustomerNames } from '@/store/auth';

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
type ListResp = { items: Row[]; total: number };

const formatDate = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
};

const PAGE_SIZE = 20;

export const ProductionListPage = () => {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  useEffect(() => { setPage(1); }, [search]);
  const queryClient = useQueryClient();
  const { confirm, alert, confirmDialog } = useConfirm();
  const hideNames = useHideCustomerNames();

  const { data, isLoading } = useQuery({
    queryKey: ['production', search, page],
    queryFn: () => api<ListResp>(`/production?search=${encodeURIComponent(search)}&page=${page}&pageSize=${PAGE_SIZE}`),
  });

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
      const all = await api<ListResp>(
        `/production?search=${encodeURIComponent(search)}&page=1&pageSize=10000`
      );
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

  return (
    <div className="space-y-4 sm:space-y-5 max-w-[1400px]">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight flex items-center gap-2">
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

      <div className="card overflow-hidden">
        <div className="flex flex-col gap-2 border-b border-slate-200 px-4 py-3 sm:flex-row sm:items-center sm:gap-3">
          <div className="relative flex-1 w-full sm:max-w-md">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              className="input pl-9 w-full"
              placeholder="Search by PO#, customer, labour, measure, grade or material"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="text-xs text-slate-500 sm:ml-auto shrink-0">
            {data ? `${data.total} record${data.total === 1 ? '' : 's'}` : ''}
          </div>
        </div>

        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2.5 font-medium">Date</th>
                <th className="px-3 py-2.5 font-medium">PO #</th>
                <th className="px-3 py-2.5 font-medium">Customer</th>
                <th className="px-3 py-2.5 font-medium">Labour</th>
                <th className="px-3 py-2.5 font-medium">Type</th>
                <th className="px-3 py-2.5 font-medium">Grade</th>
                <th className="px-3 py-2.5 font-medium">Material</th>
                <th className="px-3 py-2.5 font-medium">Measure</th>
                <th className="px-3 py-2.5 font-medium text-right">Pcs</th>
                <th className="px-3 py-2.5 font-medium text-right">Wt/pc</th>
                <th className="px-3 py-2.5 font-medium text-right">Total Wt</th>
                <th className="px-3 py-2.5 font-medium text-right">Amount</th>
                <th className="w-24 px-3 py-2.5"></th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr><td colSpan={13} className="px-3 py-10 text-center text-slate-400">Loading…</td></tr>
              )}
              {!isLoading && data?.items.length === 0 && (
                <tr>
                  <td colSpan={13} className="px-3 py-10 text-center text-slate-400">
                    No production records yet.{' '}
                    <Link to="/production/new" className="text-brand-700 hover:text-brand-800 font-medium">
                      Record your first one →
                    </Link>
                  </td>
                </tr>
              )}
              {data?.items.map((p) => (
                <tr key={p.id} className="border-t border-slate-100 hover:bg-slate-50/60">
                  <td className="px-3 py-2 text-slate-600">{formatDate(p.prodDate)}</td>
                  <td className="px-3 py-2 font-mono text-xs">{p.poNumber}</td>
                  <td className="px-3 py-2">
                    <div className="font-mono text-xs font-semibold text-brand-700">{p.customerCode ?? '—'}</div>
                    {!hideNames && (
                      <div className="text-[11px] text-slate-500 truncate max-w-[180px]" title={p.customerName}>
                        {p.customerName}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2 font-medium">{p.labourName}</td>
                  <td className="px-3 py-2">
                    <span className={cn(
                      'rounded-full px-2 py-0.5 text-[11px] font-medium',
                      p.coreType === 'TOROIDAL' ? 'bg-amber-50 text-amber-700' : 'bg-rose-50 text-rose-700'
                    )}>
                      {p.coreType === 'TOROIDAL' ? 'Toro' : 'Rect'}
                    </span>
                  </td>
                  <td className="px-3 py-2">{p.grade}</td>
                  <td className="px-3 py-2">{p.material}</td>
                  <td className="px-3 py-2 font-mono text-xs">{p.measure}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{p.pcs}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">{p.weightPerPc.toFixed(3)}</td>
                  <td className="px-3 py-2 text-right font-mono font-semibold tabular-nums">{p.totalWeight.toFixed(3)}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-brand-700">
                    {p.amount != null ? `₹${p.amount.toFixed(2)}` : '—'}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <div className="inline-flex items-center gap-1">
                      <Link to={`/production/${p.id}`} className="btn-ghost text-brand-700 hover:bg-brand-50" title="Edit">
                        <Pencil className="h-4 w-4" />
                      </Link>
                      <button
                        onClick={async () => {
                          const ok = await confirm({
                            title: 'Delete production entry?',
                            message: <>Delete production entry of <strong>{p.pcs} pcs</strong> by <strong>{p.labourName}</strong>?</>,
                            tone: 'danger',
                            confirmLabel: 'Delete',
                          });
                          if (ok) remove.mutate(p.id);
                        }}
                        className="btn-ghost text-red-600 hover:bg-red-50"
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
          </table>
        </div>

        {/* Mobile — card per record */}
        <div className="md:hidden divide-y divide-slate-100">
          {isLoading && (
            <div className="px-4 py-10 text-center text-slate-400 text-sm">Loading…</div>
          )}
          {!isLoading && data?.items.length === 0 && (
            <div className="px-4 py-10 text-center text-slate-400 text-sm">
              No production records yet.{' '}
              <Link to="/production/new" className="text-brand-700 hover:text-brand-800 font-medium">
                Record your first one →
              </Link>
            </div>
          )}
          {data?.items.map((p) => (
            <div key={p.id} className="px-3 py-3 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-xs font-semibold text-slate-800">{p.poNumber}</span>
                    <span className={cn(
                      'rounded-full px-1.5 py-0.5 text-[10px] font-medium',
                      p.coreType === 'TOROIDAL' ? 'bg-amber-50 text-amber-700' : 'bg-rose-50 text-rose-700'
                    )}>
                      {p.coreType === 'TOROIDAL' ? 'Toro' : 'Rect'}
                    </span>
                    <span className="text-xs text-slate-700 font-medium">{p.grade}</span>
                  </div>
                  <div className="mt-0.5 text-sm font-medium text-slate-900 truncate">
                    {hideNames
                      ? <span className="font-mono text-brand-700">{p.customerCode ?? '—'}</span>
                      : p.customerName}
                  </div>
                  <div className="mt-0.5 text-[11px] text-slate-500">
                    {formatDate(p.prodDate)} · {p.material} · <span className="font-medium text-slate-600">{p.labourName}</span>
                  </div>
                  <div className="mt-0.5 font-mono text-xs text-slate-600 truncate">{p.measure}</div>
                </div>
                <div className="text-right shrink-0">
                  <div className="tabular-nums font-semibold text-sm">{p.pcs} pcs</div>
                  <div className="text-[10px] text-slate-500 tabular-nums">{p.totalWeight.toFixed(3)} kg</div>
                  {p.amount != null && (
                    <div className="text-[11px] font-mono text-brand-700 tabular-nums">₹{p.amount.toFixed(2)}</div>
                  )}
                </div>
              </div>
              <div className="flex justify-end gap-2 border-t border-slate-100 pt-2">
                <Link
                  to={`/production/${p.id}`}
                  className="btn-ghost border border-slate-300 text-sm flex-1 justify-center"
                >
                  <Pencil className="h-4 w-4" /> Edit
                </Link>
                <button
                  onClick={async () => {
                    const ok = await confirm({
                      title: 'Delete production entry?',
                      message: <>Delete production entry of <strong>{p.pcs} pcs</strong> by <strong>{p.labourName}</strong>?</>,
                      tone: 'danger',
                      confirmLabel: 'Delete',
                    });
                    if (ok) remove.mutate(p.id);
                  }}
                  className="btn-ghost border border-red-200 text-red-600 text-sm flex-1 justify-center hover:bg-red-50"
                  disabled={remove.isPending}
                >
                  <Trash2 className="h-4 w-4" /> Delete
                </button>
              </div>
            </div>
          ))}
        </div>

        {data && (
          <Pagination page={page} pageSize={PAGE_SIZE} total={data.total} onPageChange={setPage} />
        )}
      </div>
      {confirmDialog}
    </div>
  );
};
