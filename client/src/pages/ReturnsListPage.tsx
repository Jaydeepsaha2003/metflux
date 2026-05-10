// Returns list — shows all customer returns with their lifecycle status.
// Mobile: cards. Desktop: table. Filters by status + free-text search.
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Search, Plus, Loader2, Pencil, Trash2, RotateCcw } from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useConfirm } from '@/hooks/useConfirm';
import { Pagination } from '@/components/Pagination';

type ReturnStatus = 'PENDING' | 'RECEIVED' | 'IN_REWORK' | 'REDISPATCHED' | 'CLOSED' | 'CANCELLED';

type ReturnRow = {
  id: string;
  returnNumber: string;
  returnDate: string;
  referenceType: 'SO_NUMBER' | 'INVOICE_NUMBER' | 'WO_NUMBER';
  referenceValue: string;
  status: ReturnStatus;
  customerName: string | null;
  itemCount: number;
  totalPcs: number;
  reason: string | null;
  createdAt: string;
};

const STATUS_BADGE: Record<ReturnStatus, string> = {
  PENDING:      'bg-amber-50 text-amber-700 ring-1 ring-amber-200',
  RECEIVED:     'bg-blue-50 text-blue-700 ring-1 ring-blue-200',
  IN_REWORK:    'bg-violet-50 text-violet-700 ring-1 ring-violet-200',
  REDISPATCHED: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200',
  CLOSED:       'bg-slate-100 text-slate-600 ring-1 ring-slate-200',
  CANCELLED:    'bg-rose-50 text-rose-700 ring-1 ring-rose-200',
};

const STATUS_LABEL: Record<ReturnStatus, string> = {
  PENDING:      'Pending',
  RECEIVED:     'Received',
  IN_REWORK:    'In Rework',
  REDISPATCHED: 'Re-dispatched',
  CLOSED:       'Closed',
  CANCELLED:    'Cancelled',
};

const REF_LABEL = {
  SO_NUMBER:      'SO',
  INVOICE_NUMBER: 'Inv',
  WO_NUMBER:      'WO',
};

const fmt = (iso: string | null | undefined) => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
};

const PAGE_SIZE = 20;

