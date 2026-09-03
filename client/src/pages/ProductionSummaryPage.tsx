// Production Summary — filterable report of production by employee, with type,
// size/measure, pcs, weight and amount. Filter by date range, employee and
// customer; download the filtered set as Excel.
import { Fragment, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Factory, Loader2, Download, Search, ChevronDown, ChevronRight, Users, List, SlidersHorizontal } from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { downloadXlsx, todayStamp } from '@/lib/excel';
import { downloadReportXlsx, type ReportRow } from '@/lib/xlsxReport';
import { SearchableSelect } from '@/components/SearchableSelect';
import { Panel, Th, StatStrip, num } from '@/components/tally';
import { useHideCustomerNames } from '@/store/auth';

type Row = {
  id: string; prodDate: string; poNumber: string;
  customerName: string; customerCode: string | null;
  labourName: string; coreType: 'TOROIDAL' | 'RECTANGULAR';
  grade: string; material: string; measure: string;
  pcs: number; weightPerPc: number; totalWeight: number; amount: number | null;
};
type SummaryResp = { items: Row[]; totals: { pcs: number; weight: number; amount: number }; labours: string[] };

const fmt = (iso: string) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }); };
const kg = (n: number) => n.toFixed(3);
const pcsFmt = (n: number) => n.toLocaleString('en-IN');

/* Day key from the LOCAL date parts, not toISOString() — an entry logged in the
   evening IST would otherwise fall into the previous UTC day and be counted
   against the wrong shift. This matches what fmt() renders. */
const dayKey = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

type SizeAgg = { key: string; measure: string; coreType: Row['coreType']; grade: string; material: string; pcs: number; weight: number; amount: number };
type DayAgg = { key: string; iso: string; pcs: number; weight: number; amount: number; sizes: SizeAgg[] };
type EmpAgg = { name: string; pcs: number; weight: number; amount: number; days: DayAgg[] };

/* Employee -> day -> size. Rounding is applied once at the end of each bucket:
   rounding while accumulating drifts by a gram or two over a month. */
const groupByEmployee = (rows: Row[]): EmpAgg[] => {
  const emps = new Map<string, { name: string; pcs: number; weight: number; amount: number; days: Map<string, { iso: string; pcs: number; weight: number; amount: number; sizes: Map<string, SizeAgg> }> }>();
  for (const r of rows) {
    const name = (r.labourName || '').trim() || '(no employee recorded)';
    let e = emps.get(name);
    if (!e) { e = { name, pcs: 0, weight: 0, amount: 0, days: new Map() }; emps.set(name, e); }
    const dk = dayKey(r.prodDate);
    let d = e.days.get(dk);
    if (!d) { d = { iso: r.prodDate, pcs: 0, weight: 0, amount: 0, sizes: new Map() }; e.days.set(dk, d); }
    const sk = `${r.coreType}|${r.grade}|${r.material}|${r.measure}`;
    let z = d.sizes.get(sk);
    if (!z) { z = { key: sk, measure: r.measure, coreType: r.coreType, grade: r.grade, material: r.material, pcs: 0, weight: 0, amount: 0 }; d.sizes.set(sk, z); }
    const w = Number(r.totalWeight) || 0;
    const a = Number(r.amount) || 0;
    const pcs = Number(r.pcs) || 0;
    z.pcs += pcs; z.weight += w; z.amount += a;
    d.pcs += pcs; d.weight += w; d.amount += a;
    e.pcs += pcs; e.weight += w; e.amount += a;
  }
  const round = <T extends { weight: number; amount: number }>(o: T): T => ({ ...o, weight: +o.weight.toFixed(3), amount: +o.amount.toFixed(2) });
  return [...emps.values()]
    .map((e) => round({
      ...e,
      days: [...e.days.entries()]
        .map(([key, d]) => round({
          key, iso: d.iso, pcs: d.pcs, weight: d.weight, amount: d.amount,
          sizes: [...d.sizes.values()].map(round).sort((a, b) => b.weight - a.weight),
        }))
        .sort((a, b) => b.key.localeCompare(a.key)),   // newest day first
    }))
    .sort((a, b) => b.weight - a.weight);              // biggest producer first
};

