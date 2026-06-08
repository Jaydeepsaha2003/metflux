// Edit a production record. Pcs is constrained: cannot exceed
// (item.pcs − sum of OTHER production records). Weight per pc is read-only
// since it comes from the PO item itself.
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Save, Loader2, Factory, Hash, User2 } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { SearchableSelect } from '@/components/SearchableSelect';
import { useHideCustomerNames } from '@/store/auth';
import { useConfirm } from '@/hooks/useConfirm';

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
  othersPcs: number;
  prodDate: string;
  pcs: number;
  weightPerPc: number;
  totalWeight: number;
  labourName: string;
};

export const ProductionEditPage = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const hideNames = useHideCustomerNames();
  const { confirm, confirmDialog } = useConfirm();

  const { data: item, isLoading } = useQuery({
    queryKey: ['production-item', id],
    queryFn: () => api<Item>(`/production/${id}`),
    enabled: !!id,
  });

  const { data: laboursResp } = useQuery({
    queryKey: ['labours-dropdown'],
    queryFn: () => api<{ labours: { id: string; name: string }[] }>('/labours/dropdown'),
  });

  const [prodDate, setProdDate] = useState('');
  const [labourName, setLabourName] = useState('');
  const [pcs, setPcs] = useState(0);
  const [error, setError] = useState<{ message: string; details?: string[] } | null>(null);

  useEffect(() => {
    if (!item) return;
    setProdDate(item.prodDate.slice(0, 10));
    setLabourName(item.labourName);
    setPcs(item.pcs);
  }, [item]);

  const totalWeight = useMemo(
    () => (item ? +(pcs * item.weightPerPc).toFixed(3) : 0),
    [pcs, item]
  );

  const save = useMutation({
    mutationFn: (body: unknown) => api(`/production/${id}`, { method: 'PATCH', json: body }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['production'] });
      queryClient.invalidateQueries({ queryKey: ['production-item', id] });
      navigate('/production');
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
    if (!item) return;
    const missing: string[] = [];
    if (!labourName.trim()) missing.push('Labour name');
    if (pcs <= 0) missing.push('Pcs > 0');
    if (missing.length) {
      setError({ message: 'Please fix the form', details: missing });
      return;
    }

    const maxAllowed = item.itemPcs - item.othersPcs;
    if (pcs > maxAllowed) {
      const excessPcs = pcs - maxAllowed;
      const ok = await confirm({
        title: 'Excess Production',
        tone: 'warning',
        confirmLabel: 'Yes, Save Excess',
        cancelLabel: 'Go Back',
        message: (
          <div className="space-y-2 text-sm">
            <p>
              You are saving <strong>{pcs} pcs</strong> but only{' '}
              <strong>{maxAllowed} pcs</strong> remain for this PO item
              (ordered: {item.itemPcs}).
            </p>
            <p>
              This will produce <strong>{excessPcs} extra pcs</strong> beyond the
              order. The full {pcs} pcs will be available for dispatch.
            </p>
            <p className="text-slate-500">Are you sure you want to proceed?</p>
          </div>
        ),
      });
      if (!ok) return;
    }

    save.mutate({
      prodDate,
      pcs,
      labourName: labourName.trim(),
      weightPerPc: item.weightPerPc,
      totalWeight,
    });
  };

  return (
    <div className="space-y-4 max-w-4xl">
      <div className="flex items-center gap-3">
        <Link to="/production" className="btn-ghost text-slate-600">
          <ArrowLeft className="h-4 w-4" /> Back
        </Link>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Factory className="h-5 w-5 text-brand-600" /> Edit Production
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
              <Field label={`Pcs (${item.itemPcs - item.othersPcs} remaining)`}>
                <input
                  className="input" type="number" inputMode="numeric" min={1}
                  value={pcs || ''} onChange={(e) => setPcs(parseInt(e.target.value || '0', 10))}
                />
              </Field>
              <Field label="Wt / pc">
                <input className="input bg-slate-50" value={item.weightPerPc.toFixed(3)} readOnly />
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
              <Link to="/production" className="btn-ghost w-full sm:w-auto justify-center">Cancel</Link>
              <button onClick={onSave} disabled={save.isPending} className="btn-primary w-full sm:w-auto justify-center">
                {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Save changes
              </button>
            </div>
          </section>
        </>
      )}
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
