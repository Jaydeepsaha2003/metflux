// Master grade/material list — scoped to the active company. Used by the PO
// entry form for grade + material dropdowns. Each grade declares which core
// types it applies to (Toroidal / Rectangular / Nano); Nano grades also carry
// finish-output offsets (mm added to ID / OD / HT to get the finished size).
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, Trash2, Save, X, Layers, Loader2 } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useConfirm } from '@/hooks/useConfirm';
import { BulkExcel, type BulkExcelConfig } from '@/components/BulkExcel';

// The shared list, so a family added there cannot be missing from the gate.
import type { CoreType } from '@/lib/coreTypes';
type Row = {
  id: string; grade: string; material: string; createdAt: string;
  coreTypes: CoreType[];
  nanoIdOff: number | null; nanoOdOff: number | null; nanoHtOff: number | null;
};
type Attrs = { coreTypes: CoreType[]; nanoIdOff: number | null; nanoOdOff: number | null; nanoHtOff: number | null };

/* Every family, because this list IS the gate. A grade whose coreTypes do not
   name a family is filtered out of that family's grade dropdown on the order
   form, so leaving the two cut families off here meant the Round cut and Rect
   cut tabs opened onto an empty "Select grade…" and could not be used at all —
   with nowhere in the UI to put that right. */
const ALL_CORES: CoreType[] = [
  'TOROIDAL', 'RECTANGULAR', 'NANO', 'COMPOSITE', 'CUT_ROUND', 'CUT_RECT',
  'E_CORE', 'EI_CORE', 'WOUND_CORE', 'STEP_CORE',
];
const CORE_LABEL: Record<CoreType, string> = {
  TOROIDAL: 'Toroidal', RECTANGULAR: 'Rectangular', NANO: 'Nano', COMPOSITE: 'Composite',
  CUT_ROUND: 'Round cut', CUT_RECT: 'Rect cut',
  E_CORE: 'E core', EI_CORE: 'EI core', WOUND_CORE: 'Wound core', STEP_CORE: 'Step core',
};
const CORE_TONE: Record<CoreType, string> = {
  TOROIDAL: 'bg-amber-50 text-amber-700 ring-amber-200',
  RECTANGULAR: 'bg-rose-50 text-rose-700 ring-rose-200',
  NANO: 'bg-violet-50 text-violet-700 ring-violet-200',
  COMPOSITE: 'bg-teal-50 text-teal-700 ring-teal-200',
  E_CORE: 'bg-indigo-50 text-indigo-700 ring-indigo-200',
  EI_CORE: 'bg-violet-50 text-violet-700 ring-violet-200',
  WOUND_CORE: 'bg-orange-50 text-orange-700 ring-orange-200',
  STEP_CORE: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  CUT_ROUND: 'bg-sky-50 text-sky-700 ring-sky-200',
  CUT_RECT: 'bg-cyan-50 text-cyan-700 ring-cyan-200',
};
const signed = (n: number | null) => (n == null || n === 0 ? '0' : n > 0 ? `+${n}` : `${n}`);

export const MaterialsPage = () => {
  const queryClient = useQueryClient();
  const { confirm, confirmDialog } = useConfirm();
  const { data, isLoading } = useQuery({
    queryKey: ['material-grades-flat'],
    queryFn: () => api<{ items: Row[] }>('/material-grades/_flat'),
  });

  const [error, setError] = useState<string | null>(null);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['material-grades-flat'] });
    queryClient.invalidateQueries({ queryKey: ['material-grades'] });
  };

  const addM = useMutation({
    mutationFn: (b: { grade: string; material: string } & Attrs) => api<Row>('/material-grades', { method: 'POST', json: b }),
    onSuccess: invalidate,
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Failed to add'),
  });
  const updateM = useMutation({
    mutationFn: ({ id, ...b }: { id: string; grade: string; material: string } & Attrs) => api<Row>(`/material-grades/${id}`, { method: 'PATCH', json: b }),
    onSuccess: invalidate,
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Failed to update'),
  });
  const deleteM = useMutation({
    mutationFn: (id: string) => api(`/material-grades/${id}`, { method: 'DELETE' }),
    onSuccess: invalidate,
  });

  const bulkConfig: BulkExcelConfig = {
    entityLabel: 'Grades & Materials',
    filenameBase: 'materials',
    sheetName: 'Materials',
    template: [
      { header: 'Grade', example: 'M4' },
      { header: 'Material', example: '0.23 DABBA' },
    ],
    fetchExportRows: async () => {
      const all = await api<{ items: Row[] }>('/material-grades/_flat');
      return all.items.map((r) => ({ 'Grade': r.grade, 'Material': r.material }));
    },
    importPath: '/material-grades/import',
    onImported: invalidate,
  };

  return (
    <div className="space-y-5 max-w-5xl">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Layers className="h-5 w-5 text-brand-600" /> Grades & Materials
        </h1>
        <BulkExcel config={bulkConfig} />
      </div>

      <MaterialPhysicsSettings />

      <AddRow onSubmit={(b) => addM.mutateAsync(b)} busy={addM.isPending} />

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
      )}

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3 w-10">#</th>
              <th className="px-4 py-3">Grade</th>
              <th className="px-4 py-3">Material</th>
              <th className="px-4 py-3">Core types</th>
              <th className="px-4 py-3 w-28 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr><td colSpan={5} className="px-4 py-10 text-center text-slate-400">Loading…</td></tr>
            )}
            {!isLoading && data?.items.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-10 text-center text-slate-400">
                No grades yet. Use the form above to add the first one.
              </td></tr>
            )}
            {data?.items.map((row, idx) => (
              <EditableRow
                key={row.id}
                index={idx + 1}
                row={row}
                onSave={(b) => updateM.mutateAsync({ id: row.id, ...b })}
                onDelete={async () => {
                  const ok = await confirm({
                    title: 'Delete grade / material?',
                    message: <>Delete <strong>{row.grade} — {row.material}</strong>?</>,
                    tone: 'danger',
                    confirmLabel: 'Delete',
                  });
                  if (ok) deleteM.mutate(row.id);
                }}
              />
            ))}
          </tbody>
        </table>
      </div>
      {confirmDialog}
    </div>
  );
};

