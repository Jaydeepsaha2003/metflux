// "Not a customer" cleanup — removes Customer records that were mis-tagged
// (salary heads, suppliers) during a bank-book import and are therefore showing
// on Amount Receivable as "Advance / On account".
//
// Those rows are computed, not stored, so deleting the Customer record is what
// actually clears them. Records referenced anywhere else are listed but never
// offered for deletion.
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Loader2, Trash2, UserX, X, CheckCircle2 } from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { Th, num } from '@/components/tally';

type Row = {
  id: string; name: string; customerCode: string | null;
  showsOnAging: number; receiptTotal: number; paymentTotal: number;
  reason: string; blockers: string[];
};
type Resp = { items: Row[]; blocked: Row[]; totalOnAging: number };

export const NonCustomerCleanup = ({ open, onClose }: { open: boolean; onClose: () => void }) => {
  const qc = useQueryClient();
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [done, setDone] = useState<{ deleted: number; skipped: { name: string | null; reason: string }[] } | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['non-customers'],
    queryFn: () => api<Resp>('/customer-cleanup/non-customers'),
    enabled: open,
  });

  // Pre-tick everything on open — the common case is "all of these are wrong".
  useEffect(() => {
    if (open && data) setSel(new Set(data.items.map((r) => r.id)));
    if (!open) { setSel(new Set()); setDone(null); }
  }, [open, data]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const remove = useMutation({
    mutationFn: () => api<{ deleted: number; skipped: { name: string | null; reason: string }[] }>(
      '/customer-cleanup/non-customers/delete', { method: 'POST', json: { ids: [...sel] } }),
    onSuccess: (r) => {
      setDone(r);
      ['debtor-aging', 'creditor-aging', 'customers', 'party-ledger', 'non-customers', 'cashbook-summary']
        .forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
    },
  });

  if (!open) return null;
  const items = data?.items ?? [];
  const blocked = data?.blocked ?? [];
  const selectedTotal = items.filter((r) => sel.has(r.id)).reduce((s, r) => s + r.showsOnAging, 0);
  const allTicked = items.length > 0 && items.every((r) => sel.has(r.id));
  const toggle = (id: string) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleAll = () => setSel(allTicked ? new Set() : new Set(items.map((r) => r.id)));

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 p-4 sm:items-center" onClick={onClose}>
      <div className="w-full max-w-3xl overflow-hidden rounded-lg border border-slate-300 bg-white shadow-2xl animate-fade-up"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b-2 border-brand-700 bg-brand-600 px-4 py-2 text-white">
          <span className="flex items-center gap-2 text-sm font-bold tracking-wide">
            <UserX className="h-4 w-4" /> Clean up non-customers
          </span>
          <button onClick={onClose} className="rounded p-0.5 hover:bg-white/20"><X className="h-4 w-4" /></button>
        </div>

        <p className="border-b border-slate-200 bg-slate-50 px-4 py-2 text-[11px] leading-relaxed text-slate-600">
          These are registered as <b>customers</b> but have <b>no sales invoices</b>. A bank payment to them therefore shows on
          Amount Receivable as <b>“Advance / On account”</b>. Removing the customer record clears those rows.
          Bank book, Party Ledger and Amount Payable are <b>not</b> touched, and a real customer is re-created automatically
          the next time you import an invoice for them.
        </p>

        {done ? (
          <div className="p-5 text-center">
            <CheckCircle2 className="mx-auto h-8 w-8 text-emerald-600" />
            <p className="mt-2 text-sm font-semibold text-slate-800">
              Removed {done.deleted} record{done.deleted === 1 ? '' : 's'}.
            </p>
            {done.skipped.length > 0 && (
              <ul className="mx-auto mt-2 max-w-md list-disc space-y-0.5 pl-5 text-left text-[11px] text-amber-700">
                {done.skipped.map((s, i) => <li key={i}><b>{s.name ?? '—'}</b>: {s.reason}</li>)}
              </ul>
            )}
            <p className="mt-2 text-[11px] text-slate-500">Amount Receivable has been refreshed.</p>
            <button onClick={onClose} className="mt-3 rounded bg-brand-600 px-4 py-1.5 text-xs font-bold uppercase tracking-wide text-white hover:bg-brand-700">Close</button>
          </div>
        ) : isLoading ? (
          <div className="py-12 text-center text-slate-400"><Loader2 className="mx-auto h-6 w-6 animate-spin" /></div>
        ) : items.length === 0 && blocked.length === 0 ? (
          <div className="py-12 text-center text-sm text-slate-500">
            <CheckCircle2 className="mx-auto mb-2 h-7 w-7 text-emerald-500" />
            Nothing to clean up — every customer here has sales invoices.
          </div>
        ) : (
          <>
            {items.length > 0 && (
              <div className="max-h-[45vh] overflow-auto">
                <table className="w-full border-collapse text-xs whitespace-nowrap">
                  <thead className="sticky top-0 z-10"><tr>
                    <Th align="center" className="w-8">
                      <input type="checkbox" checked={allTicked} onChange={toggleAll}
                        className="rounded border-slate-300 text-brand-600 focus:ring-brand-500" title="Select all" />
                    </Th>
                    <Th>Party</Th>
                    <Th>Why it's flagged</Th>
                    <Th align="right" className="w-36 border-l border-slate-300">Shows on Receivable</Th>
                  </tr></thead>
                  <tbody>
                    {items.map((r) => (
                      <tr key={r.id} className={cn('border-b border-slate-100 hover:bg-brand-50/40', sel.has(r.id) && 'bg-brand-50/50')}>
                        <td className="px-2 py-1 text-center">
                          <input type="checkbox" checked={sel.has(r.id)} onChange={() => toggle(r.id)}
                            className="rounded border-slate-300 text-brand-600 focus:ring-brand-500" />
                        </td>
                        <td className="max-w-[260px] truncate px-2 py-1 font-medium text-slate-800" title={r.name}>
                          {r.customerCode && <span className="mr-1.5 font-mono text-[10px] font-semibold text-brand-700">{r.customerCode}</span>}
                          {r.name}
                        </td>
                        <td className="px-2 py-1 text-[11px] text-slate-500">{r.reason}</td>
                        <td className="border-l border-slate-200 px-2 py-1 text-right font-mono tabular-nums font-semibold text-slate-700">
                          {num(r.showsOnAging)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {blocked.length > 0 && (
              <div className="border-t border-amber-200 bg-amber-50/60 px-4 py-2">
                <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-amber-800">
                  <AlertTriangle className="h-3.5 w-3.5" /> Kept — still in use ({blocked.length})
                </div>
                <ul className="mt-1 space-y-0.5 text-[11px] text-amber-800">
                  {blocked.map((r) => (
                    <li key={r.id}><b>{r.name}</b> — {r.blockers.join(', ')}. Remove those first if it really isn't a customer.</li>
                  ))}
                </ul>
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-slate-50 px-4 py-2.5">
              <span className="text-[11px] text-slate-600">
                <b>{sel.size}</b> selected · clears <b className="font-mono tabular-nums">{num(selectedTotal)}</b> from Amount Receivable
              </span>
              <div className="flex items-center gap-2">
                <button onClick={onClose} className="h-8 rounded border border-slate-300 bg-white px-3 text-xs font-medium text-slate-600 hover:bg-slate-100">Cancel</button>
                <button onClick={() => remove.mutate()} disabled={!sel.size || remove.isPending}
                  className="inline-flex h-8 items-center gap-1.5 rounded bg-red-600 px-4 text-xs font-bold uppercase tracking-wide text-white hover:bg-red-700 disabled:opacity-50">
                  {remove.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                  Remove selected
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
