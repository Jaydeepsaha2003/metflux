// Edit a single PO line item. Pre-fills the toroidal or rectangular form
// from the existing values, recalculates derived numbers live, and PATCHes
// the server on save.
import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Save, Loader2, Hash, User2 } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { numFromInput, rectangularCalc, toroidalCalc, fluxTestCalc, rectangularFluxTestCalc } from '@/lib/calc';
import { SearchableSelect } from '@/components/SearchableSelect';

type GradeRow = { grade: string; materials: { id: string; material: string }[] };
type FluxPoint = { flux: number; ateCm: number };
type FluxGroup = { grade: string; points: FluxPoint[] };

type Item = {
  id: string;
  poNumber: string;
  customerName: string;
  coreType: 'TOROIDAL' | 'RECTANGULAR';
  grade: string;
  material: string;
  measure: string;
  id1: number; id2: number | null;
  od1: number; od2: number | null;
  ht: number;
  builtup: number | null;
  weightPerPc: number;
  pcs: number;
  totalWeight: number;
  coreAc: number | null; coreMl: number | null; d13: number | null;
  rateBasis: 'PER_KG' | 'PER_PCS' | null;
  rateValue: number | null;
  ratePerKg: number | null;
  ratePerPc: number | null;
  totalAmount: number | null;
  pcsProduced: number | null;
  pcsDispatched: number | null;
  status: 'ACTIVE' | 'CANCELLED';
  // Flux-test calibration — populated for toroidal and (optionally) rectangular.
  turns: number | null;
  flux: number | null;
  ateCm: number | null;
  testVoltage: number | null;
  testCurrent: number | null;
};

export const POEditPage = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: item, isLoading } = useQuery({
    queryKey: ['po-item', id],
    queryFn: () => api<Item>(`/po-orders/items/${id}`),
    enabled: !!id,
  });

  const { data: gradesResp } = useQuery({
    queryKey: ['material-grades'],
    queryFn: () => api<{ grades: GradeRow[] }>('/material-grades'),
  });

  // Flux-grade tables — one per core type, same endpoint as the new-PO form.
  const { data: fluxTor } = useQuery({
    queryKey: ['flux-grades-grouped', 'TOROIDAL'],
    queryFn: () => api<{ grades: FluxGroup[] }>('/flux-grades/grouped?coreType=TOROIDAL'),
  });
  const { data: fluxRect } = useQuery({
    queryKey: ['flux-grades-grouped', 'RECTANGULAR'],
    queryFn: () => api<{ grades: FluxGroup[] }>('/flux-grades/grouped?coreType=RECTANGULAR'),
  });

  return (
    <div className="space-y-4 max-w-5xl">
      <div className="flex items-center gap-3">
        <Link to="/po/manage" className="btn-ghost text-slate-600">
          <ArrowLeft className="h-4 w-4" /> Back
        </Link>
        <h1 className="text-2xl font-bold tracking-tight">Edit Sales Order Item</h1>
      </div>

      {isLoading && <div className="card p-8 text-center text-slate-400">Loading…</div>}

      {!isLoading && item && item.status === 'CANCELLED' && (
        <div className="card p-5 border border-amber-200 bg-amber-50 text-amber-800">
          This item has been <strong>cancelled</strong> and can no longer be edited.
        </div>
      )}

      {item && item.status === 'ACTIVE' && (
        <>
          {/* Header strip — read-only context about which Sales Order this item belongs to */}
          <section className="card p-3 flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
            <span className="flex items-center gap-1.5 text-slate-500"><Hash className="h-3.5 w-3.5" /> SO</span>
            <span className="font-mono text-slate-900">{item.poNumber}</span>
            <span className="flex items-center gap-1.5 text-slate-500"><User2 className="h-3.5 w-3.5" /> Customer</span>
            <span className="text-slate-900">{item.customerName}</span>
            <span className="ml-auto text-xs text-slate-500">
              <span className={cn(
                'rounded-full px-2 py-0.5 font-medium',
                item.coreType === 'TOROIDAL' ? 'bg-amber-50 text-amber-700' : 'bg-rose-50 text-rose-700'
              )}>
                {item.coreType}
              </span>
            </span>
          </section>

          {/* Production / dispatch context — shows the lower bound on Pcs */}
          {((item.pcsProduced ?? 0) > 0 || (item.pcsDispatched ?? 0) > 0) && (
            <section className="card p-3 text-xs">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-slate-600">
                <span className="text-slate-500">Already processed:</span>
                <span><strong>{item.pcsProduced ?? 0}</strong> produced</span>
                <span className="text-slate-300">·</span>
                <span><strong>{item.pcsDispatched ?? 0}</strong> dispatched</span>
                <span className="text-slate-300">·</span>
                <span className="text-amber-700">
                  Pcs cannot be reduced below <strong>
                    {Math.max(item.pcsProduced ?? 0, item.pcsDispatched ?? 0)}
                  </strong>
                </span>
              </div>
            </section>
          )}

          {item.coreType === 'TOROIDAL'
            ? <ToroidalEditor
                item={item}
                grades={gradesResp?.grades ?? []}
                fluxGrades={fluxTor?.grades ?? []}
                onSaved={() => {
                  queryClient.invalidateQueries({ queryKey: ['po-items'] });
                  navigate('/po/manage');
                }}
              />
            : <RectangularEditor
                item={item}
                grades={gradesResp?.grades ?? []}
                fluxGrades={fluxRect?.grades ?? []}
                onSaved={() => {
                  queryClient.invalidateQueries({ queryKey: ['po-items'] });
                  navigate('/po/manage');
                }}
              />}
        </>
      )}
    </div>
  );
};

