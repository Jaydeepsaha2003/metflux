// Cashbook Summary — persistent analysis of the imported bank/cash book.
// Toggle between Account-wise and Category-wise grouping, filter by date, and see
// receipts vs payments per group. Also manages the saved "Other" account heads.
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { BarChart3, Loader2, Trash2, Tag } from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';

type SumItem = { key: string; category: string; type: string; receipts: number; payments: number; net: number; count: number };
type Summary = { groupBy: string; items: SumItem[]; totals: { receipts: number; payments: number; net: number; count: number } };
type Head = { id: string; name: string; type: string; category: string | null };

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
  const [groupBy, setGroupBy] = useState<'category' | 'account'>('category');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

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

  const delHead = useMutation({
    mutationFn: (id: string) => api(`/cashbook/account-heads/${id}`, { method: 'DELETE' }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['account-heads'] }); qc.invalidateQueries({ queryKey: ['cashbook-summary'] }); },
  });

  const items = data?.items ?? [];
  const otherHeads = (headsData?.heads ?? []).filter((h) => h.type === 'OTHER');

  return (
    <div className="space-y-5 max-w-full">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight">
          <BarChart3 className="h-5 w-5 text-brand-600" /> Cashbook Summary
        </h1>
        <p className="mt-1 text-sm text-slate-500">Receipts vs payments from your imported bank/cash book, grouped by category or account.</p>
      </div>

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
                <th className="px-4 py-3 text-left">{groupBy === 'account' ? 'Account' : 'Category'}</th>
                {groupBy === 'account' && <th className="px-4 py-3 text-left">Category</th>}
                <th className="px-4 py-3 text-right">Receipts</th>
                <th className="px-4 py-3 text-right">Payments</th>
                <th className="px-4 py-3 text-right">Net</th>
                <th className="px-4 py-3 text-right">Entries</th>
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
              <div key={h.id} className="flex items-center justify-between px-4 py-2 text-sm">
                <div><span className="font-medium">{h.name}</span> <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600">{h.category}</span></div>
                <button onClick={() => delHead.mutate(h.id)} disabled={delHead.isPending} className="btn-ghost text-red-600 hover:bg-red-50" title="Remove (it'll become unclassified again)">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
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
