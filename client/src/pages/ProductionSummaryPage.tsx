// Production Summary — filterable report of production by employee, with type,
// size/measure, pcs, weight and amount. Filter by date range, employee and
// customer; download the filtered set as Excel.
import { Fragment, useMemo, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Factory, Loader2, Download, Search, ChevronDown, ChevronRight, FileText, X } from 'lucide-react';
import { api } from '@/lib/api';
import { useDebounced } from '@/hooks/useDebounced';
import { downloadXlsx, todayStamp } from '@/lib/excel';
import { downloadReportXlsx, type ReportRow } from '@/lib/xlsxReport';
import { SearchableSelect } from '@/components/SearchableSelect';
import { num } from '@/components/tally';
import { downloadProductionPdf, type ProductionPdf } from '@/lib/reportPdf';
import { brandColorFor } from '@/lib/brandColor';
import { useBranding } from '@/store/branding';
import { useHideCustomerNames } from '@/store/auth';
import {
  ErpCard, ErpLabel, ErpStat, ErpStatStrip, ErpTh, ErpSegmented, CoreTypeChip, SplitHeightChip, ProductionTabs, ErpMobileHeader,
} from '@/components/production/erp';

type Row = {
  id: string; prodDate: string; poNumber: string;
  customerName: string; customerCode: string | null;
  labourName: string; coreType: 'TOROIDAL' | 'RECTANGULAR';
  grade: string; material: string; measure: string;
  pcs: number; weightPerPc: number; totalWeight: number; amount: number | null;
  splitHeight: number | null;
};
type SummaryResp = { items: Row[]; totals: { pcs: number; weight: number; amount: number }; labours: string[] };

