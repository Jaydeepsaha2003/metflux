// Flux-test calibration table — variable data driving the flux-test calculator.
// Each row maps a (grade, flux, coreType) triple to its ATe/cm value.
// Same grade can have different ATe/cm for toroidal vs rectangular at the same flux.
import { useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Plus, Pencil, Trash2, Save, X, Activity, Loader2, Sparkles, Upload, Download,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { SearchableSelect } from '@/components/SearchableSelect';
import { useConfirm } from '@/hooks/useConfirm';

type CoreType = 'TOROIDAL' | 'RECTANGULAR' | 'NANO';
type Row = {
  id: string;
  grade: string;
  flux: number;
  coreType: CoreType;
  ateCm: number;
  notes: string | null;
  createdAt: string;
};
type GradeOption = { grade: string; materials: { id: string; material: string }[] };

const coreBadge: Record<CoreType, string> = {
  TOROIDAL:    'bg-amber-50 text-amber-700 border border-amber-200',
  RECTANGULAR: 'bg-rose-50 text-rose-700 border border-rose-200',
  NANO:        'bg-violet-50 text-violet-700 border border-violet-200',
};
const coreShort: Record<CoreType, string> = { TOROIDAL: 'Toro', RECTANGULAR: 'Rect', NANO: 'Nano' };
const coreName: Record<CoreType, string> = { TOROIDAL: 'Toroidal', RECTANGULAR: 'Rectangular', NANO: 'Nano' };

export const FluxGradesPage = () => {
  const queryClient = useQueryClient();
  const { confirm, confirmDialog } = useConfirm();

  const { data, isLoading } = useQuery({
    queryKey: ['flux-grades-flat'],
    queryFn: () => api<{ items: Row[] }>('/flux-grades'),
  });
  const { data: gradesResp } = useQuery({
    queryKey: ['material-grades'],
    queryFn: () => api<{ grades: GradeOption[] }>('/material-grades'),
  });
  const gradeOptions = (gradesResp?.grades ?? []).map((g) => ({ value: g.grade, label: g.grade }));

  const [error, setError] = useState<string | null>(null);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['flux-grades-flat'] });
    queryClient.invalidateQueries({ queryKey: ['flux-grades-grouped'] });
  };

  const addM = useMutation({
    mutationFn: (b: { grade: string; flux: number; coreType: CoreType; ateCm?: number; notes?: string | null }) =>
      api<Row>('/flux-grades', { method: 'POST', json: b }),
    onSuccess: invalidate,
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Failed to add'),
  });
  const updateM = useMutation({
    mutationFn: ({ id, ...b }: { id: string; grade?: string; flux?: number; coreType?: CoreType; ateCm?: number; notes?: string | null }) =>
      api<Row>(`/flux-grades/${id}`, { method: 'PATCH', json: b }),
    onSuccess: invalidate,
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Failed to update'),
  });
  const deleteM = useMutation({
    mutationFn: (id: string) => api(`/flux-grades/${id}`, { method: 'DELETE' }),
    onSuccess: invalidate,
  });
  const seedM = useMutation({
    mutationFn: () => api<{ inserted: number }>('/flux-grades/seed', { method: 'POST' }),
    onSuccess: invalidate,
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Seed failed'),
  });
  const bulkM = useMutation({
    mutationFn: (rows: Array<{ grade: string; flux: number; coreType: CoreType; ateCm: number; notes?: string | null }>) =>
      api<{ inserted: number; updated: number; total: number; errors: { row: number; message: string }[] }>(
        '/flux-grades/bulk', { method: 'POST', json: { rows } }
      ),
    onSuccess: invalidate,
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Bulk upload failed'),
  });

  /* ---------- Excel template download ---------- */
  const downloadTemplate = () => {
    const headerRows = [
      ['Grade', 'Flux', 'Core Type', 'ATe/cm', 'Notes'],
      ['M4',       0.5, 'TOROIDAL',    0.12,  ''],
      ['M4',       1.0, 'TOROIDAL',    0.22,  ''],
      ['M4',       1.5, 'TOROIDAL',    0.32,  ''],
      ['M3',       1.0, 'TOROIDAL',    0.18,  'Standard production grade'],
      ['M3',       1.0, 'RECTANGULAR', 0.18,  'Same value for both cores'],
      ['ZDMH',     1.7, 'TOROIDAL',    0.30,  ''],
      ['HPDR',     1.0, 'RECTANGULAR', 0.10,  'Rectangular only'],
    ];
    const ws = XLSX.utils.aoa_to_sheet(headerRows);
    ws['!cols'] = [{ wch: 14 }, { wch: 8 }, { wch: 14 }, { wch: 10 }, { wch: 30 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'FluxGrades');
    XLSX.writeFile(wb, 'flux-grades-template.xlsx');
  };

  /* ---------- Excel upload — parse → POST /bulk ---------- */
  const fileRef = useRef<HTMLInputElement>(null);
  const onUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';   // reset so the same file can be re-uploaded
    setError(null);
    try {
      const buf = await file.arrayBuffer();
      const wb  = XLSX.read(buf, { type: 'array' });
      const ws  = wb.Sheets[wb.SheetNames[0]];
      const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: null });

      // Normalise column-name variations the user may have typed.
      const pick = (row: Record<string, unknown>, ...keys: string[]) => {
        for (const k of keys) {
          const found = Object.keys(row).find((rk) => rk.trim().toLowerCase() === k.toLowerCase());
          if (found && row[found] !== null && row[found] !== '') return row[found];
        }
        return null;
      };

      const rows: Array<{ grade: string; flux: number; coreType: CoreType; ateCm: number; notes?: string | null }> = [];
      for (const row of json) {
        const grade    = String(pick(row, 'Grade', 'grade') ?? '').trim();
        const fluxRaw  = pick(row, 'Flux', 'Flux (T)', 'flux');
        const ctRaw    = String(pick(row, 'Core Type', 'CoreType', 'core type', 'coreType') ?? '').trim().toUpperCase();
        const ateRaw   = pick(row, 'ATe/cm', 'ATe', 'ateCm', 'ate', 'Ate/cm');
        const notes    = pick(row, 'Notes', 'notes');

        if (!grade || fluxRaw == null) continue;            // skip blank rows silently
        const coreType: CoreType = ctRaw === 'RECTANGULAR' ? 'RECTANGULAR' : ctRaw === 'NANO' ? 'NANO' : 'TOROIDAL';
        rows.push({
          grade,
          flux:  Number(fluxRaw),
          coreType,
          ateCm: ateRaw == null ? 0 : Number(ateRaw),
          notes: notes ? String(notes) : null,
        });
      }

      if (!rows.length) {
        setError('No valid rows found. Make sure the sheet has Grade, Flux, Core Type, ATe/cm columns.');
        return;
      }

      const result = await bulkM.mutateAsync(rows);
      setBulkResult(result);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not read the Excel file.');
    }
  };
  const [bulkResult, setBulkResult] = useState<{ inserted: number; updated: number; total: number; errors: { row: number; message: string }[] } | null>(null);

  // Group flat list by grade for both desktop table sections and mobile card sections.
  const grouped = useMemo(() => {
    const acc: Record<string, Row[]> = {};
    for (const r of data?.items ?? []) (acc[r.grade] ??= []).push(r);
    // Within a grade, order by core type then flux for readable layout.
    for (const k of Object.keys(acc)) {
      acc[k].sort((a, b) => a.coreType.localeCompare(b.coreType) || a.flux - b.flux);
    }
    return Object.entries(acc).sort(([a], [b]) => a.localeCompare(b));
  }, [data]);

  return (
    <div className="space-y-5 max-w-5xl">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Activity className="h-5 w-5 text-brand-600" /> Flux-Test Grades
        </h1>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={downloadTemplate}
            className="btn-ghost border border-slate-300 text-sm"
            title="Download an Excel template you can fill in and re-upload"
          >
            <Download className="h-4 w-4" /> Template
          </button>
          <button
            onClick={() => fileRef.current?.click()}
            disabled={bulkM.isPending}
            className="btn-ghost border border-slate-300 text-sm"
            title="Upload an Excel sheet to add or update many rows at once"
          >
            {bulkM.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            Upload Excel
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
            className="hidden"
            onChange={onUpload}
          />
          {data?.items.length === 0 && !isLoading && (
            <button
              onClick={() => seedM.mutate()}
              disabled={seedM.isPending}
              className="btn-ghost border border-slate-300 text-sm"
              title="Insert the 22 default toroidal rows from the testing reference"
            >
              {seedM.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              Load defaults
            </button>
          )}
        </div>
      </div>

      <p className="text-xs text-slate-500 max-w-prose">
        Each row maps one (grade, flux, core type) triple to its ATe/cm value. The same grade
        may have different ATe/cm at the same flux for toroidal vs rectangular cores — add both
        rows when they differ, or one row when they share the same value. Use{' '}
        <strong>Template</strong> to download an Excel skeleton, then <strong>Upload Excel</strong>{' '}
        to import many rows at once.
      </p>

      {bulkResult && (
        <div className={cn(
          'rounded-lg border px-3 py-2.5 text-sm',
          bulkResult.errors.length
            ? 'border-amber-200 bg-amber-50 text-amber-900'
            : 'border-green-200 bg-green-50 text-green-900'
        )}>
          <div className="flex items-start justify-between gap-2">
            <div>
              <strong>Upload finished.</strong>{' '}
              {bulkResult.inserted} added · {bulkResult.updated} updated · {bulkResult.errors.length} skipped (of {bulkResult.total})
              {bulkResult.errors.length > 0 && (
                <ul className="mt-1.5 list-disc pl-5 text-xs">
                  {bulkResult.errors.slice(0, 5).map((e, i) => (
                    <li key={i}>Row {e.row}: {e.message}</li>
                  ))}
                  {bulkResult.errors.length > 5 && <li>…and {bulkResult.errors.length - 5} more</li>}
                </ul>
              )}
            </div>
            <button onClick={() => setBulkResult(null)} className="rounded p-1 hover:bg-black/5">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      <AddRow
        gradeOptions={gradeOptions}
        onSubmit={(grade, flux, coreType, ateCm, notes) =>
          addM.mutateAsync({ grade, flux, coreType, ateCm, notes: notes || null })
        }
        busy={addM.isPending}
      />

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
      )}

      {/* Loading / empty states */}
      {isLoading && <div className="card p-10 text-center text-slate-400"><Loader2 className="h-5 w-5 animate-spin mx-auto" /></div>}
      {!isLoading && grouped.length === 0 && (
        <div className="card p-10 text-center text-sm text-slate-400">
          No flux grades yet. Use the form above or click <em>Load default toroidal grades</em>.
        </div>
      )}

      {/* Desktop table — md+ */}
      {grouped.length > 0 && (
        <div className="card overflow-hidden hidden md:block">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3 w-12">#</th>
                  <th className="px-4 py-3">Grade</th>
                  <th className="px-4 py-3 w-32">Core Type</th>
                  <th className="px-4 py-3 text-right w-24">Flux (T)</th>
                  <th className="px-4 py-3 text-right w-28">ATe / cm</th>
                  <th className="px-4 py-3">Notes</th>
                  <th className="px-4 py-3 w-32 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {grouped.map(([grade, rows]) => (
                  <GradeBlock
                    key={grade}
                    grade={grade}
                    rows={rows}
                    gradeOptions={gradeOptions}
                    onSave={(id, patch) => updateM.mutateAsync({ id, ...patch })}
                    onDelete={async (id, label) => {
                      const ok = await confirm({
                        title: 'Delete flux grade?',
                        message: <>Delete <strong>{label}</strong>? This cannot be undone.</>,
                        tone: 'danger',
                        confirmLabel: 'Delete',
                      });
                      if (ok) deleteM.mutate(id);
                    }}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Mobile cards — < md */}
      {grouped.length > 0 && (
        <div className="space-y-4 md:hidden">
          {grouped.map(([grade, rows]) => (
            <div key={grade} className="card overflow-hidden">
              <div className="border-b border-slate-200 bg-slate-50 px-3 py-1.5 text-[11px] font-bold uppercase tracking-widest text-slate-500">
                {grade} — {rows.length} entr{rows.length === 1 ? 'y' : 'ies'}
              </div>
              <ul className="divide-y divide-slate-100">
                {rows.map((row, idx) => (
                  <CardRow
                    key={row.id}
                    index={idx + 1}
                    row={row}
                    gradeOptions={gradeOptions}
                    onSave={(patch) => updateM.mutateAsync({ id: row.id, ...patch })}
                    onDelete={async () => {
                      const ok = await confirm({
                        title: 'Delete flux grade?',
                        message: <>Delete <strong>{row.grade} @ {row.flux} T ({row.coreType})</strong>?</>,
                        tone: 'danger',
                        confirmLabel: 'Delete',
                      });
                      if (ok) deleteM.mutate(row.id);
                    }}
                  />
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
      {confirmDialog}
    </div>
  );
};

/* ============================================================
   Add row — top form
============================================================ */
const AddRow = ({
  gradeOptions, onSubmit, busy,
}: {
  gradeOptions: { value: string; label: string }[];
  onSubmit: (g: string, f: number, ct: CoreType, ateCm: number, notes: string) => Promise<unknown>;
  busy: boolean;
}) => {
  const [grade, setGrade] = useState('');
  const [flux, setFlux] = useState('');
  const [coreType, setCoreType] = useState<CoreType>('TOROIDAL');
  const [ateCm, setAteCm] = useState('');
  const [notes, setNotes] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!grade.trim() || !flux) return;
    await onSubmit(grade.trim(), parseFloat(flux), coreType, parseFloat(ateCm) || 0, notes.trim());
    setFlux(''); setAteCm(''); setNotes('');   // keep grade & coreType for fast multi-add
  };

  return (
    <form onSubmit={submit} className="card p-3 sm:p-4 space-y-3">
      {/* Core-type segmented selector — same UX as PO entry form */}
      <div className="flex items-center gap-2">
        <span className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Core Type</span>
        <div className="inline-flex rounded-lg bg-slate-100 p-0.5 text-sm">
          <button
            type="button"
            onClick={() => setCoreType('TOROIDAL')}
            className={cn(
              'rounded-md px-3 py-1 font-medium transition',
              coreType === 'TOROIDAL'
                ? 'bg-white text-amber-700 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            )}
          >Toroidal</button>
          <button
            type="button"
            onClick={() => setCoreType('RECTANGULAR')}
            className={cn(
              'rounded-md px-3 py-1 font-medium transition',
              coreType === 'RECTANGULAR'
                ? 'bg-white text-rose-700 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            )}
          >Rectangular</button>
          <button
            type="button"
            onClick={() => setCoreType('NANO')}
            className={cn(
              'rounded-md px-3 py-1 font-medium transition',
              coreType === 'NANO'
                ? 'bg-white text-violet-700 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            )}
          >Nano</button>
        </div>
      </div>

      {/* Inputs — 1 col mobile, 2 cols sm, 4 cols md+ ; submit wraps to its own row on small screens */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-4">
        <label className="block">
          <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Grade</span>
          <SearchableSelect
            value={grade}
            onChange={setGrade}
            options={gradeOptions}
            placeholder={gradeOptions.length ? 'Select grade…' : 'Add grades in Settings → Materials'}
            disabled={!gradeOptions.length}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Flux (T)</span>
          <input className="input" type="number" inputMode="decimal" step="0.01" placeholder="1.0" value={flux} onChange={(e) => setFlux(e.target.value)} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">ATe / cm</span>
          <input className="input" type="number" inputMode="decimal" step="0.001" placeholder="0.220" value={ateCm} onChange={(e) => setAteCm(e.target.value)} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Notes</span>
          <input className="input" placeholder="Optional" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
      </div>

      <div className="flex justify-end">
        <button type="submit" className="btn-primary w-full sm:w-auto" disabled={busy || !grade || !flux}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          Add
        </button>
      </div>
    </form>
  );
};

/* ============================================================
   Desktop table — one block per grade, then editable rows
============================================================ */
const GradeBlock = ({
  grade, rows, gradeOptions, onSave, onDelete,
}: {
  grade: string;
  rows: Row[];
  gradeOptions: { value: string; label: string }[];
  onSave: (id: string, patch: { grade?: string; flux?: number; coreType?: CoreType; ateCm?: number; notes?: string | null }) => Promise<unknown>;
  onDelete: (id: string, label: string) => void;
}) => (
  <>
    <tr className="bg-slate-50 border-t border-slate-200">
      <td colSpan={7} className="px-4 py-1.5 text-[11px] font-bold uppercase tracking-widest text-slate-500">
        {grade} — {rows.length} entr{rows.length === 1 ? 'y' : 'ies'}
      </td>
    </tr>
    {rows.map((row, idx) => (
      <EditableRow
        key={row.id}
        index={idx + 1}
        row={row}
        gradeOptions={gradeOptions}
        onSave={(patch) => onSave(row.id, patch)}
        onDelete={() => onDelete(row.id, `${row.grade} @ ${row.flux} T (${row.coreType})`)}
      />
    ))}
  </>
);

const EditableRow = ({
  index, row, gradeOptions, onSave, onDelete,
}: {
  index: number;
  row: Row;
  gradeOptions: { value: string; label: string }[];
  onSave: (patch: { grade?: string; flux?: number; coreType?: CoreType; ateCm?: number; notes?: string | null }) => Promise<unknown>;
  onDelete: () => void;
}) => {
  const [editing, setEditing] = useState(false);
  const [grade, setGrade] = useState(row.grade);
  const [flux, setFlux] = useState(String(row.flux));
  const [coreType, setCoreType] = useState<CoreType>(row.coreType);
  const [ateCm, setAteCm] = useState(String(row.ateCm));
  const [notes, setNotes] = useState(row.notes ?? '');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!grade.trim() || !flux) return;
    setSaving(true);
    try {
      await onSave({
        grade: grade.trim(),
        flux: parseFloat(flux),
        coreType,
        ateCm: parseFloat(ateCm) || 0,
        notes: notes.trim() || null,
      });
      setEditing(false);
    } finally { setSaving(false); }
  };
  const cancel = () => {
    setGrade(row.grade);
    setFlux(String(row.flux));
    setCoreType(row.coreType);
    setAteCm(String(row.ateCm));
    setNotes(row.notes ?? '');
    setEditing(false);
  };

  if (!editing) {
    return (
      <tr className="border-t border-slate-100 hover:bg-slate-50">
        <td className="px-4 py-3 font-mono text-xs text-slate-400">{index}</td>
        <td className="px-4 py-3 font-medium text-slate-900">{row.grade}</td>
        <td className="px-4 py-3">
          <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-medium', coreBadge[row.coreType])}>
            {coreName[row.coreType]}
          </span>
        </td>
        <td className="px-4 py-3 text-right tabular-nums font-mono">{row.flux.toFixed(2)}</td>
        <td className="px-4 py-3 text-right tabular-nums font-mono font-semibold">{row.ateCm.toFixed(3)}</td>
        <td className="px-4 py-3 text-slate-500 text-xs">{row.notes ?? '—'}</td>
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
      <td className="px-4 py-2 font-mono text-xs text-slate-400">{index}</td>
      <td className="px-4 py-2">
        <SearchableSelect value={grade} onChange={setGrade} options={gradeOptions} dense />
      </td>
      <td className="px-4 py-2">
        <CoreTogglePill value={coreType} onChange={setCoreType} />
      </td>
      <td className="px-4 py-2"><input className="input text-right" type="number" inputMode="decimal" step="0.01" value={flux} onChange={(e) => setFlux(e.target.value)} /></td>
      <td className="px-4 py-2"><input className="input text-right" type="number" inputMode="decimal" step="0.001" value={ateCm} onChange={(e) => setAteCm(e.target.value)} /></td>
      <td className="px-4 py-2"><input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" /></td>
      <td className="px-4 py-2 text-right">
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

/* ============================================================
   Mobile card row
============================================================ */
const CardRow = ({
  index, row, gradeOptions, onSave, onDelete,
}: {
  index: number;
  row: Row;
  gradeOptions: { value: string; label: string }[];
  onSave: (patch: { grade?: string; flux?: number; coreType?: CoreType; ateCm?: number; notes?: string | null }) => Promise<unknown>;
  onDelete: () => void;
}) => {
  const [editing, setEditing] = useState(false);
  const [grade, setGrade] = useState(row.grade);
  const [flux, setFlux] = useState(String(row.flux));
  const [coreType, setCoreType] = useState<CoreType>(row.coreType);
  const [ateCm, setAteCm] = useState(String(row.ateCm));
  const [notes, setNotes] = useState(row.notes ?? '');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!grade.trim() || !flux) return;
    setSaving(true);
    try {
      await onSave({
        grade: grade.trim(),
        flux: parseFloat(flux),
        coreType,
        ateCm: parseFloat(ateCm) || 0,
        notes: notes.trim() || null,
      });
      setEditing(false);
    } finally { setSaving(false); }
  };
  const cancel = () => {
    setGrade(row.grade); setFlux(String(row.flux)); setCoreType(row.coreType);
    setAteCm(String(row.ateCm)); setNotes(row.notes ?? ''); setEditing(false);
  };

  if (!editing) {
    return (
      <li className="px-3 py-2.5">
        <div className="flex items-start gap-3">
          <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-100 font-mono text-[11px] text-slate-600">
            {index}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className={cn('rounded-full px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide', coreBadge[row.coreType])}>
                {coreShort[row.coreType]}
              </span>
              <span className="text-sm font-mono tabular-nums">{row.flux.toFixed(2)} T</span>
              <span className="text-slate-300">·</span>
              <span className="text-sm font-mono font-semibold tabular-nums">{row.ateCm.toFixed(3)}</span>
              <span className="text-[11px] text-slate-400">ATe/cm</span>
            </div>
            {row.notes && <div className="mt-0.5 text-xs text-slate-500 break-words">{row.notes}</div>}
          </div>
          <div className="flex shrink-0 gap-1">
            <button onClick={() => setEditing(true)} className="rounded-md p-1.5 text-brand-700 hover:bg-brand-50">
              <Pencil className="h-4 w-4" />
            </button>
            <button onClick={onDelete} className="rounded-md p-1.5 text-red-600 hover:bg-red-50">
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        </div>
      </li>
    );
  }

  return (
    <li className="px-3 py-3 bg-brand-50/30">
      <div className="space-y-2.5">
        <CoreTogglePill value={coreType} onChange={setCoreType} />
        <div className="grid grid-cols-2 gap-2.5">
          <label className="block col-span-2">
            <span className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-slate-500">Grade</span>
            <SearchableSelect value={grade} onChange={setGrade} options={gradeOptions} />
          </label>
          <label className="block">
            <span className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-slate-500">Flux (T)</span>
            <input className="input text-right" type="number" inputMode="decimal" step="0.01" value={flux} onChange={(e) => setFlux(e.target.value)} />
          </label>
          <label className="block">
            <span className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-slate-500">ATe / cm</span>
            <input className="input text-right" type="number" inputMode="decimal" step="0.001" value={ateCm} onChange={(e) => setAteCm(e.target.value)} />
          </label>
          <label className="block col-span-2">
            <span className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-slate-500">Notes</span>
            <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
          </label>
        </div>
        <div className="flex gap-2">
          <button onClick={cancel} className="btn-ghost flex-1 text-sm border border-slate-300">
            <X className="h-4 w-4" /> Cancel
          </button>
          <button onClick={save} disabled={saving} className="btn-primary flex-1 text-sm">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Save
          </button>
        </div>
      </div>
    </li>
  );
};

/* ============================================================
   Compact toggle pill — reused inline in edit forms
============================================================ */
const CoreTogglePill = ({ value, onChange }: { value: CoreType; onChange: (v: CoreType) => void }) => (
  <div className="inline-flex rounded-md bg-slate-100 p-0.5 text-xs">
    <button
      type="button"
      onClick={() => onChange('TOROIDAL')}
      className={cn(
        'rounded px-2 py-0.5 font-medium transition',
        value === 'TOROIDAL' ? 'bg-white text-amber-700 shadow-sm' : 'text-slate-600'
      )}
    >Toro</button>
    <button
      type="button"
      onClick={() => onChange('RECTANGULAR')}
      className={cn(
        'rounded px-2 py-0.5 font-medium transition',
        value === 'RECTANGULAR' ? 'bg-white text-rose-700 shadow-sm' : 'text-slate-600'
      )}
    >Rect</button>
    <button
      type="button"
      onClick={() => onChange('NANO')}
      className={cn(
        'rounded px-2 py-0.5 font-medium transition',
        value === 'NANO' ? 'bg-white text-violet-700 shadow-sm' : 'text-slate-600'
      )}
    >Nano</button>
  </div>
);
