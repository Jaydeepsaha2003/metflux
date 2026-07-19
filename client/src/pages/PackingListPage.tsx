// Packing list — covers one or more dispatch records.
// Outer groups: TOROIDAL then RECTANGULAR. Inner groups: by GRADE with subtotals.
// WO No is auto-generated (not user-editable). Every table cell is editable before downloading.
import { useRef, useState, useEffect, useMemo, Fragment } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useQuery, useQueries } from '@tanstack/react-query';
import { ArrowLeft, Download, Package, Loader2, MessageCircle, ClipboardCheck, Check, RotateCcw, Save } from 'lucide-react';
import { api } from '@/lib/api';
import { shareViaWhatsApp, type ShareTarget } from '@/lib/share';
import { readDraft, useFormDraft, fmtDraftTime } from '@/hooks/useFormDraft';
import { useBranding } from '@/store/branding';
import { downloadPackingListPdf, packingListPdfBlob, type PackingListPdf } from '@/lib/reportPdf';

/* ── Types ────────────────────────────────────────────────────── */
type CoreType = 'TOROIDAL' | 'RECTANGULAR' | 'NANO' | 'COMPOSITE';
// Short prefix for the description column + section labels for the outer groups.
const CORE_PREFIX: Record<CoreType, string> = { TOROIDAL: 'TC', RECTANGULAR: 'RC', NANO: 'NC', COMPOSITE: 'CC' };
const CORE_LABEL: Record<CoreType, string> = {
  TOROIDAL: 'Toroidal Cores', RECTANGULAR: 'Rectangular Cores', NANO: 'Nano Cores', COMPOSITE: 'Composite Cores',
};
const CORE_ORDER: CoreType[] = ['TOROIDAL', 'RECTANGULAR', 'NANO', 'COMPOSITE'];

type DispatchDetail = {
  id: string; poNumber: string; orderDate: string;
  customerName: string; customerCode: string | null; customerState: string | null;
  customerPhone: string | null;
  coreType: CoreType;
  grade: string; material: string; measure: string;
  id1: number; id2: number | null; od1: number; od2: number | null; ht: number;
  dispatchDate: string; pcs: number; weightPerPc: number;
  totalWeight: number;            // calculated (pcs × weightPerPc)
  actualWeight: number | null;    // weighbridge reading; falls back to totalWeight when null
  vehicleNo: string | null;
  ratePerPc: number | null;       // SO rate per piece (from the order item)
};
type PlDetail = {
  id: string; plNumber: string; plDate: string;
  invoiceNo: string | null; invoiceDate: string | null;
  testedBy: string | null; approvedBy: string | null; remarks: string | null;
  dispatches: DispatchDetail[];
};
type CompanyDetail = {
  name: string; address: string | null; phone: string | null;
  whatsappNumber: string | null;
  defaultShareTarget: ShareTarget;
  email: string | null; logoUrl: string | null; gstNumber: string | null;
};
type RowState = {
  dispatchId: string;
  coreType: CoreType;
  grade: string;
  poNo: string; poDate: string; description: string;
  qty: string; rate: string; weight: string; remarks: string;
};

const fmtDate = (iso: string | null | undefined) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
};

/* ── Cell input — used only for the editable Remarks column ──────── */
const Cell = ({
  value, onChange, align = 'center', bold,
}: {
  value: string; onChange: (v: string) => void;
  align?: 'left' | 'center' | 'right'; bold?: boolean;
}) => (
  <input
    value={value}
    onChange={(e) => onChange(e.target.value)}
    style={{ fontFamily: 'inherit' }}
    className={`block w-full h-9 bg-transparent border-0 border-b border-transparent
      focus:border-brand-400 focus:outline-none text-[13px] font-normal leading-9 py-0 px-1 align-middle box-border
      ${align === 'left' ? 'text-left' : align === 'right' ? 'text-right' : 'text-center'}
      ${bold ? 'font-semibold' : ''}`}
  />
);

