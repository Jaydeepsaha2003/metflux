// Shared visual language for the Production pages (Receive / Modify / Summary)
// — reskinned from the user's own colour mockup. Deliberately separate from
// components/tally.tsx (the Accounts screens' look): this is a denser,
// dark-banded "manufacturing ERP" style, used ONLY here so no other page's
// chrome moves. Typography is the app-wide Inter; figures add .font-num for
// tabular digits so columns of numbers stay in line.
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

/** Uppercase, letter-spaced label — the small caption text used above every
 *  KPI figure, table header cell and section eyebrow in the mockup. */
export const ErpLabel = ({ children, className }: { children: React.ReactNode; className?: string }) => (
  <span className={cn('text-[10px] font-bold uppercase tracking-[0.09em] text-slate-500', className)}>
    {children}
  </span>
);

/** One KPI cell for the stat strip — caption above a tabular figure. */
export const ErpStat = ({ label, value, caption, tone, big }: {
  label: string; value: string; caption?: string; tone?: 'brand' | 'ink'; big?: boolean;
}) => (
  <div className="min-w-0 px-4 py-3 sm:px-5 sm:py-3.5">
    <ErpLabel>{label}</ErpLabel>
    <div className={cn(
      'mt-1 truncate font-num font-bold tracking-tight tabular-nums',
      big ? 'text-xl sm:text-2xl' : 'text-lg sm:text-xl',
      tone === 'brand' ? 'text-brand-700' : 'text-slate-900',
    )}>
      {value}
    </div>
    {caption && <div className="mt-1 truncate text-[11px] leading-snug text-slate-400">{caption}</div>}
  </div>
);

/** Edge-to-edge strip of ErpStat cells, hairline-divided, with a brand-900 top
 *  accent rule — the KPI row under the filters on Modify/Summary. Hidden below
 *  md: on phones, ErpMobileHeader's dark card carries the same figures, so
 *  showing both would repeat every number twice on one screen. */
export const ErpStatStrip = ({ children }: { children: React.ReactNode }) => (
  <div className="hidden divide-x divide-y divide-slate-100 border-t border-slate-200 bg-slate-50/40 md:grid md:grid-cols-4 md:divide-y-0 lg:grid-cols-5">
    {children}
  </div>
);

/** Toroidal/Rectangular type chip — fixed semantic colours (not brand-driven),
 *  matching the mockup exactly. Kept separate from the amber/rose chip used
 *  elsewhere in the app (SO Summary, Dispatch, …) since this is a deliberate
 *  reskin of Production specifically, not a site-wide chip-colour change. */
export const CoreTypeChip = ({ coreType, className }: { coreType: 'TOROIDAL' | 'RECTANGULAR'; className?: string }) => (
  <span className={cn(
    'inline-flex items-center rounded-md px-1.5 py-[3px] text-[10px] font-bold uppercase tracking-[0.06em] ring-1 ring-inset',
    coreType === 'TOROIDAL'
      ? 'bg-[#EAF0FA] text-[#1B4E82] ring-[#C6DAF0]'
      : 'bg-[#EFF5EC] text-[#33473E] ring-[#CFDECB]',
    className,
  )}>
    {coreType === 'TOROIDAL' ? 'Toroidal' : 'Rectangular'}
  </span>
);

/** Small tag marking a production entry as one physical run of a split-width
 *  job (Production.splitHeight != null) — amber/WIP-toned and deliberately
 *  distinct from CoreTypeChip's blue/green core-type tag, so a split entry
 *  stands out at a glance in Modify/Summary/Edit without being mistaken for
 *  the core type itself. */
export const SplitHeightChip = ({ height, className }: { height: number; className?: string }) => (
  <span className={cn(
    'inline-flex items-center rounded-md bg-amber-50 px-1.5 py-[3px] text-[10px] font-bold uppercase tracking-[0.06em] text-amber-800 ring-1 ring-inset ring-amber-200',
    className,
  )}>
    Split {height}
  </span>
);

/** The single continuous white card every Production page content area sits
 *  in — the mockup never nests titled sub-panels (unlike tally.tsx's Panel);
 *  filters, stats, table and footer are one bordered surface with hairline
 *  internal dividers. */
export const ErpCard = ({ children, className }: { children: React.ReactNode; className?: string }) => (
  <div className={cn('overflow-hidden rounded-xl border border-slate-200/80 bg-white shadow-sm', className)}>
    {children}
  </div>
);

/** Dense table header cell — brand-900 fill, light caption text, and sticky so
 *  a long table keeps its headings. Use inside a <thead><tr> like a normal <th>. */
