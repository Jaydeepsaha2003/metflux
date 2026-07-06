// Top-bar bell for company admins: enable device notifications, and ring +
// vibrate + badge when someone signs in while you're logged in. Polls the
// active-sessions endpoint and alerts on any new (non-self) login.
import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Bell, Check, X, Loader2, Send } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { enablePush } from '@/lib/push';
import { cn } from '@/lib/cn';

type Session = { jti: string; userId: string; username: string; name: string; device: string | null; location: string | null; loginAt: string | null };
type Evt = { id: string; name: string; device: string | null; at: string | null };

const beep = () => {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const a = new Ctx();
    const o = a.createOscillator(); const g = a.createGain();
    o.connect(g); g.connect(a.destination);
    o.type = 'sine'; o.frequency.value = 880; g.gain.value = 0.06;
    o.start(); o.stop(a.currentTime + 0.28);
  } catch { /* ignore */ }
};
const buzz = () => { try { navigator.vibrate?.([200, 100, 200]); } catch { /* ignore */ } };
const fmtTime = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
};

export const LoginBell = () => {
  const user = useAuthStore((s) => s.user);
  const activeRole = useAuthStore((s) => s.activeRole);
  const isAdmin = !!user?.isPlatformAdmin || activeRole === 'COMPANY_ADMIN';

  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [events, setEvents] = useState<Evt[]>([]);
  const [pushState, setPushState] = useState<'idle' | 'on' | 'denied' | 'unsupported' | 'working'>('idle');
  const [testing, setTesting] = useState(false);
  const [testMsg, setTestMsg] = useState<string | null>(null);
  const watermark = useRef<number | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (typeof Notification === 'undefined' || !('serviceWorker' in navigator)) setPushState('unsupported');
    else if (Notification.permission === 'granted') setPushState('on');
    else if (Notification.permission === 'denied') setPushState('denied');
  }, []);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const { data } = useQuery({
    queryKey: ['login-bell'],
    queryFn: () => api<{ items: Session[] }>('/auth/sessions'),
    enabled: isAdmin,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });

  useEffect(() => {
    if (!data?.items) return;
    const others = data.items.filter((s) => s.userId !== user?.id && s.loginAt);
    const times = others.map((s) => new Date(s.loginAt as string).getTime());
    const newest = times.length ? Math.max(...times) : 0;
    if (watermark.current == null) { watermark.current = newest || Date.now(); return; } // first poll — baseline only
    const fresh = others.filter((s) => new Date(s.loginAt as string).getTime() > (watermark.current as number));
    if (fresh.length) {
      watermark.current = Math.max(watermark.current as number, ...fresh.map((s) => new Date(s.loginAt as string).getTime()));
      setEvents((prev) => [...fresh.map((s) => ({ id: s.jti, name: s.name || s.username, device: s.device, at: s.loginAt })), ...prev].slice(0, 20));
      setUnread((u) => u + fresh.length);
      beep(); buzz();
    }
  }, [data, user?.id]);

  if (!isAdmin) return null;

  const onEnable = async () => {
    setPushState('working');
    const r = await enablePush();
    setPushState(r.ok ? 'on' : (r.reason.includes('denied') ? 'denied' : 'idle'));
  };

  const onTest = async () => {
    setTesting(true); setTestMsg(null);
    try {
      const r = await api<{ sent: number; admins: number }>('/push/test', { method: 'POST' });
      setTestMsg(r.sent > 0
        ? `Test sent to ${r.sent} device${r.sent === 1 ? '' : 's'}.`
        : 'Sent — but no device received it. Enable notifications on a device first (and the server needs VAPID keys).');
    } catch {
      setTestMsg('Could not send the test notification.');
    } finally { setTesting(false); }
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => { setOpen((v) => !v); setUnread(0); }}
        className="relative grid h-9 w-9 place-items-center rounded-lg text-slate-600 hover:bg-slate-100 transition-colors"
        title="Sign-in alerts"
        aria-label="Sign-in alerts"
      >
        <Bell className="h-5 w-5" />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-red-500 px-1 text-[10px] font-semibold text-white">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-40 mt-2 w-80 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5">
            <span className="text-sm font-semibold text-slate-900">Sign-in alerts</span>
            <button onClick={() => setOpen(false)} className="rounded p-1 text-slate-400 hover:bg-slate-100"><X className="h-3.5 w-3.5" /></button>
          </div>

          <div className="border-b border-slate-100 px-4 py-2.5 text-xs">
            {pushState === 'on' ? (
              <span className="inline-flex items-center gap-1.5 text-emerald-600"><Check className="h-3.5 w-3.5" /> Notifications enabled on this device</span>
            ) : pushState === 'denied' ? (
              <span className="text-amber-600">Notifications blocked — enable them in your browser site settings.</span>
            ) : pushState === 'unsupported' ? (
              <span className="text-slate-400">Notifications not supported on this browser.</span>
            ) : (
              <button onClick={onEnable} disabled={pushState === 'working'} className="inline-flex items-center gap-1.5 font-medium text-brand-700 hover:underline">
                {pushState === 'working' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Bell className="h-3.5 w-3.5" />}
                Enable notifications on this device
              </button>
            )}
          </div>

          {/* Manual test — sends a push to the company admins (and you). */}
          <div className="border-b border-slate-100 px-4 py-2.5 text-xs">
            <button onClick={onTest} disabled={testing} className="inline-flex items-center gap-1.5 font-medium text-slate-700 hover:underline disabled:opacity-50">
              {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
              Send test notification to admins
            </button>
            {testMsg && <div className="mt-1 text-[11px] text-slate-500">{testMsg}</div>}
          </div>

          <div className="max-h-72 overflow-y-auto">
            {!events.length ? (
              <div className="px-4 py-6 text-center text-xs text-slate-400">No new sign-ins yet.</div>
            ) : (
              events.map((e, i) => (
                <div key={`${e.id}:${i}`} className={cn('px-4 py-2.5 text-sm', i > 0 && 'border-t border-slate-50')}>
                  <div className="font-medium text-slate-900">{e.name} <span className="font-normal text-slate-500">signed in</span></div>
                  <div className="text-[11px] text-slate-400">{[e.device, fmtTime(e.at)].filter(Boolean).join(' · ')}</div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
};
