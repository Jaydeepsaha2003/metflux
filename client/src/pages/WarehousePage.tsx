// Store / Warehouse — manage named stores and the finished-goods stock that was
// sent in from overproduction. "Stock Out" dispatches stock to a customer's
// sales-order line, creating a normal dispatch that flows into packing & invoices.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Warehouse, Plus, Loader2, PackageOpen, Truck, X, FileText, CheckCircle2,
} from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';

type Store = { id: string; name: string; isActive: boolean; notes: string | null };
type StockLine = {
  warehouseId: string; warehouseName: string; specKey: string;
  coreType: string; grade: string; material: string; measure: string;
  id1: number | null; id2: number | null; od1: number | null; od2: number | null; ht: number | null;
  weightPerPc: number; onHand: number; onHandWeight: number;
};
type SoLine = {
  id: string; poNumber: string; customerName: string; customerCode: string | null;
  orderedPcs: number; dispatchedPcs: number; remainingPcs: number;
};

const todayISO = () => new Date().toISOString().slice(0, 10);
const specLabel = (s: StockLine) => `${s.coreType === 'TOROIDAL' ? 'Toro' : 'Rect'} · ${s.grade} · ${s.measure}`;

export const WarehousePage = () => {
  const qc = useQueryClient();
  const [warehouseId, setWarehouseId] = useState<string>('');
  const [newName, setNewName] = useState('');
  const [adding, setAdding] = useState(false);
  const [stockOut, setStockOut] = useState<StockLine | null>(null);

  const { data: stores } = useQuery({ queryKey: ['warehouses'], queryFn: () => api<{ items: Store[] }>('/warehouses') });
  const { data: stock, isLoading } = useQuery({
    queryKey: ['warehouse-stock', warehouseId],
    queryFn: () => api<{ items: StockLine[] }>(`/warehouses/stock${warehouseId ? `?warehouseId=${warehouseId}` : ''}`),
  });

  const createStore = useMutation({
    mutationFn: (name: string) => api('/warehouses', { method: 'POST', json: { name } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['warehouses'] }); setNewName(''); setAdding(false); },
  });

  return (
    <div className="space-y-5 max-w-[1400px]">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Warehouse className="h-5 w-5 text-brand-600" /> Store / Warehouse
        </h1>
        <Link to="/dispatch/new" className="btn-ghost border border-slate-300 text-brand-700 hover:bg-brand-50">
          <Truck className="h-4 w-4" /> New Dispatch
        </Link>
      </div>

      {/* Stores */}
      <section className="card p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-slate-900 mr-1">Stores:</span>
          <button
            onClick={() => setWarehouseId('')}
            className={cn('rounded-full px-3 py-1 text-xs font-medium', warehouseId === '' ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200')}
          >All</button>
          {(stores?.items ?? []).map((s) => (
            <button
              key={s.id}
              onClick={() => setWarehouseId(s.id)}
              className={cn('rounded-full px-3 py-1 text-xs font-medium', warehouseId === s.id ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200', !s.isActive && 'opacity-50')}
            >{s.name}</button>
          ))}
          {adding ? (
            <span className="inline-flex items-center gap-1">
              <input autoFocus className="input h-8 w-40 text-sm" placeholder="Store name" value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && newName.trim()) createStore.mutate(newName.trim()); if (e.key === 'Escape') setAdding(false); }} />
              <button onClick={() => newName.trim() && createStore.mutate(newName.trim())} disabled={createStore.isPending} className="btn-primary h-8 px-2 text-xs">
                {createStore.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Add'}
              </button>
              <button onClick={() => setAdding(false)} className="btn-ghost h-8 px-2 text-xs">Cancel</button>
            </span>
          ) : (
            <button onClick={() => setAdding(true)} className="inline-flex items-center gap-1 rounded-full border border-dashed border-slate-300 px-3 py-1 text-xs text-slate-500 hover:bg-slate-50">
              <Plus className="h-3.5 w-3.5" /> Add store
            </button>
          )}
        </div>
      </section>

      {/* Stock on hand */}
      <section className="card overflow-hidden">
        <div className="border-b border-slate-200 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
            <PackageOpen className="h-4 w-4 text-slate-500" /> Stock on hand
          </h2>
        </div>
        {isLoading ? (
          <div className="py-12 text-center text-slate-400"><Loader2 className="h-5 w-5 animate-spin mx-auto" /></div>
        ) : !stock?.items.length ? (
          <div className="py-12 text-center text-sm text-slate-400">
            No stock in store. Send overproduction here from the <Link to="/dispatch/new" className="text-brand-700 underline">New Dispatch</Link> page.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm whitespace-nowrap">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2.5">Store</th>
                  <th className="px-3 py-2.5">Type</th>
                  <th className="px-3 py-2.5">Grade</th>
                  <th className="px-3 py-2.5">Material</th>
                  <th className="px-3 py-2.5">Measure</th>
                  <th className="px-3 py-2.5 text-right">Wt / pc</th>
                  <th className="px-3 py-2.5 text-right">On hand</th>
                  <th className="px-3 py-2.5 text-right">Weight</th>
                  <th className="px-3 py-2.5 text-center">Action</th>
                </tr>
              </thead>
              <tbody>
                {stock.items.map((s) => (
                  <tr key={`${s.warehouseId}:${s.specKey}`} className="border-t border-slate-100 hover:bg-slate-50/60">
                    <td className="px-3 py-2.5 text-slate-600">{s.warehouseName}</td>
                    <td className="px-3 py-2.5">
                      <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-medium', s.coreType === 'TOROIDAL' ? 'bg-amber-50 text-amber-700' : 'bg-rose-50 text-rose-700')}>
                        {s.coreType === 'TOROIDAL' ? 'Toro' : 'Rect'}
                      </span>
                    </td>
                    <td className="px-3 py-2.5">{s.grade}</td>
                    <td className="px-3 py-2.5 text-slate-600">{s.material}</td>
                    <td className="px-3 py-2.5 font-mono text-xs">{s.measure}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-slate-500">{s.weightPerPc.toFixed(3)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums font-semibold text-slate-900">{s.onHand}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums font-mono text-slate-600">{s.onHandWeight.toFixed(3)}</td>
                    <td className="px-3 py-2.5 text-center">
                      <button onClick={() => setStockOut(s)} className="inline-flex items-center gap-1 rounded-lg bg-brand-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-brand-700">
                        <Truck className="h-3.5 w-3.5" /> Stock Out
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {stockOut && (
        <StockOutModal
          line={stockOut}
          onClose={() => setStockOut(null)}
          onDone={() => { qc.invalidateQueries({ queryKey: ['warehouse-stock'] }); qc.invalidateQueries({ queryKey: ['dispatch'] }); }}
        />
      )}
    </div>
  );
};

/* ── Stock-out modal ── */
const StockOutModal = ({ line, onClose, onDone }: { line: StockLine; onClose: () => void; onDone: () => void }) => {
  const [poOrderItemId, setPoOrderItemId] = useState('');
  const [pcs, setPcs] = useState(0);
  const [dispatchDate, setDispatchDate] = useState(todayISO());
  const [vehicleNo, setVehicleNo] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [createdId, setCreatedId] = useState<string | null>(null);

  const { data: soLines, isLoading } = useQuery({
    queryKey: ['warehouse-so-lines', line.specKey],
    queryFn: () => api<{ items: SoLine[] }>(`/warehouses/so-lines?specKey=${encodeURIComponent(line.specKey)}`),
  });

  const submit = useMutation({
    mutationFn: () => api<{ dispatchId: string }>('/warehouses/stock-out', {
      method: 'POST',
      json: {
        warehouseId: line.warehouseId, specKey: line.specKey, poOrderItemId,
        pcs, dispatchDate, vehicleNo: vehicleNo.trim() || null,
      },
    }),
    onSuccess: (d) => { setCreatedId(d.dispatchId); onDone(); },
    onError: (e) => setError(e instanceof Error ? e.message : 'Stock-out failed'),
  });

  const onSave = () => {
    setError(null);
    if (!poOrderItemId) return setError('Pick the customer order to fulfil');
    if (pcs <= 0) return setError('Pcs must be greater than 0');
    if (pcs > line.onHand) return setError(`Pcs ≤ stock on hand (${line.onHand})`);
    submit.mutate();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="w-full max-w-lg rounded-xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <h2 className="text-sm font-semibold text-slate-900">Stock Out — {specLabel(line)}</h2>
          <button onClick={onClose} className="rounded p-1 text-slate-400 hover:bg-slate-100"><X className="h-4 w-4" /></button>
        </div>

        {createdId ? (
          <div className="px-5 py-6 space-y-4">
            <div className="flex items-center gap-2 text-emerald-700 text-sm font-medium">
              <CheckCircle2 className="h-5 w-5" /> Stocked out {pcs} pcs — dispatch created.
            </div>
            <div className="flex flex-wrap gap-2">
              <Link to="/packing-list" state={{ dispatchIds: [createdId] }} className="btn-primary text-sm">
                <FileText className="h-4 w-4" /> Create Packing List
              </Link>
              <button onClick={onClose} className="btn-ghost text-sm border border-slate-300">Done</button>
            </div>
          </div>
        ) : (
          <div className="px-5 py-4 space-y-4">
            <div className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
              On hand: <strong className="text-slate-900">{line.onHand} pcs</strong> · {line.weightPerPc.toFixed(3)} kg/pc · from {line.warehouseName}
            </div>

            <label className="block">
              <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-slate-500">Fulfil customer order (same spec)</span>
              {isLoading ? (
                <div className="text-sm text-slate-400 py-2"><Loader2 className="h-4 w-4 animate-spin inline" /> Loading orders…</div>
              ) : !soLines?.items.length ? (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  No open sales-order line matches this spec. Create a sales order for this item first, then stock it out.
                </div>
              ) : (
                <select className="input" value={poOrderItemId} onChange={(e) => setPoOrderItemId(e.target.value)}>
                  <option value="">Select order…</option>
                  {soLines.items.map((so) => (
                    <option key={so.id} value={so.id}>
                      {so.poNumber} · {so.customerCode ?? so.customerName} · remaining {so.remainingPcs}/{so.orderedPcs}
                    </option>
                  ))}
                </select>
              )}
            </label>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <label className="block">
                <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-slate-500">Pcs (max {line.onHand})</span>
                <input className="input" type="number" min={1} max={line.onHand} value={pcs || ''} onChange={(e) => setPcs(parseInt(e.target.value || '0', 10))} />
              </label>
              <label className="block">
                <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-slate-500">Dispatch date</span>
                <input className="input" type="date" value={dispatchDate} onChange={(e) => setDispatchDate(e.target.value)} />
              </label>
              <label className="block">
                <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-slate-500">Vehicle No.</span>
                <input className="input" value={vehicleNo} onChange={(e) => setVehicleNo(e.target.value)} placeholder="Optional" />
              </label>
            </div>

            {pcs > 0 && (
              <div className="text-xs text-slate-500">Total weight: <strong className="text-slate-700">{(pcs * line.weightPerPc).toFixed(3)} kg</strong></div>
            )}
            {error && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}

            <div className="flex justify-end gap-3 border-t border-slate-200 pt-3">
              <button onClick={onClose} className="btn-ghost text-sm">Cancel</button>
              <button onClick={onSave} disabled={submit.isPending || !soLines?.items.length} className="btn-primary text-sm">
                {submit.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Truck className="h-4 w-4" />} Stock Out
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