/* ---------- toroidal editor ---------- */
const ToroidalEditor = ({
  item, grades, fluxGrades, onSaved,
}: { item: Item; grades: GradeRow[]; fluxGrades: FluxGroup[]; onSaved: () => void }) => {
  const [grade, setGrade] = useState(item.grade);
  const [material, setMaterial] = useState(item.material);
  const [id1, setId1] = useState(item.id1);
  const [od1, setOd1] = useState(item.od1);
  const [ht, setHt]   = useState(item.ht);
  const [pcs, setPcs] = useState(item.pcs);
  const [rateBasis, setRateBasis] = useState<'PER_KG' | 'PER_PCS'>(item.rateBasis ?? 'PER_KG');
  const [rateValue, setRateValue] = useState(item.rateValue ?? 0);
  // Flux-test calibration — pre-filled from the existing item.
  const [turns, setTurns] = useState(item.turns ?? 0);
  const [flux,  setFlux]  = useState(item.flux  ?? 0);

  const minPcs = Math.max(item.pcsProduced ?? 0, item.pcsDispatched ?? 0);
  const calc = useMemo(() => toroidalCalc({ id: id1, od: od1, ht, pcs }), [id1, od1, ht, pcs]);
  const matchingMaterials = grades.find((g) => g.grade === grade)?.materials ?? [];
  const derived = deriveRate({ rateBasis, rateValue, weightPerPc: calc.weightPerPc, pcs, totalWeight: calc.totalWeight });

  // Available flux points for the selected grade. ateCm is looked up from the
  // point — if the existing flux doesn't match a known point (e.g. the grade's
  // flux table changed since this PO was created), we fall back to item.ateCm.
  const fluxPoints = fluxGrades.find((g) => g.grade === grade)?.points ?? [];
  const ateCm = fluxPoints.find((p) => p.flux === flux)?.ateCm ?? item.ateCm ?? 0;
  const gradeHasFluxData = fluxPoints.length > 0;
  const fluxOptions = fluxPoints.map((p) => ({ value: String(p.flux), label: `${p.flux.toFixed(2)} T` }));
  const fluxCalc = useMemo(
    () => fluxTestCalc({ id: id1, od: od1, ht, turns, flux, ateCm }),
    [id1, od1, ht, turns, flux, ateCm]
  );

  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => {
      // Client-side guard so the user sees the issue without a round-trip.
      if (pcs < minPcs) {
        return Promise.reject(new Error(
          `Pcs (${pcs}) is below already produced/dispatched (${minPcs}). Cannot reduce below the processed amount.`
        ));
      }
      return api(`/po-orders/items/${item.id}`, {
        method: 'PATCH',
        json: {
          coreType: 'TOROIDAL',
          grade, material,
          measure: calc.measure,
          id1, od1, ht, pcs,
          weightPerPc: calc.weightPerPc, totalWeight: calc.totalWeight,
          rateBasis: rateValue > 0 ? rateBasis : null,
          rateValue: rateValue > 0 ? rateValue : null,
          // Flux-test fields — send null when the user has cleared them.
          turns:       turns > 0 ? turns : null,
          flux:        flux  > 0 ? flux  : null,
          ateCm:       flux  > 0 && ateCm > 0 ? ateCm : null,
          testVoltage: fluxCalc.testVoltage > 0 ? fluxCalc.testVoltage : null,
          testCurrent: fluxCalc.testCurrent > 0 ? fluxCalc.testCurrent : null,
        },
      });
    },
    onSuccess: onSaved,
    onError: (e) => setError(e instanceof ApiError ? e.message : (e as Error).message ?? 'Save failed'),
  });

  return (
    <section className="card p-4 space-y-4">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-amber-800">Toroidal</div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
        <Field label="Grade">
          <SearchableSelect
            value={grade}
            onChange={(v) => { setGrade(v); setMaterial(''); }}
            options={grades.map((g) => ({ value: g.grade, label: g.grade }))}
            placeholder="Select grade…"
          />
        </Field>
        <Field label="Material">
          <SearchableSelect
            value={material}
            onChange={setMaterial}
            options={matchingMaterials.map((m) => ({ value: m.material, label: m.material }))}
            placeholder={grade ? 'Select material…' : 'Pick grade first'}
            disabled={!grade}
          />
        </Field>
        <NumField label="ID"  value={id1} onChange={setId1} />
        <NumField label="OD"  value={od1} onChange={setOd1} />
        <NumField label="HT"  value={ht}  onChange={setHt} />
        <NumField label="Pcs" value={pcs} onChange={setPcs} />
        <NumField label="Turns" value={turns} onChange={setTurns} />
        <Field label="Flux ( T )">
          <SearchableSelect
            value={flux > 0 ? String(flux) : ''}
            onChange={(v) => setFlux(v ? Number(v) : 0)}
            options={fluxOptions}
            placeholder={
              !grade ? 'Pick grade first'
              : !gradeHasFluxData ? `No flux data for "${grade}"`
              : 'Select flux…'
            }
            disabled={!grade || !gradeHasFluxData}
          />
        </Field>
        <Field label="Rate Basis">
          <select
            className="input"
            value={rateBasis}
            onChange={(e) => setRateBasis(e.target.value as 'PER_KG' | 'PER_PCS')}
          >
            <option value="PER_KG">Per Kg</option>
            <option value="PER_PCS">Per Pcs</option>
          </select>
        </Field>
        <NumField label={rateBasis === 'PER_KG' ? 'Rate (₹/kg)' : 'Rate (₹/pcs)'} value={rateValue} onChange={setRateValue} />
      </div>

      <ComputedRow stats={[
        ['Wt/pc',    calc.weightPerPc.toFixed(3)],
        ['Total Wt', calc.totalWeight.toFixed(3)],
        ['Measure',  calc.measure],
        ['ATe/cm',   ateCm > 0 ? ateCm.toFixed(3) : '—'],
        ['V (Volts)', fluxCalc.testVoltage > 0 ? fluxCalc.testVoltage.toFixed(3) : '—'],
        ['I (mA)',   fluxCalc.testCurrent > 0 ? fluxCalc.testCurrent.toFixed(2) : '—'],
        ...(rateValue > 0 ? [
          ['Rate / Kg',  `₹${(derived.ratePerKg ?? 0).toFixed(2)}`],
          ['Rate / Pc',  `₹${(derived.ratePerPc ?? 0).toFixed(2)}`],
          ['Line Total', `₹${(derived.totalAmount ?? 0).toFixed(2)}`],
        ] as [string, string][] : []),
      ]} />

      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

      <Actions onSave={() => save.mutate()} saving={save.isPending} />
    </section>
  );
};

