// Public customer portal — no login required.
// Accessible at /portal/:token (mapped to /s/admin/portal/:token in production).
// Shows the customer's PO orders with production & dispatch progress, and lets
// them download the testing report for any dispatched order as Excel.
import { useState, useEffect, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Search, Package, Factory, Truck, CheckCircle2, Clock,
  Download, AlertCircle, Loader2, ChevronDown, ChevronUp,
  FileSpreadsheet, MapPin, Phone, Mail, ShieldCheck, Building2,
} from 'lucide-react';

/* ── Types ──────────────────────────────────────────────────── */
type OrderItem = {
  id: string;
  coreType: 'TOROIDAL' | 'RECTANGULAR';
  grade: string;
  material: string;
  measure: string;
  orderedPcs: number;
  producedPcs: number;
  dispatchedPcs: number;
};
type Order = {
  id: string;
  poNumber: string;
  orderDate: string;
  deliveryDate: string | null;
  totalOrdered: number;
  totalProduced: number;
  totalDispatched: number;
  hasDispatch: boolean;
  status: 'PENDING' | 'IN_PRODUCTION' | 'READY_TO_DISPATCH' | 'PARTIAL_DISPATCH' | 'COMPLETED';
  items: OrderItem[];
};
type PortalData = {
  company: {
    name: string; logoUrl: string | null; address: string | null;
    phone: string | null; email: string | null; gstNumber: string | null;
  };
  customer: { name: string; customerCode: string; state: string | null };
  orders: Order[];
};

/* ── Status config ──────────────────────────────────────────── */
const STATUS_META = {
  PENDING:            { label: 'Pending',               color: 'bg-slate-100 text-slate-600',   dot: 'bg-slate-400',   border: 'border-l-slate-300'   },
  IN_PRODUCTION:      { label: 'In Production',         color: 'bg-amber-50 text-amber-700',    dot: 'bg-amber-500',   border: 'border-l-amber-400'   },
  READY_TO_DISPATCH:  { label: 'Ready to Dispatch',     color: 'bg-blue-50 text-blue-700',      dot: 'bg-blue-500',    border: 'border-l-blue-400'    },
  PARTIAL_DISPATCH:   { label: 'Partially Dispatched',  color: 'bg-indigo-50 text-indigo-700',  dot: 'bg-indigo-500',  border: 'border-l-indigo-400'  },
  COMPLETED:          { label: 'Completed',             color: 'bg-emerald-50 text-emerald-700',dot: 'bg-emerald-500', border: 'border-l-emerald-500' },
};

/* ── Helpers ────────────────────────────────────────────────── */
const fmtDate = (iso: string | null | undefined) => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
};
const pct = (part: number, total: number) =>
  total > 0 ? Math.min(Math.round((part / total) * 100), 100) : 0;
const fmt = (n: number) => n.toLocaleString('en-IN');

