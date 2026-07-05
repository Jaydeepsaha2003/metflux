// User Logs — active login sessions across the company (company-admin only).
// Shows where each user is logged in (IP, device, location), when they logged in
// and their last activity, with a force-logout for any device.
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ShieldCheck, Loader2, LogOut, MapPin, Monitor } from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useConfirm } from '@/hooks/useConfirm';

type Session = {
  jti: string; userId: string; username: string; name: string;
  ip: string | null; device: string | null; location: string | null;
  loginAt: string | null; lastUsedAt: string | null; expiresAt: string; current: boolean;
};

const fmt = (iso: string | null) => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};
const ago = (iso: string | null) => {
  if (!iso) return '';
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};

export const UserLogsPage = () => {
  const qc = useQueryClient();
  const { confirm, confirmDialog } = useConfirm();
  const [search, setSearch] = useState('');

  const { data, isLoading, error } = useQuery({
    queryKey: ['user-logs'],
    queryFn: () => api<{ items: Session[] }>('/auth/sessions'),
    refetchInterval: 60_000,
  });

  const revoke = useMutation({
    mutationFn: (jti: string) => api(`/auth/sessions/${jti}/revoke`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['user-logs'] }),
  });

  const onRevoke = async (s: Session) => {
    const ok = await confirm({
      title: 'Log out this device?',
      message: <>Force-logout <strong>{s.name || s.username}</strong>{s.device ? <> on <strong>{s.device}</strong></> : null}? They'll need to sign in again.</>,
      tone: 'danger',
      confirmLabel: 'Log out device',
    });
    if (ok) revoke.mutate(s.jti);
  };

  const items = (data?.items ?? []).filter((s) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return [s.name, s.username, s.ip, s.device, s.location].some((v) => (v ?? '').toLowerCase().includes(q));
  });

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-brand-600" /> User Logs
          </h1>
          <p className="mt-1 text-sm text-slate-500">Active login sessions across your company. Force-logout any device you don't recognise.</p>
        </div>
        <input className="input w-full sm:w-72" placeholder="Search user, IP, device…" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      {error ? (
        <div className="card p-8 text-center text-sm text-red-600">
          {(error as Error).message?.includes('Forbidden') ? 'Only a company admin can view user logs.' : 'Could not load sessions.'}
        </div>
      ) : (
        <div className="card overflow-hidden">
          {isLoading ? (
            <div className="py-12 text-center text-slate-400"><Loader2 className="h-5 w-5 animate-spin mx-auto" /></div>
          ) : !items.length ? (
            <div className="py-12 text-center text-sm text-slate-400">No active sessions.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm whitespace-nowrap">
                <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-3 py-2.5">User</th>
                    <th className="px-3 py-2.5">Device</th>
                    <th className="px-3 py-2.5">IP address</th>
                    <th className="px-3 py-2.5">Location</th>
                    <th className="px-3 py-2.5">Logged in</th>
                    <th className="px-3 py-2.5">Last activity</th>
                    <th className="px-3 py-2.5 text-center">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((s) => (
                    <tr key={s.jti} className={cn('border-t border-slate-100', s.current && 'bg-brand-50/40')}>
                      <td className="px-3 py-2.5">
                        <div className="font-medium text-slate-900">{s.name || s.username}</div>
                        <div className="text-[11px] text-slate-500">@{s.username}{s.current && <span className="ml-1.5 rounded bg-brand-100 px-1.5 py-0.5 text-[10px] font-medium text-brand-700">This device</span>}</div>
                      </td>
                      <td className="px-3 py-2.5 text-slate-600"><Monitor className="inline h-3.5 w-3.5 mr-1 text-slate-400" />{s.device ?? '—'}</td>
                      <td className="px-3 py-2.5 font-mono text-xs text-slate-600">{s.ip ?? '—'}</td>
                      <td className="px-3 py-2.5 text-slate-600">{s.location ? <><MapPin className="inline h-3.5 w-3.5 mr-1 text-slate-400" />{s.location}</> : '—'}</td>
                      <td className="px-3 py-2.5 text-slate-600">{fmt(s.loginAt)}</td>
                      <td className="px-3 py-2.5 text-slate-600">{fmt(s.lastUsedAt)} <span className="text-[11px] text-slate-400">· {ago(s.lastUsedAt)}</span></td>
                      <td className="px-3 py-2.5 text-center">
                        <button
                          onClick={() => onRevoke(s)}
                          disabled={revoke.isPending}
                          className="btn-ghost text-red-600 hover:bg-red-50"
                          title="Force-logout this device"
                        >
                          <LogOut className="h-4 w-4" />
                        </button>
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
