// Bills Payable — upload a Tally "Amount Payable" export, match each party to its
// purchase bills (by name), and see how the file's closing balance compares to
// what the system shows as pending. For parties where the system shows MORE
// pending than the file (paid but not yet recorded), one supplier payment is
// posted that clears the oldest bills down to exactly the file balance.
//
// Nothing is written until you review the table and press "Post".
import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  CreditCard, Loader2, Upload, CheckCircle2, AlertTriangle, ArrowUpFromLine, MinusCircle,
} from 'lucide-react';
import { api } from '@/lib/api';
import { readXlsxMatrix } from '@/lib/excel';
import { cn } from '@/lib/cn';
import { useConfirm } from '@/hooks/useConfirm';

type PreviewItem = {
  name: string;
  matched: boolean;
  supplierKey?: string;
  supplierName?: string;
  fileBalance?: number;
  systemPending?: number;
  adjustment?: number;
  action?: 'post' | 'ok' | 'shortfall';
};
type Preview = {
  asOn: string | null;
  defaultReference: string;
  items: PreviewItem[];
  summary: {
    total: number; matched: number; unmatched: number;
    toPost: number; alreadyOk: number; shortfalls: number;
    fileTotal: number; postTotal: number;
  };
};
type PostResult = { recorded: number; allocated: number; errors: { supplierKey: string; name?: string; message: string }[] };

const inr = (n: number | undefined) =>
  '₹' + Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const round2 = (n: number) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

