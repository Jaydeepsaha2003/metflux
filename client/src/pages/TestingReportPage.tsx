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
import html2pdf from 'html2pdf.js';

/* ── Types ────────────────────────────────────────────────────── */
type DispatchDetail = {
  id: string; poOrderId: string | null; poOrderItemId: string;
  poNumber: string; orderDate: string;
  customerName: string; customerState: string | null;
  customerPhone: string | null;
  coreType: 'TOROIDAL' | 'RECTANGULAR';
  grade: string; material: string; measure: string;
  pcs: number; weightPerPc: number; totalWeight: number;
  turns: number | null; flux: number | null;
  testVoltage: number | null; testCurrent: number | null;
};

/* ── Sample-pcs calculation ───────────────────────────────────────
   Rules (always round to nearest integer):
     pcs > 1000  → 5%
     pcs ≥ 100   → 10%
     pcs < 100   → 25%  */
const calcSamplePcs = (pcs: number): number => {
  if (pcs > 1000) return Math.round(pcs * 0.05);
  if (pcs >= 100)  return Math.round(pcs * 0.10);
  return Math.round(pcs * 0.25);
};

const samplingRate = (pcs: number): string => {
  if (pcs > 1000) return '5%';
  if (pcs >= 100)  return '10%';
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
// Report No. format: TR-TC001 (Toroidal) / TR-RC001 (Rectangular).
// The 3-digit serial is the 1-indexed position of this group in the current
// report batch so each PO gets a unique, readable identifier.
const autoReportNo = (coreType: 'TOROIDAL' | 'RECTANGULAR', groupIdx: number) => {
  const prefix = coreType === 'TOROIDAL' ? 'TC' : 'RC';
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

  // Build the print-ready clone (inputs → spans, offscreen container) and
  // return an html2pdf builder plus a teardown.
  const buildPdfJob = () => {
    const el = printRef.current;
    if (!el || !dispatches.length) return null;

    const A4_USABLE_PX = 734;
    const clone = el.cloneNode(true) as HTMLElement;

    // Replace inputs with spans so html2canvas captures values reliably.
    const liveInputs = Array.from(el.querySelectorAll<HTMLInputElement>('input'));
    const cloneInputs = Array.from(clone.querySelectorAll<HTMLInputElement>('input'));
    cloneInputs.forEach((ci, i) => {
      const v = liveInputs[i]?.value ?? '';
      const span = document.createElement('span');
      span.className = ci.className;
      span.style.display = 'block';
      span.style.lineHeight = '36px';
      span.style.whiteSpace = 'pre';
      span.textContent = v.length ? v : ' ';
      ci.replaceWith(span);
    });

    clone.style.width = `${A4_USABLE_PX}px`;
    clone.style.minWidth = '0';
    clone.style.overflow = 'visible';
    clone.style.borderRadius = '0';
    clone.style.boxShadow = 'none';

    const offscreen = document.createElement('div');
    offscreen.style.position = 'fixed';
    offscreen.style.left = '-10000px';
    offscreen.style.top = '0';
    offscreen.style.width = `${A4_USABLE_PX}px`;
    offscreen.style.background = '#ffffff';
    offscreen.appendChild(clone);
    document.body.appendChild(offscreen);

    const filename = `Testing-Report-${todayISO()}.pdf`;
    const worker = html2pdf().set({
      margin: 8,
      filename,
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: {
        scale: 2,
        useCORS: true,
        logging: false,
        backgroundColor: '#ffffff',
        windowWidth: A4_USABLE_PX,
      },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
      pagebreak: { mode: ['css', 'legacy'], before: '.tr-page-break', avoid: ['tr'] },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any).from(clone);

    return { worker, filename, teardown: () => document.body.removeChild(offscreen) };
  };

  const handleDownload = async () => {
    const job = buildPdfJob();
    if (!job) return;
    setGenerating(true);
    await new Promise((r) => requestAnimationFrame(r));
    try { await job.worker.save(); }
    finally { job.teardown(); setGenerating(false); }
  };

  const handleWhatsappShare = async () => {
    const job = buildPdfJob();
    if (!job) return;
    setGenerating(true);
    await new Promise((r) => requestAnimationFrame(r));
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const blob = (await (job.worker as any).output('blob')) as Blob;
      const message = [
        `*Testing Report*`,
        company?.name ? `From: ${company.name}` : null,
        `Groups: ${groups.length} PO${groups.length === 1 ? '' : 's'} · ${dispatches.length} item${dispatches.length === 1 ? '' : 's'}`,
        `Date: ${fmtDate(todayISO())}`,
      ].filter(Boolean).join('\n');
      await shareViaWhatsApp({
        message,
        target: company?.defaultShareTarget,
        companyPhone: company?.whatsappNumber ?? null,
        customerPhone: dispatches[0]?.customerPhone ?? null,
        pdf: { blob, filename: job.filename.replace(/\.pdf$/i, '') },
      });
    } finally {
      job.teardown();
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
                <div className="flex items-center border-b-2 border-black px-6 pt-4 pb-3 gap-4">
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
                <div className="border-b-2 border-black px-6 py-2.5 text-center">
                  <span className="inline-block text-lg font-extrabold uppercase tracking-[0.25em] text-slate-900 border-2 border-slate-800 px-6 py-1.5 rounded">
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

                {/* Summary strip — No. of Pcs + Sample Pcs, above the table header */}
                {(() => {
                  const totalPcs    = g.rows.reduce((s, r) => s + r.pcs, 0);
                  const totalSample = g.rows.reduce((s, r) => s + calcSamplePcs(r.pcs), 0);
                  const rateLabel   = g.rows.length === 1 ? samplingRate(g.rows[0].pcs) : '—';
                  return (
                    <div className="flex items-center gap-6 px-5 py-2 bg-slate-700 text-white border-b border-slate-600 text-[11px] font-medium">
                      <span>No. of Pcs:&nbsp;<strong className="text-sm font-black">{totalPcs}</strong></span>
                      <span className="text-slate-400">·</span>
                      <span>Sample Pcs:&nbsp;<strong className="text-sm font-black">{totalSample}</strong></span>
                      <span className="text-slate-400">·</span>
                      <span>Sampling Rate:&nbsp;<strong className="text-sm font-black">{rateLabel}</strong></span>
                    </div>
                  );
                })()}

                {/* Sample-piece tables — split into page-sized chunks so every
                    PDF page gets a fresh column header. First dispatch on page 1
                    has company-header overhead → 18 rows. Every other chunk is
                    forced to a new page and fits 28 rows comfortably. */}
                {g.rows.map((d, dispatchIdx) => {
                  const mAVals  = sampleRowsByDispatch[d.id] ?? [];
                  const FIRST   = dispatchIdx === 0 ? 15 : 28;
                  const REST    = 28;

                  // Build chunks: first chunk may be smaller than REST.
                  const chunks: Array<(number | null)[]> = [];
                  if (mAVals.length > 0) {
                    chunks.push(mAVals.slice(0, FIRST));
                    for (let pos = FIRST; pos < mAVals.length; pos += REST) {
                      chunks.push(mAVals.slice(pos, pos + REST));
                    }
                  } else {
                    chunks.push([]);
                  }

                  const tableHead = (
                    <thead>
                      <tr className="bg-slate-100 border-b-2 border-slate-400 text-center font-bold uppercase tracking-wide text-[10px]">
                        <th className="px-1 py-1.5 border-r border-slate-300 align-middle">SN</th>
                        <th className="px-1 py-1.5 border-r border-slate-300 text-left align-middle">Measure</th>
                        <th className="px-1 py-1.5 border-r border-slate-300 align-middle">Grade</th>
                        <th className="px-1 py-1.5 border-r border-slate-300 align-middle">Turns</th>
                        <th className="px-1 py-1.5 border-r border-slate-300 align-middle">Applied Voltage (V)</th>
                        <th className="px-1 py-1.5 border-r border-slate-300 align-middle">Pcs</th>
                        <th className="px-1 py-1.5 align-middle">Max Allowed Current (mA)</th>
                      </tr>
                    </thead>
                  );

                  return (
                    <Fragment key={d.id}>
                      {chunks.map((chunk, ci) => {
                        // Offset = total rows in all earlier chunks of this item.
                        const snOffset = chunks.slice(0, ci).reduce((s, c) => s + c.length, 0);
                        const forceBreak = dispatchIdx > 0 || ci > 0;
                        return (
                          <div
                            key={`${d.id}-c${ci}`}
                            style={forceBreak ? { pageBreakBefore: 'always' } : undefined}
                          >
                            {/* Spec reference — shown on every page so each page is self-contained */}
                            {d.testCurrent != null && (
                              <div className="flex flex-wrap items-center gap-x-5 gap-y-0.5 px-5 py-1.5 bg-slate-50 border-b border-slate-300 text-[10px] text-slate-700">
                                <span>
                                  <span className="font-semibold uppercase tracking-wide">Max Allowed Current (mA):</span>{' '}
                                  <strong className="text-slate-900 tabular-nums">{d.testCurrent.toFixed(1)} mA</strong>
                                </span>
                              </div>
                            )}
                            <table className="w-full text-sm border-collapse table-fixed">
                              <colgroup>
                                <col style={{ width: '36px' }} />
                                <col />
                                <col style={{ width: '11%' }} />
                                <col style={{ width: '8%' }} />
                                <col style={{ width: '13%' }} />
                                <col style={{ width: '7%' }} />
                                <col style={{ width: '18%' }} />
                              </colgroup>
                              {tableHead}
                              <tbody>
                                {chunk.map((mA, i) => (
                                  <tr key={i} className="h-8 border-b border-slate-100">
                                    <td className="px-1 border-r border-slate-200 text-center text-[11px] font-medium text-slate-500 align-middle">
                                      {snOffset + i + 1}
                                    </td>
                                    <td className="px-1 border-r border-slate-200 text-left text-[11px] align-middle truncate">
                                      {d.measure}
                                    </td>
                                    <td className="px-1 border-r border-slate-200 text-center text-[11px] align-middle">
                                      {d.grade}
                                    </td>
                                    <td className="px-1 border-r border-slate-200 text-center text-[11px] tabular-nums align-middle">
                                      {d.turns != null ? d.turns : '—'}
                                    </td>
                                    <td className="px-1 border-r border-slate-200 text-center text-[11px] tabular-nums align-middle">
                                      {d.testVoltage != null ? d.testVoltage.toFixed(3) : '—'}
                                    </td>
                                    <td className="px-1 border-r border-slate-200 text-center text-[11px] font-semibold tabular-nums align-middle">
                                      1
                                    </td>
                                    <td className="px-1 text-center text-[11px] tabular-nums align-middle">
                                      {mA != null ? mA.toFixed(2) : '—'}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        );
                      })}
                    </Fragment>
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

const InfoRow = ({ label, value, border }: { label: string; value: string; border: string }) => (
  <div className={`flex ${border} border-slate-300`}>
    <span className="w-28 shrink-0 bg-slate-50 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500 border-r border-slate-300">
      {label}
    </span>
    <span className="flex-1 px-3 py-1.5 text-sm font-medium">{value}</span>
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
    <span className="w-28 shrink-0 bg-slate-50 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500 border-r border-slate-300">
      {label}
    </span>
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="flex-1 min-w-0 bg-transparent px-3 py-1.5 text-sm font-medium outline-none focus:bg-amber-50/40"
    />
  </div>
);
