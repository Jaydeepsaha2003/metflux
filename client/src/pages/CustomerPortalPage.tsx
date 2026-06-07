// Public customer portal — no login required.
// Light theme, latest PO featured by default, card grid for all orders.
import { useState, useEffect, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Search, Package, Factory, Truck, CheckCircle2, Clock,
  Download, AlertCircle, Loader2, ChevronDown, ChevronRight,
  FileSpreadsheet, MapPin, Phone, Mail, Building2,
  LayoutGrid, ArrowRight, ShieldCheck,
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
const STATUS: Record<string, { label: string; color: string; dot: string; bar: string; border: string }> = {
  PENDING:           { label: 'Pending',              color: 'bg-slate-100 text-slate-600',   dot: 'bg-slate-400',   bar: 'bg-slate-200',   border: 'border-l-slate-300'   },
  IN_PRODUCTION:     { label: 'In Production',        color: 'bg-amber-50 text-amber-700',    dot: 'bg-amber-400',   bar: 'bg-amber-400',   border: 'border-l-amber-400'   },
  READY_TO_DISPATCH: { label: 'Ready to Dispatch',    color: 'bg-sky-50 text-sky-700',        dot: 'bg-sky-500',     bar: 'bg-sky-400',     border: 'border-l-sky-400'     },
  PARTIAL_DISPATCH:  { label: 'Partially Dispatched', color: 'bg-violet-50 text-violet-700',  dot: 'bg-violet-500',  bar: 'bg-violet-400',  border: 'border-l-violet-400'  },
  COMPLETED:         { label: 'Completed',            color: 'bg-emerald-50 text-emerald-700',dot: 'bg-emerald-500', bar: 'bg-emerald-500', border: 'border-l-emerald-400' },
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

/* ── Order card ─────────────────────────────────────────────── */
const OrderCard = ({ order, token, featured }: { order: Order; token: string; featured?: boolean }) => {
  const [expanded, setExpanded] = useState(featured ?? false);
  const meta = STATUS[order.status] ?? STATUS.PENDING;
  const prdPct = pct(order.totalProduced,   order.totalOrdered);
  const dspPct = pct(order.totalDispatched, order.totalOrdered);

  return (
    <div className={`bg-white rounded-2xl border overflow-hidden transition-shadow
      ${featured
        ? 'border-emerald-200 shadow-md ring-1 ring-emerald-100'
        : 'border-slate-200 shadow-sm hover:shadow-md'
      } border-l-4 ${meta.border}`}
    >
      {/* Header */}
      <div className="px-5 pt-4 pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-black text-slate-900 text-[15px] tracking-tight">{order.poNumber}</span>
              <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${meta.color}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
                {meta.label}
              </span>
            </div>
            <div className="flex flex-wrap gap-3 mt-1 text-[11px] text-slate-400">
              <span className="flex items-center gap-1"><Clock className="h-3 w-3" />Order: {fmtDate(order.orderDate)}</span>
              {order.deliveryDate && (
                <span className="flex items-center gap-1"><Truck className="h-3 w-3" />Due: {fmtDate(order.deliveryDate)}</span>
              )}
            </div>
          </div>

          {order.hasDispatch && (
            <a href={`/api/portal/${token}/testing-excel/${order.id}`} download
              className="shrink-0 inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white text-[11px] font-semibold px-3 py-1.5 transition-colors shadow-sm">
              <FileSpreadsheet className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Test Report</span>
              <Download className="h-3 w-3" />
            </a>
          )}
        </div>

        {/* 3-stat boxes */}
        <div className="grid grid-cols-3 gap-2 mt-4">
          {[
            { icon: Package,  label: 'Ordered',    val: order.totalOrdered,    sub: 'pcs',         cls: 'bg-slate-50 text-slate-900',   sub_cls: 'text-slate-400'   },
            { icon: Factory,  label: 'Produced',   val: order.totalProduced,   sub: `${prdPct}%`,  cls: 'bg-amber-50 text-amber-800',   sub_cls: 'text-amber-400'   },
            { icon: Truck,    label: 'Dispatched', val: order.totalDispatched, sub: `${dspPct}%`,  cls: 'bg-emerald-50 text-emerald-800',sub_cls: 'text-emerald-400' },
          ].map(({ icon: Icon, label, val, sub, cls, sub_cls }) => (
            <div key={label} className={`rounded-xl p-3 text-center ${cls}`}>
              <div className="flex items-center justify-center gap-1 text-[10px] font-semibold uppercase tracking-wide opacity-60 mb-1">
                <Icon className="h-3 w-3" />{label}
              </div>
              <div className="font-black text-[15px] tabular-nums leading-tight">{fmt(val)}</div>
              <div className={`text-[10px] font-medium ${sub_cls}`}>{sub}</div>
            </div>
          ))}
        </div>

        {/* Progress bar */}
        <div className="mt-3 space-y-1">
          <div className="relative h-1.5 rounded-full bg-slate-100 overflow-hidden">
            <div className="absolute inset-y-0 left-0 bg-amber-400 rounded-full" style={{ width: `${prdPct}%` }} />
            <div className="absolute inset-y-0 left-0 bg-emerald-500 rounded-full" style={{ width: `${dspPct}%` }} />
          </div>
          <div className="flex justify-between text-[10px] text-slate-400">
            <span className="flex items-center gap-1">
              <span className="w-2 h-1 rounded-sm bg-amber-400 inline-block" />Produced {prdPct}%
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-1 rounded-sm bg-emerald-500 inline-block" />Dispatched {dspPct}%
            </span>
          </div>
        </div>

        {/* Items toggle */}
        {order.items.length > 0 && (
          <button onClick={() => setExpanded(v => !v)}
            className="mt-3 flex items-center gap-1 text-[12px] font-medium text-slate-500 hover:text-slate-700 transition-colors">
            {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            {order.items.length} line item{order.items.length !== 1 ? 's' : ''}
          </button>
        )}
      </div>

      {/* Items detail */}
      {expanded && (
        <div className="border-t border-slate-100 bg-slate-50/60 divide-y divide-slate-100">
          {order.items.map((it) => (
            <div key={it.id} className="px-5 py-3">
              <div className="flex flex-wrap items-center gap-2 mb-2">
                <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide
                  ${it.coreType === 'TOROIDAL' ? 'bg-amber-100 text-amber-700' : 'bg-rose-100 text-rose-700'}`}>
                  {it.coreType === 'TOROIDAL' ? 'TC' : 'RC'}
                </span>
                <span className="font-mono text-[12px] font-semibold text-slate-800">{it.measure}</span>
                <span className="text-[11px] text-slate-500">{it.grade} · {it.material}</span>
              </div>
              <div className="grid grid-cols-3 gap-2 text-center text-[11px]">
                <div className="bg-white rounded-lg py-1.5 border border-slate-100">
                  <div className="font-bold text-slate-900 tabular-nums">{fmt(it.orderedPcs)}</div>
                  <div className="text-slate-400">ordered</div>
                </div>
                <div className="bg-amber-50 rounded-lg py-1.5 border border-amber-100">
                  <div className="font-bold text-amber-800 tabular-nums">{fmt(it.producedPcs)}</div>
                  <div className="text-amber-500">produced</div>
                </div>
                <div className="bg-emerald-50 rounded-lg py-1.5 border border-emerald-100">
                  <div className="font-bold text-emerald-800 tabular-nums">{fmt(it.dispatchedPcs)}</div>
                  <div className="text-emerald-500">dispatched</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

/* ── Stat chip ──────────────────────────────────────────────── */
const StatChip = ({ icon: Icon, label, value, color }: {
  icon: typeof Package; label: string; value: number; color: string;
}) => (
  <div className="flex items-center gap-3 bg-white rounded-2xl border border-slate-200 shadow-sm px-4 py-3 min-w-[130px]">
    <div className={`h-9 w-9 rounded-xl flex items-center justify-center shrink-0 ${color}`}>
      <Icon className="h-4.5 w-4.5" />
    </div>
    <div>
      <div className="text-xl font-black text-slate-900 tabular-nums leading-tight">{value}</div>
      <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 leading-tight">{label}</div>
    </div>
  </div>
);

/* ── Main page ──────────────────────────────────────────────── */
export const CustomerPortalPage = () => {
  const { token } = useParams<{ token: string }>();
  const [search, setSearch]           = useState('');
  const [debounced, setDebounced]     = useState('');
  const [showAll, setShowAll]         = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 350);
    return () => clearTimeout(t);
  }, [search]);

  const { data, isLoading, isError } = useQuery<PortalData>({
    queryKey: ['portal', token, debounced],
    queryFn: async () => {
      const url = `/api/portal/${token}${debounced ? `?search=${encodeURIComponent(debounced)}` : ''}`;
      const res = await fetch(url);
      if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error(b.error || `${res.status}`); }
      return res.json();
    },
    enabled: !!token,
    retry: false,
    staleTime: 60_000,
  });

  const stats = useMemo(() => {
    if (!data) return null;
    const o = data.orders;
    return {
      total:       o.length,
      production:  o.filter(x => x.status === 'IN_PRODUCTION').length,
      dispatched:  o.filter(x => x.status === 'PARTIAL_DISPATCH' || x.status === 'COMPLETED').length,
      items:       o.reduce((s, x) => s + x.items.length, 0),
    };
  }, [data]);

  // When search is active, show all results. Otherwise show latest by default.
  const latestOrder  = data?.orders[0] ?? null;
  const remainOrders = data?.orders.slice(1) ?? [];
  const showingAll   = showAll || !!debounced;

  /* Loading */
  if (isLoading) return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center">
      <div className="text-center space-y-3">
        <Loader2 className="h-8 w-8 animate-spin text-emerald-600 mx-auto" />
        <p className="text-sm text-slate-500 font-medium">Loading your orders…</p>
      </div>
    </div>
  );

  /* Not found */
  if (isError || !data) return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="max-w-sm w-full text-center space-y-4">
        <div className="h-16 w-16 rounded-2xl bg-red-50 border border-red-100 flex items-center justify-center mx-auto">
          <AlertCircle className="h-8 w-8 text-red-400" />
        </div>
        <h1 className="text-xl font-bold text-slate-900">Portal not found</h1>
        <p className="text-sm text-slate-500">This link may be invalid. Please contact the company for a new link.</p>
      </div>
    </div>
  );

  const { company, customer, orders } = data;

  return (
    <div className="min-h-screen bg-slate-50">

      {/* ── Header ── */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-30 shadow-sm">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center gap-3">
          {company.logoUrl
            ? <img src={company.logoUrl} alt={company.name} className="h-8 w-8 object-contain rounded-lg shrink-0" />
            : <div className="h-8 w-8 rounded-lg bg-emerald-600 flex items-center justify-center shrink-0 text-white">
                <Building2 className="h-4 w-4" />
              </div>
          }
          <div className="min-w-0 flex-1">
            <div className="font-bold text-slate-900 text-sm leading-tight truncate">{company.name}</div>
            {company.gstNumber && (
              <div className="text-[10px] text-slate-400 font-mono">GSTIN: {company.gstNumber}</div>
            )}
          </div>
          <span className="shrink-0 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700">
            Customer Portal
          </span>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-6 space-y-5">

        {/* ── Customer card ── */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="h-1.5 bg-gradient-to-r from-emerald-500 to-teal-400" />
          <div className="p-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-widest text-emerald-600 mb-1">Welcome</p>
                <h1 className="text-2xl font-black text-slate-900 leading-tight">{customer.name}</h1>
                <div className="flex flex-wrap gap-2 mt-2">
                  <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 border border-slate-200 px-2.5 py-0.5 text-[11px] font-mono font-semibold text-slate-700">
                    {customer.customerCode}
                  </span>
                  {customer.state && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 border border-slate-200 px-2.5 py-0.5 text-[11px] font-medium text-slate-600">
                      <MapPin className="h-2.5 w-2.5 text-slate-400" />{customer.state}
                    </span>
                  )}
                </div>
              </div>
              <div className="text-right space-y-1">
                {company.phone && (
                  <div className="flex items-center justify-end gap-1.5 text-[12px] text-slate-500">
                    <Phone className="h-3 w-3 text-slate-400" />{company.phone}
                  </div>
                )}
                {company.email && (
                  <div className="flex items-center justify-end gap-1.5 text-[12px] text-slate-500">
                    <Mail className="h-3 w-3 text-slate-400" />{company.email}
                  </div>
                )}
                {company.address && (
                  <div className="flex items-center justify-end gap-1.5 text-[12px] text-slate-500 max-w-[200px] text-right">
                    <MapPin className="h-3 w-3 text-slate-400 shrink-0" />
                    <span className="leading-snug">{company.address.replace(/\n/g, ', ')}</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* ── Stats row ── */}
        {stats && (
          <div className="flex gap-3 overflow-x-auto pb-1 -mx-1 px-1 scrollbar-hide">
            <StatChip icon={Package}      label="Total Orders"  value={stats.total}      color="bg-slate-100 text-slate-600" />
            <StatChip icon={Factory}      label="In Production" value={stats.production} color="bg-amber-100 text-amber-600" />
            <StatChip icon={CheckCircle2} label="Dispatched"    value={stats.dispatched} color="bg-emerald-100 text-emerald-600" />
            <StatChip icon={ShieldCheck}  label="PO Items"      value={stats.items}      color="bg-sky-100 text-sky-600" />
          </div>
        )}

        {/* ── Search ── */}
        <div className="relative">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
          <input
            className="w-full bg-white rounded-2xl border border-slate-200 shadow-sm pl-11 pr-4 py-3 text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:border-transparent transition"
            placeholder="Search by PO number…"
            value={search}
            onChange={(e) => { setSearch(e.target.value); if (e.target.value) setShowAll(true); }}
          />
        </div>

        {/* ── Orders ── */}
        {orders.length === 0 ? (
          <div className="rounded-2xl border-2 border-dashed border-slate-200 bg-white py-16 text-center">
            <Package className="h-10 w-10 text-slate-200 mx-auto mb-3" />
            <p className="font-semibold text-slate-400">
              {debounced ? `No orders matching "${debounced}"` : 'No orders yet.'}
            </p>
          </div>
        ) : showingAll ? (
          /* ── All orders grid ── */
          <div className="space-y-3">
            {debounced && (
              <p className="text-[12px] text-slate-500">{orders.length} result{orders.length !== 1 ? 's' : ''}</p>
            )}
            {!debounced && (
              <button onClick={() => { setShowAll(false); }} className="text-[12px] text-emerald-700 font-medium hover:text-emerald-800 flex items-center gap-1">
                ← Back to latest order
              </button>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              {orders.map((order) => (
                <OrderCard key={order.id} order={order} token={token!} />
              ))}
            </div>
          </div>
        ) : (
          /* ── Default: latest order featured ── */
          <div className="space-y-4">
            {latestOrder && (
              <>
                <div className="flex items-center justify-between">
                  <h2 className="text-[13px] font-bold text-slate-700 uppercase tracking-wide">Latest Order</h2>
                  {remainOrders.length > 0 && (
                    <button onClick={() => setShowAll(true)}
                      className="flex items-center gap-1 rounded-xl bg-white border border-slate-200 shadow-sm px-3 py-1.5 text-[12px] font-semibold text-slate-700 hover:bg-slate-50 transition-colors">
                      <LayoutGrid className="h-3.5 w-3.5 text-slate-500" />
                      View all {orders.length} orders
                      <ArrowRight className="h-3 w-3 text-slate-400" />
                    </button>
                  )}
                </div>
                <OrderCard order={latestOrder} token={token!} featured />
              </>
            )}

            {/* Previous orders compact list */}
            {remainOrders.length > 0 && !showingAll && (
              <div>
                <h2 className="text-[13px] font-bold text-slate-700 uppercase tracking-wide mb-3">Previous Orders</h2>
                <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden divide-y divide-slate-100">
                  {remainOrders.slice(0, 4).map((order) => {
                    const meta = STATUS[order.status] ?? STATUS.PENDING;
                    const dsp = pct(order.totalDispatched, order.totalOrdered);
                    const prd = pct(order.totalProduced, order.totalOrdered);
                    return (
                      <div key={order.id} className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50/70 transition-colors">
                        <div className={`h-2 w-2 rounded-full shrink-0 ${meta.dot}`} />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-semibold text-sm text-slate-900 truncate">{order.poNumber}</span>
                            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${meta.color}`}>{meta.label}</span>
                          </div>
                          <div className="mt-1 h-1 rounded-full bg-slate-100 overflow-hidden w-32">
                            <div className="h-full rounded-full bg-amber-400" style={{ width: `${prd}%` }} />
                            <div className="h-full rounded-full bg-emerald-500 -mt-1" style={{ width: `${dsp}%` }} />
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <div className="text-[11px] font-semibold text-slate-700 tabular-nums">{fmt(order.totalOrdered)} pcs</div>
                          <div className="text-[10px] text-slate-400">{fmtDate(order.orderDate)}</div>
                        </div>
                      </div>
                    );
                  })}
                  {remainOrders.length > 4 && (
                    <button onClick={() => setShowAll(true)}
                      className="w-full py-2.5 text-[12px] font-semibold text-emerald-700 hover:bg-emerald-50 transition-colors flex items-center justify-center gap-1">
                      +{remainOrders.length - 4} more orders <ArrowRight className="h-3 w-3" />
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Footer */}
        <div className="text-center text-[11px] text-slate-300 pb-4 pt-2">
          {company.name} · Powered by Metflux
        </div>
      </main>
    </div>
  );
};
