// Receipts & Payments — the bank book, laid out like a Tally day book.
//
// A company keeps one or more bank accounts; each account owns its own set of
// cash-book rows and its own opening balance, and statements are uploaded per
// account. Receipts knock off each customer's oldest sales invoices; payments
// knock off each supplier's oldest purchase bills (FIFO).
//
// Deliberately cash-side only: a party's receivable/payable never depends on
// WHICH bank the money moved through, so aging, the party ledger and the
// reconciliation engine stay global across every account.
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Loader2, Upload, CheckCircle2, ArrowDownToLine, UserPlus, Truck, Tag, BarChart3,
  Search, ChevronLeft, ChevronRight, Download, Trash2, NotebookPen, Plus, RefreshCw,
  Landmark, Pencil, Star, Wallet, BookOpen, AlertTriangle,
} from 'lucide-react';
import { api } from '@/lib/api';
import { readXlsxMatrix, downloadXlsx, todayStamp } from '@/lib/excel';
import { cn } from '@/lib/cn';
import { useConfirm } from '@/hooks/useConfirm';
import { useAuthStore, activeMembership } from '@/store/auth';
import { SearchableSelect } from '@/components/SearchableSelect';
import { DateRangeFilter } from '@/components/DateRangeFilter';
import { BankAccountDialog, type BankAccount } from '@/components/BankAccountDialog';

type ReceiptItem = { customerId: string; name: string; code?: string; amount: number; systemPending: number; willApply: number };
type PaymentItem = { supplierKey: string; name: string; amount: number; systemPending: number; willApply: number };
type Unmatched = { side: 'RECEIPT' | 'PAYMENT'; name: string; amount: number };
type FileCheck = {
  entryCount: number;
  receiptTotal: number;
  paymentTotal: number;
  undated: number;
  skipped: { balanceRows: number; cancelled: number; unreadableAmount: number };
  balance: null | {
    statedOpening: number | null;
    statedClosing: number;
    computedClosing: number;
    difference: number;
    matches: boolean;
  };
};
type Preview = {
  asOn: string | null;
  receipts: ReceiptItem[];
  payments: PaymentItem[];
  unmatched: Unmatched[];
  fileCheck?: FileCheck;
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
type BankResp = { items: BankAccount[]; totals: { openingBalance: number; receipts: number; payments: number; balance: number; entryCount: number } };

/* Tally writes plain grouped figures in the grid and keeps ₹ for headline totals. */
const num = (n: number | undefined | null) =>
  Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const inr = (n: number | undefined) =>
  '₹' + Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const round2 = (n: number) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const fmtD = (iso: string | null) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
};
const last4 = (acc: string | null) => (acc && acc.length > 4 ? `••${acc.slice(-4)}` : acc || '');

/* ── Shared Tally chrome ───────────────────────────────────────────────────── */
const Panel = ({ title, icon, right, children, className }: {
  title: React.ReactNode; icon?: React.ReactNode; right?: React.ReactNode; children: React.ReactNode; className?: string;
}) => (
  <section className={cn('overflow-hidden rounded border border-slate-300 bg-white shadow-sm', className)}>
    <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-300 bg-slate-100 px-3 py-1.5">
      <h2 className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-600">
        {icon}{title}
      </h2>
      {right}
    </header>
    {children}
  </section>
);

const Th = ({ children, align = 'left', className }: { children?: React.ReactNode; align?: 'left' | 'right' | 'center'; className?: string }) => (
  <th className={cn(
    'border-b-2 border-slate-300 bg-slate-100 px-2 py-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-500',
    align === 'right' && 'text-right', align === 'center' && 'text-center', align === 'left' && 'text-left', className,
  )}>{children}</th>
);