/* ── Progress bar ───────────────────────────────────────────── */
const ProgressBar = ({ ordered, produced, dispatched }: { ordered: number; produced: number; dispatchedPcs?: number; dispatched: number }) => {
  const producedPct  = pct(produced,   ordered);
  const dispatchedPct = pct(dispatched, ordered);
  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <div className="flex justify-between text-[11px] font-medium text-slate-500 uppercase tracking-wide">
          <span className="flex items-center gap-1.5">
            <Package className="h-3 w-3" /> Ordered
          </span>
          <span className="font-semibold text-slate-700 tabular-nums">{fmt(ordered)} pcs</span>
        </div>
        <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
          <div className="h-full rounded-full bg-slate-300" style={{ width: '100%' }} />
        </div>
      </div>

      <div className="space-y-1.5">
        <div className="flex justify-between text-[11px] font-medium text-slate-500 uppercase tracking-wide">
          <span className="flex items-center gap-1.5">
            <Factory className="h-3 w-3 text-amber-500" /> Produced
          </span>
          <span className="font-semibold text-amber-700 tabular-nums">
            {fmt(produced)} pcs
            <span className="ml-1 text-[10px] font-normal text-slate-400">({producedPct}%)</span>
          </span>
        </div>
        <div className="h-2 rounded-full bg-amber-100 overflow-hidden">
          <div
            className="h-full rounded-full bg-amber-400 transition-all duration-700"
            style={{ width: `${producedPct}%` }}
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <div className="flex justify-between text-[11px] font-medium text-slate-500 uppercase tracking-wide">
          <span className="flex items-center gap-1.5">
            <Truck className="h-3 w-3 text-emerald-500" /> Dispatched
          </span>
          <span className="font-semibold text-emerald-700 tabular-nums">
            {fmt(dispatched)} pcs
            <span className="ml-1 text-[10px] font-normal text-slate-400">({dispatchedPct}%)</span>
          </span>
        </div>
        <div className="h-2 rounded-full bg-emerald-100 overflow-hidden">
          <div
            className="h-full rounded-full bg-emerald-500 transition-all duration-700"
            style={{ width: `${dispatchedPct}%` }}
          />
        </div>
      </div>
    </div>
  );
};

/* ── Stat card ──────────────────────────────────────────────── */
const StatCard = ({ icon: Icon, label, value, color }: {
  icon: typeof Package; label: string; value: number; color: string;
}) => (
  <div className="rounded-2xl bg-white border border-slate-200 shadow-sm p-4 flex items-center gap-3">
    <div className={`h-10 w-10 rounded-xl flex items-center justify-center shrink-0 ${color}`}>
      <Icon className="h-5 w-5" />
    </div>
    <div className="min-w-0">
      <div className="text-2xl font-black text-slate-900 tabular-nums">{value}</div>
      <div className="text-[11px] font-medium text-slate-500 uppercase tracking-wide leading-tight">{label}</div>
    </div>
  </div>
);

