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
type PayMode = 'AUTO' | 'BILL_TO_BILL' | 'ADVANCE';

const inr = (n: number) => '₹' + Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const round2 = (n: number) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
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
  // Allocation mode + the per-invoice amounts picked in Bill-to-Bill mode
  // (invoiceId -> amount string; a key's presence means it's selected).
  const [mode, setMode] = useState<PayMode>('AUTO');
  const [allocs, setAllocs] = useState<Record<string, string>>({});

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

  // Bill-to-Bill helpers: the amount equals the sum of the picked invoices.
  const billTotal = round2(Object.values(allocs).reduce((s, v) => s + (Number(v) || 0), 0));
  const toggleAlloc = (inv: OpenInvoice) =>
    setAllocs((prev) => {
      const next = { ...prev };
      if (inv.id in next) delete next[inv.id];
      else next[inv.id] = String(inv.balance);
      return next;
    });
  const setAllocAmount = (id: string, v: string) =>
    setAllocs((prev) => ({ ...prev, [id]: v }));

  const record = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      api<{ allocated: number; unallocated: number }>('/payments', { method: 'POST', json: payload }),
    onSuccess: (r) => {
      if (mode === 'ADVANCE') {
        setFormMsg(`Recorded ${inr(r.allocated + r.unallocated)} as advance credit (not applied to any invoice).`);
      } else {
        const where = mode === 'BILL_TO_BILL' ? 'to the selected invoices' : 'to open invoices (FIFO)';
        setFormMsg(`Recorded. Applied ${inr(r.allocated)} ${where}${r.unallocated > 0 ? `; ${inr(r.unallocated)} left as credit` : ''}.`);
      }
      setAmount(''); setReference(''); setAllocs({});
      refresh();
    },
    onError: (e) => setFormErr(e instanceof ApiError ? e.message : 'Could not record payment'),
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormErr(null); setFormMsg(null);
    if (!customerId) { setFormErr('Pick a customer.'); return; }

    if (mode === 'BILL_TO_BILL') {
      const allocations = Object.entries(allocs)
        .map(([salesInvoiceId, amt]) => ({ salesInvoiceId, amount: Number(amt) }))
        .filter((a) => a.amount > 0);
      if (!allocations.length) { setFormErr('Select at least one invoice and enter an amount.'); return; }
      record.mutate({ customerId, amount: billTotal, paymentDate, reference: reference || null, mode, allocations });
      return;
    }

    // AUTO + ADVANCE both take a single amount.
    if (!(Number(amount) > 0)) { setFormErr('Enter an amount greater than 0.'); return; }
    record.mutate({ customerId, amount: Number(amount), paymentDate, reference: reference || null, mode });
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

          {/* Allocation mode */}
          <div>
            <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-slate-500">How to apply</span>
            <div className="grid grid-cols-3 gap-1 rounded-lg border border-slate-200 p-1">
              {([
                ['AUTO', 'Automatic', 'FIFO'],
                ['BILL_TO_BILL', 'Bill to Bill', 'Pick invoices'],
                ['ADVANCE', 'Advance', 'No invoices'],
              ] as const).map(([m, label, sub]) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => { setMode(m); setFormMsg(null); setFormErr(null); }}
                  className={`rounded-md px-2 py-1.5 text-center transition ${mode === m ? 'bg-brand-600 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100'}`}
                >
                  <span className="block text-[12px] font-semibold leading-tight">{label}</span>
                  <span className={`block text-[9px] uppercase tracking-wide ${mode === m ? 'text-brand-100' : 'text-slate-400'}`}>{sub}</span>
                </button>
              ))}
            </div>
          </div>

          <label className="block">
            <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-slate-500">Customer</span>
            <SearchableSelect value={customerId} onChange={(v) => { setCustomerId(v); setFormMsg(null); setAllocs({}); }} options={options} placeholder="Select customer…" />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-slate-500">Amount (₹)</span>
              {mode === 'BILL_TO_BILL' ? (
                <div className="input flex items-center justify-end tabular-nums bg-slate-50 text-slate-700 font-semibold" title="Sum of the invoices you select on the right">
                  {inr(billTotal)}
                </div>
              ) : (
                <input className="input text-right tabular-nums" type="number" min="0" step="0.01" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
              )}
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

          {mode === 'BILL_TO_BILL' && (
            <p className="text-[11px] text-slate-400">Tick the invoices on the right and set how much to apply to each. The amount is their total.</p>
          )}
          {mode === 'ADVANCE' && (
            <p className="text-[11px] text-amber-600">Recorded as advance credit — not applied to any invoice. It stays on the customer's account to settle later.</p>
          )}

          {formErr && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{formErr}</div>}
          {formMsg && <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">{formMsg}</div>}

          <button type="submit" disabled={record.isPending} className="btn-primary w-full">
            {record.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wallet className="h-4 w-4" />}
            {mode === 'AUTO' ? ' Receive payment (FIFO)' : mode === 'BILL_TO_BILL' ? ' Receive & apply to selected' : ' Receive as advance'}
          </button>
        </form>

        {/* Open invoices — preview (AUTO) or pick list (BILL_TO_BILL) */}
        <div className="card p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            {mode === 'BILL_TO_BILL' ? 'Select invoices to pay' : 'Open invoices (oldest first)'}
          </h2>
          {!customerId ? (
            <p className="mt-6 text-center text-sm text-slate-400">Select a customer to see their open invoices.</p>
          ) : !outstanding ? (
            <div className="py-8 text-center text-slate-400"><Loader2 className="h-5 w-5 animate-spin mx-auto" /></div>
          ) : !outstanding.open.length ? (
            <div className="mt-6 text-center text-sm">
              <p className="text-emerald-600">No open invoices — fully paid up. 🎉</p>
              {mode !== 'ADVANCE' && <p className="mt-2 text-[11px] text-slate-400">Switch to <strong>Advance</strong> to record this as credit.</p>}
            </div>
          ) : (
            <>
              <div className="mt-2 mb-2 flex items-center justify-between text-sm">
                <span className="text-slate-500">Total outstanding</span>
                <span className="font-bold tabular-nums text-brand-700">{inr(outstanding.totalOutstanding)}</span>
              </div>
              <div className="max-h-64 overflow-y-auto rounded-lg border border-slate-200">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50 text-left text-slate-500 sticky top-0">
                    <tr>
                      {mode === 'BILL_TO_BILL' && <th className="px-2 py-1.5 w-6"></th>}
                      <th className="px-2 py-1.5">Invoice #</th>
                      <th className="px-2 py-1.5">Due</th>
                      <th className="px-2 py-1.5 text-right">Balance</th>
                      {mode === 'BILL_TO_BILL' && <th className="px-2 py-1.5 text-right w-24">Pay</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {outstanding.open.map((i) => {
                      const checked = i.id in allocs;
                      return (
                        <tr key={i.id} className={`border-t border-slate-100 ${checked ? 'bg-brand-50/50' : ''}`}>
                          {mode === 'BILL_TO_BILL' && (
                            <td className="px-2 py-1.5">
                              <input type="checkbox" className="h-3.5 w-3.5 cursor-pointer accent-brand-600" checked={checked} onChange={() => toggleAlloc(i)} />
                            </td>
                          )}
                          <td className="px-2 py-1.5 font-medium">{i.invoiceNumber}</td>
                          <td className="px-2 py-1.5 text-slate-500">{fmtDate(i.dueDate)}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums">{inr(i.balance)}</td>
                          {mode === 'BILL_TO_BILL' && (
                            <td className="px-2 py-1.5 text-right">
                              <input
                                type="number" min="0" max={i.balance} step="0.01" inputMode="decimal"
                                disabled={!checked}
                                value={checked ? allocs[i.id] : ''}
                                onChange={(e) => setAllocAmount(i.id, e.target.value)}
                                className="w-20 rounded border border-slate-200 px-1.5 py-0.5 text-right text-xs tabular-nums disabled:bg-slate-50 disabled:text-slate-300"
                                placeholder="0"
                              />
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {mode === 'BILL_TO_BILL' ? (
                <div className="mt-2 flex items-center justify-between text-[12px]">
                  <span className="text-slate-500">Selected total</span>
                  <span className="font-bold tabular-nums text-brand-700">{inr(billTotal)}</span>
                </div>
              ) : mode === 'ADVANCE' ? (
                <p className="mt-2 text-[11px] text-amber-600">Advance mode ignores these — the amount is kept as credit.</p>
              ) : (
                <p className="mt-2 text-[11px] text-slate-400">Payment is applied top-down (oldest due first) until it runs out.</p>
              )}
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
