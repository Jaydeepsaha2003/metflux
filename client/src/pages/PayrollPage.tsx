// Payroll — fixed monthly salary per worker minus the advances taken that
// month = net payable. Advances are recorded here and linked straight to the
// worker + month, so paying an advance immediately reflects in that month's
// payroll.
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Wallet, Loader2, Plus, Trash2, Pencil, Check, X, Download, CheckCircle2,
} from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { downloadXlsx } from '@/lib/excel';
import { useConfirm } from '@/hooks/useConfirm';

type Row = {
  labourId: string; name: string; phone: string | null; isActive: boolean;
  monthlySalary: number; advances: number; advanceCount: number; net: number;
};
type Summary = { month: string; items: Row[]; totals: { monthlySalary: number; advances: number; net: number } };
type Advance = { id: string; labourId: string; labourName: string | null; amount: number; advanceDate: string; periodMonth: string; notes: string | null };

const inr = (n: number | undefined) => '₹' + Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const thisMonth = () => new Date().toISOString().slice(0, 7);
const todayISO = () => new Date().toISOString().slice(0, 10);
const fmtDate = (iso: string) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-GB'); };

export const PayrollPage = () => {
  const qc = useQueryClient();
  const [month, setMonth] = useState(thisMonth());
  const [advanceFor, setAdvanceFor] = useState<Row | null>(null);
  const [ledgerFor, setLedgerFor] = useState<Row | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['payroll-summary', month],
    queryFn: () => api<Summary>(`/payroll/summary?month=${month}`),
  });
  const items = data?.items ?? [];
  const t = data?.totals;

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['payroll-summary'] });
    qc.invalidateQueries({ queryKey: ['payroll-advances'] });
  };

  const exportExcel = () => {
    if (!items.length) return;
    downloadXlsx(`payroll-${month}`, `Payroll ${month}`, items.map((r) => ({
      Worker: r.name,
      'Monthly Salary': r.monthlySalary,
      'Advances (month)': r.advances,
      'Net Payable': r.net,
    })));
  };

  return (
    <div className="space-y-5 max-w-[1200px]">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
          <Wallet className="h-5 w-5 text-brand-600" /> Payroll
        </h1>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-2 text-sm">
            <span className="text-slate-500">Month</span>
            <input type="month" className="input h-9 w-40" value={month} onChange={(e) => setMonth(e.target.value || thisMonth())} />
          </label>
          <button onClick={exportExcel} disabled={!items.length} className="btn-ghost border border-slate-300 text-emerald-700 hover:bg-emerald-50 text-sm disabled:opacity-50">
            <Download className="h-4 w-4" /> Excel
          </button>
        </div>
      </div>

      {/* Totals */}
      {t && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Stat label="Total Salary" value={inr(t.monthlySalary)} />
          <Stat label="Total Advances" value={inr(t.advances)} tone="amber" />
          <Stat label="Net Payable" value={inr(t.net)} tone={t.net >= 0 ? 'emerald' : 'red'} />
        </div>
      )}

      <div className="card overflow-hidden">
        {isLoading ? (
          <div className="py-12 text-center text-slate-400"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></div>
        ) : !items.length ? (
          <div className="py-12 text-center text-sm text-slate-400">No workers in this company yet. Add them under Settings → Workers.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm whitespace-nowrap">
              <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">Worker</th>
                  <th className="px-4 py-3 text-right">Monthly Salary</th>
                  <th className="px-4 py-3 text-right">Advances ({month})</th>
                  <th className="px-4 py-3 text-right">Net Payable</th>
                  <th className="px-4 py-3 text-center">Advance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items.map((r) => (
                  <SalaryRow key={r.labourId} row={r} onAdvance={() => setAdvanceFor(r)} onLedger={() => setLedgerFor(r)} onSaved={refresh} />
                ))}
              </tbody>
              {t && (
                <tfoot>
                  <tr className="border-t-2 border-slate-200 bg-slate-50 font-semibold">
                    <td className="px-4 py-2.5">Total</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{inr(t.monthlySalary)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-amber-700">{inr(t.advances)}</td>
                    <td className={cn('px-4 py-2.5 text-right tabular-nums', t.net >= 0 ? 'text-emerald-700' : 'text-red-600')}>{inr(t.net)}</td>
                    <td />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )}
      </div>

      {advanceFor && <AdvanceModal row={advanceFor} month={month} onClose={() => setAdvanceFor(null)} onDone={refresh} />}
      {ledgerFor && <LedgerModal row={ledgerFor} month={month} onClose={() => setLedgerFor(null)} onDone={refresh} />}
    </div>
  );
};

