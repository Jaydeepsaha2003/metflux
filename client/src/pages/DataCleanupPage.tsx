// Settings → Data Cleanup. Lets a company admin wipe selected tables for the
// active company in one go. Useful while the team is testing the platform
// and wants to start fresh without re-seeding the whole DB.
//
// Operations vs master-data: the server processes the deletions in
// child-then-parent order regardless of how the user picks, so a wipe of
// "customers" alone will fail if PO orders still exist — by design.
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft, Loader2, Trash2, AlertTriangle, ShieldAlert, RefreshCcw,
} from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';

type Counts = {
  workAllotments: number; returns: number; packingLists: number;
  dispatches: number; productions: number; poOrders: number;
  supplierOrders: number; customers: number; suppliers: number;
  labourMemberships: number; materialGrades: number; fluxGrades: number;
};
type TableKey = keyof Counts;

const SECTIONS: { label: string; rows: { key: TableKey; label: string; hint: string }[] }[] = [
  {
    label: 'Operations (sales workflow)',
    rows: [
      { key: 'workAllotments', label: 'Work allotments',  hint: 'Generated allotment slips. Auto-deleted after 7 days anyway.' },
      { key: 'returns',        label: 'Returns',          hint: 'All return records, including their items.' },
      { key: 'packingLists',   label: 'Packing lists',    hint: 'PL/WO documents. Linked dispatches stay.' },
      { key: 'dispatches',     label: 'Dispatches',       hint: 'All shipment records.' },
      { key: 'productions',    label: 'Production entries', hint: 'All production-shift records.' },
      { key: 'poOrders',       label: 'Sales orders (POs)', hint: 'Cascades into all line items, productions, dispatches and work allotments.' },
    ],
  },
  {
    label: 'Supplier flow',
    rows: [
      { key: 'supplierOrders', label: 'Supplier orders', hint: 'Supplier POs and their items.' },
    ],
  },
  {
    label: 'Master data',
    rows: [
      { key: 'customers',         label: 'Customers',          hint: 'Wipe only after Sales Orders are cleared.' },
      { key: 'suppliers',         label: 'Suppliers',          hint: 'Wipe only after Supplier Orders are cleared.' },
      { key: 'labourMemberships', label: 'Worker assignments', hint: 'Removes workers from this company; the worker records themselves stay (they may be assigned to other companies).' },
      { key: 'materialGrades',    label: 'Material grades',    hint: 'Cleared from the Settings → Materials list.' },
      { key: 'fluxGrades',        label: 'Flux grade calibration', hint: 'BH-curve table for the flux-test calculator.' },
    ],
  },
];

export const DataCleanupPage = () => {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<Set<TableKey>>(new Set());
  const [confirmText, setConfirmText] = useState('');
  const [result, setResult] = useState<Partial<Counts> | null>(null);
  const [error, setError]   = useState<string | null>(null);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['admin-data-counts'],
    queryFn: () => api<{ counts: Counts }>('/admin/data-counts'),
  });
  const counts = data?.counts;

  const wipe = useMutation({
    mutationFn: () => api<{ deleted: Partial<Counts> }>('/admin/wipe-data', {
      method: 'POST',
      json: { confirm: 'DELETE', tables: [...selected] },
    }),
    onSuccess: (resp) => {
      setResult(resp.deleted);
      setSelected(new Set());
      setConfirmText('');
      // Reset everything so subsequent screens show the new (likely empty) data.
      qc.invalidateQueries();
      refetch();
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Wipe failed'),
  });

  const toggle = (key: TableKey) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  const totalSelected = useMemo(() =>
    [...selected].reduce((s, k) => s + (counts?.[k] ?? 0), 0),
    [selected, counts]);

  const canWipe = selected.size > 0 && confirmText.trim().toUpperCase() === 'DELETE';

  return (
    <div className="space-y-5 max-w-3xl">
      <div className="flex items-center gap-3">
        <Link to="/" className="btn-ghost text-slate-600">
          <ArrowLeft className="h-4 w-4" /> Back
        </Link>
        <h1 className="text-xl font-bold tracking-tight flex items-center gap-2">
          <ShieldAlert className="h-5 w-5 text-rose-600" /> Data Cleanup
        </h1>
      </div>

      <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 flex gap-2">
        <AlertTriangle className="h-5 w-5 shrink-0" />
        <div>
          <strong>This is destructive.</strong> Selected data is permanently deleted from the active company.
          Other companies on this server are unaffected. Operations cascade — wiping <em>Sales Orders</em>
          also wipes their productions, dispatches, packing lists, allotments and returns automatically.
        </div>
      </div>

      {result && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
          <div className="font-semibold">Wipe completed.</div>
          <ul className="mt-1 list-disc pl-5 text-xs">
            {Object.entries(result).map(([k, v]) => <li key={k}><strong>{v}</strong> {k} removed</li>)}
          </ul>
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {SECTIONS.map((sec) => (
        <section key={sec.label} className="card divide-y divide-slate-100">
          <div className="px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-500 bg-slate-50">
            {sec.label}
          </div>
          {sec.rows.map((row) => {
            const count = counts?.[row.key] ?? 0;
            const isOn = selected.has(row.key);
            const empty = count === 0;
            return (
              <label
                key={row.key}
                className={cn(
                  'flex items-start gap-3 px-4 py-3 transition-colors cursor-pointer',
                  empty && 'opacity-50 cursor-not-allowed',
                  !empty && (isOn ? 'bg-rose-50' : 'hover:bg-slate-50')
                )}
              >
                <input
                  type="checkbox"
                  checked={isOn}
                  disabled={empty}
                  onChange={() => toggle(row.key)}
                  className="mt-1 h-4 w-4 rounded border-slate-300 text-rose-600 focus:ring-rose-500"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-2">
                    <div className="font-medium text-slate-900">{row.label}</div>
                    <span className="text-xs font-mono tabular-nums text-slate-500">
                      {isLoading ? '…' : `${count} row${count === 1 ? '' : 's'}`}
                    </span>
                  </div>
                  <div className="mt-0.5 text-[11px] text-slate-500">{row.hint}</div>
                </div>
              </label>
            );
          })}
        </section>
      ))}

      <div className="card p-4 space-y-3 sticky bottom-2">
        <div className="text-sm">
          <span className="font-semibold">{selected.size}</span> table{selected.size === 1 ? '' : 's'} selected
          {selected.size > 0 && (
            <span className="ml-2 text-slate-500 text-xs">≈ {totalSelected} row{totalSelected === 1 ? '' : 's'}</span>
          )}
        </div>
        <label className="block">
          <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-slate-500">
            Type <span className="font-mono text-rose-700">DELETE</span> to confirm
          </span>
          <input
            className="input"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder="DELETE"
          />
        </label>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end sm:gap-3">
          <button
            type="button"
            onClick={() => refetch()}
            className="btn-ghost border border-slate-300 w-full sm:w-auto justify-center"
            disabled={wipe.isPending}
          >
            <RefreshCcw className="h-4 w-4" /> Refresh counts
          </button>
          <button
            type="button"
            onClick={() => { setError(null); setResult(null); wipe.mutate(); }}
            disabled={!canWipe || wipe.isPending}
            className={cn(
              'inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition w-full sm:w-auto',
              canWipe
                ? 'bg-rose-600 text-white hover:bg-rose-700'
                : 'bg-slate-200 text-slate-400 cursor-not-allowed'
            )}
          >
            {wipe.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
            Wipe selected
          </button>
        </div>
      </div>
    </div>
  );
};
