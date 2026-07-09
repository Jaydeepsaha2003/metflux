// Production → Rejection. Move produced-but-not-yet-dispatched pcs into a store
// as REJECTED stock: it leaves the production floor (so it no longer shows as
// ready-to-dispatch) and is NOT sellable store stock (never appears in
// stock-out). Default note "Rejection"; the user can type anything else.
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Ban, Loader2, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { useConfirm } from '@/hooks/useConfirm';
import { SearchableSelect } from '@/components/SearchableSelect';

type Store = { id: string; name: string; isActive: boolean };
type Rejectable = {
  id: string; poNumber: string; customerName: string; customerCode: string | null;
  coreType: string; grade: string; material: string; measure: string;
  weightPerPc: number; availablePcs: number;
};
type Rejection = {
  id: string; pcs: number; movementDate: string | null; notes: string | null; totalWeight: number;
  warehouseName: string; coreType: string; grade: string; material: string; measure: string;
  poNumber: string | null; customerName: string | null;
};

const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const fmtD = (iso: string | null) => { if (!iso) return '—'; const d = new Date(iso); return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }); };
const specText = (r: { coreType: string; grade: string; measure: string }) => [r.grade, r.measure].filter(Boolean).join(' · ');

export const RejectionPage = () => {
  const qc = useQueryClient();
  const { confirm, confirmDialog } = useConfirm();
  const [warehouseId, setWarehouseId] = useState('');
  const [itemId, setItemId] = useState('');
  const [pcs, setPcs] = useState('');
  const [notes, setNotes] = useState('Rejection');
  const [date, setDate] = useState(todayISO());
  const [err, setErr] = useState<string | null>(null);

  const { data: stores } = useQuery({ queryKey: ['warehouses'], queryFn: () => api<{ items: Store[] }>('/warehouses') });
  const { data: rejectable, isLoading } = useQuery({ queryKey: ['rejectable'], queryFn: () => api<{ items: Rejectable[] }>('/warehouses/rejectable') });
  const { data: rejections } = useQuery({ queryKey: ['rejections'], queryFn: () => api<{ items: Rejection[] }>('/warehouses/rejections') });

  const activeStores = (stores?.items ?? []).filter((s) => s.isActive);
  const items = rejectable?.items ?? [];
  const selected = items.find((i) => i.id === itemId) ?? null;
  const maxPcs = selected?.availablePcs ?? 0;

  const invalidate = () => ['rejectable', 'rejections', 'dispatch-ready', 'warehouse-stock'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));

  const create = useMutation({
    mutationFn: () => api('/warehouses/reject', { method: 'POST', json: { warehouseId, poOrderItemId: itemId, pcs: Number(pcs), movementDate: date, notes: notes.trim() || null } }),
    onSuccess: () => { setItemId(''); setPcs(''); setNotes('Rejection'); setErr(null); invalidate(); },
    onError: (e) => setErr(e instanceof Error ? e.message : 'Could not save the rejection'),
  });
  const del = useMutation({
    mutationFn: (id: string) => api(`/warehouses/rejections/${id}`, { method: 'DELETE' }),
    onSuccess: invalidate,
  });

  const canSave = !!warehouseId && !!itemId && Number(pcs) > 0 && Number(pcs) <= maxPcs;
  const submit = () => {
    if (!warehouseId) { setErr('Pick a store to move the rejected pcs into.'); return; }
    if (!itemId) { setErr('Pick the produced item to reject.'); return; }
    if (!(Number(pcs) > 0)) { setErr('Enter the pcs to reject.'); return; }
    if (Number(pcs) > maxPcs) { setErr(`Only ${maxPcs} pcs available to reject for this item.`); return; }
    create.mutate();
  };
  const onDelete = async (r: Rejection) => {
    const ok = await confirm({
      title: 'Undo this rejection?',
      message: <>Return <b>{r.pcs}</b> pcs ({specText(r)}) back to the production floor? This removes the rejected stock from <b>{r.warehouseName}</b>.</>,
      tone: 'danger', confirmLabel: 'Undo',
    });
    if (ok) del.mutate(r.id);
  };

  const rejList = rejections?.items ?? [];

  return (
    <div className="max-w-full space-y-5 text-[13px]">
      <div>
        <h1 className="flex items-center gap-2 text-lg font-bold tracking-tight">
          <Ban className="h-5 w-5 text-rose-600" /> Rejection
        </h1>
        <p className="mt-0.5 text-xs text-slate-500">
          Move produced pcs into a store as <b>rejected</b> stock. Rejected qty leaves the production floor — it stops showing in Dispatch and is not sellable store stock.
        </p>
      </div>

      {/* Entry form */}
      <div className="card overflow-hidden">
        <div className="border-b border-slate-200 bg-slate-50 px-4 py-2 text-xs font-semibold text-slate-700">Reject produced pcs</div>
        {err && <div className="mx-4 mt-3 rounded border border-red-200 bg-red-50 px-3 py-1.5 text-[11px] text-red-700">{err}</div>}
        <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-6 sm:items-end">
          <div className="sm:col-span-3">
            <span className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-slate-500">Produced item</span>
            <SearchableSelect
              dense value={itemId} onChange={setItemId}
              options={items.map((i) => ({ value: i.id, label: `${i.customerName || i.customerCode || '—'} · ${i.poNumber} · ${specText(i)} — ${i.availablePcs} pc avail` }))}
              placeholder={isLoading ? 'Loading…' : (items.length ? 'Search / pick a produced item…' : 'No produced pcs available to reject')}
            />
          </div>
          <div className="sm:col-span-2">
            <span className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-slate-500">Store</span>
            <SearchableSelect
              dense value={warehouseId} onChange={setWarehouseId}
              options={activeStores.map((s) => ({ value: s.id, label: s.name }))}
              placeholder={activeStores.length ? 'Pick a store…' : 'No active store — create one under Store / Warehouse'}
            />
          </div>
          <label className="block">
            <span className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-slate-500">Reject pcs{selected ? ` (max ${maxPcs})` : ''}</span>
            <input type="number" min="1" max={maxPcs || undefined} className="input h-8 text-right text-xs tabular-nums" placeholder="0" value={pcs}
              onChange={(e) => setPcs(e.target.value)} />
          </label>
          <label className="block sm:col-span-2">
            <span className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-slate-500">Date</span>
            <input type="date" className="input h-8 text-xs" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <label className="block sm:col-span-3">
            <span className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-slate-500">Note</span>
            <input className="input h-8 text-xs" placeholder="Rejection" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </label>
          <button onClick={submit} disabled={create.isPending || !canSave} className="btn-primary h-8 text-xs disabled:opacity-50">
            {create.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Ban className="h-3.5 w-3.5" />} Reject
          </button>
        </div>
      </div>

      {/* Recent rejections */}
      <div className="card overflow-hidden">
        <div className="border-b border-slate-200 bg-slate-50 px-4 py-2 text-xs font-semibold text-slate-700">
          Recent rejections <span className="font-normal text-slate-400">({rejList.length})</span>
        </div>
        {!rejList.length ? (
          <div className="py-8 text-center text-xs text-slate-400">No rejections yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs whitespace-nowrap">
              <thead><tr className="border-b border-slate-200 bg-slate-50 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                <th className="px-3 py-1.5 text-left">Date</th>
                <th className="px-3 py-1.5 text-left">Customer / PO</th>
                <th className="px-3 py-1.5 text-left">Spec</th>
                <th className="px-3 py-1.5 text-left">Store</th>
                <th className="px-3 py-1.5 text-right">Pcs</th>
                <th className="px-3 py-1.5 text-left">Note</th>
                <th className="w-8 px-2 py-1.5" />
              </tr></thead>
              <tbody className="divide-y divide-slate-100">
                {rejList.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50/60">
                    <td className="px-3 py-1 text-slate-600">{fmtD(r.movementDate)}</td>
                    <td className="px-3 py-1">{[r.customerName, r.poNumber].filter(Boolean).join(' · ') || '—'}</td>
                    <td className="px-3 py-1 text-slate-600">{specText(r)}</td>
                    <td className="px-3 py-1 text-slate-600">{r.warehouseName}</td>
                    <td className="px-3 py-1 text-right tabular-nums font-semibold text-rose-700">{r.pcs}</td>
                    <td className="px-3 py-1 text-slate-500">{r.notes || '—'}</td>
                    <td className="px-2 py-1 text-center">
                      <button onClick={() => onDelete(r)} disabled={del.isPending} className="rounded p-1 text-red-500 hover:bg-red-50" title="Undo rejection (return pcs to floor)">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {confirmDialog}
    </div>
  );
};

export default RejectionPage;
