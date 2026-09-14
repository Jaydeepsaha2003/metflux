// Shared visual language for the Production pages (Receive / Modify / Summary)
// — reskinned from the user's own colour mockup. Deliberately separate from
// components/tally.tsx (the Accounts screens' look): this is a denser,
// dark-banded "manufacturing ERP" style with Archivo labels and JetBrains
// Mono figures, used ONLY here so no other page's typography or chrome moves.
//
// Colour rule: the mockup hardcodes a dark-green/lime pair everywhere. That
// collides with the app's per-domain brand colour (Metflux green, Toroflux
// blue) driven by CSS variables — see lib/brandColor.ts. So every dark band
// below uses `brand-900` (which the runtime ramp derives from the domain's
// own colour) instead of a literal hex, and every primary action uses the
// existing `.btn-primary` (brand-600). Metflux's brand-900 happens to land
// within a few RGB points of the mockup's literal #0B3D2E, so Metflux reads
// as an almost exact match; Toroflux gets the equivalent dark NAVY instead of
// dark green, consistent with its own branding everywhere else in the app.
// Only the TOROIDAL/RECTANGULAR type chips keep fixed colours (blue/green) —
// those are a content category tag, like a status pill, not brand identity.
import { Link, useLocation } from 'react-router-dom';
import { Inbox, Pencil, BarChart3, Factory } from 'lucide-react';
import { cn } from '@/lib/cn';

/** Uppercase, letter-spaced Archivo label — the small caption text used above
 *  every KPI figure, table header cell and section eyebrow in the mockup. */
export const ErpLabel = ({ children, className }: { children: React.ReactNode; className?: string }) => (
  <span className={cn('font-archivo text-[9.5px] font-extrabold uppercase tracking-[0.12em] text-slate-500', className)}>
    {children}
  </span>
);

/** One KPI cell for the stat strip — Archivo caption + JetBrains Mono value. */
export const ErpStat = ({ label, value, caption, tone, big }: {
  label: string; value: string; caption?: string; tone?: 'brand' | 'ink'; big?: boolean;
}) => (
  <div className="min-w-0 px-3.5 py-2.5 sm:px-4 sm:py-3">
    <ErpLabel>{label}</ErpLabel>
    <div className={cn(
      'mt-0.5 truncate font-jbmono font-semibold tabular-nums',
      big ? 'text-lg sm:text-xl' : 'text-base sm:text-lg',
      tone === 'brand' ? 'text-brand-700' : 'text-slate-900',
    )}>
      {value}
    </div>
    {caption && <div className="mt-0.5 truncate text-[10.5px] text-slate-400">{caption}</div>}
  </div>
);

/** Edge-to-edge strip of ErpStat cells, hairline-divided, with a brand-900 top
 *  accent rule — the KPI row under the filters on Modify/Summary. Hidden below
 *  md: on phones, ErpMobileHeader's dark card carries the same figures, so
 *  showing both would repeat every number twice on one screen. */
export const ErpStatStrip = ({ children }: { children: React.ReactNode }) => (
  <div className="hidden divide-x divide-y divide-slate-100 border-t-2 border-brand-900 md:grid md:grid-cols-4 md:divide-y-0 lg:grid-cols-5">
    {children}
  </div>
);

/** Toroidal/Rectangular type chip — fixed semantic colours (not brand-driven),
 *  matching the mockup exactly. Kept separate from the amber/rose chip used
 *  elsewhere in the app (SO Summary, Dispatch, …) since this is a deliberate
 *  reskin of Production specifically, not a site-wide chip-colour change. */
export const CoreTypeChip = ({ coreType, className }: { coreType: 'TOROIDAL' | 'RECTANGULAR'; className?: string }) => (
  <span className={cn(
    'inline-flex items-center rounded-[3px] border px-1.5 py-0.5 font-archivo text-[9.5px] font-extrabold uppercase tracking-wider',
    coreType === 'TOROIDAL'
      ? 'border-[#C6DAF0] bg-[#EAF0FA] text-[#1B4E82]'
      : 'border-[#D6E2D6] bg-[#EFF5EC] text-[#33473E]',
    className,
  )}>
    {coreType === 'TOROIDAL' ? 'Toroidal' : 'Rectangular'}
  </span>
);

/** The single continuous white card every Production page content area sits
 *  in — the mockup never nests titled sub-panels (unlike tally.tsx's Panel);
 *  filters, stats, table and footer are one bordered surface with hairline
 *  internal dividers. */
export const ErpCard = ({ children, className }: { children: React.ReactNode; className?: string }) => (
  <div className={cn('overflow-hidden rounded border border-slate-200 bg-white', className)}>
    {children}
  </div>
);

/** Dense table header cell — brand-900 fill, light Archivo caption text. Use
 *  inside a <thead><tr> exactly like a normal <th>. */