/* ---------- material physics defaults ---------- */
type PhysicsKey = 'CRGO' | 'NANOCRYSTALLINE' | 'AMORPHOUS';
type Physics = Record<PhysicsKey, { density: number; stackingFactor: number }>;
const PHYSICS_DEFAULTS: Physics = {
  CRGO: { density: 7.65, stackingFactor: 0.9603383931 },
  NANOCRYSTALLINE: { density: 7.30, stackingFactor: 0.7946072185 },
  AMORPHOUS: { density: 7.25, stackingFactor: 0.86 },
};
const PHYSICS_LABEL: Record<PhysicsKey, string> = {
  CRGO: 'CRGO', NANOCRYSTALLINE: 'Nano Crystalline', AMORPHOUS: 'Amorphous',
};

const MaterialPhysicsSettings = () => {
  const qc = useQueryClient();
  const [form, setForm] = useState<Physics>(PHYSICS_DEFAULTS);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const query = useQuery({
    queryKey: ['company-settings', 'material-physics'],
    queryFn: () => api<Physics>('/company-settings/material-physics'),
  });
  useEffect(() => { if (query.data) setForm({ ...PHYSICS_DEFAULTS, ...query.data }); }, [query.data]);
  const mutation = useMutation({
    mutationFn: () => api<Physics>('/company-settings/material-physics', { method: 'PUT', json: form }),
    onSuccess: (data) => { setForm(data); setSaved(true); setError(''); qc.setQueryData(['company-settings', 'material-physics'], data); setTimeout(() => setSaved(false), 2400); },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Could not save material defaults'),
  });
  const update = (key: PhysicsKey, field: 'density' | 'stackingFactor', value: string) => {
    const n = Number(value);
    setForm((old) => ({ ...old, [key]: { ...old[key], [field]: Number.isFinite(n) ? n : 0 } }));
  };
  return (
    <section className="card border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Material calculation defaults</h2>
          <p className="text-xs text-slate-500">Used by weight, net area and test calculations. Changes apply to this company.</p>
        </div>
        <span className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Density: g/cm³ · stacking: 0–1</span>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        {(Object.keys(PHYSICS_LABEL) as PhysicsKey[]).map((key) => (
          <div key={key} className="border border-slate-200 bg-slate-50/60 p-3">
            <div className="mb-2 text-sm font-semibold text-slate-800">{PHYSICS_LABEL[key]}</div>
            <div className="grid grid-cols-2 gap-2">
              <label className="block"><span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-500">Density</span>
                <input className="input h-10 font-semibold" type="number" min="0.01" max="30" step="0.01" value={form[key].density} onChange={(e) => update(key, 'density', e.target.value)} /></label>
              <label className="block"><span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-500">Stacking factor</span>
                <input className="input h-10 font-semibold" type="number" min="0.01" max="1" step="0.0001" value={form[key].stackingFactor} onChange={(e) => update(key, 'stackingFactor', e.target.value)} /></label>
            </div>
          </div>
        ))}
      </div>
      {(error || saved) && <div className={cn('mt-2 text-xs font-medium', error ? 'text-red-600' : 'text-emerald-700')}>{error || 'Material defaults saved.'}</div>}
      <div className="mt-3 flex flex-wrap justify-end gap-2">
        <button type="button" className="btn-ghost" onClick={() => { setForm(PHYSICS_DEFAULTS); setError(''); }}>Reset defaults</button>
        <button type="button" className="btn-primary" disabled={mutation.isPending || Object.values(form).some((v) => v.density <= 0 || v.density > 30 || v.stackingFactor <= 0 || v.stackingFactor > 1)} onClick={() => mutation.mutate()}>
          <Save className="h-4 w-4" /> {mutation.isPending ? 'Saving…' : 'Save calculation defaults'}
        </button>
      </div>
    </section>
  );
};