/* ── Display cell — read-only twin of <Cell> for the static columns ─ */
const Display = ({
  value, align = 'center', wrap,
}: {
  value: string;
  align?: 'left' | 'center' | 'right'; wrap?: boolean;
}) => (
  <div
    className={`block w-full px-1 text-[13px] font-normal
      ${wrap
        ? 'min-h-9 py-1 leading-snug whitespace-normal break-words'
        : 'h-9 leading-9 truncate'}
      ${align === 'left' ? 'text-left' : align === 'right' ? 'text-right' : 'text-center'}`}
  >
    {value}
  </div>
);

/* ── Draft autosave ───────────────────────────────────────────── */
const PL_DRAFT_KEY = 'packing-list-build';
type PlDraft = {
  dispatchIds: string[];
  invoiceNo: string;
  invoiceDate: string;
  testedBy: string;
  approvedBy: string;
  rows: { dispatchId: string; remarks: string }[];
};
/** Order-insensitive id-set equality — a saved draft only restores onto the
 *  exact same set of dispatches it was captured from. */
const sameIds = (a: string[], b: string[]) =>
  a.length === b.length && [...a].sort().join(',') === [...b].sort().join(',');

/* ── Main page ────────────────────────────────────────────────── */
export const PackingListPage = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const state = (location.state ?? {}) as { dispatchIds?: string[]; plId?: string };
  const { dispatchIds: stateIds, plId } = state;

  // Draft recovery: a refresh or accidental navigation wipes router state, so a
  // saved draft's dispatchIds drive the page when there's no router state to use.
  // Read once on mount.
  const draft = useMemo(() => (plId ? null : readDraft<PlDraft>(PL_DRAFT_KEY)), [plId]);
  const effectiveIds = (stateIds && stateIds.length) ? stateIds : (draft?.data.dispatchIds ?? []);
  const [draftRestoredAt, setDraftRestoredAt] = useState<number | null>(null);
  const initRef = useRef(false); // build the editable rows exactly once

  useEffect(() => {
    if (!effectiveIds.length && !plId) navigate('/packing', { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* Queries */
  const { data: existingPl, isLoading: loadingPl } = useQuery({
    queryKey: ['packing-list', plId],
    queryFn: () => api<PlDetail>(`/packing-lists/${plId}`),
    enabled: !!plId,
  });
  const dispatchQueries = useQueries({
    queries: effectiveIds.map((id) => ({
      queryKey: ['dispatch-item', id],
      queryFn: () => api<DispatchDetail>(`/dispatch/${id}`),
      enabled: !plId,
    })),
  });
  const { data: company } = useQuery({
    queryKey: ['company-me'],
    queryFn: () => api<CompanyDetail>('/companies/me'),
  });
  const { data: nextWo } = useQuery({
    queryKey: ['packing-list-next-number'],
    queryFn: () => api<{ plNumber: string }>('/packing-lists/next-number'),
    enabled: !plId,
  });

  const dispatches: DispatchDetail[] = plId
    ? (existingPl?.dispatches ?? [])
    : dispatchQueries.filter((q) => q.data).map((q) => q.data as DispatchDetail);

  const isLoading = plId ? loadingPl : dispatchQueries.some((q) => q.isLoading);

  /* Form state — WO No/Date auto-generated, not editable */
  const today = new Date().toISOString().slice(0, 10);
  const [woNo, setWoNo] = useState('');
  const [woDate] = useState(today);
  const [invoiceNo, setInvoiceNo] = useState('');
  const [invoiceDate, setInvoiceDate] = useState('');
  const [testedBy, setTestedBy] = useState('');
  const [approvedBy, setApprovedBy] = useState('');
  // Once a NEW packing list is saved, remember its id so later actions update it
  // (PUT) instead of trying to create it again (which would 409).
  const [createdPlId, setCreatedPlId] = useState<string | null>(null);
  const effectivePlId = plId ?? createdPlId;

  /* Auto-generate WO NO. Format: <3-letter company prefix>WO-<3-digit serial>
     e.g. METWO-001, TORWO-007. The series advances per company across all
     packing lists already saved on the server. */
  // WO No. is assigned by the server — sequential per company, gap-free, never
  // duplicated, and never user-editable. We just preview the next number; the
  // real value is confirmed (and re-read into the doc) on save.
  useEffect(() => {
    if (plId || woNo || !nextWo) return;
    setWoNo(nextWo.plNumber);
  }, [nextWo, plId, woNo]);

  /* Pre-fill from existing PL */
  useEffect(() => {
    if (!existingPl) return;
    setWoNo(existingPl.plNumber);
    if (existingPl.invoiceNo) setInvoiceNo(existingPl.invoiceNo);
    if (existingPl.invoiceDate) setInvoiceDate(existingPl.invoiceDate.slice(0, 10));
    if (existingPl.testedBy) setTestedBy(existingPl.testedBy);
    if (existingPl.approvedBy) setApprovedBy(existingPl.approvedBy);
  }, [existingPl]);

  /* Editable table rows — initialized from dispatches */
  const [rows, setRows] = useState<RowState[]>([]);
  useEffect(() => {
    if (initRef.current) return; // initialize the editable rows exactly once
    if (!dispatches.length) return;
    let built: RowState[] = dispatches.map((d) => {
      // Packing list weight column points to the weighbridge reading when present,
      // else falls back to the calculated total. UI label stays "Total Weight".
      const displayWeight = d.actualWeight ?? d.totalWeight;
      return {
        dispatchId: d.id,
        coreType: d.coreType,
        grade: d.grade ?? '',
        poNo: d.poNumber ?? '',
        poDate: d.orderDate ? fmtDate(d.orderDate) : '',
        description: `${CORE_PREFIX[d.coreType] ?? 'RC'}-${d.measure ?? ''} / ${d.grade ?? ''}`,
        qty: String(d.pcs),
        rate: d.ratePerPc != null ? d.ratePerPc.toFixed(2) : '',
        weight: displayWeight != null ? displayWeight.toFixed(3) : '',
        remarks: '',
      };
    });
    // Overlay a saved draft, but only onto the exact same dispatch set it came
    // from — restores invoice details, tested/approved-by, and per-row remarks.
    if (draft && sameIds(draft.data.dispatchIds, effectiveIds)) {
      const edits = new Map(draft.data.rows.map((r) => [r.dispatchId, r.remarks]));
      built = built.map((r) => (edits.has(r.dispatchId) ? { ...r, remarks: edits.get(r.dispatchId) ?? '' } : r));
      setInvoiceNo(draft.data.invoiceNo);
      setInvoiceDate(draft.data.invoiceDate);
      setTestedBy(draft.data.testedBy);
      setApprovedBy(draft.data.approvedBy);
      setDraftRestoredAt(draft.savedAt);
    }
    setRows(built);
    initRef.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dispatches.map((d) => d.id).join(',')]);

  const updateRow = (id: string, field: keyof RowState, val: string) =>
    setRows((prev) => prev.map((r) => (r.dispatchId === id ? { ...r, [field]: val } : r)));

  /* Group: TOROIDAL → RECTANGULAR → NANO → COMPOSITE, then inside each by GRADE.
     Any core type present in the dispatch set gets a section (a hardcoded pair
     used to silently drop Nano/Composite rows → empty packing list). */
  const coreGroups = CORE_ORDER
    .map((ct) => {
      const ctRows = rows.filter((r) => r.coreType === ct);
      const gradeMap = ctRows.reduce<Record<string, RowState[]>>((acc, r) => {
        (acc[r.grade] ??= []).push(r); return acc;
      }, {});
      return { coreType: ct, label: CORE_LABEL[ct], grades: Object.entries(gradeMap) };
    })
    .filter((cg) => cg.grades.length > 0);

  /* Display helpers */
  // The packing list is a shipping document — ALWAYS print the full customer
  // name, for every user (employee or admin), regardless of the hide-names
  // setting. Falls back to the code only if a name is somehow missing.
  const custLabel = (d: { customerName: string; customerCode: string | null }) =>
    d.customerName || d.customerCode || '—';
  const uniqueCustomers = [...new Set(dispatches.map(custLabel))];
  const uniqueStates = [...new Set(dispatches.map((d) => d.customerState).filter(Boolean))];
  const customerLabel = uniqueCustomers.join(', ');
  const stateLabel = uniqueStates.join(', ') || '—';
  const grandTotalPcs = rows.reduce((s, r) => s + (parseInt(r.qty) || 0), 0);
  const grandTotalWeight = rows.reduce((s, r) => s + (parseFloat(r.weight) || 0), 0);

  // Auto-save an in-progress draft (build mode only) so a refresh or accidental
  // navigation never loses the invoice details, tested/approved-by, or remarks.
  const draftData: PlDraft = {
    dispatchIds: effectiveIds,
    invoiceNo, invoiceDate, testedBy, approvedBy,
    rows: rows.map((r) => ({ dispatchId: r.dispatchId, remarks: r.remarks })),
  };
  const { savedAt: draftSavedAt, clear: clearDraft } =
    useFormDraft<PlDraft>(effectivePlId ? null : PL_DRAFT_KEY, draftData, !effectivePlId && rows.length > 0);

  /* Formatted address */
  const addressLine = company?.address?.replace(/\n+/g, ', ').trim() ?? '';

  /* PDF download */
  const brandColor = useBranding((s) => s.brandColor);
  const printRef = useRef<HTMLDivElement>(null);
  const [generating, setGenerating] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedOk, setSavedOk] = useState(false);

  // Returns the server-assigned WO No. so the downloaded PDF matches the saved
  // record. plNumber is NOT sent — the server owns it (assign on create, keep on update).
  const persistPackingList = async (): Promise<{ ok: boolean; plNumber?: string; plId?: string }> => {
    try {
      const payload = {
        plDate: woDate || today,
        invoiceNo: invoiceNo || null,
        invoiceDate: invoiceDate || null,
        testedBy: testedBy || null,
        approvedBy: approvedBy || null,
        remarks: null,
      };
      if (effectivePlId) {
        await api(`/packing-lists/${effectivePlId}`, { method: 'PUT', body: JSON.stringify(payload) });
        return { ok: true, plNumber: woNo, plId: effectivePlId };
      }
      const created = await api<{ id: string; plNumber: string }>('/packing-lists', {
        method: 'POST',
        body: JSON.stringify({ dispatchIds: effectiveIds, ...payload }),
      });
      setCreatedPlId(created.id);
      return { ok: true, plNumber: created.plNumber, plId: created.id };
    } catch (e: unknown) {
      setSaveError(e instanceof Error ? e.message : 'Save failed');
      return { ok: false };
    }
  };

  // Assemble the structured data the pdfmake builder needs. `woOverride` lets a
  // caller pass the just-server-assigned WO No. before `woNo` state re-renders.
  const buildPlData = (woOverride?: string): PackingListPdf => ({
    company: {
      name: company?.name, address: company?.address, phone: company?.phone,
      whatsappNumber: company?.whatsappNumber, email: company?.email,
      gstNumber: company?.gstNumber, logoUrl: company?.logoUrl,
    },
    brand: brandColor,
    meta: {
      customer: customerLabel, state: stateLabel,
      woNo: woOverride || woNo || '—', woDate: woDate ? fmtDate(woDate) : '',
      invoiceNo: invoiceNo || '', invoiceDate: invoiceDate ? fmtDate(invoiceDate) : '',
    },
    groups: coreGroups.map((cg) => {
      const cgRows = cg.grades.flatMap(([, gr]) => gr);
      const multi = cg.grades.length > 1;
      return {
        label: cg.label,
        pcs: cgRows.reduce((s, r) => s + (parseInt(r.qty) || 0), 0),
        weight: cgRows.reduce((s, r) => s + (parseFloat(r.weight) || 0), 0),
        grades: cg.grades.map(([grade, gr]) => ({
          grade, multi,
          rows: gr.map((r) => ({ poNo: r.poNo, poDate: r.poDate, description: r.description, qty: r.qty, rate: r.rate, weight: r.weight, remarks: r.remarks })),
          subtotalPcs: gr.reduce((s, r) => s + (parseInt(r.qty) || 0), 0),
          subtotalWeight: gr.reduce((s, r) => s + (parseFloat(r.weight) || 0), 0),
        })),
      };
    }),
    grandPcs: grandTotalPcs, grandWeight: grandTotalWeight,
    testedBy, approvedBy, dateStr: woDate ? fmtDate(woDate) : '',
  });

  const handleDownload = async () => {
    setGenerating(true);
    setSaveError(null);
    const saved = await persistPackingList();
    const finalWo = saved.plNumber ?? woNo;
    if (saved.plNumber && saved.plNumber !== woNo) setWoNo(saved.plNumber);
    try {
      await downloadPackingListPdf(buildPlData(finalWo), `Packing-List-${finalWo || 'PL'}.pdf`);
    } finally { setGenerating(false); }
    if (saved.ok) clearDraft(); // work is now persisted server-side — drop the local draft
  };

  const handleWhatsappShare = async () => {
    setGenerating(true);
    setSaveError(null);
    const saved = await persistPackingList();
    const finalWo = saved.plNumber ?? woNo;
    if (saved.plNumber && saved.plNumber !== woNo) setWoNo(saved.plNumber);
    try {
      const blob = await packingListPdfBlob(buildPlData(finalWo));
      const message = [
        `*Packing List ${finalWo || 'DRAFT'}*`,
        company?.name ? `From: ${company.name}` : null,
        customerLabel ? `Customer: ${customerLabel}` : null,
        invoiceNo ? `Invoice: ${invoiceNo}` : null,
        `Date: ${woDate ? fmtDate(woDate) : ''}`,
        `Total: ${grandTotalPcs} pcs · ${grandTotalWeight.toFixed(3)} kg`,
      ].filter(Boolean).join('\n');
      await shareViaWhatsApp({
        message,
        target: company?.defaultShareTarget,
        companyPhone: company?.whatsappNumber ?? null,
        customerPhone: dispatches[0]?.customerPhone ?? null,
        pdf: { blob, filename: `Packing-List-${finalWo || 'PL'}` },
      });
    } finally {
      setGenerating(false);
    }
    if (saved.ok) clearDraft(); // persisted server-side — drop the local draft
  };

  // Save invoice no / date / tested-by / approved-by (and create the PL if new)
  // without generating a PDF.
  const handleSave = async () => {
    setSaving(true); setSaveError(null); setSavedOk(false);
    const saved = await persistPackingList();
    if (saved.ok) {
      if (saved.plNumber && saved.plNumber !== woNo) setWoNo(saved.plNumber);
      setSavedOk(true);
      clearDraft();
    }
    setSaving(false);
  };

  // Open the Testing Report — persist first so the invoice no / date / tested /
  // approved are saved and the report opens by plId (which auto-fills them).
  const goTestingReport = async () => {
    if (effectivePlId) { navigate('/testing-report', { state: { plId: effectivePlId } }); return; }
    setSaving(true); setSaveError(null);
    const saved = await persistPackingList();
    setSaving(false);
    if (saved.ok && saved.plId) {
      if (saved.plNumber && saved.plNumber !== woNo) setWoNo(saved.plNumber);
      clearDraft();
      navigate('/testing-report', { state: { plId: saved.plId } });
    } else {
      // Save failed — still open the report so the user isn't blocked.
      navigate('/testing-report', { state: { dispatchIds: effectiveIds } });
    }
  };

  if (isLoading) return <div className="card p-10 text-center"><Loader2 className="h-5 w-5 animate-spin mx-auto text-slate-400" /></div>;
  if (!dispatches.length && !isLoading) return (
    <div className="card p-10 text-center text-slate-400">
      No dispatch records. <Link to="/packing" className="text-brand-700 hover:underline">Go back</Link>
    </div>
  );

  return (
    <div className="space-y-4 max-w-5xl">

      {/* ── Control bar (hidden in print) — three responsive rows: title / inputs / actions ── */}
      <div className="no-print rounded-xl border border-slate-200 bg-white p-3 sm:p-4 shadow-sm space-y-3">
        {/* Row 1 — back + title */}
        <div className="flex items-center gap-2 sm:gap-3">
          <Link to="/packing" className="btn-ghost text-slate-600 shrink-0">
            <ArrowLeft className="h-4 w-4" /> <span className="hidden sm:inline">Back</span>
          </Link>
          <h1 className="text-base sm:text-lg font-bold tracking-tight flex items-center gap-2 min-w-0">
            <Package className="h-5 w-5 text-brand-600 shrink-0" />
            <span className="truncate">Packing List</span>
            {dispatches.length > 1 && (
              <span className="rounded-full bg-brand-100 px-2 py-0.5 text-xs font-medium text-brand-700 shrink-0">
                {dispatches.length} items
              </span>
            )}
          </h1>
          {!plId && draftSavedAt && (
            <span className="ml-auto hidden sm:inline-flex items-center gap-1 text-[11px] text-slate-400 shrink-0" title="Your work is auto-saved on this device until you download">
              <Check className="h-3 w-3" /> Draft saved
            </span>
          )}
        </div>

        {/* Row 2 — inputs (2 cols mobile, 4 cols tablet+) */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <label className="block">
            <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-slate-500">Invoice No.</span>
            <input className="input" value={invoiceNo} onChange={(e) => { setInvoiceNo(e.target.value.toUpperCase()); setSavedOk(false); }} placeholder="INV-0001" />
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-slate-500">Invoice Date</span>
            <input className="input" type="date" value={invoiceDate} onChange={(e) => { setInvoiceDate(e.target.value); setSavedOk(false); }} />
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-slate-500">Tested By</span>
            <input className="input" value={testedBy} onChange={(e) => { setTestedBy(e.target.value.toUpperCase()); setSavedOk(false); }} placeholder="NAME" />
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-slate-500">Approved By</span>
            <input className="input" value={approvedBy} onChange={(e) => { setApprovedBy(e.target.value.toUpperCase()); setSavedOk(false); }} placeholder="NAME" />
          </label>
        </div>

        {draftRestoredAt && (
          <div className="flex items-center justify-between gap-2 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-800">
            <span className="flex items-center gap-1.5">
              <RotateCcw className="h-3.5 w-3.5 shrink-0" />
              Recovered your unsaved draft from {fmtDraftTime(draftRestoredAt)}.
            </span>
            <button type="button" onClick={() => setDraftRestoredAt(null)} className="font-medium text-sky-700 hover:underline shrink-0">
              Dismiss
            </button>
          </div>
        )}
        {saveError && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            Could not save: {saveError} — PDF will still download.
          </div>
        )}

        {/* Row 3 — action buttons (stack on mobile, right-aligned desktop) */}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end sm:gap-3">
          {savedOk && (
            <span className="hidden sm:inline-flex items-center gap-1 text-[12px] font-medium text-emerald-600 mr-auto">
              <Check className="h-4 w-4" /> Saved {woNo && `— ${woNo}`}
            </span>
          )}
          <button
            onClick={handleSave}
            disabled={saving || generating}
            className="btn-ghost border border-slate-300 text-slate-700 hover:bg-slate-50 w-full sm:w-auto"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save
          </button>
          <button
            onClick={goTestingReport}
            disabled={saving}
            className="btn-ghost border border-slate-300 text-violet-700 hover:bg-violet-50 w-full sm:w-auto"
          >
            <ClipboardCheck className="h-4 w-4" /> Testing Report
          </button>
          <button onClick={handleWhatsappShare} className="btn-ghost border border-slate-300 text-emerald-700 hover:bg-emerald-50 w-full sm:w-auto">
            <MessageCircle className="h-4 w-4" /> Share on WhatsApp
          </button>
          <button onClick={handleDownload} disabled={generating} className="btn-primary w-full sm:w-auto">
            {generating ? <><Loader2 className="h-4 w-4 animate-spin" /> Generating…</> : <><Download className="h-4 w-4" /> Download PDF</>}
          </button>
        </div>
      </div>

      {/* ── Printable document ── */}
      <div className="overflow-x-auto rounded-xl shadow-md print:overflow-visible print:shadow-none print:rounded-none">
        <div ref={printRef} id="packing-list-doc"
          className="bg-white text-black min-w-[820px] rounded-xl overflow-hidden print:min-w-0 print:rounded-none print:overflow-visible">

          {/* Company header */}
          <div className="flex items-center justify-between border-b-2 border-brand-700 px-6 pt-4 pb-3 gap-4">
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
            <div className="text-right shrink-0">
              <div className="text-base font-bold uppercase tracking-widest text-white bg-brand-700 px-5 py-2 rounded flex items-center justify-center">
                Packing List
              </div>
            </div>
          </div>

          {/* Info rows */}
          <div className="grid grid-cols-2 border-b border-slate-300 text-sm">
            <InfoRow label="Customer" value={customerLabel} border="border-r border-b" />
            <InfoRow label="State" value={stateLabel} border="border-b" />
            <InfoRow label="WO No." value={woNo || '—'} border="border-r border-b" />
            <InfoRow label="WO Date" value={woDate ? fmtDate(woDate) : '—'} border="border-b" />
            <InfoRow label="Invoice No." value={invoiceNo || '—'} border="border-r" />
            <InfoRow label="Invoice Date" value={invoiceDate ? fmtDate(invoiceDate) : '—'} border="" />
          </div>

          {/* ── Core-type grouped tables ── */}
          {coreGroups.map((cg, cgIdx) => {
            const cgRows = cg.grades.flatMap(([, gr]) => gr);
            const cgPcs = cgRows.reduce((s, r) => s + (parseInt(r.qty) || 0), 0);
            const cgWeight = cgRows.reduce((s, r) => s + (parseFloat(r.weight) || 0), 0);
            const multiGrade = cg.grades.length > 1;

            return (
              <div key={cg.coreType} className={`core-section${cgIdx > 0 ? ' border-t-2 border-black' : ''}`}>

                {/* Core-type section header */}
                <div className="px-4 py-1.5 bg-brand-700 text-white text-[11px] font-bold uppercase tracking-widest">
                  {cg.label}
                </div>

                <table className="w-full text-sm border-collapse table-fixed">
                  <colgroup>
                    <col style={{ width: '36px' }} />   {/* SR */}
                    <col style={{ width: '15%' }} />    {/* PO NO */}
                    <col style={{ width: '13%' }} />    {/* PO DATE — fits dd/mm/yyyy */}
                    <col />                              {/* ITEM DESCRIPTION — auto */}
                    <col style={{ width: '9%' }} />     {/* QTY */}
                    <col style={{ width: '14%' }} />    {/* TOTAL WEIGHT */}
                    <col style={{ width: '14%' }} />    {/* REMARKS */}
                  </colgroup>
                  <thead>
                    <tr className="bg-brand-600 text-white border-b-2 border-brand-700 text-center font-bold uppercase tracking-wide text-[10px]">
                      <th className="px-1 py-1.5 border-r border-slate-300 align-middle">SR</th>
                      <th className="px-1 py-1.5 border-r border-slate-300 align-middle">PO NO</th>
                      <th className="px-1 py-1.5 border-r border-slate-300 align-middle">PO DATE</th>
                      <th className="px-1 py-1.5 border-r border-slate-300 text-left align-middle">ITEM DESCRIPTION</th>
                      <th className="px-1 py-1.5 border-r border-slate-300 align-middle">QTY (PCS)</th>
                      <th className="px-1 py-1.5 border-r border-slate-300 align-middle">WT (KG)</th>
                      <th className="px-1 py-1.5 align-middle">REMARKS</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cg.grades.map(([grade, gradeRows]) => {
                      const gradePcs = gradeRows.reduce((s, r) => s + (parseInt(r.qty) || 0), 0);
                      const gradeWeight = gradeRows.reduce((s, r) => s + (parseFloat(r.weight) || 0), 0);
                      return (
                        <Fragment key={grade}>
                          {/* Grade sub-header */}
                          {multiGrade && (
                            <tr className="bg-slate-50 border-y border-slate-300">
                              <td colSpan={7} className="px-3 py-0.5 text-[10px] font-bold uppercase tracking-widest text-slate-500 align-middle">
                                Grade: {grade}
                              </td>
                            </tr>
                          )}

                          {/* Data rows — Calibri Bold 11 for legibility (per request) */}
                          {gradeRows.map((row, idx) => (
                            <tr key={row.dispatchId} className="h-9 border-b border-slate-200 hover:bg-slate-50/50" style={{ fontFamily: 'Calibri, "Segoe UI", Tahoma, sans-serif' }}>
                              <td className="px-1 border-r border-slate-200 text-center font-normal text-slate-700 text-[13px] align-middle">
                                {idx + 1}
                              </td>
                              <td className="px-0.5 border-r border-slate-200 align-middle">
                                <Display value={row.poNo} wrap />
                              </td>
                              <td className="px-0.5 border-r border-slate-200 align-middle">
                                <Display value={row.poDate} />
                              </td>
                              <td className="px-0.5 border-r border-slate-200 align-middle">
                                <Display value={row.description} align="left" wrap />
                              </td>
                              <td className="px-0.5 border-r border-slate-200 align-middle">
                                <Display value={row.qty} />
                              </td>
                              <td className="px-0.5 border-r border-slate-200 align-middle">
                                <Display value={row.weight} />
                              </td>
                              <td className="px-0.5 align-middle">
                                <Cell value={row.remarks} onChange={(v) => updateRow(row.dispatchId, 'remarks', v)} align="left" />
                              </td>
                            </tr>
                          ))}

                          {/* Grade subtotal — only when multiple grades */}
                          {multiGrade && (
                            <tr className="h-9 border-t border-slate-300 bg-slate-50">
                              <td colSpan={4} className="px-2 border-r border-slate-300 text-right text-[10px] font-bold uppercase tracking-widest text-slate-500 align-middle">
                                Grade {grade} Subtotal
                              </td>
                              <td className="px-1 border-r border-slate-300 text-center text-[11px] font-bold text-slate-700 align-middle">
                                {gradePcs}
                              </td>
                              <td className="px-1 border-r border-slate-300 text-center text-[11px] font-bold font-mono text-slate-700 align-middle">
                                {gradeWeight.toFixed(3)}
                              </td>
                              <td className="align-middle" />
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}

                    {/* Core-type total row */}
                    <tr className="h-8 border-t-2 border-slate-500 bg-slate-200">
                      <td colSpan={4} className="px-2 border-r border-slate-400 text-right text-[10px] font-black uppercase tracking-widest text-slate-600 align-middle">
                        {cg.label} Total
                      </td>
                      <td className="px-1 border-r border-slate-400 text-center text-xs font-black text-slate-800 align-middle">
                        {cgPcs}
                      </td>
                      <td className="px-1 border-r border-slate-400 text-center text-xs font-black font-mono text-slate-800 align-middle">
                        {cgWeight.toFixed(3)}
                      </td>
                      <td className="align-middle" />
                    </tr>
                  </tbody>
                </table>
              </div>
            );
          })}

          {/* Grand total */}
          <div className="border-t-2 border-brand-800 bg-brand-700 text-white flex justify-end gap-10 px-6 py-4 text-base font-bold">
            <span className="uppercase tracking-widest text-brand-100 text-sm self-center">Grand Total</span>
            <span className="text-[22px]">{grandTotalPcs} <span className="text-sm font-medium text-brand-100">pcs</span></span>
            <span className="text-[22px]">{grandTotalWeight.toFixed(3)} <span className="text-sm font-medium text-brand-100">kg</span></span>
          </div>

          {/* Signature footer */}
          <div className="grid grid-cols-2 border-t-2 border-slate-400 mt-2">
            <div className="border-r border-slate-300 px-6 py-5">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 mb-5">Tested By</div>
              <div className="border-b border-slate-400 mb-1 min-h-[24px] text-sm font-medium">{testedBy}</div>
              <div className="text-[10px] text-slate-500">Name &amp; Signature</div>
              <div className="mt-2 text-[10px] text-slate-500">Date: {woDate ? fmtDate(woDate) : '___________'}</div>
            </div>
            <div className="px-6 py-5">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 mb-5">Approved By</div>
              <div className="border-b border-slate-400 mb-1 min-h-[24px] text-sm font-medium">{approvedBy}</div>
              <div className="text-[10px] text-slate-500">Name &amp; Signature</div>
              <div className="mt-2 text-[10px] text-slate-500">Date: {woDate ? fmtDate(woDate) : '___________'}</div>
            </div>
          </div>

        </div>
      </div>{/* end scroll wrapper */}
    </div>
  );
};

const InfoRow = ({ label, value, border }: { label: string; value: string; border: string }) => (
  <div className={`flex ${border} border-slate-300`}>
    <span className="w-28 shrink-0 bg-brand-50 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-brand-800 border-r border-slate-300">
      {label}
    </span>
    <span className="flex-1 px-3 py-1.5 text-[13px] font-bold">{value}</span>
  </div>
);