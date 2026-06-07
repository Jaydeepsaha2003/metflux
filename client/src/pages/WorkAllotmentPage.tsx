// Work Allotment landing page — top half is pending PO items (selectable),
// bottom half is the recently generated allotments (auto-deleted after 7 days
// by the server). Columns mirror exactly what the user asked for:
// Customer, SO Date, Measure, Grade, Material, Flux, Turns, Voltage, Iemax.
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ClipboardList, FileText, Search, Trash2, Loader2, CheckSquare, Download,
} from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useConfirm } from '@/hooks/useConfirm';

type PendingItem = {
  id: string;
  poNumber: string;
  customerCode: string;
  orderDate: string;
  coreType: 'TOROIDAL' | 'RECTANGULAR';
  grade: string;
  material: string;
  measure: string;
  flux: number | null;
  turns: number | null;
  testVoltage: number | null;
  testCurrent: number | null;
  orderedPcs: number;
  producedPcs: number;
  remainingPcs: number;
};

type WaItem = {
  id: string;
  waNumber: string;
  waDate: string;
  remarks: string | null;
  itemCount: number;
  totalPcs: number;
  createdAt: string;
};

const fmt = (iso: string | null | undefined) => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
};

const num = (n: number | null | undefined, digits = 0) =>
  n == null ? '—' : Number(n).toFixed(digits);

