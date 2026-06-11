// Receive Payments — record a customer payment (applied FIFO to their oldest
// open invoices), or bulk-import payments from the downloadable template. Shows
// the customer's open invoices before you confirm, plus full payment history.
import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Wallet, Loader2, FileSpreadsheet, Upload, Trash2, CheckCircle2, AlertTriangle, X, Clock,
} from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { downloadXlsx, readXlsx } from '@/lib/excel';
import { SearchableSelect } from '@/components/SearchableSelect';
import { useConfirm } from '@/hooks/useConfirm';

type OpenInvoice = { id: string; invoiceNumber: string; invoiceDate: string; dueDate: string | null; balance: number };
type Outstanding = { open: OpenInvoice[]; totalOutstanding: number };
type Allocation = { invoiceNumber: string; amount: number };
type Payment = {
  id: string; customerId: string | null; customerName: string; amount: number;
  allocatedAmount: number; unallocated: number; paymentDate: string; reference: string | null; method: string | null;
  allocations: Allocation[];
};
type ImportResult = { recorded: number; skipped: number; allocated: number; errors: { row: number; name?: string; message: string }[] };

const inr = (n: number) => '₹' + Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const fmtDate = (iso: string | null) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
};
const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

export const ReceivePaymentsPage = () => {
  const qc = useQueryClient();
  const { confirm, confirmDialog } = useConfirm();

  const [customerId, setCustomerId] = useState('');
  const [amount, setAmount] = useState('');
  const [paymentDate, setPaymentDate] = useState(todayISO());
  const [reference, setReference] = useState('');
  const [formMsg, setFormMsg] = useState<string | null>(null);
  const [formErr, setFormErr] = useState<string | null>(null);

  const fileRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [importErr, setImportErr] = useState<string | null>(null);

  const { data: customers } = useQuery({
    queryKey: ['customers-options'],
    queryFn: () => api<{ items: { id: string; name: string; customerCode: string }[] }>('/customers?pageSize=500'),
  });
  const options = (customers?.items ?? []).map((c) => ({ value: c.id, label: `${c.name} (${c.customerCode})` }));

  const { data: outstanding } = useQuery({
    queryKey: ['payment-outstanding', customerId],
    queryFn: () => api<Outstanding>(`/payments/outstanding/${customerId}`),
    enabled: !!customerId,
  });

  const { data: history } = useQuery({
    queryKey: ['payments'],
    queryFn: () => api<{ items: Payment[] }>('/payments'),
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['payments'] });
    qc.invalidateQueries({ queryKey: ['payment-outstanding'] });
    qc.invalidateQueries({ queryKey: ['sales-invoices'] });
    qc.invalidateQueries({ queryKey: ['sales-invoice-summary'] });
    qc.invalidateQueries({ queryKey: ['debtor-aging'] });
  };

  const record = useMutation({
    mutationFn: () => api<{ allocated: number; unallocated: number }>('/payments', {
      method: 'POST',
      json: { customerId, amount: Number(amount), paymentDate, reference: reference || null },
    }),
    onSuccess: (r) => {
      setFormMsg(`Recorded. Applied ${inr(r.allocated)} to open invoices (FIFO)${r.unallocated > 0 ? `; ${inr(r.unallocated)} left as unapplied credit` : ''}.`);
      setAmount(''); setReference('');
      refresh();
    },
    onError: (e) => setFormErr(e instanceof ApiError ? e.message : 'Could not record payment'),
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormErr(null); setFormMsg(null);
    if (!customerId) { setFormErr('Pick a customer.'); return; }
    if (!(Number(amount) > 0)) { setFormErr('Enter an amount greater than 0.'); return; }
    record.mutate();
  };

  const downloadTemplate = () => {
    downloadXlsx('payments-template', 'Payments', [
      { 'Customer Code': 'AAR-001', 'Customer Name': 'Aarti Steels', 'Amount': 10000, 'Date': '11/06/2026', 'Reference': 'NEFT-12345' },
    ]);
  };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setImporting(true); setImportErr(null); setImportResult(null);
    try {
      const rows = await readXlsx(file);
      if (!rows.length) { setImportErr('That file has no rows.'); return; }
      const res = await api<ImportResult>('/payments/import', { method: 'POST', json: { rows } });
      setImportResult(res);
      refresh();
    } catch (err) {
      setImportErr(err instanceof ApiError ? err.message : 'Import failed — check the template columns.');
    } finally {
      setImporting(false);
    }
  };

  const del = useMutation({
    mutationFn: (id: string) => api(`/payments/${id}`, { method: 'DELETE' }),
    onSuccess: refresh,
  });

  return (
    <div className="space-y-5">
      <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" onChange={onFile} className="hidden" />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Wallet className="h-5 w-5 text-brand-600" /> Receive Payments
        </h1>
        <div className="flex items-center gap-2">
          <Link to="/sales-invoices/aging" className="btn-ghost border border-slate-300 text-slate-600 hover:bg-slate-50">
            <Clock className="h-4 w-4" /> Debtor Aging
          </Link>
          <button onClick={downloadTemplate} className="btn-ghost text-slate-600 hover:bg-slate-100" title="Download the bulk-payment template">
            <FileSpreadsheet className="h-4 w-4" /> Template
          </button>
          <button onClick={() => fileRef.current?.click()} disabled={importing} className="btn-ghost text-brand-700 hover:bg-brand-50">
            {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />} Import
          </button>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        {/* Record a payment */}
        <form onSubmit={submit} className="card p-5 space-y-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Record a payment</h2>
          <label className="block">
            <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-slate-500">Customer</span>
            <SearchableSelect value={customerId} onChange={(v) => { setCustomerId(v); setFormMsg(null); }} options={options} placeholder="Select customer…" />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-slate-500">Amount (₹)</span>
              <input className="input text-right tabular-nums" type="number" min="0" step="0.01" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
            </label>
            <label className="block">
              <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-slate-500">Date</span>
              <input className="input" type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} />
            </label>
          </div>
          <label className="block">
            <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-slate-500">Reference (optional)</span>
            <input className="input" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="NEFT / cheque no." />
          </label>

          {formErr && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{formErr}</div>}
          {formMsg && <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">{formMsg}</div>}

          <button type="submit" disabled={record.isPending} className="btn-primary w-full">
            {record.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wallet className="h-4 w-4" />} Receive payment (FIFO)
          </button>
        </form>

        {/* Open invoices preview for the selected customer */}
        <div className="card p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            {customerId ? 'Open invoices (oldest first)' : 'Open invoices'}
          </h2>
          {!customerId ? (
            <p className="mt-6 text-center text-sm text-slate-400">Select a customer to see what the payment will be applied to.</p>
          ) : !outstanding ? (
            <div className="py-8 text-center text-slate-400"><Loader2 className="h-5 w-5 animate-spin mx-auto" /></div>
          ) : !outstanding.open.length ? (
            <p className="mt-6 text-center text-sm text-emerald-600">No open invoices — fully paid up. 🎉</p>
          ) : (
            <>
              <div className="mt-2 mb-2 flex items-center justify-between text-sm">
                <span className="text-slate-500">Total outstanding</span>
                <span className="font-bold tabular-nums text-brand-700">{inr(outstanding.totalOutstanding)}</span>
              </div>
              <div className="max-h-64 overflow-y-auto rounded-lg border border-slate-200">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50 text-left text-slate-500 sticky top-0">
                    <tr><th className="px-2 py-1.5">Invoice #</th><th className="px-2 py-1.5">Due</th><th className="px-2 py-1.5 text-right">Balance</th></tr>
                  </thead>
                  <tbody>
                    {outstanding.open.map((i) => (
                      <tr key={i.id} className="border-t border-slate-100">
                        <td className="px-2 py-1.5 font-medium">{i.invoiceNumber}</td>
                        <td className="px-2 py-1.5 text-slate-500">{fmtDate(i.dueDate)}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{inr(i.balance)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-2 text-[11px] text-slate-400">Payment is applied top-down (oldest due first) until it runs out.</p>
            </>
          )}
        </div>
      </div>

      {/* Payment history */}
      <div className="card overflow-hidden">
        <div className="border-b border-slate-200 px-4 py-3 text-sm font-semibold text-slate-700">Payment history</div>
        {!history ? (
          <div className="py-10 text-center text-slate-400"><Loader2 className="h-5 w-5 animate-spin mx-auto" /></div>
        ) : !history.items.length ? (
          <div className="py-10 text-center text-sm text-slate-400">No payments recorded yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm whitespace-nowrap">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2.5">Date</th>
                  <th className="px-3 py-2.5">Customer</th>
                  <th className="px-3 py-2.5 text-right">Amount</th>
                  <th className="px-3 py-2.5">Applied to</th>
                  <th className="px-3 py-2.5">Reference</th>
                  <th className="px-3 py-2.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {history.items.map((p) => (
                  <tr key={p.id} className="border-t border-slate-100 hover:bg-slate-50/60 align-top">
                    <td className="px-3 py-2.5 text-slate-600">{fmtDate(p.paymentDate)}</td>
                    <td className="px-3 py-2.5 font-medium text-slate-900">{p.customerName}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums font-medium">{inr(p.amount)}</td>
                    <td className="px-3 py-2.5">
                      {p.allocations.length ? (
                        <div className="flex flex-wrap gap-1">
                          {p.allocations.map((a, i) => (
                            <span key={i} className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600">
                              {a.invoiceNumber}: {inr(a.amount)}
                            </span>
                          ))}
                          {p.unallocated > 0 && <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[11px] text-amber-700">credit: {inr(p.unallocated)}</span>}
                        </div>
                      ) : (
                        <span className="text-[11px] text-amber-700">unapplied credit: {inr(p.unallocated)}</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-slate-500 text-xs">{p.reference ?? '—'}</td>
                    <td className="px-3 py-2.5 text-right">
                      <button
                        onClick={async () => {
                          const ok = await confirm({
                            title: 'Delete payment?',
                            message: <>Reverse and delete this payment of <strong>{inr(p.amount)}</strong> from <strong>{p.customerName}</strong>? The invoices it covered will become open again.</>,
                            tone: 'danger', confirmLabel: 'Delete',
                          });
                          if (ok) del.mutate(p.id);
                        }}
                        className="btn-ghost text-red-600 hover:bg-red-50" title="Reverse & delete">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {importErr && <Dialog title="Import problem" tone="danger" onClose={() => setImportErr(null)}><p className="text-sm text-slate-600">{importErr}</p></Dialog>}
      {importResult && (
        <Dialog title="Payments imported" tone="ok" onClose={() => setImportResult(null)}>
          <div className="space-y-1.5 text-sm">
            <div className="flex justify-between"><span className="text-slate-600">Payments recorded</span><span className="font-bold text-emerald-700 tabular-nums">{importResult.recorded}</span></div>
            <div className="flex justify-between"><span className="text-slate-600">Total applied (FIFO)</span><span className="font-bold tabular-nums">{inr(importResult.allocated)}</span></div>
            <div className="flex justify-between"><span className="text-slate-600">Skipped</span><span className="font-bold text-slate-500 tabular-nums">{importResult.skipped}</span></div>
            {importResult.errors.length > 0 && (
              <div className="mt-2 max-h-40 overflow-y-auto rounded-lg border border-amber-200 bg-amber-50 text-xs">
                {importResult.errors.map((er, i) => (
                  <div key={i} className="border-b border-amber-200/60 px-2 py-1">Row {er.row}{er.name ? ` (${er.name})` : ''} — {er.message}</div>
                ))}
              </div>
            )}
          </div>
        </Dialog>
      )}
      {confirmDialog}
    </div>
  );
};

const Dialog = ({ title, tone, children, onClose }: { title: string; tone: 'ok' | 'danger'; children: React.ReactNode; onClose: () => void }) => (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
    <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-base font-bold text-slate-900">
          {tone === 'ok' ? <CheckCircle2 className="h-5 w-5 text-emerald-600" /> : <AlertTriangle className="h-5 w-5 text-red-600" />}
          {title}
        </h3>
        <button onClick={onClose} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><X className="h-4 w-4" /></button>
      </div>
      {children}
      <div className="mt-4 flex justify-end"><button onClick={onClose} className="btn-primary">Done</button></div>
    </div>
  </div>
);
