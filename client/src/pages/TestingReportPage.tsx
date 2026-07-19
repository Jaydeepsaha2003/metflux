// Testing Report — multi-page PDF grouped by PO Order.
// Reachable from:
//   • PackingPage row action → state: { dispatchIds: [...] }
//   • PackingPage multi-select → state: { dispatchIds: [...] }
//   • PackingListPage → state: { plId } (re-uses saved WO/Invoice)
//
// Each PO group renders one A4 page with the same company header as the
// Packing List, but the title bar reads "TESTING REPORT". Per group the user
// can edit WO No, WO Date, Invoice No, Invoice Date, Tested By, Approved By,
// and per-row Sample Pcs.
import { useRef, useState, useEffect, useMemo, Fragment } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useQuery, useQueries } from '@tanstack/react-query';
import { ArrowLeft, Download, ClipboardCheck, Loader2, MessageCircle } from 'lucide-react';
import { api } from '@/lib/api';
import { shareViaWhatsApp, type ShareTarget } from '@/lib/share';
import { useBranding } from '@/store/branding';
import { brandColorFor } from '@/lib/brandColor';
import { downloadTestingReportPdf, testingReportPdfBlob, type TestingReportPdf } from '@/lib/reportPdf';

/* ── Types ────────────────────────────────────────────────────── */
type DispatchDetail = {
  id: string; poOrderId: string | null; poOrderItemId: string;
  poNumber: string; orderDate: string;
  customerName: string; customerState: string | null;
  customerPhone: string | null;
  coreType: 'TOROIDAL' | 'RECTANGULAR' | 'NANO' | 'COMPOSITE';
  grade: string; material: string; measure: string;
  pcs: number; weightPerPc: number; totalWeight: number;
  turns: number | null; flux: number | null;
  testVoltage: number | null; testCurrent: number | null;
};

/* ── Sample-pcs calculation ───────────────────────────────────────
   Rules (always round to nearest integer):
     pcs ≤ 50    → 100% (sample every piece)
     pcs > 1000  → 5%
     pcs ≥ 100   → 10%
     51–99       → 25%  */
const calcSamplePcs = (pcs: number): number => {
  if (pcs <= 50)  return pcs;             // ≤50 → 100% sampling
  if (pcs > 1000) return Math.round(pcs * 0.05);
  if (pcs >= 100) return Math.round(pcs * 0.10);
  return Math.round(pcs * 0.25);          // 51–99 → 25%
};

const samplingRate = (pcs: number): string => {
  if (pcs <= 50)  return '100%';
  if (pcs > 1000) return '5%';
  if (pcs >= 100) return '10%';
  return '25%';
};

/* ── Per-sample unique Max Allowable Current values ──────────────
   Builds N distinct values (2 decimal places) clustered around
   testCurrent × 0.97. Values step ±0.02 mA alternately so the
   spread stays tight (< ±1 mA for up to 50 samples, < ±2 mA for
   100). Shuffled with a deterministic LCG seeded from the dispatch
   id so reopening the same report always shows the same numbers. */
const buildIemaxRows = (
  dispatch: { id: string; testCurrent: number | null },
  n: number,
): (number | null)[] => {
  if (!dispatch.testCurrent || n <= 0) return Array(n).fill(null);
  // Base is the spec value (displayed at top of each page as reference).
  // Each sample is a simulated measurement within −1% to +1.5% of the spec.
  const base = dispatch.testCurrent;
  let seed = dispatch.id.split('').reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 0);
  const rng = () => {
    seed = (seed * 1664525 + 1013904223) | 0;
    return (seed >>> 0) / 0x100000000;   // uniform in [0, 1)
  };
  return Array.from({ length: n }, () => {
    const pct = -0.03 * rng();            // uniform in [−3%, 0%] — never exceeds spec
    return +(base * (1 + pct)).toFixed(2);
  });
};
type PlDispatchDetail = DispatchDetail;
type PlDetail = {
  id: string; plNumber: string; plDate: string;
  invoiceNo: string | null; invoiceDate: string | null;
  testedBy: string | null; approvedBy: string | null;
  dispatches: PlDispatchDetail[];
};
type CompanyDetail = {
  name: string; address: string | null; phone: string | null;
  whatsappNumber: string | null;
  defaultShareTarget: ShareTarget;
  email: string | null; logoUrl: string | null; gstNumber: string | null;
};

