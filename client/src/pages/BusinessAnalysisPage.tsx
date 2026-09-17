// Business Analysis — a single deep-dive page on overall business health:
// revenue & collections, receivables aging, GST, the order→produce→dispatch
// funnel, customer & state concentration, core-type mix, returns, and a
// 12-month trend. Charts are hand-rolled SVG (no chart dependency).
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  BarChart3, Loader2, TrendingUp, Wallet, AlertTriangle, ReceiptText,
  Package, Factory, Truck, Clock, Users, RotateCcw, IndianRupee,
} from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import '@/components/dashboard/glass.css';
import './business-analysis.css';
import { dashVars } from '@/components/dashboard/theme';

/* ── Types (mirror /api/dashboard/analysis) ─────────────────── */
type Analysis = {
  range: { from: string; to: string };
  headline: {
    invoiced: number; received: number; outstanding: number; overdue: number;
    gst: number; taxable: number; invoiceCount: number; paymentCount: number;
    openInvoices: number; customers: number; avgInvoice: number; collectionRate: number;
  };
  aging: { notDue: number; d1_30: number; d31_60: number; d61_90: number; d90: number; noTerms: number; total: number };
  trend: { month: string; invoiced: number; received: number; produced: number }[];
  fulfillment: { ordered: number; produced: number; dispatched: number; pending: number };
  topCustomers: { id: string; name: string; code: string | null; invoiced: number; outstanding: number; share: number }[];
  byState: { state: string; amount: number; count: number; share: number }[];
  coreSplit: { toroidal: number; rectangular: number };
  gst: { taxable: number; igst: number; cgst: number; sgst: number; total: number;
    input?: { taxable: number; igst: number; cgst: number; sgst: number; total: number } };
  returns: { open: number; total: number; byStatus: { status: string; count: number }[] };
  salesAdjustments: { grossSales: number; creditValue: number; creditCount: number; invoiceCount: number; netSales: number };
  rejections: { coreType: string; warehouse: string; records: number; pcs: number; weight: number }[];
};

/* ── Formatters ─────────────────────────────────────────────── */
const inr = (n: number) => '₹' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });
// Compact Indian currency: ₹1.24 Cr / ₹3.40 L / ₹8,775
const cr = (n: number) => {
  const v = Number(n || 0);
  if (Math.abs(v) >= 1e7) return `₹${(v / 1e7).toFixed(2)} Cr`;
  if (Math.abs(v) >= 1e5) return `₹${(v / 1e5).toFixed(2)} L`;
  return '₹' + v.toLocaleString('en-IN', { maximumFractionDigits: 0 });
};
const nf = (n: number) => Number(n || 0).toLocaleString('en-IN');
const monthLabel = (m: string) => {
  const [y, mo] = m.split('-').map(Number);
  const d = new Date(y, mo - 1, 1);
  const lbl = d.toLocaleDateString('en-GB', { month: 'short' });
  return mo === 1 ? `${lbl} '${String(y).slice(2)}` : lbl;
};

type Preset = 'MONTH' | 'FY' | 'YEAR' | 'CUSTOM';
const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const isoOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const rangeFor = (p: Preset) => {
  const now = new Date();
  if (p === 'MONTH') return { from: isoOf(new Date(now.getFullYear(), now.getMonth(), 1)), to: todayISO() };
  if (p === 'FY') {
    const fyStartYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1; // Apr=3
    return { from: isoOf(new Date(fyStartYear, 3, 1)), to: todayISO() };
  }
  return { from: isoOf(new Date(now.getFullYear(), now.getMonth() - 11, 1)), to: todayISO() };
};

