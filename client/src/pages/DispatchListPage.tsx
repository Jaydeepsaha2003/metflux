import '@/components/dispatch-workspace.css';
// All dispatch records — flat table with search and per-row edit/delete.
import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Search, Pencil, Trash2, Truck, FileText } from 'lucide-react';
import { api } from '@/lib/api';
import { useDebounced } from '@/hooks/useDebounced';
import { cn } from '@/lib/cn';
import { useConfirm } from '@/hooks/useConfirm';
import { Pagination } from '@/components/Pagination';
import { DateRangeFilter } from '@/components/DateRangeFilter';
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
  dispatchDate: string;
  pcs: number;
  weightPerPc: number;
  totalWeight: number;
  vehicleNo: string | null;
  amount: number | null;
};
type ListResp = { items: Row[]; total: number };

const formatDate = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
};

const PAGE_SIZE = 20;

export const DispatchListPage = () => {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounced(search);
  const [sort, setSort] = useState<'date' | 'customer'>('date');
  const [sp] = useSearchParams();
  const [from, setFrom] = useState(sp.get('from') ?? '');
  const [to, setTo] = useState(sp.get('to') ?? '');
  const customerId = sp.get('customerId') ?? '';
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZE);
  const changePageSize = (n: number) => { setPageSize(n); setPage(1); };
  useEffect(() => { setPage(1); }, [search, sort, from, to]);
  const queryClient = useQueryClient();
  const hideNames = useHideCustomerNames();

  const { data, isLoading } = useQuery({
    queryKey: ['dispatch', debouncedSearch, page, pageSize, sort, from, to, customerId],
    queryFn: () => api<ListResp>(`/dispatch?search=${encodeURIComponent(debouncedSearch)}&page=${page}&pageSize=${pageSize}&sort=${sort}${from ? `&from=${from}` : ''}${to ? `&to=${to}` : ''}${customerId ? `&customerId=${customerId}` : ''}`),
    // Keep the current rows visible while the next result loads, instead of
    // dropping the table back to "Loading…" on every filter or page change.
    placeholderData: keepPreviousData,
  });

  const remove = useMutation({
    mutationFn: (id: string) => api(`/dispatch/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['dispatch'] }),
  });
  const { confirm, confirmDialog } = useConfirm();

  return (
    <div className="dispatch-workspace dispatch-register space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Truck className="h-5 w-5 text-brand-600" /> Modify Dispatch
        </h1>
        <Link to="/dispatch/new" className="btn-primary">
          <Plus className="h-4 w-4" /> New Dispatch
        </Link>
      </div>

      <div className="card overflow-hidden">
        <div className="dispatch-filterbar flex flex-wrap items-center gap-3 border-b border-slate-200 px-4 py-3">
          <div className="relative flex-1 max-w-md">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              className="input pl-9"
              placeholder="Search by PO#, customer, vehicle, measure, grade or material"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <DateRangeFilter from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t); }} label="Filter dispatch by date" />
          <div className="ml-auto flex items-center gap-2">
            <div className="flex items-center gap-1.5 text-xs text-slate-500">
              <span className="hidden sm:inline">Sort by</span>
              <div className="flex rounded-lg border border-slate-200 p-0.5">
                {(['date', 'customer'] as const).map((s) => (
                  <button
                    key={s}
                    onClick={() => setSort(s)}
                    className={cn(
                      'rounded-md px-2.5 py-1 text-xs font-medium transition',
                      sort === s ? 'bg-brand-600 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100',
                    )}
                  >
                    {s === 'date' ? 'Date' : 'Customer'}
                  </button>
                ))}
              </div>
            </div>
            <div className="text-xs text-slate-500">
              {data ? `${data.total} record${data.total === 1 ? '' : 's'}` : ''}
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full whitespace-nowrap text-[13px] font-semibold">
            <thead className="bg-slate-50 text-left text-[10.5px] uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2.5 font-semibold">Date</th>
                <th className="px-3 py-2.5 font-semibold">PO #</th>
                <th className="px-3 py-2.5 font-semibold">Customer</th>
                <th className="px-3 py-2.5 font-semibold">Type</th>
                <th className="px-3 py-2.5 font-semibold">Grade</th>
                <th className="px-3 py-2.5 font-semibold">Material</th>
                <th className="px-3 py-2.5 font-semibold">Measure</th>
                <th className="px-3 py-2.5 font-semibold">Vehicle</th>
                <th className="px-3 py-2.5 text-right font-semibold">Pcs</th>
                <th className="px-3 py-2.5 text-right font-semibold">Total Wt</th>
                <th className="px-3 py-2.5 text-right font-semibold">Amount</th>
                <th className="w-24 px-3 py-2.5"></th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr><td data-label="Details" colSpan={12} className="px-3 py-10 text-center text-slate-400">Loading…</td></tr>
              )}
              {!isLoading && data?.items.length === 0 && (
                <tr>
                  <td data-label="Details" colSpan={12} className="px-3 py-10 text-center text-slate-400">
                    No dispatch records yet.{' '}
                    <Link to="/dispatch/new" className="text-brand-700 hover:text-brand-800 font-medium">
                      Create your first dispatch →
                    </Link>
                  </td>
                </tr>
              )}
              {data?.items.map((d, idx, arr) => {
                // When sorting by customer, draw a heavier divider where the
                // customer changes so each customer's dispatches read as a group.
                const newGroup = sort === 'customer' && idx > 0 && arr[idx - 1].customerName !== d.customerName;
                return (
                <tr key={d.id} className={cn('hover:bg-slate-50/60', newGroup ? 'border-t-2 border-slate-300' : 'border-t border-slate-100')}>
                  <td data-label="Date" className="px-3 py-2 text-slate-600">{formatDate(d.dispatchDate)}</td>
                  <td data-label="PO #" className="px-3 py-2 font-mono">{d.poNumber}</td>
                  <td data-label="Customer" className="px-3 py-2">
                    <div className="font-mono text-brand-700">{d.customerCode ?? '—'}</div>
                    {!hideNames && (
                      <div className="text-slate-500">{d.customerName}</div>
                    )}
                  </td>
                  <td data-label="Type" className="px-3 py-2">
                    <span className={cn(
                      'rounded-full px-2 py-0.5',
                      d.coreType === 'TOROIDAL' ? 'bg-amber-50 text-amber-700' : 'bg-rose-50 text-rose-700'
                    )}>
                      {d.coreType === 'TOROIDAL' ? 'Toro' : 'Rect'}
                    </span>
                  </td>
                  <td data-label="Grade" className="px-3 py-2">{d.grade}</td>
                  <td data-label="Material" className="px-3 py-2">{d.material}</td>
                  <td data-label="Measure" className="px-3 py-2 font-mono">{d.measure}</td>
                  <td data-label="Vehicle" className="px-3 py-2 text-slate-600">{d.vehicleNo ?? '—'}</td>
                  <td data-label="Pcs" className="px-3 py-2 text-right tabular-nums">{d.pcs}</td>
                  <td data-label="Total Wt" className="px-3 py-2 text-right font-mono tabular-nums">{d.totalWeight.toFixed(3)}</td>
                  <td data-label="Amount" className="px-3 py-2 text-right font-mono tabular-nums text-brand-700">
                    {d.amount != null ? `₹${d.amount.toFixed(2)}` : '—'}
                  </td>
                  <td data-label="Actions" className="px-3 py-2 text-right">
                    <div className="inline-flex items-center gap-1">
                      <button onClick={() => navigate('/packing-list', { state: { dispatchIds: [d.id] } })} className="btn-ghost text-emerald-700 hover:bg-emerald-50" title="Packing List">
                        <FileText className="h-4 w-4" />
                      </button>
                      <Link to={`/dispatch/${d.id}`} className="btn-ghost text-brand-700 hover:bg-brand-50" title="Edit">
                        <Pencil className="h-4 w-4" />
                      </Link>
                      <button
                        onClick={async () => {
                          const ok = await confirm({
                            title: 'Delete dispatch?',
                            message: <>Delete dispatch of <strong>{d.pcs} pcs</strong> for SO <strong>{d.poNumber}</strong>?</>,
                            tone: 'danger',
                            confirmLabel: 'Delete',
                          });
                          if (ok) remove.mutate(d.id);
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
                );
              })}
            </tbody>
          </table>
        </div>
        {data && (
          <Pagination page={page} pageSize={pageSize} total={data.total} onPageChange={setPage} onPageSizeChange={changePageSize} />
        )}
      </div>
      {confirmDialog}
    </div>
  );
};
