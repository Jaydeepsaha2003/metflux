// Production → Rejection. Move produced-but-not-yet-dispatched pcs into a store
// as REJECTED stock: it leaves the production floor (so it no longer shows as
// ready-to-dispatch) and is NOT sellable store stock (never appears in
// stock-out). Two tabs:
//   • Reject — a table of produced-not-dispatched items; pick a row, enter pcs,
//     reject (default note "Rejection", editable).
//   • Modify — edit or undo existing rejections.
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Ban, Loader2, Trash2, Search, Check, X, Pencil } from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
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
const coreShort = (c: string) => (c === 'TOROIDAL' ? 'Toro' : c === 'RECTANGULAR' ? 'Rect' : c === 'COMPOSITE' ? 'Comp' : c === 'NANO' ? 'Nano' : c || '—');
const specText = (r: { grade: string; measure: string }) => [r.grade, r.measure].filter(Boolean).join(' · ');

export const RejectionPage = () => {
  const qc = useQueryClient();
  const { confirm, confirmDialog } = useConfirm();
  const [tab, setTab] = useState<'reject' | 'modify'>('reject');

  // Shared reject controls
  const [warehouseId, setWarehouseId] = useState('');
  const [note, setNote] = useState('Rejection');
  const [search, setSearch] = useState('');
  const [pcsByItem, setPcsByItem] = useState<Record<string, string>>({});
  const [busyItem, setBusyItem] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // Modify tab inline edit
  const [edit, setEdit] = useState<{ id: string; pcs: string; warehouseId: string; notes: string; date: string } | null>(null);
  const [editErr, setEditErr] = useState<string | null>(null);

  const { data: stores } = useQuery({ queryKey: ['warehouses'], queryFn: () => api<{ items: Store[] }>('/warehouses') });
  const { data: rejectable, isLoading } = useQuery({
    queryKey: ['rejectable', search],
    queryFn: () => api<{ items: Rejectable[] }>(`/warehouses/rejectable${search ? `?search=${encodeURIComponent(search)}` : ''}`),
  });
  const { data: rejections } = useQuery({ queryKey: ['rejections'], queryFn: () => api<{ items: Rejection[] }>('/warehouses/rejections') });

  const activeStores = (stores?.items ?? []).filter((s) => s.isActive);
  const storeOpts = activeStores.map((s) => ({ value: s.id, label: s.name }));
  const items = rejectable?.items ?? [];
  const rejList = rejections?.items ?? [];

  const invalidate = () => ['rejectable', 'rejections', 'dispatch-ready', 'warehouse-stock'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));

  const rejectRow = async (it: Rejectable) => {
    setErr(null);
    if (!warehouseId) { setErr('Pick a store at the top first.'); return; }
    const n = Number(pcsByItem[it.id]);
    if (!(n > 0)) { setErr(`Enter pcs to reject for ${it.poNumber}.`); return; }
    if (n > it.availablePcs) { setErr(`Only ${it.availablePcs} pcs available for ${it.poNumber}.`); return; }
    setBusyItem(it.id);
    try {
      await api('/warehouses/reject', { method: 'POST', json: { warehouseId, poOrderItemId: it.id, pcs: n, notes: note.trim() || null } });
      setPcsByItem((p) => { const q = { ...p }; delete q[it.id]; return q; });
      invalidate();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not reject.');
    } finally { setBusyItem(null); }
  };

  const saveEdit = useMutation({
    mutationFn: () => api(`/warehouses/rejections/${edit!.id}`, {
      method: 'PATCH',
      json: { warehouseId: edit!.warehouseId, pcs: Number(edit!.pcs), notes: edit!.notes.trim() || null, movementDate: edit!.date },
    }),
    onSuccess: () => { setEdit(null); setEditErr(null); invalidate(); },
    onError: (e) => setEditErr(e instanceof Error ? e.message : 'Could not save.'),
  });
  const delRej = useMutation({
    mutationFn: (id: string) => api(`/warehouses/rejections/${id}`, { method: 'DELETE' }),
    onSuccess: invalidate,
  });
  const onUndo = async (r: Rejection) => {
    const ok = await confirm({
      title: 'Undo this rejection?',
      message: <>Return <b>{r.pcs}</b> pcs ({specText(r)}) back to the production floor? Removes the rejected stock from <b>{r.warehouseName}</b>.</>,
      tone: 'danger', confirmLabel: 'Undo',
    });
    if (ok) delRej.mutate(r.id);
  };
  const startEdit = (r: Rejection) => {
    const st = activeStores.find((s) => s.name === r.warehouseName);
    setEditErr(null);
    setEdit({ id: r.id, pcs: String(r.pcs), warehouseId: st?.id ?? '', notes: r.notes ?? '', date: r.movementDate ? r.movementDate.slice(0, 10) : todayISO() });
  };

  return (
    <div className="max-w-full space-y-4 text-[13px]">
      <div>
        <h1 className="flex items-center gap-2 text-lg font-bold tracking-tight">
          <Ban className="h-5 w-5 text-rose-600" /> Rejection
        </h1>
        <p className="mt-0.5 text-xs text-slate-500">
          Move produced pcs into a store as <b>rejected</b> stock. Rejected qty leaves the production floor — it stops showing in Dispatch and is not sellable store stock.
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-slate-200">
        {(['reject', 'modify'] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={cn('-mb-px border-b-2 px-4 py-2 text-xs font-semibold', tab === t ? 'border-rose-600 text-rose-700' : 'border-transparent text-slate-500 hover:text-slate-700')}>
            {t === 'reject' ? 'Reject' : `Modify (${rejList.length})`}
          </button>
        ))}
      </div>

      {tab === 'reject' ? (
        <div className="card overflow-hidden">
          {/* Shared controls */}
          <div className="grid grid-cols-1 gap-2 border-b border-slate-100 p-3 sm:grid-cols-3 sm:items-end">
            <div>
              <span className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-slate-500">Store (for rejected stock)</span>
              <SearchableSelect dense value={warehouseId} onChange={setWarehouseId} options={storeOpts}
                placeholder={activeStores.length ? 'Pick a store…' : 'No active store — create one under Store / Warehouse'} />
            </div>
            <label className="block">
              <span className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-slate-500">Note</span>
              <input className="input h-8 text-xs" placeholder="Rejection" value={note} onChange={(e) => setNote(e.target.value)} />
            </label>
            <label className="block">
              <span className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-slate-500">Search</span>
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                <input className="input h-8 pl-8 text-xs" placeholder="Customer, PO, grade, measure…" value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
            </label>
          </div>
          {err && <div className="mx-3 mt-2 rounded border border-red-200 bg-red-50 px-3 py-1.5 text-[11px] text-red-700">{err}</div>}

          {isLoading ? (
            <div className="py-8 text-center text-slate-400"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></div>
          ) : !items.length ? (
            <div className="py-8 text-center text-xs text-slate-400">{search ? 'No matching produced items.' : 'No produced pcs available to reject.'}</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs whitespace-nowrap">
                <thead><tr className="border-b border-slate-200 bg-slate-50 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                  <th className="px-3 py-1.5 text-left">Customer</th>
                  <th className="px-3 py-1.5 text-left">PO No.</th>
                  <th className="px-3 py-1.5 text-left">Core</th>
                  <th className="px-3 py-1.5 text-left">Grade</th>
                  <th className="px-3 py-1.5 text-left">Material</th>
                  <th className="px-3 py-1.5 text-left">Measure</th>
                  <th className="px-3 py-1.5 text-right">Wt/Pc</th>
                  <th className="px-3 py-1.5 text-right">Available</th>
                  <th className="px-3 py-1.5 text-right">Reject pcs</th>
                  <th className="w-20 px-2 py-1.5" />
                </tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {items.map((it) => (
                    <tr key={it.id} className="hover:bg-rose-50/40">
                      <td className="px-3 py-1 font-medium">{it.customerName || it.customerCode || '—'}</td>
                      <td className="px-3 py-1 text-slate-600">{it.poNumber}</td>
                      <td className="px-3 py-1 text-slate-600">{coreShort(it.coreType)}</td>
                      <td className="px-3 py-1 text-slate-600">{it.grade || '—'}</td>
                      <td className="px-3 py-1 text-slate-600">{it.material || '—'}</td>
                      <td className="px-3 py-1 text-slate-600">{it.measure || '—'}</td>
                      <td className="px-3 py-1 text-right tabular-nums text-slate-500">{it.weightPerPc ? it.weightPerPc.toFixed(3) : '—'}</td>
                      <td className="px-3 py-1 text-right tabular-nums font-semibold text-slate-800">{it.availablePcs}</td>
                      <td className="px-2 py-1 text-right">
                        <input type="number" min="1" max={it.availablePcs} value={pcsByItem[it.id] ?? ''}
                          onChange={(e) => setPcsByItem((p) => ({ ...p, [it.id]: e.target.value }))}
                          onKeyDown={(e) => { if (e.key === 'Enter') rejectRow(it); }}
                          className="h-7 w-16 rounded border border-slate-300 px-2 text-right text-xs tabular-nums outline-none focus:border-rose-500 focus:ring-2 focus:ring-rose-500/20" placeholder="0" />
                      </td>
                      <td className="px-2 py-1 text-center">
                        <button onClick={() => rejectRow(it)} disabled={busyItem === it.id}
                          className="inline-flex h-7 items-center gap-1 rounded-md bg-rose-600 px-2 text-[11px] font-medium text-white hover:bg-rose-700 disabled:opacity-50">
                          {busyItem === it.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Ban className="h-3 w-3" />} Reject
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : (
        <div className="card overflow-hidden">
          {editErr && <div className="mx-3 mt-2 rounded border border-red-200 bg-red-50 px-3 py-1.5 text-[11px] text-red-700">{editErr}</div>}
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
                  <th className="w-24 px-2 py-1.5" />
                </tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {rejList.map((r) => {
                    const editing = edit?.id === r.id;
                    return (
                      <tr key={r.id} className="hover:bg-slate-50/60">
                        <td className="px-3 py-1 text-slate-600">
                          {editing
                            ? <input type="date" value={edit!.date} onChange={(e) => setEdit((s) => s && { ...s, date: e.target.value })} className="h-7 rounded border border-slate-300 px-1 text-xs" />
                            : fmtD(r.movementDate)}
                        </td>
                        <td className="px-3 py-1">{[r.customerName, r.poNumber].filter(Boolean).join(' · ') || '—'}</td>
                        <td className="px-3 py-1 text-slate-600">{specText(r)}</td>
                        <td className="px-3 py-1 text-slate-600">
                          {editing
                            ? <select value={edit!.warehouseId} onChange={(e) => setEdit((s) => s && { ...s, warehouseId: e.target.value })} className="h-7 rounded border border-slate-300 px-1 text-xs">
                                {storeOpts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                              </select>
                            : r.warehouseName}
                        </td>
                        <td className="px-3 py-1 text-right tabular-nums font-semibold text-rose-700">
                          {editing
                            ? <input type="number" min="1" value={edit!.pcs} onChange={(e) => setEdit((s) => s && { ...s, pcs: e.target.value })} className="h-7 w-16 rounded border border-slate-300 px-2 text-right text-xs tabular-nums" />
                            : r.pcs}
                        </td>
                        <td className="px-3 py-1 text-slate-500">
                          {editing
                            ? <input value={edit!.notes} onChange={(e) => setEdit((s) => s && { ...s, notes: e.target.value })} placeholder="Rejection" className="h-7 w-40 rounded border border-slate-300 px-2 text-xs" />
                            : (r.notes || '—')}
                        </td>
                        <td className="px-2 py-1 text-center">
                          {editing ? (
                            <div className="inline-flex items-center gap-1">
                              <button onClick={() => saveEdit.mutate()} disabled={saveEdit.isPending} className="rounded p-1 text-emerald-600 hover:bg-emerald-50" title="Save">
                                {saveEdit.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                              </button>
                              <button onClick={() => { setEdit(null); setEditErr(null); }} className="rounded p-1 text-slate-400 hover:bg-slate-100" title="Cancel"><X className="h-3.5 w-3.5" /></button>
                            </div>
                          ) : (
                            <div className="inline-flex items-center gap-1">
                              <button onClick={() => startEdit(r)} className="rounded p-1 text-brand-600 hover:bg-brand-50" title="Modify"><Pencil className="h-3.5 w-3.5" /></button>
                              <button onClick={() => onUndo(r)} disabled={delRej.isPending} className="rounded p-1 text-red-500 hover:bg-red-50" title="Undo (return pcs to floor)"><Trash2 className="h-3.5 w-3.5" /></button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
      {confirmDialog}
    </div>
  );
};

export default RejectionPage;
