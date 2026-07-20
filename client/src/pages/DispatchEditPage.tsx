// Edit a dispatch record — pcs constrained to available (produced − other dispatches).
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Save, Loader2, Truck, Hash, User2 } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useHideCustomerNames } from '@/store/auth';

type Item = {
  id: string;
  poNumber: string;
  customerName: string;
  customerCode: string | null;
  coreType: 'TOROIDAL' | 'RECTANGULAR';
  grade: string;
  material: string;
  measure: string;
  itemPcs: number;
  dispatchDate: string;
  pcs: number;
  weightPerPc: number;
  totalWeight: number;
  boxes: number | null;
  actualWeight: number | null;
  vehicleNo: string | null;
};

export const DispatchEditPage = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const hideNames = useHideCustomerNames();

  const { data: item, isLoading } = useQuery({
    queryKey: ['dispatch-item', id],
    queryFn: () => api<Item>(`/dispatch/${id}`),
    enabled: !!id,
  });

  const [dispatchDate, setDispatchDate] = useState('');
  const [vehicleNo, setVehicleNo] = useState('');
  const [pcs, setPcs] = useState(0);
  const [boxes, setBoxes] = useState(0);
  const [actualWeight, setActualWeight] = useState(0);
  const [error, setError] = useState<{ message: string; details?: string[] } | null>(null);

  useEffect(() => {
    if (!item) return;
    setDispatchDate(item.dispatchDate.slice(0, 10));
    setVehicleNo(item.vehicleNo ?? '');
    setPcs(item.pcs);
    setActualWeight(item.actualWeight ?? 0);
    setBoxes(item.boxes ?? 0);
  }, [item]);

  const totalWeight = useMemo(
    () => (item ? +(pcs * item.weightPerPc).toFixed(3) : 0),
    [pcs, item]
  );

  const save = useMutation({
    mutationFn: (body: unknown) => api(`/dispatch/${id}`, { method: 'PATCH', json: body }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dispatch'] });
      queryClient.invalidateQueries({ queryKey: ['dispatch-item', id] });
      navigate('/dispatch');
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
    if (!item) return;
    if (pcs <= 0) {
      setError({ message: 'Please fix the form', details: ['Pcs must be > 0'] });
      return;
    }
    save.mutate({
      dispatchDate,
      pcs,
      weightPerPc: item.weightPerPc,
      totalWeight,
      boxes: boxes > 0 ? boxes : null,
      actualWeight: actualWeight > 0 ? actualWeight : null,
      vehicleNo: vehicleNo.trim() || null,
    });
  };

  return (
    <div className="space-y-4 max-w-4xl">
      <div className="flex items-center gap-3">
        <Link to="/dispatch" className="btn-ghost text-slate-600">
          <ArrowLeft className="h-4 w-4" /> Back
        </Link>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Truck className="h-5 w-5 text-brand-600" /> Edit Dispatch
        </h1>
      </div>

      {isLoading && <div className="card p-8 text-center text-slate-400">Loading…</div>}

      {item && (
        <>
          <section className="card p-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm">
            <span className="flex items-center gap-1.5 text-slate-500"><Hash className="h-3.5 w-3.5" /> PO</span>
            <span className="font-mono text-slate-900">{item.poNumber}</span>
            <span className="flex items-center gap-1.5 text-slate-500"><User2 className="h-3.5 w-3.5" /> Customer</span>
            <span className="text-slate-900 truncate">
              <span className="font-mono text-xs font-semibold text-brand-700 mr-1.5">{item.customerCode ?? '—'}</span>
              {!hideNames && item.customerName}
            </span>
            <span className="basis-full sm:basis-auto sm:ml-auto text-xs text-slate-500">
              {item.grade} · {item.material} · <span className="font-mono break-all">{item.measure}</span>
            </span>
          </section>

          <section className="card p-4 space-y-4">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <Field label="Dispatch Date">
                <input className="input" type="date" value={dispatchDate} onChange={(e) => setDispatchDate(e.target.value)} />
              </Field>
              <Field label="Vehicle No.">
                <input className="input" value={vehicleNo} onChange={(e) => setVehicleNo(e.target.value)} placeholder="Optional" />
              </Field>
              <Field label="Pcs">
                <input
                  className="input" type="number" inputMode="numeric" min={1}
                  value={pcs || ''}
                  onChange={(e) => setPcs(parseInt(e.target.value || '0', 10))}
                />
              </Field>
              <Field label="Wt / pc">
                <input className="input bg-slate-50" value={item.weightPerPc.toFixed(3)} readOnly />
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
              <button onClick={onSave} disabled={save.isPending} className="btn-primary w-full sm:w-auto justify-center">
                {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Save changes
              </button>
            </div>
          </section>
        </>
      )}
    </div>
  );
};

const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <label className="block">
    <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</span>
    {children}
  </label>
);
