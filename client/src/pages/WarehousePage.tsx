// Store / Warehouse — manage named stores and the finished-goods stock that was
// sent in from overproduction. "Stock Out" dispatches stock to a customer's
// sales-order line, creating a normal dispatch that flows into packing & invoices.
import { Fragment, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Warehouse, Plus, Loader2, PackageOpen, Truck, X, FileText, CheckCircle2,
  Pencil, Trash2, PackagePlus, Check, ChevronRight, ChevronDown,
} from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useConfirm } from '@/hooks/useConfirm';
import { toroidalCalc, rectangularCalc, nanoCalc, round3, compositeRuleFromMaterial, compositeCalc } from '@/lib/calc';

type GradeRow = { grade: string; materials: { material: string }[]; coreTypes?: string[] };
// Dimensions the user types; core-type formula turns them into weight + measure.
type Dims = { id1: number; id2: number; od1: number; od2: number; ht: number };
type Computed = { weightPerPc: number; measure: string; coreWeight: number; caseWeight: number };
// Compute weight/measure per core type from free-typed dimensions (same math as
// the New Sales Order form, so the resulting spec matches order lines exactly).
const computeSpec = (coreType: CoreType, d: Dims): Computed => {
  if (coreType === 'RECTANGULAR') {
    const c = rectangularCalc({ id1: d.id1, id2: d.id2, od1: d.od1, od2: d.od2, ht: d.ht, pcs: 0 });
    return { weightPerPc: c.weightPerPc, measure: c.measure, coreWeight: 0, caseWeight: 0 };
  }
  if (coreType === 'NANO') {
    const c = nanoCalc({ id: d.id1, od: d.od1, ht: d.ht, pcs: 0 });
    return { weightPerPc: round3(c.coreWeight + c.caseWeight), measure: c.measure, coreWeight: c.coreWeight, caseWeight: c.caseWeight };
  }
  const c = toroidalCalc({ id: d.id1, od: d.od1, ht: d.ht, pcs: 0 });
  return { weightPerPc: c.weightPerPc, measure: c.measure, coreWeight: 0, caseWeight: 0 };
};

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
const fmtDate = (iso: string | null) => { if (!iso) return '—'; const d = new Date(iso); return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }); };
const coreShort = (ct: string) => (ct === 'TOROIDAL' ? 'Toro' : ct === 'NANO' ? 'Nano' : ct === 'COMPOSITE' ? 'Comp' : 'Rect');
const coreLabel: Record<string, string> = { TOROIDAL: 'Toroidal', RECTANGULAR: 'Rectangular', NANO: 'Nano', COMPOSITE: 'Composite' };
const coreBadge: Record<string, string> = { TOROIDAL: 'bg-amber-50 text-amber-700', NANO: 'bg-violet-50 text-violet-700', RECTANGULAR: 'bg-rose-50 text-rose-700', COMPOSITE: 'bg-teal-50 text-teal-700' };
const CORE_TYPES = ['TOROIDAL', 'RECTANGULAR', 'NANO', 'COMPOSITE'] as const;
type CoreType = (typeof CORE_TYPES)[number];
const specLabel = (s: StockLine) => `${coreShort(s.coreType)} · ${s.grade} · ${s.measure}`;
// Arrangement string per core type (Rectangular carries two ID/OD pairs).
const arrangementOf = (coreType: CoreType, d: Dims) =>
  coreType === 'RECTANGULAR'
    ? `${d.id1}×${d.id2} · ${d.od1}×${d.od2} · HT ${d.ht}`
    : `${d.id1} × ${d.od1} × ${d.ht}`;

