// Add / edit a bank account for the cash book. Tally-style label-left form.
import { useEffect, useState } from 'react';
import { Landmark, Loader2, X } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

export type BankAccount = {
  id: string;
  name: string;
  bankName: string | null;
  accountNumber: string | null;
  ifsc: string | null;
  openingBalance: number;
  openingAsOn: string | null;
  isDefault: boolean;
  sortOrder: number;
  receipts: number;
  payments: number;
  entryCount: number;
  /** Entries dated before the opening cut-off — excluded from the balance. */
  preOpeningCount?: number;
  balance: number;
};

const dateOnly = (iso: string | null) => (iso ? iso.slice(0, 10) : '');

type Props = { open: boolean; editing: BankAccount | null; onClose: () => void; onSaved?: (id: string) => void };

export const BankAccountDialog = ({ open, editing, onClose, onSaved }: Props) => {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [bankName, setBankName] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [ifsc, setIfsc] = useState('');
  const [openingBalance, setOpeningBalance] = useState('0');
  // Blank by default = no cut-off, so the balance counts the whole book. Setting
  // a date here would silently exclude any older statement imported afterwards.
  const [openingAsOn, setOpeningAsOn] = useState('');
  const [err, setErr] = useState<string | null>(null);

  // Re-seed the form whenever the dialog is opened for a different account.
  useEffect(() => {
    if (!open) return;
    setErr(null);
    setName(editing?.name ?? '');
    setBankName(editing?.bankName ?? '');
    setAccountNumber(editing?.accountNumber ?? '');
    setIfsc(editing?.ifsc ?? '');
    setOpeningBalance(String(editing?.openingBalance ?? 0));
    setOpeningAsOn(dateOnly(editing?.openingAsOn ?? null));
  }, [open, editing]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: name.trim(),
        bankName: bankName.trim() || null,
        accountNumber: accountNumber.trim() || null,
        ifsc: ifsc.trim() || null,
        openingBalance: Number(openingBalance) || 0,
        openingAsOn: openingAsOn || null,
      };
      return editing
        ? api<BankAccount>(`/bank-accounts/${editing.id}`, { method: 'PATCH', json: body })
        : api<BankAccount>('/bank-accounts', { method: 'POST', json: body });
    },
    onSuccess: (saved) => {
      qc.invalidateQueries({ queryKey: ['bank-accounts'] });
      onSaved?.(saved.id);
      onClose();
    },
    onError: (e) => setErr(e instanceof Error ? e.message : 'Could not save the bank account.'),
  });

  if (!open) return null;
  const canSave = !!name.trim() && !save.isPending;
  const rowCls = 'grid grid-cols-[110px_1fr] items-center gap-3 px-4 py-1.5 sm:grid-cols-[140px_1fr]';
  const labelCls = 'text-[11px] font-semibold uppercase tracking-wide text-slate-500';
  const fieldCls = 'h-8 w-full rounded border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20';

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 sm:items-center">
      <div className="w-full max-w-lg overflow-hidden rounded-lg border border-slate-300 bg-white shadow-2xl animate-fade-up">
        <div className="flex items-center justify-between border-b-2 border-brand-700 bg-brand-600 px-4 py-2 text-white">
          <span className="flex items-center gap-2 text-sm font-bold tracking-wide">
            <Landmark className="h-4 w-4" /> {editing ? 'Alter Bank Account' : 'Create Bank Account'}
          </span>
          <button onClick={onClose} className="rounded p-0.5 hover:bg-white/20" title="Close (Esc)"><X className="h-4 w-4" /></button>
        </div>

        {err && <div className="border-b border-red-200 bg-red-50 px-4 py-2 text-xs text-red-700">{err}</div>}

        <div className="divide-y divide-slate-100 py-2">
          <div className={rowCls}>
            <label className={labelCls} htmlFor="ba-name">Name</label>
            <input id="ba-name" autoFocus className={fieldCls} value={name} onChange={(e) => setName(e.target.value)}
              placeholder="e.g. HDFC Current" onKeyDown={(e) => { if (e.key === 'Enter' && canSave) save.mutate(); }} />
          </div>
          <div className={rowCls}>
            <label className={labelCls} htmlFor="ba-bank">Bank</label>
            <input id="ba-bank" className={fieldCls} value={bankName} onChange={(e) => setBankName(e.target.value)} placeholder="e.g. HDFC Bank Ltd" />
          </div>
          <div className={rowCls}>
            <label className={labelCls} htmlFor="ba-acno">A/C No.</label>
            <input id="ba-acno" className={`${fieldCls} font-mono`} value={accountNumber} onChange={(e) => setAccountNumber(e.target.value)} placeholder="50200012348823" />
          </div>
          <div className={rowCls}>
            <label className={labelCls} htmlFor="ba-ifsc">IFSC</label>
            <input id="ba-ifsc" className={`${fieldCls} font-mono uppercase`} value={ifsc} onChange={(e) => setIfsc(e.target.value)} placeholder="Optional" />
          </div>
          <div className={rowCls}>
            <label className={labelCls} htmlFor="ba-ob">Opening Bal.</label>
            <input id="ba-ob" type="number" step="0.01" className={`${fieldCls} text-right font-mono tabular-nums`} value={openingBalance}
              onChange={(e) => setOpeningBalance(e.target.value)} />
          </div>
          <div className={rowCls}>
            <label className={labelCls} htmlFor="ba-ason">As on</label>
            <div>
              <input id="ba-ason" type="date" className={fieldCls} value={openingAsOn} onChange={(e) => setOpeningAsOn(e.target.value)} />
              <p className="mt-1 text-[10.5px] leading-snug text-slate-400">
                Optional. Leave blank to count the whole book. If set, entries dated before it are excluded from the balance.
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-slate-200 bg-slate-50 px-4 py-2.5">
          <span className="text-[11px] text-slate-500">Balance shown = Opening + Receipts − Payments</span>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="h-8 rounded border border-slate-300 bg-white px-3 text-xs font-medium text-slate-600 hover:bg-slate-100">Cancel</button>
            <button onClick={() => save.mutate()} disabled={!canSave}
              className="inline-flex h-8 items-center gap-1.5 rounded bg-brand-600 px-4 text-xs font-semibold text-white hover:bg-brand-700 disabled:opacity-50">
              {save.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />} {editing ? 'Save' : 'Create'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
