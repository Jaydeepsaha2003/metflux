// Proforma invoices — the register: find one, open it, download it as Excel, delete it.
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, Download, FileSpreadsheet, FileText, Loader2, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useConfirm } from '@/hooks/useConfirm';
import { fmtMoney } from '@/lib/currency';
import { downloadSavedPi } from '@/lib/proformaApi';

type Row = { id: string; piNumber: string; piDate: string; validUntil: string | null; currency: string; buyerName: string; grandTotal: number };

const dmy = (iso: string | null) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '—');

const DAY = 86_400_000;
/** Where a PI stands against its "valid until" date — the thing the sender needs to chase. */
const validity = (iso: string | null): { label: string; cls: string; state: 'open' | 'expired' | 'none' } => {
  if (!iso) return { label: 'No expiry', cls: 'bg-slate-100 text-slate-500', state: 'none' };
  const left = Math.round((new Date(iso).getTime() - new Date(new Date().toISOString().slice(0, 10)).getTime()) / DAY);
  if (left < 0) return { label: `Expired ${-left}d ago`, cls: 'bg-red-50 text-red-700', state: 'expired' };
  if (left === 0) return { label: 'Expires today', cls: 'bg-amber-50 text-amber-700', state: 'open' };
  if (left <= 7) return { label: `${left}d left`, cls: 'bg-amber-50 text-amber-700', state: 'open' };
  return { label: `${left}d left`, cls: 'bg-emerald-50 text-emerald-700', state: 'open' };
};

export const ProformaListPage = () => {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { confirm, confirmDialog } = useConfirm();
  const [search, setSearch] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['proforma-invoices', search],
    queryFn: () => api<{ items: Row[] }>(`/proforma-invoices?pageSize=200${search ? `&search=${encodeURIComponent(search)}` : ''}`),
  });
  const rows = data?.items ?? [];
  const stats = useMemo(() => {
    const byCur = new Map<string, number>();
    rows.forEach((r) => byCur.set(r.currency, (byCur.get(r.currency) ?? 0) + r.grandTotal));
    return {
      open: rows.filter((r) => validity(r.validUntil).state !== 'expired').length,
      expired: rows.filter((r) => validity(r.validUntil).state === 'expired').length,
      byCur: [...byCur.entries()].sort((a, b) => b[1] - a[1]),
    };
  }, [rows]);

  const del = useMutation({
    mutationFn: (id: string) => api(`/proforma-invoices/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['proforma-invoices'] }),
  });

  const download = async (r: Row, kind: 'xlsx' | 'pdf') => {
    setBusyId(r.id);
    try { await downloadSavedPi(r.id, kind); }
    catch (e) { await confirm({ title: 'Could not download', message: e instanceof ApiError ? e.message : 'The Excel sheet could not be built.', tone: 'danger', alertOnly: true, confirmLabel: 'OK' }); }
    finally { setBusyId(null); }
  };

  const remove = async (r: Row) => {
    const ok = await confirm({ title: `Delete ${r.piNumber}?`, message: 'This proforma invoice will be removed. It cannot be undone.', tone: 'danger', confirmLabel: 'Delete' });
    if (ok) del.mutate(r.id);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">
            <FileSpreadsheet className="h-5 w-5 text-brand-600" /> Proforma Invoices
          </h1>
          <p className="mt-0.5 text-sm text-slate-500">Export proforma invoices — one click to an Excel sheet ready to print or send.</p>
        </div>
        <Link to="/proforma/new" className="btn-primary"><Plus className="h-4 w-4" /> New Proforma Invoice</Link>
      </div>

      {rows.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="card px-4 py-3"><div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Proforma invoices</div><div className="mt-0.5 text-2xl font-bold tabular-nums text-slate-900">{rows.length}</div></div>
          <div className="card px-4 py-3">
            <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Validity</div>
            <div className="mt-0.5 flex items-baseline gap-3"><span className="text-2xl font-bold tabular-nums text-emerald-600">{stats.open}<span className="ml-1 text-xs font-medium text-slate-500">valid</span></span>
              <span className={cn('text-lg font-bold tabular-nums', stats.expired ? 'text-red-600' : 'text-slate-300')}>{stats.expired}<span className="ml-1 text-xs font-medium text-slate-500">expired</span></span></div>
          </div>
          <div className="card px-4 py-3">
            <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Value quoted</div>
            <div className="mt-0.5 flex flex-wrap gap-x-4 gap-y-0.5">{stats.byCur.map(([c, v]) => <span key={c} className="text-lg font-bold tabular-nums text-slate-900">{fmtMoney(v, c)}<span className="ml-1 text-[10px] font-medium text-slate-400">{c}</span></span>)}</div>
          </div>
        </div>
      )}

      <div className="relative max-w-md">
        <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input className="input h-9 w-full pl-8 text-sm" placeholder="Search PI number or buyer…" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      <div className="card overflow-hidden">
        {isLoading ? (
          <div className="py-14 text-center text-slate-400"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></div>
        ) : rows.length === 0 ? (
          <div className="py-14 text-center text-sm text-slate-400">No proforma invoices yet. Click <span className="font-medium">New Proforma Invoice</span> to create one.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500">
                  <th className="px-3 py-2.5">PI No.</th><th className="px-3 py-2.5">Date</th><th className="px-3 py-2.5">Validity</th>
                  <th className="px-3 py-2.5">Buyer</th><th className="px-3 py-2.5 text-right">Total</th><th className="px-3 py-2.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} onDoubleClick={() => navigate(`/proforma/${r.id}/edit`)} className="cursor-default border-b border-slate-100 last:border-0 hover:bg-brand-50/30">
                    <td className="px-3 py-2.5"><Link to={`/proforma/${r.id}/edit`} className="font-num font-medium text-brand-700 hover:underline">{r.piNumber}</Link></td>
                    <td className="px-3 py-2.5 text-slate-600">{dmy(r.piDate)}</td>
                    <td className="px-3 py-2.5">
                      <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium', validity(r.validUntil).cls)} title={r.validUntil ? `Valid until ${dmy(r.validUntil)}` : undefined}>
                        <CalendarClock className="h-3 w-3" /> {validity(r.validUntil).label}
                      </span>
                      {r.validUntil && <div className="mt-0.5 text-[11px] text-slate-400">until {dmy(r.validUntil)}</div>}
                    </td>
                    <td className="px-3 py-2.5 font-medium text-slate-800">{r.buyerName}</td>
                    <td className="px-3 py-2.5 text-right font-semibold tabular-nums">{fmtMoney(r.grandTotal, r.currency)} <span className="text-[10px] font-normal text-slate-400">{r.currency}</span></td>
                    <td className="px-3 py-2.5">
                      <div className="flex justify-end gap-1">
                        <button type="button" onClick={() => download(r, 'pdf')} disabled={busyId === r.id} title="Download PDF"
                          className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-50">
                          <FileText className="h-3.5 w-3.5" /> PDF
                        </button>
                        <button type="button" onClick={() => download(r, 'xlsx')} disabled={busyId === r.id} title="Download Excel"
                          className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-50 disabled:opacity-50">
                          {busyId === r.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />} Excel
                        </button>
                        <button type="button" onClick={() => navigate(`/proforma/${r.id}/edit`)} title="Edit" className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><Pencil className="h-4 w-4" /></button>
                        <button type="button" onClick={() => remove(r)} title="Delete" className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"><Trash2 className="h-4 w-4" /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {confirmDialog}
    </div>
  );
};