/* ── Page ───────────────────────────────────────────────────── */
export const BusinessAnalysisPage = () => {
  const [preset, setPreset] = useState<Preset>('YEAR');
  const [customFrom, setCustomFrom] = useState<string>(() => rangeFor('YEAR').from);
  const [customTo, setCustomTo] = useState<string>(() => todayISO());
  const range = useMemo(
    () => (preset === 'CUSTOM' ? { from: customFrom, to: customTo } : rangeFor(preset)),
    [preset, customFrom, customTo]
  );

  const validRange = !!range.from && !!range.to && range.from <= range.to;
  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ['business-analysis', range.from, range.to],
    queryFn: () => api<Analysis>(`/dashboard/analysis?from=${range.from}&to=${range.to}`),
    staleTime: 60_000,
    enabled: validRange,
  });

  return (
    <div className="dashboard-glass analysis-glass -m-4 min-h-[calc(100vh-4rem)] p-4 text-[var(--d-text)] sm:-m-6 sm:p-6 lg:p-8" style={dashVars('light')}>
      <div className="analysis-shell space-y-5">
      <div className="analysis-hero dash-panel flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div>
        <p className="analysis-eyebrow">Business intelligence</p>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <BarChart3 className="h-5 w-5 text-brand-600" /> Business Analysis
        </h1>
        <p className="analysis-subtitle">Revenue, collections and operations in one clear view.</p>
        </div>
        <div className="analysis-controls">
          <div className="analysis-presets" aria-label="Reporting period">
            {([['MONTH', 'This Month'], ['FY', 'This FY'], ['YEAR', 'Last 12 Months'], ['CUSTOM', 'Custom']] as const).map(([p, label]) => (
              <button key={p} aria-pressed={preset === p} onClick={() => setPreset(p)}
                className={cn('rounded-md px-3 py-1.5 font-medium transition', preset === p ? 'bg-brand-600 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100')}>
                {label}
              </button>
            ))}
          </div>
          {preset === 'CUSTOM' && (
            <div className="analysis-dates">
              <input aria-label="From date" type="date" value={customFrom} max={customTo} onChange={(e) => setCustomFrom(e.target.value)} className="input py-1.5 text-xs" />
              <span className="text-slate-400">→</span>
              <input aria-label="To date" type="date" value={customTo} min={customFrom} max={todayISO()} onChange={(e) => setCustomTo(e.target.value)} className="input py-1.5 text-xs" />
            </div>
          )}
          <button className="analysis-refresh" disabled={isFetching || !validRange} onClick={() => refetch()}><RotateCcw size={14} />{isFetching ? 'Updating…' : 'Refresh'}</button>
        </div>
      </div>

      <p className="analysis-scope">Financial totals, credit notes and rejections use the selected period. Receivables, fulfilment and returns show the current position. Monthly charts always show the trailing 12 months.</p>
      {!validRange ? <div className="card p-5" role="alert">Choose a valid start and end date to load analysis.</div> : isLoading ? (
        <div className="card p-16 text-center text-slate-400" role="status"><Loader2 className="mx-auto h-6 w-6 animate-spin" />Loading business analysis…</div>
      ) : isError || !data ? (
        <div className="card p-12 text-center text-sm text-slate-400" role="alert">Could not load analysis. <button className="underline" onClick={() => refetch()}>Try again</button></div>
      ) : (
        <AnalysisBody data={data} />
      )}
      </div>
    </div>
  );
};

