// Shared date-range filter: a compact trigger button that opens a popover
// with quick presets + a custom From/To range. Also opens on Alt+F2 from
// anywhere on the page it's mounted on — handy for Accounts pages where
// re-filtering by date is the single most common action.
import { useEffect, useRef, useState } from 'react';
import { Calendar, ChevronDown, RotateCcw } from 'lucide-react';
import { cn } from '@/lib/cn';
import { DATE_RANGE_PRESETS, detectDateRangePreset, formatDateRangeLabel } from '@/lib/dateRange';

type Props = {
  from: string;
  to: string;
  onChange: (from: string, to: string) => void;
  /** Label shown inside the popover header. Defaults to "Filter by date". */
  label?: string;
  className?: string;
};

export const DateRangeFilter = ({ from, to, onChange, label = 'Filter by date', className }: Props) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const activePreset = detectDateRangePreset(from, to);
  const isActive = !!from || !!to;

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey && e.key === 'F2') {
        e.preventDefault();
        setOpen((v) => !v);
        return;
      }
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  return (
    <div ref={ref} className={cn('relative inline-block', className)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-sm font-medium transition',
          isActive
            ? 'border-brand-300 bg-brand-50 text-brand-700 hover:bg-brand-100'
            : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50',
          open && 'ring-2 ring-brand-200',
        )}
        title="Filter by date (Alt+F2)"
      >
        <Calendar className="h-4 w-4 shrink-0" />
        <span className="max-w-[180px] truncate">{formatDateRangeLabel(from, to)}</span>
        <kbd className="hidden rounded border border-current/20 bg-white/60 px-1 py-0.5 text-[9px] font-semibold leading-none text-slate-400 sm:inline-block">
          Alt+F2
        </kbd>
        <ChevronDown className={cn('h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div className="absolute left-0 z-30 mt-2 w-[300px] rounded-xl border border-slate-200 bg-white p-3 shadow-lg animate-fade-up sm:w-[340px]">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</span>
            {isActive && (
              <button
                type="button"
                onClick={() => onChange('', '')}
                className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              >
                <RotateCcw className="h-3 w-3" /> Clear
              </button>
            )}
          </div>

          <div className="mb-3 grid grid-cols-2 gap-1.5">
            {DATE_RANGE_PRESETS.map((p) => (
              <button
                key={p.key}
                type="button"
                onClick={() => onChange(p.from(), p.to())}
                className={cn(
                  'rounded-md px-2 py-1.5 text-left text-xs font-medium ring-1 transition',
                  activePreset === p.key
                    ? 'bg-brand-50 text-brand-700 ring-brand-200'
                    : 'bg-white text-slate-600 ring-slate-200 hover:bg-slate-50',
                )}
              >
                {p.label}
              </button>
            ))}
          </div>

          <div className="border-t border-slate-100 pt-2.5">
            <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">Custom range</span>
            <div className="flex items-center gap-2">
              <input
                type="date"
                className="input h-8 min-w-0 flex-1 text-xs"
                value={from}
                max={to || undefined}
                onChange={(e) => onChange(e.target.value, to)}
              />
              <span className="shrink-0 text-xs text-slate-400">→</span>
              <input
                type="date"
                className="input h-8 min-w-0 flex-1 text-xs"
                value={to}
                min={from || undefined}
                onChange={(e) => onChange(from, e.target.value)}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
