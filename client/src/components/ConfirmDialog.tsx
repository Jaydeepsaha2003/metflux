// Drop-in replacement for window.confirm / alert. Renders a centered modal
// with tone-aware iconography, a dimmed backdrop, ESC-to-close, and a body
// that accepts either a string or rich JSX (so callers can render breakdowns,
// lists, etc). Use `tone="danger"` for destructive actions, `"warning"` for
// reversible-but-careful actions, `"info"` for plain confirmations.
import { ReactNode, useEffect } from 'react';
import { AlertTriangle, Info, OctagonAlert, X, Loader2 } from 'lucide-react';
import { cn } from '@/lib/cn';

export type ConfirmTone = 'danger' | 'warning' | 'info';

type Props = {
  open: boolean;
  title: string;
  message?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: ConfirmTone;
  loading?: boolean;
  /** When true the cancel button is hidden — use this for "alert" style notifications. */
  alertOnly?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

const TONE: Record<ConfirmTone, { icon: typeof AlertTriangle; ring: string; bg: string; fg: string; btn: string }> = {
  danger:  { icon: OctagonAlert,  ring: 'ring-red-100',   bg: 'bg-red-100',   fg: 'text-red-600',   btn: 'bg-red-600 hover:bg-red-700 focus:ring-red-500 text-white shadow-sm shadow-red-600/25' },
  warning: { icon: AlertTriangle, ring: 'ring-amber-100', bg: 'bg-amber-100', fg: 'text-amber-600', btn: 'bg-amber-600 hover:bg-amber-700 focus:ring-amber-500 text-white shadow-sm shadow-amber-600/25' },
  info:    { icon: Info,          ring: 'ring-brand-100', bg: 'bg-brand-100', fg: 'text-brand-600', btn: 'bg-brand-600 hover:bg-brand-700 focus:ring-brand-500 text-white shadow-sm shadow-brand-600/25' },
};

export const ConfirmDialog = ({
  open, title, message,
  confirmLabel = 'Confirm', cancelLabel = 'Cancel',
  tone = 'warning', loading, alertOnly,
  onConfirm, onCancel,
}: Props) => {
  // Close on Esc unless we're mid-action.
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !loading) onCancel();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, loading, onCancel]);

  if (!open) return null;

  const t = TONE[tone];
  const Icon = t.icon;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-slate-900/50 backdrop-blur-sm p-4 sm:items-center"
      role="dialog" aria-modal="true" aria-labelledby="confirm-title"
      onClick={loading ? undefined : onCancel}
    >
      <div
        className="w-full max-w-md rounded-2xl bg-white shadow-2xl ring-1 ring-black/5 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3 p-5">
          <div className={cn('grid h-10 w-10 shrink-0 place-items-center rounded-full ring-4', t.bg, t.ring)}>
            <Icon className={cn('h-5 w-5', t.fg)} />
          </div>
          <div className="min-w-0 flex-1 pt-0.5">
            <div className="flex items-start justify-between gap-2">
              <h2 id="confirm-title" className="text-base font-semibold text-slate-900">{title}</h2>
              <button
                onClick={onCancel}
                disabled={loading}
                className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-40"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            {message && <div className="mt-1.5 text-sm text-slate-600 leading-relaxed">{message}</div>}
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-100 bg-slate-50 px-5 py-3">
          {!alertOnly && (
            <button
              onClick={onCancel}
              className="rounded-lg px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-200/60 transition disabled:opacity-50"
              disabled={loading}
            >
              {cancelLabel}
            </button>
          )}
          <button
            onClick={onConfirm}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-sm font-medium transition focus:outline-none focus:ring-2 focus:ring-offset-1 disabled:opacity-50 disabled:cursor-not-allowed',
              t.btn,
            )}
            disabled={loading}
          >
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};