export const ErpTh = ({ children, align = 'left', className }: {
  children?: React.ReactNode; align?: 'left' | 'right' | 'center'; className?: string;
}) => (
  <th className={cn(
    'whitespace-nowrap bg-brand-900 px-2.5 py-2 font-archivo text-[9.5px] font-extrabold uppercase tracking-[0.12em] text-brand-100/80',
    align === 'right' && 'text-right', align === 'center' && 'text-center', align === 'left' && 'text-left',
    className,
  )}>
    {children}
  </th>
);

/** Dark grand-total / footer band (brand-900), matching the table header. */
export const ErpFooterRow = ({ children, colSpan }: { children: React.ReactNode; colSpan?: number }) => (
  <tr className="bg-brand-900 text-white">
    <td colSpan={colSpan} className="px-2.5 py-2 font-archivo text-[11px] font-bold uppercase tracking-wider">
      {children}
    </td>
  </tr>
);

/** Segmented pill control (CORE TYPE filter, view switcher) — brand-900 fill
 *  with white text on the active option, matching the mockup's dark-active
 *  segmented look without the hardcoded lime accent. */
export const ErpSegmented = <T extends string>({ value, onChange, options }: {
  value: T; onChange: (v: T) => void; options: { value: T; label: string }[];
}) => (
  <div className="inline-flex rounded-[3px] border border-slate-200 bg-white p-0.5">
    {options.map((o) => (
      <button
        key={o.value}
        type="button"
        onClick={() => onChange(o.value)}
        aria-pressed={value === o.value}
        className={cn(
          'rounded-[3px] px-3 py-1 font-archivo text-[11px] font-extrabold uppercase tracking-wide transition-colors duration-150 motion-reduce:transition-none',
          value === o.value ? 'bg-brand-900 text-white' : 'text-slate-600 hover:bg-slate-100',
        )}
      >
        {o.label}
      </button>
    ))}
  </div>
);

/** Mobile-only dark summary header — the phone-app-style card from the
 *  mockup (icon + title + subtitle, a headline figure, small stat pairs
 *  below). Shown only below md; the desktop filter/KPI strip in ErpCard
 *  covers the same ground above that breakpoint, so this doesn't duplicate
 *  data on larger screens. */
export const ErpMobileHeader = ({ subtitle, primary, stats }: {
  subtitle: string;
  primary: { label: string; value: string };
  stats: { label: string; value: string }[];
}) => (
  <div className="overflow-hidden rounded-lg bg-brand-900 p-4 text-white md:hidden">
    <div className="flex items-center gap-2.5">
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-brand-500/90">
        <Factory className="h-4 w-4 text-white" />
      </span>
      <div className="min-w-0">
        <div className="font-archivo text-[15px] font-extrabold leading-tight">Production</div>
        <div className="truncate text-[11px] text-brand-100/70">{subtitle}</div>
      </div>
    </div>
    <div className="mt-3.5">
      <ErpLabel className="!text-brand-100/60">{primary.label}</ErpLabel>
      <div className="mt-0.5 font-jbmono text-2xl font-bold tabular-nums text-brand-300">{primary.value}</div>
    </div>
    <div className="mt-3 grid grid-cols-2 gap-2.5 border-t border-white/10 pt-3">
      {stats.map((s) => (
        <div key={s.label}>
          <ErpLabel className="!text-brand-100/60">{s.label}</ErpLabel>
          <div className="mt-0.5 font-jbmono text-lg font-semibold tabular-nums">{s.value}</div>
        </div>
      ))}
    </div>
  </div>
);

/** Shared MODIFY / RECEIVE / SUMMARY tab strip at the top of all three
 *  Production pages — routes and permissions are unchanged (still three
 *  separate routes/pages); this is a same-section convenience switcher that
 *  mirrors the sidebar's own Production sub-items. */
export const ProductionTabs = () => {
  const { pathname } = useLocation();
  const tabs = [
    { to: '/production', label: 'Modify', icon: Pencil, match: (p: string) => p === '/production' || /^\/production\/[^/]+$/.test(p) },
    { to: '/production/new', label: 'Receive', icon: Inbox, match: (p: string) => p === '/production/new' },
    { to: '/production/summary', label: 'Summary', icon: BarChart3, match: (p: string) => p === '/production/summary' },
  ];
  return (
    <nav className="flex items-center gap-5 border-b border-slate-200">
      {tabs.map((t) => {
        const active = t.match(pathname);
        return (
          <Link
            key={t.to}
            to={t.to}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex items-center gap-1.5 border-b-2 py-2.5 font-archivo text-[12.5px] font-extrabold uppercase tracking-wide transition-colors duration-150 motion-reduce:transition-none',
              active ? 'border-brand-600 text-brand-800' : 'border-transparent text-slate-500 hover:text-slate-700',
            )}
          >
            <t.icon className="h-3.5 w-3.5" /> {t.label}
          </Link>
        );
      })}
    </nav>
  );
};
