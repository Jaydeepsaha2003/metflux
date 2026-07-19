// Top-bar notification centre. Lists persisted notifications (login alerts,
// due-invoice reminders, tests, …), shows an unread badge, rings on a new one,
// and on click marks read + deep-links into the app. Also hosts the per-device
// web-push enable/test controls.
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Bell, Check, X, Loader2, Send, CheckCheck, Trash2, Clock, LogIn, Factory, AlertCircle, CreditCard,
} from 'lucide-react';
import { api } from '@/lib/api';
import { enablePush } from '@/lib/push';
import { cn } from '@/lib/cn';

type Notif = { id: string; type: string; title: string; body: string | null; url: string | null; isRead: boolean; createdAt: string };
type Resp = { items: Notif[]; unread: number };

/* ── One shared AudioContext, unlocked on the first gesture (iOS rule) ── */
let sharedCtx: AudioContext | null = null;
const getCtx = (): AudioContext | null => {
  if (typeof window === 'undefined') return null;
  const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return null;
  if (!sharedCtx) { try { sharedCtx = new Ctx(); } catch { return null; } }
  return sharedCtx;
};
export const unlockAudio = () => {
  const ctx = getCtx();
  if (!ctx) return;
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  try { const b = ctx.createBuffer(1, 1, 22050); const s = ctx.createBufferSource(); s.buffer = b; s.connect(ctx.destination); s.start(0); } catch { /* ignore */ }
};
const beep = () => {
  try {
    const ctx = getCtx(); if (!ctx) return;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    const master = ctx.createGain(); master.gain.value = 0.9; master.connect(ctx.destination);
    const notes = [{ f: 784, t: 0 }, { f: 1047, t: 0.13 }, { f: 1319, t: 0.26 }];
    const now = ctx.currentTime;
    for (const n of notes) {
      const o = ctx.createOscillator(); const g = ctx.createGain();
      o.type = 'triangle'; o.frequency.value = n.f; o.connect(g); g.connect(master);
      const s = now + n.t;
      g.gain.setValueAtTime(0.0001, s);
      g.gain.exponentialRampToValueAtTime(0.5, s + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, s + 0.38);
      o.start(s); o.stop(s + 0.42);
    }
  } catch { /* ignore */ }
};
const buzz = () => { try { navigator.vibrate?.([200, 100, 200]); } catch { /* ignore */ } };

const relTime = (iso: string) => {
  const d = new Date(iso).getTime();
  if (Number.isNaN(d)) return '';
  const s = Math.round((Date.now() - d) / 1000);
  if (s < 60) return 'just now';
  const m = Math.round(s / 60); if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60); if (h < 24) return `${h}h ago`;
  const day = Math.round(h / 24); if (day === 1) return 'yesterday';
  if (day < 7) return `${day}d ago`;
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
};

const ICON: Record<string, { icon: typeof Bell; tone: string }> = {
  LOGIN: { icon: LogIn, tone: 'bg-sky-50 text-sky-600' },
  DUE: { icon: CreditCard, tone: 'bg-amber-50 text-amber-600' },
  PRODUCTION: { icon: Factory, tone: 'bg-violet-50 text-violet-600' },
  TEST: { icon: Bell, tone: 'bg-emerald-50 text-emerald-600' },
  SYSTEM: { icon: AlertCircle, tone: 'bg-slate-100 text-slate-600' },
};

