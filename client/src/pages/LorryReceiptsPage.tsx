// Lorry Receipts (LR / transport consignment) record book — browse / search
// saved LRs, print, edit, delete, and export the current list to Excel.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Truck, Plus, Search, Pencil, Trash2, FileText, Loader2, Download } from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useConfirm } from '@/hooks/useConfirm';
import { Pagination } from '@/components/Pagination';
import { downloadXlsx, todayStamp } from '@/lib/excel';
import { type LorryReceipt, inrLR } from '@/lib/lr';

const PAGE_SIZE = 20;

const fmtDate = (iso: string | null) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? String(iso)
    : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
};

const PAY_STYLE: Record<LorryReceipt['paymentMode'], string> = {
  'TO-PAY': 'bg-amber-50 text-amber-700',
  PAID: 'bg-emerald-50 text-emerald-700',
  TBB: 'bg-slate-100 text-slate-500',
};

export const LorryReceiptsPage = () => {
  const queryClient = useQueryClient();
  const { confirm, confirmDialog } = useConfirm();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  const { data, isLoading } = useQuery({
    queryKey: ['lorry-receipts', page, search],
    queryFn: () =>
      api<{ items: LorryReceipt[]; total: number; page: number; pageSize: number }>(
        `/lorry-receipts?page=${page}&pageSize=${PAGE_SIZE}${search ? `&search=${encodeURIComponent(search)}` : ''}`,
      ),
  });
  const rows = data?.items ?? [];

  const deleteMut = useMutation({
    mutationFn: (id: string) => api(`/lorry-receipts/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['lorry-receipts'] }),
  });

  const onDelete = async (r: LorryReceipt) => {
    const ok = await confirm({
      title: `Delete ${r.lrNo}?`,
      message: 'This permanently removes the lorry receipt. This cannot be undone.',
      tone: 'danger',
      confirmLabel: 'Delete',
    });
    if (ok) deleteMut.mutate(r.id);
  };

  const onExport = () => {
    const exportRows = rows.map((r) => ({
      'LR No': r.lrNo,
      Date: fmtDate(r.lrDate),
      Consignor: r.consignorName,
      Consignee: r.consigneeName,
      From: r.fromLoc ?? '',
      To: r.toLoc ?? '',
      Packages: r.packages,
      Method: r.packMethod ?? '',
      Particular: r.particular ?? '',
      'Actual Wt': r.actualWt,
      'Charged Wt': r.chargedWt,
      Rate: r.rate,
      Total: r.totalValue,
      'Inv No': r.invNo ?? '',
      'E-Way': r.ewayBillNo ?? '',
      Vehicle: r.vehNo ?? '',
      'Pay Mode': r.paymentMode,
    }));
    downloadXlsx(`lorry-receipts-${todayStamp()}`, 'Lorry Receipts', exportRows);
  };

  return (
    <div className="space-y-4 sm:space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight sm:text-2xl">
          <Truck className="h-5 w-5 text-brand-600" /> Lorry Receipts
        </h1>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <button
            type="button"
            onClick={onExport}
            disabled={rows.length === 0}
            title="Download the current list as Excel"
            className="btn-ghost w-full text-emerald-700 hover:bg-emerald-50 disabled:opacity-50 sm:w-auto"
          >
            <Download className="h-4 w-4" /> Excel
          </button>
          <Link to="/lr/new" className="btn-primary w-full sm:w-auto"><Plus className="h-4 w-4" /> New LR</Link>
        </div>
      </div>

      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input
          className="input h-9 w-full pl-8 text-sm"
          placeholder="Search LR #, consignor, consignee, vehicle, invoice…"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
        />
      </div>

      {isLoading ? (
        <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-400">
          <Loader2 className="mx-auto h-5 w-5 animate-spin" />
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-400">
          No lorry receipts yet. Click <span className="font-medium">New LR</span> to create one.
        </div>
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden overflow-x-auto rounded-xl border border-slate-200 bg-white md:block">
            <table className="w-full min-w-[900px] text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500">
                  <th className="px-3 py-2.5">LR No</th>
                  <th className="px-3 py-2.5">Date</th>
                  <th className="px-3 py-2.5">Consignor</th>
                  <th className="px-3 py-2.5">Consignee</th>
                  <th className="px-3 py-2.5">Route</th>
                  <th className="px-3 py-2.5 text-center">Pkgs</th>
                  <th className="px-3 py-2.5 text-right">Total</th>
                  <th className="px-3 py-2.5 text-center">Pay</th>
                  <th className="px-3 py-2.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/60">
                    <td className="px-3 py-2.5">
                      <Link to={`/lr/${r.id}/print`} className="font-mono font-medium text-brand-700 hover:underline">{r.lrNo}</Link>
                    </td>
                    <td className="px-3 py-2.5 text-slate-600">{fmtDate(r.lrDate)}</td>
                    <td className="px-3 py-2.5 font-medium text-slate-800">{r.consignorName}</td>
                    <td className="px-3 py-2.5 text-slate-700">{r.consigneeName}</td>
                    <td className="px-3 py-2.5 text-slate-600">{(r.fromLoc || '—')} → {(r.toLoc || '—')}</td>
                    <td className="px-3 py-2.5 text-center tabular-nums text-slate-600">{r.packages}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums font-semibold">₹{inrLR(r.totalValue)}</td>
                    <td className="px-3 py-2.5 text-center">
                      <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium', PAY_STYLE[r.paymentMode])}>
                        {r.paymentMode}
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center justify-end gap-1">
                        <Link to={`/lr/${r.id}/print`} title="Print / PDF" className="rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800"><FileText className="h-4 w-4" /></Link>
                        <Link to={`/lr/${r.id}/edit`} title="Edit LR" className="rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-brand-700"><Pencil className="h-4 w-4" /></Link>
                        <button type="button" onClick={() => onDelete(r)} title="Delete" className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"><Trash2 className="h-4 w-4" /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pagination page={page} pageSize={PAGE_SIZE} total={data?.total ?? 0} onPageChange={setPage} />
          </div>

          {/* Mobile stacked cards */}
          <div className="space-y-3 md:hidden">
            {rows.map((r) => (
              <div key={r.id} className="rounded-xl border border-slate-200 bg-white p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <Link to={`/lr/${r.id}/print`} className="font-mono font-medium text-brand-700 hover:underline">{r.lrNo}</Link>
                    <div className="mt-0.5 truncate font-medium text-slate-800">{r.consignorName}</div>
                    <div className="truncate text-sm text-slate-600">→ {r.consigneeName}</div>
                  </div>
                  <span className={cn('inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-medium', PAY_STYLE[r.paymentMode])}>
                    {r.paymentMode}
                  </span>
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2 text-sm">
                  <div>
                    <div className="text-[11px] uppercase tracking-wide text-slate-400">Date</div>
                    <div className="text-slate-600">{fmtDate(r.lrDate)}</div>
                  </div>
                  <div className="text-center">
                    <div className="text-[11px] uppercase tracking-wide text-slate-400">Pkgs</div>
                    <div className="tabular-nums text-slate-600">{r.packages}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-[11px] uppercase tracking-wide text-slate-400">Total</div>
                    <div className="tabular-nums font-semibold">₹{inrLR(r.totalValue)}</div>
                  </div>
                </div>
                <div className="mt-2 text-sm text-slate-600">
                  <span className="text-[11px] uppercase tracking-wide text-slate-400">Route </span>
                  {(r.fromLoc || '—')} → {(r.toLoc || '—')}
                </div>
                <div className="mt-3 flex items-center justify-end gap-1 border-t border-slate-100 pt-3">
                  <Link to={`/lr/${r.id}/print`} title="Print / PDF" className="rounded p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-800"><FileText className="h-4 w-4" /></Link>
                  <Link to={`/lr/${r.id}/edit`} title="Edit LR" className="rounded p-2 text-slate-500 hover:bg-slate-100 hover:text-brand-700"><Pencil className="h-4 w-4" /></Link>
                  <button type="button" onClick={() => onDelete(r)} title="Delete" className="rounded p-2 text-slate-400 hover:bg-red-50 hover:text-red-600"><Trash2 className="h-4 w-4" /></button>
                </div>
              </div>
            ))}
            <Pagination page={page} pageSize={PAGE_SIZE} total={data?.total ?? 0} onPageChange={setPage} />
          </div>
        </>
      )}
      {confirmDialog}
    </div>
  );
};

export default LorryReceiptsPage;