/* ── Order card ──────────────────────────────────────────────── */
const OrderCard = ({ order, token }: { order: Order; token: string }) => {
  const [expanded, setExpanded] = useState(false);
  const meta = STATUS_META[order.status];

  return (
    <div className={`rounded-2xl bg-white border border-slate-200 shadow-sm overflow-hidden border-l-4 ${meta.border}`}>
      {/* Card header */}
      <div className="px-5 py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-black text-slate-900 text-base tracking-tight">{order.poNumber}</span>
              <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${meta.color}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
                {meta.label}
              </span>
            </div>
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-[12px] text-slate-500">
              <span className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                Order: {fmtDate(order.orderDate)}
              </span>
              {order.deliveryDate && (
                <span className="flex items-center gap-1">
                  <Truck className="h-3 w-3" />
                  Due: {fmtDate(order.deliveryDate)}
                </span>
              )}
            </div>
          </div>

          {/* Download Excel — only when testing data exists */}
          {order.hasDispatch && (
            <a
              href={`/api/portal/${token}/testing-excel/${order.id}`}
              download
              className="shrink-0 inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white text-[12px] font-semibold px-3 py-2 transition-colors shadow-sm shadow-emerald-600/20"
              title="Download Testing Report as Excel"
            >
              <FileSpreadsheet className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Testing Excel</span>
              <Download className="h-3 w-3" />
            </a>
          )}
        </div>

        {/* Progress bars */}
        <div className="mt-4">
          <ProgressBar
            ordered={order.totalOrdered}
            produced={order.totalProduced}
            dispatched={order.totalDispatched}
          />
        </div>

        {/* Items toggle */}
        {order.items.length > 0 && (
          <button
            onClick={() => setExpanded((v) => !v)}
            className="mt-4 flex items-center gap-1.5 text-[12px] font-medium text-brand-700 hover:text-brand-800 transition-colors"
          >
            {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            {order.items.length} item{order.items.length !== 1 ? 's' : ''}
          </button>
        )}
      </div>

      {/* Expanded items */}
      {expanded && (
        <div className="border-t border-slate-100 divide-y divide-slate-100">
          {order.items.map((it) => (
            <div key={it.id} className="px-5 py-3">
              <div className="flex flex-wrap items-center gap-2 mb-2">
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide
                  ${it.coreType === 'TOROIDAL' ? 'bg-amber-100 text-amber-700' : 'bg-rose-100 text-rose-700'}`}>
                  {it.coreType === 'TOROIDAL' ? 'Toroidal' : 'Rectangular'}
                </span>
                <span className="font-mono text-[12px] font-semibold text-slate-700">{it.measure}</span>
                <span className="text-[12px] text-slate-500">{it.grade} · {it.material}</span>
              </div>
              <div className="grid grid-cols-3 gap-2 text-center">
                {[
                  { label: 'Ordered', val: it.orderedPcs, cls: 'text-slate-700 bg-slate-50' },
                  { label: 'Produced', val: it.producedPcs, cls: 'text-amber-700 bg-amber-50' },
                  { label: 'Dispatched', val: it.dispatchedPcs, cls: 'text-emerald-700 bg-emerald-50' },
                ].map(({ label, val, cls }) => (
                  <div key={label} className={`rounded-xl px-2 py-2 ${cls}`}>
                    <div className="font-black text-sm tabular-nums">{fmt(val)}</div>
                    <div className="text-[10px] font-medium uppercase tracking-wide opacity-70">{label}</div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

/* ── Main page ──────────────────────────────────────────────── */
export const CustomerPortalPage = () => {
  const { token } = useParams<{ token: string }>();
  const [search, setSearch]         = useState('');
  const [debouncedSearch, setDebounced] = useState('');

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 350);
    return () => clearTimeout(t);
  }, [search]);

  const { data, isLoading, isError } = useQuery<PortalData>({
    queryKey: ['portal', token, debouncedSearch],
    queryFn: async () => {
      const url = `/api/portal/${token}${debouncedSearch ? `?search=${encodeURIComponent(debouncedSearch)}` : ''}`;
      const res = await fetch(url);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Error ${res.status}`);
      }
      return res.json();
    },
    enabled: !!token,
    retry: false,
    staleTime: 60_000,
  });

  const stats = useMemo(() => {
    if (!data) return null;
    return {
      total:      data.orders.length,
      production: data.orders.filter((o) => o.status === 'IN_PRODUCTION').length,
      ready:      data.orders.filter((o) => o.status === 'READY_TO_DISPATCH').length,
      dispatched: data.orders.filter((o) =>
        o.status === 'PARTIAL_DISPATCH' || o.status === 'COMPLETED'
      ).length,
    };
  }, [data]);

  /* ── Loading ── */
  if (isLoading) return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center">
      <div className="text-center space-y-3">
        <Loader2 className="h-8 w-8 animate-spin text-brand-600 mx-auto" />
        <p className="text-sm text-slate-500">Loading your orders…</p>
      </div>
    </div>
  );

  /* ── Error / not found ── */
  if (isError || !data) return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="max-w-sm w-full text-center space-y-4">
        <div className="h-16 w-16 rounded-full bg-red-100 flex items-center justify-center mx-auto">
          <AlertCircle className="h-8 w-8 text-red-500" />
        </div>
        <h1 className="text-xl font-bold text-slate-900">Portal not found</h1>
        <p className="text-sm text-slate-500">
          This link may have expired or is invalid. Please contact the company for a new link.
        </p>
      </div>
    </div>
  );

  const { company, customer, orders } = data;

  return (
    <div className="min-h-screen bg-slate-50">

      {/* ── Company header ── */}
      <header className="bg-white border-b border-slate-200 shadow-sm sticky top-0 z-30">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center gap-3">
          {company.logoUrl
            ? <img src={company.logoUrl} alt={company.name} className="h-9 w-9 object-contain rounded-lg shrink-0" />
            : <div className="h-9 w-9 rounded-lg bg-brand-600 flex items-center justify-center shrink-0">
                <Building2 className="h-5 w-5 text-white" />
              </div>
          }
          <div className="min-w-0 flex-1">
            <div className="font-bold text-slate-900 text-sm leading-tight truncate">{company.name}</div>
            {company.gstNumber && (
              <div className="text-[10px] text-slate-400 font-mono">GSTIN: {company.gstNumber}</div>
            )}
          </div>
          <span className="shrink-0 rounded-full bg-brand-50 border border-brand-200 px-2.5 py-1 text-[11px] font-semibold text-brand-700">
            Customer Portal
          </span>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-6 space-y-6">

        {/* ── Customer hero ── */}
        <div className="rounded-2xl bg-gradient-to-br from-brand-700 to-brand-900 text-white px-6 py-5 shadow-lg">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-widest text-brand-200 mb-1">
                Welcome
              </div>
              <h1 className="text-2xl font-black tracking-tight leading-tight">{customer.name}</h1>
              <div className="mt-1 flex flex-wrap gap-2 items-center">
                <span className="rounded-full bg-white/15 px-2.5 py-0.5 text-[11px] font-mono font-semibold">
                  {customer.customerCode}
                </span>
                {customer.state && (
                  <span className="flex items-center gap-1 text-[12px] text-brand-200">
                    <MapPin className="h-3 w-3" /> {customer.state}
                  </span>
                )}
              </div>
            </div>
            <div className="text-right space-y-1 text-[12px] text-brand-200">
              {company.phone && (
                <div className="flex items-center justify-end gap-1">
                  <Phone className="h-3 w-3" /> {company.phone}
                </div>
              )}
              {company.email && (
                <div className="flex items-center justify-end gap-1">
                  <Mail className="h-3 w-3" /> {company.email}
                </div>
              )}
              {company.address && (
                <div className="flex items-center justify-end gap-1 max-w-[200px] text-right">
                  <MapPin className="h-3 w-3 shrink-0" />
                  <span className="leading-snug">{company.address.replace(/\n/g, ', ')}</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── Stats ── */}
        {stats && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard icon={Package}       label="Total Orders"    value={stats.total}      color="bg-slate-100 text-slate-600" />
            <StatCard icon={Factory}       label="In Production"   value={stats.production} color="bg-amber-100 text-amber-600" />
            <StatCard icon={CheckCircle2}  label="Ready / Dispatched" value={stats.ready + stats.dispatched} color="bg-emerald-100 text-emerald-600" />
            <StatCard icon={ShieldCheck}   label="No. of PO Items" value={orders.reduce((s, o) => s + o.items.length, 0)} color="bg-brand-100 text-brand-700" />
          </div>
        )}

        {/* ── Search ── */}
        <div className="relative">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
          <input
            className="w-full rounded-2xl border border-slate-200 bg-white shadow-sm pl-11 pr-4 py-3 text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition"
            placeholder="Search by PO number…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {/* ── Orders ── */}
        {orders.length === 0 ? (
          <div className="rounded-2xl border-2 border-dashed border-slate-200 bg-white py-16 text-center">
            <Package className="h-10 w-10 text-slate-300 mx-auto mb-3" />
            <p className="font-semibold text-slate-500">
              {debouncedSearch ? 'No orders found for that PO number.' : 'No orders yet.'}
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="text-[12px] font-medium text-slate-500">
              {orders.length} order{orders.length !== 1 ? 's' : ''}
              {debouncedSearch && ` matching "${debouncedSearch}"`}
            </div>
            {orders.map((order) => (
              <OrderCard key={order.id} order={order} token={token!} />
            ))}
          </div>
        )}

        {/* Footer */}
        <div className="text-center text-[11px] text-slate-400 pb-4">
          {company.name} · Powered by Metflux
        </div>
      </main>
    </div>
  );
};
