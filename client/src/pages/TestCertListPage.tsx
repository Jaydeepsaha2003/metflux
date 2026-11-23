// Register of export test certificates. Tick several (e.g. every size on one PI) to
// download them as one PDF, a page per certificate, like the KANHSEEI sample.
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ClipboardCheck, Copy, FileText, Loader2, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useConfirm } from '@/hooks/useConfirm';
import { useDebounced } from '@/hooks/useDebounced';
import { usePiSettings } from '@/lib/proformaApi';
import { brandColorFor } from '@/lib/brandColor';
import { useBranding } from '@/store/branding';
import { downloadTestCertPdf } from '@/lib/testCertPdf';
import { fromRecord, type TcForm } from '@/lib/testCert';

type Row = { id: string; certNo: string; certDate: string; customer: string; piRef: string; sizeLabel: string; result: '' | 'ACCEPTED' | 'REJECTED' };
const dmy = (iso: string) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '');

export const TestCertListPage = () => {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { confirm, confirmDialog } = useConfirm();
  const { settings, company } = usePiSettings();
  const [search, setSearch] = useState('');
  const q = useDebounced(search);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['test-certificates', q],
    queryFn: () => api<{ items: Row[]; total: number }>(`/test-certificates?pageSize=200${q ? `&search=${encodeURIComponent(q)}` : ''}`),
  });
  const rows = data?.items ?? [];

  const remove = useMutation({
    mutationFn: (id: string) => api(`/test-certificates/${id}`, { method: 'DELETE' }),
    onSuccess: (_d, id) => { setPicked((p) => { const n = new Set(p); n.delete(id); return n; }); qc.invalidateQueries({ queryKey: ['test-certificates'] }); },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Could not delete'),
  });
  const onDelete = async (r: Row) => {
    if (await confirm({ title: 'Delete test certificate?', message: <>Delete <strong>{r.certNo}</strong> ({r.sizeLabel} mm)? This cannot be undone.</>, tone: 'danger', confirmLabel: 'Delete' })) remove.mutate(r.id);
  };

  /** Certificates download in register order (newest first), oldest number first on paper. */
  const download = async (ids: string[], key: string) => {
    if (!settings || !ids.length) return;
    setBusy(key); setError('');
    try {
      const recs = await Promise.all(ids.map((id) => api<{ certNo: string; certDate: string; data: Partial<TcForm> }>(`/test-certificates/${id}`)));
      const certs = recs.map(fromRecord).sort((a, b) => a.certNo.localeCompare(b.certNo, undefined, { numeric: true }));
      await downloadTestCertPdf(certs, settings, { name: company?.name ?? 'Company', logoUrl: company?.logoUrl }, brandColorFor(company?.name) ?? useBranding.getState().brandColor);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not build the PDF');
    } finally { setBusy(null); }
  };

  const allOn = rows.length > 0 && rows.every((r) => picked.has(r.id));
  const toggle = (id: string) => setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const badge = (r: Row['result']) => r === 'ACCEPTED' ? 'bg-emerald-100 text-emerald-700' : r === 'REJECTED' ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-500';

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight text-slate-900 sm:text-2xl"><ClipboardCheck className="h-5 w-5 text-brand-600" /> Test Certificates</h1>
        <Link to="/test-certificates/new" className="btn-primary"><Plus className="h-4 w-4" /> New Test Certificate</Link>
      </div>

      <div className="card overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 px-3 py-3 sm:px-4">
          <div className="relative min-w-0 flex-1 sm:max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input className="input pl-9" placeholder="Search no., customer, PI, size" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <button type="button" disabled={!picked.size || !!busy} onClick={() => download([...picked], 'bulk')}
            className="btn-ghost border border-slate-300 text-rose-700 hover:bg-rose-50 disabled:opacity-40">
            {busy === 'bulk' ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />} Download {picked.size || ''} selected as one PDF
          </button>
        </div>
        {error && <div role="alert" className="border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>}
        {isLoading ? (
          <div className="py-14 text-center text-slate-400"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></div>
        ) : rows.length === 0 ? (
          <div className="py-14 text-center text-sm text-slate-400">No test certificates yet. Click <span className="font-medium">New Test Certificate</span>, or start one from a proforma invoice.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500">
                  <th className="w-10 px-3 py-2.5"><input type="checkbox" aria-label="Select all" checked={allOn} onChange={() => setPicked(allOn ? new Set() : new Set(rows.map((r) => r.id)))} /></th>
                  <th className="px-3 py-2.5">Certificate No.</th><th className="px-3 py-2.5">Date</th><th className="px-3 py-2.5">Customer</th>
                  <th className="px-3 py-2.5">PI No.</th><th className="px-3 py-2.5">Size (mm)</th><th className="px-3 py-2.5">Result</th><th className="px-3 py-2.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className={cn('border-b border-slate-100 last:border-0 hover:bg-brand-50/30', picked.has(r.id) && 'bg-brand-50/40')}>
                    <td className="px-3 py-2.5"><input type="checkbox" aria-label={`Select ${r.certNo}`} checked={picked.has(r.id)} onChange={() => toggle(r.id)} /></td>
                    <td className="px-3 py-2.5"><Link to={`/test-certificates/${r.id}/edit`} className="font-num font-medium text-brand-700 hover:underline">{r.certNo}</Link></td>
                    <td className="px-3 py-2.5 text-slate-600">{dmy(r.certDate)}</td>
                    <td className="px-3 py-2.5 font-medium text-slate-800">{r.customer}</td>
                    <td className="px-3 py-2.5 font-num text-slate-600">{r.piRef || '—'}</td>
                    <td className="px-3 py-2.5 tabular-nums text-slate-700">{r.sizeLabel}</td>
                    <td className="px-3 py-2.5"><span className={cn('rounded-full px-2 py-0.5 text-[11px] font-semibold', badge(r.result))}>{r.result || 'No readings'}</span></td>
                    <td className="px-3 py-2.5">
                      <div className="flex justify-end gap-1">
                        <button type="button" onClick={() => download([r.id], r.id)} disabled={!!busy} title="Download PDF"
                          className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-50">
                          {busy === r.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileText className="h-3.5 w-3.5" />} PDF
                        </button>
                        <button type="button" onClick={() => navigate(`/test-certificates/new?copy=${r.id}`)} title="New certificate for another size (same customer & PI)" aria-label={`Next size from ${r.certNo}`} className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-brand-700"><Copy className="h-4 w-4" /></button>
                        <button type="button" onClick={() => navigate(`/test-certificates/${r.id}/edit`)} title="Edit" aria-label={`Edit ${r.certNo}`} className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><Pencil className="h-4 w-4" /></button>
                        <button type="button" onClick={() => onDelete(r)} title="Delete" aria-label={`Delete ${r.certNo}`} className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"><Trash2 className="h-4 w-4" /></button>
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
