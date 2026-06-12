// Work Allotment template — opened either in "build mode" (state.poItemIds) or
// "view mode" (state.waId). Each row carries an editable pcs and a labour
// dropdown. On save we POST to /work-allotments and download a PDF using the
// same html2pdf approach as PackingListPage.
import { useRef, useState, useEffect, useMemo } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Download, ClipboardList, Loader2, MessageCircle, Check, RotateCcw } from 'lucide-react';
import { api } from '@/lib/api';
import { shareViaWhatsApp, type ShareTarget } from '@/lib/share';
import { readDraft, useFormDraft, fmtDraftTime } from '@/hooks/useFormDraft';
import html2pdf from 'html2pdf.js';

/* ── Types ────────────────────────────────────────────────────── */
type PendingItem = {
  id: string;
  poNumber: string;
  customerCode: string;
  orderDate: string;
  coreType: 'TOROIDAL' | 'RECTANGULAR';
  grade: string;
  material: string;
  measure: string;
  flux: number | null;
  turns: number | null;
  testVoltage: number | null;
  testCurrent: number | null;
  weightPerPc: number;
  orderedPcs: number;
  producedPcs: number;
  remainingPcs: number;
};
type WaItemDetail = {
  id: string;
  poOrderItemId: string;
  poNumber: string | null;
  orderDate: string | null;
  customerCode: string | null;
  coreType: 'TOROIDAL' | 'RECTANGULAR' | null;
  grade: string | null;
  material: string | null;
  measure: string | null;
  weightPerPc: number | null;
  flux: number | null;
  turns: number | null;
  testVoltage: number | null;
  testCurrent: number | null;
  pcs: number;
  labourId: string | null;
  labourName: string | null;
};
type WaDetail = {
  id: string; waNumber: string; waDate: string; remarks: string | null;
  items: WaItemDetail[];
};
type CompanyDetail = {
  name: string; address: string | null; phone: string | null;
  whatsappNumber: string | null;
  defaultShareTarget: ShareTarget;
  email: string | null; logoUrl: string | null; gstNumber: string | null;
};
type LabourOption = { id: string; name: string };

type RowState = {
  poOrderItemId: string;
  customerCode: string;
  orderDate: string;
  measure: string;
  grade: string;
  material: string;
  flux: string;
  turns: string;
  voltage: string;
  iemax: string;
  pcs: string;        // editable
  maxPcs: number;     // remaining cap
  weightPerPc: number; // kg per piece — WT column = pcs × weightPerPc
  labourId: string;   // editable
};

const fmtDate = (iso: string | null | undefined) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
};

const numStr = (n: number | null | undefined, digits = 2) =>
  n == null ? '' : Number(n).toFixed(digits);

/* ── Inline cells used in the printable doc ── */
const Display = ({
  value, align = 'center', bold,
}: {
  value: string;
  align?: 'left' | 'center' | 'right'; bold?: boolean;
}) => (
  <div
    className={`flex w-full min-h-9 items-center px-1 py-1 text-[12px] leading-tight whitespace-normal
      ${align === 'left' ? 'justify-start text-left' : align === 'right' ? 'justify-end text-right' : 'justify-center text-center'}
      ${bold ? 'font-semibold' : ''}`}
  >
    {value || ' '}
  </div>
);

/* ── Draft autosave ───────────────────────────────────────────── */
const WA_DRAFT_KEY = 'work-allotment-build';
type WaDraft = {
  poItemIds: string[];
  waNumber: string;
  remarks: string;
  issuedBy: string;
  receivedBy: string;
  rows: { poOrderItemId: string; pcs: string; labourId: string }[];
};
/** Order-insensitive id-set equality — a saved draft only restores onto the
 *  exact same selection of items it was captured from. */
const sameIds = (a: string[], b: string[]) =>
  a.length === b.length && [...a].sort().join(',') === [...b].sort().join(',');