/* Right-hand Tally button bar. Collapses to a horizontal strip on small screens. */
const ActionButton = ({ label, hint, icon, onClick, disabled, tone }: {
  label: string; hint?: string; icon: React.ReactNode; onClick: () => void; disabled?: boolean; tone?: 'danger' | 'primary';
}) => (
  <button
    onClick={onClick} disabled={disabled} title={hint ? `${label} (${hint})` : label}
    className={cn(
      'flex w-full items-center gap-2 rounded border px-2.5 py-1.5 text-left text-[11px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-40',
      tone === 'danger' ? 'border-red-200 bg-white text-red-600 hover:bg-red-50'
        : tone === 'primary' ? 'border-brand-600 bg-brand-600 text-white hover:bg-brand-700'
        : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-100',
    )}
  >
    <span className="shrink-0">{icon}</span>
    <span className="flex-1 truncate">{label}</span>
    {hint && <kbd className={cn('shrink-0 rounded px-1 py-0.5 text-[9px] font-bold',
      tone === 'primary' ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-400')}>{hint}</kbd>}
  </button>
);

type StoreResult = {
  stored: number;
  skipped: number;
  duplicates?: number;
  rowsRead?: number;
  receiptTotal?: number;
  paymentTotal?: number;
  undated?: number;
  continuationRows?: number;
  check?: {
    statedOpening: number | null;
    statedClosing: number;
    computedClosing: number;
    difference: number;
    matches: boolean;
  } | null;
};

export const ReceiptsPaymentsPage = () => {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { confirm, confirmDialog } = useConfirm();
  const fileRef = useRef<HTMLInputElement>(null);
  const companyId = useAuthStore(activeMembership)?.companyId ?? '';

  const [rows, setRows] = useState<unknown[][] | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadErr, setUploadErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [paymentDate, setPaymentDate] = useState(todayISO());
  const [reference, setReference] = useState('Receipts & Payments import');
  const [rcvOn, setRcvOn] = useState<Record<string, boolean>>({});
  const [payOn, setPayOn] = useState<Record<string, boolean>>({});
  const [result, setResult] = useState<PostResult | null>(null);
  const [storeResult, setStoreResult] = useState<StoreResult | null>(null);

  /* Which account the book is being viewed / imported against. '' = all accounts. */
  const [bankId, setBankId] = useState('');
  const [dlgOpen, setDlgOpen] = useState(false);
  const [editing, setEditing] = useState<BankAccount | null>(null);

  const { data: banks } = useQuery({
    queryKey: ['bank-accounts'],
    queryFn: () => api<BankResp>('/bank-accounts'),
  });
  const accounts = banks?.items ?? [];
  const selected = accounts.find((a) => a.id === bankId) ?? null;
  // Uploads must land in one specific account; fall back to the default.
  const importTarget = selected ?? accounts.find((a) => a.isDefault) ?? accounts[0] ?? null;

  const openCreate = () => { setEditing(null); setDlgOpen(true); };
  const openEdit = (b: BankAccount) => { setEditing(b); setDlgOpen(true); };

  const runPreview = async (matrix: unknown[][]) => {
    const data = await api<Preview>('/receipts-payments/preview', { method: 'POST', json: { rows: matrix } });
    setPreview(data);
    const r: Record<string, boolean> = {};
    for (const it of data.receipts) if (it.willApply > 0) r[it.customerId] = true;
    setRcvOn(r);
    const p: Record<string, boolean> = {};
    for (const it of data.payments) if (it.willApply > 0) p[it.supplierKey] = true;
    setPayOn(p);
  };

  const handleFile = async (file: File) => {
    setUploading(true); setUploadErr(null); setNotice(null); setResult(null); setPreview(null);
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

  const pickFile = () => {
    if (!importTarget) { setUploadErr('Create a bank account first — a statement has to be imported into one.'); return; }
    fileRef.current?.click();
  };

  const importMutation = useMutation({
    mutationFn: async (body: { receipts: { customerId: string; amount: number }[]; payments: { supplierKey: string; amount: number }[] }) => {
      // Store the whole book against the chosen bank account (duplicates skipped),
      // then post the allocations.
      const store = rows
        ? await api<StoreResult>('/cashbook/store', { method: 'POST', json: { rows, bankAccountId: importTarget?.id } })
        : { stored: 0, skipped: 0 };
      const post = await api<PostResult>('/receipts-payments/post', {
        method: 'POST',
        json: { paymentDate, reference: reference || null, ...body },
      });
      // Re-derive every invoice/bill paid amount from the (now-updated) bank book,
      // FIFO across ALL current invoices. This makes the import idempotent and
      // flows any advance/"On Account" credit onto newer invoices automatically.
      await api('/receipts-payments/recompute', { method: 'POST' }).catch(() => {});
      return { store, post };
    },
    onSuccess: ({ store, post }) => {
      setResult(post); setStoreResult(store);
      ['payments', 'sales-invoices', 'debtor-aging', 'creditor-aging', 'purchases', 'cashbook-summary', 'cashbook-entries', 'cashbook-unclassified', 'cashbook-bank-balance', 'party-ledger', 'bank-accounts'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      setPreview(null); setRows(null);
    },
    onError: (e) => setUploadErr(e instanceof Error ? e.message : 'Import failed — nothing was saved.'),
  });

  const recomputeMut = useMutation({
    mutationFn: () => api<{ ok: boolean; receivables: { applied: number }; payables: { applied: number } }>('/receipts-payments/recompute', { method: 'POST' }),
    onSuccess: (r) => {
      ['payments', 'sales-invoices', 'debtor-aging', 'creditor-aging', 'purchases', 'cashbook-summary', 'cashbook-bank-balance', 'party-ledger', 'bank-accounts'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      setUploadErr(null);
      setNotice(`Recomputed from the bank book — receivables ${inr(r.receivables.applied)}, payables ${inr(r.payables.applied)} applied. Advances now flow onto newer invoices.`);
    },
    onError: (e) => setUploadErr(e instanceof Error ? e.message : 'Recompute failed'),
  });

  const resetAll = useMutation({
    mutationFn: () => api<{ receipts: number; payments: number; entries: number }>('/cashbook/reset', { method: 'POST' }),
    onSuccess: (r) => {
      ['payments', 'sales-invoices', 'debtor-aging', 'creditor-aging', 'purchases', 'cashbook-summary', 'cashbook-entries', 'cashbook-unclassified', 'cashbook-overview', 'cashbook-duplicates', 'cashbook-transactions', 'cashbook-bank-balance', 'bank-accounts'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      setPreview(null); setRows(null); setResult(null); setUploadErr(null);
      setNotice(`Cleared ${r.receipts} receipt(s), ${r.payments} payment(s) and ${r.entries} cashbook rows. You can re-upload now.`);
    },
    onError: (e) => setUploadErr(e instanceof Error ? e.message : 'Clear failed'),
  });

  const onClearAll = async () => {
    const entries = banks?.totals.entryCount ?? 0;
    const ok = await confirm({
      title: 'Clear the whole cash book?',
      message: (
        <>
          This deletes <strong>all {entries.toLocaleString('en-IN')}</strong> cashbook entr{entries === 1 ? 'y' : 'ies'} <strong>across every bank account</strong>,
          reverses the invoice settlements they created, and clears the stored cashbook so you can re-upload cleanly.
          Bank accounts themselves and manual Receive-Payments are kept. <strong>This cannot be undone.</strong>
        </>
      ),
      // Typing it out makes an irreversible wipe impossible to trigger by a stray click.
      challenge: 'CLEAR BOOK',
      confirmLabel: 'Clear all', tone: 'danger',
    });
    if (ok) resetAll.mutate();
  };

  const deleteBank = useMutation({
    mutationFn: (id: string) => api(`/bank-accounts/${id}`, { method: 'DELETE' }),
    onSuccess: () => { setBankId(''); qc.invalidateQueries({ queryKey: ['bank-accounts'] }); },
    onError: (e) => setUploadErr(e instanceof Error ? e.message : 'Could not delete the account'),
  });
  const makeDefault = useMutation({
    mutationFn: (id: string) => api(`/bank-accounts/${id}/default`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['bank-accounts'] }),
  });
  const onDeleteBank = async (b: BankAccount) => {
    const ok = await confirm({
      title: 'Delete this bank account?',
      message: <>Remove <strong>{b.name}</strong>? {b.entryCount > 0
        ? <>It still holds <strong>{b.entryCount}</strong> cashbook {b.entryCount === 1 ? 'entry' : 'entries'} — those must be deleted first.</>
        : <>It has no entries, so nothing else is affected.</>}</>,
      tone: 'danger', confirmLabel: 'Delete',
    });
    if (ok) { setUploadErr(null); deleteBank.mutate(b.id); }
  };

  /* Tally-style function keys. Alt+F2 (date range) is owned by DateRangeFilter.
     Suspended while the account dialog is open so F4 can't wipe a half-typed
     Alter form by flipping it back to Create. */
  useEffect(() => {
    if (dlgOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.key === 'F4') { e.preventDefault(); openCreate(); }
      else if (e.key === 'F6') { e.preventDefault(); pickFile(); }
      else if (e.key === 'F9') { e.preventDefault(); if (!recomputeMut.isPending) recomputeMut.mutate(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const selReceipts = (preview?.receipts ?? []).filter((x) => rcvOn[x.customerId] && x.willApply > 0);
  const selPayments = (preview?.payments ?? []).filter((x) => payOn[x.supplierKey] && x.willApply > 0);
  const selRcvTotal = selReceipts.reduce((s, x) => s + x.willApply, 0);
  const selPayTotal = selPayments.reduce((s, x) => s + x.willApply, 0);

  const uR = (preview?.unmatched ?? []).filter((u) => u.side === 'RECEIPT');
  const uP = (preview?.unmatched ?? []).filter((u) => u.side === 'PAYMENT');
  const sum = preview?.summary;
  const fileReceiptTotal = round2((sum?.receiptTotal ?? 0) + uR.reduce((a, x) => a + x.amount, 0));
  const filePaymentTotal = round2((sum?.paymentTotal ?? 0) + uP.reduce((a, x) => a + x.amount, 0));

  const handleImport = async () => {
    if (!importTarget) { setUploadErr('Create a bank account first.'); return; }
    const ok = await confirm({
      title: `Import into ${importTarget.name}?`,
      message: <>This stores the whole book against <strong>{importTarget.name}</strong> and posts <strong>{selReceipts.length}</strong> receipt{selReceipts.length !== 1 ? 's' : ''} ({inr(selRcvTotal)}) + <strong>{selPayments.length}</strong> payment{selPayments.length !== 1 ? 's' : ''} ({inr(selPayTotal)}), FIFO to the oldest open invoices. Re-importing the same statement is skipped automatically.</>,
      confirmLabel: 'Import',
    });
    if (!ok) return;
    setUploadErr(null); setNotice(null);
    importMutation.mutate({
      receipts: selReceipts.map((x) => ({ customerId: x.customerId, amount: round2(x.amount) })),
      payments: selPayments.map((x) => ({ supplierKey: x.supplierKey, amount: round2(x.amount) })),
    });
  };

  const shownBalance = selected ? selected.balance : (banks?.totals.balance ?? 0);
  const shownReceipts = selected ? selected.receipts : (banks?.totals.receipts ?? 0);
  const shownPayments = selected ? selected.payments : (banks?.totals.payments ?? 0);
  const shownOpening = selected ? selected.openingBalance : (banks?.totals.openingBalance ?? 0);
  const preOpening = selected
    ? (selected.preOpeningCount ?? 0)
    : accounts.reduce((s, a) => s + (a.preOpeningCount ?? 0), 0);

  return (
    <div className="max-w-full space-y-3 text-[13px]">
      {/* ── Title bar ── */}
      <div className="flex flex-col gap-2 rounded border border-brand-700 bg-brand-600 px-3 py-2 text-white sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2.5">
          <span className="grid h-8 w-8 place-items-center rounded bg-white/15 ring-1 ring-white/25">
            <BookOpen className="h-4 w-4" />
          </span>
          <div>
            <h1 className="text-sm font-bold uppercase tracking-wider sm:text-base">Receipts &amp; Payments</h1>
            <p className="text-[10.5px] text-white/75">Bank book · statements import per account · FIFO settlement</p>
          </div>
        </div>
        <div className="flex items-center gap-4 sm:gap-6">
          <div className="text-right">
            <div className="text-[9.5px] font-semibold uppercase tracking-wider text-white/60">
              {selected ? selected.name : 'All accounts'} · Balance
            </div>
            <div className="font-mono text-base font-bold tabular-nums sm:text-lg">{num(shownBalance)}</div>
          </div>
          <Link to="/accounts/cashbook-summary"
            className="hidden items-center gap-1.5 rounded border border-white/25 bg-white/15 px-2.5 py-1.5 text-[11px] font-semibold hover:bg-white/25 sm:inline-flex">
            <BarChart3 className="h-3.5 w-3.5" /> Summary
          </Link>
        </div>
      </div>

      {/* ── Bank account strip ── */}
      <Panel
        title={<><Landmark className="h-3.5 w-3.5" /> Bank Accounts <span className="font-normal normal-case tracking-normal text-slate-400">({accounts.length})</span></>}
        right={
          <button onClick={openCreate} className="inline-flex items-center gap-1 rounded border border-brand-600 bg-brand-600 px-2 py-1 text-[10.5px] font-bold uppercase tracking-wide text-white hover:bg-brand-700">
            <Plus className="h-3 w-3" /> Add <kbd className="rounded bg-white/20 px-1 text-[9px]">F4</kbd>
          </button>
        }
      >
        <div className="flex gap-2 overflow-x-auto p-2">
          <button
            onClick={() => setBankId('')}
            className={cn('min-w-[150px] shrink-0 rounded border px-3 py-2 text-left transition',
              !bankId ? 'border-brand-500 bg-brand-50 ring-1 ring-brand-300' : 'border-slate-300 bg-white hover:bg-slate-50')}
          >
            <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-600">
              <Wallet className="h-3.5 w-3.5" /> All accounts
            </div>
            <div className={cn('mt-1 font-mono text-sm font-bold tabular-nums', (banks?.totals.balance ?? 0) >= 0 ? 'text-brand-700' : 'text-red-600')}>
              {num(banks?.totals.balance)}
            </div>
            <div className="text-[10px] text-slate-400">{banks?.totals.entryCount ?? 0} entries</div>
          </button>

          {accounts.map((b) => (
            <div key={b.id}
              className={cn('group relative min-w-[190px] shrink-0 rounded border px-3 py-2 transition',
                bankId === b.id ? 'border-brand-500 bg-brand-50 ring-1 ring-brand-300' : 'border-slate-300 bg-white hover:bg-slate-50')}>
              <button onClick={() => setBankId(b.id)} className="block w-full text-left">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-[11px] font-bold uppercase tracking-wide text-slate-700">{b.name}</span>
                  {b.isDefault && <Star className="h-3 w-3 shrink-0 fill-amber-400 text-amber-400" aria-label="Default" />}
                </div>
                <div className={cn('mt-1 font-mono text-sm font-bold tabular-nums', b.balance >= 0 ? 'text-brand-700' : 'text-red-600')}>
                  {num(b.balance)}
                </div>
                <div className="truncate text-[10px] text-slate-400">
                  {[b.bankName, last4(b.accountNumber)].filter(Boolean).join(' · ') || `${b.entryCount} entries`}
                </div>
              </button>
              {/* Row actions appear on hover / focus so the card stays clean */}
              <div className="absolute right-1 top-1 flex gap-0.5 opacity-0 transition group-hover:opacity-100 focus-within:opacity-100">
                {!b.isDefault && (
                  <button onClick={() => makeDefault.mutate(b.id)} title="Make default"
                    className="rounded p-1 text-slate-400 hover:bg-amber-50 hover:text-amber-600"><Star className="h-3 w-3" /></button>
                )}
                <button onClick={() => openEdit(b)} title="Alter"
                  className="rounded p-1 text-slate-400 hover:bg-brand-50 hover:text-brand-700"><Pencil className="h-3 w-3" /></button>
                <button onClick={() => onDeleteBank(b)} title="Delete"
                  className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"><Trash2 className="h-3 w-3" /></button>
              </div>
            </div>
          ))}

          {accounts.length === 0 && (
            <div className="px-2 py-3 text-xs text-slate-400">No bank accounts yet — press <b>F4</b> or <b>Add</b> to create one.</div>
          )}
        </div>
        {/* Opening / receipts / payments recap for whatever is selected */}
        <div className="grid grid-cols-2 gap-px border-t border-slate-200 bg-slate-200 sm:grid-cols-4">
          {[
            { l: 'Opening balance', v: num(shownOpening), c: 'text-slate-700' },
            { l: 'Receipts since opening', v: num(shownReceipts), c: 'text-emerald-700' },
            { l: 'Payments since opening', v: num(shownPayments), c: 'text-rose-700' },
            { l: 'Closing balance', v: num(shownBalance), c: shownBalance >= 0 ? 'text-brand-700' : 'text-red-600' },
          ].map((s) => (
            <div key={s.l} className="bg-white px-3 py-1.5">
              <div className="text-[9.5px] font-semibold uppercase tracking-wider text-slate-400">{s.l}</div>
              <div className={cn('font-mono text-sm font-bold tabular-nums', s.c)}>{s.v}</div>
            </div>
          ))}
        </div>
        {/* Entries older than the opening date sit in the day book but not in the
            balance — say so rather than letting the two figures silently disagree. */}
        {preOpening > 0 && (
          <div className="border-t border-amber-200 bg-amber-50 px-3 py-1.5 text-[11px] text-amber-800">
            <b>{preOpening}</b> {preOpening === 1 ? 'entry is' : 'entries are'} dated before the opening-balance date
            {selected ? '' : ' of their account'} — {preOpening === 1 ? 'it is' : 'they are'} listed in the day book but excluded from the closing balance, since the opening figure already covers that period.
          </div>
        )}
      </Panel>

      <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />

      {/* ── Body: work area + right action bar ── */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start">
        <div className="min-w-0 flex-1 space-y-3">
          {uploadErr && <div className="rounded border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700">{uploadErr}</div>}
          {notice && <div className="rounded border border-brand-300 bg-brand-50 px-3 py-2 text-xs text-brand-800">{notice}</div>}

          {result && (
            <div className="rounded border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
              <div className="flex items-center gap-2 font-semibold">
                <CheckCircle2 className="h-4 w-4" />
                Imported. Posted {result.receipts} receipt{result.receipts !== 1 ? 's' : ''} ({inr(result.allocatedReceipts)}) and {result.payments} payment{result.payments !== 1 ? 's' : ''} ({inr(result.allocatedPayments)}).
              </div>
              {storeResult && (
                <div className="mt-1">
                  Cashbook: {storeResult.stored} new entr{storeResult.stored === 1 ? 'y' : 'ies'} stored
                  {storeResult.skipped > 0 && <> · <b>{storeResult.skipped} duplicate{storeResult.skipped === 1 ? '' : 's'} skipped</b></>}.
                </div>
              )}
              {/* The book states its own opening and closing balance. Proving the
                  import against them is the only way the user learns that a file
                  was misread — a silently wrong balance looks exactly like a
                  correct one. */}
              {storeResult?.check && (
                <div className={cn('mt-1.5 rounded border px-2 py-1.5 font-sans',
                  storeResult.check.matches
                    ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
                    : 'border-red-300 bg-red-50 text-red-800')}>
                  <b>{storeResult.check.matches ? 'Balance verified against the file' : 'Balance does NOT match the file'}</b>
                  <div className="mt-0.5 tabular-nums">
                    Opening {inr(storeResult.check.statedOpening ?? 0)} + receipts {inr(storeResult.receiptTotal ?? 0)} − payments {inr(storeResult.paymentTotal ?? 0)} = <b>{inr(storeResult.check.computedClosing)}</b>
                    {' · '}the file says <b>{inr(storeResult.check.statedClosing)}</b>
                    {!storeResult.check.matches && <> · <b>off by {inr(Math.abs(storeResult.check.difference))}</b></>}
                  </div>
                  {!storeResult.check.matches && (
                    <div className="mt-0.5">Do not rely on these figures until the difference is explained.</div>
                  )}
                </div>
              )}
              {result.errors.length > 0 && (
                <ul className="mt-1.5 list-disc pl-5 text-amber-700">
                  {result.errors.map((er, i) => <li key={i}>{er.side} {er.ref}: {er.message}</li>)}
                </ul>
              )}
              <div className="mt-1.5">
                See the <Link to="/accounts/cashbook-summary" className="font-semibold underline">Cashbook Summary</Link>, or ageing under{' '}
                <Link to="/sales-invoices/aging" className="font-semibold underline">Receivable</Link> /{' '}
                <Link to="/accounts/creditor-aging" className="font-semibold underline">Payable</Link>.
              </div>
            </div>
          )}

          {preview && importTarget && (
            <Panel
              title={<><ArrowDownToLine className="h-3.5 w-3.5" /> Import preview → {importTarget.name}</>}
              right={<span className="text-[10.5px] text-slate-500">{preview.asOn ? `Statement as on ${preview.asOn}` : 'Whole statement'}</span>}
            >
              <FileCheckPanel check={preview.fileCheck} />
              <div className="grid grid-cols-2 gap-px bg-slate-200 sm:grid-cols-4">
                {[
                  { l: 'Receipts in file', v: num(fileReceiptTotal), c: 'text-emerald-700' },
                  { l: 'Payments in file', v: num(filePaymentTotal), c: 'text-rose-700' },
                  { l: 'Will settle now', v: num((sum?.receiptApply ?? 0) + (sum?.paymentApply ?? 0)), c: 'text-brand-700' },
                  { l: `Unclassified (${sum?.unmatchedCount ?? 0})`, v: num(sum?.unmatchedTotal), c: (sum?.unmatchedCount ?? 0) ? 'text-amber-700' : 'text-slate-400' },
                ].map((s) => (
                  <div key={s.l} className="bg-white px-3 py-1.5">
                    <div className="text-[9.5px] font-semibold uppercase tracking-wider text-slate-400">{s.l}</div>
                    <div className={cn('font-mono text-sm font-bold tabular-nums', s.c)}>{s.v}</div>
                  </div>
                ))}
              </div>

              <div className="flex flex-col gap-2 border-t border-slate-200 bg-slate-50 p-2 sm:flex-row sm:items-end sm:justify-between">
                <div className="flex flex-wrap items-end gap-2">
                  <label className="block">
                    <span className="mb-0.5 block text-[9.5px] font-semibold uppercase tracking-wider text-slate-500">Post date</span>
                    <input type="date" className="h-8 rounded border border-slate-300 px-2 text-xs" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} />
                  </label>
                  <label className="block sm:w-64">
                    <span className="mb-0.5 block text-[9.5px] font-semibold uppercase tracking-wider text-slate-500">Reference</span>
                    <input className="h-8 w-full rounded border border-slate-300 px-2 text-xs" value={reference} onChange={(e) => setReference(e.target.value)} />
                  </label>
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <div className="text-[9.5px] font-semibold uppercase tracking-wider text-slate-500">Will apply</div>
                    <div className="font-mono text-base font-bold tabular-nums">{num(selRcvTotal + selPayTotal)}</div>
                  </div>
                  <button onClick={handleImport} disabled={importMutation.isPending}
                    className="inline-flex h-8 items-center gap-1.5 rounded bg-brand-600 px-4 text-xs font-bold uppercase tracking-wide text-white hover:bg-brand-700 disabled:opacity-50">
                    {importMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowDownToLine className="h-3.5 w-3.5" />}
                    Import
                  </button>
                </div>
              </div>

              <SideTable title="Receipts → customer invoices" tone="emerald" pendingLabel="Receivable"
                rows={preview.receipts.map((it) => ({
                  id: it.customerId, name: it.name, sub: it.code, amount: it.amount, pending: it.systemPending, willApply: it.willApply,
                  on: !!rcvOn[it.customerId], toggle: () => setRcvOn((p) => ({ ...p, [it.customerId]: !p[it.customerId] })),
                }))} />
              <SideTable title="Payments → supplier bills" tone="rose" pendingLabel="Payable"
                rows={preview.payments.map((it) => ({
                  id: it.supplierKey, name: it.name, amount: it.amount, pending: it.systemPending, willApply: it.willApply,
                  on: !!payOn[it.supplierKey], toggle: () => setPayOn((p) => ({ ...p, [it.supplierKey]: !p[it.supplierKey] })),
                }))} />
            </Panel>
          )}

          {preview && preview.unmatched.length > 0 && (
            <ClassifySection
              rows={preview.unmatched}
              companyId={companyId}
              onChanged={() => { if (rows) runPreview(rows); ['customers', 'suppliers', 'cashbook-entries', 'cashbook-unclassified', 'cashbook-summary'].forEach((k) => qc.invalidateQueries({ queryKey: [k] })); }}
            />
          )}

          <LedgerGrid bankId={bankId} bankName={selected?.name ?? null} showBankColumn={!bankId} />
          <SuspenseSection />
        </div>

        {/* ── Right-hand button bar (Tally) ── */}
        <aside className="w-full shrink-0 lg:sticky lg:top-4 lg:w-44">
          <div className="rounded border border-slate-300 bg-slate-50 p-2">
            <div className="mb-1.5 px-0.5 text-[9.5px] font-bold uppercase tracking-wider text-slate-400">Actions</div>
            <div className="grid grid-cols-2 gap-1.5 lg:grid-cols-1">
              <ActionButton label="Upload Register" hint="F6" tone="primary" icon={uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />} onClick={pickFile} disabled={uploading} />
              <ActionButton label="Add Bank" hint="F4" icon={<Landmark className="h-3.5 w-3.5" />} onClick={openCreate} />
              <ActionButton label="Recompute" hint="F9" icon={recomputeMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} onClick={() => recomputeMut.mutate()} disabled={recomputeMut.isPending} />
              <ActionButton label="Summary" icon={<BarChart3 className="h-3.5 w-3.5" />} onClick={() => navigate('/accounts/cashbook-summary')} />
              <ActionButton label="Clear Book" tone="danger" icon={resetAll.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />} onClick={onClearAll} disabled={resetAll.isPending} />
            </div>
            <p className="mt-2 hidden px-0.5 text-[10px] leading-relaxed text-slate-400 lg:block">
              <b className="text-slate-500">Alt+F2</b> date range · <b className="text-slate-500">F4</b> bank · <b className="text-slate-500">F6</b> upload · <b className="text-slate-500">F9</b> recompute
            </p>
          </div>
        </aside>
      </div>

      <BankAccountDialog open={dlgOpen} editing={editing} onClose={() => setDlgOpen(false)} onSaved={(id) => setBankId(id)} />
      {confirmDialog}
    </div>
  );
};

/* ── Import self-check ─────────────────────────────────────────────────────────
   Proves the file was read faithfully BEFORE anything is written: the rows we
   took, plus the statement's own opening balance, must land on the statement's
   own closing figure. Anything skipped is stated rather than swallowed. */
const FileCheckPanel = ({ check }: { check?: FileCheck }) => {
  if (!check) return null;
  const b = check.balance;
  const sk = check.skipped;
  const skippedNote = [
    sk.balanceRows ? `${sk.balanceRows} balance/total line${sk.balanceRows === 1 ? '' : 's'}` : '',
    sk.cancelled ? `${sk.cancelled} cancelled` : '',
    sk.unreadableAmount ? `${sk.unreadableAmount} with an unreadable amount` : '',
    check.undated ? `${check.undated} with no date` : '',
  ].filter(Boolean).join(' · ');

  const tone = !b ? 'slate' : b.matches ? 'emerald' : 'red';
  const cls = {
    emerald: 'border-emerald-300 bg-emerald-50 text-emerald-900',
    red: 'border-red-300 bg-red-50 text-red-900',
    slate: 'border-slate-200 bg-slate-50 text-slate-700',
  }[tone];

  return (
    <div className={cn('border-b px-3 py-2 text-[11px]', cls)}>
      <div className="flex items-center gap-1.5 font-bold uppercase tracking-wider">
        {b
          ? b.matches
            ? <><CheckCircle2 className="h-3.5 w-3.5" /> Statement verified — the figures tie out</>
            : <><AlertTriangle className="h-3.5 w-3.5" /> Statement does not tie out — check before importing</>
          : <>Read {check.entryCount} transaction{check.entryCount === 1 ? '' : 's'} from the file</>}
      </div>

      {b && (
        <div className="mt-1 font-mono tabular-nums">
          {b.statedOpening != null && <>Opening {num(b.statedOpening)} </>}
          + Receipts {num(check.receiptTotal)} − Payments {num(check.paymentTotal)} = <b>{num(b.computedClosing)}</b>
          {' vs '}statement closing <b>{num(b.statedClosing)}</b>
          {!b.matches && <span className="font-sans font-bold"> · off by {num(Math.abs(b.difference))}</span>}
        </div>
      )}

      {!b && (
        <div className="mt-1 font-mono tabular-nums">
          Receipts {num(check.receiptTotal)} · Payments {num(check.paymentTotal)}
          <span className="ml-2 font-sans text-slate-500">(no closing-balance line in the file to verify against)</span>
        </div>
      )}

      {skippedNote && <div className="mt-1 opacity-80">Skipped: {skippedNote}.</div>}

      {b && !b.matches && (
        <div className="mt-1 font-sans">
          Usually a row the file writes in an unusual way, or a missing page. Importing anyway will leave this
          bank's closing balance off by the same amount.
        </div>
      )}
    </div>
  );
};

/* ── The day book itself ───────────────────────────────────────────────────── */
type Entry = {
  id: string; entryDate: string | null; side: 'RECEIPT' | 'PAYMENT'; account: string; amount: number;
  vch: string | null; posted: boolean; type: string; category: string;
  bankAccountId: string | null; bankName: string | null;
};
type EntriesResp = { items: Entry[]; total: number; page: number; pageSize: number; totals: { receipts: number; payments: number } };

const TYPE_TONE: Record<string, string> = {
  CUSTOMER: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  SUPPLIER: 'bg-brand-50 text-brand-700 ring-brand-200',
  OTHER: 'bg-slate-100 text-slate-600 ring-slate-200',
  UNCLASSIFIED: 'bg-amber-50 text-amber-700 ring-amber-200',
};

const LedgerGrid = ({ bankId, bankName, showBankColumn }: { bankId: string; bankName: string | null; showBankColumn: boolean }) => {
  const qc = useQueryClient();
  const { confirm, confirmDialog } = useConfirm();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [side, setSide] = useState('ALL');
  const [type, setType] = useState('ALL');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [exporting, setExporting] = useState(false);
  const pageSize = 50;

  const qs = new URLSearchParams({ side, type, page: String(page), pageSize: String(pageSize) });
  if (from) qs.set('from', from);
  if (to) qs.set('to', to);
  if (search.trim()) qs.set('search', search.trim());
  if (bankId) qs.set('bankAccountId', bankId);

  const { data, isLoading } = useQuery({
    queryKey: ['cashbook-entries', side, type, from, to, search, page, bankId],
    queryFn: () => api<EntriesResp>(`/cashbook/entries?${qs.toString()}`),
  });
  // Switching bank account resets paging/selection — row ids no longer apply.
  useEffect(() => { setPage(1); setSel(new Set()); }, [bankId]);

  const reset = (fn: () => void) => { fn(); setPage(1); setSel(new Set()); };
  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / pageSize));

  const toggleRow = (id: string) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const pageAllSelected = items.length > 0 && items.every((e) => sel.has(e.id));
  const togglePage = () => setSel((s) => {
    const n = new Set(s);
    if (pageAllSelected) items.forEach((e) => n.delete(e.id)); else items.forEach((e) => n.add(e.id));
    return n;
  });

  const bulkDelete = useMutation({
    mutationFn: (ids: string[]) => api<{ deleted: number }>('/cashbook/entries/bulk-delete', { method: 'POST', json: { ids } }),
    onSuccess: () => {
      setSel(new Set());
      ['cashbook-entries', 'cashbook-summary', 'cashbook-overview', 'cashbook-duplicates', 'cashbook-transactions', 'bank-accounts'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
    },
  });

  const delSelected = async () => {
    const ids = [...sel];
    if (!ids.length) return;
    const ok = await confirm({
      title: 'Delete selected entries?',
      message: <>Delete <strong>{ids.length}</strong> cashbook entr{ids.length === 1 ? 'y' : 'ies'} from the ledger &amp; summary? This can't be undone.</>,
      tone: 'danger', confirmLabel: `Delete ${ids.length}`,
    });
    if (ok) bulkDelete.mutate(ids);
  };

  const delAllMatching = async () => {
    const ok = await confirm({
      title: 'Delete all filtered entries?',
      message: <>Delete <strong>all {total}</strong> entr{total === 1 ? 'y' : 'ies'} matching the current filters{bankName ? <> in <strong>{bankName}</strong></> : ''}, from the ledger &amp; summary? This can't be undone.</>,
      tone: 'danger', confirmLabel: `Delete ${total}`,
    });
    if (!ok) return;
    const eqs = new URLSearchParams(qs); eqs.set('all', '1'); eqs.delete('page'); eqs.delete('pageSize');
    const allRows = await api<EntriesResp>(`/cashbook/entries?${eqs.toString()}`);
    const ids = (allRows.items ?? []).map((e) => e.id);
    if (ids.length) bulkDelete.mutate(ids);
  };

  const exportExcel = async () => {
    setExporting(true);
    try {
      const eqs = new URLSearchParams(qs); eqs.set('all', '1'); eqs.delete('page'); eqs.delete('pageSize');
      const all = await api<EntriesResp>(`/cashbook/entries?${eqs.toString()}`);
      downloadXlsx(`cashbook-${todayStamp()}`, 'Day Book', (all.items ?? []).map((e) => ({
        Date: e.entryDate ? new Date(e.entryDate).toLocaleDateString('en-GB') : '',
        Particulars: e.account, 'Vch No': e.vch ?? '', Bank: e.bankName ?? '',
        Type: e.type, Category: e.category,
        Receipt: e.side === 'RECEIPT' ? e.amount : '', Payment: e.side === 'PAYMENT' ? e.amount : '',
        Allocated: e.posted ? 'Yes' : 'No',
      })));
    } finally { setExporting(false); }
  };

  const cols = showBankColumn ? 9 : 8;

  return (
    <Panel
      title={<><NotebookPen className="h-3.5 w-3.5" /> Day Book {bankName ? <span className="normal-case tracking-normal text-brand-700">· {bankName}</span> : <span className="font-normal normal-case tracking-normal text-slate-400">· all accounts</span>} <span className="font-normal normal-case tracking-normal text-slate-400">({total})</span></>}
      right={
        <div className="flex items-center gap-1.5">
          {sel.size > 0 && (
            <button onClick={delSelected} disabled={bulkDelete.isPending}
              className="inline-flex h-7 items-center gap-1 rounded border border-red-300 px-2 text-[10.5px] font-bold uppercase tracking-wide text-red-600 hover:bg-red-50 disabled:opacity-50">
              {bulkDelete.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />} Delete {sel.size}
            </button>
          )}
          <button onClick={delAllMatching} disabled={bulkDelete.isPending || total === 0}
            className="inline-flex h-7 items-center gap-1 rounded border border-slate-300 px-2 text-[10.5px] font-bold uppercase tracking-wide text-red-600 hover:bg-red-50 disabled:opacity-40">
            <Trash2 className="h-3 w-3" /> Delete all
          </button>
          <button onClick={exportExcel} disabled={exporting || total === 0}
            className="inline-flex h-7 items-center gap-1 rounded border border-slate-300 px-2 text-[10.5px] font-bold uppercase tracking-wide text-emerald-700 hover:bg-emerald-50 disabled:opacity-40">
            {exporting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />} Excel
          </button>
        </div>
      }
    >
      {/* Filter bar */}
      <div className="flex flex-wrap items-end gap-2 border-b border-slate-200 bg-slate-50 p-2">
        <div>
          <span className="mb-0.5 block text-[9.5px] font-semibold uppercase tracking-wider text-slate-500">Period</span>
          <DateRangeFilter from={from} to={to} onChange={(f, t) => reset(() => { setFrom(f); setTo(t); })} label="Filter day book by date" />
        </div>
        <label className="block">
          <span className="mb-0.5 block text-[9.5px] font-semibold uppercase tracking-wider text-slate-500">Side</span>
          <select className="h-8 rounded border border-slate-300 bg-white px-2 text-xs" value={side} onChange={(e) => reset(() => setSide(e.target.value))}>
            <option value="ALL">All</option><option value="RECEIPT">Receipts</option><option value="PAYMENT">Payments</option>
          </select>
        </label>
        <label className="block">
          <span className="mb-0.5 block text-[9.5px] font-semibold uppercase tracking-wider text-slate-500">Type</span>
          <select className="h-8 rounded border border-slate-300 bg-white px-2 text-xs" value={type} onChange={(e) => reset(() => setType(e.target.value))}>
            <option value="ALL">All</option><option value="CUSTOMER">Customer</option><option value="SUPPLIER">Supplier</option><option value="OTHER">Other</option><option value="UNCLASSIFIED">Unclassified</option>
          </select>
        </label>
        <label className="block min-w-[180px] flex-1">
          <span className="mb-0.5 block text-[9.5px] font-semibold uppercase tracking-wider text-slate-500">Particulars</span>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input className="h-8 w-full rounded border border-slate-300 bg-white pl-7 pr-2 text-xs" placeholder="Party name…" value={search} onChange={(e) => reset(() => setSearch(e.target.value))} />
          </div>
        </label>
      </div>

      {isLoading ? (
        <div className="py-10 text-center text-slate-400"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></div>
      ) : !items.length ? (
        <div className="py-10 text-center text-xs text-slate-400">No entries for this period.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-xs whitespace-nowrap">
            <thead>
              <tr>
                <Th align="center" className="w-8">
                  <input type="checkbox" checked={pageAllSelected} onChange={togglePage} className="rounded border-slate-300 text-brand-600 focus:ring-brand-500" title="Select all on this page" />
                </Th>
                <Th className="w-24">Date</Th>
                <Th>Particulars</Th>
                <Th className="w-24">Vch No</Th>
                {showBankColumn && <Th className="w-32">Bank</Th>}
                <Th className="w-32">Type</Th>
                <Th align="right" className="w-32 border-l border-slate-300">Receipt</Th>
                <Th align="right" className="w-32">Payment</Th>
                <Th align="center" className="w-16">Alloc</Th>
              </tr>
            </thead>
            <tbody>
              {items.map((e) => (
                <tr key={e.id} className={cn('border-b border-slate-100 hover:bg-brand-50/40', sel.has(e.id) && 'bg-brand-50/60')}>
                  <td className="px-2 py-1 text-center">
                    <input type="checkbox" checked={sel.has(e.id)} onChange={() => toggleRow(e.id)} className="rounded border-slate-300 text-brand-600 focus:ring-brand-500" />
                  </td>
                  <td className="px-2 py-1 font-mono text-[11px] text-slate-500">{fmtD(e.entryDate)}</td>
                  <td className="max-w-[280px] truncate px-2 py-1 font-medium text-slate-800">{e.account}</td>
                  <td className="px-2 py-1 font-mono text-[11px] text-slate-400">{e.vch || '—'}</td>
                  {showBankColumn && <td className="px-2 py-1 text-[11px] text-slate-500">{e.bankName || '—'}</td>}
                  <td className="px-2 py-1">
                    <span className={cn('rounded px-1.5 py-0.5 text-[10px] font-medium ring-1', TYPE_TONE[e.type] ?? 'bg-slate-100 text-slate-600 ring-slate-200')}>{e.category}</span>
                  </td>
                  <td className="border-l border-slate-200 px-2 py-1 text-right font-mono tabular-nums font-semibold text-emerald-700">
                    {e.side === 'RECEIPT' ? num(e.amount) : ''}
                  </td>
                  <td className="px-2 py-1 text-right font-mono tabular-nums font-semibold text-rose-700">
                    {e.side === 'PAYMENT' ? num(e.amount) : ''}
                  </td>
                  <td className="px-2 py-1 text-center">
                    {e.posted ? <CheckCircle2 className="mx-auto h-3.5 w-3.5 text-emerald-600" /> : <span className="text-[11px] text-slate-300">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-slate-400 bg-slate-100 font-bold">
                <td colSpan={cols - 3} className="px-2 py-1.5 text-right text-[10px] uppercase tracking-wider text-slate-500">
                  Total for this period
                </td>
                <td className="border-l border-slate-300 px-2 py-1.5 text-right font-mono tabular-nums text-emerald-800">{num(data?.totals.receipts)}</td>
                <td className="px-2 py-1.5 text-right font-mono tabular-nums text-rose-800">{num(data?.totals.payments)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      <div className="flex flex-col gap-2 border-t border-slate-200 bg-slate-50 px-3 py-1.5 text-[11px] sm:flex-row sm:items-center sm:justify-between">
        <div className="text-slate-500">
          Net for period <b className={cn('font-mono tabular-nums', (data?.totals.receipts ?? 0) - (data?.totals.payments ?? 0) >= 0 ? 'text-emerald-700' : 'text-rose-700')}>
            {num((data?.totals.receipts ?? 0) - (data?.totals.payments ?? 0))}
          </b>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-slate-500">Page {page} / {pages}</span>
          <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="rounded border border-slate-300 bg-white p-1 disabled:opacity-40"><ChevronLeft className="h-3.5 w-3.5" /></button>
          <button disabled={page >= pages} onClick={() => setPage((p) => p + 1)} className="rounded border border-slate-300 bg-white p-1 disabled:opacity-40"><ChevronRight className="h-3.5 w-3.5" /></button>
        </div>
      </div>
      {confirmDialog}
    </Panel>
  );
};

/* ── Suspense entries — manual single-legged ledger adjustments ─────────────── */
type Suspense = { id: string; voucherNo: string; entryDate: string | null; account: string; side: 'DEBIT' | 'CREDIT'; amount: number; narration: string | null };

const SuspenseSection = () => {
  const qc = useQueryClient();
  const { confirm, confirmDialog } = useConfirm();
  const [account, setAccount] = useState('');
  const [side, setSide] = useState<'DEBIT' | 'CREDIT'>('DEBIT');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(todayISO());
  const [narration, setNarration] = useState('');
  const [err, setErr] = useState<string | null>(null);

  const { data: accts } = useQuery({ queryKey: ['cashbook-accounts'], queryFn: () => api<{ items: { name: string; type: string }[] }>('/cashbook/accounts') });
  const { data, isLoading } = useQuery({ queryKey: ['journal-vouchers'], queryFn: () => api<{ items: Suspense[] }>('/cashbook/journal') });

  const invalidate = () => ['journal-vouchers', 'debtor-aging', 'creditor-aging', 'cashbook-ledger'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));

  const create = useMutation({
    mutationFn: () => api('/cashbook/journal', { method: 'POST', json: { account: account.trim(), side, amount: round2(Number(amount)), entryDate: date, narration: narration.trim() || null } }),
    onSuccess: () => { setAccount(''); setAmount(''); setNarration(''); setErr(null); invalidate(); },
    onError: (e) => setErr(e instanceof Error ? e.message : 'Could not save the entry'),
  });
  const del = useMutation({
    mutationFn: (id: string) => api(`/cashbook/journal/${id}`, { method: 'DELETE' }),
    onSuccess: invalidate,
  });

  const canSave = !!account.trim() && Number(amount) > 0;
  const submit = () => { if (!canSave) { setErr('Pick an account and enter a positive amount.'); return; } create.mutate(); };
  const onDelete = async (v: Suspense) => {
    const ok = await confirm({
      title: 'Delete this entry?',
      message: <>Delete <b>{v.voucherNo}</b> ({v.side === 'DEBIT' ? 'Dr' : 'Cr'} {inr(v.amount)} · {v.account})? This reverses its effect on the ledger &amp; aging.</>,
      tone: 'danger', confirmLabel: 'Delete',
    });
    if (ok) del.mutate(v.id);
  };

  const items = data?.items ?? [];
  const acctOptions = (accts?.items ?? []).map((a) => ({ value: a.name, label: a.name }));
  const fieldCls = 'h-8 w-full rounded border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20';

  return (
    <Panel title={<><Tag className="h-3.5 w-3.5" /> Suspense Entry <span className="font-normal normal-case tracking-normal text-slate-400">({items.length})</span></>}>
      <p className="border-b border-slate-100 px-3 py-1.5 text-[11px] leading-relaxed text-slate-500">
        A manual adjustment against any account. <b>Debit</b> increases what the party owes you; <b>Credit</b> increases what you owe them. It flows into the account ledger and Amount Receivable / Payable — not the cash balance.
      </p>
      {err && <div className="mx-3 mt-2 rounded border border-red-200 bg-red-50 px-2 py-1 text-[11px] text-red-700">{err}</div>}

      <div className="grid grid-cols-2 items-end gap-2 border-b border-slate-100 p-2 sm:grid-cols-6">
        <label className="block"><span className="mb-0.5 block text-[9.5px] font-semibold uppercase tracking-wider text-slate-500">Date</span>
          <input type="date" className={fieldCls} value={date} onChange={(e) => setDate(e.target.value)} /></label>
        <div className="col-span-2"><span className="mb-0.5 block text-[9.5px] font-semibold uppercase tracking-wider text-slate-500">Account</span>
          <SearchableSelect dense value={account} onChange={setAccount} options={acctOptions} placeholder="Select account…" /></div>
        <label className="block"><span className="mb-0.5 block text-[9.5px] font-semibold uppercase tracking-wider text-slate-500">Side</span>
          <select className={fieldCls} value={side} onChange={(e) => setSide(e.target.value as 'DEBIT' | 'CREDIT')}>
            <option value="DEBIT">Debit (Dr)</option><option value="CREDIT">Credit (Cr)</option>
          </select></label>
        <label className="block"><span className="mb-0.5 block text-[9.5px] font-semibold uppercase tracking-wider text-slate-500">Amount</span>
          <input type="number" min="0" step="0.01" className={cn(fieldCls, 'text-right font-mono tabular-nums')} placeholder="0.00" value={amount}
            onChange={(e) => setAmount(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && canSave && !create.isPending) { e.preventDefault(); submit(); } }} /></label>
        <button onClick={submit} disabled={create.isPending || !canSave}
          className="inline-flex h-8 items-center justify-center gap-1 rounded bg-brand-600 px-3 text-xs font-bold uppercase tracking-wide text-white hover:bg-brand-700 disabled:opacity-50">
          {create.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />} Add
        </button>
        <label className="col-span-2 sm:col-span-6"><span className="mb-0.5 block text-[9.5px] font-semibold uppercase tracking-wider text-slate-500">Narration (optional)</span>
          <input className={fieldCls} placeholder="e.g. Rate difference / rounding off / opening balance" value={narration} onChange={(e) => setNarration(e.target.value)} /></label>
      </div>

      {isLoading ? (
        <div className="py-6 text-center text-slate-400"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></div>
      ) : !items.length ? (
        <div className="py-6 text-center text-xs text-slate-400">No suspense entries yet.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-xs whitespace-nowrap">
            <thead><tr>
              <Th className="w-24">Voucher</Th><Th className="w-28">Date</Th><Th>Account</Th>
              <Th align="right" className="w-32 border-l border-slate-300">Debit</Th>
              <Th align="right" className="w-32">Credit</Th><Th>Narration</Th><Th className="w-8" />
            </tr></thead>
            <tbody>
              {items.map((v) => (
                <tr key={v.id} className="border-b border-slate-100 hover:bg-brand-50/40">
                  <td className="px-2 py-1 font-mono text-[11px] font-semibold text-brand-700">{v.voucherNo}</td>
                  <td className="px-2 py-1 font-mono text-[11px] text-slate-500">{fmtD(v.entryDate)}</td>
                  <td className="px-2 py-1 font-medium text-slate-800">{v.account}</td>
                  <td className="border-l border-slate-200 px-2 py-1 text-right font-mono tabular-nums text-slate-700">{v.side === 'DEBIT' ? num(v.amount) : ''}</td>
                  <td className="px-2 py-1 text-right font-mono tabular-nums text-slate-700">{v.side === 'CREDIT' ? num(v.amount) : ''}</td>
                  <td className="px-2 py-1 text-slate-500">{v.narration || '—'}</td>
                  <td className="px-1 py-1 text-center">
                    <button onClick={() => onDelete(v)} disabled={del.isPending} className="rounded p-1 text-red-500 hover:bg-red-50" title="Delete entry">
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {confirmDialog}
    </Panel>
  );
};

/* ── Classify unclassified account heads ───────────────────────────────────── */
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
  const adjust = (name: string) => api('/cashbook/adjust', { method: 'POST', json: { name } }).catch(() => {});
  const asCustomer = (name: string) => act(name, async () => { await api('/customers', { method: 'POST', json: { name } }); await adjust(name); });
  const asSupplier = (name: string) => act(name, async () => { await api('/suppliers', { method: 'POST', json: { name, companyIds: [companyId] } }); await adjust(name); });
  const asOther = (name: string) => act(name, () => api('/cashbook/account-heads', { method: 'POST', json: { name, category: cat.trim() } }));

  return (
    <Panel title={<><Tag className="h-3.5 w-3.5" /> Unclassified heads ({rows.length})</>} className="border-amber-300">
      <p className="border-b border-slate-100 bg-amber-50/60 px-3 py-1.5 text-[11px] text-amber-800">
        Tag each head so it's recognised next time. <b>Customer</b>/<b>Supplier</b> create a real record; <b>Other</b> is saved with a category for the summary.
      </p>
      {err && <div className="mx-3 mt-2 rounded border border-red-200 bg-red-50 px-2 py-1 text-[11px] text-red-700">{err}</div>}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-xs whitespace-nowrap">
          <thead><tr>
            <Th>Particulars</Th><Th className="w-24">Side</Th>
            <Th align="right" className="w-32">Amount</Th><Th className="w-72">Classify as</Th>
          </tr></thead>
          <tbody>
            {rows.map((u, i) => {
              const isBusy = busy === u.name;
              return (
                <tr key={i} className="border-b border-slate-100 hover:bg-amber-50/40">
                  <td className="px-2 py-1 font-medium text-slate-800">{u.name}</td>
                  <td className="px-2 py-1 text-slate-500">{u.side === 'RECEIPT' ? 'Receipt' : 'Payment'}</td>
                  <td className="px-2 py-1 text-right font-mono tabular-nums">{num(u.amount)}</td>
                  <td className="px-2 py-1">
                    {otherFor === u.name ? (
                      <div className="flex items-center gap-1.5">
                        <input autoFocus className="h-7 w-40 rounded border border-slate-300 px-2 text-xs" placeholder="Category e.g. Salary" value={cat}
                          onChange={(e) => setCat(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter' && cat.trim() && !isBusy) { e.preventDefault(); asOther(u.name); } }} />
                        <button disabled={isBusy || !cat.trim()} onClick={() => asOther(u.name)} className="h-7 rounded bg-brand-600 px-2 text-[11px] font-semibold text-white disabled:opacity-50">
                          {isBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Save'}
                        </button>
                        <button onClick={() => { setOtherFor(null); setCat(''); }} className="h-7 rounded px-2 text-[11px] text-slate-500 hover:bg-slate-100">Cancel</button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5">
                        <button disabled={isBusy} onClick={() => asCustomer(u.name)} className="inline-flex h-7 items-center gap-1 rounded border border-slate-300 px-2 text-[11px] text-emerald-700 hover:bg-emerald-50">
                          <UserPlus className="h-3 w-3" /> Customer
                        </button>
                        <button disabled={isBusy} onClick={() => asSupplier(u.name)} className="inline-flex h-7 items-center gap-1 rounded border border-slate-300 px-2 text-[11px] text-brand-700 hover:bg-brand-50">
                          <Truck className="h-3 w-3" /> Supplier
                        </button>
                        <button disabled={isBusy} onClick={() => { setOtherFor(u.name); setCat(''); }} className="inline-flex h-7 items-center gap-1 rounded border border-slate-300 px-2 text-[11px] text-slate-600 hover:bg-slate-50">
                          <Tag className="h-3 w-3" /> Other
                        </button>
                        {isBusy && <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-400" />}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  );
};

/* ── Preview side tables ───────────────────────────────────────────────────── */
type Row = { id: string; name: string; sub?: string; amount: number; pending: number; willApply: number; on: boolean; toggle: () => void };
const SideTable = ({ title, rows, pendingLabel, tone }: { title: string; rows: Row[]; pendingLabel: string; tone: 'emerald' | 'rose' }) => (
  <div className="border-t border-slate-200">
    <div className={cn('flex items-center gap-1.5 px-3 py-1 text-[10.5px] font-bold uppercase tracking-wider',
      tone === 'emerald' ? 'bg-emerald-50 text-emerald-800' : 'bg-rose-50 text-rose-800')}>
      {title} <span className="font-normal normal-case tracking-normal opacity-60">({rows.length})</span>
    </div>
    {rows.length === 0 ? (
      <div className="px-3 py-3 text-center text-[11px] text-slate-400">None found in the file.</div>
    ) : (
      <div className="max-h-72 overflow-auto">
        <table className="w-full border-collapse text-xs whitespace-nowrap">
          <thead className="sticky top-0"><tr>
            <Th className="w-8" />
            <Th>Party</Th>
            <Th align="right" className="w-28">In file</Th>
            <Th align="right" className="w-28">{pendingLabel}</Th>
            <Th align="right" className="w-28">Will apply</Th>
          </tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className={cn('border-b border-slate-100 hover:bg-brand-50/40', r.willApply <= 0 && 'opacity-50')}>
                <td className="px-2 py-1 text-center">
                  <input type="checkbox" checked={r.on} disabled={r.willApply <= 0} onChange={r.toggle}
                    className="rounded border-slate-300 text-brand-600 focus:ring-brand-500" />
                </td>
                <td className="px-2 py-1 font-medium text-slate-800">
                  {r.sub && <span className="mr-1.5 font-mono text-[11px] font-semibold text-brand-700">{r.sub}</span>}{r.name}
                </td>
                <td className="px-2 py-1 text-right font-mono tabular-nums text-slate-600">{num(r.amount)}</td>
                <td className="px-2 py-1 text-right font-mono tabular-nums text-slate-600">{num(r.pending)}</td>
                <td className="px-2 py-1 text-right font-mono tabular-nums font-semibold">{num(r.willApply)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )}
  </div>
);
