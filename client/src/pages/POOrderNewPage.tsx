// New PO Order entry — port of .NET New_PO_Order.vb.
// Header (PO#, customer, dates) + per-item entry (toroidal OR rectangular)
// with live calculations + accumulated items list. Submit creates one PoOrder
// with many PoOrderItems in a single API call.
import { useEffect, useMemo, useRef, useState, Fragment } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, Save, Loader2, Calendar, Hash, User2, Package, Pencil, Copy, ChevronDown, ChevronRight } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useCustomerRate, useAutoFillRate, type CardRate } from '@/hooks/useCustomerRate';
import { cn } from '@/lib/cn';
import { numFromInput, rectangularCalc, toroidalCalc, fluxTestCalc, rectangularFluxTestCalc, nanoCalc, nanoTestCalc, isCompositeGrade, compositeRuleFromMaterial, compositeCalc, stackOr, TOROIDAL_FACTOR, RECT_STACK_FACTOR } from '@/lib/calc';
import { SearchableSelect } from '@/components/SearchableSelect';
import { useConfirm } from '@/hooks/useConfirm';
import CorePreview from '@/components/core3d/CorePreview';
import type { CoreShape } from '@/components/core3d/shape';
import type { SheetMeta } from '@/components/core3d/specSheet';
import { useAuthStore, activeMembership } from '@/store/auth';
import './po-order-new.css';

/* ---------- types ---------- */
type CoreType = 'TOROIDAL' | 'RECTANGULAR' | 'NANO' | 'COMPOSITE';

export type Item = {
  /** Set when the item came from the DB (edit mode). Not sent to the server — Zod strips it. */
  _dbId?: string;
  /** True when DB item has production/dispatch — remove button is disabled. */
  _locked?: boolean;
  coreType: CoreType;
  grade: string;
  material: string;
  measure: string;
  id1: number; id2?: number;
  od1: number; od2?: number;
  ht: number;
  builtup?: number;
  weightPerPc: number;
  pcs: number;
  totalWeight: number;
  coreAc?: number; coreMl?: number; d13?: number;
  /** Stacking factor this line was weighed with. Recorded on the line so a
   *  later change to the customer's figure can't re-weigh an existing order.
   *  Undefined/null means it used the house default. */
  stackFactor?: number | null;
  // Toroidal flux-test calibration — optional, only set when user fills them.
  turns?: number; flux?: number; ateCm?: number; testVoltage?: number; testCurrent?: number;
  // Pricing — rateBasis + rateValue are user-entered; per-kg / per-pc / total
  // are derived locally so the items list can show the breakdown immediately.
  rateBasis?: 'PER_KG' | 'PER_PCS';
  rateValue?: number;
  ratePerKg?: number;
  ratePerPc?: number;
  totalAmount?: number;
  // Nano core pricing
  nanoPrice?: number;
  casePrice?: number;
  caseWeight?: number;
  nanoSoRate?: number; // manual SO rate/pc (overrides Nano+Case); null = auto
};

type Customer = {
  id: string; name: string; gstRate?: number;
  /** Per-customer weight-calc stacking factors; null = the house defaults. */
  toroidalFactor?: number | null; rectStackFactor?: number | null;
};
type GradeRow = {
  grade: string;
  materials: { id: string; material: string }[];
  coreTypes?: CoreType[];
  nanoIdOff?: number | null; nanoOdOff?: number | null; nanoHtOff?: number | null;
};
// A grade with no coreTypes (legacy) applies to all.
const gradeAppliesTo = (g: GradeRow, ct: CoreType) => !g.coreTypes || g.coreTypes.length === 0 || g.coreTypes.includes(ct);
type FluxPoint = { flux: number; ateCm: number };
type FluxGroup = { grade: string; points: FluxPoint[] };

const todayISO = () => new Date().toISOString().slice(0, 10);
const DRAFT_KEY = 'po_draft_new';
const addDays = (iso: string, days: number) => {
  const d = new Date(iso); d.setDate(d.getDate() + days); return d.toISOString().slice(0, 10);
};

/* ---------- shared input styles ----------
   Single source of truth for compact inputs across this page. Tight height,
   small padding, small text — keeps the form dense on desktop and avoids the
   over-large default inputs that dominate the screen on mobile. */
const inputCls =
  'h-7 w-full rounded-md border border-slate-300 bg-white px-2 text-[13px] text-slate-900 ' +
  'placeholder:text-slate-400 outline-none transition ' +
  'focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 ' +
  'disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400';

const readonlyInputCls = inputCls + ' bg-slate-50 text-slate-600';

/* ---------- field width scale ----------
   An entry form reads badly when a three-digit bore measurement is given the
   same 200px box as a customer name: the eye has to travel for nothing, and a
   row of identical boxes gives no clue what belongs in each. Sizing a field to
   its content is the single biggest thing that makes a form look like an ERP
   rather than a web page.

   These are fixed widths on wrapping rows rather than grid fractions, so the
   same markup goes from a 375px phone (fields wrap) to an ultrawide (fields
   stay put instead of stretching) with no breakpoint juggling and no
   horizontal scrollbar. */
const FW = {
  dim:    'w-[74px]',    // millimetre dimensions — 3 to 4 digits
  factor: 'w-[106px]',   // stacking factors — 5.77 / 0.95, plus a full label
  qty:    'w-[84px]',    // pcs, turns
  rate:   'w-[116px]',   // money, which needs room for thousands
  stat:   'w-[104px]',   // computed read-outs
  sel:    'w-[150px]',   // short selects — rate basis, flux
  selLg:  'w-[184px]',   // grade / material / type names
} as const;

/* Publish the current dimensions to the 3D preview beside the form.
   The callback is held in a ref so the effect depends on the numbers alone:
   the parent re-renders on every report, which would otherwise re-create the
   callback, re-run the effect and report again forever. */
export type ShapeReport = { shape: CoreShape; meta: SheetMeta };