export const ErpTh = ({ children, align = 'left', className }: {
  children?: React.ReactNode; align?: 'left' | 'right' | 'center'; className?: string;
}) => (
  <th className={cn(
    'sticky top-0 z-10 whitespace-nowrap bg-brand-900 px-2.5 py-2.5 text-[10px] font-bold uppercase tracking-[0.09em] text-brand-100/80',
    align === 'right' && 'text-right', align === 'center' && 'text-center', align === 'left' && 'text-left',
    className,
  )}>
    {children}
  </th>
);

/** Dark grand-total / footer band (brand-900), matching the table header. */
export const ErpFooterRow = ({ children, colSpan }: { children: React.ReactNode; colSpan?: number }) => (
  <tr className="bg-brand-900 text-white">
    <td colSpan={colSpan} className="px-2.5 py-2 text-[11px] font-bold uppercase tracking-wider">
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
  <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50/80 p-0.5">
    {options.map((o) => (
      <button
        key={o.value}
        type="button"
        onClick={() => onChange(o.value)}
        aria-pressed={value === o.value}
        className={cn(
          'rounded-md px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.06em] transition-all duration-150 motion-reduce:transition-none',
          value === o.value ? 'bg-brand-900 text-white shadow-sm' : 'text-slate-600 hover:bg-white hover:text-slate-900',
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
  <div className="overflow-hidden rounded-xl bg-gradient-to-br from-brand-900 to-brand-950 p-4 text-white shadow-sm md:hidden">
    <div className="flex items-center gap-2.5">
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-brand-500/90">
        <Factory className="h-4 w-4 text-white" />
      </span>
      <div className="min-w-0">
        <div className="text-[15px] font-extrabold leading-tight">Production</div>
        <div className="truncate text-[11px] text-brand-100/70">{subtitle}</div>
      </div>
    </div>
    <div className="mt-3.5">
      <ErpLabel className="!text-brand-100/60">{primary.label}</ErpLabel>
      <div className="mt-0.5 font-num text-2xl font-bold tabular-nums text-brand-300">{primary.value}</div>
    </div>
    <div className="mt-3 grid grid-cols-2 gap-2.5 border-t border-white/10 pt-3">
      {stats.map((s) => (
        <div key={s.label}>
          <ErpLabel className="!text-brand-100/60">{s.label}</ErpLabel>
          <div className="mt-0.5 font-num text-lg font-semibold tabular-nums">{s.value}</div>
        </div>
      ))}
    </div>
  </div>
);

/** Shared MODIFY / RECEIVE / SUMMARY tab strip at the top of all three
 *  Production pages — routes and permissions are unchanged (still three
 *  separate routes/pages); this is a same-section convenience switcher that
 *  mirrors the sidebar's own Production sub-items. */
// The edit route /production/:id belongs under Modify, but its sibling routes
// are static paths rather than entry ids — so a bare "one segment after
// /production" test claims them too, and Receive and Summary each lit their own
// tab AND Modify at the same time. Anything listed here is somebody else's page.
const RESERVED_SEGMENTS = ['new', 'summary', 'rejection'];
const isModifyPath = (p: string) => {
  if (p === '/production') return true;
  const segment = /^\/production\/([^/]+)$/.exec(p)?.[1];
  return !!segment && !RESERVED_SEGMENTS.includes(segment);
};

export const ProductionTabs = () => {
  const { pathname } = useLocation();
  const tabs = [
    { to: '/production/new', label: 'Receive', icon: Inbox, match: (p: string) => p === '/production/new' },
    { to: '/production', label: 'Modify', icon: Pencil, match: isModifyPath },
    { to: '/production/summary', label: 'Summary', icon: BarChart3, match: (p: string) => p === '/production/summary' },
  ];
  return (
    <nav className="flex items-center gap-1 border-b border-slate-200">
      {tabs.map((t) => {
        const active = t.match(pathname);
        return (
          <Link
            key={t.to}
            to={t.to}
            aria-current={active ? 'page' : undefined}
            className={cn(
              // -mb-px pulls the indicator onto the nav's own border so the
              // active tab reads as connected to the panel below it.
              '-mb-px flex items-center gap-1.5 rounded-t-lg border-b-2 px-3 py-2.5 text-[12.5px] font-bold uppercase tracking-[0.06em] transition-colors duration-150 motion-reduce:transition-none',
              active
                ? 'border-brand-600 bg-brand-50/60 text-brand-800'
                : 'border-transparent text-slate-500 hover:bg-slate-50 hover:text-slate-800',
            )}
          >
            <t.icon className="h-3.5 w-3.5" /> {t.label}
          </Link>
        );
      })}
    </nav>
  );
};
