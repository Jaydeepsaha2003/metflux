// Record new production — pick a pending PO item from the list, then fill in
// labour + pcs in the form below. Total weight auto-calcs from pcs × wt/pc.
//
// Mirrors the .NET Production form, minus the work_allotment middleware.
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Search, Save, Loader2, Factory, ArrowLeft, CheckCircle2 } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { SearchableSelect } from '@/components/SearchableSelect';
import { useConfirm } from '@/hooks/useConfirm';

type PendingItem = {
  id: string;
  poNumber: string;
  customerName: string;
  orderDate: string;
  deliveryDate: string;
  coreType: 'TOROIDAL' | 'RECTANGULAR';
  grade: string;
  material: string;
  measure: string;
  weightPerPc: number;
  orderedPcs: number;
  producedPcs: number;
  remainingPcs: number;
  pendingAmount: number | null;
};

const todayISO = () => new Date().toISOString().slice(0, 10);
const formatDate = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
};

export const ProductionNewPage = () => {
  const queryClient = useQueryClient();
  const { confirm, confirmDialog } = useConfirm();

  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<PendingItem | null>(null);

  const { data: pendingResp, isLoading } = useQuery({
    queryKey: ['production-pending', search],
    queryFn: () => api<{ items: PendingItem[] }>(`/production/pending?search=${encodeURIComponent(search)}`),
    staleTime: 0,
  });

  const { data: laboursResp } = useQuery({
    queryKey: ['labours-dropdown'],
    queryFn: () => api<{ labours: { id: string; name: string }[] }>('/labours/dropdown'),
  });

  /* ----- form state ----- */
  const [prodDate, setProdDate] = useState(todayISO());
  const [labourName, setLabourName] = useState('');
  const [pcs, setPcs] = useState(0);
  const [error, setError] = useState<{ message: string; details?: string[] } | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  // Auto-hide the success banner after 4 s.
  useEffect(() => {
    if (!savedAt) return;
    const t = setTimeout(() => setSavedAt(null), 4000);
    return () => clearTimeout(t);
  }, [savedAt]);

  // When the user picks a different item, reset transient form fields.
  useEffect(() => {
    setPcs(0);
    setError(null);
  }, [selected?.id]);

  const totalWeight = useMemo(
    () => (selected ? +(pcs * selected.weightPerPc).toFixed(3) : 0),
    [pcs, selected]
  );

  const submit = useMutation({
    mutationFn: (body: unknown) => api('/production', { method: 'POST', json: body }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['production'] });
      queryClient.invalidateQueries({ queryKey: ['production-pending'] });
      queryClient.invalidateQueries({ queryKey: ['labours-dropdown'] });
      // Stay on the page so the user can record back-to-back entries, but
      // clear the per-entry fields including the worker so each entry is a
      // fresh choice (prevents accidentally crediting work to the wrong person).
      setSelected(null);
      setPcs(0);
      setLabourName('');
      setError(null);
      setSavedAt(Date.now());
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

  const onSave = async () => {
    setError(null);
    if (!selected) {
      setError({ message: 'Pick a pending PO item from the list first' });
      return;
    }
    const missing: string[] = [];
    if (!labourName.trim()) missing.push('Labour name');
    if (pcs <= 0) missing.push('Pcs > 0');
    if (missing.length) {
      setError({ message: 'Please fix the form', details: missing });
      return;
    }

    if (pcs > selected.remainingPcs) {
      const excessPcs = pcs - selected.remainingPcs;
      const ok = await confirm({
        title: 'Excess Production',
        tone: 'warning',
        confirmLabel: 'Yes, Record Excess',
        cancelLabel: 'Go Back',
        message: (
          <div className="space-y-2 text-sm">
            <p>
              You are recording <strong>{pcs} pcs</strong> but only{' '}
              <strong>{selected.remainingPcs} pcs</strong> remain on this PO
              (ordered: {selected.orderedPcs}).
            </p>
            <p>
              This will produce <strong>{excessPcs} extra pcs</strong> beyond the order. The
              full {pcs} pcs will be available for dispatch.
            </p>
            <p className="text-slate-500">Are you sure you want to proceed?</p>
          </div>
        ),
      });
      if (!ok) return;
    }

    submit.mutate({
      poOrderItemId: selected.id,
      prodDate,
      pcs,
      weightPerPc: selected.weightPerPc,
      totalWeight,
      labourName: labourName.trim(),
    });
  };

  return (
    <div className="space-y-4 max-w-[1400px]">
      <div className="flex items-center gap-3">
        <Link to="/production" className="btn-ghost text-slate-600">
          <ArrowLeft className="h-4 w-4" /> Back
        </Link>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Factory className="h-5 w-5 text-brand-600" /> Record Production
        </h1>
      </div>

      {/* Inline confirmation — non-blocking, auto-hides */}
      {savedAt && (
        <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-2.5 text-sm text-green-800 flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4" />
          Production saved. Pick another item to record the next entry.
        </div>
      )}

      {/* ---- pending items ---- */}
      <section className="card overflow-hidden">
        <div className="flex flex-col gap-2 border-b border-slate-200 px-3 py-3 sm:flex-row sm:items-center sm:gap-3 sm:px-4">
          <h2 className="text-sm font-semibold text-slate-900">1. Pick a pending PO item</h2>
          <div className="relative w-full sm:ml-auto sm:max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              className="input pl-9"
              placeholder="Search PO#, customer, measure, grade, material"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>

        {/* Mobile — card per pending item */}
        <div className="md:hidden divide-y divide-slate-100 max-h-[60vh] overflow-y-auto">
          {isLoading && <div className="px-4 py-8 text-center text-slate-400 text-sm">Loading…</div>}
          {!isLoading && pendingResp?.items.length === 0 && (
            <div className="px-4 py-8 text-center text-slate-400 text-sm">
              No pending items — every PO is fully produced 🎉
            </div>
          )}
          {pendingResp?.items.map((it) => {
            const isSelected = selected?.id === it.id;
            return (
              <div
                key={it.id}
                onClick={() => setSelected(it)}
                className={cn(
                  'cursor-pointer px-3 py-2.5 transition-colors',
                  isSelected ? 'bg-brand-50' : 'hover:bg-slate-50/60'
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="font-semibold text-sm text-slate-900 truncate">{it.customerName}</span>
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
                    <span className="rounded-md bg-yellow-50 px-2 py-0.5 text-xs font-semibold text-yellow-800 tabular-nums">
                      {it.remainingPcs} left
                    </span>
                    {it.pendingAmount != null && (
                      <div className="mt-0.5 text-[10px] text-brand-700 font-mono tabular-nums">
                        ₹{it.pendingAmount.toFixed(2)}
                      </div>
                    )}
                    {isSelected && <CheckCircle2 className="ml-auto mt-1 h-4 w-4 text-brand-600" />}
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
                <th className="px-3 py-2 font-medium w-8"></th>
                <th className="px-3 py-2 font-medium">PO #</th>
                <th className="px-3 py-2 font-medium">Customer</th>
                <th className="px-3 py-2 font-medium">Due</th>
                <th className="px-3 py-2 font-medium">Type</th>
                <th className="px-3 py-2 font-medium">Grade</th>
                <th className="px-3 py-2 font-medium">Material</th>
                <th className="px-3 py-2 font-medium">Measure</th>
                <th className="px-3 py-2 font-medium text-right">Ordered</th>
                <th className="px-3 py-2 font-medium text-right">Done</th>
                <th className="px-3 py-2 font-medium text-right">Pending</th>
                <th className="px-3 py-2 font-medium text-right">Pending Amt</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr><td colSpan={12} className="px-3 py-8 text-center text-slate-400">Loading…</td></tr>
              )}
              {!isLoading && pendingResp?.items.length === 0 && (
                <tr><td colSpan={12} className="px-3 py-8 text-center text-slate-400">
                  No pending items — every PO is fully produced 🎉
                </td></tr>
              )}
              {pendingResp?.items.map((it) => {
                const isSelected = selected?.id === it.id;
                return (
                  <tr
                    key={it.id}
                    onClick={() => setSelected(it)}
                    className={cn(
                      'cursor-pointer border-t border-slate-100 transition',
                      isSelected ? 'bg-brand-50 hover:bg-brand-100' : 'hover:bg-slate-50/60'
                    )}
                  >
                    <td className="px-3 py-2">
                      {isSelected && <CheckCircle2 className="h-4 w-4 text-brand-600" />}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">{it.poNumber}</td>
                    <td className="px-3 py-2">{it.customerName}</td>
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
                    <td className="px-3 py-2 text-right text-slate-500 tabular-nums">{it.producedPcs}</td>
                    <td className="px-3 py-2 text-right font-semibold tabular-nums">
                      <span className="rounded-md bg-yellow-50 px-2 py-0.5 text-yellow-800">
                        {it.remainingPcs}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums text-brand-700">
                      {it.pendingAmount != null ? `₹${it.pendingAmount.toFixed(2)}` : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* ---- form ---- */}
      <section className="card p-4 space-y-4">
        <h2 className="text-sm font-semibold text-slate-900">2. Production details</h2>

        {!selected && (
          <div className="rounded-lg border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
            Click a row above to select a PO item.
          </div>
        )}

        {selected && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 rounded-lg bg-slate-50 p-3 text-sm sm:grid-cols-4">
              <Stat label="PO #" value={selected.poNumber} />
              <Stat label="Customer" value={selected.customerName} />
              <Stat label="Grade · Material" value={`${selected.grade} · ${selected.material}`} />
              <Stat label="Measure" value={selected.measure} mono />
              <Stat label="Wt / pc" value={selected.weightPerPc.toFixed(3)} mono />
              <Stat label="Ordered" value={String(selected.orderedPcs)} />
              <Stat label="Already Done" value={String(selected.producedPcs)} />
              <Stat label="Remaining" value={String(selected.remainingPcs)} accent="primary" />
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Field label="Production Date">
                <input className="input" type="date" value={prodDate} onChange={(e) => setProdDate(e.target.value)} />
              </Field>
              <Field label="Worker / Labour">
                <SearchableSelect
                  value={labourName}
                  onChange={setLabourName}
                  options={(laboursResp?.labours ?? []).map((l) => ({ value: l.name, label: l.name }))}
                  placeholder="Select worker…"
                />
              </Field>
              <Field label={`Pcs (${selected.remainingPcs} remaining)`}>
                <input
                  className="input"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  value={pcs || ''}
                  onChange={(e) => setPcs(parseInt(e.target.value || '0', 10))}
                />
              </Field>
              <Field label="Total Weight">
                <input className="input bg-slate-50" value={totalWeight ? totalWeight.toFixed(3) : ''} readOnly />
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
              <Link to="/production" className="btn-ghost w-full sm:w-auto text-center justify-center">Cancel</Link>
              <button onClick={onSave} disabled={submit.isPending} className="btn-primary w-full sm:w-auto justify-center">
                {submit.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Save production
              </button>
            </div>
          </div>
        )}
      </section>
      {confirmDialog}
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