export const ReturnsListPage = () => {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { confirm, confirmDialog } = useConfirm();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<'ALL' | ReturnStatus>('ALL');
  const [page, setPage] = useState(1);
  useEffect(() => { setPage(1); }, [search, status]);

  const { data, isLoading } = useQuery({
    queryKey: ['returns', search, status, page],
    queryFn: () =>
      api<{ items: ReturnRow[]; total: number }>(
        `/returns?status=${status}&page=${page}&pageSize=${PAGE_SIZE}${search ? `&search=${encodeURIComponent(search)}` : ''}`,
      ),
  });

  const del = useMutation({
    mutationFn: (id: string) => api(`/returns/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['returns'] }),
  });

  const handleDelete = async (row: ReturnRow) => {
    const ok = await confirm({
      title: 'Delete return?',
      message: <>Delete <strong>{row.returnNumber}</strong>? This cannot be undone.</>,
      tone: 'danger',
      confirmLabel: 'Delete',
    });
    if (ok) del.mutate(row.id);
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-xl font-bold tracking-tight flex items-center gap-2">
          <RotateCcw className="h-5 w-5 text-brand-600" /> Returns
        </h1>
        <Link to="/returns/new" className="btn-primary w-full sm:w-auto justify-center">
          <Plus className="h-4 w-4" /> New Return
        </Link>
      </div>

      {/* Filters */}
      <div className="card flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:p-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
          <input
            className="input pl-9"
            placeholder="Search return #, SO/Inv/WO #, customer, measure…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <select
          className="input sm:w-44"
          value={status}
          onChange={(e) => setStatus(e.target.value as 'ALL' | ReturnStatus)}
        >
          <option value="ALL">All statuses</option>
          <option value="PENDING">Pending</option>
          <option value="RECEIVED">Received</option>
          <option value="IN_REWORK">In Rework</option>
          <option value="REDISPATCHED">Re-dispatched</option>
          <option value="CLOSED">Closed</option>
          <option value="CANCELLED">Cancelled</option>
        </select>
      </div>

      <div className="card overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center gap-2 py-10 text-slate-400">
            <Loader2 className="h-5 w-5 animate-spin" /> Loading…
          </div>
        ) : !data?.items.length ? (
          <div className="py-10 text-center text-slate-400 text-sm">
            {search || status !== 'ALL' ? 'No matching returns.' : 'No returns yet — log your first one.'}
          </div>
        ) : (
          <>
            {/* Desktop / tablet — table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm whitespace-nowrap">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    <th className="px-4 py-3 text-left">Return #</th>
                    <th className="px-4 py-3 text-left">Date</th>
                    <th className="px-4 py-3 text-left">Customer</th>
                    <th className="px-4 py-3 text-left">Reference</th>
                    <th className="px-4 py-3 text-center">Items</th>
                    <th className="px-4 py-3 text-right">Pcs</th>
                    <th className="px-4 py-3 text-left">Status</th>
                    <th className="sticky right-0 bg-slate-50 px-4 py-3 text-right shadow-[-8px_0_12px_-4px_rgba(0,0,0,0.06)]">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.items.map((r) => (
                    <tr key={r.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-4 py-3 font-semibold text-brand-700">{r.returnNumber}</td>
                      <td className="px-4 py-3 text-slate-600">{fmt(r.returnDate)}</td>
                      <td className="px-4 py-3 font-medium">{r.customerName ?? '—'}</td>
                      <td className="px-4 py-3 text-slate-600 text-xs">
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 font-medium text-slate-700 mr-1.5">
                          {REF_LABEL[r.referenceType]}
                        </span>
                        <span className="font-mono">{r.referenceValue}</span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                          {r.itemCount}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums font-semibold">{r.totalPcs}</td>
                      <td className="px-4 py-3">
                        <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-medium', STATUS_BADGE[r.status])}>
                          {STATUS_LABEL[r.status]}
                        </span>
                      </td>
                      <td className="sticky right-0 bg-white px-4 py-3 shadow-[-8px_0_12px_-4px_rgba(0,0,0,0.06)]">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => navigate(`/returns/${r.id}`)}
                            title="Open"
                            className="rounded-lg p-1.5 text-slate-500 hover:bg-brand-50 hover:text-brand-700 transition-colors">
                            <Pencil className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => handleDelete(r)}
                            title="Delete"
                            className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600 transition-colors">
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile — card per row */}
            <div className="md:hidden divide-y divide-slate-100">
              {data.items.map((r) => (
                <div key={r.id} className="px-4 py-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="font-semibold text-sm text-brand-700">{r.returnNumber}</span>
                        <span className={cn('rounded-full px-1.5 py-0.5 text-[10px] font-medium shrink-0', STATUS_BADGE[r.status])}>
                          {STATUS_LABEL[r.status]}
                        </span>
                      </div>
                      <div className="mt-0.5 truncate font-medium text-sm text-slate-900">{r.customerName ?? '—'}</div>
                      <div className="mt-0.5 text-[11px] text-slate-500">
                        {fmt(r.returnDate)} · {r.itemCount} item{r.itemCount !== 1 ? 's' : ''} · {r.totalPcs} pcs
                      </div>
                      <div className="mt-1 text-[11px] text-slate-600">
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 font-medium text-slate-700 mr-1">
                          {REF_LABEL[r.referenceType]}
                        </span>
                        <span className="font-mono">{r.referenceValue}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        onClick={() => navigate(`/returns/${r.id}`)}
                        title="Open"
                        className="rounded-lg p-1.5 text-slate-500 hover:bg-brand-50 hover:text-brand-700">
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => handleDelete(r)}
                        title="Delete"
                        className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
        {data && (
          <Pagination page={page} pageSize={PAGE_SIZE} total={data.total} onPageChange={setPage} />
        )}
      </div>
      {confirmDialog}
    </div>
  );
};
