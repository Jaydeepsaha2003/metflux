// Record new production — a two-step wizard: pick a pending PO item, then
// fill in labour + pcs. Total weight auto-calcs from pcs × wt/pc.
//
// Reskinned to match the user's own colour mockup (dark brand-900 bands,
// Inter throughout, tabular figures, a numbered step header) — see
// components/production/erp.tsx for the shared tokens. All state, validation,
// the excess-production confirmation, and the "stay on page to record the
// next entry" behaviour are unchanged from before; only the layout moved from
// two stacked sections into two wizard steps.
//
// Mirrors the .NET Production form, minus the work_allotment middleware.
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Search, Save, Loader2, Factory, ArrowLeft, CheckCircle2, Check } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useDebounced } from '@/hooks/useDebounced';
import { cn } from '@/lib/cn';
import { toroidalCalc, rectangularCalc } from '@/lib/calc';
import { SearchableSelect } from '@/components/SearchableSelect';
import { useConfirm } from '@/hooks/useConfirm';
import { ErpCard, ErpLabel, CoreTypeChip, SplitHeightChip, ErpTh, ProductionTabs } from '@/components/production/erp';

type SplitPile = { splitHeight: number; pcs: number; matched: number; unmatched: number };

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
  id1: number | null;
  id2: number | null;
  od1: number | null;
  od2: number | null;
  ht: number | null;
  weightPerPc: number;
  orderedPcs: number;
  producedPcs: number;
  remainingPcs: number;
  totalAmount: number | null;
  pendingAmount: number | null;
  splitInfo: SplitPile[];
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
  const debouncedSearch = useDebounced(search);
  const [selected, setSelected] = useState<PendingItem | null>(null);
  // Step follows selection: picking an item advances to step 2, "Back" or a
  // fresh pick returns to step 1. Kept as its own piece of state (rather than
  // derived purely from `selected`) so "Back" can return to the list without
  // losing which row was highlighted.
  const [step, setStep] = useState<1 | 2>(1);

  const { data: pendingResp, isLoading } = useQuery({
    queryKey: ['production-pending', debouncedSearch],
    queryFn: () => api<{ items: PendingItem[] }>(`/production/pending?search=${encodeURIComponent(debouncedSearch)}`),
    staleTime: 0,
    // Keep the current rows visible while the next result loads, instead of
    // dropping the table back to "Loading…" on every filter or page change.
    placeholderData: keepPreviousData,
  });

  const { data: laboursResp } = useQuery({
    queryKey: ['labours-dropdown'],
    queryFn: () => api<{ labours: { id: string; name: string }[] }>('/labours/dropdown'),
  });

  /* ----- form state ----- */
  const [prodDate, setProdDate] = useState(todayISO());
  const [labourName, setLabourName] = useState('');
  const [pcs, setPcs] = useState(0);
  // Split-width production: a wide core sometimes can't be made in one run,
  // so it's produced as two (or more) narrower strips joined into one
  // finished piece before dispatch. Whole Piece (the default, unchanged
  // behaviour) leaves splitHeight out entirely; Split Width records this
  // entry as one physical run at `splitHeight`, matched against any other
  // split runs already recorded for the same item (see splitProduction.js).
  const [isSplit, setIsSplit] = useState(false);
  const [splitHeight, setSplitHeight] = useState(0);
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
    setIsSplit(false);
    setSplitHeight(0);
    setError(null);
    setStep(2);
  };

  // Weight/pc for a split run is computed with the SAME formulas as a whole
  // piece — both toroidalCalc and rectangularCalc take `ht` directly and are
  // linear in it — just substituting the entered split height for the item's
  // full ordered height. No new calc.ts helper needed.
  const splitWeightPerPc = useMemo(() => {
    if (!selected || !isSplit || splitHeight <= 0) return null;
    if (selected.coreType === 'TOROIDAL') {
      return toroidalCalc({ id: selected.id1 ?? 0, od: selected.od1 ?? 0, ht: splitHeight, pcs: 0 }).weightPerPc;
    }
    return rectangularCalc({
      id1: selected.id1 ?? 0, id2: selected.id2 ?? 0, od1: selected.od1 ?? 0, od2: selected.od2 ?? 0,
      ht: splitHeight, pcs: 0,
    }).weightPerPc;
  }, [selected, isSplit, splitHeight]);
  const effectiveWeightPerPc = isSplit ? (splitWeightPerPc ?? 0) : (selected?.weightPerPc ?? 0);

  const totalWeight = useMemo(
    () => (selected ? +(pcs * effectiveWeightPerPc).toFixed(3) : 0),
    [pcs, effectiveWeightPerPc, selected]
  );
  // Job amount for THIS entry, prorated from the item's own total the same
  // way the server prorates it once the entry is saved (see production.js's
  // flatten()) — so the figure shown here matches what lands in Modify/Summary.
  // Not meaningful for a split run: a split earns nothing on its own, so the
  // server leaves its amount at 0 until a matching run completes the piece.
  const jobAmount = useMemo(
    () => (!isSplit && selected?.totalAmount != null && selected.orderedPcs > 0 && pcs > 0
      ? +(selected.totalAmount * (pcs / selected.orderedPcs)).toFixed(2)
      : null),
    [pcs, selected, isSplit]
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
      setIsSplit(false);
      setSplitHeight(0);
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
    if (isSplit) {
      if (!(splitHeight > 0)) missing.push('Split height > 0');
      else if (selected.ht != null && splitHeight >= selected.ht) missing.push(`Split height must be less than ${selected.ht} (the full ordered height)`);
    }
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
      weightPerPc: effectiveWeightPerPc,
      totalWeight,
      labourName: labourName.trim(),
      splitHeight: isSplit ? splitHeight : null,
    });
  };

  const balanceAfter = selected ? Math.max(selected.remainingPcs - pcs, 0) : 0;
  const isExcess = !!selected && pcs > selected.remainingPcs;

  /* Progress bar segments: what is already produced, then what this entry adds
     on top. Both are clamped so an over-production entry fills the bar rather
     than overflowing it. A split run is left out of the added segment — it does
     not move the order's produced count until its matching height arrives. */
  const donePct = selected && selected.orderedPcs > 0
    ? Math.min(100, (selected.producedPcs / selected.orderedPcs) * 100)
    : 0;
  const addedPct = selected && selected.orderedPcs > 0 && pcs > 0 && !isSplit
    ? Math.min(100 - donePct, (pcs / selected.orderedPcs) * 100)
    : 0;

  /* One-tap amounts for the pcs field. Only offered when they are distinct and
     worth a tap — no point showing "Half 1" next to "All 2". */
  const quickFills = (() => {
    if (!selected) return [] as { label: string; value: number }[];
    const open = selected.remainingPcs;
    if (open < 4) return [];
    const half = Math.floor(open / 2);
    const quarter = Math.floor(open / 4);
    const out = [{ label: `All ${pcsFmt(open)}`, value: open }];
    if (half > 0 && half !== open) out.push({ label: `Half ${pcsFmt(half)}`, value: half });
    if (quarter > 0 && quarter !== half) out.push({ label: `Quarter ${pcsFmt(quarter)}`, value: quarter });
    return out;
  })();

  return (
    <div className="max-w-full space-y-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="flex items-center gap-2 text-xl font-extrabold tracking-tight text-slate-900 sm:text-2xl">
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
                      <div className="mt-0.5 text-[11px] text-slate-500 font-num truncate">{it.poNumber} · {it.measure}</div>
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
                        <div className="mt-0.5 text-[10px] text-brand-700 font-num tabular-nums">
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
                    <tr key={it.id} className="border-t border-slate-100 odd:bg-white even:bg-slate-50/40 transition-colors hover:bg-brand-50/60">
                      <td className="whitespace-nowrap px-3 py-2.5 pl-3 font-num text-xs">{it.poNumber}</td>
                      <td className="whitespace-nowrap px-3 py-2.5">{it.customerName}</td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-slate-600 text-xs">{formatDate(it.deliveryDate)}</td>
                      <td className="px-3 py-2.5 text-center"><CoreTypeChip coreType={it.coreType} /></td>
                      <td className="whitespace-nowrap px-3 py-2.5">{it.grade}</td>
                      <td className="whitespace-nowrap px-3 py-2.5">{it.material}</td>
                      <td className="whitespace-nowrap px-3 py-2.5 font-num text-xs">{it.measure}</td>
                      <td className="px-3 py-2.5 text-right font-num tabular-nums">{pcsFmt(it.orderedPcs)}</td>
                      <td className="px-3 py-2.5 text-right text-slate-500 font-num tabular-nums">{pcsFmt(it.producedPcs)}</td>
                      <td className="px-3 py-2.5 text-right">
                        <span className="rounded-md bg-yellow-50 px-2 py-0.5 font-num font-semibold tabular-nums text-yellow-800">
                          {pcsFmt(it.remainingPcs)}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <button
                          onClick={() => pickItem(it)}
                          className="rounded bg-brand-600 px-3 py-1 text-[10.5px] font-extrabold uppercase tracking-wide text-white hover:bg-brand-700"
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

        {/* ---- Step 2: enter production ----
            Three zones across the width: what was ordered, what you are
            entering, and what it will do to the order. Only the middle column
            takes input; the outer two exist so the operator never has to
            remember a figure or guess the outcome before saving. The old
            centred, capped layout left half a wide monitor empty. */}
        {step === 2 && selected && (
          <div className="grid grid-cols-1 gap-0 xl:grid-cols-[290px_minmax(0,1fr)_330px]">

            {/* Spec rail — the order being produced against. */}
            <aside className="border-b border-slate-200/70 bg-gradient-to-b from-slate-50 to-slate-100/70 p-4 xl:border-b-0 xl:border-r">
              <ErpLabel>Selected Order</ErpLabel>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <CoreTypeChip coreType={selected.coreType} />
                <span className="text-[11.5px] font-semibold text-slate-600">{selected.grade}</span>
              </div>
              <div className="mt-2.5 font-num text-[17px] font-bold tracking-tight text-slate-900">{selected.measure}</div>
              <div className="mt-0.5 text-[11.5px] text-slate-500">{selected.material}</div>

              <dl className="mt-4 grid grid-cols-2 gap-x-3 gap-y-3">
                <SummaryField label="Sales Order" value={selected.poNumber} mono />
                <SummaryField label="Due" value={formatDate(selected.deliveryDate)} />
                <SummaryField label="Customer" value={selected.customerName} className="col-span-2" />
                <SummaryField label="Weight / Pc" value={selected.weightPerPc.toFixed(3) + ' kg'} mono />
                <SummaryField label="Ordered" value={pcsFmt(selected.orderedPcs)} mono />
              </dl>

              {/* Where the order stands, and where this entry takes it — the
                  lighter segment is what is about to be added. */}
              <div className="mt-4">
                <div className="flex items-baseline justify-between">
                  <ErpLabel>Order Progress</ErpLabel>
                  <span className="font-num text-[11px] font-bold tabular-nums text-slate-500">
                    {pcsFmt(selected.producedPcs)} / {pcsFmt(selected.orderedPcs)}
                  </span>
                </div>
                <div className="mt-1.5 flex h-2 w-full overflow-hidden rounded-full bg-slate-200 shadow-[inset_0_1px_2px_rgb(15_23_42_/_0.10)]">
                  <span className="h-full bg-brand-600 transition-all duration-300 motion-reduce:transition-none" style={{ width: donePct + '%' }} />
                  <span className="h-full bg-brand-400/60 transition-all duration-300 motion-reduce:transition-none" style={{ width: addedPct + '%' }} />
                </div>
                <div className="mt-1.5 text-[11px] text-slate-500">
                  {pcs > 0 && !isSplit
                    ? 'Adding ' + pcsFmt(pcs) + ' pcs takes it to ' + Math.min(100, Math.round(((selected.producedPcs + pcs) / selected.orderedPcs) * 100)) + '%.'
                    : pcsFmt(selected.remainingPcs) + ' pcs still open.'}
                </div>
              </div>
            </aside>

            {/* The form itself. */}
            <div className="space-y-4 p-4">
              <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
                <Field label="Production Date">
                  <input className="input h-10 text-sm" type="date" value={prodDate} onChange={(e) => setProdDate(e.target.value)} />
                </Field>
                <Field label="Worker / Labour">
                  <SearchableSelect
                    value={labourName}
                    onChange={setLabourName}
                    options={(laboursResp?.labours ?? []).map((l) => ({ value: l.name, label: l.name }))}
                    placeholder="Select worker…"
                  />
                </Field>
              </div>

              <Field label="Pieces Made">
                <input
                  className="input h-12 font-num text-lg font-bold tabular-nums"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  placeholder="0"
                  value={pcs || ''}
                  onChange={(e) => setPcs(parseInt(e.target.value || '0', 10))}
                />
                {/* Retyping a four-digit count all day is the slowest part of
                    this screen — these fill the common amounts in one tap. */}
                {quickFills.length > 0 && (
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <span className="text-[11px] text-slate-400">Quick fill</span>
                    {quickFills.map((q) => (
                      <button
                        key={q.label}
                        type="button"
                        onClick={() => setPcs(q.value)}
                        className={cn(
                          'cursor-pointer rounded-md border px-2 py-1 text-[11px] font-bold tabular-nums shadow-e1 transition-all duration-150 active:translate-y-px motion-reduce:transform-none motion-reduce:transition-none',
                          pcs === q.value
                            ? 'border-brand-300 bg-brand-50 text-brand-800'
                            : 'border-slate-200 bg-white text-slate-600 hover:border-brand-200 hover:bg-brand-50/60 hover:text-brand-700',
                        )}
                      >
                        {q.label}
                      </button>
                    ))}
                  </div>
                )}
                <div className="mt-1.5 text-[11px] text-slate-400">
                  {isSplit
                    ? 'Strips at this height — counted toward a matching pile, not the order balance directly.'
                    : pcsFmt(selected.remainingPcs) + ' open of ' + pcsFmt(selected.orderedPcs) + ' ordered'}
                </div>
              </Field>

              {/* Whole Piece vs Split Width — decided per production batch, not
                  on the sales order line itself (the order still just states the
                  full height). See lib/splitProduction.js for the matching rule. */}
              <div className={cn(
                'rounded-xl border px-3.5 py-3 shadow-e1 transition-colors duration-200 motion-reduce:transition-none',
                isSplit ? 'border-amber-200 bg-gradient-to-b from-amber-50 to-amber-100/50' : 'border-slate-200/80 bg-white',
              )}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <ErpLabel>Production Type</ErpLabel>
                    <div className="mt-0.5 text-[11.5px] text-slate-500">
                      {isSplit ? 'One narrower strip of the ordered height.' : 'The full ordered height, made in one run.'}
                    </div>
                  </div>
                  <div className="inline-flex rounded-lg border border-slate-200 bg-slate-100/70 p-0.5 shadow-[inset_0_1px_2px_rgb(15_23_42_/_0.05)]">
                    <button
                      type="button"
                      aria-pressed={!isSplit}
                      onClick={() => { setIsSplit(false); setSplitHeight(0); }}
                      className={cn('cursor-pointer rounded-md px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.06em] transition-all duration-150 motion-reduce:transition-none',
                        !isSplit ? 'bg-gradient-to-b from-brand-800 to-brand-900 text-white shadow-e1' : 'text-slate-600 hover:bg-white/80 hover:text-slate-900')}
                    >
                      Whole Piece
                    </button>
                    <button
                      type="button"
                      aria-pressed={isSplit}
                      onClick={() => setIsSplit(true)}
                      className={cn('cursor-pointer rounded-md px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.06em] transition-all duration-150 motion-reduce:transition-none',
                        isSplit ? 'bg-gradient-to-b from-amber-500 to-amber-600 text-white shadow-e1' : 'text-slate-600 hover:bg-white/80 hover:text-slate-900')}
                    >
                      Split Width
                    </button>
                  </div>
                </div>

                {isSplit && (
                  <div className="mt-3.5 space-y-3 border-t border-amber-200/70 pt-3.5">
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <Field label={'Split Height (full height ' + (selected.ht ?? '—') + ')'}>
                        <input
                          className="input h-10 font-num text-sm"
                          type="number"
                          inputMode="decimal"
                          min={0}
                          placeholder="e.g. 40"
                          value={splitHeight || ''}
                          onChange={(e) => setSplitHeight(parseFloat(e.target.value || '0'))}
                        />
                      </Field>
                      <div>
                        <ErpLabel className="mb-1 block">Weight / Pc at this height</ErpLabel>
                        <div className="flex h-10 items-center rounded-lg border border-amber-200 bg-white px-3 font-num text-sm font-bold tabular-nums text-slate-800">
                          {splitWeightPerPc != null ? splitWeightPerPc.toFixed(3) + ' kg' : '—'}
                        </div>
                      </div>
                    </div>

                    {selected.splitInfo.length > 0 && (
                      <div className="overflow-hidden rounded-lg border border-amber-200/70 bg-white">
                        <div className="border-b border-amber-100 px-2.5 py-1.5">
                          <ErpLabel>Existing split piles on this order</ErpLabel>
                        </div>
                        <table className="w-full text-[11.5px]">
                          <thead>
                            <tr className="text-slate-400">
                              <th className="px-2.5 py-1 text-left font-semibold">Height</th>
                              <th className="px-2.5 py-1 text-right font-semibold">Pcs</th>
                              <th className="px-2.5 py-1 text-right font-semibold">Matched</th>
                              <th className="px-2.5 py-1 text-right font-semibold">Waiting</th>
                            </tr>
                          </thead>
                          <tbody>
                            {selected.splitInfo.map((sp) => (
                              <tr key={sp.splitHeight} className="border-t border-slate-100">
                                <td className="px-2.5 py-1.5"><SplitHeightChip height={sp.splitHeight} /></td>
                                <td className="px-2.5 py-1.5 text-right font-num tabular-nums">{pcsFmt(sp.pcs)}</td>
                                <td className="px-2.5 py-1.5 text-right font-num tabular-nums text-brand-700">{pcsFmt(sp.matched)}</td>
                                <td className="px-2.5 py-1.5 text-right font-num tabular-nums text-amber-700">{pcsFmt(sp.unmatched)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                    <p className="text-[11px] leading-relaxed text-slate-500">
                      Once another split height&apos;s pile reaches the same count, those pieces become finished and dispatchable together.
                    </p>
                  </div>
                )}
              </div>

              {error && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700">
                  <div className="font-semibold">{error.message}</div>
                  {error.details && (
                    <ul className="mt-1 list-disc pl-5 text-xs">
                      {error.details.map((d, i) => <li key={i}>{d}</li>)}
                    </ul>
                  )}
                </div>
              )}
            </div>

            {/* Outcome rail — what saving this will do, and the actions. */}
            <aside className="flex flex-col gap-3 border-t border-slate-200/70 bg-gradient-to-b from-slate-50 to-slate-100/70 p-4 xl:border-l xl:border-t-0">
              <ErpLabel>This Entry</ErpLabel>

              <div className="rounded-xl border border-slate-200/80 bg-white px-3.5 py-3 shadow-e1">
                <ErpLabel>Total Weight</ErpLabel>
                <div className="mt-1 font-num text-[26px] font-extrabold leading-none tracking-tight tabular-nums text-slate-900">
                  {totalWeight ? totalWeight.toFixed(3) : '0.000'}
                  <span className="ml-1 text-[13px] font-bold text-slate-400">kg</span>
                </div>
                <div className="mt-1 text-[11px] text-slate-400">
                  {pcsFmt(pcs || 0)} pcs × {effectiveWeightPerPc ? effectiveWeightPerPc.toFixed(3) : '—'} kg
                </div>
              </div>

              <div className="rounded-xl border border-brand-200 bg-gradient-to-b from-brand-50 to-brand-100/60 px-3.5 py-3 shadow-e1">
                <ErpLabel>Job Amount</ErpLabel>
                {isSplit ? (
                  <>
                    <div className="mt-1 text-[15px] font-bold text-slate-600">Credited once matched</div>
                    <div className="mt-1 text-[11px] leading-relaxed text-slate-500">
                      A split run earns nothing on its own — the full per-piece rate goes to whichever run completes the pair.
                    </div>
                  </>
                ) : (
                  <>
                    <div className="mt-1 font-num text-[26px] font-extrabold leading-none tracking-tight tabular-nums text-brand-700">
                      {jobAmount != null ? inr(jobAmount) : '—'}
                    </div>
                    <div className="mt-1 text-[11px] text-slate-500">Credited to the worker you pick.</div>
                  </>
                )}
              </div>

              <div className={cn(
                'rounded-xl border px-3.5 py-3 shadow-e1 transition-colors duration-200 motion-reduce:transition-none',
                isExcess ? 'border-amber-300 bg-gradient-to-b from-amber-50 to-amber-100/70' : 'border-slate-200/80 bg-white',
              )}>
                <ErpLabel>Order Balance After</ErpLabel>
                <div className={cn('mt-1 font-num text-[22px] font-extrabold leading-none tracking-tight tabular-nums',
                  isExcess ? 'text-amber-700' : 'text-slate-900')}>
                  {isExcess ? pcsFmt(pcs - selected.remainingPcs) + ' over' : pcsFmt(balanceAfter) + ' pcs'}
                </div>
                <div className="mt-1 text-[11px] leading-relaxed text-slate-500">
                  {isSplit
                    ? 'Split runs feed a work-in-progress pile — pcs only count as produced once a matching height completes them.'
                    : pcs <= 0
                      ? 'Nothing entered yet, so the order is untouched.'
                      : isExcess
                        ? 'Exceeds the order by ' + pcsFmt(pcs - selected.remainingPcs) + ' pcs — you will be asked to confirm.'
                        : pcsFmt(selected.producedPcs + pcs) + ' of ' + pcsFmt(selected.orderedPcs) + ' pcs produced.'}
                </div>
              </div>

              <div className="mt-auto flex flex-col gap-2 pt-2">
                <button onClick={onSave} disabled={submit.isPending} className="btn-primary h-11 w-full justify-center text-[15px]">
                  {submit.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  Save production
                </button>
                <button onClick={() => setStep(1)} className="btn-ghost w-full justify-center text-slate-600">
                  Back to orders
                </button>
              </div>
            </aside>
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
    className={cn('flex items-center gap-1.5 text-[11px] font-extrabold uppercase tracking-wide disabled:cursor-not-allowed disabled:opacity-40',
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
    <div className={cn('mt-0.5 truncate text-slate-900', mono ? 'font-num text-[13px] font-semibold' : 'text-sm font-medium')}>{value}</div>
  </div>
);
