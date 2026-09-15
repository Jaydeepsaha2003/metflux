import '@/components/production/workspace.css';
// Edit a production record. Pcs is constrained: cannot exceed
// (item.pcs − sum of OTHER production records). Weight per pc is read-only
// since it comes from the PO item itself.
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Save, Loader2, Factory } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { SearchableSelect } from '@/components/SearchableSelect';
import { useHideCustomerNames } from '@/store/auth';
import { useConfirm } from '@/hooks/useConfirm';
import { cn } from '@/lib/cn';
import { ErpCard, ErpLabel, CoreTypeChip, SplitHeightChip, ProductionTabs } from '@/components/production/erp';

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
  itemHt: number | null;
  othersPcs: number;
  prodDate: string;
  pcs: number;
  weightPerPc: number;
  totalWeight: number;
  labourName: string;
  splitHeight: number | null;
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
  const [isSplit, setIsSplit] = useState(false);
  const [splitHeight, setSplitHeight] = useState(0);
  const [error, setError] = useState<{ message: string; details?: string[] } | null>(null);

  useEffect(() => {
    if (!item) return;
    setProdDate(item.prodDate.slice(0, 10));
    setLabourName(item.labourName);
    setPcs(item.pcs);
    setIsSplit(item.splitHeight != null);
    setSplitHeight(item.splitHeight ?? 0);
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
    if (isSplit) {
      if (!(splitHeight > 0)) missing.push('Split height > 0');
      else if (item.itemHt != null && splitHeight >= item.itemHt) missing.push(`Split height must be less than ${item.itemHt} (the full ordered height)`);
    }
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
      splitHeight: isSplit ? splitHeight : null,
    });
  };

  return (
    <div className="production-workspace space-y-3 max-w-3xl">
      <div className="flex items-center gap-3">
        <Link to="/production" className="btn-ghost text-slate-600">
          <ArrowLeft className="h-4 w-4" /> Back
        </Link>
        <h1 className="flex items-center gap-2 text-xl font-extrabold tracking-tight text-slate-900 sm:text-2xl">
          <Factory className="h-5 w-5 text-brand-600" /> Edit Production
        </h1>
      </div>

      <ProductionTabs />

      {isLoading && <ErpCard className="p-8 text-center text-slate-400">Loading…</ErpCard>}

      {item && (
        <ErpCard>
          {/* WHAT WAS MADE — the order this entry was recorded against; not
              editable here, it comes from the PO item itself. */}
          <div className="border-b border-slate-100 p-3 sm:p-4">
            <ErpLabel className="mb-2 block">What Was Made</ErpLabel>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 text-sm sm:grid-cols-4">
              <div>
                <ErpLabel className="block">Sales Order</ErpLabel>
                <div className="mt-0.5 font-num text-[13px] font-semibold text-slate-900">{item.poNumber}</div>
              </div>
              <div className="col-span-2">
                <ErpLabel className="block">Customer</ErpLabel>
                <div className="mt-0.5 truncate text-sm font-medium text-slate-900">
                  <span className="mr-1.5 font-num text-xs font-semibold text-brand-700">{item.customerCode ?? '—'}</span>
                  {!hideNames && item.customerName}
                </div>
              </div>
              <div>
                <ErpLabel className="block">Core</ErpLabel>
                <div className="mt-0.5 flex items-center gap-1.5"><CoreTypeChip coreType={item.coreType} /> <span className="text-sm text-slate-700">{item.grade}</span></div>
              </div>
              <div className="col-span-2 sm:col-span-4">
                <ErpLabel className="block">Measure</ErpLabel>
                <div className="mt-0.5 flex flex-wrap items-center gap-1.5 font-num text-[13px] text-slate-700">
                  {item.measure} <span className="text-slate-400">· {item.material}</span>
                  {item.splitHeight != null && <SplitHeightChip height={item.splitHeight} />}
                </div>
              </div>
            </dl>
          </div>

          {/* FIGURES — the editable production entry. */}
          <div className="space-y-4 p-3 sm:p-4">
            <ErpLabel className="block">Figures</ErpLabel>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
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
              <Field label={`Pcs (${item.itemPcs - item.othersPcs} remaining)`}>
                <input
                  className="input h-9 text-sm" type="number" inputMode="numeric" min={1}
                  value={pcs || ''} onChange={(e) => setPcs(parseInt(e.target.value || '0', 10))}
                />
              </Field>
              <Field label="Wt / pc">
                <input className="input h-9 bg-slate-50 text-sm font-num" value={item.weightPerPc.toFixed(3)} readOnly />
              </Field>
              <Field label="Total Weight">
                <input className="input h-9 bg-slate-50 text-sm font-num" value={totalWeight ? totalWeight.toFixed(3) : ''} readOnly />
              </Field>
            </div>

            {/* Whole Piece vs Split Width — see splitProduction.js for the
                matching rule. Switching back to Whole Piece here clears this
                entry's splitHeight on save. */}
            <div className="rounded border border-slate-200 bg-white px-3 py-2.5">
              <div className="flex items-center justify-between gap-2">
                <ErpLabel>Production Type</ErpLabel>
                <div className="inline-flex rounded-[3px] border border-slate-200 bg-white p-0.5">
                  <button
                    type="button"
                    onClick={() => { setIsSplit(false); setSplitHeight(0); }}
                    className={cn('rounded-[3px] px-2.5 py-1 text-[11px] font-extrabold uppercase tracking-wide transition-colors duration-150',
                      !isSplit ? 'bg-brand-900 text-white' : 'text-slate-600 hover:bg-slate-100')}
                  >
                    Whole Piece
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsSplit(true)}
                    className={cn('rounded-[3px] px-2.5 py-1 text-[11px] font-extrabold uppercase tracking-wide transition-colors duration-150',
                      isSplit ? 'bg-brand-900 text-white' : 'text-slate-600 hover:bg-slate-100')}
                  >
                    Split Width
                  </button>
                </div>
              </div>
              {isSplit && (
                <div className="mt-3">
                  <Field label={`Split Height (full height: ${item.itemHt ?? '—'})`}>
                    <input
                      className="input h-9 text-sm"
                      type="number"
                      inputMode="decimal"
                      min={0}
                      value={splitHeight || ''}
                      onChange={(e) => setSplitHeight(parseFloat(e.target.value || '0'))}
                    />
                  </Field>
                </div>
              )}
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

            <div className="flex flex-col-reverse gap-2 border-t border-slate-100 pt-3 sm:flex-row sm:justify-end sm:gap-3">
              <Link to="/production" className="btn-ghost w-full sm:w-auto justify-center">Cancel</Link>
              <button onClick={onSave} disabled={save.isPending} className="btn-primary w-full sm:w-auto justify-center">
                {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Save changes
              </button>
            </div>
          </div>
        </ErpCard>
      )}
      {confirmDialog}
    </div>
  );
};

const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <label className="block">
    <ErpLabel className="mb-1 block">{label}</ErpLabel>
    {children}
  </label>
);