/* ---------- rectangular editor ---------- */
const RectangularEditor = ({
  item, grades, fluxGrades, onSaved,
}: { item: Item; grades: GradeRow[]; fluxGrades: FluxGroup[]; onSaved: () => void }) => {
  const [grade, setGrade] = useState(item.grade);
  const [material, setMaterial] = useState(item.material);
  const [id1, setId1] = useState(item.id1);
  const [id2, setId2] = useState(item.id2 ?? 0);
  const [od1, setOd1] = useState(item.od1);
  const [od2, setOd2] = useState(item.od2 ?? 0);
  const [ht, setHt]   = useState(item.ht);
  const [pcs, setPcs] = useState(item.pcs);
  const [rateBasis, setRateBasis] = useState<'PER_KG' | 'PER_PCS'>(item.rateBasis ?? 'PER_KG');
  const [rateValue, setRateValue] = useState(item.rateValue ?? 0);
  const [turns, setTurns] = useState(item.turns ?? 0);
  const [flux,  setFlux]  = useState(item.flux  ?? 0);

  const minPcs = Math.max(item.pcsProduced ?? 0, item.pcsDispatched ?? 0);
  const calc = useMemo(
    () => rectangularCalc({ id1, id2, od1, od2, ht, pcs }),
    [id1, id2, od1, od2, ht, pcs]
  );
  const matchingMaterials = grades.find((g) => g.grade === grade)?.materials ?? [];
  const derived = deriveRate({ rateBasis, rateValue, weightPerPc: calc.weightPerPc, pcs, totalWeight: calc.totalWeight });

  const fluxPoints = fluxGrades.find((g) => g.grade === grade)?.points ?? [];
  const ateCm = fluxPoints.find((p) => p.flux === flux)?.ateCm ?? item.ateCm ?? 0;
  const gradeHasFluxData = fluxPoints.length > 0;
  const fluxOptions = fluxPoints.map((p) => ({ value: String(p.flux), label: `${p.flux.toFixed(2)} T` }));
  const fluxCalc = useMemo(
    () => rectangularFluxTestCalc({ area: calc.coreAc, meanPath: calc.coreMl, turns, flux, ateCm }),
    [calc.coreAc, calc.coreMl, turns, flux, ateCm]
  );

  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => {
      if (pcs < minPcs) {
        return Promise.reject(new Error(
          `Pcs (${pcs}) is below already produced/dispatched (${minPcs}). Cannot reduce below the processed amount.`
        ));
      }
      return api(`/po-orders/items/${item.id}`, {
        method: 'PATCH',
        json: {
          coreType: 'RECTANGULAR',
          grade, material,
          measure: calc.measure,
          id1, id2, od1, od2, ht,
          builtup: calc.builtup,
          weightPerPc: calc.weightPerPc, totalWeight: calc.totalWeight,
          pcs,
          coreAc: calc.coreAc, coreMl: calc.coreMl, d13: calc.d13,
          rateBasis: rateValue > 0 ? rateBasis : null,
          rateValue: rateValue > 0 ? rateValue : null,
          turns:       turns > 0 ? turns : null,
          flux:        flux  > 0 ? flux  : null,
          ateCm:       flux  > 0 && ateCm > 0 ? ateCm : null,
          testVoltage: fluxCalc.testVoltage > 0 ? fluxCalc.testVoltage : null,
          testCurrent: fluxCalc.testCurrent > 0 ? fluxCalc.testCurrent : null,
        },
      });
    },
    onSuccess: onSaved,
    onError: (e) => setError(e instanceof ApiError ? e.message : (e as Error).message ?? 'Save failed'),
  });

  return (
    <section className="card p-4 space-y-4">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-rose-800">Rectangular</div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
        <Field label="Grade">
          <SearchableSelect
            value={grade}
            onChange={(v) => { setGrade(v); setMaterial(''); }}
            options={grades.map((g) => ({ value: g.grade, label: g.grade }))}
            placeholder="Select grade…"
          />
        </Field>
        <Field label="Material">
          <SearchableSelect
            value={material}
            onChange={setMaterial}
            options={matchingMaterials.map((m) => ({ value: m.material, label: m.material }))}
            placeholder={grade ? 'Select material…' : 'Pick grade first'}
            disabled={!grade}
          />
        </Field>
        <NumField label="ID 1" value={id1} onChange={setId1} />
        <NumField label="ID 2" value={id2} onChange={setId2} />
        <NumField label="OD 1" value={od1} onChange={setOd1} />
        <NumField label="OD 2" value={od2} onChange={setOd2} />
        <NumField label="HT"   value={ht}  onChange={setHt} />
        <NumField label="Pcs"  value={pcs} onChange={setPcs} />
        <NumField label="Turns" value={turns} onChange={setTurns} />
        <Field label="Flux ( T )">
          <SearchableSelect
            value={flux > 0 ? String(flux) : ''}
            onChange={(v) => setFlux(v ? Number(v) : 0)}
            options={fluxOptions}
            placeholder={
              !grade ? 'Pick grade first'
              : !gradeHasFluxData ? `No flux data for "${grade}"`
              : 'Select flux…'
            }
            disabled={!grade || !gradeHasFluxData}
          />
        </Field>
        <Field label="Rate Basis">
          <select
            className="input"
            value={rateBasis}
            onChange={(e) => setRateBasis(e.target.value as 'PER_KG' | 'PER_PCS')}
          >
            <option value="PER_KG">Per Kg</option>
            <option value="PER_PCS">Per Pcs</option>
          </select>
        </Field>
        <NumField label={rateBasis === 'PER_KG' ? 'Rate (₹/kg)' : 'Rate (₹/pcs)'} value={rateValue} onChange={setRateValue} />
      </div>

      <ComputedRow stats={[
        ['Built-up', calc.builtup.toFixed(3)],
        ['Core A/C', calc.coreAc.toFixed(3)],
        ['D-13',     calc.d13.toFixed(3)],
        ['Core M/L', calc.coreMl.toFixed(3)],
        ['Wt/pc',    calc.weightPerPc.toFixed(3)],
        ['Total Wt', calc.totalWeight.toFixed(3)],
        ['Measure',  calc.measure],
        ['ATe/cm',   ateCm > 0 ? ateCm.toFixed(3) : '—'],
        ['V (Volts)', fluxCalc.testVoltage > 0 ? fluxCalc.testVoltage.toFixed(3) : '—'],
        ['I (mA)',   fluxCalc.testCurrent > 0 ? fluxCalc.testCurrent.toFixed(2) : '—'],
        ...(rateValue > 0 ? [
          ['Rate / Kg',  `₹${(derived.ratePerKg ?? 0).toFixed(2)}`],
          ['Rate / Pc',  `₹${(derived.ratePerPc ?? 0).toFixed(2)}`],
          ['Line Total', `₹${(derived.totalAmount ?? 0).toFixed(2)}`],
        ] as [string, string][] : []),
      ]} />

      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

      <Actions onSave={() => save.mutate()} saving={save.isPending} />
    </section>
  );
};