// dd-mm-yy, spelled out manually rather than via Intl — locale formatting
// options don't reliably guarantee this exact digit order + 2-digit year
// combination across browsers.
const fmt = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yy = String(d.getFullYear()).slice(-2);
  return `${dd}-${mm}-${yy}`;
};
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
  const debouncedSearch = useDebounced(search);
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
  if (debouncedSearch.trim()) qs.set('search', debouncedSearch.trim());

  const { data, isLoading } = useQuery({
    queryKey: ['production-summary', from, to, labour, customerId, debouncedSearch],
    queryFn: () => api<SummaryResp>(`/production/summary?${qs.toString()}`),
    // Keep the current rows visible while the next result loads, instead of
    // dropping the table back to "Loading…" on every filter or page change.
    placeholderData: keepPreviousData,
  });

  const brandColor = useBranding((st) => st.brandColor);
  const { data: company } = useQuery({
    queryKey: ['company-me'],
    queryFn: () => api<{ name?: string; address?: string; phone?: string; whatsappNumber?: string; email?: string; gstNumber?: string; logoUrl?: string }>('/companies/me'),
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
  const onExportByEmployee = async () => {
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

    await downloadReportXlsx({
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
        { header: 'Amount', width: 15, numFmt: '₹#,##0.00' },
      ],
      rows,
    });
  };

  /* Same tree the screen renders, on the shared A4 letterhead used by the
     packing list / testing report, so every document out of the system looks
     like it came from the same company. Always the FULL report — a section
     collapsed on screen is a viewing preference, not a filter. */
  const [pdfBusy, setPdfBusy] = useState(false);
  const onExportPdf = async () => {
    if (!employees.length || !totals || pdfBusy) return;
    setPdfBusy(true);
    try {
      const period = from && to ? `${fmt(from)} — ${fmt(to)}` : from ? `From ${fmt(from)}` : to ? `Up to ${fmt(to)}` : 'All dates';
      const bits: string[] = [];
      if (labour) bits.push(`Employee: ${labour}`);
      if (customerId) bits.push(`Customer: ${customerOptions.find((c) => c.value === customerId)?.label ?? customerId}`);
      if (search.trim()) bits.push(`Search: ${search.trim()}`);

      const data: ProductionPdf = {
        company: {
          name: company?.name, address: company?.address, phone: company?.phone,
          whatsappNumber: company?.whatsappNumber, email: company?.email,
          gstNumber: company?.gstNumber, logoUrl: company?.logoUrl,
        },
        brand: brandColorFor(company?.name) ?? brandColor,
        meta: {
          period,
          generated: fmt(new Date().toISOString()),
          employees: String(employees.length),
          days: String(dayCount),
          filters: bits.join('   ·   '),
        },
        totals,
        employees: employees.map((e) => ({
          name: e.name,
          days: e.days.length,
          sizes: new Set(e.days.flatMap((d) => d.sizes.map((z) => z.key))).size,
          pcs: e.pcs, weight: e.weight, amount: e.amount,
          rows: e.days.flatMap((d) => [
            { kind: 'day' as const, label: fmt(d.iso), pcs: d.pcs, weight: d.weight, amount: d.amount },
            ...d.sizes.map((z) => ({
              kind: 'size' as const, label: z.measure,
              type: z.coreType === 'TOROIDAL' ? 'Toro' : 'Rect',
              grade: z.grade, material: z.material,
              pcs: z.pcs, weight: z.weight, amount: z.amount,
            })),
          ]),
        })),
      };
      await downloadProductionPdf(data, `production-by-employee-${todayStamp()}.pdf`);
    } finally {
      setPdfBusy(false);
    }
  };

  const onExport = async () => {
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
    await downloadXlsx(`production-summary-${todayStamp()}`, 'Production Summary', rows);
  };

  const dayCount = new Set(employees.flatMap((e) => e.days.map((d) => d.key))).size;
  const hasFilters = !!from || !!to || !!labour || !!customerId || !!search.trim();
  const clearFilters = () => { setFrom(''); setTo(''); setLabour(''); setCustomerId(''); setSearch(''); };

  return (
    <div className="max-w-full space-y-3">
      {/* Title bar */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="flex items-center gap-2 font-manrope text-xl font-extrabold tracking-tight text-slate-900 sm:text-2xl">
          <Factory className="h-4.5 w-4.5 text-brand-600" /> Production Summary
        </h1>
        <div className="flex flex-wrap items-center gap-2">
          <ErpSegmented
            value={view}
            onChange={setView}
            options={[{ value: 'BY_EMPLOYEE', label: 'By Employee' }, { value: 'ENTRIES', label: 'All Entries' }]}
          />
          <button
            onClick={onExport}
            disabled={!items.length}
            className="inline-flex min-h-[32px] items-center gap-1.5 rounded border border-slate-200 bg-white px-3 font-manrope text-[11px] font-extrabold uppercase tracking-wide text-emerald-700 transition-colors duration-200 hover:bg-emerald-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 disabled:opacity-40 motion-reduce:transition-none"
            title="Download the report as a formatted Excel sheet"
          >
            <Download className="h-3.5 w-3.5" /> Excel
          </button>
          <button
            onClick={onExportPdf}
            disabled={!employees.length || pdfBusy}
            className="inline-flex min-h-[32px] items-center gap-1.5 rounded border border-slate-200 bg-white px-3 font-manrope text-[11px] font-extrabold uppercase tracking-wide text-rose-700 transition-colors duration-200 hover:bg-rose-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 disabled:opacity-40 motion-reduce:transition-none"
            title="Download the report as a formatted A4 PDF"
          >
            {pdfBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileText className="h-3.5 w-3.5" />} PDF
          </button>
        </div>
      </div>

      <ProductionTabs />

      {totals && !isLoading && (
        <ErpMobileHeader
          subtitle={hasFilters ? 'Filtered' : 'All dates'}
          primary={{ label: 'Total Amount', value: '₹' + num(totals.amount) }}
          stats={[{ label: 'Pcs', value: pcsFmt(totals.pcs) }, { label: 'Weight', value: `${kg(totals.weight)} kg` }]}
        />
      )}

      {/* overflow-visible: the Employee/Customer pickers render their menu as
          an absolutely-positioned child, and the card below clips by default. */}
      <ErpCard className="overflow-visible">
        {/* Filter toolbar — one row, matches Modify's layout. */}
        <div className="flex flex-col gap-2.5 p-3 lg:flex-row lg:items-end lg:flex-wrap">
          <div className="w-32">
            <ErpLabel className="mb-1 block">From</ErpLabel>
            <input type="date" className="input h-9 text-sm" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="w-32">
            <ErpLabel className="mb-1 block">To</ErpLabel>
            <input type="date" className="input h-9 text-sm" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <div className="w-44">
            <ErpLabel className="mb-1 block">Employee</ErpLabel>
            <SearchableSelect value={labour} onChange={setLabour} options={labourOptions} placeholder="All employees" />
          </div>
          <div className="w-52">
            <ErpLabel className="mb-1 block">Customer</ErpLabel>
            <SearchableSelect value={customerId} onChange={setCustomerId} options={customerOptions} placeholder="All customers" />
          </div>
          <div className="relative min-w-0 flex-1">
            <ErpLabel className="mb-1 block">Search</ErpLabel>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <input className="input h-9 pl-8 text-sm" placeholder="PO, grade, measure…" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
          </div>
          {hasFilters && (
            <button onClick={clearFilters} className="flex h-9 items-center gap-1 font-manrope text-[11px] font-extrabold uppercase tracking-wide text-brand-700 hover:text-brand-800">
              <X className="h-3 w-3" /> Clear
            </button>
          )}
          {view === 'BY_EMPLOYEE' && employees.length > 0 && (
            <button
              onClick={() => setCollapsed(allCollapsed ? new Set() : new Set(employees.map((e) => e.name)))}
              className="flex h-9 items-center gap-1 rounded border border-slate-200 bg-white px-2.5 font-manrope text-[11px] font-extrabold uppercase tracking-wide text-slate-600 hover:bg-slate-50 lg:ml-auto"
            >
              {allCollapsed ? 'Expand all' : 'Collapse all'}
            </button>
          )}
        </div>

        {/* KPI strip */}
        {totals && !isLoading && (
          <ErpStatStrip>
            <ErpStat label="Employees" value={String(employees.length)} />
            <ErpStat label="Days" value={String(dayCount)} />
            <ErpStat label="Total Pcs" value={pcsFmt(totals.pcs)} />
            <ErpStat label="Total Weight" value={`${kg(totals.weight)} kg`} />
            <ErpStat label="Total Amount" value={'₹' + num(totals.amount)} tone="brand" />
          </ErpStatStrip>
        )}

        {isLoading && (
          <div className="border-t border-slate-100 p-10 text-center text-slate-400">
            <Loader2 className="mx-auto h-5 w-5 animate-spin" />
          </div>
        )}
        {!isLoading && !items.length && (
          <div className="border-t border-slate-100 p-10 text-center text-sm text-slate-500">
            No production records for these filters.
          </div>
        )}

        {/* ---------------- By employee: one continuous columnar report ----------------
            A single table for every employee (rather than a table per card) so the
            figures line up in one column down the whole page — the thing that makes
            a printed ERP report readable. */}
        {!isLoading && items.length > 0 && view === 'BY_EMPLOYEE' && (
          <div className="overflow-x-auto border-t border-slate-100">
            <table className="w-full min-w-[680px] border-collapse text-[13px]">
              <thead>
                <tr>
                  <ErpTh className="pl-3">Employee / Date / Size</ErpTh>
                  <ErpTh align="center" className="w-[62px]">Type</ErpTh>
                  <ErpTh className="hidden w-[104px] sm:table-cell">Grade</ErpTh>
                  <ErpTh className="hidden w-[112px] md:table-cell">Material</ErpTh>
                  <ErpTh align="right" className="w-[68px]">Pcs</ErpTh>
                  <ErpTh align="right" className="w-[96px]">Weight (kg)</ErpTh>
                  <ErpTh align="right" className="w-[112px]">Amount</ErpTh>
                </tr>
              </thead>

              {employees.map((e) => {
                const open = !collapsed.has(e.name);
                const share = totals && totals.weight > 0 ? e.weight / totals.weight : 0;
                const sizeCount = new Set(e.days.flatMap((d) => d.sizes.map((z) => z.key))).size;
                return (
                  <tbody key={e.name} className="border-b-2 border-slate-100 last:border-b-0">
                    {/* Employee band */}
                    <tr className="bg-slate-50">
                      <td className="p-0" colSpan={4}>
                        <button
                          onClick={() => toggleEmp(e.name)}
                          aria-expanded={open}
                          className="flex min-h-[38px] w-full items-center gap-2 px-2 py-1.5 text-left transition-colors duration-200 hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500 motion-reduce:transition-none sm:px-3"
                        >
                          {open
                            ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-slate-500" aria-hidden />
                            : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-500" aria-hidden />}
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-manrope text-[14px] font-extrabold uppercase tracking-wide text-slate-800">{e.name}</span>
                            <span className="mt-0.5 flex items-center gap-1.5">
                              <span className="h-1 w-14 overflow-hidden rounded-sm bg-slate-200 sm:w-20">
                                <span className="block h-full bg-brand-500" style={{ width: `${Math.max(share * 100, 2)}%` }} />
                              </span>
                              <span className="font-ibmmono text-[11px] tabular-nums text-slate-500">
                                {(share * 100).toFixed(1)}% · {e.days.length}d · {sizeCount} size{sizeCount === 1 ? '' : 's'}
                              </span>
                            </span>
                          </span>
                        </button>
                      </td>
                      <td className="px-2 py-1.5 text-right font-ibmmono text-[14px] font-bold tabular-nums text-slate-800">{pcsFmt(e.pcs)}</td>
                      <td className="px-2 py-1.5 text-right font-ibmmono text-[14px] font-bold tabular-nums text-slate-900">{kg(e.weight)}</td>
                      <td className="px-2 py-1.5 text-right font-ibmmono text-[14px] font-bold tabular-nums text-brand-700">{num(e.amount)}</td>
                    </tr>

                    {open && e.days.map((d) => (
                      <Fragment key={d.key}>
                        {/* Day sub-total */}
                        <tr className="bg-white">
                          <th scope="rowgroup" className="whitespace-nowrap border-b border-slate-100 py-1 pl-7 pr-2 text-left text-[13px] font-bold text-slate-700 sm:pl-9">{fmt(d.iso)}</th>
                          <td className="hidden border-b border-slate-100 px-2 py-1 font-manrope text-[10px] uppercase tracking-wider text-slate-400 sm:table-cell" colSpan={3}>Day total</td>
                          <td className="border-b border-slate-100 px-2 py-1 text-right font-ibmmono text-[13px] font-semibold tabular-nums text-slate-700">{pcsFmt(d.pcs)}</td>
                          <td className="border-b border-slate-100 px-2 py-1 text-right font-ibmmono text-[13px] font-semibold tabular-nums text-slate-800">{kg(d.weight)}</td>
                          <td className="border-b border-slate-100 px-2 py-1 text-right font-ibmmono text-[13px] font-semibold tabular-nums text-slate-700">{num(d.amount)}</td>
                        </tr>
                        {/* Size lines */}
                        {d.sizes.map((z) => (
                          <tr key={z.key} className="odd:bg-white even:bg-slate-50/40 hover:bg-brand-50/50">
                            <td className="whitespace-nowrap py-1 pl-10 pr-2 font-ibmmono text-[12.5px] text-slate-700 sm:pl-14">{z.measure}</td>
                            <td className="px-1 py-1 text-center"><CoreTypeChip coreType={z.coreType} /></td>
                            <td className="hidden whitespace-nowrap px-2 py-1 text-[12.5px] text-slate-600 sm:table-cell">{z.grade}</td>
                            <td className="hidden whitespace-nowrap px-2 py-1 text-[12.5px] text-slate-600 md:table-cell">{z.material}</td>
                            <td className="px-2 py-1 text-right font-ibmmono text-[12.5px] tabular-nums text-slate-700">{pcsFmt(z.pcs)}</td>
                            <td className="px-2 py-1 text-right font-ibmmono text-[12.5px] tabular-nums text-slate-900">{kg(z.weight)}</td>
                            <td className="px-2 py-1 text-right font-ibmmono text-[12.5px] tabular-nums text-slate-600">{num(z.amount)}</td>
                          </tr>
                        ))}
                      </Fragment>
                    ))}
                  </tbody>
                );
              })}

              {totals && (
                <tfoot>
                  <tr className="bg-brand-900 text-white">
                    <td className="px-2 py-1.5 pl-3 font-manrope text-[11px] font-bold uppercase tracking-wider" colSpan={4}>Grand Total</td>
                    <td className="px-2 py-1.5 text-right font-ibmmono text-[14px] font-bold tabular-nums">{pcsFmt(totals.pcs)}</td>
                    <td className="px-2 py-1.5 text-right font-ibmmono text-[14px] font-bold tabular-nums">{kg(totals.weight)}</td>
                    <td className="px-2 py-1.5 text-right font-ibmmono text-[14px] font-bold tabular-nums">{num(totals.amount)}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )}

        {/* ---------------- All entries: the flat register ---------------- */}
        {!isLoading && items.length > 0 && view === 'ENTRIES' && (
          <div className="overflow-x-auto border-t border-slate-100">
            <table className="w-full min-w-[760px] border-collapse text-[13px]">
              <thead>
                <tr>
                  <ErpTh className="pl-3">Date</ErpTh>
                  <ErpTh>Employee</ErpTh>
                  <ErpTh align="center" className="w-[62px]">Type</ErpTh>
                  <ErpTh className="hidden sm:table-cell">Grade</ErpTh>
                  <ErpTh className="hidden md:table-cell">Material</ErpTh>
                  <ErpTh>Measure</ErpTh>
                  <ErpTh align="right" className="w-[68px]">Pcs</ErpTh>
                  <ErpTh align="right" className="w-[96px]">Weight (kg)</ErpTh>
                  <ErpTh align="right" className="w-[112px]">Amount</ErpTh>
                </tr>
              </thead>
              <tbody>
                {items.map((r) => (
                  <tr key={r.id} className="odd:bg-white even:bg-slate-50/40 hover:bg-brand-50/50">
                    <td className="whitespace-nowrap px-2 py-1 pl-3 text-[13px] text-slate-600">{fmt(r.prodDate)}</td>
                    <td className="whitespace-nowrap px-2 py-1 text-[13px] font-semibold text-slate-800">{r.labourName}</td>
                    <td className="px-1 py-1 text-center"><CoreTypeChip coreType={r.coreType} /></td>
                    <td className="hidden whitespace-nowrap px-2 py-1 text-[12.5px] text-slate-600 sm:table-cell">{r.grade}</td>
                    <td className="hidden whitespace-nowrap px-2 py-1 text-[12.5px] text-slate-600 md:table-cell">{r.material}</td>
                    <td className="whitespace-nowrap px-2 py-1 font-ibmmono text-[12.5px] text-slate-700">
                      <div className="flex items-center gap-1.5">
                        {r.measure}
                        {r.splitHeight != null && <SplitHeightChip height={r.splitHeight} />}
                      </div>
                    </td>
                    <td className="px-2 py-1 text-right font-ibmmono text-[12.5px] tabular-nums text-slate-700">{pcsFmt(r.pcs)}</td>
                    <td className="px-2 py-1 text-right font-ibmmono text-[12.5px] tabular-nums text-slate-900">{kg(r.totalWeight)}</td>
                    <td className="px-2 py-1 text-right font-ibmmono text-[12.5px] tabular-nums text-slate-600">{r.amount == null ? '—' : num(r.amount)}</td>
                  </tr>
                ))}
              </tbody>
              {totals && (
                <tfoot>
                  <tr className="bg-brand-900 text-white">
                    <td className="px-2 py-1.5 pl-3 font-manrope text-[11px] font-bold uppercase tracking-wider" colSpan={6}>Grand Total</td>
                    <td className="px-2 py-1.5 text-right font-ibmmono text-[14px] font-bold tabular-nums">{pcsFmt(totals.pcs)}</td>
                    <td className="px-2 py-1.5 text-right font-ibmmono text-[14px] font-bold tabular-nums">{kg(totals.weight)}</td>
                    <td className="px-2 py-1.5 text-right font-ibmmono text-[14px] font-bold tabular-nums">{num(totals.amount)}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )}
      </ErpCard>
    </div>
  );
};
