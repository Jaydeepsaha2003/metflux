// Cashbook Summary — persistent analysis of the imported bank/cash book.
// Toggle between Account-wise and Category-wise grouping, filter by date, and see
// receipts vs payments per group. Also manages the saved "Other" account heads.
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { BarChart3, Loader2, Trash2, Tag, UserPlus, Truck, Download, Copy, Pencil, Save, X, Search, ChevronLeft, ChevronRight } from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { downloadXlsx, todayStamp } from '@/lib/excel';
import { useConfirm } from '@/hooks/useConfirm';
import { useAuthStore, activeMembership } from '@/store/auth';

type SumItem = { key: string; category: string; type: string; receipts: number; payments: number; net: number; count: number };
type Summary = { groupBy: string; items: SumItem[]; totals: { receipts: number; payments: number; net: number; count: number } };
type Head = { id: string; name: string; type: string; category: string | null };
type UnItem = { normKey: string; name: string; receiptTotal: number; paymentTotal: number; unpostedReceipt: number; unpostedPayment: number; count: number };
type Overview = { sales: number; purchase: number; receipts: number; payments: number; creditNote: number; debitNote: number; net: number };
type DupItem = { account: string; side: string; date: string; amount: number; count: number; extra: number };

const inr = (n: number | undefined) =>
  '₹' + Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

const TYPE_TONE: Record<string, string> = {
  CUSTOMER: 'bg-emerald-50 text-emerald-700',
  SUPPLIER: 'bg-brand-50 text-brand-700',
  OTHER: 'bg-slate-100 text-slate-600',
  UNCLASSIFIED: 'bg-amber-50 text-amber-700',
};

