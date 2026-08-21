// Settings → Notifications. Send a push by hand, and trigger the outstanding-
// invoice reminder on demand instead of waiting for the daily sweep.
//
// The reminder preview matters: it shows the exact figures that would land on
// everyone's phone, so a wrong money number can be caught before it is sent.
import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Bell, Send, Loader2, CheckCircle2, AlertTriangle, RefreshCw, Eye } from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { Panel } from '@/components/tally';

type Payload = { title: string; body: string; url?: string } | null;
type SendResult = { sent: number; admins?: number; audience?: string; payload?: Payload };

const Field = ({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) => (
  <label className="block">
    <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">{label}</span>
    {children}
    {hint && <span className="mt-0.5 block text-[10.5px] text-slate-400">{hint}</span>}
  </label>
);

const input = 'h-9 w-full rounded border border-slate-300 bg-white px-2.5 text-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20';

export const NotificationsAdminPage = () => {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [url, setUrl] = useState('');
  const [audience, setAudience] = useState<'EVERYONE' | 'ADMINS'>('EVERYONE');
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const say = (t: string) => { setMsg(t); setErr(null); };
  const fail = (e: unknown) => { setErr(e instanceof Error ? e.message : 'Failed'); setMsg(null); };

  const preview = useQuery({
    queryKey: ['reminder-preview'],
    queryFn: () => api<{ payload: Payload }>('/push/reminder-preview'),
  });

  const test = useMutation({
    mutationFn: () => api<SendResult>('/push/test', { method: 'POST' }),
    onSuccess: (r) => say(`Test sent to ${r.sent} device${r.sent === 1 ? '' : 's'}.`),
    onError: fail,
  });

  const sendReminder = useMutation({
    mutationFn: () => api<SendResult>('/push/send-reminder', { method: 'POST' }),
    onSuccess: (r) => say(r.payload
      ? `Reminder sent to ${r.sent} device${r.sent === 1 ? '' : 's'}.`
      : 'Nothing outstanding — no reminder was sent.'),
    onError: fail,
  });

  const broadcast = useMutation({
    mutationFn: () => api<SendResult>('/push/broadcast', {
      method: 'POST',
      json: { title: title.trim(), body: body.trim(), url: url.trim() || undefined, audience },
    }),
    onSuccess: (r) => { say(`Sent to ${r.sent} device${r.sent === 1 ? '' : 's'}.`); setTitle(''); setBody(''); setUrl(''); },
    onError: fail,
  });

  const canSend = !!title.trim() && !!body.trim() && !broadcast.isPending;
  const p = preview.data?.payload;

  return (
    <div className="max-w-3xl space-y-4">
      <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
        <Bell className="h-5 w-5 text-brand-600" /> Notifications
      </h1>

      {msg && (
        <div className="flex items-start gap-2 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> {msg}
        </div>
      )}
      {err && (
        <div className="flex items-start gap-2 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {err}
        </div>
      )}

      {/* Outstanding-invoice reminder, on demand */}
      <Panel
        title={<><RefreshCw className="h-3.5 w-3.5" /> Outstanding-invoice reminder</>}
        right={
          <button onClick={() => preview.refetch()} disabled={preview.isFetching}
            className="inline-flex h-7 items-center gap-1 rounded border border-slate-300 px-2 text-[10.5px] font-bold uppercase tracking-wide text-slate-600 hover:bg-slate-100 disabled:opacity-50">
            {preview.isFetching ? <Loader2 className="h-3 w-3 animate-spin" /> : <Eye className="h-3 w-3" />} Refresh preview
          </button>
        }
      >
        <p className="border-b border-slate-100 px-3 py-2 text-[11px] leading-relaxed text-slate-500">
          Normally sent once a day. This shows exactly what would go out right now, using the same figures as
          Amount Receivable — check the numbers here before sending.
        </p>

        <div className="p-3">
          {preview.isLoading ? (
            <div className="py-4 text-center text-slate-400"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></div>
          ) : !p ? (
            <div className="rounded border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-500">
              Nothing outstanding right now — there is no reminder to send.
            </div>
          ) : (
            <div className="rounded-lg border border-slate-300 bg-slate-900 px-3 py-2.5 text-white">
              <div className="text-[10px] uppercase tracking-wider text-white/40">Preview</div>
              <div className="mt-0.5 text-sm font-bold">{p.title}</div>
              <div className="mt-0.5 text-[12px] leading-snug text-white/80">{p.body}</div>
              {p.url && <div className="mt-1 truncate text-[10.5px] text-white/40">opens {p.url}</div>}
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 bg-slate-50 px-3 py-2">
          <span className="text-[11px] text-slate-500">Goes to every company admin who has enabled notifications.</span>
          <button onClick={() => sendReminder.mutate()} disabled={sendReminder.isPending || !p}
            className="inline-flex h-8 items-center gap-1.5 rounded bg-brand-600 px-4 text-xs font-bold uppercase tracking-wide text-white hover:bg-brand-700 disabled:opacity-50">
            {sendReminder.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} Send now
          </button>
        </div>
      </Panel>

      {/* Free-text push */}
      <Panel title={<><Send className="h-3.5 w-3.5" /> Send a notification</>}>
        <div className="space-y-3 p-3">
          <Field label="Title" hint="Up to 80 characters — this is the bold line on the phone.">
            <input className={input} maxLength={80} value={title} onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Stock check tomorrow" />
          </Field>
          <Field label="Message" hint="Up to 240 characters.">
            <textarea className={cn(input, 'h-20 resize-none py-2')} maxLength={240} value={body}
              onChange={(e) => setBody(e.target.value)} placeholder="e.g. Please complete the warehouse count before 11am." />
          </Field>
          <Field label="Opens (optional)" hint="An in-app path like /s/admin/dispatch, or a full https:// link.">
            <input className={input} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="/s/admin/dispatch" />
          </Field>
          <Field label="Send to">
            <div className="inline-flex rounded border border-slate-300 bg-white p-0.5">
              {([['EVERYONE', 'Everyone in this company'], ['ADMINS', 'Admins only']] as const).map(([k, lbl]) => (
                <button key={k} onClick={() => setAudience(k)}
                  className={cn('rounded-sm px-3 py-1 text-[11px] font-bold uppercase tracking-wider transition',
                    audience === k ? 'bg-brand-600 text-white' : 'text-slate-600 hover:bg-slate-100')}>
                  {lbl}
                </button>
              ))}
            </div>
          </Field>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 bg-slate-50 px-3 py-2">
          <button onClick={() => test.mutate()} disabled={test.isPending}
            className="inline-flex h-8 items-center gap-1.5 rounded border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-50">
            {test.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Bell className="h-3.5 w-3.5" />} Send test to admins
          </button>
          <button onClick={() => broadcast.mutate()} disabled={!canSend}
            className="inline-flex h-8 items-center gap-1.5 rounded bg-brand-600 px-4 text-xs font-bold uppercase tracking-wide text-white hover:bg-brand-700 disabled:opacity-50">
            {broadcast.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} Send
          </button>
        </div>
      </Panel>
    </div>
  );
};