export const ProductionSummaryPage = () => {
  const hideNames = useHideCustomerNames();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [labour, setLabour] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [search, setSearch] = useState('');
  const [view, setView] = useState<'BY_EMPLOYEE' | 'ENTRIES'>('BY_EMPLOYEE');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggleEmp = (name: string) => setCollapsed((prev) => {
    const next = new Set(prev);
    if (next.has(name)) next.delete(name); else next.add(name);
    return next;
  });

  const qs = new URLSearchParams();
  if (from) qs.set('from', from);
  if (to) qs.set('to', to);
  if (labour) qs.set('labour', labour);
  if (customerId) qs.set('customerId', customerId);
  if (search.trim()) qs.set('search', search.trim());

  const { data, isLoading } = useQuery({
    queryKey: ['production-summary', from, to, labour, customerId, search],
    queryFn: () => api<SummaryResp>(`/production/summary?${qs.toString()}`),
  });

  const { data: customers } = useQuery({
    queryKey: ['customers-options'],
    queryFn: () => api<{ items: { id: string; name: string; customerCode: string }[] }>('/customers?pageSize=500'),
  });
  const customerOptions = (customers?.items ?? []).map((c) => ({ value: c.id, label: hideNames ? c.customerCode : `${c.customerCode} · ${c.name}` }));
  const labourOptions = (data?.labours ?? []).map((l) => ({ value: l, label: l }));

  const items = data?.items ?? [];
  const totals = data?.totals;
  const employees = useMemo(() => groupByEmployee(items), [items]);
  const allCollapsed = employees.length > 0 && employees.every((e) => collapsed.has(e.name));

  /* A formatted report sheet, not a data dump: title block, styled header,
     Excel outline levels so it collapses to employees then days exactly like
     the page, real number formats (kg to 3dp, amount as rupees) and a grand
     total. Rows carry their own employee/date so the sheet still pivots. */
  const onExportByEmployee = () => {
    if (!employees.length) return;
    const rows: ReportRow[] = [];
    for (const e of employees) {
      const sizeCount = new Set(e.days.flatMap((d) => d.sizes.map((z) => z.key))).size;
      rows.push({ kind: 'group', cells: [e.name, `${e.days.length} day${e.days.length === 1 ? '' : 's'}`, `${sizeCount} size${sizeCount === 1 ? '' : 's'}`, '', '', e.pcs, e.weight, e.amount] });
      for (const d of e.days) {
        rows.push({ kind: 'sub', cells: [`   ${fmt(d.iso)}`, 'Day total', '', '', '', d.pcs, d.weight, d.amount] });
        for (const z of d.sizes) {
          rows.push({ kind: 'detail', cells: [`      ${z.measure}`, z.coreType === 'TOROIDAL' ? 'Toroidal' : 'Rectangular', z.grade, z.material, fmt(d.iso), z.pcs, z.weight, z.amount] });
        }
      }
    }
    if (totals) rows.push({ kind: 'total', cells: ['TOTAL', `${employees.length} employees`, '', '', '', totals.pcs, totals.weight, totals.amount] });

    const period = from && to ? `${fmt(from)} to ${fmt(to)}` : from ? `From ${fmt(from)}` : to ? `Up to ${fmt(to)}` : 'All dates';
    const bits = [period, `${employees.length} employee${employees.length === 1 ? '' : 's'}`];
    if (labour) bits.push(`Employee: ${labour}`);
    if (search.trim()) bits.push(`Search: ${search.trim()}`);

    downloadReportXlsx({
      filename: `production-by-employee-${todayStamp()}`,
      sheetName: 'By Employee',
      title: 'Production by Employee',
      subtitle: bits.join('   ·   '),
      accentHex: '1F2937',
      columns: [
        { header: 'Employee / Date / Size', width: 34 },
        { header: 'Type', width: 13 },
        { header: 'Grade', width: 15 },
        { header: 'Material', width: 15 },
        { header: 'Date', width: 14 },
        { header: 'Pcs', width: 9, numFmt: '#,##0' },
        { header: 'Weight (kg)', width: 13, numFmt: '#,##0.000' },
        { header: 'Amount', width: 15, numFmt: '\u20B9#,##0.00' },
      ],
      rows,
    });
  };

  const onExport = () => {
    if (view === 'BY_EMPLOYEE') return onExportByEmployee();
    if (!items.length) return;
    const rows = items.map((r) => ({
      Date: fmt(r.prodDate),
      Employee: r.labourName,
      'PO #': r.poNumber,
      'Customer Code': r.customerCode ?? '',
      ...(hideNames ? {} : { Customer: r.customerName }),
      Type: r.coreType,
      Grade: r.grade,
      Material: r.material,
      Measure: r.measure,
      Pcs: r.pcs,
      'Weight (kg)': r.totalWeight,
      'Amount (₹)': r.amount ?? '',
    }));
    downloadXlsx(`production-summary-${todayStamp()}`, 'Production Summary', rows);
  };

  const dayCount = new Set(employees.flatMap((e) => e.days.map((d) => d.key))).size;

  return (
    <div className="max-w-full space-y-3">
      {/* Title bar */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight text-slate-800 sm:text-2xl">
          <Factory className="h-4.5 w-4.5 text-brand-600" /> Production Summary
        </h1>
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded border border-slate-300 bg-white p-0.5">
            {([['BY_EMPLOYEE', 'By Employee', Users], ['ENTRIES', 'All Entries', List]] as const).map(([k, label, Icon]) => (
              <button
                key={k}
                onClick={() => setView(k)}
                aria-pressed={view === k}
                className={cn('inline-flex min-h-[30px] items-center gap-1.5 rounded-sm px-2.5 text-[12px] font-bold uppercase tracking-wider transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 motion-reduce:transition-none',
                  view === k ? 'bg-slate-700 text-white' : 'text-slate-600 hover:bg-slate-100')}
              >
                <Icon className="h-3.5 w-3.5" /> {label}
              </button>
            ))}
          </div>
          <button
            onClick={onExport}
            disabled={!items.length}
            className="inline-flex min-h-[32px] items-center gap-1.5 rounded border border-slate-300 bg-white px-3 text-[12px] font-bold uppercase tracking-wider text-emerald-700 transition-colors duration-200 hover:bg-emerald-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 disabled:opacity-40 motion-reduce:transition-none"
            title="Download the report as a formatted Excel sheet"
          >
            <Download className="h-3.5 w-3.5" /> Excel
          </button>
        </div>
      </div>

      {/* Filters */}
      {/* overflow-visible: the Employee/Customer pickers render their menu as an
          absolutely-positioned child, and Panel clips by default — which cut the
          dropdown off at the card edge. */}
      <Panel title={<><SlidersHorizontal className="h-3.5 w-3.5" /> Filters</>} className="overflow-visible">
        <div className="grid grid-cols-1 gap-2.5 p-3 sm:grid-cols-2 lg:grid-cols-5">
          <Field label="From"><input type="date" className="input h-9 text-sm" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label="To"><input type="date" className="input h-9 text-sm" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
          <Field label="Employee"><SearchableSelect value={labour} onChange={setLabour} options={labourOptions} placeholder="All employees" /></Field>
          <Field label="Customer"><SearchableSelect value={customerId} onChange={setCustomerId} options={customerOptions} placeholder="All customers" /></Field>
          <Field label="Search">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <input className="input h-9 pl-8 text-sm" placeholder="PO, grade, measure…" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
          </Field>
        </div>
      </Panel>

      {/* Totals band */}
      {totals && !isLoading && (
        <Panel title="Totals">
          <StatStrip
            size="md"
            cols={5}
            items={[
              { label: 'Employees', value: String(employees.length) },
              { label: 'Days', value: String(dayCount) },
              { label: 'Total Pcs', value: pcsFmt(totals.pcs) },
              { label: 'Total Weight (kg)', value: kg(totals.weight), tone: 'text-slate-900' },
              { label: 'Total Amount', value: '\u20B9' + num(totals.amount), tone: 'text-brand-700' },
            ]}
          />
        </Panel>
      )}

      {isLoading && (
        <div className="rounded border border-slate-300 bg-white p-10 text-center text-slate-400">
          <Loader2 className="mx-auto h-5 w-5 animate-spin" />
        </div>
      )}
      {!isLoading && !items.length && (
        <div className="rounded border border-slate-300 bg-white p-10 text-center text-sm text-slate-500">
          No production records for these filters.
        </div>
      )}

      {/* ---------------- By employee: one continuous columnar report ----------------
          A single table for every employee (rather than a table per card) so the
          figures line up in one column down the whole page — the thing that makes
          a printed ERP report readable. */}
      {!isLoading && items.length > 0 && view === 'BY_EMPLOYEE' && (
        <Panel
          title={<><Users className="h-3.5 w-3.5" /> Production by Employee</>}
          right={
            <button
              onClick={() => setCollapsed(allCollapsed ? new Set() : new Set(employees.map((e) => e.name)))}
              className="inline-flex min-h-[26px] items-center rounded border border-slate-300 bg-white px-2 text-[11.5px] font-bold uppercase tracking-wider text-slate-600 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
            >
              {allCollapsed ? 'Expand all' : 'Collapse all'}
            </button>
          }
        >
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] border-collapse text-sm">
              <thead>
                <tr>
                  <Th size="md" className="sm:pl-3">Employee / Date / Size</Th>
                  <Th size="md" align="center" className="w-[62px]">Type</Th>
                  <Th size="md" className="hidden w-[104px] sm:table-cell">Grade</Th>
                  <Th size="md" className="hidden w-[112px] md:table-cell">Material</Th>
                  <Th size="md" align="right" className="w-[68px]">Pcs</Th>
                  <Th size="md" align="right" className="w-[96px]">Weight (kg)</Th>
                  <Th size="md" align="right" className="w-[112px]">Amount</Th>
                </tr>
              </thead>

              {employees.map((e) => {
                const open = !collapsed.has(e.name);
                const share = totals && totals.weight > 0 ? e.weight / totals.weight : 0;
                const sizeCount = new Set(e.days.flatMap((d) => d.sizes.map((z) => z.key))).size;
                return (
                  <tbody key={e.name} className="border-b-2 border-slate-200 last:border-b-0">
                    {/* Employee band */}
                    <tr className="bg-slate-50">
                      <td className="border-b border-slate-200 p-0" colSpan={4}>
                        <button
                          onClick={() => toggleEmp(e.name)}
                          aria-expanded={open}
                          className="flex min-h-[38px] w-full items-center gap-2 px-2 py-1.5 text-left transition-colors duration-200 hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500 motion-reduce:transition-none sm:px-3"
                        >
                          {open
                            ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-slate-500" aria-hidden />
                            : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-500" aria-hidden />}
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[15px] font-bold uppercase tracking-wide text-slate-800">{e.name}</span>
                            <span className="mt-0.5 flex items-center gap-1.5">
                              <span className="h-1 w-14 overflow-hidden rounded-sm bg-slate-200 sm:w-20">
                                <span className="block h-full bg-brand-500" style={{ width: `${Math.max(share * 100, 2)}%` }} />
                              </span>
                              <span className="font-mono text-[11.5px] tabular-nums text-slate-500">
                                {(share * 100).toFixed(1)}% · {e.days.length}d · {sizeCount} size{sizeCount === 1 ? '' : 's'}
                              </span>
                            </span>
                          </span>
                        </button>
                      </td>
                      <td className="border-b border-slate-200 px-2 py-1.5 text-right font-mono text-[15px] font-bold tabular-nums text-slate-800">{pcsFmt(e.pcs)}</td>
                      <td className="border-b border-slate-200 px-2 py-1.5 text-right font-mono text-[15px] font-bold tabular-nums text-slate-900">{kg(e.weight)}</td>
                      <td className="border-b border-slate-200 px-2 py-1.5 text-right font-mono text-[15px] font-bold tabular-nums text-brand-700">{num(e.amount)}</td>
                    </tr>

                    {open && e.days.map((d) => (
                      <Fragment key={d.key}>
                        {/* Day sub-total */}
                        <tr className="bg-white">
                          <th scope="rowgroup" className="whitespace-nowrap border-b border-slate-100 py-1 pl-7 pr-2 text-left text-[13.5px] font-bold text-slate-700 sm:pl-9">{fmt(d.iso)}</th>
                          <td className="hidden border-b border-slate-100 px-2 py-1 text-[11px] uppercase tracking-wider text-slate-400 sm:table-cell" colSpan={3}>Day total</td>
                          <td className="border-b border-slate-100 px-2 py-1 text-right font-mono text-[13.5px] font-semibold tabular-nums text-slate-700">{pcsFmt(d.pcs)}</td>
                          <td className="border-b border-slate-100 px-2 py-1 text-right font-mono text-[13.5px] font-semibold tabular-nums text-slate-800">{kg(d.weight)}</td>
                          <td className="border-b border-slate-100 px-2 py-1 text-right font-mono text-[13.5px] font-semibold tabular-nums text-slate-700">{num(d.amount)}</td>
                        </tr>
                        {/* Size lines */}
                        {d.sizes.map((z) => (
                          <tr key={z.key} className="odd:bg-white even:bg-slate-50/40 hover:bg-brand-50/50">
                            <td className="whitespace-nowrap py-1 pl-10 pr-2 font-mono text-[13px] text-slate-700 sm:pl-14">{z.measure}</td>
                            <td className="px-1 py-1 text-center">
                              <span className={cn('inline-block rounded-sm border px-1 py-px font-mono text-[11px] font-bold uppercase',
                                z.coreType === 'TOROIDAL' ? 'border-amber-300 bg-amber-50 text-amber-800' : 'border-rose-300 bg-rose-50 text-rose-800')}>
                                {z.coreType === 'TOROIDAL' ? 'Toro' : 'Rect'}
                              </span>
                            </td>
                            <td className="hidden whitespace-nowrap px-2 py-1 text-[13px] text-slate-600 sm:table-cell">{z.grade}</td>
                            <td className="hidden whitespace-nowrap px-2 py-1 text-[13px] text-slate-600 md:table-cell">{z.material}</td>
                            <td className="px-2 py-1 text-right font-mono text-[13px] tabular-nums text-slate-700">{pcsFmt(z.pcs)}</td>
                            <td className="px-2 py-1 text-right font-mono text-[13px] tabular-nums text-slate-900">{kg(z.weight)}</td>
                            <td className="px-2 py-1 text-right font-mono text-[13px] tabular-nums text-slate-600">{num(z.amount)}</td>
                          </tr>
                        ))}
                      </Fragment>
                    ))}
                  </tbody>
                );
              })}

              {totals && (
                <tfoot>
                  <tr className="bg-slate-700 text-white">
                    <td className="px-2 py-1.5 text-[12.5px] font-bold uppercase tracking-wider sm:px-3" colSpan={4}>Grand Total</td>
                    <td className="px-2 py-1.5 text-right font-mono text-[15px] font-bold tabular-nums">{pcsFmt(totals.pcs)}</td>
                    <td className="px-2 py-1.5 text-right font-mono text-[15px] font-bold tabular-nums">{kg(totals.weight)}</td>
                    <td className="px-2 py-1.5 text-right font-mono text-[15px] font-bold tabular-nums">{num(totals.amount)}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </Panel>
      )}

      {/* ---------------- All entries: the flat register ---------------- */}
      {!isLoading && items.length > 0 && view === 'ENTRIES' && (
        <Panel title={<><List className="h-3.5 w-3.5" /> All Entries</>}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] border-collapse text-sm">
              <thead>
                <tr>
                  <Th size="md" className="sm:pl-3">Date</Th>
                  <Th>Employee</Th>
                  <Th size="md" align="center" className="w-[62px]">Type</Th>
                  <Th size="md" className="hidden sm:table-cell">Grade</Th>
                  <Th size="md" className="hidden md:table-cell">Material</Th>
                  <Th>Measure</Th>
                  <Th size="md" align="right" className="w-[68px]">Pcs</Th>
                  <Th size="md" align="right" className="w-[96px]">Weight (kg)</Th>
                  <Th size="md" align="right" className="w-[112px]">Amount</Th>
                </tr>
              </thead>
              <tbody>
                {items.map((r) => (
                  <tr key={r.id} className="odd:bg-white even:bg-slate-50/40 hover:bg-brand-50/50">
                    <td className="whitespace-nowrap px-2 py-1 text-[13.5px] text-slate-600 sm:pl-3">{fmt(r.prodDate)}</td>
                    <td className="whitespace-nowrap px-2 py-1 text-[13.5px] font-semibold text-slate-800">{r.labourName}</td>
                    <td className="px-1 py-1 text-center">
                      <span className={cn('inline-block rounded-sm border px-1 py-px font-mono text-[11px] font-bold uppercase',
                        r.coreType === 'TOROIDAL' ? 'border-amber-300 bg-amber-50 text-amber-800' : 'border-rose-300 bg-rose-50 text-rose-800')}>
                        {r.coreType === 'TOROIDAL' ? 'Toro' : 'Rect'}
                      </span>
                    </td>
                    <td className="hidden whitespace-nowrap px-2 py-1 text-[13px] text-slate-600 sm:table-cell">{r.grade}</td>
                    <td className="hidden whitespace-nowrap px-2 py-1 text-[13px] text-slate-600 md:table-cell">{r.material}</td>
                    <td className="whitespace-nowrap px-2 py-1 font-mono text-[13px] text-slate-700">{r.measure}</td>
                    <td className="px-2 py-1 text-right font-mono text-[13px] tabular-nums text-slate-700">{pcsFmt(r.pcs)}</td>
                    <td className="px-2 py-1 text-right font-mono text-[13px] tabular-nums text-slate-900">{kg(r.totalWeight)}</td>
                    <td className="px-2 py-1 text-right font-mono text-[13px] tabular-nums text-slate-600">{r.amount == null ? '—' : num(r.amount)}</td>
                  </tr>
                ))}
              </tbody>
              {totals && (
                <tfoot>
                  <tr className="bg-slate-700 text-white">
                    <td className="px-2 py-1.5 text-[12.5px] font-bold uppercase tracking-wider sm:px-3" colSpan={6}>Grand Total</td>
                    <td className="px-2 py-1.5 text-right font-mono text-[15px] font-bold tabular-nums">{pcsFmt(totals.pcs)}</td>
                    <td className="px-2 py-1.5 text-right font-mono text-[15px] font-bold tabular-nums">{kg(totals.weight)}</td>
                    <td className="px-2 py-1.5 text-right font-mono text-[15px] font-bold tabular-nums">{num(totals.amount)}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </Panel>
      )}
    </div>
  );
};

const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <label className="block">
    <span className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-slate-500">{label}</span>
    {children}
  </label>
);
