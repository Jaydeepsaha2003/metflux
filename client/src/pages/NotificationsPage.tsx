// Full-page notification history — all alerts with a type filter, mark-read and
// clear, and click-to-open deep links. The bell panel shows the latest few; this
// is the complete list.
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Bell, Loader2, CheckCheck, Trash2, Clock, X } from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { ICON, relTime } from '@/components/NotificationBell';

type Notif = { id: string; type: string; title: string; body: string | null; url: string | null; isRead: boolean; createdAt: string };

const LABEL: Record<string, string> = {
  LOGIN: 'Sign-in', DUE: 'Invoices due', PRODUCTION: 'Production',
  SALES_ORDER: 'Sales order', DISPATCH: 'Dispatch', PAYMENT: 'Payment', JOURNAL: 'Journal', TEST: 'Test', SYSTEM: 'System',
};

export const NotificationsPage = () => {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [type, setType] = useState('ALL');

  const { data, isLoading } = useQuery({
    queryKey: ['notifications-page'],
    queryFn: () => api<{ items: Notif[]; unread: number }>('/notifications?filter=all&limit=200'),
    refetchInterval: 60_000,
  });
  const all = data?.items ?? [];
  const types = [...new Set(all.map((n) => n.type))];
  const items = type === 'ALL' ? all : all.filter((n) => n.type === type);

  const invalidate = () => { qc.invalidateQueries({ queryKey: ['notifications-page'] }); qc.invalidateQueries({ queryKey: ['notifications'] }); };
  const readOne = useMutation({ mutationFn: (id: string) => api(`/notifications/${id}/read`, { method: 'POST' }), onSuccess: invalidate });
  const readAll = useMutation({ mutationFn: () => api('/notifications/read-all', { method: 'POST' }), onSuccess: invalidate });
  const delOne = useMutation({ mutationFn: (id: string) => api(`/notifications/${id}`, { method: 'DELETE' }), onSuccess: invalidate });
  const clearAll = useMutation({ mutationFn: () => api('/notifications/clear', { method: 'POST' }), onSuccess: invalidate });

  const open = (n: Notif) => {
    if (!n.isRead) readOne.mutate(n.id);
    if (n.url) navigate(n.url.replace(/^https?:\/\/[^/]+/, '').replace(/^\/s\/admin/, '') || '/');
  };

  return (
    <div className="max-w-3xl space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight">
          <Bell className="h-5 w-5 text-brand-600" /> Notifications
          {data?.unread ? <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs font-bold text-red-600">{data.unread} unread</span> : null}
        </h1>
        <div className="flex items-center gap-2">
          <select className="input h-9 w-40 text-sm" value={type} onChange={(e) => setType(e.target.value)}>
            <option value="ALL">All types</option>
            {types.map((t) => <option key={t} value={t}>{LABEL[t] ?? t}</option>)}
          </select>
          <button onClick={() => readAll.mutate()} disabled={!data?.unread || readAll.isPending} className="btn-ghost border border-slate-300 text-slate-600 hover:bg-slate-50 text-sm disabled:opacity-50">
            <CheckCheck className="h-4 w-4" /> Mark all read
          </button>
          <button onClick={() => clearAll.mutate()} disabled={!all.length || clearAll.isPending} className="btn-ghost border border-slate-300 text-red-600 hover:bg-red-50 text-sm disabled:opacity-50">
            <Trash2 className="h-4 w-4" /> Clear
          </button>
        </div>
      </div>

      <div className="card overflow-hidden">
        {isLoading ? (
          <div className="py-14 text-center text-slate-400"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></div>
        ) : !items.length ? (
          <div className="py-14 text-center text-sm text-slate-400">No notifications{type !== 'ALL' ? ' of this type' : ''}.</div>
        ) : (
          <div className="divide-y divide-slate-100">
            {items.map((n) => {
              const meta = ICON[n.type] ?? ICON.SYSTEM;
              const Icon = meta.icon;
              return (
                <div key={n.id} onClick={() => open(n)}
                  className={cn('group flex cursor-pointer gap-3 px-4 py-3 hover:bg-slate-50/70', !n.isRead && 'bg-brand-50/30')}>
                  <span className={cn('mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-full', meta.tone)}><Icon className="h-4 w-4" /></span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      {!n.isRead && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-brand-500" />}
                      <span className={cn('text-sm', n.isRead ? 'font-medium text-slate-700' : 'font-semibold text-slate-900')}>{n.title}</span>
                      <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">{LABEL[n.type] ?? n.type}</span>
                    </div>
                    {n.body && <div className="mt-0.5 text-sm text-slate-500">{n.body}</div>}
                    <div className="mt-0.5 flex items-center gap-1 text-[11px] text-slate-400"><Clock className="h-3 w-3" /> {relTime(n.createdAt)}</div>
                  </div>
                  <button onClick={(e) => { e.stopPropagation(); delOne.mutate(n.id); }}
                    className="self-start rounded p-1 text-slate-300 opacity-0 transition group-hover:opacity-100 hover:bg-slate-100 hover:text-red-500" title="Remove">
                    <X className="h-4 w-4" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default NotificationsPage;
