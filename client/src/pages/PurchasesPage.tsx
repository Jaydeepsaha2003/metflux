// Purchase Register — upload the accounting "Purchase Register" export, then
// browse supplier bills + debit notes. The register's "Other Amount" column is
// captured as TDS; negative rows are debit notes.
import { useEffect, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ShoppingCart, Upload, Loader2, Search, X, CheckCircle2, AlertTriangle, Trash2 } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { readXlsxMatrix } from '@/lib/excel';
import { cn } from '@/lib/cn';
import { Pagination } from '@/components/Pagination';
import { useConfirm } from '@/hooks/useConfirm';

type Purchase = {
  id: string; invoiceNumber: string; invoiceDate: string;
  supplierName: string; gstin: string | null; taxType: string | null;
  amount: number; purchaseAmount: number; taxableAmount: number;
  igst: number; cgst: number; sgst: number; gst: number; tds: number;
  docType: 'INVOICE' | 'DEBIT_NOTE';
};
type ListResp = { items: Purchase[]; total: number; page: number; pageSize: number; totals: { amount: number; tds: number; gst: number } };
type Summary = { total: number; totalAmount: number; gst: number; tds: number; debitNotes: number };
type ImportResult = { imported: number; skippedDuplicates: number; debitNotes: number; cancelled: number; totalInFile: number; errors: { invoiceNumber: string; message: string }[] };

type DocFilter = 'ALL' | 'INVOICE' | 'DEBIT_NOTE';
const PAGE_SIZE = 25;

const inr = (n: number) => '₹' + Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const fmtDate = (iso: string | null) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
};

