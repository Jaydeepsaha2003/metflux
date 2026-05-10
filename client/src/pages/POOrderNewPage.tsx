// New PO Order entry — port of .NET New_PO_Order.vb.
// Header (PO#, customer, dates) + per-item entry (toroidal OR rectangular)
// with live calculations + accumulated items list. Submit creates one PoOrder
// with many PoOrderItems in a single API call.
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, Save, Loader2, Calendar, Hash, User2, Package } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { numFromInput, rectangularCalc, toroidalCalc, fluxTestCalc, rectangularFluxTestCalc } from '@/lib/calc';
import { SearchableSelect } from '@/components/SearchableSelect';
import { useConfirm } from '@/hooks/useConfirm';

/* ---------- types ---------- */
type CoreType = 'TOROIDAL' | 'RECTANGULAR';

type Item = {
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
  // Toroidal flux-test calibration — optional, only set when user fills them.
  turns?: number; flux?: number; ateCm?: number; testVoltage?: number; testCurrent?: number;
  // Pricing — rateBasis + rateValue are user-entered; per-kg / per-pc / total
  // are derived locally so the items list can show the breakdown immediately.
  rateBasis?: 'PER_KG' | 'PER_PCS';
  rateValue?: number;
  ratePerKg?: number;
  ratePerPc?: number;
  totalAmount?: number;
};

type Customer = { id: string; name: string; gstRate?: number };
type GradeRow = { grade: string; materials: { id: string; material: string }[] };
type FluxPoint = { flux: number; ateCm: number };
type FluxGroup = { grade: string; points: FluxPoint[] };

const todayISO = () => new Date().toISOString().slice(0, 10);
const addDays = (iso: string, days: number) => {
  const d = new Date(iso); d.setDate(d.getDate() + days); return d.toISOString().slice(0, 10);
};

/* ---------- shared input styles ----------
   Single source of truth for compact inputs across this page. Tight height,
   small padding, small text — keeps the form dense on desktop and avoids the
   over-large default inputs that dominate the screen on mobile. */
const inputCls =
  'h-8 w-full rounded-md border border-slate-300 bg-white px-2 text-sm text-slate-900 ' +
  'placeholder:text-slate-400 outline-none transition ' +
  'focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 ' +
  'disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400';

const readonlyInputCls = inputCls + ' bg-slate-50 text-slate-600';

