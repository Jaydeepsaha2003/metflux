// Shared Tally-style chrome: a bordered panel with an uppercase rule header,
// dense grid headings, and a stat strip. Used by the Accounts screens so they
// read as one system.
import { cn } from '@/lib/cn';

export const Panel = ({ title, right, children, className }: {
  title: React.ReactNode; right?: React.ReactNode; children: React.ReactNode; className?: string;
}) => (
  <section className={cn('overflow-hidden rounded border border-slate-300 bg-white shadow-sm', className)}>
    <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-300 bg-slate-100 px-3 py-1.5">
      <h2 className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-600">{title}</h2>
      {right}
    </header>
    {children}
  </section>
);

export const Th = ({ children, align = 'left', className }: {
  children?: React.ReactNode; align?: 'left' | 'right' | 'center'; className?: string;
}) => (
  <th className={cn(
    'border-b-2 border-slate-300 bg-slate-100 px-2 py-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-500',
    align === 'right' && 'text-right', align === 'center' && 'text-center', align === 'left' && 'text-left', className,
  )}>{children}</th>
);

/** Edge-to-edge strip of figures, hairline-separated like a Tally summary band. */
export const StatStrip = ({ items, cols = 4 }: {
  items: { label: string; value: string; tone?: string }[]; cols?: 3 | 4 | 5;
}) => (
  <div className={cn('grid grid-cols-2 gap-px bg-slate-200',
    cols === 3 && 'sm:grid-cols-3', cols === 4 && 'sm:grid-cols-4', cols === 5 && 'sm:grid-cols-5')}>
    {items.map((s) => (
      <div key={s.label} className="bg-white px-3 py-1.5">
        <div className="text-[9.5px] font-semibold uppercase tracking-wider text-slate-400">{s.label}</div>
        <div className={cn('font-mono text-sm font-bold tabular-nums', s.tone ?? 'text-slate-700')}>{s.value}</div>
      </div>
    ))}
  </div>
);

/** Plain grouped figure — Tally keeps the ₹ for headline totals only. */
export const num = (n: number | undefined | null) =>
  Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
