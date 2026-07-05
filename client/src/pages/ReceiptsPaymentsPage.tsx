// Receipts & Payments — upload the bank/cash book once. Receipts knock off each
// customer's oldest sales invoices; payments knock off each supplier's oldest
// purchase bills (FIFO). Unclassified account heads (salaries, expenses, or a
// party not yet in the system) can be tagged Customer / Supplier / Other — the
// first two create real records, Other is remembered with a category. Importing
// also stores the whole book for the Cashbook Summary.
import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeftRight, Loader2, Upload, CheckCircle2, ArrowDownToLine, ArrowUpFromLine,
  UserPlus, Truck, Tag, BarChart3,
} from 'lucide-react';
import { api } from '@/lib/api';
import { readXlsxMatrix } from '@/lib/excel';
import { cn } from '@/lib/cn';
import { useConfirm } from '@/hooks/useConfirm';
import { useAuthStore, activeMembership } from '@/store/auth';

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
const round2 = (n: number) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

export const ReceiptsPaymentsPage = () => {
  const qc = useQueryClient();
  const { confirm, confirmDialog } = useConfirm();
  const fileRef = useRef<HTMLInputElement>(null);
  const companyId = useAuthStore(activeMembership)?.companyId ?? '';

  const [rows, setRows] = useState<unknown[][] | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadErr, setUploadErr] = useState<string | null>(null);
  const [paymentDate, setPaymentDate] = useState(todayISO());
  const [reference, setReference] = useState('Receipts & Payments import');
  const [rcvOn, setRcvOn] = useState<Record<string, boolean>>({});
  const [payOn, setPayOn] = useState<Record<string, boolean>>({});
  const [result, setResult] = useState<PostResult | null>(null);

  const runPreview = async (matrix: unknown[][]) => {
    const data = await api<Preview>('/receipts-payments/preview', { method: 'POST', body: JSON.stringify({ rows: matrix }) });
    setPreview(data);
    const r: Record<string, boolean> = {};
    for (const it of data.receipts) if (it.willApply > 0) r[it.customerId] = true;
    setRcvOn(r);
    const p: Record<string, boolean> = {};
    for (const it of data.payments) if (it.willApply > 0) p[it.supplierKey] = true;
    setPayOn(p);
  };

  const handleFile = async (file: File) => {
    setUploading(true); setUploadErr(null); setResult(null); setPreview(null);
    try {
      const matrix = await readXlsxMatrix(file);
      setRows(matrix);
      await runPreview(matrix);
    } catch (e) {
      setUploadErr(e instanceof Error ? e.message : 'Could not read the file');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const importMutation = useMutation({
    mutationFn: async (body: { receipts: { customerId: string; amount: number }[]; payments: { supplierKey: string; amount: number }[] }) => {
      // Store the whole book for the Cashbook Summary, then post the allocations.
      if (rows) await api('/cashbook/store', { method: 'POST', body: JSON.stringify({ rows }) });
      return api<PostResult>('/receipts-payments/post', {
        method: 'POST',
        body: JSON.stringify({ paymentDate, reference: reference || null, ...body }),
      });
    },
    onSuccess: (r) => {
      setResult(r);
      ['payments', 'sales-invoices', 'debtor-aging', 'creditor-aging', 'purchases', 'cashbook-summary'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      setPreview(null); setRows(null);
    },
    onError: (e) => setUploadErr(e instanceof Error ? e.message : 'Import failed — nothing was saved.'),
  });

  const selReceipts = (preview?.receipts ?? []).filter((x) => rcvOn[x.customerId] && x.willApply > 0);
  const selPayments = (preview?.payments ?? []).filter((x) => payOn[x.supplierKey] && x.willApply > 0);
  const selRcvTotal = selReceipts.reduce((s, x) => s + x.willApply, 0);
  const selPayTotal = selPayments.reduce((s, x) => s + x.willApply, 0);

  const handleImport = async () => {
    const ok = await confirm({
      title: 'Import cashbook?',
      message: <>This stores the whole book for the Cashbook Summary and posts <strong>{selReceipts.length}</strong> receipt{selReceipts.length !== 1 ? 's' : ''} ({inr(selRcvTotal)}) + <strong>{selPayments.length}</strong> payment{selPayments.length !== 1 ? 's' : ''} ({inr(selPayTotal)}), FIFO to the oldest open invoices. Re-importing the same period replaces the summary rows.</>,
      confirmLabel: 'Import',
    });
    if (!ok) return;
    setUploadErr(null);
    importMutation.mutate({
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
            Upload the bank/cash book once — receipts settle customer invoices, payments settle supplier bills (FIFO). Tag other heads for the summary.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link to="/accounts/cashbook-summary" className="btn-ghost border border-slate-300 text-slate-600 hover:bg-slate-50 text-sm">
            <BarChart3 className="h-4 w-4" /> Cashbook Summary
          </Link>
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
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
            Imported. Posted {result.receipts} receipt{result.receipts !== 1 ? 's' : ''} ({inr(result.allocatedReceipts)}) and {result.payments} payment{result.payments !== 1 ? 's' : ''} ({inr(result.allocatedPayments)}).
          </div>
          {result.errors.length > 0 && (
            <ul className="mt-2 list-disc pl-5 text-xs text-amber-700">
              {result.errors.map((er, i) => <li key={i}>{er.side} {er.ref}: {er.message}</li>)}
            </ul>
          )}
          <div className="mt-2 text-xs">
            See the <Link to="/accounts/cashbook-summary" className="font-medium underline">Cashbook Summary</Link>, or ageing under <Link to="/sales-invoices/aging" className="font-medium underline">Debtor</Link> / <Link to="/accounts/creditor-aging" className="font-medium underline">Creditor</Link>.
          </div>
        </div>
      )}

      {preview && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Stat label="Receipts" value={String(preview.summary.receiptCount)} tone="emerald" />
            <Stat label="Receipt total" value={inr(preview.summary.receiptTotal)} />
            <Stat label="Payments" value={String(preview.summary.paymentCount)} tone="brand" />
            <Stat label="Payment total" value={inr(preview.summary.paymentTotal)} />
            <Stat label="Unclassified" value={String(preview.summary.unmatchedCount)} tone={preview.summary.unmatchedCount ? 'amber' : undefined} />
            <Stat label="Unclassified ₹" value={inr(preview.summary.unmatchedTotal)} tone={preview.summary.unmatchedTotal ? 'amber' : undefined} />
          </div>

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
              <button onClick={handleImport} disabled={importMutation.isPending} className="btn-primary text-sm">
                {importMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowDownToLine className="h-4 w-4" />}
                Import
              </button>
            </div>
          </div>

          <SideTable
            title="Receipts → customer invoices" icon={<ArrowDownToLine className="h-4 w-4 text-emerald-600" />}
            rows={preview.receipts.map((it) => ({
              id: it.customerId, name: it.name, sub: it.code, amount: it.amount, pending: it.systemPending, willApply: it.willApply,
              on: !!rcvOn[it.customerId], toggle: () => setRcvOn((p) => ({ ...p, [it.customerId]: !p[it.customerId] })),
            }))}
            pendingLabel="Receivable"
          />

          <SideTable
            title="Payments → supplier bills" icon={<ArrowUpFromLine className="h-4 w-4 text-brand-600" />}
            rows={preview.payments.map((it) => ({
              id: it.supplierKey, name: it.name, amount: it.amount, pending: it.systemPending, willApply: it.willApply,
              on: !!payOn[it.supplierKey], toggle: () => setPayOn((p) => ({ ...p, [it.supplierKey]: !p[it.supplierKey] })),
            }))}
            pendingLabel="Payable"
          />

          {preview.unmatched.length > 0 && (
            <ClassifySection
              rows={preview.unmatched}
              companyId={companyId}
              onChanged={() => { if (rows) runPreview(rows); qc.invalidateQueries({ queryKey: ['customers'] }); qc.invalidateQueries({ queryKey: ['suppliers'] }); }}
            />
          )}
        </>
      )}

      {confirmDialog}
    </div>
  );
};

/* ── Classify unclassified account heads ── */
const ClassifySection = ({ rows, companyId, onChanged }: { rows: Unmatched[]; companyId: string; onChanged: () => void }) => {
  const [busy, setBusy] = useState<string | null>(null);
  const [otherFor, setOtherFor] = useState<string | null>(null);
  const [cat, setCat] = useState('');
  const [err, setErr] = useState<string | null>(null);

  const act = async (name: string, fn: () => Promise<unknown>) => {
    setBusy(name); setErr(null);
    try { await fn(); setOtherFor(null); setCat(''); onChanged(); }
    catch (e) { setErr(e instanceof Error ? e.message : 'Failed'); }
    finally { setBusy(null); }
  };
  const adjust = (name: string) => api('/cashbook/adjust', { method: 'POST', body: JSON.stringify({ name }) }).catch(() => {});
  const asCustomer = (name: string) => act(name, async () => { await api('/customers', { method: 'POST', body: JSON.stringify({ name }) }); await adjust(name); });
  const asSupplier = (name: string) => act(name, async () => { await api('/suppliers', { method: 'POST', body: JSON.stringify({ name, companyIds: [companyId] }) }); await adjust(name); });
  const asOther = (name: string) => act(name, () => api('/cashbook/account-heads', { method: 'POST', body: JSON.stringify({ name, category: cat.trim() }) }));

  return (
    <div className="card overflow-hidden">
      <div className="flex items-center gap-2 border-b border-slate-200 bg-amber-50/60 px-4 py-2.5 text-sm font-semibold text-amber-800">
        <Tag className="h-4 w-4" /> Unclassified account heads ({rows.length})
      </div>
      <div className="px-4 py-2 text-xs text-slate-500">
        Tag each head so it's recognised next time. <b>Customer</b>/<b>Supplier</b> create a real record (and appear in those lists); <b>Other</b> is saved with a category for the summary.
      </div>
      {err && <div className="mx-4 mb-2 rounded border border-red-200 bg-red-50 px-3 py-1.5 text-xs text-red-700">{err}</div>}
      <div className="overflow-x-auto">
        <table className="w-full text-sm whitespace-nowrap">
          <thead><tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
            <th className="px-4 py-2.5 text-left">Party</th><th className="px-4 py-2.5 text-left">Side</th>
            <th className="px-4 py-2.5 text-right">Amount</th><th className="px-4 py-2.5 text-left">Classify as</th>
          </tr></thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((u, i) => {
              const isBusy = busy === u.name;
              return (
                <tr key={i}>
                  <td className="px-4 py-2 font-medium">{u.name}</td>
                  <td className="px-4 py-2 text-slate-500">{u.side === 'RECEIPT' ? 'Receipt' : 'Payment'}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{inr(u.amount)}</td>
                  <td className="px-4 py-2">
                    {otherFor === u.name ? (
                      <div className="flex items-center gap-1.5">
                        <input autoFocus className="input h-8 w-40" placeholder="Category e.g. Salary" value={cat} onChange={(e) => setCat(e.target.value)} />
                        <button disabled={isBusy || !cat.trim()} onClick={() => asOther(u.name)} className="btn-primary h-8 px-2 text-xs">
                          {isBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Save'}
                        </button>
                        <button onClick={() => { setOtherFor(null); setCat(''); }} className="btn-ghost h-8 px-2 text-xs text-slate-500">Cancel</button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5">
                        <button disabled={isBusy} onClick={() => asCustomer(u.name)} className="btn-ghost h-8 border border-slate-300 px-2 text-xs text-emerald-700 hover:bg-emerald-50">
                          <UserPlus className="h-3.5 w-3.5" /> Customer
                        </button>
                        <button disabled={isBusy} onClick={() => asSupplier(u.name)} className="btn-ghost h-8 border border-slate-300 px-2 text-xs text-brand-700 hover:bg-brand-50">
                          <Truck className="h-3.5 w-3.5" /> Supplier
                        </button>
                        <button disabled={isBusy} onClick={() => { setOtherFor(u.name); setCat(''); }} className="btn-ghost h-8 border border-slate-300 px-2 text-xs text-slate-600 hover:bg-slate-50">
                          <Tag className="h-3.5 w-3.5" /> Other
                        </button>
                        {isBusy && <Loader2 className="h-4 w-4 animate-spin text-slate-400" />}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

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