/* ---------- shared bits ---------- */
const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <label className="block">
    <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</span>
    {children}
  </label>
);

const NumField = ({
  label, value, onChange,
}: { label: string; value: number; onChange: (v: number) => void }) => (
  <Field label={label}>
    <input
      className="input"
      type="number"
      inputMode="decimal"
      step="any"
      value={value === 0 ? '' : value}
      onChange={(e) => onChange(numFromInput(e.target.value))}
      placeholder="0"
    />
  </Field>
);

const ComputedRow = ({ stats }: { stats: [string, string][] }) => (
  <div className="rounded-md border border-slate-200 bg-slate-50/50 px-3 py-2">
    <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 sm:grid-cols-4 md:grid-cols-6">
      {stats.map(([label, value]) => (
        <div key={label} className="min-w-0">
          <div className="text-[10px] font-medium uppercase tracking-wide text-slate-500">{label}</div>
          <div className="truncate font-mono text-sm tabular-nums text-slate-700">{value}</div>
        </div>
      ))}
    </div>
  </div>
);

const Actions = ({ onSave, saving }: { onSave: () => void; saving: boolean }) => (
  <div className="flex justify-end gap-3">
    <Link to="/po/manage" className="btn-ghost">Cancel</Link>
    <button onClick={onSave} disabled={saving} className="btn-primary">
      {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
      Save changes
    </button>
  </div>
);

// Same calc as the server-side helper. Mirrored here so the UI can show the
// derived rates live as the user types, before the PATCH round-trip.
const deriveRate = ({
  rateBasis, rateValue, weightPerPc, pcs, totalWeight,
}: {
  rateBasis: 'PER_KG' | 'PER_PCS';
  rateValue: number;
  weightPerPc: number;
  pcs: number;
  totalWeight: number;
}) => {
  if (!rateValue || rateValue <= 0) return { ratePerKg: null, ratePerPc: null, totalAmount: null };
  if (rateBasis === 'PER_KG') {
    return {
      ratePerKg: rateValue,
      ratePerPc: weightPerPc > 0 ? rateValue * weightPerPc : null,
      totalAmount: rateValue * totalWeight,
    };
  }
  return {
    ratePerPc: rateValue,
    ratePerKg: weightPerPc > 0 ? rateValue / weightPerPc : null,
    totalAmount: rateValue * pcs,
  };
};