export const NotificationBell = () => {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<'all' | 'unread'>('all');
  const [pushState, setPushState] = useState<'idle' | 'on' | 'denied' | 'unsupported' | 'working' | 'ios-install'>('idle');
  const [testing, setTesting] = useState(false);
  const [testMsg, setTestMsg] = useState<string | null>(null);
  const prevUnread = useRef<number | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const [popTop, setPopTop] = useState(64);

  const { data } = useQuery({
    queryKey: ['notifications', filter],
    queryFn: () => api<Resp>(`/notifications?filter=${filter}&limit=50`),
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });
  const items = data?.items ?? [];
  const unread = data?.unread ?? 0;

  // Ring + vibrate when a new notification arrives (unread count climbs).
  useEffect(() => {
    if (prevUnread.current == null) { prevUnread.current = unread; return; }
    if (unread > prevUnread.current) { beep(); buzz(); }
    prevUnread.current = unread;
  }, [unread]);

  // Detect push capability (iOS needs an installed Home-Screen PWA).
  useEffect(() => {
    const iOS = /iPad|iPhone|iPod/.test(navigator.userAgent || '');
    const standalone = window.matchMedia?.('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
    const supported = typeof Notification !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window;
    if (!supported) { setPushState(iOS && !standalone ? 'ios-install' : 'unsupported'); return; }
    if (Notification.permission === 'denied') { setPushState('denied'); return; }
    if (Notification.permission !== 'granted') { setPushState(iOS && !standalone ? 'ios-install' : 'idle'); return; }
    (async () => { try { const reg = await navigator.serviceWorker.ready; setPushState((await reg.pushManager.getSubscription()) ? 'on' : 'idle'); } catch { setPushState('idle'); } })();
  }, []);

  // Unlock Web Audio on the first gesture so the chime can play later on mobile.
  useEffect(() => {
    const unlock = () => { unlockAudio(); window.removeEventListener('pointerdown', unlock); window.removeEventListener('touchend', unlock); };
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('touchend', unlock, { once: true });
    return () => { window.removeEventListener('pointerdown', unlock); window.removeEventListener('touchend', unlock); };
  }, []);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || popRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const invalidate = () => qc.invalidateQueries({ queryKey: ['notifications'] });
  const readOne = useMutation({ mutationFn: (id: string) => api(`/notifications/${id}/read`, { method: 'POST' }), onSuccess: invalidate });
  const readAll = useMutation({ mutationFn: () => api('/notifications/read-all', { method: 'POST' }), onSuccess: invalidate });
  const delOne = useMutation({ mutationFn: (id: string) => api(`/notifications/${id}`, { method: 'DELETE' }), onSuccess: invalidate });
  const clearAll = useMutation({ mutationFn: () => api('/notifications/clear', { method: 'POST' }), onSuccess: invalidate });

  const toggleOpen = () => {
    setOpen((v) => {
      const next = !v;
      if (next) { const r = ref.current?.getBoundingClientRect(); setPopTop(r ? r.bottom + 8 : 64); }
      return next;
    });
  };

  const openNotif = (n: Notif) => {
    if (!n.isRead) readOne.mutate(n.id);
    if (n.url) {
      const path = n.url.replace(/^https?:\/\/[^/]+/, '').replace(/^\/s\/admin/, '') || '/';
      navigate(path);
      setOpen(false);
    }
  };

  const onEnable = async () => { setPushState('working'); const r = await enablePush(); setPushState(r.ok ? 'on' : (r.reason.includes('denied') ? 'denied' : 'idle')); };
  const onTest = async () => {
    setTesting(true); setTestMsg(null);
    try {
      const r = await api<{ sent: number }>('/push/test', { method: 'POST' });
      setTestMsg(r.sent > 0 ? `Test sent to ${r.sent} device${r.sent === 1 ? '' : 's'}.` : 'Sent — enable notifications on a device first (and the server needs VAPID keys).');
      invalidate();
    } catch { setTestMsg('Could not send the test.'); }
    finally { setTesting(false); }
  };

  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={toggleOpen}
        className="relative grid h-9 w-9 place-items-center rounded-lg text-slate-600 hover:bg-slate-100 transition-colors"
        title="Notifications" aria-label="Notifications">
        <Bell className="h-5 w-5" />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-red-500 px-1 text-[10px] font-semibold text-white">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && createPortal(
        <div ref={popRef} style={{ top: popTop }} className="fixed right-2 z-[120] w-[min(23rem,calc(100vw-1rem))] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5">
            <span className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              Notifications {unread > 0 && <span className="rounded-full bg-red-50 px-1.5 py-0.5 text-[10px] font-bold text-red-600">{unread}</span>}
            </span>
            <div className="flex items-center gap-1">
              <button onClick={() => readAll.mutate()} disabled={!unread || readAll.isPending} className="rounded p-1 text-slate-400 hover:bg-slate-100 disabled:opacity-40" title="Mark all read"><CheckCheck className="h-4 w-4" /></button>
              <button onClick={() => clearAll.mutate()} disabled={!items.length || clearAll.isPending} className="rounded p-1 text-slate-400 hover:bg-slate-100 disabled:opacity-40" title="Clear all"><Trash2 className="h-4 w-4" /></button>
              <button onClick={() => setOpen(false)} className="rounded p-1 text-slate-400 hover:bg-slate-100"><X className="h-3.5 w-3.5" /></button>
            </div>
          </div>

          {/* Filter tabs */}
          <div className="flex gap-1 border-b border-slate-100 px-3 py-1.5">
            {(['all', 'unread'] as const).map((f) => (
              <button key={f} onClick={() => setFilter(f)}
                className={cn('rounded-md px-2.5 py-1 text-xs font-medium', filter === f ? 'bg-brand-50 text-brand-700' : 'text-slate-500 hover:bg-slate-100')}>
                {f === 'all' ? 'All' : `Unread${unread ? ` (${unread})` : ''}`}
              </button>
            ))}
          </div>

          {/* Device push controls */}
          <div className="border-b border-slate-100 px-4 py-2 text-xs">
            {pushState === 'on' ? (
              <span className="inline-flex items-center gap-1.5 text-emerald-600"><Check className="h-3.5 w-3.5" /> Notifications enabled on this device</span>
            ) : pushState === 'denied' ? (
              <span className="text-amber-600">Blocked — enable notifications in your browser site settings.</span>
            ) : pushState === 'ios-install' ? (
              <span className="text-slate-600">On iPhone/iPad: <b>Share → Add to Home Screen</b>, then open Metflux from that icon and enable here.</span>
            ) : pushState === 'unsupported' ? (
              <span className="text-slate-400">Push not supported on this browser.</span>
            ) : (
              <button onClick={onEnable} disabled={pushState === 'working'} className="inline-flex items-center gap-1.5 font-medium text-brand-700 hover:underline">
                {pushState === 'working' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Bell className="h-3.5 w-3.5" />} Enable notifications on this device
              </button>
            )}
            <button onClick={onTest} disabled={testing} className="ml-3 inline-flex items-center gap-1 text-slate-500 hover:underline disabled:opacity-50">
              {testing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />} Test
            </button>
            {testMsg && <div className="mt-1 text-[11px] text-slate-400">{testMsg}</div>}
          </div>

          {/* List */}
          <div className="max-h-[26rem] overflow-y-auto">
            {!items.length ? (
              <div className="px-4 py-10 text-center text-xs text-slate-400">
                {filter === 'unread' ? 'No unread notifications.' : 'No notifications yet.'}
              </div>
            ) : items.map((n) => {
              const meta = ICON[n.type] ?? ICON.SYSTEM;
              const Icon = meta.icon;
              return (
                <div key={n.id}
                  className={cn('group flex cursor-pointer gap-3 border-t border-slate-50 px-4 py-2.5 hover:bg-slate-50/70', !n.isRead && 'bg-brand-50/30')}
                  onClick={() => openNotif(n)}>
                  <span className={cn('mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full', meta.tone)}><Icon className="h-4 w-4" /></span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      {!n.isRead && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-brand-500" />}
                      <span className={cn('truncate text-sm', n.isRead ? 'font-medium text-slate-700' : 'font-semibold text-slate-900')}>{n.title}</span>
                    </div>
                    {n.body && <div className="mt-0.5 text-xs text-slate-500 line-clamp-2">{n.body}</div>}
                    <div className="mt-0.5 flex items-center gap-1 text-[10px] text-slate-400"><Clock className="h-3 w-3" /> {relTime(n.createdAt)}</div>
                  </div>
                  <button onClick={(e) => { e.stopPropagation(); delOne.mutate(n.id); }}
                    className="self-start rounded p-1 text-slate-300 opacity-0 transition group-hover:opacity-100 hover:bg-slate-100 hover:text-red-500" title="Remove">
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              );
            })}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};
