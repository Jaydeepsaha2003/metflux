// Password-protected customer portal — ultra-modern glassmorphic UI.
// Animated aurora backdrop, frosted-glass cards, glossy gradient accents,
// count-up stats and animated progress bars. Data + auth logic are unchanged:
// customers sign in with the shared password, then track their orders.
import { useState, useEffect, useMemo, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Search, Package, Factory, Truck, CheckCircle2, Clock,
  Download, AlertCircle, Loader2, ChevronDown, ChevronRight,
  FileSpreadsheet, MapPin, Phone, Mail, Building2,
  LayoutGrid, ArrowRight, ShieldCheck, Lock, KeyRound, Eye, EyeOff, Sparkles,
} from 'lucide-react';

/* ── Types ──────────────────────────────────────────────────── */
type OrderItem = {
  id: string; coreType: 'TOROIDAL' | 'RECTANGULAR';
  grade: string; material: string; measure: string;
  orderedPcs: number; producedPcs: number; dispatchedPcs: number;
};
type Order = {
  id: string; poNumber: string; orderDate: string; deliveryDate: string | null;
  totalOrdered: number; totalProduced: number; totalDispatched: number;
  hasDispatch: boolean;
  status: 'PENDING' | 'IN_PRODUCTION' | 'READY_TO_DISPATCH' | 'PARTIAL_DISPATCH' | 'COMPLETED';
  items: OrderItem[];
};
type PortalData = {
  company: { name: string; logoUrl: string | null; address: string | null; phone: string | null; email: string | null; gstNumber: string | null; };
  customer: { name: string; customerCode: string; state: string | null; };
  orders: Order[];
};

/* ── Status config ──────────────────────────────────────────── */
const STATUS: Record<string, { label: string; chip: string; dot: string; grad: string }> = {
  PENDING:           { label: 'Pending',              chip: 'bg-slate-100/80 text-slate-600 ring-slate-200',   dot: 'bg-slate-400',   grad: 'from-slate-300 to-slate-400'   },
  IN_PRODUCTION:     { label: 'In Production',        chip: 'bg-amber-100/70 text-amber-700 ring-amber-200',   dot: 'bg-amber-500',   grad: 'from-amber-400 to-orange-400'  },
  READY_TO_DISPATCH: { label: 'Ready to Dispatch',    chip: 'bg-sky-100/70 text-sky-700 ring-sky-200',         dot: 'bg-sky-500',     grad: 'from-sky-400 to-cyan-400'      },
  PARTIAL_DISPATCH:  { label: 'Partially Dispatched', chip: 'bg-violet-100/70 text-violet-700 ring-violet-200', dot: 'bg-violet-500',  grad: 'from-violet-400 to-fuchsia-400' },
  COMPLETED:         { label: 'Completed',            chip: 'bg-emerald-100/70 text-emerald-700 ring-emerald-200', dot: 'bg-emerald-500', grad: 'from-emerald-400 to-teal-400'  },
};

/* ── Helpers ────────────────────────────────────────────────── */
const fmtDate = (iso: string | null | undefined) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? String(iso)
    : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
};
const pct = (part: number, total: number) =>
  total > 0 ? Math.min(Math.round((part / total) * 100), 100) : 0;
const fmt = (n: number) => n.toLocaleString('en-IN');

const GLASS = 'rounded-3xl bg-white/70 backdrop-blur-xl ring-1 ring-white/60 shadow-[0_10px_40px_-12px_rgba(6,78,59,0.25)]';

