// Quotations list — browse / search saved quotations, print, convert to a Sales
// Order, or delete. Mirrors the Sales Order manage page.
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileText, Plus, Search, Loader2, Printer, ArrowRightLeft, Trash2, CheckCircle2, XCircle, Pencil } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useConfirm } from '@/hooks/useConfirm';

type Row = {
  id: string;
  quotationNo: string;
  quotationDate: string;
  validUntil: string | null;
  status: 'OPEN' | 'CONVERTED' | 'CANCELLED';
  convertedPoOrderId: string | null;
  customer: { id: string; name: string };
  itemsAmount: number;
  _count: { items: number };
};

const fmtDate = (iso: string | null) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? String(iso) : d.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
};
const money0 = (n: number) => Math.round(n || 0).toLocaleString('en-IN');

const STATUS_STYLE: Record<Row['status'], string> = {
  OPEN: 'bg-blue-50 text-blue-700',
  CONVERTED: 'bg-emerald-50 text-emerald-700',
  CANCELLED: 'bg-slate-100 text-slate-500',
};

export const QuotationsPage = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { confirm, confirmDialog } = useConfirm();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<'ALL' | 'OPEN' | 'CONVERTED' | 'CANCELLED'>('ALL');
  const [busyId, setBusyId] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['quotations', search, status],
    queryFn: () => api<{ items: Row[] }>(`/quotations?pageSize=200&status=${status}${search ? `&search=${encodeURIComponent(search)}` : ''}`),
  });
  const rows = data?.items ?? [];

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['quotations'] });

  const convertMut = useMutation({
    mutationFn: (id: string) => api<{ poOrderId: string; poNumber: string }>(`/quotations/${id}/convert`, { method: 'POST', body: '{}' }),
  });
  const deleteMut = useMutation({
    mutationFn: (id: string) => api(`/quotations/${id}`, { method: 'DELETE' }),
    onSuccess: invalidate,
  });

  const onConvert = async (r: Row) => {
    const ok = await confirm({
      title: `Convert ${r.quotationNo} to a Sales Order?`,
      message: `A new Sales Order will be created for ${r.customer.name} with all ${r._count.items} item(s). The quotation is then marked Converted. This does not affect production or accounts until the Sales Order is worked.`,
      confirmLabel: 'Convert',
    });
    if (!ok) return;
    setBusyId(r.id);
    try {
      const res = await convertMut.mutateAsync(r.id);
      invalidate();
      queryClient.invalidateQueries({ queryKey: ['po-orders'] });
      await confirm({ title: 'Converted', message: `Sales Order ${res.poNumber} created.`, alertOnly: true, confirmLabel: 'Open Sales Order' });
      navigate('/po/manage');
    } catch (e) {
      await confirm({ title: 'Could not convert', message: e instanceof ApiError ? e.message : 'Conversion failed.', tone: 'danger', alertOnly: true, confirmLabel: 'OK' });
    } finally { setBusyId(null); }
  };

  const onDelete = async (r: Row) => {
    const ok = await confirm({ title: `Delete ${r.quotationNo}?`, message: 'This permanently removes the quotation. This cannot be undone.', tone: 'danger', confirmLabel: 'Delete' });
    if (ok) deleteMut.mutate(r.id);
  };

  return (
    <div className="space-y-4 sm:space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight sm:text-2xl">
          <FileText className="h-5 w-5 text-brand-600" /> Quotations
        </h1>
        <Link to="/quotation/new" className="btn-primary w-full sm:w-auto"><Plus className="h-4 w-4" /> New Quotation</Link>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input className="input h-9 w-full pl-8 text-sm" placeholder="Search number, customer, item…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <select className="input h-9 w-full text-sm sm:w-44" value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
          <option value="ALL">All statuses</option>
          <option value="OPEN">Open</option>
          <option value="CONVERTED">Converted</option>
          <option value="CANCELLED">Cancelled</option>
        </select>
      </div>

      {isLoading ? (
        <div className="rounded-xl border border-slate-200 bg-white p-4 py-14 text-center text-slate-400 sm:p-5"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-4 py-14 text-center text-sm text-slate-400 sm:p-5">No quotations yet. Click <span className="font-medium">New Quotation</span> to create one.</div>
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden overflow-x-auto rounded-xl border border-slate-200 bg-white md:block">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500">
                  <th className="px-3 py-2.5">Quotation No.</th>
                  <th className="px-3 py-2.5">Date</th>
                  <th className="px-3 py-2.5">Customer</th>
                  <th className="px-3 py-2.5 text-center">Items</th>
                  <th className="px-3 py-2.5 text-right">Amount</th>
                  <th className="px-3 py-2.5 text-center">Status</th>
                  <th className="px-3 py-2.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/60">
                    <td className="px-3 py-2.5">
                      <Link to={`/quotation/${r.id}/print`} className="font-mono font-medium text-brand-700 hover:underline">{r.quotationNo}</Link>
                    </td>
                    <td className="px-3 py-2.5 text-slate-600">{fmtDate(r.quotationDate)}</td>
                    <td className="px-3 py-2.5 font-medium text-slate-800">{r.customer.name}</td>
                    <td className="px-3 py-2.5 text-center tabular-nums text-slate-600">{r._count.items}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums font-semibold">₹{money0(r.itemsAmount)}</td>
                    <td className="px-3 py-2.5 text-center">
                      <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium', STATUS_STYLE[r.status])}>
                        {r.status === 'CONVERTED' ? <CheckCircle2 className="h-3 w-3" /> : r.status === 'CANCELLED' ? <XCircle className="h-3 w-3" /> : null}
                        {r.status.charAt(0) + r.status.slice(1).toLowerCase()}
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center justify-end gap-1">
                        <Link to={`/quotation/${r.id}/print`} title="Print / PDF" className="rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800"><Printer className="h-4 w-4" /></Link>
                        {r.status === 'OPEN' && (
                          <Link to={`/quotation/${r.id}/edit`} title="Edit quotation" className="rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-brand-700"><Pencil className="h-4 w-4" /></Link>
                        )}
                        {r.status === 'OPEN' && (
                          <button type="button" onClick={() => onConvert(r)} disabled={busyId === r.id} title="Convert to Sales Order"
                            className="rounded p-1.5 text-emerald-600 hover:bg-emerald-50 disabled:opacity-50">
                            {busyId === r.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRightLeft className="h-4 w-4" />}
                          </button>
                        )}
                        <button type="button" onClick={() => onDelete(r)} title="Delete" className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"><Trash2 className="h-4 w-4" /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile stacked cards */}
          <div className="space-y-3 md:hidden">
            {rows.map((r) => (
              <div key={r.id} className="rounded-xl border border-slate-200 bg-white p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <Link to={`/quotation/${r.id}/print`} className="font-mono font-medium text-brand-700 hover:underline">{r.quotationNo}</Link>
                    <div className="mt-0.5 truncate font-medium text-slate-800">{r.customer.name}</div>
                  </div>
                  <span className={cn('inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium', STATUS_STYLE[r.status])}>
                    {r.status === 'CONVERTED' ? <CheckCircle2 className="h-3 w-3" /> : r.status === 'CANCELLED' ? <XCircle className="h-3 w-3" /> : null}
                    {r.status.charAt(0) + r.status.slice(1).toLowerCase()}
                  </span>
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2 text-sm">
                  <div>
                    <div className="text-[11px] uppercase tracking-wide text-slate-400">Date</div>
                    <div className="text-slate-600">{fmtDate(r.quotationDate)}</div>
                  </div>
                  <div className="text-center">
                    <div className="text-[11px] uppercase tracking-wide text-slate-400">Items</div>
                    <div className="tabular-nums text-slate-600">{r._count.items}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-[11px] uppercase tracking-wide text-slate-400">Amount</div>
                    <div className="tabular-nums font-semibold">₹{money0(r.itemsAmount)}</div>
                  </div>
                </div>
                <div className="mt-3 flex items-center justify-end gap-1 border-t border-slate-100 pt-3">
                  <Link to={`/quotation/${r.id}/print`} title="Print / PDF" className="rounded p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-800"><Printer className="h-4 w-4" /></Link>
                  {r.status === 'OPEN' && (
                    <Link to={`/quotation/${r.id}/edit`} title="Edit quotation" className="rounded p-2 text-slate-500 hover:bg-slate-100 hover:text-brand-700"><Pencil className="h-4 w-4" /></Link>
                  )}
                  {r.status === 'OPEN' && (
                    <button type="button" onClick={() => onConvert(r)} disabled={busyId === r.id} title="Convert to Sales Order"
                      className="rounded p-2 text-emerald-600 hover:bg-emerald-50 disabled:opacity-50">
                      {busyId === r.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRightLeft className="h-4 w-4" />}
                    </button>
                  )}
                  <button type="button" onClick={() => onDelete(r)} title="Delete" className="rounded p-2 text-slate-400 hover:bg-red-50 hover:text-red-600"><Trash2 className="h-4 w-4" /></button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
      {confirmDialog}
    </div>
  );
};

export default QuotationsPage;