const SalesQualityAnalysis = ({ data }: { data: Analysis }) => {
  const sales = data.salesAdjustments;
  const rows = data.rejections;
  const group = (key: 'coreType' | 'warehouse') => Object.entries((rows ?? []).reduce<Record<string,number>>((acc,row)=>{
    acc[row[key]] = (acc[row[key]] || 0) + row.pcs; return acc;
  },{})).sort((a,b)=>b[1]-a[1]);
  const breakdown = (title: string, groups: [string,number][]) => <div className="analysis-quality-bars">
    <h3>{title}</h3>
    {!groups.length ? <p>No recorded rejections in this period.</p> : groups.slice(0,5).map(([name,pcs])=><div key={name}>
      <div><span>{name}</span><strong>{nf(pcs)} pcs</strong></div>
      <div className="analysis-quality-track"><span style={{width:`${Math.max(0,pcs)/Math.max(1,...groups.map(g=>g[1]))*100}%`}} /></div>
    </div>)}
  </div>;
  return <section className="card p-5 analysis-sales-quality">
    <SectionTitle icon={ReceiptText} title="Sales & credit notes" subtitle="Selected period · Values include GST · Credit notes reduce invoiced sales" />
    {!sales ? <p className="text-sm text-slate-500">Sales adjustment analysis is unavailable. Refresh after the server updates.</p> : <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 mt-3">
        <Kpi icon={ReceiptText} tone="brand" label="Gross invoiced sales" value={cr(sales.grossSales)} sub={`${nf(sales.invoiceCount)} invoices before credits`} />
        <Kpi icon={RotateCcw} tone="rose" label="Credit notes" value={cr(sales.creditValue)} sub={`${nf(sales.creditCount)} credit documents`} />
        <Kpi icon={IndianRupee} tone="emerald" label="Net sales" value={cr(sales.netSales)} sub="Gross sales − credit notes" />
        <Kpi icon={BarChart3} tone="amber" label="Credit adjustment rate" value={sales.grossSales > 0 ? `${(sales.creditValue/sales.grossSales*100).toFixed(1)}%` : '—'} sub="Credit value ÷ gross invoiced sales" />
      </div>
      <p className="analysis-scope mt-3">{inr(sales.grossSales)} gross − {inr(sales.creditValue)} credits = {inr(sales.netSales)} net sales. Credit adjustments do not necessarily represent rejected goods.</p>
    </>}
    <div className="analysis-quality-section">
      <SectionTitle icon={AlertTriangle} title="Production rejections" subtitle="Selected period · All matching rejection movements · Uses recorded date, or creation date when missing" />
      {!rows ? <p className="text-sm text-slate-500">Rejection analysis is unavailable. Refresh after the server updates.</p> : <>
        <div className="analysis-quality-totals">
          <div><span>Rejected pieces</span><strong>{nf(rows.reduce((n,r)=>n+r.pcs,0))}</strong></div>
          <div><span>Rejected weight</span><strong>{rows.reduce((n,r)=>n+r.weight,0).toLocaleString('en-IN',{maximumFractionDigits:3})} kg</strong></div>
          <div><span>Rejection records</span><strong>{nf(rows.reduce((n,r)=>n+r.records,0))}</strong></div>
        </div>
        <div className="grid gap-4 lg:grid-cols-2">{breakdown('By core type',group('coreType'))}{breakdown('Top 5 stores by rejected pieces',group('warehouse'))}</div>
      </>}
    </div>
  </section>;
};

