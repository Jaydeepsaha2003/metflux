// Sales Invoices — upload an accounting "List of Sales Vouchers" export, then
// browse / filter the resulting invoices. Rows that couldn't match a customer
// or compute a due date are flagged for attention and can be fixed inline.
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Receipt, Upload, Loader2, Search, AlertTriangle, X, CheckCircle2, Trash2, Pencil, CalendarClock,
} from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { readXlsxMatrix } from '@/lib/excel';
import { cn } from '@/lib/cn';
import { Pagination } from '@/components/Pagination';
import { SearchableSelect } from '@/components/SearchableSelect';
import { useConfirm } from '@/hooks/useConfirm';
import { useHideCustomerNames } from '@/store/auth';

type Invoice = {
  id: string; invoiceNumber: string; invoiceDate: string;
  customerId: string | null; customerName: string; customerCode: string | null; customerPhone: string | null;
  itemDetails: string | null; amount: number; paidAmount: number; balance: number;
  taxType: string | null; taxableAmount: number; igst: number; cgst: number; sgst: number; gst: number;
  docType: 'INVOICE' | 'CREDIT_NOTE';
  dueDate: string | null; status: 'UNPAID' | 'PARTIAL' | 'PAID'; daysOverdue: number | null; needsAttention: boolean;
};
type ListResp = { items: Invoice[]; total: number; page: number; pageSize: number; totals: { amount: number; paid: number; balance: number } };
type Summary = { totalInvoices: number; outstanding: number; overdue: number; openCount: number; attention: number };
type ImportResult = { imported: number; skippedDuplicates: number; datesFixed: number; cancelled: number; customersCreated: number; unmatchedCustomers: number; missingDueDays: number; totalInvoicesInFile: number; errors: { invoiceNumber: string; message: string }[] };

const PAGE_SIZE = 25;
type StatusFilter = 'ALL' | 'UNPAID' | 'PARTIAL' | 'PAID' | 'OVERDUE';
type DocFilter = 'ALL' | 'INVOICE' | 'CREDIT_NOTE';

const inr = (n: number) => '₹' + Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const fmtDate = (iso: string | null) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
};

const STATUS_BADGE: Record<Invoice['status'], string> = {
  UNPAID:  'bg-slate-100 text-slate-600',
  PARTIAL: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200',
  PAID:    'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200',
};