/** Ease-out count-up for a single number. */
const useCountUp = (target: number, ms = 850) => {
  const [n, setN] = useState(0);
  useEffect(() => {
    let raf = 0;
    let startTs: number | null = null;
    const tick = (ts: number) => {
      if (startTs === null) startTs = ts;
      const p = Math.min((ts - startTs) / ms, 1);
      setN(Math.round(target * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return n;
};

/* Fixed animated aurora backdrop + the page's keyframes (injected once). */
const PortalBackdrop = () => (
  <>
    <style>{`
      @keyframes mfBlob {0%,100%{transform:translate(0,0) scale(1)}33%{transform:translate(30px,-38px) scale(1.12)}66%{transform:translate(-24px,20px) scale(.93)}}
      @keyframes mfFadeUp {from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}}
      @keyframes mfPop {from{opacity:0;transform:scale(.9)}to{opacity:1;transform:scale(1)}}
      @keyframes mfShimmer {0%{transform:translateX(-130%)}100%{transform:translateX(360%)}}
      .mf-up{animation:mfFadeUp .6s cubic-bezier(.2,.75,.3,1) both}
      .mf-pop{animation:mfPop .5s cubic-bezier(.2,.75,.3,1) both}
      @media (prefers-reduced-motion: reduce){.mf-up,.mf-pop{animation:none}}
    `}</style>
    <div className="fixed inset-0 -z-10 overflow-hidden bg-gradient-to-br from-slate-50 via-emerald-50/50 to-sky-50">
      <div className="absolute -top-32 -left-24 h-[26rem] w-[26rem] rounded-full bg-emerald-300/40 blur-3xl" style={{ animation: 'mfBlob 20s ease-in-out infinite' }} />
      <div className="absolute top-1/4 -right-28 h-[28rem] w-[28rem] rounded-full bg-sky-300/40 blur-3xl" style={{ animation: 'mfBlob 26s ease-in-out infinite reverse' }} />
      <div className="absolute -bottom-24 left-1/3 h-[24rem] w-[24rem] rounded-full bg-teal-300/30 blur-3xl" style={{ animation: 'mfBlob 30s ease-in-out infinite' }} />
    </div>
  </>
);

/* Glossy gradient progress bar that animates its fill on mount. */
const GlossBar = ({ prd, dsp }: { prd: number; dsp: number }) => {
  const [grown, setGrown] = useState(false);
  useEffect(() => { const t = setTimeout(() => setGrown(true), 80); return () => clearTimeout(t); }, []);
  return (
    <div className="relative h-2 overflow-hidden rounded-full bg-slate-200/70">
      <div className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-amber-400 to-orange-400 transition-[width] duration-[900ms] ease-out" style={{ width: `${grown ? prd : 0}%` }} />
      <div className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-emerald-500 to-teal-400 transition-[width] duration-[900ms] ease-out" style={{ width: `${grown ? dsp : 0}%` }} />
      {/* glossy sheen */}
      <div className="pointer-events-none absolute inset-y-0 left-0 w-1/3 -skew-x-12 bg-white/40 blur-sm" style={{ animation: 'mfShimmer 2.6s ease-in-out 1s infinite' }} />
    </div>
  );
};

/* ── Order card ─────────────────────────────────────────────── */
const OrderCard = ({ order, token, dlToken, featured, delay = 0 }: { order: Order; token: string; dlToken: string; featured?: boolean; delay?: number }) => {
  const [expanded, setExpanded] = useState(featured ?? false);
  const meta = STATUS[order.status] ?? STATUS.PENDING;
  const prdPct = pct(order.totalProduced,   order.totalOrdered);
  const dspPct = pct(order.totalDispatched, order.totalOrdered);

  return (
    <div
      className={`mf-up group relative overflow-hidden ${GLASS} transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_22px_50px_-18px_rgba(6,78,59,0.45)]
        ${featured ? 'ring-2 ring-emerald-300/70' : ''}`}
      style={{ animationDelay: `${delay}ms` }}
    >
      {/* gradient status accent */}
      <div className={`absolute inset-x-0 top-0 h-1 bg-gradient-to-r ${meta.grad}`} />
      <div className="px-5 pt-5 pb-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[16px] font-black tracking-tight text-slate-900">{order.poNumber}</span>
              <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ring-1 ${meta.chip}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
                {meta.label}
              </span>
            </div>
            <div className="mt-1.5 flex flex-wrap gap-3 text-[11px] text-slate-500">
              <span className="flex items-center gap-1"><Clock className="h-3 w-3" />Order: {fmtDate(order.orderDate)}</span>
              {order.deliveryDate && (
                <span className="flex items-center gap-1"><Truck className="h-3 w-3" />Due: {fmtDate(order.deliveryDate)}</span>
              )}
            </div>
          </div>

          {order.hasDispatch && (
            <a href={`/api/portal/${token}/testing-excel/${order.id}?t=${encodeURIComponent(dlToken)}`} download
              className="relative shrink-0 overflow-hidden inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-500 px-3 py-2 text-[11px] font-semibold text-white shadow-lg shadow-emerald-500/30 transition-all hover:-translate-y-0.5 hover:shadow-emerald-500/50 active:translate-y-0">
              <span className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/30 to-transparent" />
              <FileSpreadsheet className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Test Report</span>
              <Download className="h-3 w-3" />
            </a>
          )}
        </div>

        {/* 3 stat tiles */}
        <div className="mt-4 grid grid-cols-3 gap-2">
          {[
            { icon: Package,  label: 'Ordered',    val: order.totalOrdered,    sub: 'pcs',        tile: 'from-slate-50 to-slate-100/60',     val_cls: 'text-slate-900',   sub_cls: 'text-slate-400'   },
            { icon: Factory,  label: 'Produced',   val: order.totalProduced,   sub: `${prdPct}%`, tile: 'from-amber-50 to-orange-100/50',    val_cls: 'text-amber-800',   sub_cls: 'text-amber-500'   },
            { icon: Truck,    label: 'Dispatched', val: order.totalDispatched, sub: `${dspPct}%`, tile: 'from-emerald-50 to-teal-100/50',    val_cls: 'text-emerald-800', sub_cls: 'text-emerald-500' },
          ].map(({ icon: Icon, label, val, sub, tile, val_cls, sub_cls }) => (
            <div key={label} className={`rounded-2xl bg-gradient-to-br p-3 text-center ring-1 ring-white/60 ${tile}`}>
              <div className="mb-1 flex items-center justify-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                <Icon className="h-3 w-3" />{label}
              </div>
              <div className={`text-[16px] font-black leading-tight tabular-nums ${val_cls}`}>{fmt(val)}</div>
              <div className={`text-[10px] font-medium ${sub_cls}`}>{sub}</div>
            </div>
          ))}
        </div>

        {/* progress */}
        <div className="mt-3.5 space-y-1.5">
          <GlossBar prd={prdPct} dsp={dspPct} />
          <div className="flex justify-between text-[10px] text-slate-400">
            <span className="flex items-center gap-1"><span className="inline-block h-1.5 w-2.5 rounded-sm bg-gradient-to-r from-amber-400 to-orange-400" />Produced {prdPct}%</span>
            <span className="flex items-center gap-1"><span className="inline-block h-1.5 w-2.5 rounded-sm bg-gradient-to-r from-emerald-500 to-teal-400" />Dispatched {dspPct}%</span>
          </div>
        </div>

        {order.items.length > 0 && (
          <button onClick={() => setExpanded((v) => !v)}
            className="mt-3 flex items-center gap-1 text-[12px] font-medium text-slate-500 transition-colors hover:text-emerald-700">
            {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            {order.items.length} line item{order.items.length !== 1 ? 's' : ''}
          </button>
        )}
      </div>

      {expanded && (
        <div className="border-t border-white/60 bg-white/40 divide-y divide-white/60">
          {order.items.map((it) => (
            <div key={it.id} className="px-5 py-3">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ring-1
                  ${it.coreType === 'TOROIDAL' ? 'bg-amber-100 text-amber-700 ring-amber-200' : 'bg-rose-100 text-rose-700 ring-rose-200'}`}>
                  {it.coreType === 'TOROIDAL' ? 'TC' : 'RC'}
                </span>
                <span className="font-mono text-[12px] font-semibold text-slate-800">{it.measure}</span>
                <span className="text-[11px] text-slate-500">{it.grade} · {it.material}</span>
              </div>
              <div className="grid grid-cols-3 gap-2 text-center text-[11px]">
                <div className="rounded-lg border border-slate-100 bg-white/70 py-1.5"><div className="font-bold tabular-nums text-slate-900">{fmt(it.orderedPcs)}</div><div className="text-slate-400">ordered</div></div>
                <div className="rounded-lg border border-amber-100 bg-amber-50/70 py-1.5"><div className="font-bold tabular-nums text-amber-800">{fmt(it.producedPcs)}</div><div className="text-amber-500">produced</div></div>
                <div className="rounded-lg border border-emerald-100 bg-emerald-50/70 py-1.5"><div className="font-bold tabular-nums text-emerald-800">{fmt(it.dispatchedPcs)}</div><div className="text-emerald-500">dispatched</div></div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

/* ── Stat chip (count-up) ───────────────────────────────────── */
const StatChip = ({ icon: Icon, label, value, grad, delay }: {
  icon: typeof Package; label: string; value: number; grad: string; delay: number;
}) => {
  const shown = useCountUp(value);
  return (
    <div className={`mf-up flex items-center gap-3 px-3.5 py-3 ${GLASS} transition-transform duration-300 hover:-translate-y-0.5`} style={{ animationDelay: `${delay}ms` }}>
      <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br text-white shadow-md ${grad}`}>
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0">
        <div className="text-xl font-black leading-tight tabular-nums text-slate-900">{shown}</div>
        <div className="truncate text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label}</div>
      </div>
    </div>
  );
};

/* ── Orders view (authenticated) ────────────────────────────── */
type DataViewProps = { token: string; sessionToken: string; onAuthError: () => void };

const PortalDataView = ({ token, sessionToken, onAuthError }: DataViewProps) => {
  const [search, setSearch]       = useState('');
  const [debounced, setDebounced] = useState('');
  const [showAll, setShowAll]     = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 350);
    return () => clearTimeout(t);
  }, [search]);

  const { data, isLoading, isError } = useQuery<PortalData>({
    queryKey: ['portal', token, debounced, sessionToken],
    queryFn: async () => {
      const url = `/api/portal/${token}${debounced ? `?search=${encodeURIComponent(debounced)}` : ''}`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${sessionToken}` } });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        if (res.status === 401) { onAuthError(); throw new Error('Session expired'); }
        throw new Error(b?.error?.message || `${res.status}`);
      }
      return res.json();
    },
    enabled: !!token && !!sessionToken,
    retry: false,
    staleTime: 60_000,
  });

  const stats = useMemo(() => {
    if (!data) return null;
    const o = data.orders;
    return {
      total:      o.length,
      production: o.filter((x) => x.status === 'IN_PRODUCTION').length,
      dispatched: o.filter((x) => x.status === 'PARTIAL_DISPATCH' || x.status === 'COMPLETED').length,
      items:      o.reduce((s, x) => s + x.items.length, 0),
    };
  }, [data]);

  const latestOrder  = data?.orders[0] ?? null;
  const remainOrders = data?.orders.slice(1) ?? [];
  const showingAll   = showAll || !!debounced;

  if (isLoading) return (
    <div className="relative min-h-screen flex items-center justify-center">
      <PortalBackdrop />
      <div className="space-y-3 text-center">
        <div className="relative mx-auto h-12 w-12">
          <div className="absolute inset-0 rounded-full bg-emerald-400/30 blur-xl" />
          <Loader2 className="relative mx-auto h-12 w-12 animate-spin text-emerald-600" />
        </div>
        <p className="text-sm font-medium text-slate-500">Loading your orders…</p>
      </div>
    </div>
  );

  if (isError || !data) return <PortalError />;

  const { company, customer, orders } = data;

  return (
    <div className="relative min-h-screen">
      <PortalBackdrop />

      {/* ── Header ── */}
      <header className="sticky top-0 z-30 border-b border-white/50 bg-white/60 backdrop-blur-xl">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-3">
          {company.logoUrl
            ? <img src={company.logoUrl} alt={company.name} className="h-9 w-9 shrink-0 rounded-xl object-contain ring-1 ring-white/60" />
            : <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500 to-teal-500 text-white shadow-md"><Building2 className="h-4 w-4" /></div>}
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-bold leading-tight text-slate-900">{company.name}</div>
            {company.gstNumber && <div className="font-mono text-[10px] text-slate-400">GSTIN: {company.gstNumber}</div>}
          </div>
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-gradient-to-r from-emerald-500/10 to-teal-500/10 px-2.5 py-1 text-[11px] font-semibold text-emerald-700 ring-1 ring-emerald-200">
            <Sparkles className="h-3 w-3" /> Customer Portal
          </span>
        </div>
      </header>

      <main className="mx-auto max-w-3xl space-y-5 px-4 py-6">

        {/* ── Customer welcome card ── */}
        <div className={`mf-up overflow-hidden ${GLASS}`}>
          <div className="relative overflow-hidden bg-gradient-to-br from-emerald-600 via-emerald-500 to-teal-500 px-5 py-6">
            <span className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/20 to-transparent" />
            <div className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-white/10 blur-2xl" />
            <p className="relative text-[11px] font-semibold uppercase tracking-[0.2em] text-emerald-50/90">Welcome</p>
            <h1 className="relative mt-1 text-2xl font-black leading-tight text-white drop-shadow-sm sm:text-3xl">{customer.name}</h1>
            <div className="relative mt-3 flex flex-wrap gap-2">
              <span className="inline-flex items-center gap-1 rounded-full bg-white/20 px-2.5 py-0.5 font-mono text-[11px] font-semibold text-white ring-1 ring-white/30 backdrop-blur">
                {customer.customerCode}
              </span>
              {customer.state && (
                <span className="inline-flex items-center gap-1 rounded-full bg-white/20 px-2.5 py-0.5 text-[11px] font-medium text-white ring-1 ring-white/30 backdrop-blur">
                  <MapPin className="h-2.5 w-2.5" />{customer.state}
                </span>
              )}
            </div>
          </div>
          {(company.phone || company.email || company.address) && (
            <div className="p-4 sm:p-5" style={{ fontFamily: 'Montserrat, sans-serif' }}>
              <p className="mb-2 text-[9px] font-semibold uppercase tracking-[0.12em] text-slate-400">Supplied by</p>
              <p className="mb-2.5 text-[12px] font-semibold leading-tight text-emerald-700">{company.name}</p>
              <div className="space-y-1.5">
                {company.phone && <div className="flex items-center gap-2"><Phone className="h-3 w-3 shrink-0 text-slate-400" /><span className="text-[11px] font-medium text-slate-600">{company.phone}</span></div>}
                {company.email && <div className="flex items-center gap-2"><Mail className="h-3 w-3 shrink-0 text-slate-400" /><span className="break-all text-[11px] font-medium text-slate-600">{company.email}</span></div>}
                {company.address && <div className="flex items-start gap-2"><MapPin className="mt-0.5 h-3 w-3 shrink-0 text-slate-400" /><span className="text-[11px] leading-relaxed text-slate-500">{company.address.replace(/\n/g, ', ')}</span></div>}
              </div>
            </div>
          )}
        </div>

        {/* ── Stats ── */}
        {stats && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatChip icon={Package}      label="Total Orders"  value={stats.total}      grad="from-slate-500 to-slate-600"   delay={60} />
            <StatChip icon={Factory}      label="In Production" value={stats.production} grad="from-amber-400 to-orange-500"  delay={120} />
            <StatChip icon={CheckCircle2} label="Dispatched"    value={stats.dispatched} grad="from-emerald-500 to-teal-500"  delay={180} />
            <StatChip icon={ShieldCheck}  label="PO Items"      value={stats.items}      grad="from-sky-400 to-cyan-500"      delay={240} />
          </div>
        )}

        {/* ── Search ── */}
        <div className="mf-up relative" style={{ animationDelay: '120ms' }}>
          <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            className="w-full rounded-2xl bg-white/70 py-3 pl-11 pr-4 text-sm ring-1 ring-white/60 backdrop-blur-xl placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-400"
            placeholder="Search by PO number…"
            value={search}
            onChange={(e) => { setSearch(e.target.value); if (e.target.value) setShowAll(true); }}
          />
        </div>

        {/* ── Orders ── */}
        {orders.length === 0 ? (
          <div className={`mf-up py-16 text-center ${GLASS}`}>
            <Package className="mx-auto mb-3 h-10 w-10 text-slate-300" />
            <p className="font-semibold text-slate-400">{debounced ? `No orders matching "${debounced}"` : 'No orders yet.'}</p>
          </div>
        ) : showingAll ? (
          <div className="space-y-3">
            {debounced
              ? <p className="text-[12px] text-slate-500">{orders.length} result{orders.length !== 1 ? 's' : ''}</p>
              : <button onClick={() => setShowAll(false)} className="flex items-center gap-1 text-[12px] font-medium text-emerald-700 hover:text-emerald-800">← Back to latest order</button>}
            <div className="grid gap-4 sm:grid-cols-2">
              {orders.map((order, i) => (
                <OrderCard key={order.id} order={order} token={token} dlToken={sessionToken} delay={i * 60} />
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {latestOrder && (
              <>
                <div className="flex items-center justify-between">
                  <h2 className="text-[13px] font-bold uppercase tracking-wide text-slate-700">Latest Order</h2>
                  {remainOrders.length > 0 && (
                    <button onClick={() => setShowAll(true)}
                      className="flex items-center gap-1 rounded-xl bg-white/70 px-3 py-1.5 text-[12px] font-semibold text-slate-700 ring-1 ring-white/60 backdrop-blur transition-all hover:-translate-y-0.5 hover:text-emerald-700">
                      <LayoutGrid className="h-3.5 w-3.5 text-slate-500" />
                      View all {orders.length} orders
                      <ArrowRight className="h-3 w-3 text-slate-400" />
                    </button>
                  )}
                </div>
                <OrderCard order={latestOrder} token={token} dlToken={sessionToken} featured />
              </>
            )}

            {remainOrders.length > 0 && !showingAll && (
              <div>
                <h2 className="mb-3 text-[13px] font-bold uppercase tracking-wide text-slate-700">Previous Orders</h2>
                <div className={`mf-up overflow-hidden ${GLASS}`} style={{ animationDelay: '120ms' }}>
                  <div className="divide-y divide-white/60">
                    {remainOrders.slice(0, 4).map((order) => {
                      const meta = STATUS[order.status] ?? STATUS.PENDING;
                      const dsp = pct(order.totalDispatched, order.totalOrdered);
                      const prd = pct(order.totalProduced, order.totalOrdered);
                      return (
                        <div key={order.id} className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-white/50">
                          <div className={`h-2 w-2 shrink-0 rounded-full ${meta.dot}`} />
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="truncate text-sm font-semibold text-slate-900">{order.poNumber}</span>
                              <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ${meta.chip}`}>{meta.label}</span>
                            </div>
                            <div className="mt-1 h-1.5 w-32 overflow-hidden rounded-full bg-slate-200/70">
                              <div className="h-full rounded-full bg-gradient-to-r from-amber-400 to-orange-400" style={{ width: `${prd}%` }} />
                              <div className="-mt-1.5 h-full rounded-full bg-gradient-to-r from-emerald-500 to-teal-400" style={{ width: `${dsp}%` }} />
                            </div>
                          </div>
                          <div className="shrink-0 text-right">
                            <div className="text-[11px] font-semibold tabular-nums text-slate-700">{fmt(order.totalOrdered)} pcs</div>
                            <div className="text-[10px] text-slate-400">{fmtDate(order.orderDate)}</div>
                          </div>
                        </div>
                      );
                    })}
                    {remainOrders.length > 4 && (
                      <button onClick={() => setShowAll(true)}
                        className="flex w-full items-center justify-center gap-1 py-2.5 text-[12px] font-semibold text-emerald-700 transition-colors hover:bg-emerald-50/60">
                        +{remainOrders.length - 4} more orders <ArrowRight className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        <div className="pb-4 pt-2 text-center text-[11px] text-slate-400">{company.name} · Powered by Metflux</div>
      </main>
    </div>
  );
};

/* ── Shared auth-screen scaffolding ─────────────────────────── */
type PortalInfo = {
  company: { name: string; logoUrl: string | null };
  customerName: string;
  needsPassword: boolean;
};

const PortalError = () => (
  <div className="relative flex min-h-screen items-center justify-center p-4">
    <PortalBackdrop />
    <div className={`mf-pop w-full max-w-sm space-y-4 p-8 text-center ${GLASS}`}>
      <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-red-50 ring-1 ring-red-100"><AlertCircle className="h-8 w-8 text-red-400" /></div>
      <h1 className="text-xl font-bold text-slate-900">Portal not found</h1>
      <p className="text-sm text-slate-500">This link may be invalid. Please contact the company for a new link.</p>
    </div>
  </div>
);

const AuthShell = ({ company, children }: { company?: { name: string; logoUrl: string | null }; children: React.ReactNode }) => (
  <div className="relative flex min-h-screen flex-col items-center justify-center p-4">
    <PortalBackdrop />
    <div className="mf-pop w-full max-w-sm">
      <div className="mb-6 flex flex-col items-center text-center">
        {company?.logoUrl
          ? <img src={company.logoUrl} alt={company.name} className="mb-3 h-14 w-14 rounded-2xl object-contain ring-1 ring-white/60 shadow-lg" />
          : <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-500 text-white shadow-lg shadow-emerald-500/30"><Building2 className="h-7 w-7" /></div>}
        {company?.name && <div className="font-bold text-slate-900">{company.name}</div>}
        <div className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-widest text-emerald-600"><Sparkles className="h-3 w-3" /> Customer Portal</div>
      </div>
      <div className={`overflow-hidden ${GLASS}`}>
        <div className="h-1.5 bg-gradient-to-r from-emerald-500 via-teal-400 to-sky-400" />
        <div className="p-6">{children}</div>
      </div>
      <div className="pt-4 text-center text-[11px] text-slate-400">Powered by Metflux</div>
    </div>
  </div>
);

/* Password input with a show/hide toggle. */
const PasswordField = ({ value, onChange, placeholder, autoFocus }: {
  value: string; onChange: (v: string) => void; placeholder?: string; autoFocus?: boolean;
}) => {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
      <input
        type={show ? 'text' : 'password'}
        className="w-full rounded-xl bg-white/80 py-2.5 pl-10 pr-10 text-sm ring-1 ring-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-400"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoFocus={autoFocus}
      />
      <button type="button" onClick={() => setShow((s) => !s)} tabIndex={-1}
        className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-slate-400 hover:text-slate-600"
        aria-label={show ? 'Hide password' : 'Show password'}>
        {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
};

/* ── Login screen ───────────────────────────────────────────── */
const LoginScreen = ({ token, onLoggedIn }: { token: string; onLoggedIn: (sessionToken: string) => void }) => {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const info = useQuery<PortalInfo>({
    queryKey: ['portal-info', token],
    queryFn: async () => {
      const res = await fetch(`/api/portal/${token}/info`);
      if (!res.ok) throw new Error('not found');
      return res.json();
    },
    retry: false,
    staleTime: 5 * 60_000,
  });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/portal/${token}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const b = await res.json().catch(() => ({}));
      if (!res.ok) { setError(b?.error?.message || 'Sign in failed'); return; }
      onLoggedIn(b.token);
    } catch {
      setError('Network error — please try again.');
    } finally {
      setBusy(false);
    }
  };

  if (info.isError) return <PortalError />;

  return (
    <AuthShell company={info.data?.company}>
      <h1 className="text-lg font-bold text-slate-900">
        {info.data ? `Welcome${info.data.customerName ? `, ${info.data.customerName}` : ''}` : 'Sign in'}
      </h1>
      <p className="mt-1 mb-5 text-[13px] text-slate-500">Enter the password your supplier shared with you to track your orders.</p>
      <form onSubmit={submit} className="space-y-3">
        <PasswordField value={password} onChange={setPassword} placeholder="Password" autoFocus />
        {error && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-700">{error}</div>}
        <button type="submit" disabled={busy || !password}
          className="relative w-full overflow-hidden inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-500 py-2.5 text-sm font-semibold text-white shadow-lg shadow-emerald-500/30 transition-all hover:-translate-y-0.5 hover:shadow-emerald-500/50 disabled:translate-y-0 disabled:opacity-50">
          <span className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/30 to-transparent" />
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
          Sign in
        </button>
      </form>
    </AuthShell>
  );
};

/* ── Page wrapper — routes between login and the orders view ──── */
export const CustomerPortalPage = () => {
  const { token } = useParams<{ token: string }>();
  const storageKey = token ? `mf_portal_${token}` : '';
  const [sessionToken, setSessionToken] = useState<string | null>(
    () => (token ? localStorage.getItem(`mf_portal_${token}`) : null)
  );

  const persist = useCallback((tok: string) => {
    if (storageKey) localStorage.setItem(storageKey, tok);
    setSessionToken(tok);
  }, [storageKey]);

  const clear = useCallback(() => {
    if (storageKey) localStorage.removeItem(storageKey);
    setSessionToken(null);
  }, [storageKey]);

  if (!token) return <PortalError />;
  if (!sessionToken) return <LoginScreen token={token} onLoggedIn={persist} />;
  return <PortalDataView token={token} sessionToken={sessionToken} onAuthError={clear} />;
};