/* ---------- core-type checkboxes ---------- */
const CoreChecks = ({ value, onChange }: { value: CoreType[]; onChange: (v: CoreType[]) => void }) => (
  <div className="flex flex-wrap gap-1.5">
    {ALL_CORES.map((ct) => {
      const on = value.includes(ct);
      return (
        <button
          key={ct} type="button"
          onClick={() => onChange(on ? value.filter((c) => c !== ct) : [...value, ct])}
          className={cn('rounded-full px-2.5 py-1 text-xs font-medium ring-1 transition',
            on ? CORE_TONE[ct] : 'bg-white text-slate-500 ring-slate-200 hover:bg-slate-50')}
        >
          {CORE_LABEL[ct]}
        </button>
      );
    })}
  </div>
);

/* ---------- nano finish-offset inputs ---------- */
const NanoOffsets = ({
  id, od, ht, onId, onOd, onHt,
}: {
  id: string; od: string; ht: string;
  onId: (v: string) => void; onOd: (v: string) => void; onHt: (v: string) => void;
}) => (
  <div className="rounded-lg border border-violet-200 bg-violet-50/40 p-3">
    <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-violet-800">
      Nano finish output (mm added to ID / OD / HT)
    </div>
    <div className="grid grid-cols-3 gap-2">
      <label className="block"><span className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-slate-500">ID ±</span>
        <input className="input" type="number" step="any" placeholder="-5" value={id} onChange={(e) => onId(e.target.value)} /></label>
      <label className="block"><span className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-slate-500">OD ±</span>
        <input className="input" type="number" step="any" placeholder="+5" value={od} onChange={(e) => onOd(e.target.value)} /></label>
      <label className="block"><span className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-slate-500">HT ±</span>
        <input className="input" type="number" step="any" placeholder="+5" value={ht} onChange={(e) => onHt(e.target.value)} /></label>
    </div>
    <div className="mt-1.5 text-[11px] text-slate-500">e.g. 90 × 140 × 40 with −5 / +5 / +5 → finished 85 × 145 × 45.</div>
  </div>
);

const toNum = (s: string): number | null => { const n = parseFloat(s); return Number.isFinite(n) ? n : null; };

/* ---------- add row ---------- */
const AddRow = ({
  onSubmit, busy,
}: { onSubmit: (b: { grade: string; material: string } & Attrs) => Promise<unknown>; busy: boolean }) => {
  const [grade, setGrade] = useState('');
  const [material, setMaterial] = useState('');
  const [coreTypes, setCoreTypes] = useState<CoreType[]>(['TOROIDAL', 'RECTANGULAR', 'NANO']);
  const [idOff, setIdOff] = useState('');
  const [odOff, setOdOff] = useState('');
  const [htOff, setHtOff] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!grade.trim() || !material.trim() || coreTypes.length === 0) return;
    await onSubmit({
      grade: grade.trim(), material: material.trim(), coreTypes,
      nanoIdOff: toNum(idOff), nanoOdOff: toNum(odOff), nanoHtOff: toNum(htOff),
    });
    setGrade(''); setMaterial(''); setIdOff(''); setOdOff(''); setHtOff('');
  };

  return (
    <form onSubmit={submit} className="card space-y-3 p-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="block flex-1 min-w-[160px]">
          <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Grade</span>
          <input className="input" placeholder="e.g. M3" value={grade} onChange={(e) => setGrade(e.target.value.toUpperCase())} />
        </label>
        <label className="block flex-[2] min-w-[220px]">
          <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Material</span>
          <input className="input" placeholder="e.g. 0.23 DABBA" value={material} onChange={(e) => setMaterial(e.target.value.toUpperCase())} />
        </label>
      </div>
      <div>
        <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Applies to core types</span>
        <CoreChecks value={coreTypes} onChange={setCoreTypes} />
      </div>
      {coreTypes.includes('NANO') && (
        <NanoOffsets id={idOff} od={odOff} ht={htOff} onId={setIdOff} onOd={setOdOff} onHt={setHtOff} />
      )}
      <div className="flex justify-end">
        <button type="submit" className="btn-primary" disabled={busy || coreTypes.length === 0}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          Add grade
        </button>
      </div>
    </form>
  );
};

