import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Package, FileText, Download, Search, Trash2, Loader2, CheckSquare, Pencil, X, Save, ClipboardCheck,
} from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useConfirm } from '@/hooks/useConfirm';

type PendingDispatch = {
  id: string;
  poNumber: string;
  customerName: string;
  coreType: 'TOROIDAL' | 'RECTANGULAR';
  grade: string;
  material: string;
  measure: string | null;
  dispatchDate: string;
  pcs: number;
  totalWeight: number;
  vehicleNo: string | null;
};

type PackingListItem = {
  id: string;
  plNumber: string;
  plDate: string;
  testedBy: string | null;
  approvedBy: string | null;
  remarks: string | null;
  itemCount: number;
  totalPcs: number;
  totalWeight: number;
  poNumber: string | null;
  customerName: string | null;
  dispatchDate: string | null;
  createdAt: string;
};

const fmt = (iso: string | null | undefined) => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
};

/* ── Inline edit modal ── */
type EditState = { id: string; plNumber: string; plDate: string; testedBy: string; approvedBy: string; remarks: string };

const EditModal = ({ item, onClose, onSaved }: { item: PackingListItem; onClose: () => void; onSaved: () => void }) => {
  const [form, setForm] = useState<EditState>({
    id:         item.id,
    plNumber:   item.plNumber,
    plDate:     item.plDate?.slice(0, 10) ?? '',
    testedBy:   item.testedBy ?? '',
    approvedBy: item.approvedBy ?? '',
    remarks:    item.remarks ?? '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState<string | null>(null);

  const set = (k: keyof EditState) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      await api(`/packing-lists/${form.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          plNumber:   form.plNumber,
          plDate:     form.plDate,
          testedBy:   form.testedBy || null,
          approvedBy: form.approvedBy || null,
          remarks:    form.remarks || null,
        }),
      });
      onSaved();
      onClose();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="w-full max-w-md rounded-xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <h2 className="text-sm font-semibold text-slate-900">Edit Packing List</h2>
          <button onClick={onClose} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="space-y-4 px-5 py-4">
          <Field label="Invoice / PL No.">
            <input className="input" value={form.plNumber} onChange={set('plNumber')} />
          </Field>
          <Field label="Invoice Date">
            <input className="input" type="date" value={form.plDate} onChange={set('plDate')} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Tested By">
              <input className="input" value={form.testedBy} onChange={set('testedBy')} placeholder="Name" />
            </Field>
            <Field label="Approved By">
              <input className="input" value={form.approvedBy} onChange={set('approvedBy')} placeholder="Name" />
            </Field>
          </div>
          <Field label="Remarks">
            <input className="input" value={form.remarks} onChange={set('remarks')} placeholder="APPROVED" />
          </Field>
          {error && <p className="text-xs text-red-600">{error}</p>}
        </div>
        <div className="flex justify-end gap-3 border-t border-slate-200 px-5 py-3">
          <button onClick={onClose} className="btn-ghost text-sm">Cancel</button>
          <button onClick={handleSave} disabled={saving} className="btn-primary text-sm">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Save
          </button>
        </div>
      </div>
    </div>
  );
};

const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <label className="block">
    <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</span>
    {children}
  </label>
);

/* ── Main page ── */
export const PackingPage = () => {
  const navigate    = useNavigate();
  const qc          = useQueryClient();
  const [search, setSearch]       = useState('');
  const [selected, setSelected]   = useState<Set<string>>(new Set());
  const [editing, setEditing]     = useState<PackingListItem | null>(null);
  const { confirm, confirmDialog } = useConfirm();

  const { data: pending, isLoading: loadingPending } = useQuery({
    queryKey: ['packing-pending', search],
    queryFn: () =>
      api<{ items: PendingDispatch[] }>(`/packing-lists/pending${search ? `?search=${encodeURIComponent(search)}` : ''}`),
  });

  const { data: generated, isLoading: loadingGenerated } = useQuery({
    queryKey: ['packing-lists', search],
    queryFn: () =>
      api<{ items: PackingListItem[] }>(`/packing-lists${search ? `?search=${encodeURIComponent(search)}` : ''}`),
  });

  const deletePl = useMutation({
    mutationFn: (id: string) => api(`/packing-lists/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['packing-lists'] });
      qc.invalidateQueries({ queryKey: ['packing-pending'] });
    },
  });

  const handleDelete = async (id: string, plNumber: string) => {
    const ok = await confirm({
      title: 'Delete packing list?',
      message: <>Delete <strong>{plNumber}</strong>? The associated dispatches will become pending again.</>,
      tone: 'danger',
      confirmLabel: 'Delete',
    });
    if (ok) deletePl.mutate(id);
  };

  const toggleRow = (id: string) =>
    setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const toggleAll = () => {
    const ids = pending?.items.map((d) => d.id) ?? [];
    setSelected(selected.size === ids.length && ids.length > 0 ? new Set() : new Set(ids));
  };

  const pendingIds  = pending?.items.map((d) => d.id) ?? [];
  const allChecked  = pendingIds.length > 0 && selected.size === pendingIds.length;
  const someChecked = selected.size > 0;

  return (
    <div className="space-y-6 max-w-full">
      {editing && (
        <EditModal
          item={editing}
          onClose={() => setEditing(null)}
          onSaved={() => qc.invalidateQueries({ queryKey: ['packing-lists'] })}
        />
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <h1 className="text-xl font-bold tracking-tight flex items-center gap-2">
          <Package className="h-5 w-5 text-brand-600" /> Packing
        </h1>
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
          <input
            className="input pl-9"
            placeholder="Search party, PO no., invoice no., measure…"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setSelected(new Set()); }}
          />
        </div>
      </div>

      {/* ── Pending dispatches ── */}
      <section>
        <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            Pending — Generate Packing List
          </h2>
          {someChecked && (
            <div className="flex flex-col gap-2 sm:flex-row sm:gap-2">
              <button
                onClick={() => navigate('/testing-report', { state: { dispatchIds: [...selected] } })}
                className="btn-ghost border border-slate-300 text-violet-700 hover:bg-violet-50 text-sm w-full sm:w-auto justify-center"
              >
                <ClipboardCheck className="h-4 w-4" />
                Testing Report ({selected.size})
              </button>
              <button
                onClick={() => navigate('/packing-list', { state: { dispatchIds: [...selected] } })}
                className="btn-primary text-sm w-full sm:w-auto justify-center"
              >
                <FileText className="h-4 w-4" />
                Packing List ({selected.size})
              </button>
            </div>
          )}
        </div>
        <div className="card overflow-hidden">
          {loadingPending ? (
            <div className="flex items-center justify-center gap-2 py-10 text-slate-400">
              <Loader2 className="h-5 w-5 animate-spin" /> Loading…
            </div>
          ) : !pending?.items.length ? (
            <div className="py-10 text-center text-slate-400 text-sm">
              {search ? 'No matching dispatches.' : 'All dispatches have packing lists — nothing pending.'}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm whitespace-nowrap">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    <th className="px-3 py-3 w-10">
                      <input type="checkbox" checked={allChecked} onChange={toggleAll}
                        className="rounded border-slate-300 text-brand-600 focus:ring-brand-500" />
                    </th>
                    <th className="px-4 py-3 text-left">Customer</th>
                    <th className="px-4 py-3 text-left">PO Number</th>
                    <th className="px-4 py-3 text-left">Type</th>
                    <th className="px-4 py-3 text-left">Grade</th>
                    <th className="px-4 py-3 text-left">Measure</th>
                    <th className="px-4 py-3 text-left">Dispatch Date</th>
                    <th className="px-4 py-3 text-right">Pcs</th>
                    <th className="px-4 py-3 text-right">Weight (kg)</th>
                    <th className="px-4 py-3 text-left">Vehicle</th>
                    <th className="px-4 py-3"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {pending.items.map((d) => {
                    const isChecked = selected.has(d.id);
                    return (
                      <tr key={d.id} onClick={() => toggleRow(d.id)}
                        className={cn('cursor-pointer transition-colors', isChecked ? 'bg-brand-50 hover:bg-brand-100' : 'hover:bg-slate-50')}>
                        <td className="px-3 py-3 text-center">
                          <input type="checkbox" checked={isChecked}
                            onChange={() => toggleRow(d.id)} onClick={(e) => e.stopPropagation()}
                            className="rounded border-slate-300 text-brand-600 focus:ring-brand-500" />
                        </td>
                        <td className="px-4 py-3 font-medium">{d.customerName}</td>
                        <td className="px-4 py-3 text-slate-600 font-mono text-xs">{d.poNumber}</td>
                        <td className="px-4 py-3">
                          <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-medium',
                            d.coreType === 'TOROIDAL' ? 'bg-amber-50 text-amber-700' : 'bg-rose-50 text-rose-700')}>
                            {d.coreType === 'TOROIDAL' ? 'Toro' : 'Rect'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-slate-600">{d.grade}</td>
                        <td className="px-4 py-3 font-mono text-xs text-slate-600">{d.measure ?? '—'}</td>
                        <td className="px-4 py-3 text-slate-600">{fmt(d.dispatchDate)}</td>
                        <td className="px-4 py-3 text-right tabular-nums font-semibold">{d.pcs}</td>
                        <td className="px-4 py-3 text-right tabular-nums font-mono">{d.totalWeight.toFixed(3)}</td>
                        <td className="px-4 py-3 text-slate-500 text-xs">{d.vehicleNo ?? '—'}</td>
                        <td className="px-4 py-3 text-right">
                          <div className="inline-flex items-center gap-1.5">
                            <button
                              onClick={(e) => { e.stopPropagation(); navigate('/testing-report', { state: { dispatchIds: [d.id] } }); }}
                              title="Testing Report"
                              className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-violet-700 hover:bg-violet-50 transition-colors">
                              <ClipboardCheck className="h-3.5 w-3.5" /> Test
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); navigate('/packing-list', { state: { dispatchIds: [d.id] } }); }}
                              title="Packing List"
                              className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-700 transition-colors">
                              <FileText className="h-3.5 w-3.5" /> Packing
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
        {someChecked && (
          <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-brand-700">
            <CheckSquare className="h-4 w-4" />
            <span>{selected.size} dispatch{selected.size !== 1 ? 'es' : ''} selected —</span>
            <button onClick={() => navigate('/packing-list', { state: { dispatchIds: [...selected] } })}
              className="underline font-medium hover:text-brand-900">
              Packing List
            </button>
            <span className="text-slate-400">·</span>
            <button onClick={() => navigate('/testing-report', { state: { dispatchIds: [...selected] } })}
              className="underline font-medium text-violet-700 hover:text-violet-900">
              Testing Report
            </button>
          </div>
        )}
      </section>

      {/* ── Generated packing lists ── */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
          Generated Packing Lists
        </h2>
        <div className="card overflow-hidden">
          {loadingGenerated ? (
            <div className="flex items-center justify-center gap-2 py-10 text-slate-400">
              <Loader2 className="h-5 w-5 animate-spin" /> Loading…
            </div>
          ) : !generated?.items.length ? (
            <div className="py-10 text-center text-slate-400 text-sm">
              {search ? 'No matching packing lists.' : 'No packing lists generated yet.'}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm whitespace-nowrap">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    <th className="px-4 py-3 text-left">Invoice / PL No.</th>
                    <th className="px-4 py-3 text-left">Invoice Date</th>
                    <th className="px-4 py-3 text-left">Customer</th>
                    <th className="px-4 py-3 text-left">PO Number</th>
                    <th className="px-4 py-3 text-left">Dispatch Date</th>
                    <th className="px-4 py-3 text-center">Dispatches</th>
                    <th className="px-4 py-3 text-right">Total Pcs</th>
                    <th className="px-4 py-3 text-right">Total Wt (kg)</th>
                    <th className="px-4 py-3 text-left">Tested By</th>
                    <th className="px-4 py-3 text-left">Approved By</th>
                    {/* sticky action column */}
                    <th className="sticky right-0 bg-slate-50 px-4 py-3 text-right shadow-[-8px_0_12px_-4px_rgba(0,0,0,0.06)]">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {generated.items.map((pl) => (
                    <tr key={pl.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-4 py-3 font-semibold text-brand-700">{pl.plNumber}</td>
                      <td className="px-4 py-3 text-slate-600">{fmt(pl.plDate)}</td>
                      <td className="px-4 py-3 font-medium">{pl.customerName ?? '—'}</td>
                      <td className="px-4 py-3 text-slate-600 font-mono text-xs">{pl.poNumber ?? '—'}</td>
                      <td className="px-4 py-3 text-slate-600">{fmt(pl.dispatchDate)}</td>
                      <td className="px-4 py-3 text-center">
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                          {pl.itemCount}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums font-semibold">{pl.totalPcs}</td>
                      <td className="px-4 py-3 text-right tabular-nums font-mono">{pl.totalWeight.toFixed(3)}</td>
                      <td className="px-4 py-3 text-slate-600">{pl.testedBy ?? '—'}</td>
                      <td className="px-4 py-3 text-slate-600">{pl.approvedBy ?? '—'}</td>
                      {/* sticky action column */}
                      <td className="sticky right-0 bg-white px-4 py-3 shadow-[-8px_0_12px_-4px_rgba(0,0,0,0.06)]">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => navigate('/testing-report', { state: { plId: pl.id } })}
                            title="Testing Report"
                            className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-violet-700 hover:bg-violet-50 transition-colors">
                            <ClipboardCheck className="h-3.5 w-3.5" /> Test
                          </button>
                          <button
                            onClick={() => navigate('/packing-list', { state: { plId: pl.id } })}
                            title="Download Packing List PDF"
                            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 transition-colors">
                            <Download className="h-3.5 w-3.5" /> Download
                          </button>
                          <button
                            onClick={() => setEditing(pl)}
                            title="Edit details"
                            className="rounded-lg p-1.5 text-slate-500 hover:bg-brand-50 hover:text-brand-700 transition-colors">
                            <Pencil className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => handleDelete(pl.id, pl.plNumber)}
                            title="Delete"
                            className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600 transition-colors">
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
      {confirmDialog}
    </div>
  );
};