export const WarehousePage = () => {
  const qc = useQueryClient();
  const { confirm, confirmDialog } = useConfirm();
  const [warehouseId, setWarehouseId] = useState<string>('');
  const [newName, setNewName] = useState('');
  const [adding, setAdding] = useState(false);
  const [stockOut, setStockOut] = useState<StockLine | null>(null);
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameVal, setRenameVal] = useState('');
  const [openingOpen, setOpeningOpen] = useState(false);
  const [storeErr, setStoreErr] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggleExpand = (key: string) => setExpanded((prev) => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });

  const { data: stores } = useQuery({ queryKey: ['warehouses'], queryFn: () => api<{ items: Store[] }>('/warehouses') });
  const { data: stock, isLoading } = useQuery({
    queryKey: ['warehouse-stock', warehouseId],
    queryFn: () => api<{ items: StockLine[] }>(`/warehouses/stock${warehouseId ? `?warehouseId=${warehouseId}` : ''}`),
  });

  const createStore = useMutation({
    mutationFn: (name: string) => api('/warehouses', { method: 'POST', json: { name } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['warehouses'] }); setNewName(''); setAdding(false); setStoreErr(null); },
    onError: (e) => setStoreErr(e instanceof ApiError ? e.message : 'Failed to add store'),
  });
  const renameStore = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => api(`/warehouses/${id}`, { method: 'PATCH', json: { name } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['warehouses'] }); setRenameId(null); setStoreErr(null); },
    onError: (e) => setStoreErr(e instanceof ApiError ? e.message : 'Failed to rename'),
  });
  const deleteStore = useMutation({
    mutationFn: (id: string) => api(`/warehouses/${id}`, { method: 'DELETE' }),
    onSuccess: (_d, id) => { qc.invalidateQueries({ queryKey: ['warehouses'] }); if (warehouseId === id) setWarehouseId(''); setStoreErr(null); },
    onError: (e) => setStoreErr(e instanceof ApiError ? e.message : 'Failed to delete'),
  });

  const selStore = (stores?.items ?? []).find((s) => s.id === warehouseId);
  const askDelete = async (s: Store) => {
    const ok = await confirm({
      title: 'Delete store?',
      message: <>Delete <strong>{s.name}</strong>? Only stores with no stock records can be deleted.</>,
      tone: 'danger', confirmLabel: 'Delete',
    });
    if (ok) deleteStore.mutate(s.id);
  };

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

          {/* Rename / delete the selected store */}
          {selStore && (
            renameId === selStore.id ? (
              <span className="inline-flex items-center gap-1 border-l border-slate-200 pl-2">
                <input autoFocus className="input h-8 w-40 text-sm" value={renameVal}
                  onChange={(e) => setRenameVal(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && renameVal.trim()) renameStore.mutate({ id: selStore.id, name: renameVal.trim() }); if (e.key === 'Escape') setRenameId(null); }} />
                <button onClick={() => renameVal.trim() && renameStore.mutate({ id: selStore.id, name: renameVal.trim() })} disabled={renameStore.isPending} className="btn-primary h-8 px-2 text-xs">
                  {renameStore.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                </button>
                <button onClick={() => setRenameId(null)} className="btn-ghost h-8 px-2 text-xs">Cancel</button>
              </span>
            ) : (
              <span className="inline-flex items-center gap-0.5 border-l border-slate-200 pl-2">
                <button onClick={() => { setRenameId(selStore.id); setRenameVal(selStore.name); setStoreErr(null); }} title="Rename store" className="rounded p-1.5 text-slate-500 hover:bg-slate-100"><Pencil className="h-3.5 w-3.5" /></button>
                <button onClick={() => askDelete(selStore)} disabled={deleteStore.isPending} title="Delete store (only if empty)" className="rounded p-1.5 text-red-500 hover:bg-red-50"><Trash2 className="h-3.5 w-3.5" /></button>
              </span>
            )
          )}
        </div>
        {storeErr && <div className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs text-red-700">{storeErr}</div>}
      </section>

      {/* Stock on hand */}
      <section className="card overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
            <PackageOpen className="h-4 w-4 text-slate-500" /> Stock on hand
          </h2>
          <button onClick={() => setOpeningOpen(true)} className="btn-ghost border border-slate-300 text-brand-700 hover:bg-brand-50 text-sm">
            <PackagePlus className="h-4 w-4" /> Opening Stock
          </button>
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
                  <th className="w-8 px-2 py-2.5" />
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
                {stock.items.map((s) => {
                  const key = `${s.warehouseId}:${s.specKey}`;
                  const open = expanded.has(key);
                  return (
                    <Fragment key={key}>
                      <tr className="border-t border-slate-100 hover:bg-slate-50/60 cursor-pointer" onClick={() => toggleExpand(key)}>
                        <td className="px-2 py-2.5 text-center text-slate-400">{open ? <ChevronDown className="inline h-4 w-4" /> : <ChevronRight className="inline h-4 w-4" />}</td>
                        <td className="px-3 py-2.5 text-slate-600">{s.warehouseName}</td>
                        <td className="px-3 py-2.5">
                          <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-medium', s.coreType === 'TOROIDAL' ? 'bg-amber-50 text-amber-700' : s.coreType === 'NANO' ? 'bg-violet-50 text-violet-700' : 'bg-rose-50 text-rose-700')}>
                            {coreShort(s.coreType)}
                          </span>
                        </td>
                        <td className="px-3 py-2.5">{s.grade}</td>
                        <td className="px-3 py-2.5 text-slate-600">{s.material}</td>
                        <td className="px-3 py-2.5 font-mono text-xs">{s.measure}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-slate-500">{s.weightPerPc.toFixed(3)}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums font-semibold text-slate-900">{s.onHand}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums font-mono text-slate-600">{s.onHandWeight.toFixed(3)}</td>
                        <td className="px-3 py-2.5 text-center" onClick={(e) => e.stopPropagation()}>
                          <button onClick={() => setStockOut(s)} className="inline-flex items-center gap-1 rounded-lg bg-brand-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-brand-700">
                            <Truck className="h-3.5 w-3.5" /> Stock Out
                          </button>
                        </td>
                      </tr>
                      {open && (
                        <tr className="bg-slate-50/60">
                          <td />
                          <td colSpan={9} className="px-3 py-2">
                            <MovementsPanel warehouseId={s.warehouseId} specKey={s.specKey} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
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

      {openingOpen && (
        <OpeningStockModal
          stores={(stores?.items ?? []).filter((s) => s.isActive)}
          defaultStoreId={warehouseId}
          onClose={() => setOpeningOpen(false)}
          onDone={() => qc.invalidateQueries({ queryKey: ['warehouse-stock'] })}
        />
      )}

      {confirmDialog}
    </div>
  );
};

/* ── Stock movements drill-down — the individual IN/OUT rows behind an on-hand
   line, so the notes entered on stock-in / opening stock are visible here. ── */
type Movement = {
  id: string; direction: 'IN' | 'OUT'; pcs: number; totalWeight: number; notes: string | null;
  movementDate: string | null; vehicleNo: string | null; poNumber: string | null; customerName: string | null;
};
const MovementsPanel = ({ warehouseId, specKey }: { warehouseId: string; specKey: string }) => {
  const { data, isLoading } = useQuery({
    queryKey: ['warehouse-movements', warehouseId, specKey],
    queryFn: () => api<{ items: Movement[] }>(`/warehouses/movements?warehouseId=${encodeURIComponent(warehouseId)}&specKey=${encodeURIComponent(specKey)}`),
  });
  const items = data?.items ?? [];
  if (isLoading) return <div className="py-3 text-center text-slate-400"><Loader2 className="mx-auto h-4 w-4 animate-spin" /></div>;
  if (!items.length) return <div className="py-3 text-center text-xs text-slate-400">No movements.</div>;
  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
      <table className="w-full text-xs">
        <thead className="bg-slate-50 text-left text-[10px] uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-2 py-1.5">Date</th>
            <th className="px-2 py-1.5">Movement</th>
            <th className="px-2 py-1.5 text-right">Pcs</th>
            <th className="px-2 py-1.5">Note</th>
            <th className="px-2 py-1.5">Reference</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {items.map((m) => (
            <tr key={m.id}>
              <td className="px-2 py-1 text-slate-600">{fmtDate(m.movementDate)}</td>
              <td className="px-2 py-1">
                <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-medium', m.direction === 'IN' ? 'bg-emerald-50 text-emerald-700' : 'bg-brand-50 text-brand-700')}>
                  {m.direction === 'IN' ? 'Stock In' : 'Stock Out'}
                </span>
              </td>
              <td className="px-2 py-1 text-right font-semibold tabular-nums">{m.direction === 'IN' ? '+' : '−'}{m.pcs}</td>
              <td className="px-2 py-1 text-slate-700">{m.notes || '—'}</td>
              <td className="px-2 py-1 text-slate-500">{[m.customerName, m.poNumber, m.vehicleNo].filter(Boolean).join(' · ') || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

/* ── Opening-stock modal — pick core type + grade/material, freely type the
   dimensions; weight auto-computes. Mirrors the New Sales Order form. ── */
const ZERO_DIMS: Dims = { id1: 0, id2: 0, od1: 0, od2: 0, ht: 0 };
const OpeningStockModal = ({
  stores, defaultStoreId, onClose, onDone,
}: { stores: Store[]; defaultStoreId: string; onClose: () => void; onDone: () => void }) => {
  const [warehouseId, setWarehouseId] = useState(defaultStoreId || stores[0]?.id || '');
  const [coreType, setCoreType] = useState<CoreType>('TOROIDAL');
  const [grade, setGrade] = useState('');
  const [material, setMaterial] = useState('');
  const [dims, setDims] = useState<Dims>(ZERO_DIMS);
  // CRGO sub-dimensions — only used for the COMPOSITE grade (Nano + CRGO).
  const [crgo, setCrgo] = useState({ id: 0, od: 0, ht: 0 });
  const [pcs, setPcs] = useState(0);
  const [movementDate, setMovementDate] = useState(todayISO());
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const { data: gradeData } = useQuery({ queryKey: ['material-grades'], queryFn: () => api<{ grades: GradeRow[] }>('/material-grades') });
  // Grades that apply to the chosen core type (a grade with no coreTypes = all).
  const gradeRows = (gradeData?.grades ?? []).filter((g) => !g.coreTypes || g.coreTypes.length === 0 || g.coreTypes.includes(coreType));
  const materials = gradeRows.find((g) => g.grade === grade)?.materials ?? [];

  const isRect = coreType === 'RECTANGULAR';
  const composite = coreType === 'COMPOSITE';
  const rule = composite ? (compositeRuleFromMaterial(grade) || compositeRuleFromMaterial(material)) : null;
  const comp = composite && rule ? compositeCalc({ rule, crgo, nano: { id: dims.id1, od: dims.od1, ht: dims.ht }, pcs: 0 }) : null;
  const base = computeSpec(coreType, dims);
  // Final identity (composite → derived; else straight from the dims).
  const weightPerPc = comp ? comp.weightPerPc : base.weightPerPc;
  const measure = comp ? comp.measure : base.measure;
  const coreWeight = comp ? comp.coreWeight : base.coreWeight;
  const caseWeight = comp ? comp.caseWeight : base.caseWeight;
  const finalId = comp ? comp.id : dims.id1;
  const finalOd = comp ? comp.od : dims.od1;
  const finalHt = comp ? comp.ht : dims.ht;
  const setDim = (k: keyof Dims, v: number) => setDims((d) => ({ ...d, [k]: v }));
  const setC = (k: 'id' | 'od' | 'ht', v: number) => setCrgo((c) => ({ ...c, [k]: v }));

  const submit = useMutation({
    mutationFn: () => api('/warehouses/opening-stock', {
      method: 'POST',
      json: {
        warehouseId, coreType, grade, material, measure,
        id1: finalId || null,
        id2: isRect ? (dims.id2 || null) : null,
        od1: finalOd || null,
        od2: isRect ? (dims.od2 || null) : null,
        ht: finalHt || null,
        weightPerPc, pcs, movementDate, notes: notes.trim() || 'Opening stock',
      },
    }),
    onSuccess: () => { setDone(true); onDone(); },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Failed to add opening stock'),
  });

  const onSave = () => {
    setError(null);
    if (!warehouseId) return setError('Pick a store');
    if (!grade || !material) return setError('Pick grade and material');
    if (composite) {
      if (!rule) return setError('Pick the composite type (Continuous Loop / Exact Split / Variable Height)');
      if (!crgo.id || !crgo.od || !crgo.ht || crgo.od <= crgo.id) return setError('Enter valid CRGO ID, OD, HT (OD > ID)');
      if (!dims.id1 || !dims.od1 || !dims.ht || dims.od1 <= dims.id1) return setError('Enter valid Nano ID, OD, HT (OD > ID)');
    } else {
      if (!dims.id1 || !dims.od1 || !dims.ht) return setError('Enter ID, OD and HT');
      if (isRect && (!dims.id2 || !dims.od2)) return setError('Enter both ID (id1, id2) and OD (od1, od2)');
      if (dims.od1 <= dims.id1) return setError('OD must be greater than ID');
    }
    if (weightPerPc <= 0) return setError('Weight could not be computed — check the dimensions');
    if (pcs <= 0) return setError('Pcs must be greater than 0');
    submit.mutate();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
      <div className="flex max-h-[90vh] w-full max-w-xl flex-col rounded-xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900"><PackagePlus className="h-4 w-4 text-brand-600" /> Add Opening Stock</h2>
          <button onClick={onClose} className="rounded p-1 text-slate-400 hover:bg-slate-100"><X className="h-4 w-4" /></button>
        </div>
        {done ? (
          <div className="space-y-4 px-5 py-6">
            <div className="flex items-center gap-2 text-sm font-medium text-emerald-700"><CheckCircle2 className="h-5 w-5" /> Opening stock added ({pcs} pcs).</div>
            <div className="flex justify-end"><button onClick={onClose} className="btn-primary text-sm">Done</button></div>
          </div>
        ) : (
          <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
            {/* Core type selector — all three, like the New Order form */}
            <div>
              <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-slate-500">Core type</span>
              <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5">
                {CORE_TYPES.map((ct) => (
                  <button key={ct} onClick={() => { setCoreType(ct); setGrade(''); setMaterial(''); }}
                    className={cn('rounded-md px-3.5 py-1.5 text-sm font-medium transition',
                      coreType === ct ? 'bg-brand-600 text-white shadow-sm' : 'text-slate-600 hover:text-slate-900')}>
                    {coreLabel[ct]}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <label className="block"><span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-slate-500">Store</span>
                <select className="input" value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
                  <option value="">Select store…</option>
                  {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select></label>
              <div />
              <label className="block"><span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-slate-500">Grade</span>
                <select className="input" value={grade} onChange={(e) => { setGrade(e.target.value); setMaterial(gradeRows.find((g) => g.grade === e.target.value)?.materials[0]?.material ?? ''); }}>
                  <option value="">Select grade…</option>
                  {gradeRows.map((g) => <option key={g.grade} value={g.grade}>{g.grade}</option>)}
                </select></label>
              <label className="block"><span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-slate-500">Material</span>
                <select className="input" value={material} disabled={!grade} onChange={(e) => setMaterial(e.target.value)}>
                  <option value="">{grade ? 'Select material…' : 'Pick grade first'}</option>
                  {materials.map((m) => <option key={m.material} value={m.material}>{m.material}</option>)}
                </select></label>
            </div>

            {/* Dimension inputs — shape depends on core type (+ CRGO for composite) */}
            <div>
              <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-slate-500">Dimensions (mm)</span>
              {composite ? (
                <>
                  <div className="mb-3 rounded-lg border border-amber-100 bg-amber-50/40 p-2.5">
                    <div className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-amber-700">CRGO core</div>
                    <div className="grid grid-cols-3 gap-3">
                      <NumInput label="ID" value={crgo.id} onChange={(v) => setC('id', v)} />
                      <NumInput label="OD" value={crgo.od} onChange={(v) => setC('od', v)} />
                      <NumInput label="HT" value={crgo.ht} onChange={(v) => setC('ht', v)} />
                    </div>
                  </div>
                  <div className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-violet-700">Nano core</div>
                  <div className="grid grid-cols-3 gap-3">
                    <NumInput label="ID" value={dims.id1} onChange={(v) => setDim('id1', v)} />
                    <NumInput label="OD" value={dims.od1} onChange={(v) => setDim('od1', v)} />
                    <NumInput label="HT" value={dims.ht} onChange={(v) => setDim('ht', v)} />
                  </div>
                  {rule && (
                    <div className="mt-2 text-[11px] text-slate-500">
                      {rule === 'CONTINUOUS_LOOP' ? 'Continuous loop → ID = min, OD = max, HT = same (concentric).'
                        : 'Stacked → same ID/OD, heights added.'}
                    </div>
                  )}
                </>
              ) : isRect ? (
                <div className="grid grid-cols-3 gap-3 sm:grid-cols-5">
                  <NumInput label="ID 1" value={dims.id1} onChange={(v) => setDim('id1', v)} />
                  <NumInput label="ID 2" value={dims.id2} onChange={(v) => setDim('id2', v)} />
                  <NumInput label="OD 1" value={dims.od1} onChange={(v) => setDim('od1', v)} />
                  <NumInput label="OD 2" value={dims.od2} onChange={(v) => setDim('od2', v)} />
                  <NumInput label="HT" value={dims.ht} onChange={(v) => setDim('ht', v)} />
                </div>
              ) : (
                <div className="grid grid-cols-3 gap-3">
                  <NumInput label="ID" value={dims.id1} onChange={(v) => setDim('id1', v)} />
                  <NumInput label="OD" value={dims.od1} onChange={(v) => setDim('od1', v)} />
                  <NumInput label="HT" value={dims.ht} onChange={(v) => setDim('ht', v)} />
                </div>
              )}
            </div>

            <div className="grid grid-cols-3 gap-3">
              <label className="block"><span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-slate-500">Pcs</span>
                <input className="input" type="number" min={1} value={pcs || ''} onChange={(e) => setPcs(parseInt(e.target.value || '0', 10))} /></label>
              <label className="block"><span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-slate-500">Date</span>
                <input className="input" type="date" value={movementDate} onChange={(e) => setMovementDate(e.target.value)} /></label>
              <label className="block"><span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-slate-500">Notes</span>
                <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Opening stock" /></label>
            </div>

            {/* Live preview card — mirrors the New Order form's computed section */}
            <div className="overflow-hidden rounded-xl border border-slate-200">
              <div className="flex items-center gap-2 border-b border-slate-200 bg-slate-50 px-4 py-2">
                <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-medium', coreBadge[coreType])}>{coreLabel[coreType]}</span>
                <span className="text-sm font-semibold text-slate-800">{grade || '—'}</span>
                {material && <span className="text-xs text-slate-500">· {material}</span>}
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-2.5 px-4 py-3 text-sm sm:grid-cols-3">
                <Field label="Arrangement (ID × OD × HT)" value={weightPerPc > 0 ? (composite ? `${finalId} × ${finalOd} × ${finalHt}` : arrangementOf(coreType, dims)) : '—'} span2 />
                <Field label={composite ? 'Composite measure' : 'Measure'} value={measure && weightPerPc > 0 ? measure : '—'} accent={composite ? true : undefined} />
                {composite ? (
                  <>
                    <Field label="Nano wt (core+case)" value={weightPerPc ? `${(coreWeight + caseWeight).toFixed(3)} kg` : '—'} />
                    <Field label="CRGO wt" value={comp?.crgoWeight ? `${comp.crgoWeight.toFixed(3)} kg` : '—'} />
                    <Field label="Wt / pc (nano+crgo)" value={weightPerPc ? `${weightPerPc.toFixed(3)} kg` : '—'} accent />
                  </>
                ) : coreType === 'NANO' ? (
                  <>
                    <Field label="Core wt" value={coreWeight ? `${coreWeight.toFixed(3)} kg` : '—'} />
                    <Field label="Case wt" value={caseWeight ? `${caseWeight.toFixed(3)} kg` : '—'} />
                    <Field label="Wt / pc (core + case)" value={weightPerPc ? `${weightPerPc.toFixed(3)} kg` : '—'} accent />
                  </>
                ) : (
                  <Field label="Wt / pc" value={weightPerPc ? `${weightPerPc.toFixed(3)} kg` : '—'} accent />
                )}
                <Field label="Total weight" value={pcs > 0 && weightPerPc > 0 ? `${(pcs * weightPerPc).toFixed(3)} kg` : '—'} accent span2 />
              </div>
            </div>

            {error && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}
            <div className="flex justify-end gap-3 border-t border-slate-200 pt-3">
              <button onClick={onClose} className="btn-ghost text-sm">Cancel</button>
              <button onClick={onSave} disabled={submit.isPending} className="btn-primary text-sm">
                {submit.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <PackagePlus className="h-4 w-4" />} Add Stock
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

/* A numeric dimension input (module-level so it keeps focus while typing). */
const NumInput = ({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) => (
  <label className="block"><span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</span>
    <input className="input" type="number" min={0} step="any" value={value || ''} onChange={(e) => onChange(parseFloat(e.target.value) || 0)} /></label>
);

/* A labelled read-only value in the opening-stock preview card. */
const Field = ({ label, value, accent, span2 }: { label: string; value: string; accent?: boolean; span2?: boolean }) => (
  <div className={cn(span2 && 'col-span-2 sm:col-span-1')}>
    <div className="text-[10px] uppercase tracking-wide text-slate-400">{label}</div>
    <div className={cn('mt-0.5 font-medium tabular-nums', accent ? 'text-brand-700' : 'text-slate-800')}>{value}</div>
  </div>
);

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