/* ---------- editable row ---------- */
const EditableRow = ({
  index, row, onSave, onDelete,
}: {
  index: number; row: Row;
  onSave: (b: { grade: string; material: string } & Attrs) => Promise<unknown>;
  onDelete: () => void;
}) => {
  const [editing, setEditing] = useState(false);
  const [grade, setGrade] = useState(row.grade);
  const [material, setMaterial] = useState(row.material);
  const [coreTypes, setCoreTypes] = useState<CoreType[]>(row.coreTypes);
  const [idOff, setIdOff] = useState(row.nanoIdOff == null ? '' : String(row.nanoIdOff));
  const [odOff, setOdOff] = useState(row.nanoOdOff == null ? '' : String(row.nanoOdOff));
  const [htOff, setHtOff] = useState(row.nanoHtOff == null ? '' : String(row.nanoHtOff));
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!grade.trim() || !material.trim() || coreTypes.length === 0) return;
    setSaving(true);
    try {
      await onSave({
        grade: grade.trim(), material: material.trim(), coreTypes,
        nanoIdOff: toNum(idOff), nanoOdOff: toNum(odOff), nanoHtOff: toNum(htOff),
      });
      setEditing(false);
    } finally { setSaving(false); }
  };
  const cancel = () => {
    setGrade(row.grade); setMaterial(row.material); setCoreTypes(row.coreTypes);
    setIdOff(row.nanoIdOff == null ? '' : String(row.nanoIdOff));
    setOdOff(row.nanoOdOff == null ? '' : String(row.nanoOdOff));
    setHtOff(row.nanoHtOff == null ? '' : String(row.nanoHtOff));
    setEditing(false);
  };

  if (!editing) {
    const isNano = row.coreTypes.includes('NANO');
    return (
      <tr className="border-t border-slate-100 hover:bg-slate-50">
        <td className="px-4 py-3 font-mono text-xs text-slate-500">{index}</td>
        <td className="px-4 py-3 font-medium text-slate-900">{row.grade}</td>
        <td className="px-4 py-3 text-slate-700">{row.material}</td>
        <td className="px-4 py-3">
          <div className="flex flex-wrap items-center gap-1.5">
            {(row.coreTypes.length ? row.coreTypes : ALL_CORES).map((ct) => (
              <span key={ct} className={cn('rounded-full px-2 py-0.5 text-[10px] font-medium ring-1', CORE_TONE[ct])}>{CORE_LABEL[ct]}</span>
            ))}
            {isNano && (row.nanoIdOff != null || row.nanoOdOff != null || row.nanoHtOff != null) && (
              <span className="ml-1 font-mono text-[10px] text-violet-700">
                finish {signed(row.nanoIdOff)}/{signed(row.nanoOdOff)}/{signed(row.nanoHtOff)}
              </span>
            )}
          </div>
        </td>
        <td className="px-4 py-3 text-right">
          <div className="inline-flex items-center gap-1">
            <button onClick={() => setEditing(true)} className="btn-ghost text-brand-700 hover:bg-brand-50" title="Edit">
              <Pencil className="h-4 w-4" />
            </button>
            <button onClick={onDelete} className="btn-ghost text-red-600 hover:bg-red-50" title="Delete">
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        </td>
      </tr>
    );
  }

  return (
    <tr className="border-t border-slate-100 bg-brand-50/30">
      <td className="px-4 py-2 font-mono text-xs text-slate-500 align-top">{index}</td>
      <td className="px-4 py-2 align-top"><input className="input" value={grade} onChange={(e) => setGrade(e.target.value.toUpperCase())} /></td>
      <td className="px-4 py-2 align-top"><input className="input" value={material} onChange={(e) => setMaterial(e.target.value.toUpperCase())} /></td>
      <td className="px-4 py-2 align-top">
        <div className="space-y-2">
          <CoreChecks value={coreTypes} onChange={setCoreTypes} />
          {coreTypes.includes('NANO') && (
            <NanoOffsets id={idOff} od={odOff} ht={htOff} onId={setIdOff} onOd={setOdOff} onHt={setHtOff} />
          )}
        </div>
      </td>
      <td className="px-4 py-2 text-right align-top">
        <div className="inline-flex items-center gap-1">
          <button onClick={save} disabled={saving} className="btn-ghost text-brand-700 hover:bg-brand-50" title="Save">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          </button>
          <button onClick={cancel} className="btn-ghost text-slate-500 hover:bg-slate-100" title="Cancel">
            <X className="h-4 w-4" />
          </button>
        </div>
      </td>
    </tr>
  );
};