export const BillsPayablePage = () => {
  const qc = useQueryClient();
  const { confirm, confirmDialog } = useConfirm();
  const fileRef = useRef<HTMLInputElement>(null);

  const [preview, setPreview] = useState<Preview | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadErr, setUploadErr] = useState<string | null>(null);
  const [paymentDate, setPaymentDate] = useState(todayISO());
  const [reference, setReference] = useState('');
  // supplierKey -> included in the post (defaults to true for every 'post' row)
  const [included, setIncluded] = useState<Record<string, boolean>>({});
  const [result, setResult] = useState<PostResult | null>(null);

  const handleFile = async (file: File) => {
    setUploading(true); setUploadErr(null); setResult(null); setPreview(null);
    try {
      const rows = await readXlsxMatrix(file);
      const data = await api<Preview>('/bills-payable/preview', { method: 'POST', body: JSON.stringify({ rows }) });
      setPreview(data);
      setPaymentDate(data.asOn ?? todayISO());
      setReference(data.defaultReference);
      const inc: Record<string, boolean> = {};
      for (const it of data.items) if (it.action === 'post' && it.supplierKey) inc[it.supplierKey] = true;
      setIncluded(inc);
    } catch (e) {
      setUploadErr(e instanceof Error ? e.message : 'Could not read the file');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const postMutation = useMutation({
    mutationFn: (entries: { supplierKey: string; amount: number }[]) =>
      api<PostResult>('/bills-payable/post', {
        method: 'POST',
        body: JSON.stringify({ paymentDate, reference: reference || null, entries }),
      }),
    onSuccess: (r) => {
      setResult(r);
      qc.invalidateQueries({ queryKey: ['purchases'] });
      setPreview(null);
    },
  });

  const postRows = (preview?.items ?? []).filter((x) => x.action === 'post' && x.supplierKey);
  const selected = postRows.filter((x) => included[x.supplierKey!]);
  const selectedTotal = selected.reduce((s, x) => s + (x.adjustment ?? 0), 0);

  const handlePost = async () => {
    const ok = await confirm({
      title: 'Post reconciling payments?',
      message: <>This records <strong>{selected.length}</strong> supplier payment{selected.length !== 1 ? 's' : ''} totalling <strong>{inr(selectedTotal)}</strong>, clearing each party down to its file balance.</>,
      confirmLabel: 'Post payments',
    });
    if (!ok) return;
    postMutation.mutate(selected.map((x) => ({ supplierKey: x.supplierKey!, amount: round2(x.adjustment ?? 0) })));
  };

  return (
    <div className="space-y-6 max-w-full">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight flex items-center gap-2">
            <CreditCard className="h-5 w-5 text-brand-600" /> Bills Payable
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Upload the “Amount Payable” export to reconcile supplier balances against the system.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
          />
          <button onClick={() => fileRef.current?.click()} disabled={uploading} className="btn-primary text-sm">
            {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            Upload Payable File
          </button>
        </div>
      </div>

      {uploadErr && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{uploadErr}</div>
      )}

      {/* ── Post result ── */}
      {result && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          <div className="flex items-center gap-2 font-medium">
            <CheckCircle2 className="h-4 w-4" /> Posted {result.recorded} payment{result.recorded !== 1 ? 's' : ''} · {inr(result.allocated)} allocated.
          </div>
          {result.errors.length > 0 && (
            <ul className="mt-2 list-disc pl-5 text-xs text-amber-700">
              {result.errors.map((er, i) => <li key={i}>{er.name ?? er.supplierKey}: {er.message}</li>)}
            </ul>
          )}
          <div className="mt-2 text-xs">
            Cleared bills now show as paid under <Link to="/accounts/purchases" className="font-medium underline">Purchase Register</Link>.
          </div>
        </div>
      )}

      {/* ── Preview ── */}
      {preview && (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Stat label="Parties in file" value={String(preview.summary.total)} />
            <Stat label="Matched" value={String(preview.summary.matched)} tone="emerald" />
            <Stat label="Unmatched" value={String(preview.summary.unmatched)} tone={preview.summary.unmatched ? 'amber' : undefined} />
            <Stat label="To post" value={String(preview.summary.toPost)} tone="brand" />
            <Stat label="Already ok" value={String(preview.summary.alreadyOk)} />
            <Stat label="Shortfalls" value={String(preview.summary.shortfalls)} tone={preview.summary.shortfalls ? 'red' : undefined} />
          </div>

          {/* Post controls */}
          <div className="card flex flex-col gap-3 p-4 sm:flex-row sm:items-end sm:justify-between">
            <div className="grid grid-cols-2 gap-3 sm:flex sm:items-end sm:gap-4">
              <label className="block">
                <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-slate-500">Payment date</span>
                <input type="date" className="input" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} />
              </label>
              <label className="block sm:w-72">
                <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-slate-500">Reference</span>
                <input className="input" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Payable reconciliation" />
              </label>
            </div>
            <div className="flex items-center gap-3">
              <div className="text-right">
                <div className="text-[11px] uppercase tracking-wide text-slate-500">Will post</div>
                <div className="text-lg font-bold tabular-nums">{inr(selectedTotal)}</div>
              </div>
              <button
                onClick={handlePost}
                disabled={postMutation.isPending || selected.length === 0}
                className="btn-primary text-sm"
              >
                {postMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUpFromLine className="h-4 w-4" />}
                Post {selected.length} payment{selected.length !== 1 ? 's' : ''}
              </button>
            </div>
          </div>

          {/* Review table */}
          <div className="card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm whitespace-nowrap">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    <th className="px-3 py-3 w-10"></th>
                    <th className="px-4 py-3 text-left">Party (in file)</th>
                    <th className="px-4 py-3 text-left">Matched supplier</th>
                    <th className="px-4 py-3 text-right">System pending</th>
                    <th className="px-4 py-3 text-right">File balance</th>
                    <th className="px-4 py-3 text-right">Will post</th>
                    <th className="px-4 py-3 text-left">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {preview.items.map((it, i) => {
                    const canPost = it.action === 'post' && it.supplierKey;
                    const isOn = canPost ? !!included[it.supplierKey!] : false;
                    return (
                      <tr key={i} className={cn(!it.matched && 'bg-amber-50/40', it.action === 'shortfall' && 'bg-red-50/40')}>
                        <td className="px-3 py-2.5 text-center">
                          {canPost && (
                            <input
                              type="checkbox" checked={isOn}
                              onChange={() => setIncluded((p) => ({ ...p, [it.supplierKey!]: !p[it.supplierKey!] }))}
                              className="rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                            />
                          )}
                        </td>
                        <td className="px-4 py-2.5 font-medium">{it.name}</td>
                        <td className="px-4 py-2.5 text-slate-600">
                          {it.matched ? it.supplierName : <span className="text-amber-600">— no bills found —</span>}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-slate-600">{it.matched ? inr(it.systemPending) : '—'}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums font-medium">{inr(it.fileBalance)}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums font-semibold">
                          {it.action === 'post' ? inr(it.adjustment) : '—'}
                        </td>
                        <td className="px-4 py-2.5"><StatusPill item={it} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {(preview.summary.unmatched > 0 || preview.summary.shortfalls > 0) && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800 space-y-1">
              {preview.summary.unmatched > 0 && (
                <p><strong>{preview.summary.unmatched} unmatched</strong> — these party names have no purchase bills in the system. Import their purchases first, then re-upload.</p>
              )}
              {preview.summary.shortfalls > 0 && (
                <p><strong>{preview.summary.shortfalls} shortfall(s)</strong> — the file shows more owed than the system knows (a missing bill or opening balance). A payment can’t clear these; they’re left untouched.</p>
              )}
            </div>
          )}
        </>
      )}

      {confirmDialog}
    </div>
  );
};

const Stat = ({ label, value, tone }: { label: string; value: string; tone?: 'emerald' | 'amber' | 'red' | 'brand' }) => (
  <div className="card p-3">
    <div className="text-[11px] uppercase tracking-wide text-slate-500">{label}</div>
    <div className={cn('mt-0.5 text-xl font-bold tabular-nums',
      tone === 'emerald' && 'text-emerald-600',
      tone === 'amber' && 'text-amber-600',
      tone === 'red' && 'text-red-600',
      tone === 'brand' && 'text-brand-700',
    )}>{value}</div>
  </div>
);

const StatusPill = ({ item }: { item: PreviewItem }) => {
  if (!item.matched) return <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700"><AlertTriangle className="h-3 w-3" /> Unmatched</span>;
  if (item.action === 'ok') return <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600"><CheckCircle2 className="h-3 w-3" /> Already matches</span>;
  if (item.action === 'shortfall') return <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-medium text-red-700"><MinusCircle className="h-3 w-3" /> Shortfall</span>;
  return <span className="inline-flex items-center gap-1 rounded-full bg-brand-100 px-2 py-0.5 text-[11px] font-medium text-brand-700"><ArrowUpFromLine className="h-3 w-3" /> Will clear</span>;
};
