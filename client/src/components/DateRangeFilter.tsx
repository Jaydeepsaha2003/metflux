// Shared date-range filter: a compact trigger that opens a two-column popover —
// relative presets on the left, Indian financial year / quarter / month on the
// right — plus a custom range, ◀ ▶ steppers that move the window by its own
// length, and a live readout of exactly what is selected.
//
// Opens on Alt+F2 from anywhere on the page it's mounted on.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Calendar, ChevronDown, ChevronLeft, ChevronRight, RotateCcw } from 'lucide-react';
import { cn } from '@/lib/cn';
import {
  DATE_RANGE_PRESETS, detectDateRangePreset, formatDateRangeLabel,
  fyOf, fyStartISO, fyEndISO, fyLabel, fyQuarter, fyMonths, rangeDays, shiftRange, toISO,
} from '@/lib/dateRange';

type Props = {
  from: string;
  to: string;
  onChange: (from: string, to: string) => void;
  /** Label shown inside the popover header. Defaults to "Filter by date". */
  label?: string;
  className?: string;
};

const fmt = (iso: string) => {
  if (!iso) return '—';
  const d = new Date(iso + 'T00:00:00');
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
};

const Chip = ({ active, onClick, children, title }: {
  active?: boolean; onClick: () => void; children: React.ReactNode; title?: string;
}) => (
  <button
    type="button" onClick={onClick} title={title}
    className={cn('rounded px-2 py-1 text-left text-[11px] font-medium ring-1 transition',
      active ? 'bg-brand-600 text-white ring-brand-600' : 'bg-white text-slate-600 ring-slate-200 hover:bg-slate-50')}
  >
    {children}
  </button>
);