/* One worker row — inline salary edit + advance actions. */
const SalaryRow = ({ row, onAdvance, onLedger, onSaved }: { row: Row; onAdvance: () => void; onLedger: () => void; onSaved: () => void }) => {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(String(row.monthlySalary || ''));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const save = async () => {
    setBusy(true); setErr(null);
    try {
      await api(`/payroll/salary/${row.labourId}`, { method: 'PATCH', json: { monthlySalary: val.trim() === '' ? null : Number(val) } });
      setEditing(false);
      onSaved();
    } catch (e) { setErr(e instanceof ApiError ? e.message : 'Failed'); }
    finally { setBusy(false); }
  };

  return (
    <tr className="hover:bg-slate-50/60">
      <td className="px-4 py-2.5 font-medium text-slate-800">
        {row.name}{!row.isActive && <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">inactive</span>}
      </td>
      <td className="px-4 py-2.5 text-right">
        {editing ? (
          <span className="inline-flex items-center gap-1">
            <input autoFocus type="number" min={0} className="input h-8 w-28 text-right" value={val}
              onChange={(e) => setVal(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false); }} />
            <button onClick={save} disabled={busy} className="rounded p-1 text-brand-700 hover:bg-brand-50">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}</button>
            <button onClick={() => { setEditing(false); setVal(String(row.monthlySalary || '')); }} className="rounded p-1 text-slate-400 hover:bg-slate-100"><X className="h-4 w-4" /></button>
          </span>
        ) : (
          <button onClick={() => setEditing(true)} className="inline-flex items-center gap-1.5 tabular-nums text-slate-700 hover:text-brand-700" title="Edit salary">
            {row.monthlySalary ? inr(row.monthlySalary) : <span className="text-slate-400">set salary</span>} <Pencil className="h-3 w-3 opacity-60" />
          </button>
        )}
        {err && <div className="text-[10px] text-red-600">{err}</div>}
      </td>
      <td className="px-4 py-2.5 text-right tabular-nums">
        {row.advances ? (
          <button onClick={onLedger} className="text-amber-700 hover:underline" title="View / delete advances">
            {inr(row.advances)} <span className="text-[10px] text-slate-400">({row.advanceCount})</span>
          </button>
        ) : <span className="text-slate-400">—</span>}
      </td>
      <td className={cn('px-4 py-2.5 text-right tabular-nums font-semibold', row.net >= 0 ? 'text-slate-900' : 'text-red-600')}>{inr(row.net)}</td>
      <td className="px-4 py-2.5 text-center">
        <button onClick={onAdvance} className="inline-flex items-center gap-1 rounded-lg bg-brand-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-brand-700">
          <Plus className="h-3.5 w-3.5" /> Advance
        </button>
      </td>
    </tr>
  );
};

