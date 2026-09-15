import { useId } from 'react';
import { cn } from '@/lib/cn';

/** Uppercase eyebrow above every figure, section and table column. */
export const DashLabel = ({ children, className }: { children: React.ReactNode; className?: string }) => (
  <div className={cn('text-[10px] font-extrabold uppercase leading-none tracking-[0.11em] text-[var(--d-muted)]', className)}>
    {children}
  </div>
);

/** Small muted caption — the line under a figure, a unit, a footnote. */
export const DashCaption = ({ children, className }: { children: React.ReactNode; className?: string }) => (
  <div className={cn('text-[11.5px] leading-snug text-[var(--d-muted)]', className)}>{children}</div>
);

/** One bordered surface. `as` lets a card become a link without restyling. */
export const DashPanel = ({ children, className, ...rest }: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    {...rest}
    style={{ boxShadow: 'var(--d-shadow)' }}
    className={cn('dash-panel rounded-lg border border-[var(--d-line)] bg-[var(--d-panel)]', className)}
  >
    {children}
  </div>
);

export type ChipTone = 'accent' | 'toro' | 'rect' | 'warn' | 'danger' | 'plain';
const CHIP: Record<ChipTone, { bg: string; fg: string; bd: string }> = {
  accent: { bg: 'var(--d-accent-dim)', fg: 'var(--d-accent)', bd: 'var(--d-accent-line)' },
  toro:   { bg: 'var(--d-toro-dim)',   fg: 'var(--d-toro)',   bd: 'var(--d-toro-dim)' },
  rect:   { bg: 'var(--d-rect-dim)',   fg: 'var(--d-rect)',   bd: 'var(--d-rect-dim)' },
  warn:   { bg: 'var(--d-warn-dim)',   fg: 'var(--d-warn)',   bd: 'var(--d-warn-dim)' },
  danger: { bg: 'var(--d-danger-dim)', fg: 'var(--d-danger)', bd: 'var(--d-danger-dim)' },
  plain:  { bg: 'transparent',         fg: 'var(--d-muted)',  bd: 'var(--d-line)' },
};

/** Small tag: an amount, a core-type count, a status word. */
export const DashChip = ({ tone = 'plain', children, className }: {
  tone?: ChipTone; children: React.ReactNode; className?: string;
}) => {
  const c = CHIP[tone];
  return (
    <span
      className={cn('dash-chip inline-flex items-center gap-1 rounded-[3px] border px-1.5 py-[3px] text-[10.5px] font-bold leading-none tabular-nums', className)}
      style={{ backgroundColor: c.bg, color: c.fg, borderColor: c.bd }}
    >
      {children}
    </span>
  );
};

/** Dark/Light and date-preset switches share one look. */
export const DashSeg = ({ active, children, ...rest }: { active: boolean } & React.ButtonHTMLAttributes<HTMLButtonElement>) => (
  <button
    type="button"
    {...rest}
    aria-pressed={active}
    className="dash-seg rounded-[3px] px-2.5 py-1 text-[10.5px] font-extrabold uppercase tracking-[0.06em] transition-colors duration-150 motion-reduce:transition-none"
    style={active
      ? { backgroundColor: 'var(--d-accent)', color: 'var(--d-accent-ink)' }
      : { backgroundColor: 'transparent', color: 'var(--d-muted)' }}
  >
    {children}
  </button>
);

/**
 * The trend under a KPI figure. Values are a dense daily series from
 * /dashboard/series, so index maps to day and a flat stretch is genuinely a
 * quiet stretch. Negative values (the ready-to-dispatch net flow can go
 * negative on a heavy shipping day) are handled by scaling across the real
 * min/max rather than assuming a zero floor.
 */
export const Sparkline = ({ values, className }: { values: number[]; className?: string }) => {
  const pts = values.length ? values : [0];
  const W = 132, H = 30, PAD = 2;
  const min = Math.min(...pts, 0);
  const max = Math.max(...pts, 0);
  const span = max - min || 1;
  const x = (i: number) => (pts.length === 1 ? W / 2 : (i / (pts.length - 1)) * W);
  const y = (v: number) => H - PAD - ((v - min) / span) * (H - PAD * 2);

  const line = pts.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const area = `${line} L${W},${H} L0,${H} Z`;
  // One gradient id per instance — duplicates across five cards would make
  // every sparkline adopt whichever definition rendered last.
  const gid = useId();

  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className={cn('block h-[30px] w-full', className)} aria-hidden>
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--d-accent)" stopOpacity="0.24" />
          <stop offset="100%" stopColor="var(--d-accent)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gid})`} />
      <path d={line} fill="none" stroke="var(--d-accent)" strokeWidth="1.4" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
};

/** Horizontal share bar — top-customer value, worker share of output. */
export const DashBar = ({ pct, tone = 'accent' }: { pct: number; tone?: 'accent' | 'muted' }) => (
  <span className="dash-bar block h-1 w-full overflow-hidden rounded-sm" style={{ backgroundColor: 'var(--d-line-soft)' }}>
    <span
      className="block h-full rounded-sm"
      style={{
        width: `${Math.max(0, Math.min(100, pct))}%`,
        backgroundColor: tone === 'accent' ? 'var(--d-accent)' : 'var(--d-muted)',
      }}
    />
  </span>
);