export const DateRangeFilter = ({ from, to, onChange, label = 'Filter by date', className }: Props) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const thisFy = useMemo(() => fyOf(new Date()), []);
  const [fy, setFy] = useState(thisFy);

  const activePreset = detectDateRangePreset(from, to);
  const isActive = !!from || !!to;
  const days = rangeDays(from, to);
  const closed = !!from && !!to;

  useEffect(() => {
    const onDoc = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey && e.key === 'F2') { e.preventDefault(); setOpen((v) => !v); return; }
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    window.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); window.removeEventListener('keydown', onKey); };
  }, []);

  // Re-centre the FY pane on whatever range is showing when the popover opens.
  useEffect(() => {
    if (!open) return;
    const base = from || to;
    setFy(base ? fyOf(new Date(base + 'T00:00:00')) : thisFy);
  }, [open, from, to, thisFy]);

  const step = (dir: -1 | 1) => { const r = shiftRange(from, to, dir); onChange(r.from, r.to); };
  const isRange = (a: string, b: string) => from === a && to === b;
  const months = useMemo(() => fyMonths(fy), [fy]);

  return (
    <div ref={ref} className={cn('relative inline-flex items-stretch', className)}>
      {/* ◀ steps the window back by its own length; only meaningful once closed */}
      {closed && (
        <button type="button" onClick={() => step(-1)} title={`Previous ${days} day${days === 1 ? '' : 's'}`}
          className="rounded-l-lg border border-r-0 border-slate-300 bg-white px-1.5 text-slate-500 hover:bg-slate-50">
          <ChevronLeft className="h-3.5 w-3.5" />
        </button>
      )}

      <button
        type="button" onClick={() => setOpen((v) => !v)} title="Filter by date (Alt+F2)"
        className={cn('inline-flex h-9 items-center gap-2 border px-3 text-sm font-medium transition',
          closed ? '' : 'rounded-l-lg',
          'rounded-r-lg',
          isActive ? 'border-brand-300 bg-brand-50 text-brand-700 hover:bg-brand-100'
                   : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50',
          open && 'ring-2 ring-brand-200')}
      >
        <Calendar className="h-4 w-4 shrink-0" />
        <span className="max-w-[190px] truncate">{formatDateRangeLabel(from, to)}</span>
        {days > 1 && <span className="hidden rounded bg-white/70 px-1 text-[9px] font-bold text-slate-500 sm:inline">{days}d</span>}
        <kbd className="hidden rounded border border-current/20 bg-white/60 px-1 py-0.5 text-[9px] font-semibold leading-none text-slate-400 sm:inline-block">Alt+F2</kbd>
        <ChevronDown className={cn('h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform', open && 'rotate-180')} />
      </button>

      {closed && (
        <button type="button" onClick={() => step(1)} title={`Next ${days} day${days === 1 ? '' : 's'}`}
          className="-ml-px rounded-r-lg border border-l-0 border-slate-300 bg-white px-1.5 text-slate-500 hover:bg-slate-50">
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
      )}

      {open && (
        <div className="absolute left-0 top-full z-30 mt-2 w-[330px] rounded-xl border border-slate-200 bg-white p-3 shadow-lg animate-fade-up sm:w-[460px]">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</span>
            {isActive && (
              <button type="button" onClick={() => onChange('', '')}
                className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium text-slate-400 hover:bg-slate-100 hover:text-slate-600">
                <RotateCcw className="h-3 w-3" /> Clear
              </button>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {/* ── Relative presets ── */}
            <div>
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Quick</div>
              <div className="grid grid-cols-2 gap-1">
                {DATE_RANGE_PRESETS.map((p) => (
                  <Chip key={p.key} active={activePreset === p.key} onClick={() => onChange(p.from(), p.to())}>
                    {p.label}
                  </Chip>
                ))}
              </div>
            </div>

            {/* ── Financial year ── */}
            <div>
              <div className="mb-1 flex items-center justify-between">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Financial year</span>
                <span className="inline-flex items-center gap-0.5">
                  <button type="button" onClick={() => setFy((y) => y - 1)} title="Previous FY"
                    className="rounded p-0.5 text-slate-400 hover:bg-slate-100"><ChevronLeft className="h-3 w-3" /></button>
                  <span className="min-w-[52px] text-center font-mono text-[11px] font-bold text-slate-700">{fyLabel(fy)}</span>
                  <button type="button" onClick={() => setFy((y) => y + 1)} disabled={fy >= thisFy + 1} title="Next FY"
                    className="rounded p-0.5 text-slate-400 hover:bg-slate-100 disabled:opacity-30"><ChevronRight className="h-3 w-3" /></button>
                </span>
              </div>

              <div className="grid grid-cols-2 gap-1">
                <Chip active={isRange(fyStartISO(fy), fyEndISO(fy))}
                  onClick={() => onChange(fyStartISO(fy), fyEndISO(fy))}
                  title={`1 Apr ${fy} – 31 Mar ${fy + 1}`}>
                  Full year
                </Chip>
                <Chip active={isRange(fyStartISO(fy), toISO(new Date()))}
                  onClick={() => onChange(fyStartISO(fy), toISO(new Date()))}
                  title="Year to date">
                  To date
                </Chip>
                {([1, 2, 3, 4] as const).map((q) => {
                  const r = fyQuarter(fy, q);
                  return <Chip key={q} active={isRange(r.from, r.to)} onClick={() => onChange(r.from, r.to)}
                    title={`${fmt(r.from)} – ${fmt(r.to)}`}>Q{q}</Chip>;
                })}
              </div>

              <div className="mt-1.5 grid grid-cols-6 gap-1">
                {months.map((m) => (
                  <Chip key={m.key} active={isRange(m.from, m.to)} onClick={() => onChange(m.from, m.to)}
                    title={`${m.label} ${m.year}`}>
                    <span className="block text-center">{m.label}</span>
                  </Chip>
                ))}
              </div>
            </div>
          </div>

          {/* ── Custom range ── */}
          <div className="mt-3 border-t border-slate-100 pt-2.5">
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Custom range</span>
              {days > 0 && <span className="text-[10px] font-medium text-slate-400">{days} day{days === 1 ? '' : 's'}</span>}
            </div>
            <div className="flex items-center gap-2">
              <input type="date" className="input h-8 min-w-0 flex-1 text-xs" value={from} max={to || undefined}
                onChange={(e) => onChange(e.target.value, to)} />
              <span className="shrink-0 text-xs text-slate-400">→</span>
              <input type="date" className="input h-8 min-w-0 flex-1 text-xs" value={to} min={from || undefined}
                onChange={(e) => onChange(from, e.target.value)} />
            </div>
            <div className="mt-1.5 rounded bg-slate-50 px-2 py-1 text-center text-[11px] text-slate-500">
              {isActive
                ? <>Showing <b className="text-slate-700">{fmt(from) === '—' ? 'the beginning' : fmt(from)}</b> to <b className="text-slate-700">{fmt(to) === '—' ? 'today' : fmt(to)}</b></>
                : <>Showing <b className="text-slate-700">all time</b> — no date filter</>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
