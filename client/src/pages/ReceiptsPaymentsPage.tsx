// Receipts & Payments — upload the bank/cash book once. Receipts knock off each
// customer's oldest sales invoices; payments knock off each supplier's oldest
// purchase bills (FIFO). Unmatched rows (salaries/expenses) are listed & ignored.
// Nothing is written until you review and press Post.
import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeftRight, Loader2, Upload, CheckCircle2, AlertTriangle, ArrowDownToLine, ArrowUpFromLine,
} from 'lucide-react';
import { api } from '@/lib/api';
import { readXlsxMatrix } from '@/lib/excel';
import { cn } from '@/lib/cn';
import { useConfirm } from '@/hooks/useConfirm';

type ReceiptItem = { customerId: string; name: string; code?: string; amount: number; systemPending: number; willApply: number };
type PaymentItem = { supplierKey: string; name: string; amount: number; systemPending: number; willApply: number };
type Unmatched = { side: 'RECEIPT' | 'PAYMENT'; name: string; amount: number };
type Preview = {
  asOn: string | null;
  receipts: ReceiptItem[];
  payments: PaymentItem[];
  unmatched: Unmatched[];
  summary: {
    receiptCount: number; paymentCount: number; unmatchedCount: number;
    receiptTotal: number; paymentTotal: number;
    receiptApply: number; paymentApply: number; unmatchedTotal: number;
  };
};
type PostResult = {
  receipts: number; payments: number;
  allocatedReceipts: number; allocatedPayments: number;
  errors: { side: string; ref: string; message: string }[];
};

const inr = (n: number | undefined) =>
  '₹' + Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