const useReportShape = (
  onShape: ((r: ShapeReport) => void) | undefined,
  build: () => ShapeReport,
  deps: unknown[],
) => {
  const ref = useRef(onShape);
  ref.current = onShape;
  useEffect(() => {
    ref.current?.(build());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
};

/* The zero-dimension shape a tab starts on. Not drawable, so the preview
   shows its "enter these fields" prompt rather than a blank stage. */
const emptyShapeFor = (ct: CoreType): CoreShape => {
  const zero = { id: 0, od: 0, ht: 0 };
  switch (ct) {
    case 'RECTANGULAR': return { kind: 'RECTANGULAR', id1: 0, id2: 0, od1: 0, od2: 0, ht: 0 };
    case 'NANO':        return { kind: 'NANO', dims: zero, cased: true };
    case 'COMPOSITE':   return { kind: 'COMPOSITE', rule: 'CONTINUOUS_LOOP', crgo: zero, nano: zero };
    default:            return { kind: 'TOROIDAL', dims: zero };
  }
};

/* A row of fields that wraps rather than squeezing. */
const FieldRow = ({ children, className }: { children: React.ReactNode; className?: string }) => (
  <div className={cn('core-field-row flex flex-wrap items-start gap-x-2.5 gap-y-2', className)}>{children}</div>
);

/* A figure carried up into a card header. Greyed until it has a real value, so
   an empty form doesn't shout "0.000 kg" at someone who hasn't typed yet. */
const HeadStat = ({ label, value, on }: { label: string; value: string; on: boolean }) => (
  <span className={cn(
    'inline-flex items-baseline gap-1.5 rounded-md border px-2 py-0.5',
    on ? 'border-slate-200 bg-white' : 'border-transparent bg-white/50'
  )}>
    <span className="text-[10px] font-medium uppercase tracking-wide text-slate-500">{label}</span>
    <span className={cn('font-num text-[12px] font-semibold', on ? 'text-slate-900' : 'text-slate-400')}>{value}</span>
  </span>
);

/* A read-only computed figure sitting in a field row, sized and aligned like
   the inputs beside it so the row keeps one baseline. */
const ReadOut = ({ label, value, w, tone }: { label: string; value: string; w?: string; tone?: 'amber' | 'violet' }) => (
  <div className={cn('core-readout shrink-0', w)}>
    <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</div>
    <div className={cn(
      'core-readout-value flex h-7 items-center justify-end rounded-md border px-2 font-num text-[13px] font-semibold',
      tone === 'amber' ? 'border-amber-200 bg-amber-50/70 text-amber-900'
        : tone === 'violet' ? 'border-violet-200 bg-violet-50/70 text-violet-900'
        : 'border-slate-200 bg-slate-50 text-slate-800'
    )}>
      {value}
    </div>
  </div>
);

const coreBadge = (ct: CoreType) =>
  ct === 'TOROIDAL' ? 'bg-amber-50 text-amber-700'
  : ct === 'RECTANGULAR' ? 'bg-rose-50 text-rose-700'
  : ct === 'COMPOSITE' ? 'bg-teal-50 text-teal-700'
  : 'bg-violet-50 text-violet-700';
const coreShort = (ct: CoreType) => (ct === 'TOROIDAL' ? 'Toro' : ct === 'RECTANGULAR' ? 'Rect' : ct === 'COMPOSITE' ? 'Comp' : 'Nano');
// Prices are shown as whole rupees (no decimals).
const money0 = (n: number | undefined | null) => Math.round(Number(n) || 0).toLocaleString('en-IN');

/* Expanded details for an added line — weights, testing + pricing breakdown. */
const ItemDetails = ({ it }: { it: Item }) => {
  const rows: [string, string][] = [['Grade', it.grade], ['Material', it.material], ['Measure', it.measure]];
  if (it.coreType === 'NANO') {
    const coreW = Math.max(0, (it.weightPerPc ?? 0) - (it.caseWeight ?? 0));
    rows.push(['Core Wt (kg)', coreW.toFixed(3)]);
    rows.push(['Case Wt (kg)', (it.caseWeight ?? 0).toFixed(3)]);
    rows.push(['Total Wt (kg)', (it.totalWeight ?? 0).toFixed(3)]);
    if (it.nanoPrice) rows.push(['Nano Price', `₹${money0(it.nanoPrice)}/kg`]);
    if (it.casePrice) rows.push(['Case Price', `₹${money0(it.casePrice)}/kg`]);
  } else {
    rows.push(['Wt / pc (kg)', (it.weightPerPc ?? 0).toFixed(3)]);
    rows.push(['Total Wt (kg)', (it.totalWeight ?? 0).toFixed(3)]);
    if (it.builtup != null) rows.push(['Built-up', it.builtup.toFixed(3)]);
    if (it.coreAc != null) rows.push(['Core A/C', it.coreAc.toFixed(3)]);
  }
  if (it.turns) rows.push(['Turns', String(it.turns)]);
  if (it.flux) rows.push(['Flux', it.coreType === 'NANO' ? `${Math.round(it.flux * 10000)} G` : `${it.flux} T`]);
  if (it.testVoltage) rows.push(['Test V', it.coreType === 'NANO' ? `${(it.testVoltage * 1000).toFixed(2)} mV` : `${it.testVoltage.toFixed(3)} V`]);
  if (it.testCurrent) rows.push(['Ie max', it.coreType === 'NANO' ? `${(it.testCurrent / 1000).toFixed(5)} A` : `${it.testCurrent.toFixed(2)} mA`]);
  if (it.rateValue) rows.push(['Rate', `₹${money0(it.rateValue)} ${it.rateBasis === 'PER_KG' ? '/kg' : '/pc'}`]);
  if (it.totalAmount) rows.push(['Amount', `₹${money0(it.totalAmount)}`]);
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-2 bg-slate-50/70 px-4 py-3 text-xs sm:grid-cols-4 lg:grid-cols-6">
      {rows.map(([k, v]) => (
        <div key={k} className="min-w-0">
          <div className="text-[10px] uppercase tracking-wide text-slate-400">{k}</div>
          <div className="truncate font-medium text-slate-700 tabular-nums" title={v}>{v || '—'}</div>
        </div>
      ))}
    </div>
  );
};

/* ============================================================ */
export const POOrderNewPage = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  // The page's own dialog, for the post-save "keep this rate?" prompt.
  // The item forms below have their own; these do not collide.
  const { confirm, alert: showAlert, confirmDialog } = useConfirm();
  const { poId } = useParams<{ poId?: string }>();
  const isEdit = !!poId;

  /* Track DB item IDs that were removed during editing (need DELETE on submit). */
  const removedDbIds = useRef<Set<string>>(new Set());

  /* ----- header state ----- */
  const [poNumber, setPoNumber] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [orderDate, setOrderDate] = useState(todayISO());
  const [deliveryDays, setDeliveryDays] = useState(0);
  const deliveryDate = useMemo(() => addDays(orderDate, deliveryDays), [orderDate, deliveryDays]);

  /* ----- entry state (current item being built) ----- */
  const [coreType, setCoreType] = useState<CoreType | ''>('');
  // What the 3D dock is drawing. Reported up by whichever line form is
  // open; cleared on a core-type switch so the old solid never lingers
  // beside the new form's empty fields.
  const [report, setReport] = useState<ShapeReport | null>(null);
  const shape = report?.shape ?? null;
  // Names the spec sheet header; null when the store has no active membership
  // (a platform admin who has not picked a company yet).
  const companyName = useAuthStore((st) => activeMembership(st)?.companyName ?? null);
  const pickCore = (ct: CoreType) => { setReport(null); setCoreType(ct); };
  const [items, setItems] = useState<Item[]>([]);
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);
  const toggleExpand = (idx: number) => setExpandedIdx((p) => (p === idx ? null : idx));

  /* Copy grade / material / rate-basis from an existing row into the entry form.
     Switches the form to that row's core type and hands it a one-shot prefill. */
  const [prefill, setPrefill] = useState<
    null | { coreType: CoreType; grade: string; material: string; rateBasis: 'PER_KG' | 'PER_PCS' }
  >(null);
  const copyToForm = (it: Item) => {
    setCoreType(it.coreType);
    setPrefill({ coreType: it.coreType, grade: it.grade, material: it.material, rateBasis: it.rateBasis ?? 'PER_KG' });
  };

  /* Edit a line: pull the row back into its entry form (all fields), then remove
     it from the list — re-adding replaces it. Locked (produced) rows can't edit. */
  const [editSeed, setEditSeed] = useState<{ item: Item; nonce: number } | null>(null);
  const editNonce = useRef(0);
  const editItem = (idx: number) => {
    const it = items[idx];
    if (!it || it._locked) return;
    setCoreType(it.coreType);
    editNonce.current += 1;
    setEditSeed({ item: it, nonce: editNonce.current });
    setItems((prev) => prev.filter((_, i) => i !== idx));
  };

  /* ----- localStorage draft: restore on mount, auto-save on change ----- */
  const [draftAvailable, setDraftAvailable] = useState(false);
  const [draftData, setDraftData] = useState<null | {
    poNumber: string; customerId: string; orderDate: string; deliveryDays: number; items: Item[];
  }>(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(DRAFT_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed?.poNumber || parsed?.customerId || (parsed?.items?.length ?? 0) > 0) {
          setDraftData(parsed);
          setDraftAvailable(true);
        }
      }
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (isEdit) return; // no draft in edit mode
    if (!poNumber && !customerId && items.length === 0) return;
    const id = setTimeout(() => {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ poNumber, customerId, orderDate, deliveryDays, items }));
    }, 1500);
    return () => clearTimeout(id);
  }, [isEdit, poNumber, customerId, orderDate, deliveryDays, items]);

  const restoreDraft = () => {
    if (!draftData) return;
    setPoNumber(draftData.poNumber ?? '');
    setCustomerId(draftData.customerId ?? '');
    setOrderDate(draftData.orderDate ?? todayISO());
    setDeliveryDays(draftData.deliveryDays ?? 0);
    setItems(draftData.items ?? []);
    setDraftAvailable(false);
  };

  const discardDraft = () => {
    localStorage.removeItem(DRAFT_KEY);
    setDraftAvailable(false);
  };

  /* ----- dropdown data ----- */
  const { data: customersResp } = useQuery({
    queryKey: ['customers', 'all'],
    queryFn: () => api<{ items: Customer[] }>('/customers?pageSize=200'),
    staleTime: 0,
  });
  const { data: gradesResp } = useQuery({
    queryKey: ['material-grades'],
    queryFn: () => api<{ grades: GradeRow[] }>('/material-grades'),
  });
  const { data: fluxResp } = useQuery({
    queryKey: ['flux-grades-grouped', 'TOROIDAL'],
    queryFn: () => api<{ grades: FluxGroup[] }>('/flux-grades/grouped?coreType=TOROIDAL'),
  });
  const { data: fluxRespRect } = useQuery({
    queryKey: ['flux-grades-grouped', 'RECTANGULAR'],
    queryFn: () => api<{ grades: FluxGroup[] }>('/flux-grades/grouped?coreType=RECTANGULAR'),
  });
  const { data: fluxRespNano } = useQuery({
    queryKey: ['flux-grades-grouped', 'NANO'],
    queryFn: () => api<{ grades: FluxGroup[] }>('/flux-grades/grouped?coreType=NANO'),
  });

  /* ----- edit mode: fetch existing PO header + items ----- */
  type ExistingPo = {
    poNumber: string; customerId: string; orderDate: string; deliveryDays: number;
    customer: { id: string; name: string };
  };
  type ExistingItem = {
    id: string; coreType: CoreType; grade: string; material: string; measure: string;
    id1: number; id2: number | null; od1: number; od2: number | null; ht: number;
    builtup: number | null; weightPerPc: number; pcs: number; totalWeight: number;
    coreAc: number | null; coreMl: number | null; d13: number | null;
    turns: number | null; flux: number | null; ateCm: number | null;
    testVoltage: number | null; testCurrent: number | null;
    rateBasis: 'PER_KG' | 'PER_PCS' | null; rateValue: number | null;
    ratePerKg: number | null; ratePerPc: number | null; totalAmount: number | null;
    pcsProduced: number; pcsDispatched: number;
  };
  const { data: existingPo, error: existingPoErr } = useQuery({
    queryKey: ['po-orders', 'header', poId],
    queryFn: () => api<ExistingPo>(`/po-orders/${poId}`),
    enabled: isEdit,
  });
  const { data: existingItemsResp, error: existingItemsErr } = useQuery({
    queryKey: ['po-orders', 'items-for-edit', poId],
    queryFn: () => api<{ items: ExistingItem[] }>(`/po-orders/items?poOrderId=${poId}&pageSize=500&status=ACTIVE`),
    enabled: isEdit,
  });
  const [editLoaded, setEditLoaded] = useState(false);
  useEffect(() => {
    if (!isEdit || !existingPo || !existingItemsResp || editLoaded) return;
    const po = existingPo;
    setPoNumber(po.poNumber ?? '');
    setCustomerId(po.customerId ?? '');
    setOrderDate(po.orderDate ? String(po.orderDate).slice(0, 10) : todayISO());
    setDeliveryDays(po.deliveryDays ?? 0);
    const mapped: Item[] = (existingItemsResp.items ?? []).map((it) => ({
      _dbId: it.id,
      _locked: (it.pcsProduced ?? 0) > 0 || (it.pcsDispatched ?? 0) > 0,
      coreType: it.coreType,
      grade: it.grade,
      material: it.material,
      measure: it.measure,
      id1: it.id1, id2: it.id2 ?? undefined,
      od1: it.od1, od2: it.od2 ?? undefined,
      ht: it.ht,   builtup: it.builtup ?? undefined,
      weightPerPc: it.weightPerPc, pcs: it.pcs, totalWeight: it.totalWeight,
      coreAc: it.coreAc ?? undefined, coreMl: it.coreMl ?? undefined, d13: it.d13 ?? undefined,
      turns: it.turns ?? undefined, flux: it.flux ?? undefined, ateCm: it.ateCm ?? undefined,
      testVoltage: it.testVoltage ?? undefined, testCurrent: it.testCurrent ?? undefined,
      rateBasis: (it.rateBasis ?? undefined) as 'PER_KG' | 'PER_PCS' | undefined,
      rateValue: it.rateValue ?? undefined,
      ratePerKg: it.ratePerKg ?? undefined,
      ratePerPc: it.ratePerPc ?? undefined,
      totalAmount: it.totalAmount ?? undefined,
    }));
    setItems(mapped);
    setEditLoaded(true);
  }, [isEdit, existingPo, existingItemsResp, editLoaded]);

  /* After a Sales Order saves, offer to keep anything the operator changed
     away from what this customer's record says -- the agreed behaviour is to
     ask rather than silently rewrite a negotiated figure, or silently forget
     it. Two things can drift: the rate (from the rate card) and the stacking
     factor (from the customer record).

     Both are offered in ONE dialog. Two popups in a row after a save is the
     kind of thing people learn to dismiss without reading, which defeats the
     point of asking at all.

     Only Toroidal and Rectangular lines are considered, matching where the
     card auto-fills: Nano and Composite lines derive their price from the
     nano/case prices, so a per-kg figure stored against the grade would not
     mean the same thing on the way back in.

     A failure here must never strand the user on a saved order, so the whole
     thing is best-effort and navigation continues regardless. */
  const offerToKeepTerms = async () => {
    if (!customerId) return;
    const lines = items.filter(
      (i) => i.coreType === 'TOROIDAL' || i.coreType === 'RECTANGULAR' || i.coreType === 'COMPOSITE'
    );
    if (!lines.length) return;

    /* ---- rate changes ---- */
    // One entry per grade + core type; if the same scope was priced twice in
    // one order the last line is the one that stands.
    const byScope = new Map<string, { grade: string; coreType: string; rateBasis: 'PER_KG' | 'PER_PCS'; rateValue: number }>();
    for (const i of lines) {
      if (i.coreType !== 'TOROIDAL' && i.coreType !== 'RECTANGULAR') continue;
      if (!i.grade || !((i.rateValue ?? 0) > 0) || !i.rateBasis) continue;
      byScope.set(`${i.grade}|${i.coreType}`, {
        grade: i.grade, coreType: i.coreType,
        rateBasis: i.rateBasis as 'PER_KG' | 'PER_PCS', rateValue: i.rateValue as number,
      });
    }

    type RateChange = { grade: string; coreType: string; targetCoreType: string; rateBasis: 'PER_KG' | 'PER_PCS'; rateValue: number; previous: CardRate | null };
    const rateChanges: RateChange[] = [];
    try {
      for (const e of byScope.values()) {
        const res = await api<{ rate: CardRate | null }>(
          `/customer-rates/lookup?customerId=${encodeURIComponent(customerId)}`
          + `&grade=${encodeURIComponent(e.grade)}&coreType=${encodeURIComponent(e.coreType)}`
        );
        const card = res.rate;
        const same = card && card.rateBasis === e.rateBasis && Math.abs(Number(card.rateValue) - e.rateValue) < 0.0001;
        if (same) continue;
        // Update whichever row actually governs this line -- the blanket row if
        // that is what matched -- rather than quietly creating a narrower one.
        rateChanges.push({ ...e, targetCoreType: card?.coreType ?? '', previous: card ?? null });
      }
    } catch {
      /* lookup unavailable -- carry on and offer the factor alone, if anything */
    }

    /* ---- stacking-factor changes ---- */
    // Compared against what the customer's record says today (falling back to
    // the house default), so booking on a different factor is offered whether
    // or not the customer already had one recorded.
    type FactorChange = { field: 'toroidalFactor' | 'rectStackFactor'; label: string; value: number; previous: number; wasDefault: boolean };
    const factorChanges: FactorChange[] = [];
    const factorSpecs = [
      { coreTypes: ['TOROIDAL', 'COMPOSITE'], field: 'toroidalFactor'  as const, label: 'Toroidal',    stored: selectedCustomer?.toroidalFactor,  house: TOROIDAL_FACTOR },
      { coreTypes: ['RECTANGULAR'],           field: 'rectStackFactor' as const, label: 'Rectangular', stored: selectedCustomer?.rectStackFactor, house: RECT_STACK_FACTOR },
    ];
    for (const spec of factorSpecs) {
      // Last line of that shape wins, same rule as the rate.
      const used = lines.filter((i) => spec.coreTypes.includes(i.coreType) && (i.stackFactor ?? 0) > 0).pop()?.stackFactor;
      if (!used) continue;
      const current = stackOr(spec.stored, spec.house);
      if (Math.abs(used - current) < 1e-9) continue;
      factorChanges.push({
        field: spec.field, label: spec.label, value: used,
        previous: current, wasDefault: spec.stored == null,
      });
    }

    if (!rateChanges.length && !factorChanges.length) return;

    const unit = (b: string) => (b === 'PER_KG' ? '/kg' : '/pc');
    const both = rateChanges.length > 0 && factorChanges.length > 0;
    const title = both
      ? 'Keep these for next time?'
      : factorChanges.length
        ? (factorChanges.length === 1 ? 'Keep this stacking factor?' : 'Keep these stacking factors?')
        : (rateChanges.length === 1 ? 'Keep this rate for next time?' : 'Keep these rates for next time?');

    const ok = await confirm({
      title,
      confirmLabel: 'Keep',
      cancelLabel: 'Just this order',
      message: (
        <div className="space-y-2 text-sm">
          <p>
            Save on {selectedCustomer?.name ?? 'this customer'}&rsquo;s record, so future orders
            fill in automatically?
          </p>
          {rateChanges.length > 0 && (
            <ul className="space-y-1">
              {both && <li className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Rate</li>}
              {rateChanges.map((c) => (
                <li key={`r:${c.grade}|${c.coreType}`} className="flex flex-wrap items-baseline gap-x-1.5">
                  <strong>{c.grade}</strong>
                  <span className="text-slate-500">{c.targetCoreType ? `(${c.targetCoreType.toLowerCase()})` : ''}</span>
                  <span className="tabular-nums">&#8377;{c.rateValue}{unit(c.rateBasis)}</span>
                  {c.previous && (
                    <span className="text-slate-400">
                      (was &#8377;{Number(c.previous.rateValue)}{unit(c.previous.rateBasis)})
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
          {factorChanges.length > 0 && (
            <ul className="space-y-1">
              {both && <li className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Stacking factor</li>}
              {factorChanges.map((c) => (
                <li key={`f:${c.field}`} className="flex flex-wrap items-baseline gap-x-1.5">
                  <strong>{c.label}</strong>
                  <span className="tabular-nums">{c.value}</span>
                  <span className="text-slate-400">
                    (was {c.previous}{c.wasDefault ? ', the standard' : ''})
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ),
    });
    if (!ok) return;

    try {
      await Promise.all(rateChanges.map((c) => api('/customer-rates', {
        method: 'POST',
        json: {
          customerId, grade: c.grade, coreType: c.targetCoreType,
          rateBasis: c.rateBasis, rateValue: c.rateValue,
        },
      })));
      if (factorChanges.length) {
        await api(`/customers/${customerId}`, {
          method: 'PATCH',
          json: Object.fromEntries(factorChanges.map((c) => [c.field, c.value])),
        });
        queryClient.invalidateQueries({ queryKey: ['customers'] });
      }
      queryClient.invalidateQueries({ queryKey: ['customer-rate'] });
      queryClient.invalidateQueries({ queryKey: ['customer-rates'] });
    } catch {
      // The order is saved either way, so this must not block. But staying
      // silent would leave someone believing a figure stuck when it did not --
      // most likely because saving a customer needs a permission they lack.
      await showAlert({
        title: 'Saved the order, not the customer',
        message: 'The Sales Order is saved. Updating the customer\u2019s stored figures failed \u2014 you may not have permission to edit customers. The order itself keeps the values you entered.',
        tone: 'warning',
      });
    }
  };

  /* ----- submit mutation ----- */
  const [error, setError] = useState<{ message: string; details?: string[] } | null>(null);
  const submit = useMutation({
    mutationFn: (body: unknown) => api('/po-orders', { method: 'POST', json: body }),
    onSuccess: async () => {
      localStorage.removeItem(DRAFT_KEY);
      queryClient.invalidateQueries({ queryKey: ['po-orders'] });
      await offerToKeepTerms();
      navigate('/po/manage');
    },
    onError: (e) => {
      if (e instanceof ApiError) {
        // Zod errors come back in details.fieldErrors — flatten to readable lines.
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

  /* Edit-mode submit: PATCH header → DELETE removed items → POST new items */
  const editSubmit = useMutation({
    mutationFn: async () => {
      await api(`/po-orders/${poId}`, { method: 'PATCH', json: {
        poNumber: poNumber.trim(), customerId, orderDate, deliveryDays, deliveryDate,
      }});
      for (const dbId of removedDbIds.current) {
        try { await api(`/po-orders/items/${dbId}`, { method: 'DELETE' }); }
        catch { /* server will reject if item has production — silently skip */ }
      }
      for (const item of items) {
        if (!item._dbId) {
          await api(`/po-orders/${poId}/items`, { method: 'POST', json: item });
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['po-orders'] });
      queryClient.invalidateQueries({ queryKey: ['po-summary'] });
      navigate('/po/summary');
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

  /* Remove item — tracks DB IDs for deletion in edit mode. */
  const removeItem = (idx: number) => {
    const item = items[idx];
    if (!item) return;
    if (item._locked) return; // has production — can't remove
    if (item._dbId) removedDbIds.current.add(item._dbId);
    setItems((prev) => prev.filter((_, i) => i !== idx));
  };

  const onSubmit = () => {
    setError(null);

    // Cheap client-side validation so the user sees the obvious omissions
    // before the server bounces them.
    const missing: string[] = [];
    if (!poNumber.trim()) missing.push('Sales Order No.');
    if (!customerId)      missing.push('Customer');
    if (!orderDate)       missing.push('Order Date');
    if (!deliveryDate)    missing.push('Delivery Date');
    if (items.length === 0) missing.push('At least one item');
    if (missing.length) {
      setError({ message: 'Please fill required fields', details: missing });
      return;
    }

    if (isEdit) {
      editSubmit.mutate();
    } else {
      submit.mutate({
        poNumber: poNumber.trim(),
        customerId,
        orderDate,
        deliveryDays,
        deliveryDate,
        items,
      });
    }
  };

  /* Edit mode: while the existing PO is still loading, show a spinner — but if
     either fetch errored, surface it instead of spinning forever. */
  if (isEdit && !editLoaded) {
    const loadErr = existingPoErr || existingItemsErr;
    if (loadErr) {
      const msg = loadErr instanceof ApiError ? loadErr.message : 'Could not load this sales order.';
      return (
        <div className="card p-8 text-center space-y-3">
          <div className="text-sm font-medium text-red-700">{msg}</div>
          <button onClick={() => navigate('/po/manage')} className="btn-ghost mx-auto">
            Back to SO Modify
          </button>
        </div>
      );
    }
    if (!existingPo || !existingItemsResp) {
      return (
        <div className="card p-10 text-center">
          <Loader2 className="h-5 w-5 animate-spin mx-auto text-slate-400" />
          <div className="mt-2 text-sm text-slate-500">Loading sales order…</div>
        </div>
      );
    }
  }

  const totalWeight = items.reduce((s, x) => s + x.totalWeight, 0);

  // Selected customer (with gstRate) — pulled out of the cached list.
  const selectedCustomer = customersResp?.items.find((c) => c.id === customerId);
  const gstRate = Number(selectedCustomer?.gstRate ?? 0);

  // Money totals — items where the user typed a rate contribute, others are 0.
  const subtotal = items.reduce((s, x) => s + (x.totalAmount ?? 0), 0);
  const gstAmount  = +(subtotal * gstRate / 100).toFixed(2);
  const grandTotal = +(subtotal + gstAmount).toFixed(2);
  const fmtMoney = (n: number) => Math.round(n).toLocaleString('en-IN');

  return (
    <div className="sales-order-workbench space-y-4 pb-4 sm:space-y-5">
      {/* ============ DRAFT RESTORE BANNER ============ */}
      {!isEdit && draftAvailable && draftData && (
        <div className="sales-order-draft flex items-center justify-between gap-3 px-4 py-3 flex-wrap">
          <div className="text-sm text-amber-800">
            <span className="font-semibold">Unsaved draft found</span>
            {draftData.poNumber && <span className="ml-2 font-mono text-amber-700">{draftData.poNumber}</span>}
            {(draftData.items?.length ?? 0) > 0 && (
              <span className="ml-2 text-xs text-amber-600">({draftData.items.length} item{draftData.items.length !== 1 ? 's' : ''})</span>
            )}
          </div>
          <div className="flex gap-2">
            <button onClick={discardDraft} className="btn-ghost text-sm text-amber-700 hover:bg-amber-100">Discard</button>
            <button onClick={restoreDraft} className="btn-primary text-sm bg-amber-600 hover:bg-amber-700 text-white border-amber-600">
              Restore draft
            </button>
          </div>
        </div>
      )}

      {/* ============ TITLE ============ */}
      <header className="sales-order-header flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="sales-order-eyebrow">Sales / Order entry</div>
          <h1 className="mt-1 flex items-center gap-2 text-xl sm:text-2xl font-bold tracking-tight text-slate-900">
          <Package className="h-5 w-5 text-brand-600" />
          {isEdit ? 'Edit Sales Order' : 'New Sales Order'}
          </h1>
          <p className="mt-1 text-xs text-slate-500 sm:text-sm">Set the order header, build line items, and review totals before saving.</p>
        </div>
        {items.length > 0 && (
          <div className="sales-order-header-stats hidden sm:flex items-center gap-2 text-xs text-slate-500">
            <Package className="h-3.5 w-3.5" />
            <span>{items.length} item{items.length === 1 ? '' : 's'}</span>
            <span className="text-slate-300">·</span>
            <span>{totalWeight.toFixed(3)} kg</span>
          </div>
        )}
      </header>

      {/* ============ HEADER ============ */}
      <section className="sales-order-section sales-order-header-card card p-3 sm:p-4">
        <div className="sales-order-section-heading"><div><span>01</span><div><h2>Order details</h2><p>Identify the customer and delivery commitment.</p></div></div><b>Required</b></div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <Field label="Sales Order No." icon={Hash} className="col-span-2 sm:col-span-1">
            <input
              className={inputCls}
              value={poNumber}
              onChange={(e) => setPoNumber(e.target.value.toUpperCase())}
              placeholder="#SO/2026/001"
            />
          </Field>
          <Field label="Customer" icon={User2} className="col-span-2 sm:col-span-2 lg:col-span-1">
            <SearchableSelect
              dense
              value={customerId}
              onChange={setCustomerId}
              options={(customersResp?.items ?? []).map((c) => ({ value: c.id, label: c.name }))}
              placeholder="Select customer…"
            />
          </Field>
          <Field label="Order Date" icon={Calendar}>
            <input
              className={inputCls}
              type="date"
              value={orderDate}
              onChange={(e) => setOrderDate(e.target.value)}
            />
          </Field>
          <Field label="Delivery (days)">
            <input
              className={inputCls}
              type="number"
              inputMode="numeric"
              min={0}
              value={deliveryDays || ''}
              onChange={(e) => setDeliveryDays(parseInt(e.target.value || '0', 10))}
              placeholder="0"
            />
          </Field>
          <Field label="Delivery Date">
            <input className={readonlyInputCls} type="date" value={deliveryDate} readOnly />
          </Field>
        </div>
      </section>

      {/* ============ ITEM ENTRY ============ */}
      <section data-core={coreType || 'TOROIDAL'} className="sales-order-section sales-order-entry card p-3 sm:p-4 space-y-3">
        <div className="sales-order-section-heading flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div><div className="flex items-center gap-2"><span>02</span><h2 className="text-sm font-semibold text-slate-900">Build line item</h2></div></div>
          {/* Segmented pill selector — replaces the dropdown for a touchable, visible toggle */}
          <div className="core-family-selector flex flex-wrap gap-0.5 rounded-lg bg-slate-100 p-0.5 text-sm self-start" aria-label="Core family">
            <button
              type="button"
              onClick={() => pickCore('TOROIDAL')}
              aria-pressed={coreType === 'TOROIDAL'}
              className={cn(
                'rounded-md px-3 py-1.5 font-medium transition',
                coreType === 'TOROIDAL'
                  ? 'bg-white text-amber-700 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              )}
            >
              Toroidal
            </button>
            <button
              type="button"
              onClick={() => pickCore('RECTANGULAR')}
              aria-pressed={coreType === 'RECTANGULAR'}
              className={cn(
                'rounded-md px-3 py-1.5 font-medium transition',
                coreType === 'RECTANGULAR'
                  ? 'bg-white text-rose-700 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              )}
            >
              Rectangular
            </button>
            <button
              type="button"
              onClick={() => pickCore('NANO')}
              aria-pressed={coreType === 'NANO'}
              className={cn(
                'rounded-md px-3 py-1.5 font-medium transition',
                coreType === 'NANO'
                  ? 'bg-white text-violet-700 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              )}
            >
              Nano
            </button>
            <button
              type="button"
              onClick={() => pickCore('COMPOSITE')}
              aria-pressed={coreType === 'COMPOSITE'}
              className={cn(
                'rounded-md px-3 py-1.5 font-medium transition',
                coreType === 'COMPOSITE'
                  ? 'bg-white text-teal-700 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              )}
            >
              Composite
            </button>
          </div>
        </div>

        {/* Form on the left, model on the right. The dock is sticky so the
            solid stays in view while someone works down a long form, and it
            drops below the fields on a narrow screen rather than squeezing
            them into a column too thin to type in. */}
        <div className="core-builder-layout grid gap-3 xl:grid-cols-[minmax(0,1fr)_320px]">
          <div className="min-w-0">
        {coreType === 'TOROIDAL' && (
          <ToroidalForm
            onShape={setReport}
            customerId={customerId}
            customerFactor={selectedCustomer?.toroidalFactor}
            grades={(gradesResp?.grades ?? []).filter((g) => gradeAppliesTo(g, 'TOROIDAL'))}
            fluxGrades={fluxResp?.grades ?? []}
            onAdd={(item) => { setItems((prev) => [...prev, item]); }}
            prefill={prefill}
            onPrefillConsumed={() => setPrefill(null)}
            edit={editSeed?.item.coreType === 'TOROIDAL' ? editSeed : null}
            onEditConsumed={() => setEditSeed(null)}
          />
        )}
        {coreType === 'RECTANGULAR' && (
          <RectangularForm
            onShape={setReport}
            customerId={customerId}
            customerFactor={selectedCustomer?.rectStackFactor}
            grades={(gradesResp?.grades ?? []).filter((g) => gradeAppliesTo(g, 'RECTANGULAR'))}
            fluxGrades={fluxRespRect?.grades ?? []}
            onAdd={(item) => { setItems((prev) => [...prev, item]); }}
            prefill={prefill}
            onPrefillConsumed={() => setPrefill(null)}
            edit={editSeed?.item.coreType === 'RECTANGULAR' ? editSeed : null}
            onEditConsumed={() => setEditSeed(null)}
          />
        )}
        {coreType === 'NANO' && (
          <NanoForm
            onShape={setReport}
            grades={(gradesResp?.grades ?? []).filter((g) => gradeAppliesTo(g, 'NANO'))}
            fluxGrades={fluxRespNano?.grades ?? []}
            onAdd={(item) => { setItems((prev) => [...prev, item]); }}
            prefill={prefill}
            onPrefillConsumed={() => setPrefill(null)}
            edit={editSeed?.item.coreType === 'NANO' ? editSeed : null}
            onEditConsumed={() => setEditSeed(null)}
          />
        )}
        {coreType === 'COMPOSITE' && (
          <NanoForm
            composite
            onShape={setReport}
            customerFactor={selectedCustomer?.toroidalFactor}
            grades={(gradesResp?.grades ?? []).filter((g) => gradeAppliesTo(g, 'NANO'))}
            typeGrades={(gradesResp?.grades ?? []).filter((g) => gradeAppliesTo(g, 'COMPOSITE'))}
            fluxGrades={fluxRespNano?.grades ?? []}
            onAdd={(item) => { setItems((prev) => [...prev, item]); }}
            prefill={prefill}
            onPrefillConsumed={() => setPrefill(null)}
            edit={editSeed?.item.coreType === 'COMPOSITE' ? editSeed : null}
            onEditConsumed={() => setEditSeed(null)}
          />
        )}
        {!coreType && (
          <div className="rounded-lg border border-dashed border-slate-300 px-4 py-6 text-center text-sm text-slate-500">
            Pick a core type above to start adding items.
          </div>
        )}
          </div>

          {coreType && (
            <div className="min-w-0 xl:sticky xl:top-3 xl:self-start">
              <CorePreview
                shape={shape ?? emptyShapeFor(coreType)}
                meta={{
                  ...(report?.meta ?? {}),
                  company: companyName,
                  customer: selectedCustomer?.name ?? null,
                }}
                className="core-model-stage h-[260px] xl:h-[360px]"
              />
            </div>
          )}
        </div>
      </section>

      {/* ============ ITEMS LIST ============ */}
      <section className="sales-order-section sales-order-items card overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2.5 sm:px-4">
          <div><div className="flex items-center gap-2"><span className="sales-order-section-number">03</span><h2 className="text-sm font-semibold text-slate-900">
            Items <span className="font-normal text-slate-400">({items.length})</span>
          </h2></div><p className="mt-0.5 text-[11px] text-slate-500">Review, expand, copy, or edit each order line.</p></div>
          <div className="text-xs text-slate-500">
            Total: <span className="font-semibold text-slate-900 tabular-nums">{totalWeight.toFixed(3)} kg</span>
          </div>
        </div>

        {/* ---- Mobile card list (< md) ---- */}
        <div className="md:hidden divide-y divide-slate-100">
          {items.length === 0 && (
            <div className="px-4 py-8 text-center text-sm text-slate-400">No items added yet.</div>
          )}
          {items.map((it, idx) => (
            <div key={idx} className="px-3 py-2.5">
              <div className="flex items-start gap-3">
              <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-slate-100 font-mono text-[11px] text-slate-600">
                {idx + 1}
              </div>
              <div className="min-w-0 flex-1">
                <div className="mb-0.5 flex items-center gap-2">
                  <span className={cn(
                    'rounded-full px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide',
                    coreBadge(it.coreType)
                  )}>
                    {coreShort(it.coreType)}
                  </span>
                  <span className="truncate text-xs text-slate-600">
                    {it.grade}{it.material ? ` · ${it.material}` : ''}
                  </span>
                </div>
                <div className="font-mono text-[11px] text-slate-700 break-all">{it.measure}</div>
                <div className="mt-1 flex justify-between text-xs">
                  <span className="text-slate-500 tabular-nums">
                    {it.pcs} × {it.weightPerPc.toFixed(3)}
                  </span>
                  <span className="font-semibold text-slate-900 tabular-nums">{it.totalWeight.toFixed(3)} kg</span>
                </div>
                {it.totalAmount != null && (
                  <div className="mt-0.5 flex justify-between text-[11px]">
                    <span className="text-slate-400 font-mono tabular-nums">
                      ₹{money0(it.rateValue)}{it.rateBasis === 'PER_KG' ? '/kg' : '/pc'}
                    </span>
                    <span className="font-semibold text-brand-700 tabular-nums">₹{money0(it.totalAmount)}</span>
                  </div>
                )}
              </div>
              <div className="flex-shrink-0 flex items-center gap-0.5">
                <button
                  type="button"
                  onClick={() => toggleExpand(idx)}
                  title={expandedIdx === idx ? 'Hide details' : 'Show details'}
                  aria-label="Toggle details"
                  className="rounded-md p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                >
                  {expandedIdx === idx ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                </button>
                {!it._dbId && (
                  <button
                    type="button"
                    onClick={() => editItem(idx)}
                    title="Edit this line"
                    aria-label="Edit line"
                    className="rounded-md p-1.5 text-brand-600 transition hover:bg-brand-50"
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => copyToForm(it)}
                  title="Copy grade, material & rate basis to the form"
                  aria-label="Copy to form"
                  className="rounded-md p-1.5 text-slate-400 transition hover:bg-brand-50 hover:text-brand-600"
                >
                  <Copy className="h-4 w-4" />
                </button>
                {isEdit && it._dbId && !it._locked && (
                  <Link
                    to={`/po/manage/${it._dbId}`}
                    className="rounded-md p-1.5 text-brand-600 hover:bg-brand-50 transition"
                    title="Edit item dimensions"
                  >
                    <Pencil className="h-4 w-4" />
                  </Link>
                )}
                <button
                  type="button"
                  onClick={() => removeItem(idx)}
                  disabled={it._locked}
                  title={it._locked ? 'Cannot remove — production already recorded' : 'Remove item'}
                  className={cn(
                    'rounded-md p-1.5 transition',
                    it._locked
                      ? 'text-slate-300 cursor-not-allowed'
                      : 'text-slate-400 hover:bg-red-50 hover:text-red-600'
                  )}
                  aria-label="Remove item"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
              </div>
              {expandedIdx === idx && (
                <div className="mt-2 -mx-3 -mb-2.5 overflow-hidden rounded-b-lg border-t border-slate-100"><ItemDetails it={it} /></div>
              )}
            </div>
          ))}
        </div>

        {/* ---- Desktop table (md+) ---- */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2 font-medium">SN</th>
                <th className="px-3 py-2 font-medium">Type</th>
                <th className="px-3 py-2 font-medium">Grade</th>
                <th className="px-3 py-2 font-medium">Material</th>
                <th className="px-3 py-2 font-medium">Measure</th>
                <th className="px-3 py-2 text-right font-medium">Wt/pc</th>
                <th className="px-3 py-2 text-right font-medium">Pcs</th>
                <th className="px-3 py-2 text-right font-medium">Weight</th>
                <th className="px-3 py-2 text-right font-medium">Rate</th>
                <th className="px-3 py-2 text-right font-medium">Amount</th>
                <th className="w-10 px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 && (
                <tr><td colSpan={11} className="px-3 py-8 text-center text-sm text-slate-400">No items added yet.</td></tr>
              )}
              {items.map((it, idx) => (
                <Fragment key={idx}>
                <tr className="border-t border-slate-100 hover:bg-slate-50/60">
                  <td className="px-3 py-2 font-mono text-xs text-slate-500">{idx + 1}</td>
                  <td className="px-3 py-2">
                    <span className={cn(
                      'rounded-full px-2 py-0.5 text-[11px] font-medium',
                      coreBadge(it.coreType)
                    )}>
                      {it.coreType}
                    </span>
                  </td>
                  <td className="px-3 py-2">{it.grade}</td>
                  <td className="px-3 py-2">{it.material}</td>
                  <td className="px-3 py-2 font-mono text-xs">{it.measure}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">{it.weightPerPc.toFixed(3)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{it.pcs}</td>
                  <td className="px-3 py-2 text-right font-mono font-semibold tabular-nums">{it.totalWeight.toFixed(3)}</td>
                  <td className="px-3 py-2 text-right font-mono text-xs tabular-nums text-slate-600">
                    {it.rateValue
                      ? `₹${money0(it.rateValue)} ${it.rateBasis === 'PER_KG' ? '/kg' : '/pc'}`
                      : '—'}
                  </td>
                  <td className="px-3 py-2 text-right font-mono font-semibold tabular-nums">
                    {it.totalAmount ? `₹${money0(it.totalAmount)}` : '—'}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <div className="inline-flex items-center gap-0.5">
                      <button
                        type="button"
                        onClick={() => toggleExpand(idx)}
                        title={expandedIdx === idx ? 'Hide details' : 'Show details'}
                        aria-label="Toggle details"
                        className="rounded-md p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                      >
                        {expandedIdx === idx ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      </button>
                      {!it._dbId && (
                        <button
                          type="button"
                          onClick={() => editItem(idx)}
                          title="Edit this line"
                          aria-label="Edit line"
                          className="rounded-md p-1.5 text-brand-600 transition hover:bg-brand-50"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => copyToForm(it)}
                        title="Copy grade, material & rate basis to the form"
                        aria-label="Copy to form"
                        className="rounded-md p-1.5 text-slate-400 transition hover:bg-brand-50 hover:text-brand-600"
                      >
                        <Copy className="h-4 w-4" />
                      </button>
                      {isEdit && it._dbId && !it._locked && (
                        <Link
                          to={`/po/manage/${it._dbId}`}
                          className="rounded-md p-1.5 text-brand-600 hover:bg-brand-50 transition"
                          title="Edit item dimensions"
                        >
                          <Pencil className="h-4 w-4" />
                        </Link>
                      )}
                      <button
                        type="button"
                        onClick={() => removeItem(idx)}
                        disabled={it._locked}
                        title={it._locked ? 'Cannot remove — production already recorded' : 'Remove item'}
                        className={cn(
                          'rounded-md p-1.5 transition',
                          it._locked
                            ? 'text-slate-300 cursor-not-allowed'
                            : 'text-slate-400 hover:bg-red-50 hover:text-red-600'
                        )}
                        aria-label="Remove item"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </tr>
                {expandedIdx === idx && (
                  <tr><td colSpan={11} className="p-0"><ItemDetails it={it} /></td></tr>
                )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ============ PRICING SUMMARY ============
          Only renders when at least one item has a rate. GST applied uses the
          selected customer's gstRate (defaults to 0% when no customer picked). */}
      {subtotal > 0 && (
        <section className="sales-order-section sales-order-pricing card p-3 sm:p-4">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900">Pricing summary</h2>
            <div className="text-[11px] text-slate-500">
              GST: <span className="font-semibold text-slate-700">{gstRate}%</span>
              {selectedCustomer && <span className="ml-1 text-slate-400">({selectedCustomer.name})</span>}
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center sm:grid-cols-3">
            <div className="rounded-md bg-slate-50 px-3 py-2.5">
              <div className="text-[10px] uppercase tracking-wide text-slate-500">Pre-tax</div>
              <div className="mt-0.5 font-mono tabular-nums text-sm font-semibold text-slate-900">₹{fmtMoney(subtotal)}</div>
            </div>
            <div className="rounded-md bg-slate-50 px-3 py-2.5">
              <div className="text-[10px] uppercase tracking-wide text-slate-500">GST {gstRate}%</div>
              <div className="mt-0.5 font-mono tabular-nums text-sm font-semibold text-slate-700">₹{fmtMoney(gstAmount)}</div>
            </div>
            <div className="rounded-md bg-brand-50 ring-1 ring-brand-200 px-3 py-2.5">
              <div className="text-[10px] uppercase tracking-wide text-brand-700">Grand Total</div>
              <div className="mt-0.5 font-mono tabular-nums text-base font-bold text-brand-900">₹{fmtMoney(grandTotal)}</div>
            </div>
          </div>
          {!selectedCustomer && (
            <div className="mt-2 text-[11px] text-amber-700">Pick a customer above to apply their GST rate.</div>
          )}
        </section>
      )}

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

      {/* ============ ACTIONS ============
          On mobile: Submit is full-width and primary, Cancel secondary below.
          On desktop: right-aligned pair. */}
      <div className="sales-order-actions flex flex-col-reverse gap-2 sm:flex-row sm:justify-end sm:gap-3">
        <button
          type="button"
          onClick={() => navigate(isEdit ? '/po/summary' : '/')}
          className="btn-ghost w-full sm:w-auto"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onSubmit}
          disabled={submit.isPending || editSubmit.isPending}
          className="btn-primary w-full sm:w-auto"
        >
          {(submit.isPending || editSubmit.isPending)
            ? <Loader2 className="h-4 w-4 animate-spin" />
            : <Save className="h-4 w-4" />}
          {isEdit ? 'Save Changes' : 'Submit Sales Order'}
        </button>
      </div>
      {confirmDialog}
    </div>
  );
};

/* ====================================================================
   Sub-components
==================================================================== */

const Field = ({
  label, icon: Icon, children, className,
}: {
  label: string;
  icon?: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
  className?: string;
}) => (
  <label className={cn('block', className)}>
    <span className="mb-1 flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-slate-500">
      {Icon && <Icon className="h-3 w-3" />}
      {label}
    </span>
    {children}
  </label>
);

const NumField = ({
  label, value, onChange, w, hint, align = 'left',
}: {
  label: string; value: number; onChange: (v: number) => void; w?: string;
  /** Small note under the field — a unit, a default, a where-it-came-from. */
  hint?: React.ReactNode;
  /** Figures that are read down a column (money, weights) line up on the
   *  decimal point when right-aligned; dimensions typed left-to-right do not
   *  benefit, so alignment is per-field rather than global. */
  align?: 'left' | 'right';
}) => (
  <Field label={label} className={w}>
    <input
      className={cn(inputCls, 'font-num', align === 'right' && 'text-right')}
      type="number"
      inputMode="decimal"
      step="any"
      value={value === 0 ? '' : value}
      onChange={(e) => onChange(numFromInput(e.target.value))}
      placeholder="0"
    />
    {hint}
  </Field>
);

/* The stacking factor that turns geometry into weight.
   Shown on every toroidal/rectangular line because it is the one number in the
   weight calculation that varies by agreement rather than by physics, and an
   operator who cannot see it cannot tell a 5.77 core from a 5.80 one.

   `base` is what this line started from — the customer's figure if they have
   one, otherwise the house default. The reset link only appears once the value
   has actually been moved off `base`, so the common case stays quiet. */
const StackFactorField = ({
  value, onChange, onReset, base, houseDefault, fromCustomer, w,
}: {
  value: number;
  onChange: (v: number) => void;
  onReset: () => void;
  base: number;
  houseDefault: number;
  fromCustomer: boolean;
  w?: string;
}) => {
  const overridden = Math.abs(value - base) > 1e-9;
  return (
    <div className={cn('shrink-0', w)}>
      <Field label="Stacking factor">
        <input
          className={cn(inputCls, 'font-num text-right', overridden && 'border-amber-400 bg-amber-50/60')}
          type="number"
          inputMode="decimal"
          step="any"
          value={value === 0 ? '' : value}
          onChange={(e) => onChange(numFromInput(e.target.value))}
          placeholder={String(houseDefault)}
        />
      </Field>
      {overridden ? (
        <button
          type="button"
          onClick={onReset}
          className="mt-1 block text-[10px] font-medium text-amber-700 underline-offset-2 hover:underline"
        >
          &#8634; back to {base}
        </button>
      ) : fromCustomer ? (
        <div className="mt-1 text-[10px] font-medium text-brand-700">
          Customer&rsquo;s (std {houseDefault})
        </div>
      ) : null}
    </div>
  );
};

const GradeMaterialPicker = ({
  grades, grade, material, onGrade, onMaterial,
}: {
  grades: GradeRow[];
  grade: string; material: string;
  onGrade: (v: string) => void; onMaterial: (v: string) => void;
  listIdSuffix?: string; // kept for API compat, no longer used
}) => {
  const matchingMaterials = grades.find((g) => g.grade === grade)?.materials ?? [];
  return (
    <>
      <Field label="Grade">
        <SearchableSelect
          dense
          value={grade}
          onChange={(v) => {
            onGrade(v);
            // Auto-pick the first material for this grade — user can still change it.
            const firstMaterial = grades.find((g) => g.grade === v)?.materials[0]?.material ?? '';
            onMaterial(firstMaterial);
          }}
          options={grades.map((g) => ({ value: g.grade, label: g.grade }))}
          placeholder="Select grade…"
        />
      </Field>
      <Field label="Material">
        <SearchableSelect
          dense
          value={material}
          onChange={onMaterial}
          options={matchingMaterials.map((m) => ({ value: m.material, label: m.material }))}
          placeholder={grade ? 'Select material…' : 'Pick grade first'}
          disabled={!grade}
        />
      </Field>
    </>
  );
};

/* Compact "computed value" display.
   Labels render in their natural case so engineering conventions like
   "Flux ( T )", "ATe/cm", "V (Volts)", "Ie max (mA)" survive verbatim. */
const Stat = ({ label, value, accent }: { label: string; value: string; accent?: 'primary' }) => (
  <div className="core-result min-w-0">
    <div className="text-[10px] font-medium tracking-wide text-slate-500">{label}</div>
    <div className={cn(
      'truncate font-mono tabular-nums leading-tight',
      accent === 'primary' ? 'text-sm font-semibold text-slate-900' : 'text-sm text-slate-700'
    )}>
      {value}
    </div>
  </div>
);

/* ---------- TOROIDAL ---------- */
export const ToroidalForm = ({
  grades, fluxGrades, onAdd, prefill, onPrefillConsumed, edit, onEditConsumed, hideTesting = false,
  customerId, customerFactor, onShape,
}: {
  grades: GradeRow[];
  fluxGrades: FluxGroup[];
  onAdd: (item: Item) => void;
  /** Reports the live dimensions to the 3D preview. */
  onShape?: (r: ShapeReport) => void;
  /** Whose rate card to consult. Optional: the quotation screen has no
   *  customer, and passing none simply means nothing is filled in. */
  customerId?: string;
  /** The customer's agreed toroidal factor. Undefined/null = house default. */
  customerFactor?: number | null;
  prefill?: { coreType: CoreType; grade: string; material: string; rateBasis: 'PER_KG' | 'PER_PCS' } | null;
  onPrefillConsumed?: () => void;
  edit?: { item: Item; nonce: number } | null;
  onEditConsumed?: () => void;
  /** Quotation mode — flux/test calibration is irrelevant to a quote, so hide it. */
  hideTesting?: boolean;
}) => {
  const [grade, setGrade] = useState('');
  const [material, setMaterial] = useState('');
  const [id, setId] = useState(0);
  const [od, setOd] = useState(0);
  const [ht, setHt] = useState(0);
  const [pcs, setPcs] = useState(0);
  const [turns, setTurns] = useState(0);
  const [flux, setFlux] = useState(0);
  // Pricing
  const [rateBasis, setRateBasis] = useState<'PER_KG' | 'PER_PCS'>('PER_KG');
  const [rateValue, setRateValue] = useState(0);
  // Set as soon as anyone edits the rate, so a lookup that resolves a
  // moment later can never overwrite a figure typed on purpose.
  const [rateTouched, setRateTouched] = useState(false);
  // Stacking factor — seeded from the customer, overridable per line. Same
  // "don't clobber what someone typed" rule as the rate: once touched, a
  // customer switch leaves the entered figure alone.
  const [stack, setStack] = useState(stackOr(customerFactor, TOROIDAL_FACTOR));
  const [stackTouched, setStackTouched] = useState(false);
  useEffect(() => {
    if (!stackTouched) setStack(stackOr(customerFactor, TOROIDAL_FACTOR));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerFactor]);
  const cardRate = useCustomerRate(customerId, grade, 'TOROIDAL');
  useAutoFillRate(cardRate, rateTouched, (r) => { setRateBasis(r.rateBasis); setRateValue(r.rateValue); });
  const pendingFlux = useRef<number | null>(null);

  // Fluxes available for the currently selected grade — driven entirely by
  // what's been recorded in Settings → Flux Grades for this company.
  const fluxPoints = fluxGrades.find((g) => g.grade === grade)?.points ?? [];
  const ateCm = fluxPoints.find((p) => p.flux === flux)?.ateCm ?? 0;
  const gradeHasFluxData = fluxPoints.length > 0;
  const fluxOptions = fluxPoints.map((p) => ({ value: String(p.flux), label: `${p.flux.toFixed(2)} T` }));

  // Reset flux when the grade changes; keep the edited flux when loading a row.
  useEffect(() => {
    if (pendingFlux.current != null) { setFlux(pendingFlux.current); pendingFlux.current = null; }
    else setFlux(0);
  }, [grade]);

  // Apply a one-shot "copy from row" prefill (grade / material / rate basis).
  useEffect(() => {
    if (!prefill || prefill.coreType !== 'TOROIDAL') return;
    setGrade(prefill.grade);
    setMaterial(prefill.material);
    setRateBasis(prefill.rateBasis);
    onPrefillConsumed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefill]);

  // Load a full row for editing.
  useEffect(() => {
    if (!edit || edit.item.coreType !== 'TOROIDAL') return;
    const it = edit.item;
    setMaterial(it.material);
    setId(it.id1); setOd(it.od1); setHt(it.ht); setPcs(it.pcs);
    setTurns(it.turns ?? 0);
    setRateBasis(it.rateBasis ?? 'PER_KG'); setRateValue(it.rateValue ?? 0);
    setRateTouched(true);   // the line already carries a price; leave it be
    // Re-weigh on the factor the line was BOOKED with, not today's default —
    // otherwise opening a line to fix a typo silently changes its weight.
    setStack(stackOr(it.stackFactor, TOROIDAL_FACTOR)); setStackTouched(true);
    pendingFlux.current = it.flux ?? 0;
    setGrade(it.grade);
    onEditConsumed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [edit?.nonce]);

  const calc = useMemo(() => toroidalCalc({ id, od, ht, pcs, factor: stack }), [id, od, ht, pcs, stack]);
  useReportShape(
    onShape,
    () => ({
      shape: { kind: 'TOROIDAL', dims: { id, od, ht } },
      meta: { grade, material, pcs, factor: stack, weightPerPc: calc.weightPerPc, totalWeight: calc.totalWeight },
    }),
    [id, od, ht, grade, material, pcs, stack, calc.weightPerPc, calc.totalWeight],
  );
  const fluxCalc = useMemo(
    () => fluxTestCalc({ id, od, ht, turns, flux, ateCm }),
    [id, od, ht, turns, flux, ateCm]
  );

  // Derive the OTHER rate + line total locally — must match server's deriveRate.
  const ratePerKg = rateValue > 0
    ? (rateBasis === 'PER_KG' ? rateValue : (calc.weightPerPc > 0 ? rateValue / calc.weightPerPc : 0))
    : 0;
  const ratePerPc = rateValue > 0
    ? (rateBasis === 'PER_KG' ? rateValue * calc.weightPerPc : rateValue)
    : 0;
  const totalAmount = rateValue > 0
    ? (rateBasis === 'PER_KG' ? rateValue * calc.totalWeight : rateValue * pcs)
    : 0;

  const { alert: showAlert, confirmDialog: alertDialog } = useConfirm();

  const reset = () => {
    setGrade(''); setMaterial('');
    setId(0); setOd(0); setHt(0); setPcs(0);
    setTurns(0); setFlux(0);
    setRateValue(0); setRateTouched(false);
    setStack(stackOr(customerFactor, TOROIDAL_FACTOR)); setStackTouched(false);
  };

  const add = async () => {
    if (!grade || !material) {
      await showAlert({ title: 'Missing fields', message: 'Pick grade and material before adding.', tone: 'warning' });
      return;
    }
    if (calc.weightPerPc <= 0 || pcs <= 0) {
      await showAlert({ title: 'Invalid input', message: 'Enter valid dimensions and pieces.', tone: 'warning' });
      return;
    }
    onAdd({
      coreType: 'TOROIDAL', grade, material, measure: calc.measure,
      id1: id, od1: od, ht, pcs,
      weightPerPc: calc.weightPerPc, totalWeight: calc.totalWeight,
      stackFactor: stack,
      // Only attach test-calibration values when the user actually filled them.
      turns:       turns > 0 ? turns : undefined,
      flux:        flux  > 0 ? flux  : undefined,
      ateCm:       flux  > 0 && ateCm > 0 ? ateCm : undefined,
      testVoltage: fluxCalc.testVoltage > 0 ? fluxCalc.testVoltage : undefined,
      testCurrent: fluxCalc.testCurrent > 0 ? fluxCalc.testCurrent : undefined,
      // Pricing — only attach when user typed a rate.
      rateBasis:   rateValue > 0 ? rateBasis : undefined,
      rateValue:   rateValue > 0 ? rateValue : undefined,
      ratePerKg:   rateValue > 0 ? +ratePerKg.toFixed(4) : undefined,
      ratePerPc:   rateValue > 0 ? +ratePerPc.toFixed(4) : undefined,
      totalAmount: rateValue > 0 ? +totalAmount.toFixed(2) : undefined,
    });
    reset();
  };

  return (
    <div className="core-entry-form rounded-xl border border-amber-200 bg-amber-50/40 p-3 sm:p-4">
      <div className="mb-2 flex items-center gap-2">
        <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
        <span className="text-[11px] font-semibold uppercase tracking-wider text-amber-800">Toroidal</span>
      </div>

      {/* What is being made and what it costs. Names need reading width; the
          rate and the factor do not, so they keep to their own size and the
          row wraps instead of stretching everything to match. */}
      <FieldRow>
        <div className="grid min-w-[240px] flex-1 basis-[300px] grid-cols-1 gap-x-2.5 gap-y-2 sm:max-w-[390px] sm:grid-cols-2">
          <GradeMaterialPicker
            grades={grades} grade={grade} material={material}
            onGrade={setGrade} onMaterial={setMaterial} listIdSuffix="toro"
          />
        </div>
        <Field label="Rate Basis" className={cn('shrink-0', FW.sel)}>
          <SearchableSelect dense value={rateBasis} onChange={(value) => setRateBasis(value === 'PER_PCS' ? 'PER_PCS' : 'PER_KG')} options={[{value:'PER_KG',label:'Per Kg'},{value:'PER_PCS',label:'Per Pcs'}]} />
        </Field>
        <div className={cn('shrink-0', FW.rate)}>
          <NumField
            label={rateBasis === 'PER_KG' ? 'Rate ₹/kg' : 'Rate ₹/pc'}
            align="right"
            value={rateValue}
            onChange={(v) => { setRateTouched(true); setRateValue(v); }}
          />
          {cardRate && !rateTouched && rateValue > 0 && (
            <div className="mt-1 text-[10px] font-medium text-brand-700">
              From the rate card
            </div>
          )}
        </div>
        <StackFactorField
          w={FW.factor}
          value={stack}
          onChange={(v) => { setStackTouched(true); setStack(v); }}
          onReset={() => { setStackTouched(false); setStack(stackOr(customerFactor, TOROIDAL_FACTOR)); }}
          base={stackOr(customerFactor, TOROIDAL_FACTOR)}
          houseDefault={TOROIDAL_FACTOR}
          fromCustomer={stackOr(customerFactor, TOROIDAL_FACTOR) !== TOROIDAL_FACTOR}
        />
      </FieldRow>

      {/* Dimensions and quantity. Millimetre boxes stay narrow; turns/flux are
          hidden in quotation mode, where calibration is not part of a quote. */}
      <FieldRow className="mt-2">
        <NumField label="ID" w={FW.dim} value={id} onChange={setId} />
        <NumField label="OD" w={FW.dim} value={od} onChange={setOd} />
        <NumField label="HT" w={FW.dim} value={ht} onChange={setHt} />
        <NumField label="Pcs" w={FW.qty} align="right" value={pcs} onChange={setPcs} />
        {!hideTesting && (<>
          <NumField label="Turns" w={FW.qty} align="right" value={turns} onChange={setTurns} />
          <Field label="Flux" className={cn('shrink-0', FW.sel)}>
            <SearchableSelect
              dense
              value={flux > 0 ? String(flux) : ''}
              onChange={(v) => setFlux(parseFloat(v) || 0)}
              options={fluxOptions}
              placeholder={
                !grade ? 'Pick grade first'
                : !gradeHasFluxData ? `No flux data for "${grade}"`
                : 'Select flux…'
              }
              disabled={!grade || !gradeHasFluxData}
            />
          </Field>
        </>)}
      </FieldRow>

      {/* Computed values — geometry + flux-test results.
          Heading order matches the production sheet: Flux ( T ) → ATe/cm → V (Volts) → Ie max (mA). */}
      <div className="mt-3 rounded-md border border-amber-100 bg-white/60 px-3 py-2">
        <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 sm:grid-cols-6">
          <Stat label="Wt / pc"      value={calc.weightPerPc.toFixed(3)} />
          <Stat label="Total Wt"     value={calc.totalWeight.toFixed(3)} accent="primary" />
          {!hideTesting && (<>
            <Stat label="Flux ( T )"   value={flux > 0 ? `${flux.toFixed(2)} T` : '—'} />
            <Stat label="ATe/cm"       value={ateCm > 0 ? ateCm.toFixed(3) : '—'} />
            <Stat label="V (Volts)"    value={fluxCalc.testVoltage > 0 ? fluxCalc.testVoltage.toFixed(3) : '—'} />
            <Stat label="Ie max (mA)"  value={
              fluxCalc.testCurrent > 0
                ? fluxCalc.testCurrent.toFixed(2)
                : flux > 0 && ateCm === 0
                  ? 'Set ATe/cm'
                  : '—'
            } />
          </>)}
          <div className="col-span-2 sm:col-span-6">
            <Stat label="Measure" value={calc.measure} />
          </div>
        </div>
        {rateValue > 0 && (
          <div className="mt-2 grid grid-cols-3 gap-x-3 gap-y-1.5 border-t border-amber-100 pt-2">
            <Stat label="Rate / Kg"  value={`₹${money0(ratePerKg)}`} />
            <Stat label="Rate / Pc"  value={`₹${money0(ratePerPc)}`} />
            <Stat label="Line Total" value={`₹${money0(totalAmount)}`} accent="primary" />
          </div>
        )}
      </div>

      <div className="mt-3 flex justify-end">
        <button onClick={add} className="btn-primary w-full sm:w-auto" type="button">
          <Plus className="h-4 w-4" /> Add toroidal item
        </button>
      </div>
      {alertDialog}
    </div>
  );
};

/* ---------- RECTANGULAR ---------- */
export const RectangularForm = ({
  grades, fluxGrades, onAdd, prefill, onPrefillConsumed, edit, onEditConsumed, hideTesting = false,
  customerId, customerFactor, onShape,
}: {
  grades: GradeRow[];
  fluxGrades: FluxGroup[];
  onAdd: (item: Item) => void;
  /** Reports the live dimensions to the 3D preview. */
  onShape?: (r: ShapeReport) => void;
  /** Whose rate card to consult. Optional: the quotation screen has no
   *  customer, and passing none simply means nothing is filled in. */
  customerId?: string;
  /** The customer's agreed rectangular stacking factor; null = house default. */
  customerFactor?: number | null;
  prefill?: { coreType: CoreType; grade: string; material: string; rateBasis: 'PER_KG' | 'PER_PCS' } | null;
  onPrefillConsumed?: () => void;
  edit?: { item: Item; nonce: number } | null;
  onEditConsumed?: () => void;
  /** Quotation mode — flux/test calibration is irrelevant to a quote, so hide it. */
  hideTesting?: boolean;
}) => {
  const [grade, setGrade] = useState('');
  const [material, setMaterial] = useState('');
  const [id1, setId1] = useState(0);
  const [id2, setId2] = useState(0);
  const [od1, setOd1] = useState(0);
  const [od2, setOd2] = useState(0);
  const [ht, setHt] = useState(0);
  const [pcs, setPcs] = useState(0);
  const [turns, setTurns] = useState(0);
  const [flux, setFlux] = useState(0);
  const [rateBasis, setRateBasis] = useState<'PER_KG' | 'PER_PCS'>('PER_KG');
  const [rateValue, setRateValue] = useState(0);
  // Set as soon as anyone edits the rate, so a lookup that resolves a
  // moment later can never overwrite a figure typed on purpose.
  const [rateTouched, setRateTouched] = useState(false);
  // Stacking factor — seeded from the customer, overridable per line.
  const [stack, setStack] = useState(stackOr(customerFactor, RECT_STACK_FACTOR));
  const [stackTouched, setStackTouched] = useState(false);
  useEffect(() => {
    if (!stackTouched) setStack(stackOr(customerFactor, RECT_STACK_FACTOR));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerFactor]);
  const cardRate = useCustomerRate(customerId, grade, 'RECTANGULAR');
  useAutoFillRate(cardRate, rateTouched, (r) => { setRateBasis(r.rateBasis); setRateValue(r.rateValue); });
  const pendingFlux = useRef<number | null>(null);

  // Rectangular flux table (already filtered to coreType=RECTANGULAR by the query).
  const fluxPoints = fluxGrades.find((g) => g.grade === grade)?.points ?? [];
  const ateCm = fluxPoints.find((p) => p.flux === flux)?.ateCm ?? 0;
  const gradeHasFluxData = fluxPoints.length > 0;
  const fluxOptions = fluxPoints.map((p) => ({ value: String(p.flux), label: `${p.flux.toFixed(2)} T` }));

  // Reset flux when the grade changes; keep the edited flux when loading a row.
  useEffect(() => {
    if (pendingFlux.current != null) { setFlux(pendingFlux.current); pendingFlux.current = null; }
    else setFlux(0);
  }, [grade]);

  // Apply a one-shot "copy from row" prefill (grade / material / rate basis).
  useEffect(() => {
    if (!prefill || prefill.coreType !== 'RECTANGULAR') return;
    setGrade(prefill.grade);
    setMaterial(prefill.material);
    setRateBasis(prefill.rateBasis);
    onPrefillConsumed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefill]);

  // Load a full row for editing.
  useEffect(() => {
    if (!edit || edit.item.coreType !== 'RECTANGULAR') return;
    const it = edit.item;
    setMaterial(it.material);
    setId1(it.id1); setId2(it.id2 ?? 0); setOd1(it.od1); setOd2(it.od2 ?? 0); setHt(it.ht); setPcs(it.pcs);
    setTurns(it.turns ?? 0);
    setRateBasis(it.rateBasis ?? 'PER_KG'); setRateValue(it.rateValue ?? 0);
    setRateTouched(true);   // the line already carries a price; leave it be
    // Re-weigh on the factor the line was BOOKED with, not today's default.
    setStack(stackOr(it.stackFactor, RECT_STACK_FACTOR)); setStackTouched(true);
    pendingFlux.current = it.flux ?? 0;
    setGrade(it.grade);
    onEditConsumed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [edit?.nonce]);

  const calc = useMemo(
    () => rectangularCalc({ id1, id2, od1, od2, ht, pcs, factor: stack }),
    [id1, id2, od1, od2, ht, pcs, stack]
  );
  useReportShape(
    onShape,
    () => ({
      shape: { kind: 'RECTANGULAR', id1, id2, od1, od2, ht },
      meta: { grade, material, pcs, factor: stack, weightPerPc: calc.weightPerPc, totalWeight: calc.totalWeight },
    }),
    [id1, id2, od1, od2, ht, grade, material, pcs, stack, calc.weightPerPc, calc.totalWeight],
  );
  const fluxCalc = useMemo(
    () => rectangularFluxTestCalc({
      area: calc.coreAc, meanPath: calc.coreMl, turns, flux, ateCm,
    }),
    [calc.coreAc, calc.coreMl, turns, flux, ateCm]
  );

  // Build-symmetry validation per the spec: (OD-1 − ID-1) must equal (OD-2 − ID-2).
  // Show a soft warning so the user notices, but don't block — the existing
  // form has always allowed asymmetric input.
  const buildMismatch =
    od1 > 0 && id1 > 0 && od2 > 0 && id2 > 0 &&
    Math.abs((od1 - id1) - (od2 - id2)) > 0.001;

  const { alert: showAlert, confirmDialog: alertDialog } = useConfirm();

  // Same client-side rate derivation as the toroidal form.
  const ratePerKg = rateValue > 0
    ? (rateBasis === 'PER_KG' ? rateValue : (calc.weightPerPc > 0 ? rateValue / calc.weightPerPc : 0))
    : 0;
  const ratePerPc = rateValue > 0
    ? (rateBasis === 'PER_KG' ? rateValue * calc.weightPerPc : rateValue)
    : 0;
  const totalAmount = rateValue > 0
    ? (rateBasis === 'PER_KG' ? rateValue * calc.totalWeight : rateValue * pcs)
    : 0;

  const reset = () => {
    setGrade(''); setMaterial('');
    setId1(0); setId2(0); setOd1(0); setOd2(0); setHt(0); setPcs(0);
    setTurns(0); setFlux(0);
    setRateValue(0); setRateTouched(false);
    setStack(stackOr(customerFactor, RECT_STACK_FACTOR)); setStackTouched(false);
  };

  const add = async () => {
    if (!grade || !material) {
      await showAlert({ title: 'Missing fields', message: 'Pick grade and material before adding.', tone: 'warning' });
      return;
    }
    if (calc.weightPerPc <= 0 || pcs <= 0) {
      await showAlert({ title: 'Invalid input', message: 'Enter valid dimensions and pieces.', tone: 'warning' });
      return;
    }
    onAdd({
      coreType: 'RECTANGULAR', grade, material, measure: calc.measure,
      id1, id2, od1, od2, ht, builtup: calc.builtup, pcs,
      weightPerPc: calc.weightPerPc, totalWeight: calc.totalWeight,
      coreAc: calc.coreAc, coreMl: calc.coreMl, d13: calc.d13,
      stackFactor: stack,
      // Flux-test fields — only included when the user filled them.
      turns:       turns > 0 ? turns : undefined,
      flux:        flux  > 0 ? flux  : undefined,
      ateCm:       flux  > 0 && ateCm > 0 ? ateCm : undefined,
      testVoltage: fluxCalc.testVoltage > 0 ? fluxCalc.testVoltage : undefined,
      testCurrent: fluxCalc.testCurrent > 0 ? fluxCalc.testCurrent : undefined,
      // Pricing
      rateBasis:   rateValue > 0 ? rateBasis : undefined,
      rateValue:   rateValue > 0 ? rateValue : undefined,
      ratePerKg:   rateValue > 0 ? +ratePerKg.toFixed(4) : undefined,
      ratePerPc:   rateValue > 0 ? +ratePerPc.toFixed(4) : undefined,
      totalAmount: rateValue > 0 ? +totalAmount.toFixed(2) : undefined,
    });
    reset();
  };

  return (
    <div className="core-entry-form rounded-xl border border-rose-200 bg-rose-50/40 p-3 sm:p-4">
      <div className="mb-2 flex items-center gap-2">
        <span className="h-1.5 w-1.5 rounded-full bg-rose-500" />
        <span className="text-[11px] font-semibold uppercase tracking-wider text-rose-800">Rectangular</span>
      </div>

      {/* Identity and price — same rhythm as the toroidal form above. */}
      <FieldRow>
        <div className="grid min-w-[240px] flex-1 basis-[300px] grid-cols-1 gap-x-2.5 gap-y-2 sm:max-w-[390px] sm:grid-cols-2">
          <GradeMaterialPicker
            grades={grades} grade={grade} material={material}
            onGrade={setGrade} onMaterial={setMaterial} listIdSuffix="rect"
          />
        </div>
        <Field label="Rate Basis" className={cn('shrink-0', FW.sel)}>
          <SearchableSelect dense value={rateBasis} onChange={(value) => setRateBasis(value === 'PER_PCS' ? 'PER_PCS' : 'PER_KG')} options={[{value:'PER_KG',label:'Per Kg'},{value:'PER_PCS',label:'Per Pcs'}]} />
        </Field>
        <div className={cn('shrink-0', FW.rate)}>
          <NumField
            label={rateBasis === 'PER_KG' ? 'Rate ₹/kg' : 'Rate ₹/pc'}
            align="right"
            value={rateValue}
            onChange={(v) => { setRateTouched(true); setRateValue(v); }}
          />
          {cardRate && !rateTouched && rateValue > 0 && (
            <div className="mt-1 text-[10px] font-medium text-brand-700">
              From the rate card
            </div>
          )}
        </div>
        <StackFactorField
          w={FW.factor}
          value={stack}
          onChange={(v) => { setStackTouched(true); setStack(v); }}
          onReset={() => { setStackTouched(false); setStack(stackOr(customerFactor, RECT_STACK_FACTOR)); }}
          base={stackOr(customerFactor, RECT_STACK_FACTOR)}
          houseDefault={RECT_STACK_FACTOR}
          fromCustomer={stackOr(customerFactor, RECT_STACK_FACTOR) !== RECT_STACK_FACTOR}
        />
      </FieldRow>

      {/* Dimensions and quantity — eight narrow boxes that wrap rather than
          shrink, so a phone gets two tidy rows instead of eight slivers. */}
      <FieldRow className="mt-2">
        <NumField label="ID 1" w={FW.dim} value={id1} onChange={setId1} />
        <NumField label="ID 2" w={FW.dim} value={id2} onChange={setId2} />
        <NumField label="OD 1" w={FW.dim} value={od1} onChange={setOd1} />
        <NumField label="OD 2" w={FW.dim} value={od2} onChange={setOd2} />
        <NumField label="HT"   w={FW.dim} value={ht}  onChange={setHt} />
        <NumField label="Pcs"  w={FW.qty} align="right" value={pcs} onChange={setPcs} />
        {!hideTesting && (<>
          <NumField label="Turns" w={FW.qty} align="right" value={turns} onChange={setTurns} />
          <Field label="Flux" className={cn('shrink-0', FW.sel)}>
            <SearchableSelect
              dense
              value={flux > 0 ? String(flux) : ''}
              onChange={(v) => setFlux(parseFloat(v) || 0)}
              options={fluxOptions}
              placeholder={
                !grade ? 'Pick grade first'
                : !gradeHasFluxData ? `No flux data for "${grade}"`
                : 'Select flux…'
              }
              disabled={!grade || !gradeHasFluxData}
            />
          </Field>
        </>)}
      </FieldRow>

      {buildMismatch && (
        <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-1.5 text-[11px] text-amber-800">
          Build mismatch: (OD-1 − ID-1) = {(od1 - id1).toFixed(2)} ≠ (OD-2 − ID-2) = {(od2 - id2).toFixed(2)}.
          Per the spec the iron strip should have a uniform cross-section — double-check the dimensions.
        </div>
      )}

      {/* Computed values — geometry first (row of 6), flux-test second (row of 4).
          Test row order matches the production sheet: Flux ( T ) → ATe/cm → V (Volts) → Ie max (mA). */}
      <div className="mt-3 rounded-md border border-rose-100 bg-white/60 px-3 py-2">
        <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 sm:grid-cols-3 md:grid-cols-6">
          <Stat label="Built-up" value={calc.builtup.toFixed(3)} />
          <Stat label="Core A/C" value={calc.coreAc.toFixed(3)} />
          <Stat label="D-13" value={calc.d13.toFixed(3)} />
          <Stat label="Core M/L" value={calc.coreMl.toFixed(3)} />
          <Stat label="Wt / pc" value={calc.weightPerPc.toFixed(3)} />
          <Stat label="Total Wt" value={calc.totalWeight.toFixed(3)} accent="primary" />
          {!hideTesting && (<>
            <Stat label="Flux ( T )"   value={flux > 0 ? `${flux.toFixed(2)} T` : '—'} />
            <Stat label="ATe/cm"       value={ateCm > 0 ? ateCm.toFixed(3) : '—'} />
            <Stat label="V (Volts)"    value={fluxCalc.testVoltage > 0 ? fluxCalc.testVoltage.toFixed(3) : '—'} />
            <Stat label="Ie max (mA)"  value={
              fluxCalc.testCurrent > 0
                ? fluxCalc.testCurrent.toFixed(2)
                : flux > 0 && ateCm === 0
                  ? 'Set ATe/cm'
                  : '—'
            } />
          </>)}
        </div>
        <div className="mt-1.5 border-t border-rose-100 pt-1.5">
          <Stat label="Measure" value={calc.measure} />
        </div>
        {rateValue > 0 && (
          <div className="mt-2 grid grid-cols-3 gap-x-3 gap-y-1.5 border-t border-rose-100 pt-2">
            <Stat label="Rate / Kg"  value={`₹${money0(ratePerKg)}`} />
            <Stat label="Rate / Pc"  value={`₹${money0(ratePerPc)}`} />
            <Stat label="Line Total" value={`₹${money0(totalAmount)}`} accent="primary" />
          </div>
        )}
      </div>

      <div className="mt-3 flex justify-end">
        <button onClick={add} className="btn-primary w-full sm:w-auto" type="button">
          <Plus className="h-4 w-4" /> Add rectangular item
        </button>
      </div>
      {alertDialog}
    </div>
  );
};

/* ---------- NANO ---------- */
export const NanoForm = ({
  grades, fluxGrades, onAdd, prefill, onPrefillConsumed, edit, onEditConsumed, composite: compositeMode = false, typeGrades = [], hideTesting = false,
  customerFactor, onShape,
}: {
  grades: GradeRow[];
  fluxGrades: FluxGroup[];
  onAdd: (item: Item) => void;
  /** Reports the live dimensions to the 3D preview. */
  onShape?: (r: ShapeReport) => void;
  /** The customer's toroidal factor, for the CRGO half of a composite.
   *  The nano ribbon and its case have their own constants and are not a
   *  laminated stack, so it never touches those. */
  customerFactor?: number | null;
  prefill?: { coreType: CoreType; grade: string; material: string; rateBasis: 'PER_KG' | 'PER_PCS' } | null;
  onPrefillConsumed?: () => void;
  edit?: { item: Item; nonce: number } | null;
  onEditConsumed?: () => void;
  composite?: boolean; // COMPOSITE core type — always show CRGO + Nano, rule from the Type.
  typeGrades?: GradeRow[]; // composite join types (Continuous Loop / Exact Split / …)
  /** Quotation mode — flux/test calibration is irrelevant to a quote, so hide it. */
  hideTesting?: boolean;
}) => {
  const selfCore: CoreType = compositeMode ? 'COMPOSITE' : 'NANO';
  const [grade, setGrade] = useState('');
  const [material, setMaterial] = useState('');
  const [id, setId] = useState(0);
  const [od, setOd] = useState(0);
  const [ht, setHt] = useState(0);
  // CRGO sub-dimensions — only used for the COMPOSITE grade (Nano + CRGO).
  const [crgoId, setCrgoId] = useState(0);
  const [crgoOd, setCrgoOd] = useState(0);
  const [crgoHt, setCrgoHt] = useState(0);
  const [pcs, setPcs] = useState(0);
  const [nanoPrice, setNanoPrice] = useState(0);
  const [casePrice, setCasePrice] = useState(0);
  // Composite: the CRGO part is rated separately, either per-kg or per-pc.
  const [crgoRate, setCrgoRate] = useState(0);
  const [crgoBasis, setCrgoBasis] = useState<'PER_KG' | 'PER_PCS'>('PER_KG');
  // Stacking factor for the CRGO half — the same agreed figure a plain
  // toroidal line uses, because that half IS a toroidal core. Without this
  // the same customer's same core would weigh differently depending on
  // whether it was booked on its own or inside a composite.
  const [stack, setStack] = useState(stackOr(customerFactor, TOROIDAL_FACTOR));
  const [stackTouched, setStackTouched] = useState(false);
  useEffect(() => {
    if (!stackTouched) setStack(stackOr(customerFactor, TOROIDAL_FACTOR));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerFactor]);
  // Composite join type (Continuous Loop / Exact Split / Variable Height).
  const [compType, setCompType] = useState('');
  // Optional manual SO rate per piece. Blank → the Nano+Case price is used.
  const [soRate, setSoRate] = useState(0);
  // Testing parameters (V + Ie max). Flux grade (SS/Epoxy AT-cm) is looked up by
  // the selected grade name — same pattern as toroidal/rectangular.
  const [turns, setTurns] = useState(0);
  const [freq, setFreq] = useState(50);
  const [sfac, setSfac] = useState(0.8);
  const [flux, setFlux] = useState(0);
  const pendingFlux = useRef<number | null>(null);

  useEffect(() => {
    if (!prefill || prefill.coreType !== selfCore) return;
    setGrade(prefill.grade);
    setMaterial(prefill.material);
    onPrefillConsumed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefill]);

  // Load a full row for editing.
  useEffect(() => {
    if (!edit || edit.item.coreType !== selfCore) return;
    const it = edit.item;
    setMaterial(it.material);
    // Composite stores the DERIVED (final) dims, not the CRGO/Nano sub-dims —
    // so on edit we clear them and ask the user to re-enter both sets.
    if (compositeMode || isCompositeGrade(it.grade)) { setId(0); setOd(0); setHt(0); setCrgoId(0); setCrgoOd(0); setCrgoHt(0); }
    else { setId(it.id1); setOd(it.od1); setHt(it.ht); }
    setPcs(it.pcs);
    setNanoPrice(it.nanoPrice ?? 0); setCasePrice(it.casePrice ?? 0);
    setSoRate(it.nanoSoRate ?? 0); setTurns(it.turns ?? 0);
    setStack(stackOr(it.stackFactor, TOROIDAL_FACTOR)); setStackTouched(true);
    pendingFlux.current = it.flux ?? 0;
    setGrade(it.grade);
    onEditConsumed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [edit?.nonce]);

  // Reset flux when the grade changes; keep the edited flux when loading a row.
  useEffect(() => {
    if (pendingFlux.current != null) { setFlux(pendingFlux.current); pendingFlux.current = null; }
    else setFlux(0);
  }, [grade]);

  const fluxPoints = fluxGrades.find((g) => g.grade === grade)?.points ?? [];
  const ateCm = fluxPoints.find((p) => p.flux === flux)?.ateCm ?? 0;
  const hasFluxData = fluxPoints.length > 0;
  const test = nanoTestCalc({ id, od, ht, turns, flux, ateCm, freq, sfac });

  const calc = useMemo(
    () => nanoCalc({ id, od, ht, pcs, nanoPrice, casePrice }),
    [id, od, ht, pcs, nanoPrice, casePrice]
  );
  // COMPOSITE = Nano + CRGO. The grade (join type) fixes how the final measure
  // is derived; weight = Nano (core+case) + CRGO. Non-composite = plain nano.
  const composite = compositeMode || isCompositeGrade(grade);
  // Rule comes from the Type selector for composite (falls back to grade/material).
  const rule = composite ? (compositeRuleFromMaterial(compType) || compositeRuleFromMaterial(grade) || compositeRuleFromMaterial(material)) : null;
  const nanoOk = id > 0 && od > 0 && ht > 0 && od > id;
  const crgoOk = crgoId > 0 && crgoOd > 0 && crgoHt > 0 && crgoOd > crgoId;
  const comp = composite && rule ? compositeCalc({ rule, crgo: { id: crgoId, od: crgoOd, ht: crgoHt }, nano: { id, od, ht }, pcs, factor: stack }) : null;

  const geomOk = composite ? (nanoOk && crgoOk && !!rule) : nanoOk;
  // Final identity dims + measure (composite → derived; else the nano dims).
  const finalId = comp ? comp.id : id;
  const finalOd = comp ? comp.od : od;
  const finalHt = comp ? comp.ht : ht;
  const finalMeasure = comp ? comp.measure : calc.measure;
  // Epoxy / plastic casing has no SS case — its case weight must NOT count in
  // the piece weight (nor be priced). Detected from the grade / material name.
  const isEpoxy = /epoxy|plastic/i.test(grade) || /epoxy|plastic/i.test(material);
  const effCaseWt = isEpoxy ? 0 : calc.caseWeight;
  // Nano part per piece = core (+ SS case unless epoxy). Composite adds CRGO.
  const nanoPieceWt = Math.round((calc.coreWeight + effCaseWt) * 1000) / 1000;
  const pieceWeight = comp
    ? Math.round((nanoPieceWt + comp.crgoWeight) * 1000) / 1000
    : nanoPieceWt;
  const totalWt = pcs > 0 ? Math.round(pieceWeight * pcs * 1000) / 1000 : 0;

  useReportShape(
    onShape,
    () => ({
      shape: composite
        ? {
            kind: 'COMPOSITE',
            rule: rule ?? 'CONTINUOUS_LOOP',
            crgo: { id: crgoId, od: crgoOd, ht: crgoHt },
            nano: { id, od, ht },
          }
        : { kind: 'NANO', dims: { id, od, ht }, cased: !isEpoxy },
      meta: {
        grade, material, pcs,
        // Only a composite carries a stacking factor; a plain nano's weight
        // comes from the ribbon constants, with no stack to speak of.
        factor: composite ? stack : null,
        weightPerPc: pieceWeight, totalWeight: totalWt,
      },
    }),
    [composite, rule, crgoId, crgoOd, crgoHt, id, od, ht, isEpoxy,
     grade, material, pcs, stack, pieceWeight, totalWt],
  );

  // Finished output size = ordered dims + the selected grade's nano offsets.
  const selGrade = grades.find((g) => g.grade === grade);
  const hasOffsets = !!selGrade && (selGrade.nanoIdOff != null || selGrade.nanoOdOff != null || selGrade.nanoHtOff != null);
  const finished = geomOk && hasOffsets
    ? `${id + (selGrade!.nanoIdOff ?? 0)} × ${od + (selGrade!.nanoOdOff ?? 0)} × ${ht + (selGrade!.nanoHtOff ?? 0)}`
    : null;

  // Per-piece pricing. Nano part = core×nanoPrice + case×casePrice (nanoCalc's
  // pricePerPc). CRGO part = weight×rate (per-kg) or a flat per-pc rate. The two
  // combine into the composite per-piece price.
  const nanoPartPricePc = +(calc.coreWeight * nanoPrice + effCaseWt * casePrice).toFixed(2);
  const nanoAmtPc = comp ? nanoPartPricePc : 0;
  const crgoAmtPc = comp ? (crgoBasis === 'PER_KG' ? +(comp.crgoWeight * crgoRate).toFixed(2) : +Number(crgoRate).toFixed(2)) : 0;
  const nanoCasePc = composite ? +(nanoAmtPc + crgoAmtPc).toFixed(2) : nanoPartPricePc;
  const effRate = soRate > 0 ? soRate : nanoCasePc;
  const lineTotal = effRate > 0 && pcs > 0 ? +(effRate * pcs).toFixed(2) : 0;
  const { alert: showAlert, confirmDialog: alertDialog } = useConfirm();

  const reset = () => {
    setGrade(''); setMaterial('');
    setId(0); setOd(0); setHt(0); setPcs(0);
    setCrgoId(0); setCrgoOd(0); setCrgoHt(0); setCrgoRate(0); setCrgoBasis('PER_KG'); setCompType('');
    setStack(stackOr(customerFactor, TOROIDAL_FACTOR)); setStackTouched(false);
    setNanoPrice(0); setCasePrice(0);
    setSoRate(0); setTurns(0); setFlux(0);
  };

  const add = async () => {
    if (composite && !rule) {
      await showAlert({ title: 'Pick a composite type', message: 'Choose the Type (Continuous Loop / Exact Split / Variable Height) for the composite.', tone: 'warning' });
      return;
    }
    if (composite && !crgoOk) {
      await showAlert({ title: 'Invalid CRGO input', message: 'Enter valid CRGO ID, OD and HT (OD must be greater than ID).', tone: 'warning' });
      return;
    }
    if (!nanoOk) {
      await showAlert({ title: 'Invalid input', message: `Enter valid ${composite ? 'Nano ' : ''}OD, ID and HT (OD must be greater than ID).`, tone: 'warning' });
      return;
    }
    if (pcs <= 0) {
      await showAlert({ title: 'Invalid input', message: 'Enter the number of pieces.', tone: 'warning' });
      return;
    }
    onAdd({
      coreType: selfCore,
      grade: grade || (composite ? 'COMPOSITE' : 'NANO'),
      material: material || (composite ? 'COMPOSITE' : 'NANO'),
      measure: finalMeasure,
      id1: finalId, od1: finalOd, ht: finalHt, pcs,
      weightPerPc: pieceWeight, totalWeight: totalWt,
      stackFactor: composite ? stack : undefined,
      // Per-piece: manual SO rate if given, else the Nano+Case price.
      rateBasis: effRate > 0 ? 'PER_PCS' : undefined,
      rateValue: effRate > 0 ? +effRate.toFixed(4) : undefined,
      ratePerPc: effRate > 0 ? +effRate.toFixed(4) : undefined,
      totalAmount: lineTotal > 0 ? lineTotal : undefined,
      nanoPrice: nanoPrice > 0 ? nanoPrice : undefined,
      casePrice: casePrice > 0 ? casePrice : undefined,
      caseWeight: effCaseWt > 0 ? effCaseWt : undefined,
      nanoSoRate: soRate > 0 ? soRate : undefined,
      // Testing parameters — only attach when the user filled them.
      turns:       turns > 0 ? turns : undefined,
      flux:        flux  > 0 ? flux  : undefined,
      ateCm:       flux  > 0 && ateCm > 0 ? ateCm : undefined,
      testVoltage: test.testVoltage > 0 ? test.testVoltage : undefined,
      testCurrent: test.testCurrent > 0 ? test.testCurrent : undefined,
    });
    reset();
  };

  return (
    <div className={cn('core-entry-form overflow-hidden rounded-xl border bg-white shadow-sm', composite ? 'border-teal-200' : 'border-violet-200')}>
      {/* Header. The running weight and line total live here rather than only
          at the foot of the card: they are the two numbers an operator checks
          against the customer's order, and on a laptop the foot of a long form
          is below the fold while the header never is. */}
      <div className={cn('flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b px-4 py-2.5', composite ? 'border-teal-100 bg-teal-50/70' : 'border-violet-100 bg-violet-50/70')}>
        <span className={cn('h-2 w-2 shrink-0 rounded-full', composite ? 'bg-teal-500' : 'bg-violet-500')} />
        <span className={cn('text-xs font-bold uppercase tracking-wider', composite ? 'text-teal-800' : 'text-violet-800')}>{composite ? 'Composite Core (Nano + CRGO)' : 'Nano Core'}</span>
        <span className="ml-auto flex flex-wrap items-center gap-x-2 gap-y-1">
          <HeadStat label="Wt / pc" value={`${pieceWeight.toFixed(3)} kg`} on={pieceWeight > 0} />
          <HeadStat label="Total" value={`₹${money0(lineTotal)}`} on={lineTotal > 0} />
        </span>
      </div>

      <div className="space-y-3.5 p-4">
        {composite ? (
          <>
            {/* What is being made. Names need room, so these three keep a
                readable width and wrap together; everything below is numeric
                and stays narrow. */}
            <FieldRow>
              <div className="grid min-w-[240px] flex-1 basis-[440px] grid-cols-1 gap-x-2.5 gap-y-2 sm:max-w-[580px] sm:grid-cols-3">
                <GradeMaterialPicker
                  grades={grades} grade={grade} material={material}
                  onGrade={setGrade} onMaterial={setMaterial} listIdSuffix="composite"
                />
                <Field label="Type">
                  <SearchableSelect
                    dense value={compType} onChange={setCompType}
                    options={typeGrades.map((g) => ({ value: g.grade, label: g.grade }))}
                    placeholder="Continuous Loop / Exact Split…"
                  />
                </Field>
              </div>
            </FieldRow>

            {/* The two halves of the piece, each with its own dimensions, its
                own price and its own resulting weight. They sit side by side
                where there is room and stack where there is not; the max-width
                stops them sprawling into two half-empty columns on a wide
                monitor, which is what made the old layout read as a web form
                rather than a data-entry screen. */}
            <div className="flex flex-wrap gap-2.5">
              <section className="core-component-panel min-w-0 flex-1 basis-[420px] rounded-lg border border-amber-200 bg-amber-50/40 p-2.5 lg:max-w-[560px]">
                <div className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-amber-700">
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-500" /> CRGO core
                </div>
                <FieldRow>
                  <NumField label="ID" w={FW.dim} value={crgoId} onChange={setCrgoId} />
                  <NumField label="OD" w={FW.dim} value={crgoOd} onChange={setCrgoOd} />
                  <NumField label="HT" w={FW.dim} value={crgoHt} onChange={setCrgoHt} />
                  <div className={cn('shrink-0', FW.factor)}>
                    <NumField
                      label="Stack factor"
                      value={stack}
                      onChange={(v) => { setStackTouched(true); setStack(v); }}
                    />
                    {Math.abs(stack - stackOr(customerFactor, TOROIDAL_FACTOR)) > 1e-9 ? (
                      <button
                        type="button"
                        onClick={() => { setStackTouched(false); setStack(stackOr(customerFactor, TOROIDAL_FACTOR)); }}
                        className="mt-1 block text-[10px] font-medium text-amber-700 underline-offset-2 hover:underline"
                      >
                        ↺ {stackOr(customerFactor, TOROIDAL_FACTOR)}
                      </button>
                    ) : stackOr(customerFactor, TOROIDAL_FACTOR) !== TOROIDAL_FACTOR ? (
                      <div className="mt-1 text-[10px] font-medium text-brand-700">Customer&rsquo;s</div>
                    ) : null}
                  </div>
                  <ReadOut label="Wt (kg)" w={FW.stat} tone="amber" value={(comp?.crgoWeight ?? 0).toFixed(3)} />
                </FieldRow>
                <FieldRow className="mt-2">
                  <Field label="Rate basis" className={cn('shrink-0', FW.sel)}>
                    <SearchableSelect dense value={crgoBasis} onChange={(value) => setCrgoBasis(value === 'PER_PCS' ? 'PER_PCS' : 'PER_KG')} options={[{value:'PER_KG',label:'Per Kg'},{value:'PER_PCS',label:'Per Pcs'}]} />
                  </Field>
                  <NumField
                    label={crgoBasis === 'PER_KG' ? 'Rate ₹/kg' : 'Rate ₹/pc'}
                    w={FW.rate} align="right" value={crgoRate} onChange={setCrgoRate}
                  />
                  <ReadOut label="Amt / pc" w={FW.stat} tone="amber" value={`₹${money0(crgoAmtPc)}`} />
                </FieldRow>
              </section>

              <section className="core-component-panel min-w-0 flex-1 basis-[420px] rounded-lg border border-violet-200 bg-violet-50/40 p-2.5 lg:max-w-[560px]">
                <div className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-violet-700">
                  <span className="h-1.5 w-1.5 rounded-full bg-violet-500" /> Nano core
                </div>
                <FieldRow>
                  <NumField label="ID" w={FW.dim} value={id} onChange={setId} />
                  <NumField label="OD" w={FW.dim} value={od} onChange={setOd} />
                  <NumField label="HT" w={FW.dim} value={ht} onChange={setHt} />
                  <ReadOut label="Wt (kg)" w={FW.stat} tone="violet" value={nanoPieceWt.toFixed(3)} />
                </FieldRow>
                <FieldRow className="mt-2">
                  <NumField label="Nano ₹/kg" w={FW.rate} align="right" value={nanoPrice} onChange={setNanoPrice} />
                  <NumField label="Case ₹/kg" w={FW.rate} align="right" value={casePrice} onChange={setCasePrice} />
                  <ReadOut label="Amt / pc" w={FW.stat} tone="violet" value={`₹${money0(nanoAmtPc)}`} />
                </FieldRow>
                <div className="mt-1.5 font-num text-[10px] text-slate-500">
                  Core {(comp?.coreWeight ?? 0).toFixed(3)}{isEpoxy ? ' · epoxy (case not weighed)' : ` + case ${effCaseWt.toFixed(3)}`} kg
                </div>
              </section>
            </div>

            {/* Quantity and the optional override price for the finished piece. */}
            <FieldRow>
              <NumField label="Pcs" w={FW.qty} align="right" value={pcs} onChange={setPcs} />
              <NumField label="SO rate ₹/pc" w={FW.rate} align="right" value={soRate} onChange={setSoRate} />
              {rule && (
                <div className="flex min-h-[46px] items-end pb-1 text-[11px] text-slate-500">
                  {rule === 'CONTINUOUS_LOOP' ? 'Continuous loop → ID = min, OD = max, HT = same (concentric).'
                    : rule === 'EXACT_SPLIT' ? 'Exact split → same ID/OD, heights added (stacked).'
                    : 'Variable height → same ID/OD, heights added (stacked).'}
                </div>
              )}
            </FieldRow>

            {/* Testing parameters — computed on the Nano core dims. Optional, but
                filling them lets a composite order produce a Testing Report.
                Hidden in quotation mode (not part of a quote). */}
            {!hideTesting && (
            <div>
              <SecLabel>Testing parameters (Nano core)</SecLabel>
              <FieldRow>
                <NumField label="Turns" w={FW.qty} align="right" value={turns} onChange={setTurns} />
                <NumField label="Freq (Hz)" w={FW.qty} align="right" value={freq} onChange={setFreq} />
                <NumField label="Stack factor" w={FW.factor} align="right" value={sfac} onChange={setSfac} />
                <Field label="Flux (Bmax)" className={cn('shrink-0', FW.selLg)}>
                  <SearchableSelect
                    dense
                    value={flux > 0 ? String(flux) : ''}
                    onChange={(v) => setFlux(parseFloat(v) || 0)}
                    options={fluxPoints.map((p) => ({ value: String(p.flux), label: `${p.flux} T (${Math.round(p.flux * 10000)} G)` }))}
                    placeholder={
                      !grade ? 'Pick grade first'
                      : !hasFluxData ? `No test data for "${grade}"`
                      : 'Select flux…'
                    }
                    disabled={!grade || !hasFluxData}
                  />
                </Field>
              </FieldRow>
              {flux > 0 && (
                <div className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-2 rounded-lg border border-violet-100 bg-violet-50/60 px-3 py-2 sm:grid-cols-3 lg:grid-cols-6">
                  <Stat label="Bmax (G)" value={`${Math.round(flux * 10000)}`} />
                  <Stat label="AT/cm" value={ateCm > 0 ? ateCm.toFixed(4) : '—'} />
                  <Stat label="V (Volts)" value={test.testVoltage > 0 ? test.testVoltage.toFixed(3) : '—'} />
                  <Stat label="V (mV)" value={test.testVoltageMv > 0 ? test.testVoltageMv.toFixed(2) : '—'} />
                  <Stat label="Ie max (A)" value={test.testCurrentA > 0 ? test.testCurrentA.toFixed(5) : (ateCm === 0 ? 'Set AT/cm' : '—')} />
                  <Stat label="Ie max (mA)" value={test.testCurrent > 0 ? test.testCurrent.toFixed(2) : '—'} />
                </div>
              )}
            </div>
            )}
          </>
        ) : (
          <>
            {/* Grade and material need reading width; the two prices do not. */}
            <FieldRow>
              <div className="grid min-w-[240px] flex-1 basis-[300px] grid-cols-1 gap-x-2.5 gap-y-2 sm:max-w-[390px] sm:grid-cols-2">
                <GradeMaterialPicker
                  grades={grades} grade={grade} material={material}
                  onGrade={setGrade} onMaterial={setMaterial} listIdSuffix="nano"
                />
              </div>
              <NumField label="Nano ₹/kg" w={FW.rate} align="right" value={nanoPrice} onChange={setNanoPrice} />
              <NumField label="Case ₹/kg" w={FW.rate} align="right" value={casePrice} onChange={setCasePrice} />
            </FieldRow>

            {/* Dimensions + SO rate — one aligned line */}
            <div>
              <SecLabel>Dimensions &amp; rate</SecLabel>
              <FieldRow>
                <NumField label="ID" w={FW.dim} value={id} onChange={setId} />
                <NumField label="OD" w={FW.dim} value={od} onChange={setOd} />
                <NumField label="HT" w={FW.dim} value={ht} onChange={setHt} />
                <NumField label="Pcs" w={FW.qty} align="right" value={pcs} onChange={setPcs} />
                <NumField label="SO rate ₹/pc" w={FW.rate} align="right" value={soRate} onChange={setSoRate} />
                <ReadOut label="Wt / pc" w={FW.stat} tone="violet" value={pieceWeight.toFixed(3)} />
              </FieldRow>
            </div>

            {/* Testing parameters — one aligned line. Hidden in quotation mode. */}
            {!hideTesting && (
            <div>
              <SecLabel>Testing parameters</SecLabel>
              <FieldRow>
                <NumField label="Turns" w={FW.qty} align="right" value={turns} onChange={setTurns} />
                <NumField label="Freq (Hz)" w={FW.qty} align="right" value={freq} onChange={setFreq} />
                <NumField label="Stack factor" w={FW.factor} align="right" value={sfac} onChange={setSfac} />
                <Field label="Flux (Bmax)" className={cn('shrink-0', FW.selLg)}>
                  <SearchableSelect
                    dense
                    value={flux > 0 ? String(flux) : ''}
                    onChange={(v) => setFlux(parseFloat(v) || 0)}
                    options={fluxPoints.map((p) => ({ value: String(p.flux), label: `${p.flux} T (${Math.round(p.flux * 10000)} G)` }))}
                    placeholder={
                      !grade ? 'Pick grade first'
                      : !hasFluxData ? `No test data for "${grade}"`
                      : 'Select flux…'
                    }
                    disabled={!grade || !hasFluxData}
                  />
                </Field>
              </FieldRow>
              {flux > 0 && (
                <div className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-2 rounded-lg border border-violet-100 bg-violet-50/60 px-3 py-2 sm:grid-cols-3 lg:grid-cols-6">
                  <Stat label="Bmax (G)" value={`${Math.round(flux * 10000)}`} />
                  <Stat label="AT/cm" value={ateCm > 0 ? ateCm.toFixed(4) : '—'} />
                  <Stat label="V (Volts)" value={test.testVoltage > 0 ? test.testVoltage.toFixed(3) : '—'} />
                  <Stat label="V (mV)" value={test.testVoltageMv > 0 ? test.testVoltageMv.toFixed(2) : '—'} />
                  <Stat label="Ie max (A)" value={test.testCurrentA > 0 ? test.testCurrentA.toFixed(5) : (ateCm === 0 ? 'Set AT/cm' : '—')} />
                  <Stat label="Ie max (mA)" value={test.testCurrent > 0 ? test.testCurrent.toFixed(2) : '—'} />
                </div>
              )}
            </div>
            )}
          </>
        )}
      </div>

      {/* Computed summary */}
      {composite ? (
        <div className="border-t border-teal-100 bg-teal-50/40 px-4 py-3">
          <div className="grid grid-cols-2 gap-x-3 gap-y-2 sm:grid-cols-4">
            <Stat label={isEpoxy ? 'Nano Wt (core)' : 'Nano Wt (kg)'} value={nanoPieceWt.toFixed(3)} />
            <Stat label="CRGO Wt (kg)" value={(comp?.crgoWeight ?? 0).toFixed(3)} />
            <Stat label="Total Wt / Pc" value={pieceWeight.toFixed(3)} accent="primary" />
            <Stat label="Composite Size" value={geomOk ? finalMeasure : '—'} accent="primary" />
          </div>
          <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 border-t border-teal-100 pt-3 sm:grid-cols-5">
            <Stat label="Nano Amt / Pc" value={`₹${money0(nanoAmtPc)}`} />
            <Stat label="CRGO Amt / Pc" value={`₹${money0(crgoAmtPc)}`} />
            <Stat label="Combined / Pc" value={`₹${money0(nanoCasePc)}`} />
            <Stat label="Applied / Pc" value={soRate > 0 ? `₹${money0(soRate)}` : `₹${money0(effRate)}`} />
            <Stat label="Line Total" value={`₹${money0(lineTotal)}`} accent="primary" />
          </div>
        </div>
      ) : (
        <div className="border-t border-violet-100 bg-violet-50/40 px-4 py-3">
          <div className="grid grid-cols-2 gap-x-3 gap-y-2 sm:grid-cols-5">
            <Stat label="Nano Core Wt" value={calc.coreWeight.toFixed(3)} />
            <Stat label={isEpoxy ? 'Case Wt (epoxy — n/a)' : 'Nano Case Wt'} value={effCaseWt.toFixed(3)} />
            <Stat label={isEpoxy ? 'Total Wt (core only)' : 'Total Wt (core+case)'} value={totalWt.toFixed(3)} accent="primary" />
            <Stat label="Bare Size" value={geomOk ? finalMeasure : '—'} />
            <Stat label="Finish Size" value={finished ?? '—'} accent={finished ? 'primary' : undefined} />
          </div>
          <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 border-t border-violet-100 pt-3 sm:grid-cols-4">
            <Stat label="Nano+Case / Pc" value={`₹${money0(nanoCasePc)}`} />
            <Stat label="SO Rate/Pcs"    value={soRate > 0 ? `₹${money0(soRate)}` : '— (auto)'} />
            <Stat label="Applied / Pc"   value={`₹${money0(effRate)}`} />
            <Stat label="Line Total"     value={`₹${money0(lineTotal)}`} accent="primary" />
          </div>
        </div>
      )}

      {/* Action */}
      <div className={cn('flex justify-end border-t px-4 py-3', composite ? 'border-teal-100' : 'border-violet-100')}>
        <button onClick={add} className="btn-primary w-full sm:w-auto" type="button">
          <Plus className="h-4 w-4" /> {composite ? 'Add composite item' : 'Add nano item'}
        </button>
      </div>
      {alertDialog}
    </div>
  );
};

const SecLabel = ({ children }: { children: React.ReactNode }) => (
  <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-violet-700">{children}</div>
);