export const PurchasesPage = () => {
  const qc = useQueryClient();
  const { confirm, confirmDialog } = useConfirm();
  const [search, setSearch] = useState('');
  const [docType, setDocType] = useState<DocFilter>('ALL');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [allMatching, setAllMatching] = useState(false);
  useEffect(() => { setPage(1); setSelected(new Set()); setAllMatching(false); }, [search, docType]);

  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data: summary } = useQuery({ queryKey: ['purchase-summary'], queryFn: () => api<Summary>('/purchases/summary') });
  const { data, isLoading } = useQuery({
    queryKey: ['purchases', search, docType, page],
    queryFn: () => api<ListResp>(`/purchases?docType=${docType}&page=${page}&pageSize=${PAGE_SIZE}${search ? `&search=${encodeURIComponent(search)}` : ''}`),
  });

  const refresh = () => { qc.invalidateQueries({ queryKey: ['purchases'] }); qc.invalidateQueries({ queryKey: ['purchase-summary'] }); };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploading(true); setError(null); setImportResult(null);
    try {
      const rows = await readXlsxMatrix(file);
      if (!rows.length) { setError('That file looks empty.'); return; }
      const res = await api<ImportResult>('/purchases/import', { method: 'POST', json: { rows } });
      setImportResult(res);
      refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Import failed — is this the purchase register export?');
    } finally {
      setUploading(false);
    }
  };

  const del = useMutation({ mutationFn: (id: string) => api(`/purchases/${id}`, { method: 'DELETE' }), onSuccess: refresh });
  const clearSel = () => { setSelected(new Set()); setAllMatching(false); };
  const bulkDel = useMutation({
    mutationFn: (payload: Record<string, unknown>) => api<{ deleted: number }>('/purchases/bulk-delete', { method: 'POST', json: payload }),
    onSuccess: () => { clearSel(); refresh(); },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Bulk delete failed'),
  });

  const items = data?.items ?? [];
  const pageIds = items.map((i) => i.id);
  const allPageSelected = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  const selCount = allMatching ? (data?.total ?? 0) : selected.size;
  const toggleOne = (id: string) => { setAllMatching(false); setSelected((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; }); };
  const toggleAllPage = () => { setAllMatching(false); setSelected((p) => { const n = new Set(p); if (pageIds.every((id) => n.has(id))) pageIds.forEach((id) => n.delete(id)); else pageIds.forEach((id) => n.add(id)); return n; }); };
  const doBulkDelete = async () => {
    if (!selCount) return;
    const ok = await confirm({ title: 'Delete purchase rows?', message: <>Delete <strong>{selCount}</strong> row{selCount === 1 ? '' : 's'}? This cannot be undone.</>, tone: 'danger', confirmLabel: `Delete ${selCount}` });
    if (!ok) return;
    if (allMatching) bulkDel.mutate({ all: true, docType, search: search || undefined });
    else bulkDel.mutate({ ids: [...selected] });
  };

  const totals = data?.totals;

  return (
    <div className="space-y-5">
      <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" onChange={onFile} className="hidden" />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight"><ShoppingCart className="h-5 w-5 text-brand-600" /> Purchase Register</h1>
        <button onClick={() => fileRef.current?.click()} disabled={uploading} className="btn-primary">
          {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />} Upload Purchase Register
        </button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card label="Total purchases" value={inr(summary?.totalAmount ?? 0)} tone="brand" />
        <Card label="Input GST" value={inr(summary?.gst ?? 0)} tone="muted" />
        <Card label="TDS (Other Amt.)" value={inr(summary?.tds ?? 0)} tone="muted" />
        <Card label="Debit notes" value={String(summary?.debitNotes ?? 0)} tone={summary && summary.debitNotes > 0 ? 'warning' : 'muted'} />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input className="input pl-9" placeholder="Search bill #, supplier or GSTIN…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        {(['ALL', 'INVOICE', 'DEBIT_NOTE'] as const).map((d) => (
          <button key={d} onClick={() => setDocType(d)}
            className={cn('rounded-full border px-3 py-1 text-xs font-medium transition', docType === d ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50')}>
            {d === 'ALL' ? 'All' : d === 'INVOICE' ? 'Bills' : 'Debit notes'}
          </button>
        ))}
      </div>

      {/* Selection toolbar */}
      {(selected.size > 0 || allMatching) && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-brand-200 bg-brand-50 px-3 py-2 text-sm">
          <span className="font-medium text-brand-800">{selCount} selected</span>
          {allMatching ? <span className="text-xs text-brand-700">All matching rows.</span>
            : allPageSelected && (data?.total ?? 0) > items.length ? (
              <button onClick={() => setAllMatching(true)} className="text-xs font-medium text-brand-700 underline">Select all {data?.total} matching</button>
            ) : null}
          <div className="ml-auto flex items-center gap-2">
            <button onClick={clearSel} className="btn-ghost text-slate-600">Clear</button>
            <button onClick={doBulkDelete} disabled={bulkDel.isPending} className="btn-danger">
              {bulkDel.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />} Delete {selCount}
            </button>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="card overflow-hidden">
        {isLoading ? (
          <div className="py-12 text-center text-slate-400"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></div>
        ) : !items.length ? (
          <div className="py-12 text-center text-sm text-slate-400">
            No purchase entries{search || docType !== 'ALL' ? ' match this filter.' : ' yet — upload your purchase register to begin.'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full whitespace-nowrap text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="w-8 px-3 py-2.5">
                    <input type="checkbox" className="h-4 w-4 cursor-pointer accent-brand-600" checked={allMatching || allPageSelected}
                      ref={(el) => { if (el) el.indeterminate = !allMatching && !allPageSelected && pageIds.some((id) => selected.has(id)); }}
                      onChange={toggleAllPage} />
                  </th>
                  <th className="px-3 py-2.5">Bill #</th>
                  <th className="px-3 py-2.5">Date</th>
                  <th className="px-3 py-2.5">Supplier</th>
                  <th className="px-3 py-2.5">GSTIN</th>
                  <th className="px-3 py-2.5 text-right">Taxable</th>
                  <th className="px-3 py-2.5 text-right">GST</th>
                  <th className="px-3 py-2.5 text-right">TDS</th>
                  <th className="px-3 py-2.5 text-right">Total</th>
                  <th className="px-3 py-2.5 text-center">Type</th>
                  <th className="px-3 py-2.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {items.map((p) => {
                  const checked = allMatching || selected.has(p.id);
                  const dn = p.docType === 'DEBIT_NOTE';
                  return (
                    <tr key={p.id} className={cn('border-t border-slate-100 hover:bg-slate-50/60', checked && 'bg-brand-50/40', !checked && dn && 'bg-rose-50/30')}>
                      <td className="px-3 py-2.5"><input type="checkbox" className="h-4 w-4 cursor-pointer accent-brand-600" checked={checked} onChange={() => toggleOne(p.id)} /></td>
                      <td className="px-3 py-2.5 font-medium text-slate-900">{p.invoiceNumber}</td>
                      <td className="px-3 py-2.5 text-slate-600">{fmtDate(p.invoiceDate)}</td>
                      <td className="px-3 py-2.5 text-slate-700">{p.supplierName}</td>
                      <td className="px-3 py-2.5 font-mono text-[11px] text-slate-500">{p.gstin ?? '—'}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-slate-500">{p.taxableAmount ? inr(p.taxableAmount) : '—'}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-slate-500"
                        title={p.gst ? `IGST ${inr(p.igst)} · CGST ${inr(p.cgst)} · SGST ${inr(p.sgst)}` : undefined}>
                        {p.gst ? inr(p.gst) : '—'}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-slate-500">{p.tds ? inr(p.tds) : '—'}</td>
                      <td className={cn('px-3 py-2.5 text-right font-medium tabular-nums', dn ? 'text-rose-700' : 'text-slate-900')}>{inr(p.amount)}</td>
                      <td className="px-3 py-2.5 text-center">
                        <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-medium', dn ? 'bg-rose-50 text-rose-700 ring-1 ring-rose-200' : 'bg-slate-100 text-slate-600')}>
                          {dn ? 'Debit note' : 'Bill'}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <button
                          onClick={async () => {
                            const ok = await confirm({ title: 'Delete entry?', message: <>Delete <strong>{p.invoiceNumber}</strong>?</>, tone: 'danger', confirmLabel: 'Delete' });
                            if (ok) del.mutate(p.id);
                          }}
                          className="btn-ghost text-red-600 hover:bg-red-50" title="Delete"><Trash2 className="h-4 w-4" /></button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              {totals && (
                <tfoot>
                  <tr className="border-t-2 border-slate-300 bg-slate-50 font-semibold">
                    <td className="px-3 py-2.5 text-slate-600" colSpan={6}>Page total ({data?.total} entries)</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{inr(totals.gst)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{inr(totals.tds)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{inr(totals.amount)}</td>
                    <td colSpan={2} />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )}
        {data && <Pagination page={page} pageSize={PAGE_SIZE} total={data.total} onPageChange={setPage} />}
      </div>

      {error && <Dialog title="Upload problem" tone="danger" onClose={() => setError(null)}><p className="text-sm text-slate-600">{error}</p></Dialog>}
      {importResult && (
        <Dialog title="Purchase register imported" tone="ok" onClose={() => setImportResult(null)}>
          <div className="space-y-1.5 text-sm">
            <Row k="Entries imported" v={importResult.imported} tone="ok" />
            <Row k="Debit notes" v={importResult.debitNotes} tone={importResult.debitNotes ? 'warning' : 'muted'} />
            <Row k="Cancelled (skipped)" v={importResult.cancelled} tone="muted" />
            <Row k="Skipped (already present)" v={importResult.skippedDuplicates} tone="muted" />
            {importResult.errors.length > 0 && (
              <div className="mt-2 max-h-40 overflow-y-auto rounded-lg border border-amber-200 bg-amber-50 text-xs">
                {importResult.errors.map((er, i) => <div key={i} className="border-b border-amber-200/60 px-2 py-1"><span className="font-medium">{er.invoiceNumber}</span> — {er.message}</div>)}
              </div>
            )}
          </div>
        </Dialog>
      )}
      {confirmDialog}
    </div>
  );
};

const Card = ({ label, value, tone }: { label: string; value: string; tone: 'brand' | 'warning' | 'muted' }) => {
  const c = tone === 'brand' ? 'border-brand-200 bg-brand-50' : tone === 'warning' ? 'border-amber-200 bg-amber-50' : 'border-slate-200 bg-white';
  const t = tone === 'brand' ? 'text-brand-700' : tone === 'warning' ? 'text-amber-700' : 'text-slate-900';
  return (
    <div className={cn('rounded-xl border p-3', c)}>
      <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className={cn('mt-1 text-xl font-bold tabular-nums', t)}>{value}</div>
    </div>
  );
};

const Row = ({ k, v, tone }: { k: string; v: number; tone: 'ok' | 'warning' | 'muted' }) => (
  <div className="flex items-center justify-between">
    <span className="text-slate-600">{k}</span>
    <span className={cn('font-bold tabular-nums', tone === 'ok' ? 'text-emerald-700' : tone === 'warning' ? 'text-amber-700' : 'text-slate-500')}>{v}</span>
  </div>
);

const Dialog = ({ title, tone, children, onClose }: { title: string; tone: 'ok' | 'danger'; children: React.ReactNode; onClose: () => void }) => (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
    <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-base font-bold text-slate-900">
          {tone === 'ok' ? <CheckCircle2 className="h-5 w-5 text-emerald-600" /> : <AlertTriangle className="h-5 w-5 text-red-600" />}{title}
        </h3>
        <button onClick={onClose} className="rounded p-1 text-slate-400 hover:bg-slate-100"><X className="h-4 w-4" /></button>
      </div>
      {children}
      <div className="mt-4 flex justify-end"><button onClick={onClose} className="btn-primary">Done</button></div>
    </div>
  </div>
);
