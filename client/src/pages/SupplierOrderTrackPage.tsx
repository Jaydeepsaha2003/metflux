// Track Supplier POs — overview filtered by status, with inline receive entry
// per item. Used to record material as it arrives from the supplier.
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Search, Loader2, BarChart3, ChevronDown, Package, Save, X } from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';

type PoItem = {
  id: string;
  description: string;
  hsnCode: string | null;
  qty: number;
  unit: string;
  rate: number;
  amount: number;
  receivedQty: number;
};

type SupplierOrder = {
  id: string;
  poNumber: string;
  orderDate: string;
  expectedDate: string | null;
  status: 'PENDING' | 'PARTIAL' | 'RECEIVED' | 'CANCELLED';
  supplier: { id: string; name: string };
  items: PoItem[];
};

type Status = 'ALL' | 'PENDING' | 'PARTIAL' | 'RECEIVED' | 'CANCELLED';

const fmt = (iso: string | null | undefined) => {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
};

const statusBadge: Record<SupplierOrder['status'], string> = {
  PENDING:   'bg-slate-100 text-slate-700',
  PARTIAL:   'bg-amber-50 text-amber-700',
  RECEIVED:  'bg-green-50 text-green-700',
  CANCELLED: 'bg-red-50 text-red-700',
};

export const SupplierOrderTrackPage = () => {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<Status>('ALL');
  const [expanded, setExpanded] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['supplier-orders', 'track', search, status],
    queryFn: () =>
      api<{ items: SupplierOrder[]; total: number }>(
        `/supplier-orders?status=${status}${search ? `&search=${encodeURIComponent(search)}` : ''}`
      ),
  });

  const counts = (data?.items ?? []).reduce(
    (acc, po) => { acc[po.status] = (acc[po.status] ?? 0) + 1; return acc; },
    {} as Record<string, number>
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <BarChart3 className="h-5 w-5 text-brand-600" /> Track Supplier POs
        </h1>
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
          <input
            className="input pl-9"
            placeholder="Search PO#, supplier, HSN…"
            value={search} onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* Status filter chips */}
      <div className="flex flex-wrap gap-2">
        {(['ALL', 'PENDING', 'PARTIAL', 'RECEIVED', 'CANCELLED'] as const).map((s) => (
          <button
            key={s}
            onClick={() => setStatus(s)}
            className={cn(
              'rounded-full px-3 py-1 text-xs font-medium border transition',
              status === s
                ? 'bg-brand-600 text-white border-brand-600'
                : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'
            )}
          >
            {s}
            {s !== 'ALL' && counts[s] !== undefined && (
              <span className="ml-1 opacity-70">({counts[s]})</span>
            )}
          </button>
        ))}
      </div>

      <div className="card overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center gap-2 py-10 text-slate-400">
            <Loader2 className="h-5 w-5 animate-spin" /> Loading…
          </div>
        ) : !data?.items.length ? (
          <div className="py-10 text-center text-slate-400 text-sm">No supplier POs match.</div>
        ) : (
          <div className="divide-y divide-slate-100">
            {data.items.map((po) => (
              <Row
                key={po.id}
                po={po}
                expanded={expanded === po.id}
                onToggle={() => setExpanded((cur) => (cur === po.id ? null : po.id))}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

/* ---------- single row ---------- */
const Row = ({ po, expanded, onToggle }: { po: SupplierOrder; expanded: boolean; onToggle: () => void }) => {
  const total = po.items.reduce((s, it) => s + it.amount, 0);
  const totalQty = po.items.reduce((s, it) => s + it.qty, 0);
  const totalReceived = po.items.reduce((s, it) => s + it.receivedQty, 0);
  const pct = totalQty > 0 ? Math.round((totalReceived / totalQty) * 100) : 0;

  return (
    <div>
      <button onClick={onToggle} className="w-full px-4 py-3 hover:bg-slate-50 transition flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4 text-left">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-xs font-semibold text-brand-700">{po.poNumber}</span>
            <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-medium', statusBadge[po.status])}>
              {po.status}
            </span>
            <span className="text-sm font-medium text-slate-900">{po.supplier.name}</span>
          </div>
          <div className="mt-1 text-xs text-slate-500">
            Ordered {fmt(po.orderDate)} · Expected {fmt(po.expectedDate)} · {po.items.length} item{po.items.length === 1 ? '' : 's'}
          </div>
        </div>
        <div className="flex items-center gap-4 sm:gap-6 text-xs text-slate-500">
          <div>
            <div className="text-[10px] uppercase tracking-wide">Received</div>
            <div className="text-sm font-semibold text-slate-900">{pct}%</div>
          </div>
          <div className="text-right">
            <div className="text-[10px] uppercase tracking-wide">Total</div>
            <div className="text-sm font-mono font-semibold text-slate-900">₹ {total.toFixed(2)}</div>
          </div>
          <ChevronDown className={cn('h-4 w-4 transition-transform', expanded ? 'rotate-180' : '')} />
        </div>
      </button>

      {expanded && <ReceivePanel po={po} />}
    </div>
  );
};

/* ---------- receive panel — editable received qty per line ---------- */
const ReceivePanel = ({ po }: { po: SupplierOrder }) => {
  const qc = useQueryClient();
  const [draft, setDraft] = useState<Record<string, number>>({});
  const [saved, setSaved] = useState(false);

  // Reset draft when the underlying PO changes (after save).
  useEffect(() => {
    const initial: Record<string, number> = {};
    for (const it of po.items) initial[it.id] = it.receivedQty;
    setDraft(initial);
  }, [po.items.map((i) => `${i.id}:${i.receivedQty}`).join(',')]);

  const dirty = po.items.some((it) => (draft[it.id] ?? 0) !== it.receivedQty);

  const save = useMutation({
    mutationFn: () => api(`/supplier-orders/${po.id}/receive`, { method: 'POST', json: { receipts: draft } }),
    onSuccess: () => {
      setSaved(true);
      qc.invalidateQueries({ queryKey: ['supplier-orders'] });
      setTimeout(() => setSaved(false), 2000);
    },
  });

  const setQty = (itemId: string, qty: number, max: number) =>
    setDraft((prev) => ({ ...prev, [itemId]: Math.max(0, Math.min(qty, max)) }));

  return (
    <div className="border-t border-slate-100 bg-slate-50/60 px-4 py-3">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-wide text-slate-500">
              <th className="px-2 py-1.5">Description</th>
              <th className="px-2 py-1.5">HSN</th>
              <th className="px-2 py-1.5 text-right">Ordered</th>
              <th className="px-2 py-1.5 text-right">Received (cumulative)</th>
              <th className="px-2 py-1.5 text-right">Pending</th>
            </tr>
          </thead>
          <tbody>
            {po.items.map((it) => {
              const rec = draft[it.id] ?? 0;
              const pending = Math.max(0, it.qty - rec);
              return (
                <tr key={it.id} className="border-t border-slate-200">
                  <td className="px-2 py-1.5">{it.description}</td>
                  <td className="px-2 py-1.5 font-mono text-xs text-slate-600">{it.hsnCode || '—'}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums font-mono">{it.qty} {it.unit}</td>
                  <td className="px-2 py-1.5 text-right">
                    <div className="inline-flex items-center gap-1">
                      <input
                        type="number" inputMode="decimal" step="any" min={0} max={it.qty}
                        value={rec || ''}
                        onChange={(e) => setQty(it.id, parseFloat(e.target.value) || 0, it.qty)}
                        className="h-8 w-24 rounded border border-slate-300 bg-white px-2 text-right tabular-nums font-mono"
                      />
                      <span className="text-xs text-slate-500">{it.unit}</span>
                    </div>
                  </td>
                  <td className={cn('px-2 py-1.5 text-right tabular-nums font-mono', pending > 0 ? 'text-amber-700' : 'text-slate-400')}>
                    {pending} {it.unit}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex items-center justify-between gap-2">
        {saved
          ? <span className="text-xs text-green-700 inline-flex items-center gap-1"><Package className="h-3.5 w-3.5" /> Receipts updated</span>
          : <span className="text-xs text-slate-500">Cumulative received quantity per item; status updates automatically.</span>}
        <div className="flex items-center gap-2">
          {dirty && (
            <button
              onClick={() => {
                const initial: Record<string, number> = {};
                for (const it of po.items) initial[it.id] = it.receivedQty;
                setDraft(initial);
              }}
              className="btn-ghost text-sm"
            >
              <X className="h-4 w-4" /> Reset
            </button>
          )}
          <button onClick={() => save.mutate()} disabled={!dirty || save.isPending} className="btn-primary text-sm">
            {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Save receipts
          </button>
        </div>
      </div>
    </div>
  );
};