/* Record an advance for a worker, tagged to the payroll month. */
const AdvanceModal = ({ row, month, onClose, onDone }: { row: Row; month: string; onClose: () => void; onDone: () => void }) => {
  const [amount, setAmount] = useState(0);
  const [advanceDate, setAdvanceDate] = useState(todayISO());
  const [periodMonth, setPeriodMonth] = useState(month);
  const [notes, setNotes] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const submit = useMutation({
    mutationFn: () => api('/payroll/advances', {
      method: 'POST',
      json: { labourId: row.labourId, amount, advanceDate, periodMonth, notes: notes.trim() || null },
    }),
    onSuccess: () => { setDone(true); onDone(); },
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'Failed to record advance'),
  });

  const onSave = () => {
    setErr(null);
    if (amount <= 0) return setErr('Enter an amount greater than 0');
    submit.mutate();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900"><Wallet className="h-4 w-4 text-brand-600" /> Pay advance — {row.name}</h2>
          <button onClick={onClose} className="rounded p-1 text-slate-400 hover:bg-slate-100"><X className="h-4 w-4" /></button>
        </div>
        {done ? (
          <div className="space-y-4 px-5 py-6">
            <div className="flex items-center gap-2 text-sm font-medium text-emerald-700"><CheckCircle2 className="h-5 w-5" /> Advance of {inr(amount)} recorded — deducted from {periodMonth} payroll.</div>
            <div className="flex justify-end"><button onClick={onClose} className="btn-primary text-sm">Done</button></div>
          </div>
        ) : (
          <div className="space-y-4 px-5 py-4">
            <div className="grid grid-cols-2 gap-3">
              <label className="block"><span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-slate-500">Amount (₹)</span>
                <input autoFocus className="input" type="number" min={1} value={amount || ''} onChange={(e) => setAmount(parseFloat(e.target.value) || 0)} /></label>
              <label className="block"><span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-slate-500">Paid on</span>
                <input className="input" type="date" value={advanceDate} onChange={(e) => setAdvanceDate(e.target.value)} /></label>
              <label className="block"><span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-slate-500">Payroll month</span>
                <input className="input" type="month" value={periodMonth} onChange={(e) => setPeriodMonth(e.target.value || month)} /></label>
              <label className="block"><span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-slate-500">Notes</span>
                <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" /></label>
            </div>
            <div className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
              Deducts from <strong>{row.name}</strong>'s <strong>{periodMonth}</strong> payroll (salary {inr(row.monthlySalary)}).
            </div>
            {err && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{err}</div>}
            <div className="flex justify-end gap-3 border-t border-slate-200 pt-3">
              <button onClick={onClose} className="btn-ghost text-sm">Cancel</button>
              <button onClick={onSave} disabled={submit.isPending} className="btn-primary text-sm">
                {submit.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Record advance
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

/* View + delete a worker's advances for the selected month. */
const LedgerModal = ({ row, month, onClose, onDone }: { row: Row; month: string; onClose: () => void; onDone: () => void }) => {
  const qc = useQueryClient();
  const { confirm, confirmDialog } = useConfirm();
  const { data, isLoading } = useQuery({
    queryKey: ['payroll-advances', row.labourId, month],
    queryFn: () => api<{ items: Advance[] }>(`/payroll/advances?month=${month}&labourId=${row.labourId}`),
  });
  const items = data?.items ?? [];
  const del = useMutation({
    mutationFn: (id: string) => api(`/payroll/advances/${id}`, { method: 'DELETE' }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['payroll-advances'] }); onDone(); },
  });
  const onDel = async (a: Advance) => {
    const ok = await confirm({ title: 'Delete advance?', message: <>Remove this advance of {inr(a.amount)}?</>, tone: 'danger', confirmLabel: 'Delete' });
    if (ok) del.mutate(a.id);
  };
  const total = items.reduce((s, a) => s + a.amount, 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
      <div className="flex max-h-[80vh] w-full max-w-lg flex-col rounded-xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
          <h2 className="text-sm font-semibold text-slate-900">{row.name} — advances ({month})</h2>
          <button onClick={onClose} className="rounded p-1 text-slate-400 hover:bg-slate-100"><X className="h-4 w-4" /></button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="py-10 text-center text-slate-400"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></div>
          ) : !items.length ? (
            <div className="py-10 text-center text-sm text-slate-400">No advances this month.</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <tr><th className="px-4 py-2.5">Date</th><th className="px-4 py-2.5">Notes</th><th className="px-4 py-2.5 text-right">Amount</th><th className="w-10" /></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items.map((a) => (
                  <tr key={a.id} className="hover:bg-slate-50/60">
                    <td className="px-4 py-2 text-slate-600">{fmtDate(a.advanceDate)}</td>
                    <td className="px-4 py-2 text-slate-500">{a.notes || '—'}</td>
                    <td className="px-4 py-2 text-right tabular-nums font-medium">{inr(a.amount)}</td>
                    <td className="px-2 py-2 text-center">
                      <button onClick={() => onDel(a)} disabled={del.isPending} className="rounded p-1 text-red-500 hover:bg-red-50" title="Delete"><Trash2 className="h-3.5 w-3.5" /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr className="border-t-2 border-slate-200 bg-slate-50 font-semibold"><td className="px-4 py-2.5" colSpan={2}>Total</td><td className="px-4 py-2.5 text-right tabular-nums text-amber-700">{inr(total)}</td><td /></tr></tfoot>
            </table>
          )}
        </div>
        {confirmDialog}
      </div>
    </div>
  );
};

const Stat = ({ label, value, tone }: { label: string; value: string; tone?: 'emerald' | 'amber' | 'red' }) => (
  <div className="card p-3">
    <div className="text-[11px] uppercase tracking-wide text-slate-500">{label}</div>
    <div className={cn('mt-0.5 text-xl font-bold tabular-nums',
      tone === 'emerald' && 'text-emerald-600', tone === 'amber' && 'text-amber-600', tone === 'red' && 'text-red-600')}>{value}</div>
  </div>
);
