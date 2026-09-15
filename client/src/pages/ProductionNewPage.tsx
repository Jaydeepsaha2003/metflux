// Record new production — a two-step wizard: pick a pending PO item, then
// fill in labour + pcs. Total weight auto-calcs from pcs × wt/pc.
//
// Reskinned to match the user's own colour mockup (dark brand-900 bands,
// Manrope labels, IBM Plex Mono figures, a numbered step header) — see
// components/production/erp.tsx for the shared tokens. All state, validation,
// the excess-production confirmation, and the "stay on page to record the
// next entry" behaviour are unchanged from before; only the layout moved from
// two stacked sections into two wizard steps.
//
// Mirrors the .NET Production form, minus the work_allotment middleware.
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Search, Save, Loader2, Factory, ArrowLeft, CheckCircle2, Check } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { SearchableSelect } from '@/components/SearchableSelect';
import { useConfirm } from '@/hooks/useConfirm';
import { ErpCard, ErpLabel, CoreTypeChip, ErpTh, ProductionTabs } from '@/components/production/erp';

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
  totalAmount: number | null;
  pendingAmount: number | null;
};

const todayISO = () => new Date().toISOString().slice(0, 10);
// dd-mm-yy, spelled out manually rather than via Intl — locale formatting
// options don't reliably guarantee this exact digit order + 2-digit year
// combination across browsers.
const formatDate = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yy = String(d.getFullYear()).slice(-2);
  return `${dd}-${mm}-${yy}`;
};
const pcsFmt = (n: number) => n.toLocaleString('en-IN');
const inr = (n: number) => '₹' + n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const ProductionNewPage = () => {
  const queryClient = useQueryClient();
  const { confirm, confirmDialog } = useConfirm();

  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<PendingItem | null>(null);
  // Step follows selection: picking an item advances to step 2, "Back" or a
  // fresh pick returns to step 1. Kept as its own piece of state (rather than
  // derived purely from `selected`) so "Back" can return to the list without
  // losing which row was highlighted.
  const [step, setStep] = useState<1 | 2>(1);

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

  const pickItem = (it: PendingItem) => {
    setSelected(it);
    setPcs(0);
    setError(null);
    setStep(2);
  };

  const totalWeight = useMemo(
    () => (selected ? +(pcs * selected.weightPerPc).toFixed(3) : 0),
    [pcs, selected]
  );
  // Job amount for THIS entry, prorated from the item's own total the same
  // way the server prorates it once the entry is saved (see production.js's
  // flatten()) — so the figure shown here matches what lands in Modify/Summary.
  const jobAmount = useMemo(
    () => (selected?.totalAmount != null && selected.orderedPcs > 0 && pcs > 0
      ? +(selected.totalAmount * (pcs / selected.orderedPcs)).toFixed(2)
      : null),
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
      setStep(1);
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

  const balanceAfter = selected ? Math.max(selected.remainingPcs - pcs, 0) : 0;
  const isExcess = !!selected && pcs > selected.remainingPcs;

  return (
    <div className="max-w-full space-y-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="flex items-center gap-2 font-manrope text-xl font-extrabold tracking-tight text-slate-900 sm:text-2xl">
          <Factory className="h-5 w-5 text-brand-600" /> Receive Production
        </h1>
        <Link to="/production" className="btn-ghost w-full justify-center text-slate-600 sm:w-auto">
          <ArrowLeft className="h-4 w-4" /> Back to Modify
        </Link>
      </div>

      <ProductionTabs />

      {/* Inline confirmation — non-blocking, auto-hides */}
      {savedAt && (
        <div className="flex items-center gap-2 rounded border border-green-200 bg-green-50 px-4 py-2.5 text-sm text-green-800">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          Production saved. Pick another item to record the next entry.
        </div>
      )}

      <ErpCard>
        {/* Step header */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-3 py-2.5 sm:px-4">
          <div className="flex items-center gap-4">
            <StepBadge n={1} label="Select Order" active={step === 1} done={step > 1} onClick={() => setStep(1)} />
            <div className={cn('h-px w-6 sm:w-10', step > 1 ? 'bg-brand-600' : 'bg-slate-200')} />
            <StepBadge n={2} label="Enter Production" active={step === 2} done={false} disabled={!selected} onClick={() => selected && setStep(2)} />
          </div>
          <span className="hidden text-[11px] text-slate-400 sm:inline">
            {step === 1 ? 'Pick the sales order the pieces were made against.' : selected ? `${selected.poNumber} · ${selected.customerName} · ${selected.remainingPcs} pcs open` : ''}
          </span>
        </div>

        {/* ---- Step 1: select order ---- */}
        {step === 1 && (
          <>
            <div className="p-3">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  className="input h-9 pl-9 text-sm"
                  placeholder="Search PO #, customer, measure, grade, material"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
            </div>

            {/* Mobile — card per pending item */}
            <div className="md:hidden divide-y divide-slate-100 border-t border-slate-100 max-h-[65vh] overflow-y-auto">
              {isLoading && <div className="px-4 py-8 text-center text-slate-400 text-sm">Loading…</div>}
              {!isLoading && pendingResp?.items.length === 0 && (
                <div className="px-4 py-8 text-center text-slate-400 text-sm">
                  No pending items — every open PO is fully produced.
                </div>
              )}
              {pendingResp?.items.map((it) => (
                <button key={it.id} onClick={() => pickItem(it)} className="block w-full px-3 py-2.5 text-left hover:bg-slate-50/60">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="font-semibold text-sm text-slate-900 truncate">{it.customerName}</span>
                        <CoreTypeChip coreType={it.coreType} />
                      </div>
                      <div className="mt-0.5 text-[11px] text-slate-500 font-ibmmono truncate">{it.poNumber} · {it.measure}</div>
                      <div className="mt-1 flex flex-wrap gap-1">
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-700">{it.grade}</span>
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-700">{it.material}</span>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <span className="rounded-md bg-yellow-50 px-2 py-0.5 text-xs font-semibold text-yellow-800 tabular-nums">
                        {it.remainingPcs} open
                      </span>
                      {it.pendingAmount != null && (
                        <div className="mt-0.5 text-[10px] text-brand-700 font-ibmmono tabular-nums">
                          {inr(it.pendingAmount)}
                        </div>
                      )}
                    </div>
                  </div>
                </button>
              ))}
            </div>

            <div className="hidden md:block overflow-x-auto border-t border-slate-100">
              <table className="w-full min-w-[980px] text-[13px]">
                <thead>
                  <tr>
                    <ErpTh className="pl-3">PO #</ErpTh>
                    <ErpTh>Customer</ErpTh>
                    <ErpTh>Due</ErpTh>
                    <ErpTh align="center">Type</ErpTh>
                    <ErpTh>Grade</ErpTh>
                    <ErpTh>Material</ErpTh>
                    <ErpTh>Measure</ErpTh>
                    <ErpTh align="right">Ordered</ErpTh>
                    <ErpTh align="right">Done</ErpTh>
                    <ErpTh align="right">Open</ErpTh>
                    <ErpTh className="w-24"></ErpTh>
                  </tr>
                </thead>
                <tbody>
                  {isLoading && (
                    <tr><td colSpan={11} className="px-3 py-8 text-center text-slate-400">Loading…</td></tr>
                  )}
                  {!isLoading && pendingResp?.items.length === 0 && (
                    <tr><td colSpan={11} className="px-3 py-8 text-center text-slate-400">
                      No pending items — every open PO is fully produced.
                    </td></tr>
                  )}
                  {pendingResp?.items.map((it) => (
                    <tr key={it.id} className="border-t border-slate-100 odd:bg-white even:bg-slate-50/40 hover:bg-brand-50/50">
                      <td className="whitespace-nowrap px-2.5 py-2 pl-3 font-ibmmono text-xs">{it.poNumber}</td>
                      <td className="whitespace-nowrap px-2.5 py-2">{it.customerName}</td>
                      <td className="whitespace-nowrap px-2.5 py-2 text-slate-600 text-xs">{formatDate(it.deliveryDate)}</td>
                      <td className="px-2.5 py-2 text-center"><CoreTypeChip coreType={it.coreType} /></td>
                      <td className="whitespace-nowrap px-2.5 py-2">{it.grade}</td>
                      <td className="whitespace-nowrap px-2.5 py-2">{it.material}</td>
                      <td className="whitespace-nowrap px-2.5 py-2 font-ibmmono text-xs">{it.measure}</td>
                      <td className="px-2.5 py-2 text-right font-ibmmono tabular-nums">{pcsFmt(it.orderedPcs)}</td>
                      <td className="px-2.5 py-2 text-right text-slate-500 font-ibmmono tabular-nums">{pcsFmt(it.producedPcs)}</td>
                      <td className="px-2.5 py-2 text-right">
                        <span className="rounded-md bg-yellow-50 px-2 py-0.5 font-ibmmono font-semibold tabular-nums text-yellow-800">
                          {pcsFmt(it.remainingPcs)}
                        </span>
                      </td>
                      <td className="px-2.5 py-2 text-right">
                        <button
                          onClick={() => pickItem(it)}
                          className="rounded bg-brand-600 px-3 py-1 font-manrope text-[10.5px] font-extrabold uppercase tracking-wide text-white hover:bg-brand-700"
                        >
                          Select
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="border-t border-slate-100 px-3 py-2 text-[11px] text-slate-400 sm:px-4">
              Open = ordered − already produced. A completed order drops off this list once fully produced — record any extra pieces against a fresh order line so the balance stays honest.
            </p>
          </>
        )}

        {/* ---- Step 2: enter production ---- */}
        {/* Capped width even though the card itself is full-bleed: the picker
            table above should fill a wide monitor, but stretching a form's
            text inputs edge-to-edge on the same screen makes them unreadable. */}
        {step === 2 && selected && (
          <div className="mx-auto grid max-w-5xl grid-cols-1 gap-0 lg:grid-cols-[1fr_320px]">
            <div className="space-y-4 p-3 sm:p-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="Production Date">
                  <input className="input h-9 text-sm" type="date" value={prodDate} onChange={(e) => setProdDate(e.target.value)} />
                </Field>
                <Field label="Worker / Labour">
                  <SearchableSelect
                    value={labourName}
                    onChange={setLabourName}
                    options={(laboursResp?.labours ?? []).map((l) => ({ value: l.name, label: l.name }))}
                    placeholder="Select worker…"
                  />
                </Field>
                <Field label="Pieces Made">
                  <input
                    className="input h-9 text-sm"
                    type="number"
                    inputMode="numeric"
                    min={1}
                    value={pcs || ''}
                    onChange={(e) => setPcs(parseInt(e.target.value || '0', 10))}
                  />
                  <div className="mt-1 text-[11px] text-slate-400">
                    {selected.remainingPcs} open of {selected.orderedPcs} ordered
                  </div>
                </Field>
                <Field label="Total Weight">
                  <input className="input h-9 bg-slate-50 text-sm font-ibmmono" value={totalWeight ? totalWeight.toFixed(3) : '—'} readOnly />
                  <div className="mt-1 text-[11px] text-slate-400">Computed, not entered — weight per piece is fixed by the order specification.</div>
                </Field>
              </div>

              <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2.5">
                <ErpLabel>Job Amount (weight × rate)</ErpLabel>
                <div className="mt-0.5 font-ibmmono text-lg font-bold tabular-nums text-brand-700">
                  {jobAmount != null ? inr(jobAmount) : '—'}
                </div>
                <div className="mt-0.5 text-[11px] text-slate-400">At the rate posted on the work allotment, credited to the worker you pick.</div>
              </div>

              <div className="rounded border px-3 py-2.5 text-sm" style={{ borderColor: isExcess ? '#fcd34d' : '#e2e8f0', backgroundColor: isExcess ? '#fffbeb' : '#fff' }}>
                <ErpLabel>Order Balance After Saving</ErpLabel>
                <div className={cn('mt-0.5 font-ibmmono text-lg font-bold tabular-nums', isExcess ? 'text-amber-700' : 'text-slate-900')}>
                  {isExcess ? `${pcs - selected.remainingPcs} pcs over` : `${balanceAfter} pcs`}
                </div>
                <div className="mt-0.5 text-[11px] text-slate-500">
                  {pcs <= 0
                    ? 'Nothing entered yet, so the order is untouched.'
                    : isExcess
                      ? `This exceeds the order by ${pcs - selected.remainingPcs} pcs — you'll be asked to confirm before saving.`
                      : `${selected.producedPcs + pcs} of ${selected.orderedPcs} pcs produced — ${Math.round(((selected.producedPcs + pcs) / selected.orderedPcs) * 100)}% of the order.`}
                </div>
              </div>

              {error && (
                <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  <div className="font-medium">{error.message}</div>
                  {error.details && (
                    <ul className="mt-1 list-disc pl-5 text-xs">
                      {error.details.map((d, i) => <li key={i}>{d}</li>)}
                    </ul>
                  )}
                </div>
              )}

              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between sm:gap-3">
                <button onClick={() => setStep(1)} className="btn-ghost w-full sm:w-auto justify-center">Back</button>
                <button onClick={onSave} disabled={submit.isPending} className="btn-primary w-full sm:w-auto justify-center">
                  {submit.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  Save production
                </button>
              </div>
            </div>

            {/* Selected order summary — read-only reference while filling the form. */}
            <div className="space-y-3 border-t border-slate-100 bg-slate-50/70 p-3 sm:p-4 lg:border-l lg:border-t-0">
              <ErpLabel>Selected Order</ErpLabel>
              <dl className="grid grid-cols-2 gap-x-3 gap-y-2.5 text-sm">
                <SummaryField label="Sales Order" value={selected.poNumber} mono />
                <SummaryField label="Due" value={formatDate(selected.deliveryDate)} />
                <SummaryField label="Customer" value={selected.customerName} className="col-span-2" />
                <SummaryField label="Core" value={`${selected.coreType === 'TOROIDAL' ? 'Toroidal' : 'Rectangular'} · ${selected.grade}`} className="col-span-2" />
                <SummaryField label="Measure" value={selected.measure} mono className="col-span-2" />
                <SummaryField label="Weight / Pc" value={`${selected.weightPerPc.toFixed(3)} kg`} mono />
                <SummaryField label="Ordered" value={pcsFmt(selected.orderedPcs)} mono />
                <SummaryField label="Already Done" value={pcsFmt(selected.producedPcs)} mono />
              </dl>
            </div>
          </div>
        )}
      </ErpCard>
      {confirmDialog}
    </div>
  );
};

const StepBadge = ({ n, label, active, done, disabled, onClick }: {
  n: number; label: string; active: boolean; done: boolean; disabled?: boolean; onClick: () => void;
}) => (
  <button
    onClick={onClick}
    disabled={disabled}
    className={cn('flex items-center gap-1.5 font-manrope text-[11px] font-extrabold uppercase tracking-wide disabled:cursor-not-allowed disabled:opacity-40',
      active ? 'text-brand-800' : done ? 'text-slate-500' : 'text-slate-400')}
  >
    <span className={cn('flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px]',
      active ? 'bg-brand-600 text-white' : done ? 'bg-brand-100 text-brand-700' : 'bg-slate-100 text-slate-400')}>
      {done ? <Check className="h-3 w-3" /> : n}
    </span>
    {label}
  </button>
);

const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <label className="block">
    <ErpLabel className="mb-1 block">{label}</ErpLabel>
    {children}
  </label>
);

const SummaryField = ({ label, value, mono, className }: { label: string; value: string; mono?: boolean; className?: string }) => (
  <div className={className}>
    <ErpLabel className="block">{label}</ErpLabel>
    <div className={cn('mt-0.5 truncate text-slate-900', mono ? 'font-ibmmono text-[13px] font-semibold' : 'text-sm font-medium')}>{value}</div>
  </div>
);
