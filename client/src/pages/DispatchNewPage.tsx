// Create a dispatch record: pick a ready-to-dispatch PO item from the list,
// fill in dispatch date, vehicle number and pcs. Total weight auto-calcs.
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Search, Loader2, Truck, ArrowLeft, CheckCircle2, FileText, Download, Warehouse, X } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { downloadXlsx, todayStamp } from '@/lib/excel';
import { useHideCustomerNames } from '@/store/auth';

type ReadyItem = {
  id: string;
  poNumber: string;
  customerName: string;
  customerCode: string | null;
  deliveryDate: string;
  coreType: 'TOROIDAL' | 'RECTANGULAR';
  grade: string;
  material: string;
  measure: string;
  weightPerPc: number;
  orderedPcs: number;
  producedPcs: number;
  dispatchedPcs: number;
  readyPcs: number;
  excessPcs: number;
  readyAmount: number | null;
};

const todayISO = () => new Date().toISOString().slice(0, 10);
const formatDate = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
};

export const DispatchNewPage = () => {
  const queryClient = useQueryClient();
  const hideNames = useHideCustomerNames();

  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<ReadyItem | null>(null);
  const [sendStore, setSendStore] = useState<ReadyItem | null>(null);

  const { data: readyResp, isLoading } = useQuery({
    queryKey: ['dispatch-ready', search],
    queryFn: () => api<{ items: ReadyItem[] }>(`/dispatch/ready?search=${encodeURIComponent(search)}`),
    staleTime: 0,
  });

  /* Export the ready-to-dispatch list as an Excel checklist. */
  const onExport = () => {
    const items = readyResp?.items ?? [];
    if (!items.length) return;
    const rows = items.map((it) => ({
      'PO #':              it.poNumber,
      'Customer Code':     it.customerCode ?? '',
      ...(hideNames ? {} : { 'Customer': it.customerName }),
      'Delivery Date':     formatDate(it.deliveryDate),
      'Type':              it.coreType,
      'Grade':             it.grade,
      'Material':          it.material,
      'Measure':           it.measure,
      'Wt / pc':           it.weightPerPc,
      'Ordered':           it.orderedPcs,
      'Produced':          it.producedPcs,
      'Already Dispatched': it.dispatchedPcs,
      'Ready to Dispatch': it.readyPcs,
      'Ready Wt (kg)':     +(it.readyPcs * it.weightPerPc).toFixed(3),
      'Ready Amount (₹)':  it.readyAmount,
    }));
    downloadXlsx(`ready-to-dispatch-${todayStamp()}`, 'Ready to Dispatch', rows);
  };

  const [dispatchDate, setDispatchDate] = useState(todayISO());
  const [vehicleNo, setVehicleNo] = useState('');
  const [pcs, setPcs] = useState(0);
  const [boxes, setBoxes] = useState(0);
  const [actualWeight, setActualWeight] = useState(0);
  const [error, setError] = useState<{ message: string; details?: string[] } | null>(null);
  const [createdId, setCreatedId] = useState<string | null>(null);

  useEffect(() => {
    setPcs(0);
    setActualWeight(0);
    setError(null);
    // Clear the last-saved banner when the user starts a new entry — keeping
    // it around while typing the next dispatch is more confusing than helpful.
    if (selected) setCreatedId(null);
  }, [selected?.id]);

  const totalWeight = useMemo(
    () => (selected ? +(pcs * selected.weightPerPc).toFixed(3) : 0),
    [pcs, selected]
  );

  const submit = useMutation({
    mutationFn: (body: unknown) => api<{ id: string }>('/dispatch', { method: 'POST', json: body }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['dispatch'] });
      queryClient.invalidateQueries({ queryKey: ['dispatch-ready'] });
      setCreatedId(data.id);
      // Auto-reset form fields so the user can immediately enter the next
      // dispatch. Keep dispatchDate — same date is usually right for a batch.
      setSelected(null);
      setPcs(0);
      setVehicleNo('');
      setActualWeight(0);
      setError(null);
    },
    onError: (e) => {
      if (e instanceof ApiError) {
        const d = (e.details ?? {}) as { fieldErrors?: Record<string, string[]>; formErrors?: string[] };
        const lines: string[] = [];
        for (const [field, msgs] of Object.entries(d.fieldErrors ?? {})) {
          for (const m of msgs ?? []) lines.push(`${field}: ${m}`);
        }
        for (const m of d.formErrors ?? []) lines.push(m);
        setError({ message: e.message, details: lines.length ? lines : undefined });
      } else {
        setError({ message: 'Save failed' });
      }
    },
  });

  const onSave = () => {
    setError(null);
    if (!selected) {
      setError({ message: 'Select a ready item from the list first' });
      return;
    }
    const missing: string[] = [];
    if (pcs <= 0) missing.push('Pcs must be > 0');
    if (pcs > selected.readyPcs) missing.push(`Pcs ≤ ready to dispatch (${selected.readyPcs})`);
    if (missing.length) {
      setError({ message: 'Please fix the form', details: missing });
      return;
    }
    submit.mutate({
      poOrderItemId: selected.id,
      dispatchDate,
      pcs,
      weightPerPc: selected.weightPerPc,
      totalWeight,
      boxes: boxes > 0 ? boxes : null,
      actualWeight: actualWeight > 0 ? actualWeight : null,
      vehicleNo: vehicleNo.trim() || null,
    });
  };

  return (
    <div className="space-y-4 max-w-[1400px]">
      <div className="flex items-center gap-3">
        <Link to="/dispatch" className="btn-ghost text-slate-600">
          <ArrowLeft className="h-4 w-4" /> Back
        </Link>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Truck className="h-5 w-5 text-brand-600" /> New Dispatch
        </h1>
      </div>

      {/* Ready-to-dispatch items */}
      <section className="card overflow-hidden">
        <div className="flex flex-col gap-2 border-b border-slate-200 px-3 py-3 sm:flex-row sm:items-center sm:gap-3 sm:px-4">
          <h2 className="text-sm font-semibold text-slate-900">1. Pick a ready item</h2>
          <div className="flex items-center gap-2 w-full sm:ml-auto sm:w-auto">
            <div className="relative flex-1 sm:w-80">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                className="input pl-9"
                placeholder="Search PO#, customer, measure, grade, material"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <button
              type="button"
              onClick={onExport}
              disabled={isLoading || !readyResp?.items.length}
              className="btn-ghost shrink-0 text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
              title="Download ready list as Excel"
            >
              <Download className="h-4 w-4" />
              <span className="hidden sm:inline">Excel</span>
            </button>
          </div>
        </div>

        {/* Mobile — card per ready item */}
        <div className="md:hidden divide-y divide-slate-100 max-h-[60vh] overflow-y-auto">
          {isLoading && <div className="px-4 py-8 text-center text-slate-400 text-sm">Loading…</div>}
          {!isLoading && readyResp?.items.length === 0 && (
            <div className="px-4 py-8 text-center text-slate-400 text-sm">
              No items ready to dispatch — produce some stock first.
            </div>
          )}
          {readyResp?.items.map((it) => {
            const isSel = selected?.id === it.id;
            return (
              <div
                key={it.id}
                onClick={() => setSelected(it)}
                className={cn('cursor-pointer px-3 py-2.5 transition-colors', isSel ? 'bg-brand-50' : 'hover:bg-slate-50/60')}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono text-xs font-semibold text-brand-700">{it.customerCode ?? '—'}</span>
                      {!hideNames && (
                        <span className="font-semibold text-sm text-slate-900 truncate">· {it.customerName}</span>
                      )}
                      <span className={cn(
                        'rounded-full px-1.5 py-0.5 text-[10px] font-medium shrink-0',
                        it.coreType === 'TOROIDAL' ? 'bg-amber-50 text-amber-700' : 'bg-rose-50 text-rose-700'
                      )}>
                        {it.coreType === 'TOROIDAL' ? 'Toro' : 'Rect'}
                      </span>
                    </div>
                    <div className="mt-0.5 text-[11px] text-slate-500 font-mono truncate">{it.poNumber} · {it.measure}</div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-700">{it.grade}</span>
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-700">{it.material}</span>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="flex flex-col items-end gap-0.5">
                      <span className="rounded-md bg-green-50 px-2 py-0.5 text-xs font-semibold text-green-800 tabular-nums">
                        {it.readyPcs} ready
                      </span>
                      {it.excessPcs > 0 && (
                        <span className="rounded-md bg-orange-50 px-2 py-0.5 text-[10px] font-semibold text-orange-700 tabular-nums">
                          +{it.excessPcs} excess
                        </span>
                      )}
                    </div>
                    {it.readyAmount != null && (
                      <div className="mt-0.5 text-[10px] text-brand-700 font-mono tabular-nums">
                        ₹{it.readyAmount.toFixed(2)}
                      </div>
                    )}
                    {isSel && <CheckCircle2 className="ml-auto mt-1 h-4 w-4 text-brand-600" />}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="hidden md:block overflow-x-auto max-h-72">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2 w-8"></th>
                <th className="px-3 py-2">PO #</th>
                <th className="px-3 py-2">Customer</th>
                <th className="px-3 py-2">Due</th>
                <th className="px-3 py-2">Type</th>
                <th className="px-3 py-2">Grade</th>
                <th className="px-3 py-2">Material</th>
                <th className="px-3 py-2">Measure</th>
                <th className="px-3 py-2 text-right">Ordered</th>
                <th className="px-3 py-2 text-right">Produced</th>
                <th className="px-3 py-2 text-right">Dispatched</th>
                <th className="px-3 py-2 text-right">Ready</th>
                <th className="px-3 py-2 text-right">Ready Amt</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr><td colSpan={13} className="px-3 py-8 text-center text-slate-400">Loading…</td></tr>
              )}
              {!isLoading && readyResp?.items.length === 0 && (
                <tr><td colSpan={13} className="px-3 py-8 text-center text-slate-400">
                  No items ready to dispatch — produce some stock first.
                </td></tr>
              )}
              {readyResp?.items.map((it) => {
                const isSel = selected?.id === it.id;
                return (
                  <tr
                    key={it.id}
                    onClick={() => setSelected(it)}
                    className={cn(
                      'cursor-pointer border-t border-slate-100 transition',
                      isSel ? 'bg-brand-50 hover:bg-brand-100' : 'hover:bg-slate-50/60'
                    )}
                  >
                    <td className="px-3 py-2">
                      {isSel && <CheckCircle2 className="h-4 w-4 text-brand-600" />}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">{it.poNumber}</td>
                    <td className="px-3 py-2">
                      <div className="font-mono text-xs font-semibold text-brand-700">{it.customerCode ?? '—'}</div>
                      {!hideNames && (
                        <div className="text-[11px] text-slate-500 truncate max-w-[160px]" title={it.customerName}>
                          {it.customerName}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-slate-600 text-xs">{formatDate(it.deliveryDate)}</td>
                    <td className="px-3 py-2">
                      <span className={cn(
                        'rounded-full px-2 py-0.5 text-[11px] font-medium',
                        it.coreType === 'TOROIDAL' ? 'bg-amber-50 text-amber-700' : 'bg-rose-50 text-rose-700'
                      )}>
                        {it.coreType === 'TOROIDAL' ? 'Toro' : 'Rect'}
                      </span>
                    </td>
                    <td className="px-3 py-2">{it.grade}</td>
                    <td className="px-3 py-2">{it.material}</td>
                    <td className="px-3 py-2 font-mono text-xs">{it.measure}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{it.orderedPcs}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-600">{it.producedPcs}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-500">{it.dispatchedPcs}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      <div className="flex flex-col items-end gap-0.5">
                        <span className="rounded-md bg-green-50 px-2 py-0.5 font-semibold text-green-800">
                          {it.readyPcs}
                        </span>
                        {it.excessPcs > 0 && (
                          <span className="rounded-md bg-orange-50 px-1.5 py-0.5 text-[10px] font-semibold text-orange-700">
                            +{it.excessPcs} excess
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums text-brand-700">
                      {it.readyAmount != null ? `₹${it.readyAmount.toFixed(2)}` : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* Last-saved confirmation. Lives outside the `{selected && ...}` block so it
          stays visible after the form auto-resets on successful save. */}
      {createdId && (
        <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm font-medium text-green-800">
            ✓ Dispatch saved — form is ready for the next entry.
          </span>
          <div className="flex flex-wrap gap-2">
            <Link to="/packing-list" state={{ dispatchIds: [createdId] }} className="btn-ghost text-sm border border-slate-300">
              <FileText className="h-4 w-4" /> Create Packing List
            </Link>
            <Link to="/dispatch" className="btn-ghost text-sm">View All</Link>
            <button onClick={() => setCreatedId(null)} className="btn-ghost text-sm text-slate-500" title="Dismiss">
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* Dispatch form */}
      <section className="card p-4 space-y-4">
        <h2 className="text-sm font-semibold text-slate-900">2. Dispatch details</h2>

        {!selected && (
          <div className="rounded-lg border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
            Click a row above to select an item.
          </div>
        )}

        {selected && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 rounded-lg bg-slate-50 p-3 text-sm sm:grid-cols-4">
              <Stat label="PO #" value={selected.poNumber} />
              <Stat
                label="Customer"
                value={hideNames
                  ? (selected.customerCode ?? '—')
                  : `${selected.customerCode ?? '—'} · ${selected.customerName}`}
              />
              <Stat label="Grade · Material" value={`${selected.grade} · ${selected.material}`} />
              <Stat label="Measure" value={selected.measure} mono />
              <Stat label="Wt / pc" value={selected.weightPerPc.toFixed(3)} mono />
              <Stat label="Produced" value={String(selected.producedPcs)} />
              <Stat label="Already Dispatched" value={String(selected.dispatchedPcs)} />
              <Stat label="Ready to Dispatch" value={String(selected.readyPcs)} accent="primary" />
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <Field label="Dispatch Date">
                <input className="input" type="date" value={dispatchDate} onChange={(e) => setDispatchDate(e.target.value)} />
              </Field>
              <Field label="Vehicle No.">
                <input className="input" value={vehicleNo} onChange={(e) => setVehicleNo(e.target.value)} placeholder="Optional" />
              </Field>
              <Field label={`Pcs (max ${selected.readyPcs})`}>
                <input
                  className="input" type="number" inputMode="numeric"
                  min={1} max={selected.readyPcs}
                  value={pcs || ''}
                  onChange={(e) => setPcs(parseInt(e.target.value || '0', 10))}
                />
              </Field>
              <Field label="Total Weight">
                <input className="input bg-slate-50" value={totalWeight ? totalWeight.toFixed(3) : ''} readOnly />
              </Field>
              <Field label="No. of Boxes">
                <input
                  className="input" type="number" inputMode="numeric" min={0}
                  value={boxes || ''}
                  onChange={(e) => setBoxes(parseInt(e.target.value || '0', 10) || 0)}
                  placeholder="Optional"
                />
              </Field>
              <Field label="Actual Weight">
                <input
                  className="input" type="number" inputMode="decimal" step="any" min={0}
                  value={actualWeight || ''}
                  onChange={(e) => setActualWeight(parseFloat(e.target.value) || 0)}
                  placeholder={totalWeight ? totalWeight.toFixed(3) : 'Weighbridge reading'}
                />
              </Field>
            </div>

            {error && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                <div className="font-medium">{error.message}</div>
                {error.details && (
                  <ul className="mt-1 list-disc pl-5 text-xs">
                    {error.details.map((d, i) => <li key={i}>{d}</li>)}
                  </ul>
                )}
              </div>
            )}

            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end sm:gap-3">
              <Link to="/dispatch" className="btn-ghost w-full sm:w-auto justify-center">Cancel</Link>
              <button
                onClick={() => setSendStore(selected)}
                className="btn-ghost border border-slate-300 text-indigo-700 hover:bg-indigo-50 w-full sm:w-auto justify-center"
                title="Send these pcs into a store instead of to the customer"
              >
                <Warehouse className="h-4 w-4" /> Send to Store
              </button>
              <button onClick={onSave} disabled={submit.isPending} className="btn-primary w-full sm:w-auto justify-center">
                {submit.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Truck className="h-4 w-4" />}
                Dispatch
              </button>
            </div>
          </div>
        )}
      </section>

      {sendStore && (
        <StockInModal
          item={sendStore}
          onClose={() => setSendStore(null)}
          onDone={() => {
            queryClient.invalidateQueries({ queryKey: ['dispatch-ready'] });
            queryClient.invalidateQueries({ queryKey: ['warehouse-stock'] });
            setSelected(null);
          }}
        />
      )}
    </div>
  );
};

/* ── Send-to-store modal ── */
type Store = { id: string; name: string; isActive: boolean };
const StockInModal = ({ item, onClose, onDone }: { item: ReadyItem; onClose: () => void; onDone: () => void }) => {
  const [warehouseId, setWarehouseId] = useState('');
  const [pcs, setPcs] = useState(item.readyPcs);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const { data: stores, isLoading } = useQuery({ queryKey: ['warehouses'], queryFn: () => api<{ items: Store[] }>('/warehouses') });
  const active = (stores?.items ?? []).filter((s) => s.isActive);

  const submit = useMutation({
    mutationFn: () => api('/warehouses/stock-in', { method: 'POST', json: { warehouseId, poOrderItemId: item.id, pcs } }),
    onSuccess: () => { setDone(true); onDone(); },
    onError: (e) => setError(e instanceof Error ? e.message : 'Could not send to store'),
  });

  const onSave = () => {
    setError(null);
    if (!warehouseId) return setError('Pick a store');
    if (pcs <= 0) return setError('Pcs must be greater than 0');
    if (pcs > item.readyPcs) return setError(`Pcs ≤ ready (${item.readyPcs})`);
    submit.mutate();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="w-full max-w-md rounded-xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <h2 className="text-sm font-semibold text-slate-900 flex items-center gap-2"><Warehouse className="h-4 w-4 text-indigo-600" /> Send to Store</h2>
          <button onClick={onClose} className="rounded p-1 text-slate-400 hover:bg-slate-100"><X className="h-4 w-4" /></button>
        </div>
        {done ? (
          <div className="px-5 py-6 space-y-3">
            <div className="flex items-center gap-2 text-emerald-700 text-sm font-medium"><CheckCircle2 className="h-5 w-5" /> {pcs} pcs moved into store.</div>
            <div className="flex gap-2">
              <Link to="/dispatch/warehouse" className="btn-primary text-sm"><Warehouse className="h-4 w-4" /> View Store</Link>
              <button onClick={onClose} className="btn-ghost text-sm border border-slate-300">Done</button>
            </div>
          </div>
        ) : (
          <div className="px-5 py-4 space-y-4">
            <div className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
              {item.coreType === 'TOROIDAL' ? 'Toro' : 'Rect'} · {item.grade} · {item.measure} · ready <strong className="text-slate-900">{item.readyPcs}</strong>
              {item.excessPcs > 0 && <span className="ml-1 text-orange-700">(+{item.excessPcs} excess)</span>}
            </div>
            <label className="block">
              <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-slate-500">Store</span>
              {isLoading ? <div className="text-sm text-slate-400 py-2">Loading…</div> : !active.length ? (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  No store yet — add one on the <Link to="/dispatch/warehouse" className="underline">Store / Warehouse</Link> page.
                </div>
              ) : (
                <select className="input" value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
                  <option value="">Select store…</option>
                  {active.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              )}
            </label>
            <label className="block w-40">
              <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-slate-500">Pcs (max {item.readyPcs})</span>
              <input className="input" type="number" min={1} max={item.readyPcs} value={pcs || ''} onChange={(e) => setPcs(parseInt(e.target.value || '0', 10))} />
            </label>
            {error && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}
            <div className="flex justify-end gap-3 border-t border-slate-200 pt-3">
              <button onClick={onClose} className="btn-ghost text-sm">Cancel</button>
              <button onClick={onSave} disabled={submit.isPending || !active.length} className="btn-primary text-sm">
                {submit.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Warehouse className="h-4 w-4" />} Send to Store
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <label className="block">
    <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</span>
    {children}
  </label>
);

const Stat = ({
  label, value, mono, accent,
}: { label: string; value: string; mono?: boolean; accent?: 'primary' }) => (
  <div className="min-w-0">
    <div className="text-[10px] font-medium uppercase tracking-wide text-slate-500">{label}</div>
    <div className={cn(
      'truncate text-sm tabular-nums',
      mono && 'font-mono',
      accent === 'primary' ? 'font-semibold text-slate-900' : 'text-slate-700'
    )}>
      {value}
    </div>
  </div>
);
