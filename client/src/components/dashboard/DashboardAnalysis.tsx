import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Activity, ArrowDownRight, ArrowUpRight, ArrowRight, ChartNoAxesCombined, CircleHelp, Layers3 } from 'lucide-react';
import { AnimatedNumber } from './AnimatedNumber';
import { coreMix, flowAnalysis, percentChange, type previousRange, type Series, type Stats } from './analytics';
import { DashBar, DashCaption, DashChip, DashLabel, DashPanel } from './ui';

const n = (value: number) => value.toLocaleString('en-IN', { maximumFractionDigits: 1 });
const money = (value: number) => `₹${value.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
const date = (value: string) => new Date(`${value}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

export function DashboardAnalysis({ stats, previous, comparison, comparisonError, series, seriesError, customerId, from, to }: {
  stats: Stats; previous?: Stats; comparison: ReturnType<typeof previousRange>; comparisonError: boolean;
  series?: Series; seriesError: boolean; customerId: string; from: string; to: string;
}) {
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const flow = series ? flowAnalysis(series, today) : null;
  const mix = coreMix(stats);
  const topShare = stats.salesOrders.amount > 0 && !customerId
    ? stats.topCustomers.slice(0, 3).reduce((sum, c) => sum + c.amount, 0) / stats.salesOrders.amount * 100 : null;
  const openPcs = stats.pendingProduction.pcs + stats.readyDispatch.pcs;
  const readyShare = openPcs > 0 ? stats.readyDispatch.pcs / openPcs * 100 : 0;
  const query = customerId ? `?customerId=${encodeURIComponent(customerId)}` : '';
  const comparisons = [
    { label: 'Order value', value: stats.salesOrders.amount, previous: previous?.salesOrders.amount, format: money },
    { label: 'Ordered pieces', value: stats.salesOrders.pcs, previous: previous?.salesOrders.pcs, format: n },
    { label: 'Dispatched pieces', value: stats.dispatched.pcs, previous: previous?.dispatched.pcs, format: n },
  ];

  return <section className="dash-analysis space-y-5" aria-label="Operational analysis">
    <div className="flex flex-wrap items-center justify-between gap-3 px-1">
      <div className="flex items-center gap-3"><span className="dash-kpi-icon"><ChartNoAxesCombined className="h-4 w-4" /></span><div><h2>Behind the numbers</h2><DashCaption>Operational signals from your records</DashCaption></div></div>
      <DashChip>Selected customer & date range</DashChip>
    </div>

    <DashPanel className="p-5 sm:p-6">
      <div className="flex flex-wrap justify-between gap-2"><h2>Period performance</h2><DashCaption>{comparison ? `Compared with ${date(comparison.from)} – ${date(comparison.to)} · ${comparison.days} days` : 'Choose a valid date range to compare'}</DashCaption></div>
      {to >= today && <p className="mt-2 text-xs text-[var(--d-muted)]">The selected period includes today or future dates; its totals may still be incomplete.</p>}
      <div className="dash-comparisons mt-5 grid gap-4 md:grid-cols-3">
        {comparisons.map((item) => {
          const change = item.previous === undefined ? null : percentChange(item.value, item.previous);
          return <div key={item.label} className="dash-inset p-4">
            <DashLabel>{item.label}</DashLabel>
            <div className="my-3 flex flex-wrap items-center justify-between gap-2"><strong className="text-2xl font-semibold tracking-tight">{item.label === 'Order value' && '₹'}<AnimatedNumber value={item.value} /></strong>
              <span className="dash-delta">{item.previous === undefined ? (comparisonError ? 'Unavailable' : comparison ? 'Loading…' : '—') : change === null ? item.value > 0 ? 'New activity' : 'No activity' : <>{change < 0 ? <ArrowDownRight className="h-3.5 w-3.5" /> : <ArrowUpRight className="h-3.5 w-3.5" />}{change > 0 ? '+' : ''}{n(change)}%</>}</span>
            </div>
            <DashCaption>{item.previous !== undefined ? `Previous: ${item.format(item.previous)}` : 'Previous-period comparison'} · {item.label === 'Dispatched pieces' ? 'dispatch date' : 'active order items'}</DashCaption>
          </div>;
        })}
      </div>
    </DashPanel>

    <div className="grid gap-5 xl:grid-cols-[1.65fr_1fr]">
      <DashPanel className="min-w-0 p-5 sm:p-6">
        <div className="flex items-center gap-2"><Activity className="h-4 w-4 text-[var(--d-accent)]" /><h2>Production & dispatch pulse</h2></div>
        <DashCaption className="mt-1">Daily recorded pieces · independent activity streams</DashCaption>
        {seriesError && <p role="alert" className="mt-4 text-sm">Daily activity could not be refreshed.{series ? ' Showing the last available series.' : ''}</p>}
        {!series ? !seriesError && <p className="py-16 text-center text-sm text-[var(--d-muted)]">Loading daily activity…</p> : <>
          <DailyChart key={`${from}:${to}:${customerId}`} series={series} today={today} />
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
            <MiniMetric label="Recorded production" value={flow?.produced ?? 0} unit="pcs" />
            <MiniMetric label="Production pace" value={flow?.dailyPace ?? 0} unit="pcs / calendar day" decimals={1} />
            <MiniMetric label="Production days" value={flow?.activeDays ?? 0} unit={`of ${flow?.days ?? 0} observed days`} />
          </div>
          <p className="mt-4 text-xs leading-relaxed text-[var(--d-muted)]">{flow?.days ? `Observed ${date(flow.from!)} – ${date(flow.to!)}. ` : 'No observed days. '}{series.days.length >= 400 ? 'Daily history is capped at the first 400 days of the selection. ' : ''}Production counts raw entries, including split runs; it is not a finished-goods or fulfillment rate.</p>
        </>}
      </DashPanel>

      <DashPanel className="p-5 sm:p-6">
        <div className="flex items-center gap-2"><Layers3 className="h-4 w-4 text-[var(--d-accent)]" /><h2>Open work position</h2></div>
        <DashCaption className="mt-1">Current active orders · all dates</DashCaption>
        <div className="my-6 flex items-center gap-5">
          <div className="dash-orbit" style={{ '--ring-share': `${readyShare}%` } as React.CSSProperties}><div><strong><AnimatedNumber value={readyShare} decimals={1} />%</strong><span>ready share</span></div></div>
          <div className="min-w-0"><DashLabel>Unshipped pieces</DashLabel><div className="my-2 text-3xl font-semibold tracking-tight"><AnimatedNumber value={openPcs} /></div><DashCaption>Pending + ready to dispatch</DashCaption></div>
        </div>
        <div className="space-y-4">
          <Position label="Awaiting production" count={stats.pendingProduction.pcs} amount={stats.pendingProduction.amount} share={openPcs ? stats.pendingProduction.pcs / openPcs * 100 : 0} />
          <Position label="Ready to dispatch" count={stats.readyDispatch.pcs} amount={stats.readyDispatch.amount} share={readyShare} />
        </div>
        <div className="dash-inset mt-5 p-4"><DashLabel>Dispatch clearance estimate</DashLabel><p className="my-2 text-lg font-semibold">{stats.readyDispatch.pcs === 0 ? 'No ready stock' : flow && flow.days && flow.dispatched > 0 ? `${n(stats.readyDispatch.pcs / (flow.dispatched / flow.days))} calendar days` : 'Insufficient dispatch activity'}</p><DashCaption>Ready pieces ÷ average daily dispatched pieces in observed days. Assumes the same pace and no new stock; product mix and working days can change the outcome.</DashCaption></div>
        <Link to={`/po/summary${query}`} className="dash-text-link mt-4">Review outstanding orders <ArrowRight className="h-4 w-4" /></Link>
      </DashPanel>
    </div>

    <div className="grid gap-5 lg:grid-cols-2">
      <DashPanel className="p-5 sm:p-6">
        <h2>Demand composition</h2><DashCaption className="mt-1">Share of active ordered pieces in the selected range</DashCaption>
        <div className="dash-mix-track my-6" aria-hidden="true">{mix.map((item) => <span key={item.label} style={{ width: `${item.share}%`, background: item.color }} />)}</div>
        <div className="grid grid-cols-3 gap-3">{mix.map((item) => <div key={item.label}><DashLabel>{item.label}</DashLabel><div className="my-2 text-xl font-semibold"><AnimatedNumber value={item.share} decimals={1} />%</div><DashCaption>{n(item.value)} pcs</DashCaption></div>)}</div>
        <div className="dash-inset mt-6 flex flex-wrap justify-between gap-3 p-4"><div><DashLabel>Top 3 customer concentration</DashLabel><p className="mt-2 text-xl font-semibold">{topShare === null ? customerId ? 'Single customer selected' : 'No order value' : `${n(topShare)}% of order value`}</p></div></div>
        <p className="mt-3 text-xs leading-relaxed text-[var(--d-muted)]">{customerId ? 'Select all customers to assess concentration across the business.' : 'A larger share means demand relies on fewer customers. This uses active order value, not invoiced revenue.'}</p>
      </DashPanel>
      <DashPanel className="p-5 sm:p-6">
        <h2>What needs your attention</h2><DashCaption className="mt-1">Evidence from current work and observed activity</DashCaption>
        <div className="mt-4 space-y-3">
          <Insight title={`${n(stats.overdueItems)} overdue order items`} text={stats.overdueItems ? 'These active items are past their delivery date and still have production remaining. Review delivery priorities.' : 'No active items are both past delivery date and awaiting production.'} to={`/po/summary${query}`} />
          <Insight title={`${n(stats.openReturns)} open return requests`} text="Current requests across all dates. Review the return records for customer follow-up and resolution." to="/returns" />
          <Insight title={flow?.peak ? `Peak production: ${n(flow.peak.pcs)} pcs` : 'Production peak unavailable'} text={flow?.peak ? `Recorded on ${date(flow.peak.day)}. Compare the product mix and staffing on that day before using it as a capacity target.` : 'A production peak needs at least one observed day with recorded output.'} />
          <Insight title={flow?.days ? `${flow.net >= 0 ? '+' : ''}${n(flow.net)} pcs production–dispatch difference` : 'Activity balance unavailable'} text="Recorded production minus dispatches over observed days. Split runs and shipments from earlier stock mean this is not an inventory reconciliation." />
        </div>
        <details className="mt-4 text-xs text-[var(--d-muted)]"><summary className="flex cursor-pointer items-center gap-2"><CircleHelp className="h-3.5 w-3.5" /> How to read this analysis</summary><p className="mt-3 leading-relaxed">Comparisons use the immediately preceding range with the same number of calendar days. Historical order totals reflect items currently active. Backlog, ready stock and returns are current snapshots. Daily averages include zero-activity days and exclude future dates. No profitability, machine utilization or on-time delivery score is inferred from these records.</p></details>
      </DashPanel>
    </div>
  </section>;
}