export const CashbookSummaryPage = () => {
  const qc = useQueryClient();
  const [tab, setTab] = useState<'overview' | 'transactions'>('overview');
  const [groupBy, setGroupBy] = useState<'category' | 'account'>('category');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [sort, setSort] = useState<{ key: 'key' | 'receipts' | 'payments' | 'net' | 'count'; dir: 'asc' | 'desc' }>({ key: 'net', dir: 'desc' });
  const sortBy = (key: typeof sort.key) => setSort((s) => ({ key, dir: s.key === key && s.dir === 'desc' ? 'asc' : 'desc' }));

  const qs = new URLSearchParams({ groupBy });
  if (from) qs.set('from', from);
  if (to) qs.set('to', to);

  const { data, isLoading, error } = useQuery({
    queryKey: ['cashbook-summary', groupBy, from, to],
    queryFn: () => api<Summary>(`/cashbook/summary?${qs.toString()}`),
  });
  const { data: headsData } = useQuery({
    queryKey: ['account-heads'],
    queryFn: () => api<{ heads: Head[]; categories: string[] }>('/cashbook/account-heads'),
  });
  const { data: overview } = useQuery({
    queryKey: ['cashbook-overview', from, to],
    queryFn: () => { const q = new URLSearchParams(); if (from) q.set('from', from); if (to) q.set('to', to); return api<Overview>(`/cashbook/overview?${q.toString()}`); },
  });

  const delHead = useMutation({
    mutationFn: (id: string) => api(`/cashbook/account-heads/${id}`, { method: 'DELETE' }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['account-heads'] }); qc.invalidateQueries({ queryKey: ['cashbook-summary'] }); },
  });

  const items = [...(data?.items ?? [])].sort((a, b) => {
    const d = sort.dir === 'asc' ? 1 : -1;
    if (sort.key === 'key') return a.key.localeCompare(b.key) * d;
    return ((a[sort.key] as number) - (b[sort.key] as number)) * d;
  });
  const otherHeads = (headsData?.heads ?? []).filter((h) => h.type === 'OTHER');
  const sortIcon = (k: typeof sort.key) => (sort.key === k ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : '');

  const exportExcel = () => {
    if (!items.length && !overview) return;
    const rows: Record<string, string | number>[] = [];
    if (overview) {
      rows.push({ 'Group': 'Sales', 'Category': 'Overview', 'Receipts': '', 'Payments': '', 'Net': overview.sales });
      rows.push({ 'Group': 'Purchase', 'Category': 'Overview', 'Receipts': '', 'Payments': '', 'Net': overview.purchase });
      rows.push({ 'Group': 'Credit Note', 'Category': 'Overview', 'Receipts': '', 'Payments': '', 'Net': overview.creditNote });
      rows.push({ 'Group': 'Debit Note', 'Category': 'Overview', 'Receipts': '', 'Payments': '', 'Net': overview.debitNote });
      rows.push({ 'Group': 'Receipts', 'Category': 'Overview', 'Receipts': overview.receipts, 'Payments': '', 'Net': '' });
      rows.push({ 'Group': 'Payments', 'Category': 'Overview', 'Receipts': '', 'Payments': overview.payments, 'Net': '' });
      rows.push({ 'Group': 'Net (Receipts − Payments)', 'Category': 'Overview', 'Receipts': '', 'Payments': '', 'Net': overview.net });
      rows.push({ 'Group': '', 'Category': '', 'Receipts': '', 'Payments': '', 'Net': '' });
    }
    items.forEach((it) => rows.push({
      'Group': it.key, 'Category': it.category, 'Receipts': it.receipts, 'Payments': it.payments, 'Net': it.net,
    }));
    downloadXlsx(`cashbook-summary-${todayStamp()}`, 'Cashbook Summary', rows);
  };

  return (
    <div className="space-y-5 max-w-full">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight">
            <BarChart3 className="h-5 w-5 text-brand-600" /> Cashbook Summary
          </h1>
          <p className="mt-1 text-sm text-slate-500">Receipts vs payments from your imported bank/cash book, grouped by category or account.</p>
        </div>
        {tab === 'overview' && (
          <button onClick={exportExcel} className="btn-ghost border border-slate-300 text-emerald-700 hover:bg-emerald-50 text-sm shrink-0">
            <Download className="h-4 w-4" /> Export Excel
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5">
        {(['overview', 'transactions'] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={cn('rounded-md px-4 py-1.5 text-sm font-medium transition',
              tab === t ? 'bg-brand-600 text-white shadow-sm' : 'text-slate-600 hover:text-slate-900')}>
            {t === 'overview' ? 'Overview' : 'Transactions'}
          </button>
        ))}
      </div>

      {tab === 'transactions' && <TransactionsView />}

      {tab === 'overview' && <>
      {/* Overview — Sales / Purchase / Receipts / Payments / notes / Net */}
      {overview && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
          <Stat label="Sales" value={inr(overview.sales)} />
          <Stat label="Purchase" value={inr(overview.purchase)} />
          <Stat label="Receipts" value={inr(overview.receipts)} tone="emerald" />
          <Stat label="Payments" value={inr(overview.payments)} tone="brand" />
          <Stat label="Credit Note" value={inr(overview.creditNote)} />
          <Stat label="Debit Note" value={inr(overview.debitNote)} />
          <Stat label="Net (R − P)" value={inr(overview.net)} tone={overview.net >= 0 ? 'emerald' : 'red'} />
        </div>
      )}

      {/* Controls */}
      <div className="card flex flex-col gap-3 p-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-wrap items-end gap-3">
          <label className="block">
            <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-slate-500">From</span>
            <input type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-slate-500">To</span>
            <input type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
        </div>
        <div className="inline-flex self-start rounded-lg border border-slate-200 bg-slate-50 p-0.5 sm:self-end">
          {(['category', 'account'] as const).map((g) => (
            <button key={g} onClick={() => setGroupBy(g)}
              className={cn('rounded-md px-3.5 py-1.5 text-sm font-medium transition',
                groupBy === g ? 'bg-brand-600 text-white shadow-sm' : 'text-slate-600 hover:text-slate-900')}>
              {g === 'category' ? 'Category-wise' : 'Account-wise'}
            </button>
          ))}
        </div>
      </div>

      {/* Totals */}
      {data && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Total receipts" value={inr(data.totals.receipts)} tone="emerald" />
          <Stat label="Total payments" value={inr(data.totals.payments)} tone="brand" />
          <Stat label="Net" value={inr(data.totals.net)} tone={data.totals.net >= 0 ? 'emerald' : 'red'} />
          <Stat label="Entries" value={String(data.totals.count)} />
        </div>
      )}

      {/* Unclassified heads → classify + auto-adjust */}
      <UnclassifiedSection />

      {/* Duplicate check + remove */}
      <DuplicatesSection />

      {/* Summary table */}
      <div className="card overflow-hidden">
        {isLoading ? (
          <div className="py-12 text-center text-slate-400"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></div>
        ) : error ? (
          <div className="py-12 text-center text-sm text-red-600">Could not load the summary.</div>
        ) : !items.length ? (
          <div className="py-12 text-center text-sm text-slate-400">No cashbook data yet. Import the bank book from Receipts &amp; Payments.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm whitespace-nowrap">
              <thead><tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
                <th className="cursor-pointer select-none px-4 py-3 text-left hover:text-slate-700" onClick={() => sortBy('key')}>{groupBy === 'account' ? 'Account' : 'Category'}{sortIcon('key')}</th>
                {groupBy === 'account' && <th className="px-4 py-3 text-left">Category</th>}
                <th className="cursor-pointer select-none px-4 py-3 text-right hover:text-slate-700" onClick={() => sortBy('receipts')}>Receipts{sortIcon('receipts')}</th>
                <th className="cursor-pointer select-none px-4 py-3 text-right hover:text-slate-700" onClick={() => sortBy('payments')}>Payments{sortIcon('payments')}</th>
                <th className="cursor-pointer select-none px-4 py-3 text-right hover:text-slate-700" onClick={() => sortBy('net')}>Net{sortIcon('net')}</th>
                <th className="cursor-pointer select-none px-4 py-3 text-right hover:text-slate-700" onClick={() => sortBy('count')}>Entries{sortIcon('count')}</th>
              </tr></thead>
              <tbody className="divide-y divide-slate-100">
                {items.map((it) => (
                  <tr key={it.key} className="hover:bg-slate-50/60">
                    <td className="px-4 py-2.5 font-medium">
                      {it.key}
                      {groupBy === 'category' && (
                        <span className={cn('ml-2 rounded-full px-2 py-0.5 text-[10px] font-medium', TYPE_TONE[it.type] ?? 'bg-slate-100 text-slate-600')}>
                          {it.type.charAt(0) + it.type.slice(1).toLowerCase()}
                        </span>
                      )}
                    </td>
                    {groupBy === 'account' && <td className="px-4 py-2.5 text-slate-500">{it.category}</td>}
                    <td className="px-4 py-2.5 text-right tabular-nums text-emerald-700">{it.receipts ? inr(it.receipts) : '—'}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-slate-700">{it.payments ? inr(it.payments) : '—'}</td>
                    <td className={cn('px-4 py-2.5 text-right tabular-nums font-semibold', it.net >= 0 ? 'text-emerald-700' : 'text-red-600')}>{inr(it.net)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-slate-500">{it.count}</td>
                  </tr>
                ))}
              </tbody>
              {data && (
                <tfoot>
                  <tr className="border-t-2 border-slate-200 bg-slate-50 font-semibold">
                    <td className="px-4 py-2.5" colSpan={groupBy === 'account' ? 2 : 1}>Total</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-emerald-700">{inr(data.totals.receipts)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-slate-700">{inr(data.totals.payments)}</td>
                    <td className={cn('px-4 py-2.5 text-right tabular-nums', data.totals.net >= 0 ? 'text-emerald-700' : 'text-red-600')}>{inr(data.totals.net)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-slate-500">{data.totals.count}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )}
      </div>

      {/* Saved "Other" account heads */}
      {otherHeads.length > 0 && (
        <div className="card overflow-hidden">
          <div className="flex items-center gap-2 border-b border-slate-200 bg-slate-50 px-4 py-2.5 text-sm font-semibold text-slate-700">
            <Tag className="h-4 w-4" /> Saved account heads (Other) <span className="font-normal text-slate-400">({otherHeads.length})</span>
          </div>
          <div className="divide-y divide-slate-100">
            {otherHeads.map((h) => (
              <HeadRow key={h.id} head={h} onDelete={() => delHead.mutate(h.id)} deleting={delHead.isPending} />
            ))}
          </div>
        </div>
      )}
      </>}
    </div>
  );
};

/* ── Transactions — unified Sales / Purchase / notes / Receipts / Payments feed ── */
type Txn = { date: string | null; type: string; party: string; ref: string | null; amount: number };
const TXN_TYPES: { key: string; label: string; tone: string }[] = [
  { key: 'SALE', label: 'Sales', tone: 'bg-emerald-50 text-emerald-700' },
  { key: 'PURCHASE', label: 'Purchase', tone: 'bg-brand-50 text-brand-700' },
  { key: 'CREDIT_NOTE', label: 'Credit Note', tone: 'bg-rose-50 text-rose-700' },
  { key: 'DEBIT_NOTE', label: 'Debit Note', tone: 'bg-amber-50 text-amber-700' },
  { key: 'RECEIPT', label: 'Receipts', tone: 'bg-emerald-50 text-emerald-700' },
  { key: 'PAYMENT', label: 'Payments', tone: 'bg-slate-100 text-slate-600' },
];
const TXN_LABEL: Record<string, string> = Object.fromEntries(TXN_TYPES.map((t) => [t.key, t.label]));
const TXN_TONE: Record<string, string> = Object.fromEntries(TXN_TYPES.map((t) => [t.key, t.tone]));

const TransactionsView = () => {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [search, setSearch] = useState('');
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [sort, setSort] = useState<{ key: 'date' | 'type' | 'party' | 'amount'; dir: 'asc' | 'desc' }>({ key: 'date', dir: 'desc' });
  const [page, setPage] = useState(1);
  const pageSize = 50;

  const qs = new URLSearchParams();
  if (from) qs.set('from', from);
  if (to) qs.set('to', to);
  if (search.trim()) qs.set('search', search.trim());
  if (sel.size) qs.set('types', [...sel].join(','));

  const { data, isLoading } = useQuery({
    queryKey: ['cashbook-transactions', from, to, search, [...sel].sort().join(','), page],
    queryFn: () => api<{ items: Txn[]; total: number; capped: boolean }>(`/cashbook/transactions?${qs.toString()}`),
  });

  const toggle = (k: string) => { setSel((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; }); setPage(1); };
  const sortBy = (key: typeof sort.key) => { setSort((s) => ({ key, dir: s.key === key && s.dir === 'desc' ? 'asc' : 'desc' })); setPage(1); };
  const icon = (k: typeof sort.key) => (sort.key === k ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : '');
  const t = (v: string | null) => (v ? new Date(v).getTime() : 0);

  const all = [...(data?.items ?? [])].sort((a, b) => {
    const d = sort.dir === 'asc' ? 1 : -1;
    if (sort.key === 'date') return (t(a.date) - t(b.date)) * d;
    if (sort.key === 'amount') return (a.amount - b.amount) * d;
    return String(a[sort.key] ?? '').localeCompare(String(b[sort.key] ?? '')) * d;
  });
  const total = all.length;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const rows = all.slice((page - 1) * pageSize, page * pageSize);
  const sum = all.reduce((s, r) => s + r.amount, 0);

  const exportExcel = () => {
    if (!all.length) return;
    downloadXlsx(`cashbook-transactions-${todayStamp()}`, 'Transactions', all.map((r) => ({
      Date: r.date ? new Date(r.date).toLocaleDateString('en-GB') : '', Type: TXN_LABEL[r.type] ?? r.type,
      Party: r.party, Ref: r.ref ?? '', Amount: r.amount,
    })));
  };

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="card space-y-3 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="block"><span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-slate-500">From</span>
            <input type="date" className="input" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} /></label>
          <label className="block"><span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-slate-500">To</span>
            <input type="date" className="input" value={to} onChange={(e) => { setTo(e.target.value); setPage(1); }} /></label>
          <label className="block flex-1 min-w-[180px]"><span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-slate-500">Search party</span>
            <div className="relative"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input className="input pl-9" placeholder="Party name…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} /></div></label>
          <button onClick={exportExcel} disabled={!all.length} className="btn-ghost h-10 border border-slate-300 text-emerald-700 hover:bg-emerald-50 text-sm disabled:opacity-50"><Download className="h-4 w-4" /> Excel</button>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Types:</span>
          {TXN_TYPES.map((tt) => {
            const on = sel.has(tt.key);
            return (
              <button key={tt.key} onClick={() => toggle(tt.key)}
                className={cn('rounded-full px-2.5 py-1 text-xs font-medium ring-1 transition', on ? `${tt.tone} ring-transparent` : 'bg-white text-slate-500 ring-slate-200 hover:bg-slate-50')}>
                {tt.label}
              </button>
            );
          })}
          {sel.size > 0 && <button onClick={() => { setSel(new Set()); setPage(1); }} className="text-xs text-slate-400 underline">clear</button>}
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-4 py-2.5 text-sm">
          <span className="font-semibold text-slate-700">{total} transaction{total === 1 ? '' : 's'}{data?.capped ? ' (first 8000)' : ''}</span>
          <span className="tabular-nums text-slate-500">Total: <b className="text-slate-800">{inr(sum)}</b></span>
        </div>
        {isLoading ? (
          <div className="py-12 text-center text-slate-400"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></div>
        ) : !rows.length ? (
          <div className="py-12 text-center text-sm text-slate-400">No transactions for these filters.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm whitespace-nowrap">
              <thead><tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
                <th className="cursor-pointer select-none px-4 py-3 text-left hover:text-slate-700" onClick={() => sortBy('date')}>Date{icon('date')}</th>
                <th className="cursor-pointer select-none px-4 py-3 text-left hover:text-slate-700" onClick={() => sortBy('type')}>Type{icon('type')}</th>
                <th className="cursor-pointer select-none px-4 py-3 text-left hover:text-slate-700" onClick={() => sortBy('party')}>Party{icon('party')}</th>
                <th className="px-4 py-3 text-left">Ref</th>
                <th className="cursor-pointer select-none px-4 py-3 text-right hover:text-slate-700" onClick={() => sortBy('amount')}>Amount{icon('amount')}</th>
              </tr></thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((r, i) => (
                  <tr key={i} className="hover:bg-slate-50/60">
                    <td className="px-4 py-2 text-slate-600">{r.date ? new Date(r.date).toLocaleDateString('en-GB') : '—'}</td>
                    <td className="px-4 py-2"><span className={cn('rounded-full px-2 py-0.5 text-[10px] font-medium', TXN_TONE[r.type] ?? 'bg-slate-100 text-slate-600')}>{TXN_LABEL[r.type] ?? r.type}</span></td>
                    <td className="px-4 py-2 font-medium">{r.party}</td>
                    <td className="px-4 py-2 font-mono text-xs text-slate-500">{r.ref || '—'}</td>
                    <td className="px-4 py-2 text-right tabular-nums font-semibold">{inr(r.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-4 py-2.5 text-xs">
          <span className="text-slate-500">Page {page} / {pages}</span>
          <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="btn-ghost h-8 border border-slate-300 px-2 disabled:opacity-40"><ChevronLeft className="h-4 w-4" /></button>
          <button disabled={page >= pages} onClick={() => setPage((p) => p + 1)} className="btn-ghost h-8 border border-slate-300 px-2 disabled:opacity-40"><ChevronRight className="h-4 w-4" /></button>
        </div>
      </div>
    </div>
  );
};

/* Unclassified account heads from the stored cashbook. Tagging Customer/Supplier
   creates the record then allocates that head's unposted receipts/payments FIFO. */
const UnclassifiedSection = () => {
  const qc = useQueryClient();
  const companyId = useAuthStore(activeMembership)?.companyId ?? '';
  const [busy, setBusy] = useState<string | null>(null);
  const [otherFor, setOtherFor] = useState<string | null>(null);
  const [cat, setCat] = useState('');
  const [note, setNote] = useState<string | null>(null);

  const { data } = useQuery({
    queryKey: ['cashbook-unclassified'],
    queryFn: () => api<{ items: UnItem[] }>('/cashbook/unclassified'),
  });
  const items = data?.items ?? [];

  const refresh = () => {
    ['cashbook-unclassified', 'cashbook-summary', 'account-heads', 'customers', 'suppliers'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  };
  const run = async (name: string, fn: () => Promise<void>) => {
    setBusy(name); setNote(null);
    try { await fn(); setOtherFor(null); setCat(''); refresh(); }
    catch (e) { setNote(e instanceof Error ? e.message : 'Failed'); }
    finally { setBusy(null); }
  };
  const adjust = (name: string) =>
    api<{ type: string; allocated: number; posted: number }>('/cashbook/adjust', { method: 'POST', body: JSON.stringify({ name }) });
  const asCustomer = (name: string) => run(name, async () => {
    await api('/customers', { method: 'POST', body: JSON.stringify({ name }) });
    const r = await adjust(name);
    setNote(`${name}: created customer, allocated ₹${Math.round(r.allocated).toLocaleString('en-IN')} across ${r.posted} entr${r.posted === 1 ? 'y' : 'ies'}.`);
  });
  const asSupplier = (name: string) => run(name, async () => {
    await api('/suppliers', { method: 'POST', body: JSON.stringify({ name, companyIds: [companyId] }) });
    const r = await adjust(name);
    setNote(`${name}: created supplier, allocated ₹${Math.round(r.allocated).toLocaleString('en-IN')} across ${r.posted} entr${r.posted === 1 ? 'y' : 'ies'}.`);
  });
  const asOther = (name: string) => run(name, async () => {
    await api('/cashbook/account-heads', { method: 'POST', body: JSON.stringify({ name, category: cat.trim() }) });
  });

  if (!items.length) return null;

  return (
    <div className="card overflow-hidden">
      <div className="flex items-center gap-2 border-b border-slate-200 bg-amber-50/60 px-4 py-2.5 text-sm font-semibold text-amber-800">
        <Tag className="h-4 w-4" /> Unclassified heads ({items.length})
      </div>
      <div className="px-4 py-2 text-xs text-slate-500">
        Tag a head to recognise it. <b>Customer</b>/<b>Supplier</b> create the record and immediately settle its unposted receipts/payments against invoices (FIFO); <b>Other</b> just categorises it.
      </div>
      {note && <div className="mx-4 mb-2 rounded border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs text-emerald-700">{note}</div>}
      <div className="overflow-x-auto">
        <table className="w-full text-sm whitespace-nowrap">
          <thead><tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
            <th className="px-4 py-2.5 text-left">Party</th>
            <th className="px-4 py-2.5 text-right">Receipts</th>
            <th className="px-4 py-2.5 text-right">Payments</th>
            <th className="px-4 py-2.5 text-right">Unposted</th>
            <th className="px-4 py-2.5 text-left">Classify as</th>
          </tr></thead>
          <tbody className="divide-y divide-slate-100">
            {items.map((u) => {
              const isBusy = busy === u.name;
              return (
                <tr key={u.normKey}>
                  <td className="px-4 py-2 font-medium">{u.name}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-slate-600">{u.receiptTotal ? inr(u.receiptTotal) : '—'}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-slate-600">{u.paymentTotal ? inr(u.paymentTotal) : '—'}</td>
                  <td className="px-4 py-2 text-right tabular-nums font-semibold">{inr(u.unpostedReceipt + u.unpostedPayment)}</td>
                  <td className="px-4 py-2">
                    {otherFor === u.name ? (
                      <div className="flex items-center gap-1.5">
                        <input autoFocus className="input h-8 w-40" placeholder="Category e.g. Salary" value={cat}
                          onChange={(e) => setCat(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter' && cat.trim() && !isBusy) { e.preventDefault(); asOther(u.name); } }} />
                        <button disabled={isBusy || !cat.trim()} onClick={() => asOther(u.name)} className="btn-primary h-8 px-2 text-xs">{isBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Save'}</button>
                        <button onClick={() => { setOtherFor(null); setCat(''); }} className="btn-ghost h-8 px-2 text-xs text-slate-500">Cancel</button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5">
                        <button disabled={isBusy} onClick={() => asCustomer(u.name)} className="btn-ghost h-8 border border-slate-300 px-2 text-xs text-emerald-700 hover:bg-emerald-50"><UserPlus className="h-3.5 w-3.5" /> Customer</button>
                        <button disabled={isBusy} onClick={() => asSupplier(u.name)} className="btn-ghost h-8 border border-slate-300 px-2 text-xs text-brand-700 hover:bg-brand-50"><Truck className="h-3.5 w-3.5" /> Supplier</button>
                        <button disabled={isBusy} onClick={() => { setOtherFor(u.name); setCat(''); }} className="btn-ghost h-8 border border-slate-300 px-2 text-xs text-slate-600 hover:bg-slate-50"><Tag className="h-3.5 w-3.5" /> Other</button>
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

/* A saved "Other" account head — inline category edit + delete. */
const HeadRow = ({ head, onDelete, deleting }: { head: Head; onDelete: () => void; deleting: boolean }) => {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [cat, setCat] = useState(head.category ?? '');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!cat.trim()) return;
    setBusy(true);
    try {
      await api('/cashbook/account-heads', { method: 'POST', body: JSON.stringify({ name: head.name, category: cat.trim() }) });
      qc.invalidateQueries({ queryKey: ['account-heads'] });
      qc.invalidateQueries({ queryKey: ['cashbook-summary'] });
      setEditing(false);
    } finally { setBusy(false); }
  };
  return (
    <div className="flex items-center justify-between px-4 py-2 text-sm">
      <div className="flex items-center gap-2">
        <span className="font-medium">{head.name}</span>
        {editing ? (
          <input autoFocus className="input h-8 w-40" value={cat} onChange={(e) => setCat(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); save(); } }} />
        ) : (
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600">{head.category}</span>
        )}
      </div>
      <div className="flex items-center gap-1">
        {editing ? (
          <>
            <button onClick={save} disabled={busy || !cat.trim()} className="btn-ghost text-brand-700 hover:bg-brand-50" title="Save">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            </button>
            <button onClick={() => { setEditing(false); setCat(head.category ?? ''); }} className="btn-ghost text-slate-500 hover:bg-slate-100" title="Cancel"><X className="h-4 w-4" /></button>
          </>
        ) : (
          <>
            <button onClick={() => setEditing(true)} className="btn-ghost text-brand-700 hover:bg-brand-50" title="Edit category"><Pencil className="h-4 w-4" /></button>
            <button onClick={onDelete} disabled={deleting} className="btn-ghost text-red-600 hover:bg-red-50" title="Remove (it'll become unclassified again)"><Trash2 className="h-4 w-4" /></button>
          </>
        )}
      </div>
    </div>
  );
};

/* Duplicate detector — same party + side + date + amount appearing more than once. */
const DuplicatesSection = () => {
  const qc = useQueryClient();
  const { confirm, confirmDialog } = useConfirm();
  const { data, isLoading } = useQuery({
    queryKey: ['cashbook-duplicates'],
    queryFn: () => api<{ items: DupItem[]; groups: number; totalExtra: number }>('/cashbook/duplicates'),
  });
  const dedupe = useMutation({
    mutationFn: () => api<{ removed: number }>('/cashbook/dedupe', { method: 'POST' }),
    onSuccess: () => {
      ['cashbook-duplicates', 'cashbook-summary', 'cashbook-overview', 'cashbook-entries'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
    },
  });
  const items = data?.items ?? [];

  const onRemove = async () => {
    const ok = await confirm({
      title: 'Remove duplicate entries?',
      message: <>This deletes <strong>{data?.totalExtra ?? 0}</strong> duplicate row{(data?.totalExtra ?? 0) === 1 ? '' : 's'} (same party, side, date &amp; amount), keeping one of each. This can't be undone.</>,
      confirmLabel: 'Remove duplicates', tone: 'danger',
    });
    if (ok) dedupe.mutate();
  };

  if (isLoading) return null;
  if (!items.length) return null;

  return (
    <div className="card overflow-hidden">
      <div className="flex flex-col gap-2 border-b border-amber-200 bg-amber-50/60 px-4 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2 text-sm font-semibold text-amber-800">
          <Copy className="h-4 w-4" /> Possible duplicates ({data?.groups}) · {data?.totalExtra} extra row{(data?.totalExtra ?? 0) === 1 ? '' : 's'}
        </div>
        <button onClick={onRemove} disabled={dedupe.isPending} className="btn-primary h-8 text-xs">
          {dedupe.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />} Remove duplicates
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm whitespace-nowrap">
          <thead><tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
            <th className="px-4 py-2.5 text-left">Party</th><th className="px-4 py-2.5 text-left">Side</th>
            <th className="px-4 py-2.5 text-left">Date</th><th className="px-4 py-2.5 text-right">Amount</th><th className="px-4 py-2.5 text-right">Copies</th>
          </tr></thead>
          <tbody className="divide-y divide-slate-100">
            {items.slice(0, 100).map((d, i) => (
              <tr key={i}>
                <td className="px-4 py-2 font-medium">{d.account}</td>
                <td className="px-4 py-2 text-slate-500">{d.side === 'RECEIPT' ? 'Receipt' : 'Payment'}</td>
                <td className="px-4 py-2 text-slate-600">{d.date ? new Date(d.date).toLocaleDateString('en-GB') : '—'}</td>
                <td className="px-4 py-2 text-right tabular-nums">{inr(d.amount)}</td>
                <td className="px-4 py-2 text-right tabular-nums font-semibold text-amber-700">{d.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {confirmDialog}
    </div>
  );
};

const Stat = ({ label, value, tone }: { label: string; value: string; tone?: 'emerald' | 'brand' | 'red' }) => (
  <div className="card p-3">
    <div className="text-[11px] uppercase tracking-wide text-slate-500">{label}</div>
    <div className={cn('mt-0.5 text-xl font-bold tabular-nums',
      tone === 'emerald' && 'text-emerald-600',
      tone === 'brand' && 'text-brand-700',
      tone === 'red' && 'text-red-600',
    )}>{value}</div>
  </div>
);
