// Audit Log — who did what, when, across modules, with restore (undo delete) /
// revert (undo edit). Gated by the view_audit_log permission.
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { History, Loader2, RotateCcw, Search, Check } from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { SearchableSelect } from '@/components/SearchableSelect';
import { useConfirm } from '@/hooks/useConfirm';

type Entry = {
  id: string; createdAt: string; user: string;
  entity: string; entityLabel: string; entityId: string | null;
  action: 'CREATE' | 'UPDATE' | 'DELETE';
  summary: string | null; restorable: boolean; restoredAt: string | null;
};
type Resp = {
  items: Entry[];
  entities: { value: string; label: string }[];
  actors: { value: string; label: string }[];
};

const fmt = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};
const ACTION = {
  CREATE: 'bg-emerald-50 text-emerald-700',
  UPDATE: 'bg-amber-50 text-amber-700',
  DELETE: 'bg-red-50 text-red-700',
} as const;

export const AuditLogPage = () => {
  const qc = useQueryClient();
  const { confirm, confirmDialog } = useConfirm();
  const [entity, setEntity] = useState('');
  const [action, setAction] = useState('');
  const [userId, setUserId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [search, setSearch] = useState('');

  const qs = new URLSearchParams();
  if (entity) qs.set('entity', entity);
  if (action) qs.set('action', action);
  if (userId) qs.set('userId', userId);
  if (from) qs.set('from', from);
  if (to) qs.set('to', to);
  if (search.trim()) qs.set('search', search.trim());

  const { data, isLoading, error } = useQuery({
    queryKey: ['audit-log', entity, action, userId, from, to, search],
    queryFn: () => api<Resp>(`/audit?${qs.toString()}`),
  });

  const restore = useMutation({
    mutationFn: (id: string) => api(`/audit/${id}/restore`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['audit-log'] }),
  });

  const onRestore = async (e: Entry) => {
    const verb = e.action === 'DELETE' ? 'Restore' : 'Revert';
    const ok = await confirm({
      title: `${verb} this record?`,
      message: <>{verb} <strong>{e.entityLabel}</strong>{e.summary ? <> — {e.summary}</> : null}? {e.action === 'DELETE' ? 'It will be re-created with its original details.' : 'It will be rolled back to the state before this edit.'}</>,
      confirmLabel: verb,
      tone: e.action === 'DELETE' ? undefined : 'danger',
    });
    if (ok) restore.mutate(e.id);
  };

  const items = data?.items ?? [];

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <History className="h-5 w-5 text-brand-600" /> Audit Log
          </h1>
          <p className="mt-1 text-sm text-slate-500">Who changed what and when. Restore deleted records or revert edits.</p>
        </div>
      </div>

      <div className="card p-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-6">
        <label className="block"><span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-slate-500">Module</span>
          <SearchableSelect value={entity} onChange={setEntity} options={data?.entities ?? []} placeholder="All modules" /></label>
        <label className="block"><span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-slate-500">Action</span>
          <select className="input" value={action} onChange={(e) => setAction(e.target.value)}>
            <option value="">All</option><option value="CREATE">Created</option><option value="UPDATE">Edited</option><option value="DELETE">Deleted</option>
          </select></label>
        <label className="block"><span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-slate-500">User</span>
          <SearchableSelect value={userId} onChange={setUserId} options={data?.actors ?? []} placeholder="Everyone" /></label>
        <label className="block"><span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-slate-500">From</span>
          <input type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="block"><span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-slate-500">To</span>
          <input type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        <label className="block"><span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-slate-500">Search</span>
          <div className="relative"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input className="input pl-9" placeholder="Details / user…" value={search} onChange={(e) => setSearch(e.target.value)} /></div></label>
      </div>

      {error ? (
        <div className="card p-8 text-center text-sm text-red-600">
          {(error as Error).message?.includes('Forbidden') ? 'You don’t have permission to view the audit log.' : 'Could not load the audit log.'}
        </div>
      ) : (
        <div className="card overflow-hidden">
          {isLoading ? (
            <div className="py-12 text-center text-slate-400"><Loader2 className="h-5 w-5 animate-spin mx-auto" /></div>
          ) : !items.length ? (
            <div className="py-12 text-center text-sm text-slate-400">No activity for these filters.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm whitespace-nowrap">
                <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-3 py-2.5">When</th>
                    <th className="px-3 py-2.5">User</th>
                    <th className="px-3 py-2.5">Module</th>
                    <th className="px-3 py-2.5">Action</th>
                    <th className="px-3 py-2.5">Details</th>
                    <th className="px-3 py-2.5 text-center">Restore</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {items.map((e) => (
                    <tr key={e.id} className="hover:bg-slate-50/60">
                      <td className="px-3 py-2.5 text-slate-600">{fmt(e.createdAt)}</td>
                      <td className="px-3 py-2.5 font-medium text-slate-900">{e.user}</td>
                      <td className="px-3 py-2.5 text-slate-600">{e.entityLabel}</td>
                      <td className="px-3 py-2.5">
                        <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-medium', ACTION[e.action])}>
                          {e.action === 'CREATE' ? 'Created' : e.action === 'UPDATE' ? 'Edited' : 'Deleted'}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-slate-600 max-w-[280px] truncate" title={e.summary ?? ''}>{e.summary ?? '—'}</td>
                      <td className="px-3 py-2.5 text-center">
                        {e.restoredAt ? (
                          <span className="inline-flex items-center gap-1 text-[11px] text-emerald-600"><Check className="h-3.5 w-3.5" /> Restored</span>
                        ) : e.restorable ? (
                          <button onClick={() => onRestore(e)} disabled={restore.isPending} className="btn-ghost text-brand-700 hover:bg-brand-50" title={e.action === 'DELETE' ? 'Restore deleted record' : 'Revert this edit'}>
                            <RotateCcw className="h-4 w-4" />
                          </button>
                        ) : (
                          <span className="text-[11px] text-slate-300">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
      {confirmDialog}
    </div>
  );
};
