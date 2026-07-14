// Accounts → Journal. Upload a Busy/Tally-style Journal Register (CSV/Excel);
// each balanced voucher's Dr/Cr lines are stored and shown here grouped by
// voucher, and flow into the account ledger + Amount Receivable/Payable by
// account name.
import { useState, Fragment } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { BookText, Loader2, Upload, Search, Download, Trash2, CheckCircle2, AlertTriangle } from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { readXlsxMatrix, downloadXlsx, todayStamp } from '@/lib/excel';
import { useConfirm } from '@/hooks/useConfirm';

type Line = { account: string; side: 'DEBIT' | 'CREDIT'; amount: number };
type Voucher = {
  batchId: string; date: string | null; refNo: string | null;
  taxable: number | null; igst: number | null; cgst: number | null; sgst: number | null;
  lines: Line[]; debit: number; credit: number;
};
type Totals = { debit: number; credit: number; taxable: number; igst: number; cgst: number; sgst: number; count: number };

const inr = (n: number | null | undefined) => (n ? Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '');
const fmtD = (iso: string | null) => { if (!iso) return ''; const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' }); };

export const JournalRegisterPage = () => {
  const qc = useQueryClient();
  const { confirm, confirmDialog } = useConfirm();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [search, setSearch] = useState('');
  const [uploading, setUploading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const qs = new URLSearchParams();
  if (from) qs.set('from', from);
  if (to) qs.set('to', to);
  if (search.trim()) qs.set('search', search.trim());
  const { data, isLoading } = useQuery({
    queryKey: ['journal', from, to, search],
    queryFn: () => api<{ items: Voucher[]; totals: Totals }>(`/journal?${qs.toString()}`),
  });

  const invalidate = () => ['journal', 'cashbook-ledger', 'debtor-aging', 'creditor-aging'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));

  const onFile = async (file: File) => {
    setUploading(true); setErr(null); setMsg(null);
    try {
      const matrix = await readXlsxMatrix(file);
      const r = await api<{ vouchers: number; lines: number; unbalanced: number }>('/journal/import', { method: 'POST', body: JSON.stringify({ rows: matrix }) });
      setMsg(`Imported ${r.vouchers} voucher${r.vouchers === 1 ? '' : 's'} (${r.lines} lines)${r.unbalanced ? ` · ⚠ ${r.unbalanced} unbalanced` : ''}.`);
      invalidate();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not import the file.');
    } finally { setUploading(false); }
  };

  const clearAll = useMutation({
    mutationFn: () => api<{ deleted: number }>('/journal/clear', { method: 'POST' }),
    onSuccess: () => { setMsg(null); invalidate(); },
  });
  const onClear = async () => {
    const ok = await confirm({ title: 'Clear the journal?', message: <>Delete <b>all</b> imported journal vouchers for this company? Re-upload the register to restore.</>, tone: 'danger', confirmLabel: 'Clear' });
    if (ok) clearAll.mutate();
  };

  const items = data?.items ?? [];
  const t = data?.totals;

  const exportExcel = () => {
    if (!items.length) return;
    const rows: Record<string, string | number>[] = [];
    for (const v of items) {
      v.lines.forEach((l, i) => rows.push({
        Date: i === 0 ? fmtD(v.date) : '', 'Vch No': i === 0 ? (v.refNo ?? '') : '',
        Account: l.account, 'Debit': l.side === 'DEBIT' ? l.amount : '', 'Credit': l.side === 'CREDIT' ? l.amount : '',
        Taxable: i === 0 && v.taxable ? v.taxable : '', IGST: i === 0 && v.igst ? v.igst : '', CGST: i === 0 && v.cgst ? v.cgst : '', SGST: i === 0 && v.sgst ? v.sgst : '',
      }));
    }
    if (t) rows.push({ Date: '', 'Vch No': '', Account: 'TOTAL', Debit: t.debit, Credit: t.credit, Taxable: t.taxable, IGST: t.igst, CGST: t.cgst, SGST: t.sgst });
    downloadXlsx(`journal-register-${todayStamp()}`, 'Journal', rows);
  };

  return (
    <div className="max-w-full space-y-4 text-[13px]">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-bold tracking-tight">
            <BookText className="h-5 w-5 text-brand-600" /> Journal
          </h1>
          <p className="mt-0.5 text-xs text-slate-500">Upload your Journal Register — each balanced voucher posts to the account ledger &amp; Amount Receivable / Payable.</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={onClear} disabled={clearAll.isPending || !items.length} className="btn-ghost border border-slate-300 text-red-600 hover:bg-red-50 text-sm disabled:opacity-50">
            {clearAll.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />} Clear
          </button>
          <button onClick={exportExcel} disabled={!items.length} className="btn-ghost border border-slate-300 text-emerald-700 hover:bg-emerald-50 text-sm disabled:opacity-50">
            <Download className="h-4 w-4" /> Excel
          </button>
          <label className="btn-primary cursor-pointer text-sm">
            {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />} Upload register
            <input type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ''; }} />
          </label>
        </div>
      </div>

      {msg && <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800"><CheckCircle2 className="h-4 w-4" /> {msg}</div>}
      {err && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{err}</div>}

      {/* Filters + totals strip */}
      <div className="card flex flex-col gap-3 p-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="grid grid-cols-2 gap-2 sm:flex sm:items-end sm:gap-3">
          <label className="block"><span className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-slate-500">From</span>
            <input type="date" className="input h-8 text-xs" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
          <label className="block"><span className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-slate-500">To</span>
            <input type="date" className="input h-8 text-xs" value={to} onChange={(e) => setTo(e.target.value)} /></label>
          <label className="col-span-2 block sm:w-64"><span className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-slate-500">Search account / voucher</span>
            <div className="relative"><Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <input className="input h-8 pl-8 text-xs" placeholder="Account or Vch no…" value={search} onChange={(e) => setSearch(e.target.value)} /></div></label>
        </div>
        {t && (
          <div className="flex gap-4 text-right">
            <div><div className="text-[10px] uppercase tracking-wide text-slate-400">Vouchers</div><div className="text-sm font-bold tabular-nums">{t.count}</div></div>
            <div><div className="text-[10px] uppercase tracking-wide text-slate-400">Debit</div><div className="text-sm font-bold tabular-nums text-slate-800">₹{inr(t.debit)}</div></div>
            <div><div className="text-[10px] uppercase tracking-wide text-slate-400">Credit</div><div className="text-sm font-bold tabular-nums text-slate-800">₹{inr(t.credit)}</div></div>
          </div>
        )}
      </div>

      <div className="card overflow-hidden">
        {isLoading ? (
          <div className="py-12 text-center text-slate-400"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></div>
        ) : !items.length ? (
          <div className="py-12 text-center text-sm text-slate-400">No journal entries. Click <b>Upload register</b> to import your Journal Register.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs whitespace-nowrap">
              <thead><tr className="border-b border-slate-200 bg-slate-50 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                <th className="px-3 py-1.5 text-left">Date</th>
                <th className="px-2 py-1.5 text-left">Vch</th>
                <th className="px-3 py-1.5 text-left">Account</th>
                <th className="px-3 py-1.5 text-right">Debit</th>
                <th className="px-3 py-1.5 text-right">Credit</th>
                <th className="px-3 py-1.5 text-right">Taxable</th>
                <th className="px-3 py-1.5 text-right">IGST</th>
                <th className="px-3 py-1.5 text-right">CGST</th>
                <th className="px-3 py-1.5 text-right">SGST</th>
              </tr></thead>
              <tbody>
                {items.map((v) => {
                  const bad = Math.abs(v.debit - v.credit) > 1;
                  return (
                    <Fragment key={v.batchId}>
                      {v.lines.map((l, i) => (
                        <tr key={v.batchId + ':' + i} className={cn(i === 0 && 'border-t-2 border-slate-200', 'hover:bg-slate-50/50')}>
                          <td className="px-3 py-1 text-slate-600">{i === 0 ? fmtD(v.date) : ''}</td>
                          <td className="px-2 py-1 font-mono text-[11px] text-brand-700">{i === 0 ? (v.refNo ?? '') : ''}</td>
                          <td className={cn('px-3 py-1', l.side === 'CREDIT' && 'pl-6 text-slate-600')}>
                            {l.account}
                            {i === 0 && bad && <AlertTriangle className="ml-1 inline h-3 w-3 text-amber-500" aria-label="voucher not balanced" />}
                          </td>
                          <td className="px-3 py-1 text-right tabular-nums">{l.side === 'DEBIT' ? inr(l.amount) : ''}</td>
                          <td className="px-3 py-1 text-right tabular-nums">{l.side === 'CREDIT' ? inr(l.amount) : ''}</td>
                          <td className="px-3 py-1 text-right tabular-nums text-slate-500">{i === 0 ? inr(v.taxable) : ''}</td>
                          <td className="px-3 py-1 text-right tabular-nums text-slate-500">{i === 0 ? inr(v.igst) : ''}</td>
                          <td className="px-3 py-1 text-right tabular-nums text-slate-500">{i === 0 ? inr(v.cgst) : ''}</td>
                          <td className="px-3 py-1 text-right tabular-nums text-slate-500">{i === 0 ? inr(v.sgst) : ''}</td>
                        </tr>
                      ))}
                    </Fragment>
                  );
                })}
              </tbody>
              {t && (
                <tfoot>
                  <tr className="border-t-2 border-slate-300 bg-slate-50 font-bold">
                    <td className="px-3 py-1.5" colSpan={3}>Total</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">₹{inr(t.debit)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">₹{inr(t.credit)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-slate-600">{inr(t.taxable)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-slate-600">{inr(t.igst)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-slate-600">{inr(t.cgst)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-slate-600">{inr(t.sgst)}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )}
      </div>
      {confirmDialog}
    </div>
  );
};

export default JournalRegisterPage;
