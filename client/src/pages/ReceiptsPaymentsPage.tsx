// Receipts & Payments — upload the bank/cash book once. Receipts knock off each
// customer's oldest sales invoices; payments knock off each supplier's oldest
// purchase bills (FIFO). Unclassified account heads (salaries, expenses, or a
// party not yet in the system) can be tagged Customer / Supplier / Other — the
// first two create real records, Other is remembered with a category. Importing
// also stores the whole book for the Cashbook Summary.
import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeftRight, Loader2, Upload, CheckCircle2, ArrowDownToLine, ArrowUpFromLine,
  UserPlus, Truck, Tag, BarChart3, Search, ChevronLeft, ChevronRight, ListChecks, Download, Trash2,
} from 'lucide-react';
import { api } from '@/lib/api';
import { readXlsxMatrix, downloadXlsx, todayStamp } from '@/lib/excel';
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
  const [storeResult, setStoreResult] = useState<{ stored: number; skipped: number } | null>(null);

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
      // Store the whole book for the Cashbook Summary (duplicates skipped), then
      // post the allocations.
      const store = rows
        ? await api<{ stored: number; skipped: number }>('/cashbook/store', { method: 'POST', body: JSON.stringify({ rows }) })
        : { stored: 0, skipped: 0 };
      const post = await api<PostResult>('/receipts-payments/post', {
        method: 'POST',
        body: JSON.stringify({ paymentDate, reference: reference || null, ...body }),
      });
      return { store, post };
    },
    onSuccess: ({ store, post }) => {
      setResult(post); setStoreResult(store);
      ['payments', 'sales-invoices', 'debtor-aging', 'creditor-aging', 'purchases', 'cashbook-summary', 'cashbook-entries', 'cashbook-unclassified'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      setPreview(null); setRows(null);
    },
    onError: (e) => setUploadErr(e instanceof Error ? e.message : 'Import failed — nothing was saved.'),
  });

  const resetAll = useMutation({
    mutationFn: () => api<{ receipts: number; payments: number; entries: number }>('/cashbook/reset', { method: 'POST' }),
    onSuccess: (r) => {
      ['payments', 'sales-invoices', 'debtor-aging', 'creditor-aging', 'purchases', 'cashbook-summary', 'cashbook-entries', 'cashbook-unclassified', 'cashbook-overview', 'cashbook-duplicates', 'cashbook-transactions'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      setPreview(null); setRows(null); setResult(null);
      setUploadErr(`Cleared ${r.receipts} receipt(s), ${r.payments} payment(s) and ${r.entries} cashbook rows. You can re-upload now.`);
    },
    onError: (e) => setUploadErr(e instanceof Error ? e.message : 'Clear failed'),
  });
  const onClearAll = async () => {
    const ok = await confirm({
      title: 'Clear all imported receipts & payments?',
      message: <>This deletes every cashbook-imported receipt &amp; payment (reversing their invoice settlements) and clears the stored cashbook, so you can re-upload cleanly. Manual Receive-Payments are kept. This can't be undone.</>,
      confirmLabel: 'Clear all', tone: 'danger',
    });
    if (ok) resetAll.mutate();
  };

  const selReceipts = (preview?.receipts ?? []).filter((x) => rcvOn[x.customerId] && x.willApply > 0);
  const selPayments = (preview?.payments ?? []).filter((x) => payOn[x.supplierKey] && x.willApply > 0);
  const selRcvTotal = selReceipts.reduce((s, x) => s + x.willApply, 0);
  const selPayTotal = selPayments.reduce((s, x) => s + x.willApply, 0);

  // File-wide totals for the cards = matched (customer/supplier) + unclassified,
  // per side. So the cards reflect the whole bank book, not just what auto-matched.
  const uR = (preview?.unmatched ?? []).filter((u) => u.side === 'RECEIPT');
  const uP = (preview?.unmatched ?? []).filter((u) => u.side === 'PAYMENT');
  const sum = preview?.summary;
  const fileReceiptCount = (sum?.receiptCount ?? 0) + uR.length;
  const filePaymentCount = (sum?.paymentCount ?? 0) + uP.length;
  const fileReceiptTotal = round2((sum?.receiptTotal ?? 0) + uR.reduce((a, x) => a + x.amount, 0));
  const filePaymentTotal = round2((sum?.paymentTotal ?? 0) + uP.reduce((a, x) => a + x.amount, 0));

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
          <button onClick={onClearAll} disabled={resetAll.isPending} className="btn-ghost border border-slate-300 text-red-600 hover:bg-red-50 text-sm">
            {resetAll.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />} Clear all
          </button>
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
          {storeResult && (
            <div className="mt-1 text-xs">
              Cashbook: {storeResult.stored} new entr{storeResult.stored === 1 ? 'y' : 'ies'} stored
              {storeResult.skipped > 0 && <> · <b>{storeResult.skipped} duplicate{storeResult.skipped === 1 ? '' : 's'} skipped</b></>}.
            </div>
          )}
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
            <Stat label="Receipts (in file)" value={String(fileReceiptCount)} tone="emerald" />
            <Stat label="Receipt total" value={inr(fileReceiptTotal)} />
            <Stat label="Payments (in file)" value={String(filePaymentCount)} tone="brand" />
            <Stat label="Payment total" value={inr(filePaymentTotal)} />
            <Stat label="Unclassified" value={String(preview.summary.unmatchedCount)} tone={preview.summary.unmatchedCount ? 'amber' : undefined} />
            <Stat label="Unclassified ₹" value={inr(preview.summary.unmatchedTotal)} tone={preview.summary.unmatchedTotal ? 'amber' : undefined} />
          </div>
          <p className="-mt-3 text-xs text-slate-500">
            Totals cover the whole book. Only <b>{inr(sum?.receiptApply ?? 0)}</b> receipts + <b>{inr(sum?.paymentApply ?? 0)}</b> payments auto-settle open invoices/bills now (see “Will apply”); the rest are stored and can be tagged in the Cashbook Summary.
          </p>

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
              onChanged={() => { if (rows) runPreview(rows); ['customers', 'suppliers', 'cashbook-entries', 'cashbook-unclassified', 'cashbook-summary'].forEach((k) => qc.invalidateQueries({ queryKey: [k] })); }}
            />
          )}
        </>
      )}

      {/* All stored cashbook entries — filterable */}
      <EntriesSection />

      {confirmDialog}
    </div>
  );
};

