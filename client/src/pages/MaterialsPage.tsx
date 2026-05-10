// Master grade/material list — scoped to the active company. Used by the PO
// entry form for grade + material dropdowns.
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, Trash2, Save, X, Layers, Loader2 } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useConfirm } from '@/hooks/useConfirm';

type Row = { id: string; grade: string; material: string; createdAt: string };

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
    mutationFn: (b: { grade: string; material: string }) =>
      api<Row>('/material-grades', { method: 'POST', json: b }),
    onSuccess: invalidate,
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Failed to add'),
  });
  const updateM = useMutation({
    mutationFn: ({ id, ...b }: { id: string; grade: string; material: string }) =>
      api<Row>(`/material-grades/${id}`, { method: 'PATCH', json: b }),
    onSuccess: invalidate,
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Failed to update'),
  });
  const deleteM = useMutation({
    mutationFn: (id: string) => api(`/material-grades/${id}`, { method: 'DELETE' }),
    onSuccess: invalidate,
  });

  return (
    <div className="space-y-5 max-w-5xl">
      <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
        <Layers className="h-5 w-5 text-brand-600" /> Grades & Materials
      </h1>

      <AddRow onSubmit={(g, m) => addM.mutateAsync({ grade: g, material: m })} busy={addM.isPending} />

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
      )}

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3 w-12">#</th>
              <th className="px-4 py-3">Grade</th>
              <th className="px-4 py-3">Material</th>
              <th className="px-4 py-3 w-32 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr><td colSpan={4} className="px-4 py-10 text-center text-slate-400">Loading…</td></tr>
            )}
            {!isLoading && data?.items.length === 0 && (
              <tr><td colSpan={4} className="px-4 py-10 text-center text-slate-400">
                No grades yet. Use the form above to add the first one.
              </td></tr>
            )}
            {data?.items.map((row, idx) => (
              <EditableRow
                key={row.id}
                index={idx + 1}
                row={row}
                onSave={(grade, material) => updateM.mutateAsync({ id: row.id, grade, material })}
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

/* ---------- add row ---------- */
const AddRow = ({
  onSubmit, busy,
}: { onSubmit: (g: string, m: string) => Promise<unknown>; busy: boolean }) => {
  const [grade, setGrade] = useState('');
  const [material, setMaterial] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!grade.trim() || !material.trim()) return;
    await onSubmit(grade.trim(), material.trim());
    setGrade(''); setMaterial('');
  };

  return (
    <form onSubmit={submit} className="card p-4 flex flex-wrap items-end gap-3">
      <label className="block flex-1 min-w-[180px]">
        <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Grade</span>
        <input className="input" placeholder="e.g. M3" value={grade} onChange={(e) => setGrade(e.target.value.toUpperCase())} />
      </label>
      <label className="block flex-[2] min-w-[240px]">
        <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Material</span>
        <input className="input" placeholder="e.g. 0.23 DABBA" value={material} onChange={(e) => setMaterial(e.target.value.toUpperCase())} />
      </label>
      <button type="submit" className="btn-primary" disabled={busy}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
        Add
      </button>
    </form>
  );
};

/* ---------- editable row ---------- */
const EditableRow = ({
  index, row, onSave, onDelete,
}: {
  index: number; row: Row;
  onSave: (g: string, m: string) => Promise<unknown>;
  onDelete: () => void;
}) => {
  const [editing, setEditing] = useState(false);
  const [grade, setGrade] = useState(row.grade);
  const [material, setMaterial] = useState(row.material);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!grade.trim() || !material.trim()) return;
    setSaving(true);
    try { await onSave(grade.trim(), material.trim()); setEditing(false); }
    finally { setSaving(false); }
  };
  const cancel = () => {
    setGrade(row.grade); setMaterial(row.material); setEditing(false);
  };

  if (!editing) {
    return (
      <tr className="border-t border-slate-100 hover:bg-slate-50">
        <td className="px-4 py-3 font-mono text-xs text-slate-500">{index}</td>
        <td className="px-4 py-3 font-medium text-slate-900">{row.grade}</td>
        <td className="px-4 py-3 text-slate-700">{row.material}</td>
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
      <td className="px-4 py-2 font-mono text-xs text-slate-500">{index}</td>
      <td className="px-4 py-2"><input className="input" value={grade} onChange={(e) => setGrade(e.target.value.toUpperCase())} /></td>
      <td className="px-4 py-2"><input className="input" value={material} onChange={(e) => setMaterial(e.target.value.toUpperCase())} /></td>
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