/* ── Main page ────────────────────────────────────────────────── */
export const WorkAllotmentBuildPage = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const state = (location.state ?? {}) as { poItemIds?: string[]; waId?: string };
  const { poItemIds: stateIds, waId } = state;

  // Draft recovery: a refresh or accidental navigation wipes router state, so a
  // saved draft's poItemIds drive the page when there's no router state to use.
  // Read once on mount.
  const draft = useMemo(() => (waId ? null : readDraft<WaDraft>(WA_DRAFT_KEY)), [waId]);
  const effectiveIds = (stateIds && stateIds.length) ? stateIds : (draft?.data.poItemIds ?? []);
  const [draftRestoredAt, setDraftRestoredAt] = useState<number | null>(null);
  const initRef = useRef(false); // build the editable rows exactly once

  useEffect(() => {
    if (!effectiveIds.length && !waId) navigate('/work-allotment', { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* Queries */
  const { data: existingWa, isLoading: loadingWa } = useQuery({
    queryKey: ['work-allotment', waId],
    queryFn: () => api<WaDetail>(`/work-allotments/${waId}`),
    enabled: !!waId,
  });

  // For build-mode we need pending list filtered to selected ids.
  const { data: pendingList } = useQuery({
    queryKey: ['wa-pending-all'],
    queryFn: () => api<{ items: PendingItem[] }>(`/work-allotments/pending`),
    enabled: !waId,
  });

  const { data: company } = useQuery({
    queryKey: ['company-me'],
    queryFn: () => api<CompanyDetail>('/companies/me'),
  });

  const { data: labourData } = useQuery({
    queryKey: ['labours-dropdown'],
    queryFn: () => api<{ labours: LabourOption[] }>('/labours/dropdown'),
  });
  const labours = labourData?.labours ?? [];
  const labourName = (id: string | null | undefined) =>
    labours.find((l) => l.id === id)?.name ?? '';

  const { data: allWas } = useQuery({
    queryKey: ['work-allotments-all'],
    queryFn: () => api<{ items: Array<{ waNumber: string }> }>('/work-allotments'),
    enabled: !waId,
  });

  /* Form state */
  const today = new Date().toISOString().slice(0, 10);
  const [waNumber, setWaNumber] = useState('');
  const [waDate] = useState(today);
  const [remarks, setRemarks] = useState('');
  const [issuedBy, setIssuedBy] = useState('');
  const [receivedBy, setReceivedBy] = useState('');

  /* Auto-generate WA No. — same pattern as Packing List WO No.
     Format: <3-letter company prefix>WA-<3-digit serial> */
  useEffect(() => {
    if (waId || !company || waNumber) return;
    const prefix = `${company.name.slice(0, 3).toUpperCase()}WA`;
    const existing = allWas?.items.filter((w) => w.waNumber.startsWith(prefix + '-')).length ?? 0;
    setWaNumber(`${prefix}-${String(existing + 1).padStart(3, '0')}`);
  }, [company, allWas, waId]);

  /* Pre-fill from existing WA */
  useEffect(() => {
    if (!existingWa) return;
    setWaNumber(existingWa.waNumber);
    if (existingWa.remarks) setRemarks(existingWa.remarks);
  }, [existingWa]);

  /* Editable rows — initialized from pending items (build) or saved items (view) */
  const [rows, setRows] = useState<RowState[]>([]);

  useEffect(() => {
    if (initRef.current) return; // initialize the editable rows exactly once
    if (waId) {
      // View mode — populate from existing WA items.
      if (!existingWa) return;
      setRows(existingWa.items.map((it) => ({
        poOrderItemId: it.poOrderItemId,
        customerCode:  it.customerCode ?? '',
        orderDate:     it.orderDate ?? '',
        measure:       it.measure ?? '',
        grade:         it.grade ?? '',
        material:      it.material ?? '',
        flux:          numStr(it.flux, 2),
        turns:         it.turns != null ? String(it.turns) : '',
        voltage:       numStr(it.testVoltage, 2),
        iemax:         numStr(it.testCurrent, 2),
        pcs:           String(it.pcs),
        maxPcs:        it.pcs, // already locked-in; can't grow past saved value
        weightPerPc:   it.weightPerPc ?? 0,
        labourId:      it.labourId ?? '',
      })));
      initRef.current = true;
    } else {
      // Build mode — pull the selected ids out of the cached pending list.
      if (!pendingList || !effectiveIds.length) return;
      const wanted = pendingList.items.filter((p) => effectiveIds.includes(p.id));
      let built: RowState[] = wanted.map((p) => ({
        poOrderItemId: p.id,
        customerCode:  p.customerCode,
        orderDate:     p.orderDate,
        measure:       p.measure,
        grade:         p.grade,
        material:      p.material,
        flux:          numStr(p.flux, 2),
        turns:         p.turns != null ? String(p.turns) : '',
        voltage:       numStr(p.testVoltage, 2),
        iemax:         numStr(p.testCurrent, 2),
        pcs:           String(p.remainingPcs),
        maxPcs:        p.remainingPcs,
        weightPerPc:   p.weightPerPc ?? 0,
        labourId:      '',
      }));
      // Overlay a saved draft, but only onto the exact same selection it came
      // from — restores the typed pcs / workers / number / signatures.
      if (draft && sameIds(draft.data.poItemIds, effectiveIds)) {
        const edits = new Map(draft.data.rows.map((r) => [r.poOrderItemId, r]));
        built = built.map((r) => {
          const e = edits.get(r.poOrderItemId);
          return e ? { ...r, pcs: e.pcs, labourId: e.labourId } : r;
        });
        setWaNumber(draft.data.waNumber);
        setRemarks(draft.data.remarks);
        setIssuedBy(draft.data.issuedBy);
        setReceivedBy(draft.data.receivedBy);
        setDraftRestoredAt(draft.savedAt);
      }
      setRows(built);
      initRef.current = true;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waId, existingWa, pendingList, effectiveIds.join(',')]);

  const updateRow = (id: string, field: keyof RowState, val: string) =>
    setRows((prev) => prev.map((r) => (r.poOrderItemId === id ? { ...r, [field]: val } : r)));

  const totalPcs = rows.reduce((s, r) => s + (parseInt(r.pcs) || 0), 0);

  // WT (KG.) per line = allotted pcs × weight per piece. Recomputed live as pcs
  // is edited. 3-decimal precision mirrors weights shown elsewhere in the app.
  const fmtWt = (n: number) => (Number.isFinite(n) ? n : 0).toFixed(3);
  const rowWt = (r: RowState) => (parseInt(r.pcs) || 0) * (r.weightPerPc || 0);
  const totalWt = rows.reduce((s, r) => s + rowWt(r), 0);

  // Auto-save an in-progress draft (build mode only) so a refresh or accidental
  // navigation never loses the typed pcs / workers / number / signatures.
  const draftData: WaDraft = {
    poItemIds: effectiveIds,
    waNumber, remarks, issuedBy, receivedBy,
    rows: rows.map((r) => ({ poOrderItemId: r.poOrderItemId, pcs: r.pcs, labourId: r.labourId })),
  };
  const { savedAt: draftSavedAt, clear: clearDraft } =
    useFormDraft<WaDraft>(waId ? null : WA_DRAFT_KEY, draftData, !waId && rows.length > 0);

  /* Validation — shown inline before save */
  const validationError = (() => {
    if (!rows.length) return 'No items to allot.';
    if (!waNumber.trim()) return 'WA Number is required.';
    for (const r of rows) {
      const p = parseInt(r.pcs);
      if (!Number.isFinite(p) || p <= 0) return `Pcs must be > 0 for ${r.measure || r.grade}.`;
      if (p > r.maxPcs) return `Pcs (${p}) for ${r.measure || r.grade} exceeds remaining (${r.maxPcs}).`;
    }
    return null;
  })();

  const isLoading = waId ? loadingWa : !pendingList;

  /* Address helper */
  const addressLine = company?.address?.replace(/\n+/g, ', ').trim() ?? '';

  /* PDF + share */
  const printRef = useRef<HTMLDivElement>(null);
  const [generating, setGenerating] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const persistWorkAllotment = async (): Promise<boolean> => {
    if (waId) return true;
    try {
      await api('/work-allotments', {
        method: 'POST',
        body: JSON.stringify({
          waNumber,
          waDate,
          remarks: remarks || null,
          items: rows.map((r) => ({
            poOrderItemId: r.poOrderItemId,
            pcs:           parseInt(r.pcs),
            labourId:      r.labourId || null,
          })),
        }),
      });
      return true;
    } catch (e: unknown) {
      setSaveError(e instanceof Error ? e.message : 'Save failed');
      return false;
    }
  };

  // Same input-to-span clone trick used in PackingListPage so html2canvas
  // captures the typed values reliably. Shared by download + share.
  const buildPdfJob = () => {
    const el = printRef.current;
    if (!el || !rows.length) return null;

    // Landscape A4 = 297mm wide; with 8mm margins = 281mm usable.
    // At 3.7795 px/mm (96 dpi) that's ~1062px. Use 1040 for a small safety
    // margin so the last table column is never clipped.
    const A4_USABLE_PX = 1040;
    const clone = el.cloneNode(true) as HTMLElement;

    const liveInputs = Array.from(el.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input, select'));
    const cloneInputs = Array.from(clone.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input, select'));
    cloneInputs.forEach((ci, i) => {
      const live = liveInputs[i];
      let value = '';
      if (live instanceof HTMLSelectElement) {
        value = live.options[live.selectedIndex]?.text ?? '';
      } else if (live instanceof HTMLInputElement) {
        value = live.value;
      }
      const span = document.createElement('span');
      span.className = ci.className;
      span.style.display = 'block';
      span.style.lineHeight = '36px';
      span.style.whiteSpace = 'pre';
      span.textContent = value.length ? value : ' ';
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

    const filename = `Work-Allotment-${waNumber || 'WA'}.pdf`;
    const worker = html2pdf().set({
      margin: 8,
      filename,
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: {
        scale: 2,
        useCORS: true,
        logging: false,
        backgroundColor: '#ffffff',
        width: A4_USABLE_PX,
        windowWidth: A4_USABLE_PX,
      },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'landscape' },
      // The items table is paginated manually (fixed rows per page + an explicit
      // page break between chunks) and the totals/signature block is atomic, so
      // html2pdf never has to slice a row across a page boundary. The old
      // `avoid: 'tr'` left a duplicated ghost of the straddling row. 'css'
      // honours our page-break-before / page-break-inside styles.
      pagebreak: { mode: ['css', 'legacy'] },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any).from(clone);

    return { worker, filename, teardown: () => document.body.removeChild(offscreen) };
  };

  const handleDownload = async () => {
    if (validationError) { setSaveError(validationError); return; }
    setGenerating(true);
    setSaveError(null);
    const saved = await persistWorkAllotment();
    const job = buildPdfJob();
    if (!job) { setGenerating(false); return; }
    await new Promise((r) => requestAnimationFrame(r));
    try { await job.worker.save(); }
    finally { job.teardown(); setGenerating(false); }
    if (saved) clearDraft(); // work is now persisted server-side — drop the local draft
  };

  const handleWhatsappShare = async () => {
    if (validationError) { setSaveError(validationError); return; }
    setGenerating(true);
    setSaveError(null);
    const saved = await persistWorkAllotment();
    const job = buildPdfJob();
    if (!job) { setGenerating(false); return; }
    await new Promise((r) => requestAnimationFrame(r));
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const blob = (await (job.worker as any).output('blob')) as Blob;
      const labourNames = [...new Set(
        rows.map((r) => labourName(r.labourId)).filter(Boolean)
      )];
      const message = [
        `*Work Allotment ${waNumber || 'DRAFT'}*`,
        company?.name ? `From: ${company.name}` : null,
        labourNames.length ? `Workers: ${labourNames.join(', ')}` : null,
        `Date: ${waDate ? fmtDate(waDate) : ''}`,
        `Total: ${totalPcs} pcs across ${rows.length} item${rows.length !== 1 ? 's' : ''}`,
      ].filter(Boolean).join('\n');
      // Work Allotment has no customer — CUSTOMER mode falls back to PROMPT.
      await shareViaWhatsApp({
        message,
        target: company?.defaultShareTarget,
        companyPhone: company?.whatsappNumber ?? null,
        customerPhone: null,
        pdf: { blob, filename: job.filename.replace(/\.pdf$/i, '') },
      });
    } finally {
      job.teardown();
      setGenerating(false);
    }
    if (saved) clearDraft(); // persisted server-side — drop the local draft
  };

  if (isLoading) return <div className="card p-10 text-center"><Loader2 className="h-5 w-5 animate-spin mx-auto text-slate-400" /></div>;
  if (!rows.length && !isLoading) return (
    <div className="card p-10 text-center text-slate-400">
      No items to allot. <Link to="/work-allotment" className="text-brand-700 hover:underline">Go back</Link>
    </div>
  );

  /* Paginate the printable doc manually: a fixed number of rows per page + an
     explicit page break between chunks means html2pdf never slices a row across
     a boundary (which had duplicated the straddling row). Page 1 is shorter as
     it also carries the company header + info band. Sizes are conservative so a
     chunk always fits one landscape A4 page. */
  const PAGE_ROWS_FIRST = 12;
  const PAGE_ROWS_REST = 16;
  const rowPages: { items: RowState[]; start: number }[] = [{ items: rows.slice(0, PAGE_ROWS_FIRST), start: 0 }];
  for (let i = PAGE_ROWS_FIRST; i < rows.length; i += PAGE_ROWS_REST) {
    rowPages.push({ items: rows.slice(i, i + PAGE_ROWS_REST), start: i });
  }

  const docColgroup = (
    <colgroup>
      <col style={{ width: '3%'  }} />
      <col style={{ width: '9%'  }} />
      <col style={{ width: '8%'  }} />
      <col style={{ width: '12%' }} />
      <col style={{ width: '8%'  }} />
      <col style={{ width: '8%'  }} />
      <col style={{ width: '5%'  }} />
      <col style={{ width: '7%'  }} />
      <col style={{ width: '5%'  }} />
      <col style={{ width: '5%'  }} />
      <col style={{ width: '7%'  }} />
      <col style={{ width: '7%'  }} />
      <col style={{ width: '16%' }} />
    </colgroup>
  );
  const docThead = (
    <thead>
      <tr className="bg-slate-100 border-b-2 border-slate-400 text-center font-bold uppercase tracking-wide text-[10px]">
        <th className="px-1 py-1.5 border-r border-slate-300 align-middle">SR</th>
        <th className="px-1 py-1.5 border-r border-slate-300 align-middle text-left">Cust Code</th>
        <th className="px-1 py-1.5 border-r border-slate-300 align-middle">SO Date</th>
        <th className="px-1 py-1.5 border-r border-slate-300 align-middle text-left">Measure</th>
        <th className="px-1 py-1.5 border-r border-slate-300 align-middle">Grade</th>
        <th className="px-1 py-1.5 border-r border-slate-300 align-middle">Material</th>
        <th className="px-1 py-1.5 border-r border-slate-300 align-middle">Pcs</th>
        <th className="px-1 py-1.5 border-r border-slate-300 align-middle">WT (KG.)</th>
        <th className="px-1 py-1.5 border-r border-slate-300 align-middle">Flux</th>
        <th className="px-1 py-1.5 border-r border-slate-300 align-middle">Turns</th>
        <th className="px-1 py-1.5 border-r border-slate-300 align-middle">Voltage</th>
        <th className="px-1 py-1.5 border-r border-slate-300 align-middle">Iemax</th>
        <th className="px-1 py-1.5 align-middle text-left">Worker</th>
      </tr>
    </thead>
  );
  const renderRow = (r: RowState, idx: number) => (
    <tr key={r.poOrderItemId} className="h-9 border-b border-slate-200">
      <td className="px-1 border-r border-slate-200 text-center font-medium text-slate-500 text-[12px] align-middle">{idx + 1}</td>
      <td className="px-0.5 border-r border-slate-200 align-middle"><Display value={r.customerCode} align="left" /></td>
      <td className="px-0.5 border-r border-slate-200 align-middle"><Display value={fmtDate(r.orderDate)} /></td>
      <td className="px-0.5 border-r border-slate-200 align-middle"><Display value={r.measure} align="left" /></td>
      <td className="px-0.5 border-r border-slate-200 align-middle"><Display value={r.grade} /></td>
      <td className="px-0.5 border-r border-slate-200 align-middle"><Display value={r.material} /></td>
      <td className="px-0.5 border-r border-slate-200 align-middle"><Display value={r.pcs} bold /></td>
      <td className="px-0.5 border-r border-slate-200 align-middle"><Display value={fmtWt(rowWt(r))} /></td>
      <td className="px-0.5 border-r border-slate-200 align-middle"><Display value={r.flux} /></td>
      <td className="px-0.5 border-r border-slate-200 align-middle"><Display value={r.turns} /></td>
      <td className="px-0.5 border-r border-slate-200 align-middle"><Display value={r.voltage} /></td>
      <td className="px-0.5 border-r border-slate-200 align-middle"><Display value={r.iemax} /></td>
      <td className="px-0.5 align-middle"><Display value={labourName(r.labourId)} align="left" /></td>
    </tr>
  );

  return (
    <div className="space-y-4">

      {/* ── Control bar (hidden in print) ── */}
      <div className="no-print rounded-xl border border-slate-200 bg-white p-3 sm:p-4 shadow-sm space-y-3">
        <div className="flex items-center gap-2 sm:gap-3">
          <Link to="/work-allotment" className="btn-ghost text-slate-600 shrink-0">
            <ArrowLeft className="h-4 w-4" /> <span className="hidden sm:inline">Back</span>
          </Link>
          <h1 className="text-base sm:text-lg font-bold tracking-tight flex items-center gap-2 min-w-0">
            <ClipboardList className="h-5 w-5 text-brand-600 shrink-0" />
            <span className="truncate">Work Allotment</span>
            {rows.length > 1 && (
              <span className="rounded-full bg-brand-100 px-2 py-0.5 text-xs font-medium text-brand-700 shrink-0">
                {rows.length} items
              </span>
            )}
          </h1>
          {!waId && draftSavedAt && (
            <span className="ml-auto hidden sm:inline-flex items-center gap-1 text-[11px] text-slate-400 shrink-0" title="Your work is auto-saved on this device until you download">
              <Check className="h-3 w-3" /> Draft saved
            </span>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <label className="block">
            <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-slate-500">WA Number</span>
            <input className="input" value={waNumber} onChange={(e) => setWaNumber(e.target.value.toUpperCase())} disabled={!!waId} />
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-slate-500">WA Date</span>
            <input className="input" type="date" value={waDate} disabled />
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-slate-500">Remarks</span>
            <input className="input" value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="optional" disabled={!!waId} />
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-slate-500">Issued By</span>
            <input className="input" value={issuedBy} onChange={(e) => setIssuedBy(e.target.value)} placeholder="name (optional)" />
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-slate-500">Received By</span>
            <input className="input" value={receivedBy} onChange={(e) => setReceivedBy(e.target.value)} placeholder="name (optional)" />
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
        {(saveError || validationError) && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            {saveError ?? validationError}
          </div>
        )}

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end sm:gap-3">
          <button onClick={handleWhatsappShare} className="btn-ghost border border-slate-300 text-emerald-700 hover:bg-emerald-50 w-full sm:w-auto">
            <MessageCircle className="h-4 w-4" /> Share on WhatsApp
          </button>
          <button onClick={handleDownload} disabled={generating || !!validationError} className="btn-primary w-full sm:w-auto">
            {generating ? <><Loader2 className="h-4 w-4 animate-spin" /> Generating…</> : <><Download className="h-4 w-4" /> {waId ? 'Download PDF' : 'Save & Download PDF'}</>}
          </button>
        </div>
      </div>

      {/* ── Editable section (live) ── */}
      {!waId && (
        <div className="card overflow-hidden no-print">
          <div className="px-4 py-2 bg-slate-50 border-b border-slate-200 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Edit pcs and assign workers
          </div>

          {/* Desktop / tablet — table */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-sm whitespace-nowrap">
              <thead>
                <tr className="border-b border-slate-200 bg-white text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <th className="px-3 py-2 text-left">Customer</th>
                  <th className="px-3 py-2 text-left">SO Date</th>
                  <th className="px-3 py-2 text-left">Measure</th>
                  <th className="px-3 py-2 text-left">Grade</th>
                  <th className="px-3 py-2 text-right">Turns</th>
                  <th className="px-3 py-2 text-right">Voltage</th>
                  <th className="px-3 py-2 text-right">Iemax</th>
                  <th className="px-3 py-2 text-right">Pcs <span className="text-[10px] text-slate-400 font-normal">(max)</span></th>
                  <th className="px-3 py-2 text-right">WT (KG.)</th>
                  <th className="px-3 py-2 text-left">Worker</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((r) => (
                  <tr key={r.poOrderItemId} className="hover:bg-slate-50">
                    <td className="px-3 py-2 font-medium">{r.customerCode}</td>
                    <td className="px-3 py-2 text-slate-600">{fmtDate(r.orderDate)}</td>
                    <td className="px-3 py-2 text-slate-600">{r.measure}</td>
                    <td className="px-3 py-2 text-slate-600">{r.grade}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.turns || '—'}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-mono text-xs">{r.voltage || '—'}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-mono text-xs">{r.iemax || '—'}</td>
                    <td className="px-3 py-2 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <input
                          type="number" min={1} max={r.maxPcs}
                          className="input w-20 text-right tabular-nums"
                          value={r.pcs}
                          onChange={(e) => updateRow(r.poOrderItemId, 'pcs', e.target.value)}
                        />
                        <span className="text-[10px] text-slate-400">/{r.maxPcs}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums font-mono text-xs text-slate-700">{fmtWt(rowWt(r))}</td>
                    <td className="px-3 py-2">
                      <select
                        className="input w-44"
                        value={r.labourId}
                        onChange={(e) => updateRow(r.poOrderItemId, 'labourId', e.target.value)}
                      >
                        <option value="">— select worker —</option>
                        {labours.map((l) => (
                          <option key={l.id} value={l.id}>{l.name}</option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile — one card per row, structured for easy editing */}
          <div className="md:hidden divide-y divide-slate-100">
            {rows.map((r, idx) => (
              <div key={r.poOrderItemId} className="px-4 py-3 space-y-2.5">
                {/* Header — index + customer */}
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-[10px] uppercase tracking-wide text-slate-400 font-medium">
                      Item {idx + 1} · {fmtDate(r.orderDate)}
                    </div>
                    <div className="font-semibold text-sm text-slate-900 truncate">{r.customerCode}</div>
                  </div>
                </div>

                {/* Measure / grade / material chips */}
                <div className="flex flex-wrap gap-1.5 text-[11px]">
                  <span className="rounded bg-slate-100 px-2 py-0.5 font-medium text-slate-700">{r.measure}</span>
                  <span className="rounded bg-slate-100 px-2 py-0.5 font-medium text-slate-700">{r.grade}</span>
                  <span className="rounded bg-slate-100 px-2 py-0.5 font-medium text-slate-700">{r.material}</span>
                </div>

                {/* Calibration row */}
                {(r.flux || r.turns || r.voltage || r.iemax) && (
                  <div className="grid grid-cols-4 gap-2 rounded-md bg-slate-50 px-2 py-1.5 text-[11px]">
                    <Stat label="Flux"    value={r.flux || '—'} />
                    <Stat label="Turns"   value={r.turns || '—'} />
                    <Stat label="Voltage" value={r.voltage || '—'} />
                    <Stat label="Iemax"   value={r.iemax || '—'} />
                  </div>
                )}

                {/* Editable inputs — pcs and worker, stacked full-width */}
                <div className="grid grid-cols-2 gap-2 pt-1">
                  <label className="block">
                    <span className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-slate-500">
                      Pcs <span className="text-slate-400 normal-case">(max {r.maxPcs})</span>
                    </span>
                    <input
                      type="number" min={1} max={r.maxPcs} inputMode="numeric"
                      className="input w-full text-right tabular-nums"
                      value={r.pcs}
                      onChange={(e) => updateRow(r.poOrderItemId, 'pcs', e.target.value)}
                    />
                    <span className="mt-1 block text-right text-[10px] text-slate-400 tabular-nums">
                      WT ≈ {fmtWt(rowWt(r))} kg
                    </span>
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-slate-500">
                      Worker
                    </span>
                    <select
                      className="input w-full"
                      value={r.labourId}
                      onChange={(e) => updateRow(r.poOrderItemId, 'labourId', e.target.value)}
                    >
                      <option value="">— select —</option>
                      {labours.map((l) => (
                        <option key={l.id} value={l.id}>{l.name}</option>
                      ))}
                    </select>
                  </label>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Printable document — scroll horizontally on mobile; full-width PDF capture is unaffected. ── */}
      <div className="overflow-x-auto rounded-xl shadow-md print:overflow-visible print:shadow-none print:rounded-none">
        <div className="md:hidden px-3 py-2 bg-amber-50 border-b border-amber-200 text-[11px] text-amber-800 sticky left-0">
          Preview below scrolls horizontally — the downloaded PDF is full size.
        </div>
        <div ref={printRef} id="work-allotment-doc"
          className="bg-white text-black min-w-[1000px] rounded-xl overflow-hidden print:min-w-0 print:rounded-none print:overflow-visible">

          {/* Company header */}
          <div className="flex items-center justify-between border-b-2 border-black px-6 pt-4 pb-3 gap-4">
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
              <div className="text-base font-bold uppercase tracking-widest text-slate-900 border-2 border-slate-700 px-4 py-1.5 rounded flex items-center justify-center">
                Work Allotment
              </div>
            </div>
          </div>

          {/* Info rows */}
          <div className="grid grid-cols-2 border-b border-slate-300 text-sm">
            <InfoRow label="WA No." value={waNumber || '—'} border="border-r border-b" />
            <InfoRow label="WA Date" value={waDate ? fmtDate(waDate) : '—'} border="border-b" />
            <InfoRow label="Remarks" value={remarks || '—'} border="" />
            <InfoRow label="Total Pcs" value={String(totalPcs)} border="" />
          </div>

          {/* Items table(s) — paginated into page-sized chunks (header repeated)
              so html2pdf never slices a row across a page break. Column order:
              SR | Cust Code | SO Date | Measure | Grade | Material | Pcs |
              WT (KG.) | Flux | Turns | Voltage | Iemax | Worker */}
          {rowPages.map((pg, pi) => (
            <table key={pi} style={pi > 0 ? { pageBreakBefore: 'always' } : undefined}
              className="w-full text-sm border-collapse table-fixed">
              {docColgroup}
              {docThead}
              <tbody>
                {pg.items.map((r, j) => renderRow(r, pg.start + j))}
                {pi === rowPages.length - 1 && (
                  <tr className="h-8 border-t-2 border-slate-500 bg-slate-200">
                    <td colSpan={6} className="px-2 border-r border-slate-400 text-right text-[10px] font-black uppercase tracking-widest text-slate-600 align-middle">
                      Grand Total
                    </td>
                    <td className="px-1 border-r border-slate-400 text-center text-xs font-black text-slate-800 align-middle">
                      {totalPcs}
                    </td>
                    <td className="px-1 border-r border-slate-400 text-center text-xs font-black text-slate-800 align-middle tabular-nums">
                      {fmtWt(totalWt)}
                    </td>
                    <td colSpan={4} className="border-r border-slate-400 align-middle" />
                    <td className="align-middle" />
                  </tr>
                )}
              </tbody>
            </table>
          ))}

          {/* Signature footer — kept atomic (page-break-inside: avoid) so it moves
              whole to a fresh page rather than being sliced. */}
          <div className="grid grid-cols-2 border-t-2 border-slate-400 mt-2" style={{ pageBreakInside: 'avoid' }}>
            <div className="border-r border-slate-300 px-6 py-5">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 mb-5">Issued By</div>
              <div className="border-b border-slate-400 mb-1 min-h-[24px] text-sm font-medium flex items-end justify-center pb-0.5">{issuedBy}</div>
              <div className="text-[10px] text-slate-500">Name &amp; Signature</div>
              <div className="mt-2 text-[10px] text-slate-500">Date: {waDate ? fmtDate(waDate) : '___________'}</div>
            </div>
            <div className="px-6 py-5">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 mb-5">Received By</div>
              <div className="border-b border-slate-400 mb-1 min-h-[24px] text-sm font-medium flex items-end justify-center pb-0.5">{receivedBy}</div>
              <div className="text-[10px] text-slate-500">Worker Signature</div>
              <div className="mt-2 text-[10px] text-slate-500">Date: ___________</div>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
};

const InfoRow = ({ label, value, border }: { label: string; value: string; border: string }) => (
  <div className={`flex items-stretch ${border} border-slate-300`}>
    <span className="w-28 shrink-0 flex items-center bg-slate-50 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500 border-r border-slate-300">
      {label}
    </span>
    <span className="flex-1 flex items-center px-3 py-1.5 text-sm font-medium">{value}</span>
  </div>
);

const Stat = ({ label, value }: { label: string; value: string }) => (
  <div className="flex flex-col">
    <span className="text-[9px] uppercase tracking-wide text-slate-400 font-medium">{label}</span>
    <span className="font-mono tabular-nums text-slate-700 truncate">{value}</span>
  </div>
);