function MiniMetric({ label, value, unit, decimals = 0 }: { label: string; value: number; unit: string; decimals?: number }) {
  return <div className="dash-inset p-3"><DashLabel className="leading-relaxed">{label}</DashLabel><p className="my-2 text-xl font-semibold"><AnimatedNumber value={value} decimals={decimals} /></p><DashCaption>{unit}</DashCaption></div>;
}
function Position({ label, count, amount, share }: { label: string; count: number; amount: number; share: number }) {
  return <div><div className="mb-2 flex flex-wrap justify-between gap-2 text-xs"><span>{label}</span><strong>{n(count)} pcs · {money(amount)}</strong></div><DashBar pct={share} /></div>;
}
function Insight({ title, text, to }: { title: string; text: string; to?: string }) {
  return <div className="dash-insight"><span className="dash-insight-dot" /><div><h3 className="text-sm font-semibold">{title}</h3><p className="mt-1 text-xs leading-relaxed text-[var(--d-muted)]">{text}</p>{to && <Link className="dash-text-link mt-2 text-xs" to={to}>Review records <ArrowUpRight className="h-3 w-3" /></Link>}</div></div>;
}

function DailyChart({ series, today }: { series: Series; today: string }) {
  const [selected, setSelected] = useState<string | null>(null);
  const [visible, setVisible] = useState({ produced: true, dispatched: true });
  const days = series.days.map((day, i) => ({ day, produced: series.pendingProduction[i] ?? 0, dispatched: series.dispatched[i] ?? 0 })).filter((item) => item.day <= today);
  const points = [{ key: 'produced' as const, label: 'Production', color: 'var(--d-accent)' }, { key: 'dispatched' as const, label: 'Dispatch', color: 'var(--d-rect)' }];
  const max = Math.max(1, ...days.flatMap((day) => points.filter((point) => visible[point.key]).map((point) => day[point.key])));
  const x = (i: number) => 44 + (days.length > 1 ? i / (days.length - 1) : .5) * 640;
  const y = (value: number) => 194 - value / max * 165;
  const activeIndex = Math.max(0, selected ? days.findIndex((day) => day.day === selected) : days.length - 1);
  const active = days[activeIndex];
  return <div className="mt-4">
    <div className="flex flex-wrap gap-2">{points.map((point) => <button key={point.key} type="button" className="dash-chart-toggle" aria-pressed={visible[point.key]} onClick={() => setVisible((old) => ({ ...old, [point.key]: !old[point.key] }))}><span style={{ background: point.color }} />{point.label}</button>)}</div>
    {!days.length ? <p className="py-12 text-center text-sm text-[var(--d-muted)]">No observed days in this selection.</p> : <>
      <svg className="dash-daily-chart mt-3" viewBox="0 0 710 228" role="img" aria-label="Daily production and dispatch in pieces. Select a day below for exact values.">
        {[0, .5, 1].map((tick) => <g key={tick}><line x1="44" x2="684" y1={y(max * tick)} y2={y(max * tick)} stroke="var(--d-grid)" strokeDasharray="4 5" /><text x="36" y={y(max * tick) + 4} textAnchor="end" fontSize="10" fill="var(--d-faint)">{Intl.NumberFormat('en', { notation: 'compact' }).format(max * tick)}</text></g>)}
        {points.filter((point) => visible[point.key]).map((point) => <g key={point.key}><path className="dash-chart-line" pathLength="1" d={days.map((day, i) => `${i ? 'L' : 'M'}${x(i)},${y(day[point.key])}`).join(' ')} fill="none" stroke={point.color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />{days.length === 1 && <circle cx={x(0)} cy={y(days[0][point.key])} r="4" fill={point.color} />}</g>)}
        {active && <g><line x1={x(activeIndex)} x2={x(activeIndex)} y1="20" y2="194" stroke="var(--d-muted)" strokeDasharray="3 4" />{points.filter((point) => visible[point.key]).map((point) => <circle key={point.key} cx={x(activeIndex)} cy={y(active[point.key])} r="4" fill={point.color} stroke="var(--d-panel)" strokeWidth="2" />)}</g>}
        <text x="44" y="220" fontSize="11" fill="var(--d-faint)">{date(days[0].day)}</text><text x="684" y="220" textAnchor="end" fontSize="11" fill="var(--d-faint)">{days.length > 1 ? date(days.at(-1)!.day) : ''}</text>
        {days.map((day, i) => <rect key={day.day} x={i === 0 ? 44 : (x(i - 1) + x(i)) / 2} y="20" width={days.length === 1 ? 640 : 640 / (days.length - 1) / (i === 0 || i === days.length - 1 ? 2 : 1)} height="174" fill="transparent" onPointerEnter={() => setSelected(day.day)} onClick={() => setSelected(day.day)} />)}
      </svg>
      <div className="dash-inset flex flex-wrap items-center justify-between gap-3 p-3"><label className="text-xs text-[var(--d-muted)]">Inspect day <select aria-label="Inspect activity day" value={active?.day ?? ''} onChange={(event) => setSelected(event.target.value)} className="ml-2 border border-[var(--d-line)] bg-[var(--d-raised)] px-2 text-[var(--d-text)]">{days.map((day) => <option key={day.day} value={day.day}>{date(day.day)}</option>)}</select></label><div className="flex flex-wrap gap-4 text-xs"><span>Production <strong>{n(active?.produced ?? 0)}</strong></span><span>Dispatch <strong>{n(active?.dispatched ?? 0)}</strong></span></div></div>
      {!visible.produced && !visible.dispatched && <p className="mt-2 text-xs text-[var(--d-muted)]">Both lines are hidden. Select a legend button to show activity.</p>}
    </>}
  </div>;
}