/* ============================================================ */
export const POOrderNewPage = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  /* ----- header state ----- */
  const [poNumber, setPoNumber] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [orderDate, setOrderDate] = useState(todayISO());
  const [deliveryDays, setDeliveryDays] = useState(0);
  const deliveryDate = useMemo(() => addDays(orderDate, deliveryDays), [orderDate, deliveryDays]);

  /* ----- entry state (current item being built) ----- */
  const [coreType, setCoreType] = useState<CoreType | ''>('');
  const [items, setItems] = useState<Item[]>([]);

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

  /* ----- submit mutation ----- */
  const [error, setError] = useState<{ message: string; details?: string[] } | null>(null);
  const submit = useMutation({
    mutationFn: (body: unknown) => api('/po-orders', { method: 'POST', json: body }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['po-orders'] });
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

    submit.mutate({
      poNumber: poNumber.trim(),
      customerId,
      orderDate,
      deliveryDays,
      deliveryDate,
      items,
    });
  };

  const totalWeight = items.reduce((s, x) => s + x.totalWeight, 0);

  // Selected customer (with gstRate) — pulled out of the cached list.
  const selectedCustomer = customersResp?.items.find((c) => c.id === customerId);
  const gstRate = Number(selectedCustomer?.gstRate ?? 0);

  // Money totals — items where the user typed a rate contribute, others are 0.
  const subtotal = items.reduce((s, x) => s + (x.totalAmount ?? 0), 0);
  const gstAmount  = +(subtotal * gstRate / 100).toFixed(2);
  const grandTotal = +(subtotal + gstAmount).toFixed(2);
  const fmtMoney = (n: number) => n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <div className="space-y-4 max-w-7xl pb-4">
      {/* ============ TITLE ============ */}
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-lg sm:text-2xl font-bold tracking-tight text-slate-900">New Sales Order</h1>
        {items.length > 0 && (
          <div className="hidden sm:flex items-center gap-2 text-xs text-slate-500">
            <Package className="h-3.5 w-3.5" />
            <span>{items.length} item{items.length === 1 ? '' : 's'}</span>
            <span className="text-slate-300">·</span>
            <span>{totalWeight.toFixed(3)} kg</span>
          </div>
        )}
      </div>

      {/* ============ HEADER ============ */}
      <section className="card p-3 sm:p-4">
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
      <section className="card p-3 sm:p-4 space-y-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-sm font-semibold text-slate-900">Add line item</h2>
          {/* Segmented pill selector — replaces the dropdown for a touchable, visible toggle */}
          <div className="inline-flex rounded-lg bg-slate-100 p-0.5 text-sm self-start">
            <button
              type="button"
              onClick={() => setCoreType('TOROIDAL')}
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
              onClick={() => setCoreType('RECTANGULAR')}
              className={cn(
                'rounded-md px-3 py-1.5 font-medium transition',
                coreType === 'RECTANGULAR'
                  ? 'bg-white text-rose-700 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              )}
            >
              Rectangular
            </button>
          </div>
        </div>

        {coreType === 'TOROIDAL' && (
          <ToroidalForm
            grades={gradesResp?.grades ?? []}
            fluxGrades={fluxResp?.grades ?? []}
            onAdd={(item) => { setItems((prev) => [...prev, item]); }}
          />
        )}
        {coreType === 'RECTANGULAR' && (
          <RectangularForm
            grades={gradesResp?.grades ?? []}
            fluxGrades={fluxRespRect?.grades ?? []}
            onAdd={(item) => { setItems((prev) => [...prev, item]); }}
          />
        )}
        {!coreType && (
          <div className="rounded-lg border border-dashed border-slate-300 px-4 py-6 text-center text-sm text-slate-500">
            Pick a core type above to start adding items.
          </div>
        )}
      </section>

      {/* ============ ITEMS LIST ============ */}
      <section className="card overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2.5 sm:px-4">
          <h2 className="text-sm font-semibold text-slate-900">
            Items <span className="font-normal text-slate-400">({items.length})</span>
          </h2>
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
            <div key={idx} className="flex items-start gap-3 px-3 py-2.5">
              <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-slate-100 font-mono text-[11px] text-slate-600">
                {idx + 1}
              </div>
              <div className="min-w-0 flex-1">
                <div className="mb-0.5 flex items-center gap-2">
                  <span className={cn(
                    'rounded-full px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide',
                    it.coreType === 'TOROIDAL' ? 'bg-amber-50 text-amber-700' : 'bg-rose-50 text-rose-700'
                  )}>
                    {it.coreType === 'TOROIDAL' ? 'Toro' : 'Rect'}
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
                      ₹{it.rateValue?.toFixed(2)}{it.rateBasis === 'PER_KG' ? '/kg' : '/pc'}
                    </span>
                    <span className="font-semibold text-brand-700 tabular-nums">₹{it.totalAmount.toFixed(2)}</span>
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={() => setItems((prev) => prev.filter((_, i) => i !== idx))}
                className="flex-shrink-0 rounded-md p-1.5 text-slate-400 transition hover:bg-red-50 hover:text-red-600"
                aria-label="Remove item"
              >
                <Trash2 className="h-4 w-4" />
              </button>
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
                <tr key={idx} className="border-t border-slate-100 hover:bg-slate-50/60">
                  <td className="px-3 py-2 font-mono text-xs text-slate-500">{idx + 1}</td>
                  <td className="px-3 py-2">
                    <span className={cn(
                      'rounded-full px-2 py-0.5 text-[11px] font-medium',
                      it.coreType === 'TOROIDAL' ? 'bg-amber-50 text-amber-700' : 'bg-rose-50 text-rose-700'
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
                      ? `₹${it.rateValue.toFixed(2)} ${it.rateBasis === 'PER_KG' ? '/kg' : '/pc'}`
                      : '—'}
                  </td>
                  <td className="px-3 py-2 text-right font-mono font-semibold tabular-nums">
                    {it.totalAmount ? `₹${it.totalAmount.toFixed(2)}` : '—'}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button
                      type="button"
                      onClick={() => setItems((prev) => prev.filter((_, i) => i !== idx))}
                      className="rounded-md p-1.5 text-slate-400 transition hover:bg-red-50 hover:text-red-600"
                      aria-label="Remove item"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ============ PRICING SUMMARY ============
          Only renders when at least one item has a rate. GST applied uses the
          selected customer's gstRate (defaults to 0% when no customer picked). */}
      {subtotal > 0 && (
        <section className="card p-3 sm:p-4">
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
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end sm:gap-3">
        <button
          type="button"
          onClick={() => navigate('/')}
          className="btn-ghost w-full sm:w-auto"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onSubmit}
          disabled={submit.isPending}
          className="btn-primary w-full sm:w-auto"
        >
          {submit.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Submit Sales Order
        </button>
      </div>
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
  label, value, onChange,
}: { label: string; value: number; onChange: (v: number) => void }) => (
  <Field label={label}>
    <input
      className={inputCls}
      type="number"
      inputMode="decimal"
      step="any"
      value={value === 0 ? '' : value}
      onChange={(e) => onChange(numFromInput(e.target.value))}
      placeholder="0"
    />
  </Field>
);

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
  <div className="min-w-0">
    <div className="text-[11px] font-medium tracking-wide text-slate-500">{label}</div>
    <div className={cn(
      'truncate font-mono tabular-nums leading-tight',
      accent === 'primary' ? 'text-base font-semibold text-slate-900' : 'text-base text-slate-700'
    )}>
      {value}
    </div>
  </div>
);

/* ---------- TOROIDAL ---------- */
const ToroidalForm = ({
  grades, fluxGrades, onAdd,
}: {
  grades: GradeRow[];
  fluxGrades: FluxGroup[];
  onAdd: (item: Item) => void;
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

  // Fluxes available for the currently selected grade — driven entirely by
  // what's been recorded in Settings → Flux Grades for this company.
  const fluxPoints = fluxGrades.find((g) => g.grade === grade)?.points ?? [];
  const ateCm = fluxPoints.find((p) => p.flux === flux)?.ateCm ?? 0;
  const gradeHasFluxData = fluxPoints.length > 0;
  const fluxOptions = fluxPoints.map((p) => ({ value: String(p.flux), label: `${p.flux.toFixed(2)} T` }));

  // Reset flux whenever the grade changes — last grade's fluxes don't apply.
  useEffect(() => { setFlux(0); }, [grade]);

  const calc = useMemo(() => toroidalCalc({ id, od, ht, pcs }), [id, od, ht, pcs]);
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
    setRateValue(0);
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
    <div className="rounded-lg border border-amber-200 bg-amber-50/40 p-3">
      <div className="mb-2 flex items-center gap-2">
        <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
        <span className="text-[11px] font-semibold uppercase tracking-wider text-amber-800">Toroidal</span>
      </div>

      {/* Row 1 — wider fields: Grade · Material · Rate Basis · Rate.
          On md+ screens these four sit on a single line so the dropdowns
          have room to breathe; on mobile they stack 2-up. */}
      <div className="grid grid-cols-2 gap-x-2 gap-y-2 md:grid-cols-4">
        <GradeMaterialPicker
          grades={grades} grade={grade} material={material}
          onGrade={setGrade} onMaterial={setMaterial} listIdSuffix="toro"
        />
        <Field label="Rate Basis">
          <select
            className={inputCls}
            value={rateBasis}
            onChange={(e) => setRateBasis(e.target.value as 'PER_KG' | 'PER_PCS')}
          >
            <option value="PER_KG">Per Kg</option>
            <option value="PER_PCS">Per Pcs</option>
          </select>
        </Field>
        <NumField label={rateBasis === 'PER_KG' ? 'Rate (₹/kg)' : 'Rate (₹/pcs)'} value={rateValue} onChange={setRateValue} />
      </div>

      {/* Row 2 — narrow numeric fields: dimensions, pcs, turns, flux.
          Six fields fit cleanly in one row on md+ screens. */}
      <div className="mt-2 grid grid-cols-3 gap-x-2 gap-y-2 sm:grid-cols-3 md:grid-cols-6">
        <NumField label="ID" value={id} onChange={setId} />
        <NumField label="OD" value={od} onChange={setOd} />
        <NumField label="HT" value={ht} onChange={setHt} />
        <NumField label="Pcs" value={pcs} onChange={setPcs} />
        <NumField label="Turns" value={turns} onChange={setTurns} />
        <Field label="Flux">
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
      </div>

      {/* Computed values — geometry + flux-test results.
          Heading order matches the production sheet: Flux ( T ) → ATe/cm → V (Volts) → Ie max (mA). */}
      <div className="mt-3 rounded-md border border-amber-100 bg-white/60 px-3 py-2">
        <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 sm:grid-cols-6">
          <Stat label="Wt / pc"      value={calc.weightPerPc.toFixed(3)} />
          <Stat label="Total Wt"     value={calc.totalWeight.toFixed(3)} accent="primary" />
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
          <div className="col-span-2 sm:col-span-6">
            <Stat label="Measure" value={calc.measure} />
          </div>
        </div>
        {rateValue > 0 && (
          <div className="mt-2 grid grid-cols-3 gap-x-3 gap-y-1.5 border-t border-amber-100 pt-2">
            <Stat label="Rate / Kg"  value={`₹${ratePerKg.toFixed(2)}`} />
            <Stat label="Rate / Pc"  value={`₹${ratePerPc.toFixed(2)}`} />
            <Stat label="Line Total" value={`₹${totalAmount.toFixed(2)}`} accent="primary" />
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
const RectangularForm = ({
  grades, fluxGrades, onAdd,
}: {
  grades: GradeRow[];
  fluxGrades: FluxGroup[];
  onAdd: (item: Item) => void;
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

  // Rectangular flux table (already filtered to coreType=RECTANGULAR by the query).
  const fluxPoints = fluxGrades.find((g) => g.grade === grade)?.points ?? [];
  const ateCm = fluxPoints.find((p) => p.flux === flux)?.ateCm ?? 0;
  const gradeHasFluxData = fluxPoints.length > 0;
  const fluxOptions = fluxPoints.map((p) => ({ value: String(p.flux), label: `${p.flux.toFixed(2)} T` }));

  // Reset flux when grade changes — a new grade rarely has the same flux row.
  useEffect(() => { setFlux(0); }, [grade]);

  const calc = useMemo(
    () => rectangularCalc({ id1, id2, od1, od2, ht, pcs }),
    [id1, id2, od1, od2, ht, pcs]
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
    setRateValue(0);
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
    <div className="rounded-lg border border-rose-200 bg-rose-50/40 p-3">
      <div className="mb-2 flex items-center gap-2">
        <span className="h-1.5 w-1.5 rounded-full bg-rose-500" />
        <span className="text-[11px] font-semibold uppercase tracking-wider text-rose-800">Rectangular</span>
      </div>

      {/* Row 1 — wider fields: Grade · Material · Rate Basis · Rate. */}
      <div className="grid grid-cols-2 gap-x-2 gap-y-2 md:grid-cols-4">
        <GradeMaterialPicker
          grades={grades} grade={grade} material={material}
          onGrade={setGrade} onMaterial={setMaterial} listIdSuffix="rect"
        />
        <Field label="Rate Basis">
          <select
            className={inputCls}
            value={rateBasis}
            onChange={(e) => setRateBasis(e.target.value as 'PER_KG' | 'PER_PCS')}
          >
            <option value="PER_KG">Per Kg</option>
            <option value="PER_PCS">Per Pcs</option>
          </select>
        </Field>
        <NumField label={rateBasis === 'PER_KG' ? 'Rate (₹/kg)' : 'Rate (₹/pcs)'} value={rateValue} onChange={setRateValue} />
      </div>

      {/* Row 2 — narrow numeric fields. 8 fields fit cleanly in one line on md+. */}
      <div className="mt-2 grid grid-cols-2 gap-x-2 gap-y-2 sm:grid-cols-4 md:grid-cols-8">
        <NumField label="ID 1" value={id1} onChange={setId1} />
        <NumField label="ID 2" value={id2} onChange={setId2} />
        <NumField label="OD 1" value={od1} onChange={setOd1} />
        <NumField label="OD 2" value={od2} onChange={setOd2} />
        <NumField label="HT"   value={ht}  onChange={setHt} />
        <NumField label="Pcs"  value={pcs} onChange={setPcs} />
        <NumField label="Turns" value={turns} onChange={setTurns} />
        <Field label="Flux">
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
      </div>

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
        </div>
        <div className="mt-1.5 border-t border-rose-100 pt-1.5">
          <Stat label="Measure" value={calc.measure} />
        </div>
        {rateValue > 0 && (
          <div className="mt-2 grid grid-cols-3 gap-x-3 gap-y-1.5 border-t border-rose-100 pt-2">
            <Stat label="Rate / Kg"  value={`₹${ratePerKg.toFixed(2)}`} />
            <Stat label="Rate / Pc"  value={`₹${ratePerPc.toFixed(2)}`} />
            <Stat label="Line Total" value={`₹${totalAmount.toFixed(2)}`} accent="primary" />
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