/* ── All cashbook entries with multi-criteria filters ── */
type Entry = { id: string; entryDate: string | null; side: 'RECEIPT' | 'PAYMENT'; account: string; amount: number; vch: string | null; posted: boolean; type: string; category: string };
type EntriesResp = { items: Entry[]; total: number; page: number; pageSize: number; totals: { receipts: number; payments: number } };

const TYPE_TONE: Record<string, string> = {
  CUSTOMER: 'bg-emerald-50 text-emerald-700',
  SUPPLIER: 'bg-brand-50 text-brand-700',
  OTHER: 'bg-slate-100 text-slate-600',
  UNCLASSIFIED: 'bg-amber-50 text-amber-700',
};
const fmtD = (iso: string | null) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
};

const EntriesSection = () => {
  const qc = useQueryClient();
  const { confirm, confirmDialog } = useConfirm();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [side, setSide] = useState('ALL');
  const [type, setType] = useState('ALL');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const pageSize = 50;

  const qs = new URLSearchParams({ side, type, page: String(page), pageSize: String(pageSize) });
  if (from) qs.set('from', from);
  if (to) qs.set('to', to);
  if (search.trim()) qs.set('search', search.trim());

  const { data, isLoading } = useQuery({
    queryKey: ['cashbook-entries', side, type, from, to, search, page],
    queryFn: () => api<EntriesResp>(`/cashbook/entries?${qs.toString()}`),
  });
  const reset = (fn: () => void) => { fn(); setPage(1); setSel(new Set()); };
  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const [exporting, setExporting] = useState(false);

  const toggleRow = (id: string) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const pageAllSelected = items.length > 0 && items.every((e) => sel.has(e.id));
  const togglePage = () => setSel((s) => {
    const n = new Set(s);
    if (pageAllSelected) items.forEach((e) => n.delete(e.id)); else items.forEach((e) => n.add(e.id));
    return n;
  });

  const bulkDelete = useMutation({
    mutationFn: (ids: string[]) => api<{ deleted: number }>('/cashbook/entries/bulk-delete', { method: 'POST', body: JSON.stringify({ ids }) }),
    onSuccess: () => {
      setSel(new Set());
      ['cashbook-entries', 'cashbook-summary', 'cashbook-overview', 'cashbook-duplicates', 'cashbook-transactions'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
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
      message: <>Delete <strong>all {total}</strong> entr{total === 1 ? 'y' : 'ies'} matching the current filters, from the ledger &amp; summary? This can't be undone.</>,
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
      downloadXlsx(`cashbook-entries-${todayStamp()}`, 'Entries', (all.items ?? []).map((e) => ({
        Date: e.entryDate ? new Date(e.entryDate).toLocaleDateString('en-GB') : '',
        Party: e.account, Side: e.side === 'RECEIPT' ? 'Receipt' : 'Payment',
        Type: e.type, Category: e.category, Amount: e.amount, Allocated: e.posted ? 'Yes' : 'No',
      })));
    } finally { setExporting(false); }
  };

  return (
    <div className="card overflow-hidden">
      <div className="flex items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-4 py-2.5">
        <span className="flex items-center gap-2 text-sm font-semibold text-slate-700">
          <ListChecks className="h-4 w-4" /> Cashbook entries <span className="font-normal text-slate-400">({total})</span>
        </span>
        <div className="flex items-center gap-2">
          {sel.size > 0 && (
            <button onClick={delSelected} disabled={bulkDelete.isPending} className="btn-ghost h-8 border border-red-300 px-2 text-xs text-red-600 hover:bg-red-50 disabled:opacity-50">
              {bulkDelete.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />} Delete {sel.size}
            </button>
          )}
          <button onClick={delAllMatching} disabled={bulkDelete.isPending || total === 0} className="btn-ghost h-8 border border-slate-300 px-2 text-xs text-red-600 hover:bg-red-50 disabled:opacity-50" title="Delete all entries matching the current filters">
            <Trash2 className="h-3.5 w-3.5" /> Delete all
          </button>
          <button onClick={exportExcel} disabled={exporting || total === 0} className="btn-ghost h-8 border border-slate-300 px-2 text-xs text-emerald-700 hover:bg-emerald-50 disabled:opacity-50">
            {exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />} Excel
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="grid grid-cols-2 gap-2 border-b border-slate-100 p-3 sm:grid-cols-3 lg:grid-cols-6">
        <label className="block"><span className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-slate-500">From</span>
          <input type="date" className="input h-9" value={from} onChange={(e) => reset(() => setFrom(e.target.value))} /></label>
        <label className="block"><span className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-slate-500">To</span>
          <input type="date" className="input h-9" value={to} onChange={(e) => reset(() => setTo(e.target.value))} /></label>
        <label className="block"><span className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-slate-500">Side</span>
          <select className="input h-9" value={side} onChange={(e) => reset(() => setSide(e.target.value))}>
            <option value="ALL">All</option><option value="RECEIPT">Receipts</option><option value="PAYMENT">Payments</option>
          </select></label>
        <label className="block"><span className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-slate-500">Type</span>
          <select className="input h-9" value={type} onChange={(e) => reset(() => setType(e.target.value))}>
            <option value="ALL">All</option><option value="CUSTOMER">Customer</option><option value="SUPPLIER">Supplier</option><option value="OTHER">Other</option><option value="UNCLASSIFIED">Unclassified</option>
          </select></label>
        <label className="col-span-2 block"><span className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-slate-500">Search party</span>
          <div className="relative"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input className="input h-9 pl-9" placeholder="Party name…" value={search} onChange={(e) => reset(() => setSearch(e.target.value))} /></div></label>
      </div>

      {isLoading ? (
        <div className="py-10 text-center text-slate-400"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></div>
      ) : !items.length ? (
        <div className="py-10 text-center text-sm text-slate-400">No entries for these filters.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm whitespace-nowrap">
            <thead><tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
              <th className="w-9 px-3 py-2.5 text-center">
                <input type="checkbox" checked={pageAllSelected} onChange={togglePage} className="rounded border-slate-300 text-brand-600 focus:ring-brand-500" title="Select all on this page" />
              </th>
              <th className="px-3 py-2.5 text-left">Date</th>
              <th className="px-3 py-2.5 text-left">Party</th>
              <th className="px-3 py-2.5 text-left">Side</th>
              <th className="px-3 py-2.5 text-left">Type / Category</th>
              <th className="px-3 py-2.5 text-right">Amount</th>
              <th className="px-3 py-2.5 text-center">Allocated</th>
            </tr></thead>
            <tbody className="divide-y divide-slate-100">
              {items.map((e) => (
                <tr key={e.id} className={cn('hover:bg-slate-50/60', sel.has(e.id) && 'bg-brand-50/40')}>
                  <td className="px-3 py-2 text-center">
                    <input type="checkbox" checked={sel.has(e.id)} onChange={() => toggleRow(e.id)} className="rounded border-slate-300 text-brand-600 focus:ring-brand-500" />
                  </td>
                  <td className="px-3 py-2 text-slate-600">{fmtD(e.entryDate)}</td>
                  <td className="px-3 py-2 font-medium">{e.account}</td>
                  <td className="px-3 py-2">
                    <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-medium', e.side === 'RECEIPT' ? 'bg-emerald-50 text-emerald-700' : 'bg-brand-50 text-brand-700')}>{e.side === 'RECEIPT' ? 'Receipt' : 'Payment'}</span>
                  </td>
                  <td className="px-3 py-2">
                    <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-medium', TYPE_TONE[e.type] ?? 'bg-slate-100 text-slate-600')}>{e.category}</span>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums font-semibold">{inr(e.amount)}</td>
                  <td className="px-3 py-2 text-center">
                    {e.posted ? <CheckCircle2 className="mx-auto h-4 w-4 text-emerald-600" /> : <span className="text-[11px] text-slate-300">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Footer: totals + pagination */}
      <div className="flex flex-col gap-2 border-t border-slate-200 px-4 py-2.5 text-xs sm:flex-row sm:items-center sm:justify-between">
        <div className="text-slate-500">
          Receipts <b className="text-emerald-700">{inr(data?.totals.receipts)}</b> · Payments <b className="text-brand-700">{inr(data?.totals.payments)}</b>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-slate-500">Page {page} / {pages}</span>
          <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="btn-ghost h-8 border border-slate-300 px-2 disabled:opacity-40"><ChevronLeft className="h-4 w-4" /></button>
          <button disabled={page >= pages} onClick={() => setPage((p) => p + 1)} className="btn-ghost h-8 border border-slate-300 px-2 disabled:opacity-40"><ChevronRight className="h-4 w-4" /></button>
        </div>
      </div>
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
                        <input autoFocus className="input h-8 w-40" placeholder="Category e.g. Salary" value={cat}
                          onChange={(e) => setCat(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter' && cat.trim() && !isBusy) { e.preventDefault(); asOther(u.name); } }} />
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