export const SalesInvoicesPage = () => {
  const qc = useQueryClient();
  const hideNames = useHideCustomerNames();
  const { confirm, confirmDialog } = useConfirm();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<StatusFilter>('ALL');
  const [docType, setDocType] = useState<DocFilter>('ALL');
  const [attention, setAttention] = useState(false);
  const [page, setPage] = useState(1);
  // `?due=today|overdue` deep-link from the "Invoices due today" reminder — shows
  // just those invoices, highlighted. Cleared by the banner's dismiss button.
  const [searchParams, setSearchParams] = useSearchParams();
  const due = searchParams.get('due') === 'today' ? 'today'
    : searchParams.get('due') === 'overdue' ? 'overdue' : '';
  const clearDue = () => setSearchParams((p) => { p.delete('due'); return p; }, { replace: true });
  // Bulk-selection state. `selected` holds explicitly-ticked ids (persists across
  // pages); `allMatching` means "every invoice matching the current filter".
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [allMatching, setAllMatching] = useState(false);
  // Changing the filter invalidates any selection — start fresh.
  useEffect(() => { setPage(1); setSelected(new Set()); setAllMatching(false); }, [search, status, attention, docType, due]);

  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fixTarget, setFixTarget] = useState<Invoice | null>(null);

  const { data: summary } = useQuery({
    queryKey: ['sales-invoice-summary'],
    queryFn: () => api<Summary>('/sales-invoices/summary'),
  });

  const { data, isLoading } = useQuery({
    queryKey: ['sales-invoices', search, status, attention, docType, page, due],
    queryFn: () => api<ListResp>(
      `/sales-invoices?status=${status}&filter=${attention ? 'ATTENTION' : 'ALL'}&docType=${docType}&page=${page}&pageSize=${PAGE_SIZE}${search ? `&search=${encodeURIComponent(search)}` : ''}${due ? `&due=${due}` : ''}`
    ),
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['sales-invoices'] });
    qc.invalidateQueries({ queryKey: ['sales-invoice-summary'] });
  };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploading(true); setError(null); setImportResult(null);
    try {
      const rows = await readXlsxMatrix(file);
      if (!rows.length) { setError('That file looks empty.'); return; }
      const res = await api<ImportResult>('/sales-invoices/import', { method: 'POST', json: { rows } });
      setImportResult(res);
      refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Import failed — is this the sales vouchers export?');
    } finally {
      setUploading(false);
    }
  };

  const del = useMutation({
    mutationFn: (id: string) => api(`/sales-invoices/${id}`, { method: 'DELETE' }),
    onSuccess: refresh,
  });

  const clearSelection = () => { setSelected(new Set()); setAllMatching(false); };

  const bulkDel = useMutation({
    mutationFn: (payload: { ids?: string[]; all?: boolean; status?: StatusFilter; search?: string; filter?: 'ALL' | 'ATTENTION'; docType?: DocFilter }) =>
      api<{ deleted: number }>('/sales-invoices/bulk-delete', { method: 'POST', json: payload }),
    onSuccess: () => { clearSelection(); refresh(); },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Bulk delete failed'),
  });

  const totals = data?.totals;
  const items = data?.items ?? [];
  const pageIds = items.map((i) => i.id);
  const allPageSelected = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  const selectionCount = allMatching ? (data?.total ?? 0) : selected.size;

  const toggleOne = (id: string) => {
    setAllMatching(false);
    setSelected((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  };
  const toggleAllOnPage = () => {
    setAllMatching(false);
    setSelected((prev) => {
      const n = new Set(prev);
      if (pageIds.every((id) => n.has(id))) pageIds.forEach((id) => n.delete(id));
      else pageIds.forEach((id) => n.add(id));
      return n;
    });
  };

  const doBulkDelete = async () => {
    if (!selectionCount) return;
    const ok = await confirm({
      title: 'Delete invoices?',
      message: <>Delete <strong>{selectionCount}</strong> invoice{selectionCount === 1 ? '' : 's'}? Any payments applied to them will be unallocated. This cannot be undone.</>,
      tone: 'danger', confirmLabel: `Delete ${selectionCount}`,
    });
    if (!ok) return;
    if (allMatching) bulkDel.mutate({ all: true, status, search: search || undefined, filter: attention ? 'ATTENTION' : 'ALL', docType });
    else bulkDel.mutate({ ids: [...selected] });
  };

  return (
    <div className="space-y-5">
      <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" onChange={onFile} className="hidden" />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Receipt className="h-5 w-5 text-brand-600" /> Sales Register
        </h1>
        <button onClick={() => fileRef.current?.click()} disabled={uploading} className="btn-primary">
          {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
          Upload Sales Register (Excel)
        </button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card label="Outstanding" value={inr(summary?.outstanding ?? 0)} tone="brand" />
        <Card label="Overdue" value={inr(summary?.overdue ?? 0)} tone={summary && summary.overdue > 0 ? 'danger' : 'muted'} />
        <Card label="Open invoices" value={String(summary?.openCount ?? 0)} tone="muted" />
        <Card
          label="Needs attention" value={String(summary?.attention ?? 0)}
          tone={summary && summary.attention > 0 ? 'warning' : 'muted'}
          onClick={summary && summary.attention > 0 ? () => { setAttention(true); setStatus('ALL'); } : undefined}
        />
      </div>

      {/* Due-invoices drill-down banner (from the "Invoices due today" reminder) */}
      {due && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-amber-100 text-amber-700"><CalendarClock className="h-5 w-5" /></span>
          <div className="text-sm">
            <div className="font-semibold text-amber-900">{due === 'today' ? 'Invoices due today' : 'Due today or overdue'}</div>
            <div className="text-amber-800">
              {(data?.total ?? 0)} invoice{(data?.total ?? 0) === 1 ? '' : 's'} · <span className="font-semibold">{inr(data?.totals.balance ?? 0)}</span> to collect
            </div>
          </div>
          <button onClick={clearDue} className="ml-auto btn-ghost border border-amber-300 text-amber-800 hover:bg-amber-100 text-sm">
            <X className="h-4 w-4" /> Show all invoices
          </button>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px] sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input className="input pl-9" placeholder="Search invoice # or customer…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        {(['ALL', 'UNPAID', 'PARTIAL', 'OVERDUE', 'PAID'] as const).map((s) => (
          <button key={s} onClick={() => setStatus(s)}
            className={cn('rounded-full px-3 py-1 text-xs font-medium border transition',
              status === s ? 'bg-brand-600 text-white border-brand-600' : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50')}>
            {s === 'ALL' ? 'All' : s.charAt(0) + s.slice(1).toLowerCase()}
          </button>
        ))}
        <button onClick={() => setAttention((v) => !v)}
          className={cn('rounded-full px-3 py-1 text-xs font-medium border transition inline-flex items-center gap-1',
            attention ? 'bg-amber-500 text-white border-amber-500' : 'bg-white text-amber-700 border-amber-300 hover:bg-amber-50')}>
          <AlertTriangle className="h-3 w-3" /> Needs attention
        </button>
        <span className="mx-1 hidden h-4 w-px bg-slate-200 sm:inline-block" />
        {(['ALL', 'INVOICE', 'CREDIT_NOTE'] as const).map((d) => (
          <button key={d} onClick={() => setDocType(d)}
            className={cn('rounded-full px-3 py-1 text-xs font-medium border transition',
              docType === d
                ? (d === 'CREDIT_NOTE' ? 'bg-rose-600 text-white border-rose-600' : 'bg-brand-600 text-white border-brand-600')
                : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50')}>
            {d === 'ALL' ? 'All docs' : d === 'INVOICE' ? 'Invoices' : 'Credit notes'}
          </button>
        ))}
      </div>

      {/* Bulk-selection toolbar */}
      {(selected.size > 0 || allMatching) && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-brand-200 bg-brand-50 px-3 py-2 text-sm">
          <span className="font-medium text-brand-800">
            {selectionCount} selected
          </span>
          {allMatching ? (
            <span className="text-xs text-brand-700">All matching invoices across every page.</span>
          ) : allPageSelected && (data?.total ?? 0) > items.length ? (
            <button onClick={() => setAllMatching(true)} className="text-xs font-medium text-brand-700 underline hover:text-brand-900">
              Select all {data?.total} matching
            </button>
          ) : null}
          <div className="ml-auto flex items-center gap-2">
            <button onClick={clearSelection} className="btn-ghost text-slate-600">Clear</button>
            <button onClick={doBulkDelete} disabled={bulkDel.isPending} className="btn-danger">
              {bulkDel.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              Delete {selectionCount}
            </button>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="card overflow-hidden">
        {isLoading ? (
          <div className="py-12 text-center text-slate-400"><Loader2 className="h-5 w-5 animate-spin mx-auto" /></div>
        ) : !data?.items.length ? (
          <div className="py-12 text-center text-sm text-slate-400">
            No invoices{due ? (due === 'today' ? ' are due today.' : ' are due or overdue.') : search || status !== 'ALL' || attention ? ' match this filter.' : ' yet — upload your sales vouchers to begin.'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm whitespace-nowrap">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2.5 w-8">
                    <input
                      type="checkbox"
                      className="h-4 w-4 cursor-pointer rounded border-slate-300 accent-brand-600"
                      checked={allMatching || allPageSelected}
                      ref={(el) => { if (el) el.indeterminate = !allMatching && !allPageSelected && pageIds.some((id) => selected.has(id)); }}
                      onChange={toggleAllOnPage}
                      title="Select all on this page"
                    />
                  </th>
                  <th className="px-3 py-2.5">Invoice #</th>
                  <th className="px-3 py-2.5">Date</th>
                  <th className="px-3 py-2.5">Customer</th>
                  <th className="px-3 py-2.5 text-right">Taxable</th>
                  <th className="px-3 py-2.5 text-right">GST</th>
                  <th className="px-3 py-2.5 text-right">Amount (incl. GST)</th>
                  <th className="px-3 py-2.5 text-right">Balance</th>
                  <th className="px-3 py-2.5">Due</th>
                  <th className="px-3 py-2.5 text-center">Status</th>
                  <th className="px-3 py-2.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((inv) => {
                  const checked = allMatching || selected.has(inv.id);
                  return (
                  <tr key={inv.id} className={cn('border-t border-slate-100 hover:bg-slate-50/60', checked && 'bg-brand-50/40', !checked && inv.needsAttention && 'bg-red-50/40', due && 'border-l-2 border-l-amber-400')}>
                    <td className="px-3 py-2.5">
                      <input
                        type="checkbox"
                        className="h-4 w-4 cursor-pointer rounded border-slate-300 accent-brand-600"
                        checked={checked}
                        onChange={() => toggleOne(inv.id)}
                      />
                    </td>
                    <td className="px-3 py-2.5 font-medium text-slate-900">
                      <span className="inline-flex items-center gap-1.5">
                        {inv.invoiceNumber}
                        {inv.docType === 'CREDIT_NOTE' && (
                          <span className="rounded-full bg-rose-50 px-1.5 py-0.5 text-[10px] font-semibold text-rose-700 ring-1 ring-rose-200">Credit note</span>
                        )}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-slate-600">{fmtDate(inv.invoiceDate)}</td>
                    <td className="px-3 py-2.5">
                      {inv.customerId ? (
                        <span className="text-slate-700">{hideNames ? (inv.customerCode ?? '••••') : inv.customerName}</span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-red-600" title="No matching customer — fix to enable aging & reminders">
                          <AlertTriangle className="h-3.5 w-3.5" /> {hideNames ? '••••' : inv.customerName}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-slate-500">{inv.taxableAmount ? inr(inv.taxableAmount) : '—'}</td>
                    <td
                      className="px-3 py-2.5 text-right tabular-nums text-slate-500"
                      title={inv.gst ? `IGST ${inr(inv.igst)} · CGST ${inr(inv.cgst)} · SGST ${inr(inv.sgst)}${inv.taxType ? `\n${inv.taxType}` : ''}` : undefined}
                    >
                      {inv.gst ? inr(inv.gst) : '—'}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{inr(inv.amount)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums font-medium">{inr(inv.balance)}</td>
                    <td className="px-3 py-2.5">
                      {inv.dueDate ? (
                        <span className={cn(inv.daysOverdue != null && inv.daysOverdue > 0 ? 'text-red-600 font-medium' : 'text-slate-600')}>
                          {fmtDate(inv.dueDate)}
                          {inv.daysOverdue != null && inv.daysOverdue > 0 && <span className="ml-1 text-[10px]">({inv.daysOverdue}d)</span>}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-red-600 text-xs" title="No due date — customer has no credit terms set">
                          <AlertTriangle className="h-3.5 w-3.5" /> no terms
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-medium', STATUS_BADGE[inv.status])}>
                        {inv.status.charAt(0) + inv.status.slice(1).toLowerCase()}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <div className="inline-flex items-center gap-1">
                        <button onClick={() => setFixTarget(inv)} className="btn-ghost text-brand-700 hover:bg-brand-50" title="Assign customer / set due date">
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button
                          onClick={async () => {
                            const ok = await confirm({
                              title: 'Delete invoice?',
                              message: <>Delete <strong>{inv.invoiceNumber}</strong>? Any payments applied to it will be unallocated.</>,
                              tone: 'danger', confirmLabel: 'Delete',
                            });
                            if (ok) del.mutate(inv.id);
                          }}
                          className="btn-ghost text-red-600 hover:bg-red-50" title="Delete invoice">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
              {totals && (
                <tfoot>
                  <tr className="border-t-2 border-slate-300 bg-slate-50 font-semibold">
                    <td className="px-3 py-2.5 text-slate-600" colSpan={6}>Page total ({data.total} invoices)</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{inr(totals.amount)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{inr(totals.balance)}</td>
                    <td colSpan={3} />
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
        <Dialog title="Vouchers imported" tone="ok" onClose={() => setImportResult(null)}>
          <div className="space-y-2 text-sm">
            <Row k="Invoices imported" v={importResult.imported} tone="ok" />
            <Row k="Dates corrected" v={importResult.datesFixed} tone={importResult.datesFixed ? 'ok' : 'muted'} />
            <Row k="Cancelled (skipped)" v={importResult.cancelled} tone="muted" />
            <Row k="Skipped (already present)" v={importResult.skippedDuplicates} tone="muted" />
            <Row k="New customers created" v={importResult.customersCreated} tone={importResult.customersCreated ? 'ok' : 'muted'} />
            <Row k="Customer has no credit terms" v={importResult.missingDueDays} tone={importResult.missingDueDays ? 'warning' : 'muted'} />
            {(importResult.customersCreated > 0 || importResult.missingDueDays > 0) && (
              <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                Missing customers were created automatically. Set their <strong>Credit Terms (Days)</strong> on the Customers page (it syncs due dates to their invoices instantly), or fix each invoice here.
              </p>
            )}
            {importResult.errors.length > 0 && (
              <div className="max-h-40 overflow-y-auto rounded-lg border border-amber-200 bg-amber-50 text-xs">
                {importResult.errors.map((er, i) => (
                  <div key={i} className="border-b border-amber-200/60 px-2 py-1"><span className="font-medium">{er.invoiceNumber}</span> — {er.message}</div>
                ))}
              </div>
            )}
          </div>
        </Dialog>
      )}

      {fixTarget && <FixInvoiceDialog invoice={fixTarget} onClose={() => setFixTarget(null)} onSaved={() => { setFixTarget(null); refresh(); }} />}
      {confirmDialog}
    </div>
  );
};

/* ---------- fix-a-flagged-invoice dialog ---------- */
const FixInvoiceDialog = ({ invoice, onClose, onSaved }: { invoice: Invoice; onClose: () => void; onSaved: () => void }) => {
  const [customerId, setCustomerId] = useState(invoice.customerId ?? '');
  const [dueDate, setDueDate] = useState(invoice.dueDate ? invoice.dueDate.slice(0, 10) : '');
  const [error, setError] = useState<string | null>(null);

  const { data: customers } = useQuery({
    queryKey: ['customers-options'],
    queryFn: () => api<{ items: { id: string; name: string; customerCode: string }[] }>('/customers?pageSize=500'),
  });
  const options = (customers?.items ?? []).map((c) => ({ value: c.id, label: `${c.name} (${c.customerCode})` }));

  const save = useMutation({
    mutationFn: () => api(`/sales-invoices/${invoice.id}`, {
      method: 'PATCH',
      json: { customerId: customerId || null, dueDate: dueDate || null },
    }),
    onSuccess: onSaved,
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Could not save'),
  });

  return (
    <Dialog title={`Fix invoice ${invoice.invoiceNumber}`} tone="ok" onClose={onClose} hideOk>
      <div className="space-y-3">
        <p className="text-xs text-slate-500">Imported as “{invoice.customerName}”. Link a customer (their credit terms set the due date) and/or set the due date directly.</p>
        <label className="block">
          <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-slate-500">Customer</span>
          <SearchableSelect value={customerId} onChange={setCustomerId} options={options} placeholder="Select customer…" />
        </label>
        <label className="block">
          <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-slate-500">Due date (optional — auto-set from credit terms)</span>
          <input type="date" className="input" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </label>
        {error && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}
        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="btn-ghost">Cancel</button>
          <button onClick={() => save.mutate()} disabled={save.isPending} className="btn-primary">
            {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Save
          </button>
        </div>
      </div>
    </Dialog>
  );
};

/* ---------- small presentational bits ---------- */
const Card = ({ label, value, tone, onClick }: {
  label: string; value: string; tone: 'brand' | 'danger' | 'warning' | 'muted'; onClick?: () => void;
}) => {
  const c = tone === 'brand' ? 'border-brand-200 bg-brand-50' : tone === 'danger' ? 'border-red-200 bg-red-50'
    : tone === 'warning' ? 'border-amber-200 bg-amber-50' : 'border-slate-200 bg-white';
  const t = tone === 'brand' ? 'text-brand-700' : tone === 'danger' ? 'text-red-700' : tone === 'warning' ? 'text-amber-700' : 'text-slate-900';
  return (
    <div onClick={onClick} className={cn('rounded-xl border p-3', c, onClick && 'cursor-pointer hover:shadow-sm transition')}>
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

const Dialog = ({ title, tone, children, onClose, hideOk }: {
  title: string; tone: 'ok' | 'danger'; children: React.ReactNode; onClose: () => void; hideOk?: boolean;
}) => (
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
      {!hideOk && <div className="mt-4 flex justify-end"><button onClick={onClose} className="btn-primary">Done</button></div>}
    </div>
  </div>
);