export const WorkAllotmentPage = () => {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { confirm, confirmDialog } = useConfirm();
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const { data: pending, isLoading: loadingPending } = useQuery({
    queryKey: ['wa-pending', search],
    queryFn: () =>
      api<{ items: PendingItem[] }>(`/work-allotments/pending${search ? `?search=${encodeURIComponent(search)}` : ''}`),
  });

  const { data: generated, isLoading: loadingGenerated } = useQuery({
    queryKey: ['work-allotments', search],
    queryFn: () =>
      api<{ items: WaItem[] }>(`/work-allotments${search ? `?search=${encodeURIComponent(search)}` : ''}`),
  });

  const deleteWa = useMutation({
    mutationFn: (id: string) => api(`/work-allotments/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['work-allotments'] }),
  });

  const handleDelete = async (id: string, waNumber: string) => {
    const ok = await confirm({
      title: 'Delete work allotment?',
      message: <>Delete <strong>{waNumber}</strong>? The PDF will no longer be reachable.</>,
      tone: 'danger',
      confirmLabel: 'Delete',
    });
    if (ok) deleteWa.mutate(id);
  };

  const toggleRow = (id: string) =>
    setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const toggleAll = () => {
    const ids = pending?.items.map((d) => d.id) ?? [];
    setSelected(selected.size === ids.length && ids.length > 0 ? new Set() : new Set(ids));
  };

  const pendingIds = pending?.items.map((d) => d.id) ?? [];
  const allChecked = pendingIds.length > 0 && selected.size === pendingIds.length;
  const someChecked = selected.size > 0;

  return (
    <div className="space-y-6 max-w-full">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <h1 className="text-xl font-bold tracking-tight flex items-center gap-2">
          <ClipboardList className="h-5 w-5 text-brand-600" /> Work Allotment
        </h1>
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
          <input
            className="input pl-9"
            placeholder="Search customer, PO no., measure, grade, worker…"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setSelected(new Set()); }}
          />
        </div>
      </div>

      {/* ── Pending items ── */}
      <section>
        <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            Pending Production Items
          </h2>
          {someChecked && (
            <button
              onClick={() => navigate('/work-allotment/new', { state: { poItemIds: [...selected] } })}
              className="btn-primary text-sm w-full sm:w-auto"
            >
              <FileText className="h-4 w-4" />
              Build allotment for {selected.size} selected
            </button>
          )}
        </div>
        <div className="card overflow-hidden">
          {loadingPending ? (
            <div className="flex items-center justify-center gap-2 py-10 text-slate-400">
              <Loader2 className="h-5 w-5 animate-spin" /> Loading…
            </div>
          ) : !pending?.items.length ? (
            <div className="py-10 text-center text-slate-400 text-sm">
              {search ? 'No matching pending items.' : 'No pending items — all PO items are fully produced.'}
            </div>
          ) : (
            <>
              {/* Desktop / tablet — table */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-sm whitespace-nowrap">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
                      <th className="px-3 py-3 w-10">
                        <input type="checkbox" checked={allChecked} onChange={toggleAll}
                          className="rounded border-slate-300 text-brand-600 focus:ring-brand-500" />
                      </th>
                      <th className="px-4 py-3 text-left">Cust Code</th>
                      <th className="px-4 py-3 text-left">SO Date</th>
                      <th className="px-4 py-3 text-left">Measure</th>
                      <th className="px-4 py-3 text-left">Grade</th>
                      <th className="px-4 py-3 text-left">Material</th>
                      <th className="px-4 py-3 text-right">Flux</th>
                      <th className="px-4 py-3 text-right">Turns</th>
                      <th className="px-4 py-3 text-right">Voltage</th>
                      <th className="px-4 py-3 text-right">Iemax</th>
                      <th className="px-4 py-3 text-right">Pending</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {pending.items.map((it) => {
                      const isChecked = selected.has(it.id);
                      return (
                        <tr key={it.id} onClick={() => toggleRow(it.id)}
                          className={cn('cursor-pointer transition-colors', isChecked ? 'bg-brand-50 hover:bg-brand-100' : 'hover:bg-slate-50')}>
                          <td className="px-3 py-3 text-center">
                            <input type="checkbox" checked={isChecked}
                              onChange={() => toggleRow(it.id)} onClick={(e) => e.stopPropagation()}
                              className="rounded border-slate-300 text-brand-600 focus:ring-brand-500" />
                          </td>
                          <td className="px-4 py-3 font-medium">{it.customerCode}</td>
                          <td className="px-4 py-3 text-slate-600">{fmt(it.orderDate)}</td>
                          <td className="px-4 py-3 text-slate-600">{it.measure}</td>
                          <td className="px-4 py-3 text-slate-600">{it.grade}</td>
                          <td className="px-4 py-3 text-slate-600">{it.material}</td>
                          <td className="px-4 py-3 text-right tabular-nums font-mono text-xs">{num(it.flux, 2)}</td>
                          <td className="px-4 py-3 text-right tabular-nums">{it.turns ?? '—'}</td>
                          <td className="px-4 py-3 text-right tabular-nums font-mono text-xs">{num(it.testVoltage, 2)}</td>
                          <td className="px-4 py-3 text-right tabular-nums font-mono text-xs">{num(it.testCurrent, 2)}</td>
                          <td className="px-4 py-3 text-right tabular-nums font-semibold text-brand-700">{it.remainingPcs}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Mobile — stacked cards. Same data, structured for thumb-scrolling. */}
              <div className="md:hidden divide-y divide-slate-100">
                {/* Select-all helper */}
                <div className="flex items-center gap-2 px-4 py-2.5 bg-slate-50 border-b border-slate-200">
                  <input type="checkbox" checked={allChecked} onChange={toggleAll}
                    className="rounded border-slate-300 text-brand-600 focus:ring-brand-500" />
                  <span className="text-xs font-medium text-slate-600">
                    {allChecked ? 'Deselect all' : 'Select all'} ({pending.items.length})
                  </span>
                </div>
                {pending.items.map((it) => {
                  const isChecked = selected.has(it.id);
                  return (
                    <div key={it.id}
                      onClick={() => toggleRow(it.id)}
                      className={cn(
                        'flex gap-3 px-4 py-3 cursor-pointer transition-colors',
                        isChecked ? 'bg-brand-50' : 'hover:bg-slate-50'
                      )}
                    >
                      <input type="checkbox" checked={isChecked}
                        onChange={() => toggleRow(it.id)} onClick={(e) => e.stopPropagation()}
                        className="mt-1 rounded border-slate-300 text-brand-600 focus:ring-brand-500 shrink-0" />
                      <div className="flex-1 min-w-0">
                        {/* Top line: customer + pending pcs badge */}
                        <div className="flex items-start justify-between gap-2">
                          <div className="font-semibold text-sm text-slate-900 truncate">{it.customerCode}</div>
                          <span className="rounded-full bg-brand-100 px-2 py-0.5 text-[11px] font-semibold text-brand-700 shrink-0 tabular-nums">
                            {it.remainingPcs} pcs
                          </span>
                        </div>
                        {/* SO date + measure */}
                        <div className="mt-0.5 text-[11px] text-slate-500">
                          {fmt(it.orderDate)} · {it.measure}
                        </div>
                        {/* Grade + material chips */}
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-700">{it.grade}</span>
                          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-700">{it.material}</span>
                        </div>
                        {/* Calibration row — only for items that have it */}
                        {(it.flux != null || it.turns != null || it.testVoltage != null || it.testCurrent != null) && (
                          <div className="mt-2 grid grid-cols-4 gap-2 rounded-md bg-slate-50 px-2 py-1.5 text-[10px]">
                            <Stat label="Flux"    value={num(it.flux, 2)} />
                            <Stat label="Turns"   value={it.turns != null ? String(it.turns) : '—'} />
                            <Stat label="Voltage" value={num(it.testVoltage, 2)} />
                            <Stat label="Iemax"   value={num(it.testCurrent, 2)} />
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
        {someChecked && (
          <div className="mt-2 flex items-center gap-2 text-sm text-brand-700">
            <CheckSquare className="h-4 w-4" />
            {selected.size} item{selected.size !== 1 ? 's' : ''} selected —{' '}
            <button onClick={() => navigate('/work-allotment/new', { state: { poItemIds: [...selected] } })}
              className="underline font-medium hover:text-brand-900">
              Build allotment
            </button>
          </div>
        )}
      </section>

      {/* ── Generated work allotments (≤ 7 days) ── */}
      <section>
        <div className="mb-3 flex items-center gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            Generated Work Allotments
          </h2>
          <span className="text-[11px] font-medium text-slate-400">(auto-deleted after 7 days)</span>
        </div>
        <div className="card overflow-hidden">
          {loadingGenerated ? (
            <div className="flex items-center justify-center gap-2 py-10 text-slate-400">
              <Loader2 className="h-5 w-5 animate-spin" /> Loading…
            </div>
          ) : !generated?.items.length ? (
            <div className="py-10 text-center text-slate-400 text-sm">
              {search ? 'No matching allotments.' : 'No work allotments yet.'}
            </div>
          ) : (
            <>
              {/* Desktop / tablet — table */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-sm whitespace-nowrap">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
                      <th className="px-4 py-3 text-left">WA No.</th>
                      <th className="px-4 py-3 text-left">Date</th>
                      <th className="px-4 py-3 text-center">Items</th>
                      <th className="px-4 py-3 text-right">Total Pcs</th>
                      <th className="px-4 py-3 text-left">Remarks</th>
                      <th className="px-4 py-3 text-left">Created</th>
                      <th className="sticky right-0 bg-slate-50 px-4 py-3 text-right shadow-[-8px_0_12px_-4px_rgba(0,0,0,0.06)]">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {generated.items.map((wa) => (
                      <tr key={wa.id} className="hover:bg-slate-50 transition-colors">
                        <td className="px-4 py-3 font-semibold text-brand-700">{wa.waNumber}</td>
                        <td className="px-4 py-3 text-slate-600">{fmt(wa.waDate)}</td>
                        <td className="px-4 py-3 text-center">
                          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                            {wa.itemCount}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums font-semibold">{wa.totalPcs}</td>
                        <td className="px-4 py-3 text-slate-500 text-xs">{wa.remarks ?? '—'}</td>
                        <td className="px-4 py-3 text-slate-500 text-xs">{fmt(wa.createdAt)}</td>
                        <td className="sticky right-0 bg-white px-4 py-3 shadow-[-8px_0_12px_-4px_rgba(0,0,0,0.06)]">
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              onClick={() => navigate('/work-allotment/new', { state: { waId: wa.id } })}
                              title="Open / re-download PDF"
                              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 transition-colors">
                              <Download className="h-3.5 w-3.5" /> Open
                            </button>
                            <button
                              onClick={() => handleDelete(wa.id, wa.waNumber)}
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

              {/* Mobile — cards */}
              <div className="md:hidden divide-y divide-slate-100">
                {generated.items.map((wa) => (
                  <div key={wa.id} className="px-4 py-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-semibold text-sm text-brand-700 truncate">{wa.waNumber}</div>
                        <div className="mt-0.5 text-[11px] text-slate-500">
                          {fmt(wa.waDate)} · {wa.itemCount} item{wa.itemCount !== 1 ? 's' : ''} · {wa.totalPcs} pcs
                        </div>
                        {wa.remarks && (
                          <div className="mt-1 text-xs text-slate-600 line-clamp-2">{wa.remarks}</div>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          onClick={() => navigate('/work-allotment/new', { state: { waId: wa.id } })}
                          title="Open / re-download PDF"
                          className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-emerald-700">
                          <Download className="h-3.5 w-3.5" /> Open
                        </button>
                        <button
                          onClick={() => handleDelete(wa.id, wa.waNumber)}
                          title="Delete"
                          className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </section>
      {confirmDialog}
    </div>
  );
};

const Stat = ({ label, value }: { label: string; value: string }) => (
  <div className="flex flex-col">
    <span className="text-[9px] uppercase tracking-wide text-slate-400 font-medium">{label}</span>
    <span className="font-mono tabular-nums text-slate-700">{value}</span>
  </div>
);