const AnalysisBody = ({ data }: { data: Analysis }) => {
  const h = data.headline;
  const [customerSearch, setCustomerSearch] = useState('');
  const [customerSort, setCustomerSort] = useState<'invoiced' | 'outstanding'>('invoiced');
  const customers = data.topCustomers.filter(c => `${c.name} ${c.code ?? ''}`.toLowerCase().includes(customerSearch.toLowerCase())).sort((a,b) => b[customerSort] - a[customerSort]);
  return (
    <div className="analysis-body space-y-5">
      {/* ── KPI grid ── */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi icon={ReceiptText} tone="brand"   label="Invoiced"        value={cr(h.invoiced)}  sub={`${nf(h.invoiceCount)} invoices`} />
        <Kpi icon={Wallet}      tone="emerald" label="Collected"       value={cr(h.received)}  sub={`${h.collectionRate}% of invoiced`} />
        <Kpi icon={Clock}       tone="amber"   label="Outstanding"     value={cr(h.outstanding)} sub={`${nf(h.openInvoices)} open`} />
        <Kpi icon={AlertTriangle} tone="rose"  label="Overdue"         value={cr(h.overdue)}   sub="past due date" />
        <Kpi icon={IndianRupee} tone="slate"   label="Output GST"   value={cr(h.gst)}       sub={`on ${cr(h.taxable)} taxable sales`} />
        <Kpi icon={Users}       tone="sky"     label="Active customers" value={nf(h.customers)} sub="billed in range" />
        <Kpi icon={TrendingUp}  tone="violet"  label="Avg invoice"     value={cr(h.avgInvoice)} sub="per bill" />
        <Kpi icon={RotateCcw}   tone="slate"   label="Open returns"    value={nf(data.returns.open)} sub={`${nf(data.returns.total)} all-time`} />
      </div>
      <AdvancedInsights data={data} />
      <SalesQualityAnalysis data={data} />

      {/* ── Revenue trend ── */}
      <div className="card p-5">
        <SectionTitle icon={TrendingUp} title="Revenue & collections" subtitle="Trailing 12 months · receipts may settle invoices from earlier periods" />
        <TrendChart trend={data.trend} />
        <details className="analysis-monthly"><summary>Explore monthly figures</summary>
          <div className="analysis-table-scroll" tabIndex={0} role="region" aria-label="Monthly figures"><table><thead><tr><th>Month</th><th>Invoiced</th><th>Received</th><th>Invoiced − received</th><th>Produced pcs</th></tr></thead><tbody>{data.trend.map(t => <tr key={t.month}><td>{t.month}</td><td>{inr(t.invoiced)}</td><td>{inr(t.received)}</td><td>{inr(t.invoiced-t.received)}</td><td>{nf(t.produced)}</td></tr>)}</tbody></table></div>
        </details>
      </div>

      {/* ── Aging + Funnel ── */}
      <div className="grid gap-5 lg:grid-cols-2">
        <div className="card p-5">
          <SectionTitle icon={Clock} title="Receivables aging" subtitle={`Outstanding ${cr(data.aging.total)} by bucket`} />
          <AgingBars aging={data.aging} />
        </div>
        <div className="card p-5">
          <SectionTitle icon={Factory} title="Order fulfilment" subtitle="Active sales orders — order → produce → dispatch" />
          <Funnel f={data.fulfillment} />
        </div>
      </div>

      {/* ── Top customers + State ── */}
      <div className="grid gap-5 lg:grid-cols-2">
        <div className="card p-5">
          <SectionTitle icon={Users} title="Customers" subtitle={`${data.topCustomers.length} billed in range · by invoiced value`} />
          <div className="analysis-customer-controls"><input aria-label="Find customer" placeholder="Find customer or code…" value={customerSearch} onChange={e=>setCustomerSearch(e.target.value)} /><select aria-label="Sort customers" value={customerSort} onChange={e=>setCustomerSort(e.target.value as 'invoiced' | 'outstanding')}><option value="invoiced">Highest invoiced</option><option value="outstanding">Highest outstanding</option></select></div>
          <div className="analysis-table-scroll mt-3 max-h-96 overflow-auto" tabIndex={0} role="region" aria-label="Customer analysis">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 bg-white text-left text-[11px] uppercase tracking-wide text-slate-400 shadow-[0_1px_0_0_#e2e8f0]">
                <tr><th className="px-2 py-2">Customer</th><th className="px-2 py-2 text-right">Invoiced</th><th className="px-2 py-2 text-right">Outstanding</th><th className="px-2 py-2 w-24">Share</th></tr>
              </thead>
              <tbody>
                {customers.length === 0 && <tr><td colSpan={4} className="py-6 text-center text-slate-400">{customerSearch ? 'No matching customers.' : 'No invoices in range.'}</td></tr>}
                {customers.map((c) => (
                  <tr key={c.id || c.name} className="border-t border-slate-100 hover:bg-slate-50/60">
                    <td className="px-2 py-2 font-medium text-slate-800 truncate max-w-[160px]">{c.name}{c.code && <span className="ml-1 font-mono text-[10px] text-slate-400">{c.code}</span>}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{cr(c.invoiced)}</td>
                    <td className={cn('px-2 py-2 text-right tabular-nums', c.outstanding > 0 ? 'text-amber-700' : 'text-slate-400')}>{cr(c.outstanding)}</td>
                    <td className="px-2 py-2"><ShareBar pct={c.share} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="card p-5">
          <SectionTitle icon={Package} title="Revenue by state" subtitle="Top 8 states · shares are relative to the displayed states" />
          <BarList items={data.byState.map((s) => ({ label: s.state, value: s.amount, share: s.share }))} />
        </div>
      </div>

      {/* ── Core split + GST + Returns ── */}
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="card p-5">
          <SectionTitle icon={Package} title="Core type mix" subtitle="Ordered pcs (range)" />
          <CoreDonut toroidal={data.coreSplit.toroidal} rectangular={data.coreSplit.rectangular} />
        </div>
        <div className="card p-5">
          <SectionTitle icon={IndianRupee} title="Input & Output GST" subtitle="Selected period · Signed tax amounts from the registers" />
          <div className="analysis-gst-table mt-3">
            <table aria-label="Input and output GST breakdown">
              <thead><tr><th>Component</th><th>Input GST<small>Purchases</small></th><th>Output GST<small>Sales</small></th></tr></thead>
              <tbody>{([['taxable','Taxable value'],['igst','IGST'],['cgst','CGST'],['sgst','SGST'],['total','Total GST']] as const).map(([key,label])=><tr key={key}><th scope="row">{label}</th><td>{data.gst.input ? inr(data.gst.input[key]) : '—'}</td><td>{inr(data.gst[key])}</td></tr>)}</tbody>
            </table>
            {data.gst.input ? <div className="analysis-gst-net"><span>Output − Input<small>Book difference</small></span><strong>{inr(data.gst.total-data.gst.input.total)}</strong></div> : <p className="mt-2 text-xs text-slate-500">Input GST data is unavailable. Refresh after the server updates.</p>}
            <p className="mt-2 text-[11px] text-slate-500">Includes recorded credit/debit adjustments. Input GST is the purchase-register amount; this view does not determine eligible tax credit or tax payable.</p>
          </div>
        </div>
        <div className="card p-5">
          <SectionTitle icon={Truck} title="Production output" subtitle="Pcs produced — last 12 months" />
          <ProductionSpark trend={data.trend} />
          <div className="mt-3 border-t border-slate-100 pt-3">
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Returns by status</div>
            <div className="flex flex-wrap gap-1.5">
              {data.returns.byStatus.length === 0 && <span className="text-xs text-slate-400">None</span>}
              {data.returns.byStatus.map((r) => (
                <span key={r.status} className={cn('rounded-full px-2 py-0.5 text-[11px] font-medium', ['CLOSED', 'CANCELLED'].includes(r.status) ? 'bg-slate-100 text-slate-500' : 'bg-amber-50 text-amber-700')}>
                  {r.status.charAt(0) + r.status.slice(1).toLowerCase().replace('_', ' ')}: {r.count}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

const AdvancedInsights = ({ data }: { data: Analysis }) => {
  const pct = (value: number, total: number) => total > 0 ? `${(value / total * 100).toFixed(1)}%` : '—';
  const topThree = [...data.topCustomers].sort((a,b)=>b.invoiced-a.invoiced).slice(0,3);
  const olderDebt = data.aging.d61_90 + data.aging.d90;
  const lastComplete = data.trend.at(-2);
  const previous = data.trend.at(-3);
  const change = lastComplete && previous && previous.invoiced > 0 ? (lastComplete.invoiced-previous.invoiced)/previous.invoiced*100 : null;
  const insights = [
    { label:'Overdue exposure', value:pct(data.headline.overdue, data.headline.outstanding), detail:`${inr(data.headline.overdue)} overdue out of ${inr(data.headline.outstanding)} currently outstanding.`, note:'Current receivables', tone:'risk' },
    { label:'Debt overdue 61+ days', value:cr(olderDebt), detail:`${pct(olderDebt,data.aging.total)} of open receivables. ${inr(data.aging.noTerms)} has no due date.`, note:'Current aging', tone:'risk' },
    { label:'Top 3 customer share', value:pct(topThree.reduce((s,c)=>s+c.invoiced,0),data.headline.invoiced), detail:topThree.length ? topThree.map(c=>c.code || c.name).join(' · ') : 'No customer invoices in this period.', note:'Selected period', tone:'normal' },
    { label:'Completed-month revenue', value:change == null ? '—' : `${change >= 0 ? '+' : ''}${change.toFixed(1)}%`, detail:lastComplete && previous ? `${lastComplete.month}: ${inr(lastComplete.invoiced)} vs ${previous.month}: ${inr(previous.invoiced)}. A zero prior month has no percentage comparison.` : 'Two completed months are needed for comparison.', note:'Excludes the current partial month', tone:'normal' },
  ];
  return <section className="card analysis-insights"><SectionTitle icon={BarChart3} title="Business signals" subtitle="Calculated from your invoices, balances and monthly history" /><div className="analysis-signal-grid">{insights.map(i=><article key={i.label} data-tone={i.tone}><span>{i.note}</span><h3>{i.label}</h3><strong>{i.value}</strong><p>{i.detail}</p></article>)}</div></section>;
};

/* ── Small components ───────────────────────────────────────── */
const TONES: Record<string, { bg: string; text: string }> = {
  brand:   { bg: 'bg-brand-50',   text: 'text-brand-700' },
  emerald: { bg: 'bg-emerald-50', text: 'text-emerald-700' },
  amber:   { bg: 'bg-amber-50',   text: 'text-amber-700' },
  rose:    { bg: 'bg-rose-50',    text: 'text-rose-700' },
  sky:     { bg: 'bg-sky-50',     text: 'text-sky-700' },
  violet:  { bg: 'bg-violet-50',  text: 'text-violet-700' },
  slate:   { bg: 'bg-slate-100',  text: 'text-slate-700' },
};

const Kpi = ({ icon: Icon, tone, label, value, sub }: {
  icon: typeof Wallet; tone: keyof typeof TONES | string; label: string; value: string; sub?: string;
}) => {
  const t = TONES[tone] ?? TONES.slate;
  return (
    <div className="card dash-kpi analysis-kpi p-4">
      <div className="flex items-center gap-2">
        <div className={cn('flex h-8 w-8 items-center justify-center rounded-lg', t.bg, t.text)}><Icon className="h-4 w-4" /></div>
        <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</span>
      </div>
      <div className="dash-kpi-figure mt-2 text-xl font-bold tabular-nums text-slate-900">{value}</div>
      {sub && <div className="mt-0.5 text-[11px] text-slate-400">{sub}</div>}
    </div>
  );
};

const SectionTitle = ({ icon: Icon, title, subtitle }: { icon: typeof Wallet; title: string; subtitle?: string }) => (
  <div className="flex items-center gap-2">
    <Icon className="h-4 w-4 text-slate-400" />
    <div>
      <h2 className="text-sm font-semibold text-slate-700">{title}</h2>
      {subtitle && <div className="text-[11px] text-slate-400">{subtitle}</div>}
    </div>
  </div>
);

const ShareBar = ({ pct }: { pct: number }) => (
  <div className="flex items-center gap-1.5" title={`${pct}% of invoiced (range)`}>
    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
      <div className="h-full rounded-full bg-brand-500" style={{ width: `${Math.min(pct, 100)}%` }} />
    </div>
    <span className="w-8 text-right text-[10px] tabular-nums text-slate-500">{pct}%</span>
  </div>
);

const BarList = ({ items }: { items: { label: string; value: number; share: number }[] }) => {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <div className="mt-3 space-y-2.5">
      {items.length === 0 && <p className="text-sm text-slate-400">No data in range.</p>}
      {items.map((i) => (
        <div key={i.label} title={`${i.label}: ${inr(i.value)} (${i.share}%)`}>
          <div className="flex items-center justify-between text-xs">
            <span className="truncate font-medium text-slate-700">{i.label}</span>
            <span className="ml-2 shrink-0 tabular-nums text-slate-500">{cr(i.value)} · {i.share}%</span>
          </div>
          <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100">
            <div className="h-full rounded-full bg-sky-500" style={{ width: `${(i.value / max) * 100}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
};

/* Stacked horizontal aging bar + bucket legend. */
const AGING_DEFS: { key: keyof Analysis['aging']; label: string; color: string }[] = [
  { key: 'notDue',  label: 'Not due',   color: '#059669' },
  { key: 'd1_30',   label: '1–30 d',    color: '#84cc16' },
  { key: 'd31_60',  label: '31–60 d',   color: '#d97706' },
  { key: 'd61_90',  label: '61–90 d',   color: '#ea580c' },
  { key: 'd90',     label: '90+ d',     color: '#e11d48' },
  { key: 'noTerms', label: 'No terms',  color: '#94a3b8' },
];
const AgingBars = ({ aging }: { aging: Analysis['aging'] }) => {
  const total = aging.total || 1;
  return (
    <div className="mt-4">
      <div className="flex h-4 w-full overflow-hidden rounded-full bg-slate-100">
        {AGING_DEFS.map((d) => {
          const v = aging[d.key];
          if (v <= 0) return null;
          return <div key={d.key} style={{ width: `${(v / total) * 100}%`, background: d.color }} title={`${d.label}: ${inr(v)}`} />;
        })}
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
        {AGING_DEFS.map((d) => (
          <div key={d.key} className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: d.color }} />
            <div className="min-w-0">
              <div className="text-[10px] uppercase tracking-wide text-slate-400">{d.label}</div>
              <div className="text-xs font-semibold tabular-nums text-slate-700">{inr(aging[d.key])}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

/* Order → Produce → Dispatch funnel (each bar relative to ordered). */
const Funnel = ({ f }: { f: Analysis['fulfillment'] }) => {
  const base = Math.max(1, f.ordered);
  const rows = [
    { label: 'Ordered',    value: f.ordered,    color: 'bg-slate-400',   pct: f.ordered > 0 ? 100 : 0 },
    { label: 'Produced',   value: f.produced,   color: 'bg-amber-500',   pct: Math.min(Math.round((f.produced / base) * 100), 100) },
    { label: 'Dispatched', value: f.dispatched, color: 'bg-emerald-500', pct: Math.min(Math.round((f.dispatched / base) * 100), 100) },
    { label: 'Pending',    value: f.pending,    color: 'bg-rose-400',    pct: Math.min(Math.round((f.pending / base) * 100), 100) },
  ];
  return (
    <div className="mt-4 space-y-3">
      {rows.map((r) => (
        <div key={r.label} title={`${r.label}: ${nf(r.value)} pcs (${r.pct}%)`}>
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium text-slate-600">{r.label}</span>
            <span className="tabular-nums text-slate-500">{nf(r.value)} pcs · {r.pct}%</span>
          </div>
          <div className="mt-1 h-3 overflow-hidden rounded-full bg-slate-100">
            <div className={cn('h-full rounded-full', r.color)} style={{ width: `${r.pct}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
};

/* Combo chart: invoiced bars + received line, 12 months. */
const TrendChart = ({ trend }: { trend: Analysis['trend'] }) => {
  const W = 760, H = 230, padL = 8, padR = 8, padT = 14, padB = 26;
  const innerW = W - padL - padR, innerH = H - padT - padB;
  const max = Math.max(1, ...trend.map((t) => Math.max(t.invoiced, t.received)));
  const n = trend.length;
  const slot = innerW / Math.max(1,n);
  const barW = slot * 0.5;
  const y = (v: number) => padT + innerH - (v / max) * innerH;
  const cx = (i: number) => padL + slot * i + slot / 2;
  const linePts = trend.map((t, i) => `${cx(i)},${y(t.received)}`).join(' ');

  return (
    <div className="analysis-trend mt-3 w-full">
      {!trend.some(t=>t.invoiced || t.received) && <p className="analysis-chart-empty">No invoices or receipts in the trailing 12 months.</p>}
      <div className="analysis-chart-scroll" tabIndex={0} role="region" aria-label="Revenue chart, scroll for all months">
      <svg role="img" aria-label="Monthly invoiced revenue and received payments. Exact amounts are available in Explore monthly figures." viewBox={`0 0 ${W} ${H}`} className="w-full min-w-[520px]" preserveAspectRatio="xMidYMid meet">
        {/* gridlines */}
        {[0.25, 0.5, 0.75, 1].map((g) => (
          <line key={g} x1={padL} x2={W - padR} y1={padT + innerH - g * innerH} y2={padT + innerH - g * innerH} stroke="var(--d-grid)" strokeWidth={1} />
        ))}
        {/* invoiced bars (hover shows the figures) */}
        {trend.map((t, i) => (
          <rect key={i} x={cx(i) - barW / 2} y={y(t.invoiced)} width={barW} height={Math.max(0, padT + innerH - y(t.invoiced))} rx={2} fill="var(--d-accent)" opacity={0.65}>
            <title>{`${monthLabel(t.month)} — Invoiced ${inr(t.invoiced)} · Received ${inr(t.received)}`}</title>
          </rect>
        ))}
        {/* received line + dots */}
        <polyline points={linePts} fill="none" stroke="var(--d-rect)" strokeWidth={2.5} />
        {trend.map((t, i) => (
          <circle key={i} cx={cx(i)} cy={y(t.received)} r={3} fill="var(--d-rect)">
            <title>{`${monthLabel(t.month)} — Received ${inr(t.received)}`}</title>
          </circle>
        ))}
        {/* month labels */}
        {trend.map((t, i) => (
          <text key={i} x={cx(i)} y={H - 8} textAnchor="middle" fontSize={9} fill="#94a3b8">{monthLabel(t.month)}</text>
        ))}
      </svg>
      </div>
      <div className="mt-1 flex items-center gap-4 text-[11px] text-slate-500">
        <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: 'var(--d-accent)' }} /> Invoiced</span>
        <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-3 rounded-sm" style={{ background: 'var(--d-rect)' }} /> Received</span>
      </div>
    </div>
  );
};

/* Production-only mini bar chart. */
const ProductionSpark = ({ trend }: { trend: Analysis['trend'] }) => {
  const max = Math.max(1, ...trend.map((t) => t.produced));
  return (
    <div className="mt-3 flex h-20 items-end gap-1">
      {trend.map((t) => (
        <div key={t.month} className="flex flex-1 flex-col items-center gap-1" title={`${monthLabel(t.month)}: ${nf(t.produced)} pcs`}>
          <div className="w-full rounded-t bg-sky-400" style={{ height: `${(t.produced / max) * 60}px`, minHeight: t.produced > 0 ? 2 : 0 }} />
          <span className="text-[7px] text-slate-400">{monthLabel(t.month).slice(0, 1)}</span>
        </div>
      ))}
    </div>
  );
};

/* Toroidal vs Rectangular donut. */
const CoreDonut = ({ toroidal, rectangular }: { toroidal: number; rectangular: number }) => {
  const total = toroidal + rectangular;
  const r = 52, c = 2 * Math.PI * r;
  const toroPct = total > 0 ? toroidal / total : 0;
  return (
    <div className="analysis-core-mix mt-3 flex items-center gap-5">
      <svg viewBox="0 0 140 140" className="h-32 w-32 shrink-0">
        <circle cx={70} cy={70} r={r} fill="none" stroke="#e2e8f0" strokeWidth={18}>
          <title>{`Rectangular: ${nf(rectangular)} pcs`}</title>
        </circle>
        {total > 0 && (
          <circle cx={70} cy={70} r={r} fill="none" stroke="#d97706" strokeWidth={18}
            strokeDasharray={`${c * toroPct} ${c}`} transform="rotate(-90 70 70)" strokeLinecap="butt">
            <title>{`Toroidal: ${nf(toroidal)} pcs (${Math.round(toroPct * 100)}%)`}</title>
          </circle>
        )}
        <text x={70} y={66} textAnchor="middle" fontSize={13} fontWeight="700" fill="#0f172a">{nf(total)}</text>
        <text x={70} y={82} textAnchor="middle" fontSize={9} fill="#94a3b8">pcs</text>
      </svg>
      <div className="space-y-2 text-sm">
        <div className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: '#d97706' }} />
          <span className="text-slate-600">Toroidal</span><span className="ml-auto font-semibold tabular-nums">{nf(toroidal)}</span></div>
        <div className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: '#e2e8f0' }} />
          <span className="text-slate-600">Rectangular</span><span className="ml-auto font-semibold tabular-nums">{nf(rectangular)}</span></div>
        <div className="border-t border-slate-100 pt-1 text-[11px] text-slate-400">
          {total > 0 ? `${Math.round(toroPct * 100)}% toroidal` : 'No active orders in range'}
        </div>
      </div>
    </div>
  );
};