export const ReceiptsPaymentsPage = () => {
  const qc = useQueryClient();
  const { confirm, confirmDialog } = useConfirm();
  const fileRef = useRef<HTMLInputElement>(null);

  const [preview, setPreview] = useState<Preview | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadErr, setUploadErr] = useState<string | null>(null);
  const [paymentDate, setPaymentDate] = useState(todayISO());
  const [reference, setReference] = useState('Receipts & Payments import');
  const [rcvOn, setRcvOn] = useState<Record<string, boolean>>({});
  const [payOn, setPayOn] = useState<Record<string, boolean>>({});
  const [result, setResult] = useState<PostResult | null>(null);

  const handleFile = async (file: File) => {
    setUploading(true); setUploadErr(null); setResult(null); setPreview(null);
    try {
      const rows = await readXlsxMatrix(file);
      const data = await api<Preview>('/receipts-payments/preview', { method: 'POST', body: JSON.stringify({ rows }) });
      setPreview(data);
      const r: Record<string, boolean> = {};
      for (const it of data.receipts) if (it.willApply > 0) r[it.customerId] = true;
      setRcvOn(r);
      const p: Record<string, boolean> = {};
      for (const it of data.payments) if (it.willApply > 0) p[it.supplierKey] = true;
      setPayOn(p);
    } catch (e) {
      setUploadErr(e instanceof Error ? e.message : 'Could not read the file');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const postMutation = useMutation({
    mutationFn: (body: { receipts: { customerId: string; amount: number }[]; payments: { supplierKey: string; amount: number }[] }) =>
      api<PostResult>('/receipts-payments/post', {
        method: 'POST',
        body: JSON.stringify({ paymentDate, reference: reference || null, ...body }),
      }),
    onSuccess: (r) => {
      setResult(r);
      qc.invalidateQueries({ queryKey: ['payments'] });
      qc.invalidateQueries({ queryKey: ['sales-invoices'] });
      qc.invalidateQueries({ queryKey: ['debtor-aging'] });
      qc.invalidateQueries({ queryKey: ['creditor-aging'] });
      qc.invalidateQueries({ queryKey: ['purchases'] });
      setPreview(null);
    },
  });

  const selReceipts = (preview?.receipts ?? []).filter((x) => rcvOn[x.customerId] && x.willApply > 0);
  const selPayments = (preview?.payments ?? []).filter((x) => payOn[x.supplierKey] && x.willApply > 0);
  const selRcvTotal = selReceipts.reduce((s, x) => s + x.willApply, 0);
  const selPayTotal = selPayments.reduce((s, x) => s + x.willApply, 0);

  const handlePost = async () => {
    const ok = await confirm({
      title: 'Post receipts & payments?',
      message: <>This records <strong>{selReceipts.length}</strong> receipt{selReceipts.length !== 1 ? 's' : ''} ({inr(selRcvTotal)}) and <strong>{selPayments.length}</strong> payment{selPayments.length !== 1 ? 's' : ''} ({inr(selPayTotal)}), FIFO-applied to the oldest open invoices. Receipts can be undone from Receive Payments.</>,
      confirmLabel: 'Post',
    });
    if (!ok) return;
    postMutation.mutate({
      receipts: selReceipts.map((x) => ({ customerId: x.customerId, amount: round2(x.amount) })),
      payments: selPayments.map((x) => ({ supplierKey: x.supplierKey, amount: round2(x.amount) })),
    });
  };

  return (
    <div className="space-y-6 max-w-full">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight">
            <ArrowLeftRight className="h-5 w-5 text-brand-600" /> Receipts &amp; Payments
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Upload the bank/cash book once — receipts settle customer invoices, payments settle supplier bills (FIFO, oldest first).
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
          />
          <button onClick={() => fileRef.current?.click()} disabled={uploading} className="btn-primary text-sm">
            {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            Upload Register
          </button>
        </div>
      </div>

      {uploadErr && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{uploadErr}</div>}

      {result && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          <div className="flex items-center gap-2 font-medium">
            <CheckCircle2 className="h-4 w-4" />
            Posted {result.receipts} receipt{result.receipts !== 1 ? 's' : ''} ({inr(result.allocatedReceipts)}) and {result.payments} payment{result.payments !== 1 ? 's' : ''} ({inr(result.allocatedPayments)}).
          </div>
          {result.errors.length > 0 && (
            <ul className="mt-2 list-disc pl-5 text-xs text-amber-700">
              {result.errors.map((er, i) => <li key={i}>{er.side} {er.ref}: {er.message}</li>)}
            </ul>
          )}
          <div className="mt-2 text-xs">
            Review receipts under <Link to="/sales-invoices/payments" className="font-medium underline">Receive Payments</Link>, ageing under <Link to="/sales-invoices/aging" className="font-medium underline">Debtor</Link> / <Link to="/accounts/creditor-aging" className="font-medium underline">Creditor Aging</Link>.
          </div>
        </div>
      )}

      {preview && (
        <>
          {/* Summary */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Stat label="Receipts" value={String(preview.summary.receiptCount)} tone="emerald" />
            <Stat label="Receipt total" value={inr(preview.summary.receiptTotal)} />
            <Stat label="Payments" value={String(preview.summary.paymentCount)} tone="brand" />
            <Stat label="Payment total" value={inr(preview.summary.paymentTotal)} />
            <Stat label="Unmatched" value={String(preview.summary.unmatchedCount)} tone={preview.summary.unmatchedCount ? 'amber' : undefined} />
            <Stat label="Unmatched ₹" value={inr(preview.summary.unmatchedTotal)} tone={preview.summary.unmatchedTotal ? 'amber' : undefined} />
          </div>

          {/* Post controls */}
          <div className="card flex flex-col gap-3 p-4 sm:flex-row sm:items-end sm:justify-between">
            <div className="grid grid-cols-2 gap-3 sm:flex sm:items-end sm:gap-4">
              <label className="block">
                <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-slate-500">Post date</span>
                <input type="date" className="input" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} />
              </label>
              <label className="block sm:w-72">
                <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-slate-500">Reference</span>
                <input className="input" value={reference} onChange={(e) => setReference(e.target.value)} />
              </label>
            </div>
            <div className="flex items-center gap-3">
              <div className="text-right">
                <div className="text-[11px] uppercase tracking-wide text-slate-500">Will apply</div>
                <div className="text-lg font-bold tabular-nums">{inr(selRcvTotal + selPayTotal)}</div>
              </div>
              <button onClick={handlePost} disabled={postMutation.isPending || (selReceipts.length + selPayments.length === 0)} className="btn-primary text-sm">
                {postMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowDownToLine className="h-4 w-4" />}
                Post {selReceipts.length + selPayments.length}
              </button>
            </div>
          </div>

          {/* Receipts table */}
          <SideTable
            title="Receipts → customer invoices" icon={<ArrowDownToLine className="h-4 w-4 text-emerald-600" />}
            rows={preview.receipts.map((it) => ({
              id: it.customerId, name: it.name, sub: it.code, amount: it.amount, pending: it.systemPending, willApply: it.willApply,
              on: !!rcvOn[it.customerId], toggle: () => setRcvOn((p) => ({ ...p, [it.customerId]: !p[it.customerId] })),
            }))}
            pendingLabel="Receivable"
          />

          {/* Payments table */}
          <SideTable
            title="Payments → supplier bills" icon={<ArrowUpFromLine className="h-4 w-4 text-brand-600" />}
            rows={preview.payments.map((it) => ({
              id: it.supplierKey, name: it.name, amount: it.amount, pending: it.systemPending, willApply: it.willApply,
              on: !!payOn[it.supplierKey], toggle: () => setPayOn((p) => ({ ...p, [it.supplierKey]: !p[it.supplierKey] })),
            }))}
            pendingLabel="Payable"
          />

          {/* Unmatched */}
          {preview.unmatched.length > 0 && (
            <div className="card overflow-hidden">
              <div className="flex items-center gap-2 border-b border-slate-200 bg-amber-50/60 px-4 py-2.5 text-sm font-semibold text-amber-800">
                <AlertTriangle className="h-4 w-4" /> Unmatched rows ({preview.unmatched.length}) — ignored
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm whitespace-nowrap">
                  <thead><tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    <th className="px-4 py-2.5 text-left">Party</th><th className="px-4 py-2.5 text-left">Side</th><th className="px-4 py-2.5 text-right">Amount</th>
                  </tr></thead>
                  <tbody className="divide-y divide-slate-100">
                    {preview.unmatched.map((u, i) => (
                      <tr key={i}>
                        <td className="px-4 py-2 font-medium">{u.name}</td>
                        <td className="px-4 py-2 text-slate-500">{u.side === 'RECEIPT' ? 'Receipt' : 'Payment'}</td>
                        <td className="px-4 py-2 text-right tabular-nums">{inr(u.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="px-4 py-2 text-xs text-amber-700">These party names don't match any customer/supplier (e.g. salaries, expenses). Rename or create them and re-upload if they should settle invoices.</div>
            </div>
          )}
        </>
      )}

      {confirmDialog}
    </div>
  );
};

const round2 = (n: number) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

type Row = { id: string; name: string; sub?: string; amount: number; pending: number; willApply: number; on: boolean; toggle: () => void };
const SideTable = ({ title, icon, rows, pendingLabel }: { title: string; icon: React.ReactNode; rows: Row[]; pendingLabel: string }) => (
  <div className="card overflow-hidden">
    <div className="flex items-center gap-2 border-b border-slate-200 bg-slate-50 px-4 py-2.5 text-sm font-semibold text-slate-700">
      {icon} {title} <span className="font-normal text-slate-400">({rows.length})</span>
    </div>
    {rows.length === 0 ? (
      <div className="px-4 py-6 text-center text-sm text-slate-400">None found in the file.</div>
    ) : (
      <div className="overflow-x-auto">
        <table className="w-full text-sm whitespace-nowrap">
          <thead><tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
            <th className="px-3 py-2.5 w-10"></th>
            <th className="px-4 py-2.5 text-left">Party</th>
            <th className="px-4 py-2.5 text-right">In file</th>
            <th className="px-4 py-2.5 text-right">{pendingLabel}</th>
            <th className="px-4 py-2.5 text-right">Will apply</th>
          </tr></thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r) => (
              <tr key={r.id} className={cn(r.willApply <= 0 && 'opacity-60')}>
                <td className="px-3 py-2.5 text-center">
                  <input type="checkbox" checked={r.on} disabled={r.willApply <= 0} onChange={r.toggle}
                    className="rounded border-slate-300 text-brand-600 focus:ring-brand-500" />
                </td>
                <td className="px-4 py-2.5 font-medium">
                  {r.sub && <span className="mr-1.5 font-mono text-xs font-semibold text-brand-700">{r.sub}</span>}{r.name}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums text-slate-600">{inr(r.amount)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums text-slate-600">{inr(r.pending)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums font-semibold">{inr(r.willApply)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )}
  </div>
);

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