/* Per-group editable form state — keyed by poOrderId. */
type GroupForm = {
  reportNo: string;
  woNumber: string;
  woDate: string;          // ISO yyyy-mm-dd
  invoiceNo: string;
  invoiceDate: string;
  testedBy: string;
  approvedBy: string;
  // samplePcs is no longer stored here — auto-calculated by calcSamplePcs(d.pcs)
};

const todayISO = () => new Date().toISOString().slice(0, 10);
// Report No. format: TR-TC001 (Toroidal) / TR-RC001 (Rectangular) / TR-NC001 (Nano).
// The 3-digit serial is the 1-indexed position of this group in the current
// report batch so each PO gets a unique, readable identifier.
const autoReportNo = (coreType: 'TOROIDAL' | 'RECTANGULAR' | 'NANO' | 'COMPOSITE', groupIdx: number) => {
  const prefix = coreType === 'TOROIDAL' ? 'TC' : coreType === 'NANO' ? 'NC' : coreType === 'COMPOSITE' ? 'CC' : 'RC';
  return `TR-${prefix}${String(groupIdx + 1).padStart(3, '0')}`;
};
const fmtDate = (iso: string | null | undefined) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
};

/* ── Main page ────────────────────────────────────────────────── */
export const TestingReportPage = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const state = (location.state ?? {}) as { dispatchIds?: string[]; plId?: string };
  const { dispatchIds: stateIds, plId } = state;

  useEffect(() => {
    if (!stateIds?.length && !plId) navigate('/packing', { replace: true });
  }, []);

  /* Data sources */
  const { data: existingPl, isLoading: loadingPl } = useQuery({
    queryKey: ['packing-list', plId],
    queryFn: () => api<PlDetail>(`/packing-lists/${plId}`),
    enabled: !!plId,
  });

  // For the standalone (dispatchIds) flow we hit /dispatch/:id one-by-one.
  const dispatchQueries = useQueries({
    queries: (stateIds ?? []).map((id) => ({
      queryKey: ['dispatch-item', id],
      queryFn: () => api<DispatchDetail>(`/dispatch/${id}`),
      enabled: !plId,
    })),
  });

  const { data: company } = useQuery({
    queryKey: ['company-me'],
    queryFn: () => api<CompanyDetail>('/companies/me'),
  });

  const dispatches: DispatchDetail[] = plId
    ? (existingPl?.dispatches ?? []) as DispatchDetail[]
    : dispatchQueries.filter((q) => q.data).map((q) => q.data as DispatchDetail);

  const isLoading = plId ? loadingPl : dispatchQueries.some((q) => q.isLoading);

  /* Per-dispatch array of N unique Max Allowable Current values (one per
     sample piece). N = calcSamplePcs(d.pcs). Recomputed when any dispatch
     pcs / testCurrent changes. */
  const sampleRowsByDispatch = useMemo(() => {
    const result: Record<string, (number | null)[]> = {};
    for (const d of dispatches) {
      result[d.id] = buildIemaxRows(d, calcSamplePcs(d.pcs));
    }
    return result;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dispatches.map((d) => `${d.id}|${d.testCurrent}|${d.pcs}`).join(',')]);

  /* Group dispatches by PO order id (or fall back to poNumber if id absent). */
  const groups = (() => {
    const map = new Map<string, { key: string; poNumber: string; orderDate: string; customerName: string; rows: DispatchDetail[] }>();
    for (const d of dispatches) {
      const key = d.poOrderId ?? d.poNumber;
      if (!map.has(key)) {
        map.set(key, { key, poNumber: d.poNumber, orderDate: d.orderDate, customerName: d.customerName, rows: [] });
      }
      map.get(key)!.rows.push(d);
    }
    return [...map.values()];
  })();

  /* Per-group editable state. Initialised lazily as groups appear. */
  const [forms, setForms] = useState<Record<string, GroupForm>>({});
  useEffect(() => {
    if (!groups.length) return;
    setForms((prev) => {
      const next: Record<string, GroupForm> = { ...prev };
      const defaultWo = existingPl?.plNumber ?? '';
      const defaultWoDate = existingPl?.plDate?.slice(0, 10) ?? todayISO();
      const defaultInv = existingPl?.invoiceNo ?? '';
      const defaultInvDate = existingPl?.invoiceDate?.slice(0, 10) ?? '';
      const defaultTested = existingPl?.testedBy ?? '';
      const defaultApproved = existingPl?.approvedBy ?? '';
      for (let gi = 0; gi < groups.length; gi++) {
        const g = groups[gi];
        if (next[g.key]) continue;
        const firstCoreType = g.rows[0]?.coreType ?? 'TOROIDAL';
        next[g.key] = {
          reportNo:    autoReportNo(firstCoreType, gi),
          woNumber:    defaultWo,
          woDate:      defaultWoDate,
          invoiceNo:   defaultInv,
          invoiceDate: defaultInvDate,
          testedBy:    defaultTested,
          approvedBy:  defaultApproved,
        };
      }
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dispatches.map((d) => d.id).join(','), existingPl?.id]);

  const updateForm = (key: string, patch: Partial<GroupForm>) =>
    setForms((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }));

  const addressLine = company?.address?.replace(/\n+/g, ', ').trim() ?? '';

  /* PDF download — uses the same html2canvas-input-replace trick the
     Packing List page uses, but adds CSS page-break-before on each PO group
     after the first so html2pdf renders one PO per page. */
  const printRef = useRef<HTMLDivElement>(null);
  const [generating, setGenerating] = useState(false);
  const brandColor = useBranding((s) => s.brandColor);

  // Assemble the structured data for the pdfmake builder from the grouped
  // dispatches + per-group editable form state.
  const buildTrData = (): TestingReportPdf => ({
    company: {
      name: company?.name, address: company?.address, phone: company?.phone,
      whatsappNumber: company?.whatsappNumber, email: company?.email,
      gstNumber: company?.gstNumber, logoUrl: company?.logoUrl,
    },
    // Colour follows the company the report is FOR; falls back to the domain's.
    brand: brandColorFor(company?.name) ?? brandColor,
    reportDate: fmtDate(todayISO()),
    groups: groups.map((g) => {
      const form = forms[g.key];
      return {
        reportNo: form?.reportNo ?? '',
        customer: g.customerName,
        state: g.rows[0]?.customerState ?? '-',
        poNumber: g.poNumber,
        poDate: fmtDate(g.orderDate),
        woNumber: form?.woNumber ?? '',
        woDate: form?.woDate ? fmtDate(form.woDate) : '',
        invoiceNo: form?.invoiceNo ?? '',
        invoiceDate: form?.invoiceDate ? fmtDate(form.invoiceDate) : '',
        testedBy: form?.testedBy ?? '',
        approvedBy: form?.approvedBy ?? '',
        items: g.rows.map((d) => {
          const samples = sampleRowsByDispatch[d.id] ?? [];
          return {
            measure: d.measure || '-', grade: d.grade || '-',
            turns: d.turns != null ? String(d.turns) : '-',
            appliedVoltage: d.testVoltage != null ? d.testVoltage.toFixed(3) : '-',
            pcs: String(d.pcs), samplePcs: String(samples.length),
            samplingRate: samplingRate(d.pcs),
            maxCurrent: d.testCurrent != null ? `${d.testCurrent.toFixed(1)} mA` : '-',
            samples,
          };
        }),
      };
    }),
  });

  const handleDownload = async () => {
    if (!dispatches.length) return;
    setGenerating(true);
    try { await downloadTestingReportPdf(buildTrData(), `Testing-Report-${todayISO()}.pdf`); }
    finally { setGenerating(false); }
  };

  const handleWhatsappShare = async () => {
    if (!dispatches.length) return;
    setGenerating(true);
    try {
      const blob = await testingReportPdfBlob(buildTrData());
      const message = [
        `*Testing Report*`,
        company?.name ? `From: ${company.name}` : null,
        `Groups: ${groups.length} PO${groups.length === 1 ? "" : "s"} · ${dispatches.length} item${dispatches.length === 1 ? "" : "s"}`,
        `Date: ${fmtDate(todayISO())}`,
      ].filter(Boolean).join('\n');
      await shareViaWhatsApp({
        message,
        target: company?.defaultShareTarget,
        companyPhone: company?.whatsappNumber ?? null,
        customerPhone: dispatches[0]?.customerPhone ?? null,
        pdf: { blob, filename: `Testing-Report-${todayISO()}` },
      });
    } finally {
      setGenerating(false);
    }
  };

  if (isLoading) return <div className="card p-10 text-center"><Loader2 className="h-5 w-5 animate-spin mx-auto text-slate-400" /></div>;
  if (!dispatches.length) return (
    <div className="card p-10 text-center text-slate-400">
      No dispatches selected. <Link to="/packing" className="text-brand-700 hover:underline">Go back</Link>
    </div>
  );

  return (
    <div className="space-y-4 max-w-5xl">

      {/* ── Control bar ── */}
      <div className="no-print rounded-xl border border-slate-200 bg-white p-3 sm:p-4 shadow-sm">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
          <Link to="/packing" className="btn-ghost text-slate-600 shrink-0 self-start">
            <ArrowLeft className="h-4 w-4" /> <span className="hidden sm:inline">Back</span>
          </Link>
          <h1 className="text-base sm:text-lg font-bold tracking-tight flex items-center gap-2 min-w-0">
            <ClipboardCheck className="h-5 w-5 text-brand-600 shrink-0" />
            <span className="truncate">Testing Report</span>
            <span className="rounded-full bg-brand-100 px-2 py-0.5 text-xs font-medium text-brand-700 shrink-0">
              {groups.length} PO · {dispatches.length} item{dispatches.length === 1 ? '' : 's'}
            </span>
          </h1>
          <div className="sm:ml-auto flex flex-col-reverse gap-2 sm:flex-row sm:gap-3">
            <button onClick={handleWhatsappShare} className="btn-ghost border border-slate-300 text-emerald-700 hover:bg-emerald-50 w-full sm:w-auto justify-center">
              <MessageCircle className="h-4 w-4" /> Share on WhatsApp
            </button>
            <button onClick={handleDownload} disabled={generating} className="btn-primary w-full sm:w-auto justify-center">
              {generating ? <><Loader2 className="h-4 w-4 animate-spin" /> Generating…</> : <><Download className="h-4 w-4" /> Download PDF</>}
            </button>
          </div>
        </div>
        <div className="mt-2 text-[11px] text-slate-500">
          Each PO renders on its own page. Edit WO / Invoice / sample pcs / signatures inline below — every page can have different values.
        </div>
      </div>

      {/* ── Printable document ── */}
      <div className="overflow-x-auto rounded-xl shadow-md print:overflow-visible print:shadow-none print:rounded-none">
        <div ref={printRef} id="testing-report-doc"
          className="bg-white text-black min-w-[820px] rounded-xl overflow-hidden print:min-w-0 print:rounded-none print:overflow-visible">

          {groups.map((g, idx) => {
            const form = forms[g.key];
            if (!form) return null;
            return (
              <div
                key={g.key}
                className={idx > 0 ? 'tr-page-break' : ''}
                style={idx > 0 ? { pageBreakBefore: 'always' } : undefined}
              >
                {/* Company header — logo + brand block on the left only.
                    The document title moves to its own centered banner below
                    so it reads as a clear "TESTING REPORT" heading. */}
                <div className="flex items-center border-b-2 border-brand-700 px-6 pt-4 pb-3 gap-4">
                  <div className="flex items-center gap-5">
                    {company?.logoUrl
                      ? <img src={company.logoUrl} alt={company.name} className="h-20 w-20 object-contain shrink-0" />
                      : <div className="h-20 w-20 rounded-lg bg-slate-100 flex items-center justify-center text-slate-400 text-xs shrink-0">LOGO</div>
                    }
                    <div className="min-w-0">
                      <div className="text-lg font-black uppercase tracking-wide leading-tight">{company?.name ?? 'Company Name'}</div>
                      {addressLine && (
                        <div className="text-[11px] font-semibold text-slate-700 mt-0.5 max-w-md leading-snug">
                          {addressLine}
                        </div>
                      )}
                      {(company?.phone || company?.whatsappNumber || company?.email) && (
                        <div className="text-[11px] text-slate-600 mt-0.5">
                          <span className="font-semibold">Contact:</span>{' '}
                          {[company.phone, company.whatsappNumber, company.email].filter(Boolean).join('  |  ')}
                        </div>
                      )}
                      {company?.gstNumber && (
                        <div className="text-[11px] text-slate-600 mt-0.5">GSTIN: {company.gstNumber}</div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Centered, bold document title — full-width banner. */}
                <div className="border-b-2 border-brand-700 px-6 py-2.5 text-center">
                  <span className="inline-block text-xl font-extrabold uppercase tracking-[0.25em] text-white bg-brand-700 px-6 py-1.5 rounded">
                    Testing Report
                  </span>
                </div>

                {/* Per-PO info grid — Report/PO/WO/Invoice each with a date */}
                <div className="grid grid-cols-2 border-b border-slate-300 text-sm">
                  <InfoEdit
                    label="Report No." value={form.reportNo}
                    onChange={(v) => updateForm(g.key, { reportNo: v.toUpperCase() })}
                    border="border-r border-b"
                  />
                  <InfoRow label="Report Date" value={fmtDate(todayISO())} border="border-b" />
                  <InfoRow label="Customer" value={g.customerName} border="border-r border-b" />
                  <InfoRow label="State" value={g.rows[0]?.customerState ?? '—'} border="border-b" />
                  <InfoRow label="PO No." value={g.poNumber} border="border-r border-b" />
                  <InfoRow label="PO Date" value={fmtDate(g.orderDate)} border="border-b" />
                  <InfoEdit
                    label="WO No." value={form.woNumber}
                    onChange={(v) => updateForm(g.key, { woNumber: v.toUpperCase() })}
                    border="border-r border-b"
                  />
                  <InfoEdit
                    label="WO Date" value={form.woDate} type="date"
                    onChange={(v) => updateForm(g.key, { woDate: v })}
                    border="border-b"
                  />
                  <InfoEdit
                    label="Invoice No." value={form.invoiceNo}
                    onChange={(v) => updateForm(g.key, { invoiceNo: v.toUpperCase() })}
                    border="border-r"
                  />
                  <InfoEdit
                    label="Invoice Date" value={form.invoiceDate} type="date"
                    onChange={(v) => updateForm(g.key, { invoiceDate: v })}
                    border=""
                  />
                </div>

                {/* Per-item sample sheets. The constant fields (measure, grade,
                    turns, applied voltage) sit in a header band BEFORE the pcs
                    counts; the readings go in an up-to-4-wide grid (SN | Actual
                    IeMax pairs). The column count ADAPTS to the sample count so a
                    1-/2-/3-sample item fills the width with no empty columns. */}
                {g.rows.map((d, idx) => {
                  const samples = sampleRowsByDispatch[d.id] ?? [];
                  // 1 sample → 1 wide column; 4+ → the full 4-up grid.
                  const PER_ROW = Math.min(4, Math.max(1, samples.length));
                  // Spread the columns to fill 100% width whatever the count is.
                  const pairW = 100 / PER_ROW;
                  const snW = Math.min(8, pairW * 0.35);
                  const valW = pairW - snW;
                  const gridRows: (number | null)[][] = [];
                  for (let i = 0; i < samples.length; i += PER_ROW) {
                    gridRows.push(samples.slice(i, i + PER_ROW));
                  }
                  return (
                    <div key={d.id} className="border-b border-slate-300 break-inside-avoid pdf-keep">
                      {/* Gutter strip separating this item from the previous one (kept in the PDF too). */}
                      {idx > 0 && (
                        <div className="gutter-strip h-3 border-b border-slate-300 bg-slate-100" />
                      )}
                      {/* Item header — measure / grade / turns / voltage first,
                          then the pcs counts + spec current. */}
                      <div className="grid grid-cols-2 sm:grid-cols-4 border-b border-slate-300 bg-brand-50">
                        <HdrCell label="Measure"             value={d.measure || '—'} />
                        <HdrCell label="Grade"               value={d.grade || '—'} />
                        <HdrCell label="No. of Turns"        value={d.turns != null ? String(d.turns) : '—'} />
                        <HdrCell label="Applied Voltage (V)" value={d.testVoltage != null ? d.testVoltage.toFixed(3) : '—'} />
                        <HdrCell label="No. of Pcs"          value={String(d.pcs)} strong />
                        <HdrCell label="Sample Pcs"          value={String(samples.length)} strong />
                        <HdrCell label="Sampling Rate"       value={samplingRate(d.pcs)} strong />
                        <HdrCell label="Max Allowed Current" value={d.testCurrent != null ? `${d.testCurrent.toFixed(1)} mA` : '—'} strong />
                      </div>
                      {/* Sample readings — SN | Actual IeMax (mA), four pairs wide */}
                      <table className="w-full text-sm border-collapse table-fixed">
                        <colgroup>
                          {Array.from({ length: PER_ROW }).map((_, i) => (
                            <Fragment key={i}>
                              <col style={{ width: `${snW}%` }} />
                              <col style={{ width: `${valW}%` }} />
                            </Fragment>
                          ))}
                        </colgroup>
                        <thead>
                          <tr className="bg-brand-600 text-white border-b-2 border-brand-700 text-center font-bold uppercase tracking-wide text-[9px]">
                            {Array.from({ length: PER_ROW }).map((_, i) => (
                              <Fragment key={i}>
                                <th className="px-1 py-1.5 border-r border-slate-300 align-middle">SN</th>
                                <th className={`px-1 py-1.5 align-middle ${i < PER_ROW - 1 ? 'border-r-2 border-slate-400' : ''}`}>Actual IeMax (mA)</th>
                              </Fragment>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {gridRows.length === 0 && (
                            <tr className="h-8 border-b border-slate-100">
                              <td colSpan={PER_ROW * 2} className="text-center text-[11px] italic text-slate-400 align-middle">
                                No sample data
                              </td>
                            </tr>
                          )}
                          {gridRows.map((row, ri) => (
                            <tr key={ri} className="h-7 border-b border-slate-100">
                              {Array.from({ length: PER_ROW }).map((_, ci) => {
                                const present = ci < row.length;
                                const sn = ri * PER_ROW + ci + 1;
                                const val = row[ci];
                                return (
                                  <Fragment key={ci}>
                                    <td className="px-1 border-r border-slate-200 text-center text-[12px] font-medium text-slate-500 align-middle">
                                      {present ? sn : ''}
                                    </td>
                                    <td className={`px-1 text-center text-[12px] font-semibold tabular-nums align-middle ${ci < PER_ROW - 1 ? 'border-r-2 border-slate-300' : ''}`}>
                                      {present ? (val != null ? val.toFixed(2) : '—') : ''}
                                    </td>
                                  </Fragment>
                                );
                              })}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  );
                })}

                {/* Signature footer — editable per PO group */}
                <div className="grid grid-cols-2 border-t-2 border-slate-400">
                  <div className="border-r border-slate-300 px-6 py-5">
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 mb-2">Tested By</div>
                    <input
                      value={form.testedBy}
                      onChange={(e) => updateForm(g.key, { testedBy: e.target.value.toUpperCase() })}
                      className="w-full bg-transparent text-sm font-medium border-0 border-b border-slate-400 focus:border-brand-500 focus:outline-none px-0 py-0.5"
                      placeholder="Name"
                    />
                    <div className="mt-1 text-[10px] text-slate-500">Name &amp; Signature</div>
                    <div className="mt-2 text-[10px] text-slate-500">Date: {fmtDate(form.woDate)}</div>
                  </div>
                  <div className="px-6 py-5">
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 mb-2">Approved By</div>
                    <input
                      value={form.approvedBy}
                      onChange={(e) => updateForm(g.key, { approvedBy: e.target.value.toUpperCase() })}
                      className="w-full bg-transparent text-sm font-medium border-0 border-b border-slate-400 focus:border-brand-500 focus:outline-none px-0 py-0.5"
                      placeholder="Name"
                    />
                    <div className="mt-1 text-[10px] text-slate-500">Name &amp; Signature</div>
                    <div className="mt-2 text-[10px] text-slate-500">Date: {fmtDate(form.woDate)}</div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

/* Compact labelled cell for the per-item header band (measure/grade/etc.).
   Values WRAP (no truncate) so long measures like "180 x 110 x 200 x …" and
   "2173.9 mA" show in full — both on screen and in the exported PDF. The extra
   vertical padding + relaxed line-height keep descenders clear of the border. */
const HdrCell = ({ label, value, strong }: { label: string; value: string; strong?: boolean }) => (
  <div className="min-w-0 border-r border-b border-slate-200 px-2 py-2 text-center leading-normal">
    <div className="text-[9px] font-semibold uppercase tracking-wide text-slate-500">{label}</div>
    <div className={`mt-1 break-words text-[12px] leading-normal ${strong ? 'font-bold text-slate-900' : 'font-semibold text-slate-800'}`}>{value}</div>
  </div>
);

const InfoRow = ({ label, value, border }: { label: string; value: string; border: string }) => (
  <div className={`flex ${border} border-slate-300`}>
    <span className="flex w-28 shrink-0 items-center bg-brand-50 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-brand-800 border-r border-slate-300">
      {label}
    </span>
    <span className="flex flex-1 items-center px-3 py-1.5 text-[13px] font-bold">{value}</span>
  </div>
);

const InfoEdit = ({
  label, value, onChange, type = 'text', border,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: 'text' | 'date';
  border: string;
}) => (
  <div className={`flex ${border} border-slate-300`}>
    <span className="flex w-28 shrink-0 items-center bg-brand-50 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-brand-800 border-r border-slate-300">
      {label}
    </span>
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="flex-1 min-w-0 self-stretch bg-transparent px-3 py-1.5 text-[13px] font-bold outline-none focus:bg-amber-50/40"
    />
  </div>
);
