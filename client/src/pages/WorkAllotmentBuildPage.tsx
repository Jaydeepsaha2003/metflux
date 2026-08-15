// Work Allotment template — opened either in "build mode" (state.poItemIds) or
// "view mode" (state.waId). Each row carries an editable pcs and a labour
// dropdown. On save we POST to /work-allotments and download a PDF using the
// same html2pdf approach as PackingListPage.
import { useRef, useState, useEffect, useMemo } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Download, ClipboardList, Loader2, MessageCircle, Check, RotateCcw, Scissors, X } from 'lucide-react';
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
  ht: number;
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
  ht: number | null;
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

let RID = 0;
const rid = () => `row-${++RID}`;

type RowState = {
  rowId: string;      // unique per row — one PO item can have several (split) rows
  poOrderItemId: string;
  customerCode: string;
  orderDate: string;
  measure: string;
  ht: number;          // core height in mm — the strip width to slit to
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
        rowId:         rid(),
        poOrderItemId: it.poOrderItemId,
        customerCode:  it.customerCode ?? '',
        orderDate:     it.orderDate ?? '',
        measure:       it.measure ?? '',
        ht:            Number(it.ht) || 0,
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
      const meta = new Map(pendingList.items.map((p) => [p.id, p]));
      const mkRow = (p: PendingItem, pcs: string, labourId = ''): RowState => ({
        rowId:         rid(),
        poOrderItemId: p.id,
        customerCode:  p.customerCode,
        orderDate:     p.orderDate,
        measure:       p.measure,
        ht:            Number(p.ht) || 0,
        grade:         p.grade,
        material:      p.material,
        flux:          numStr(p.flux, 2),
        turns:         p.turns != null ? String(p.turns) : '',
        voltage:       numStr(p.testVoltage, 2),
        iemax:         numStr(p.testCurrent, 2),
        pcs,
        maxPcs:        p.remainingPcs,
        weightPerPc:   p.weightPerPc ?? 0,
        labourId,
      });
      let built: RowState[] = effectiveIds
        .map((id) => meta.get(id))
        .filter((p): p is PendingItem => !!p)
        .map((p) => mkRow(p, String(p.remainingPcs)));
      // Overlay a saved draft (same selection) — restores typed pcs / workers /
      // number / signatures, INCLUDING any splits (multiple rows per item).
      if (draft && sameIds(draft.data.poItemIds, effectiveIds)) {
        const dRows = draft.data.rows.filter((dr) => meta.has(dr.poOrderItemId));
        if (dRows.length) built = dRows.map((dr) => mkRow(meta.get(dr.poOrderItemId)!, dr.pcs, dr.labourId));
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

  const updateRow = (rowId: string, field: keyof RowState, val: string) =>
    setRows((prev) => prev.map((r) => (r.rowId === rowId ? { ...r, [field]: val } : r)));

  // Split a PO item into another worker row. New row's default pcs = whatever is
  // left of that item's remaining after the existing rows.
  const addSplit = (row: RowState) => setRows((prev) => {
    const used = prev.filter((r) => r.poOrderItemId === row.poOrderItemId).reduce((s, r) => s + (parseInt(r.pcs) || 0), 0);
    const leftover = Math.max(row.maxPcs - used, 0);
    const idx = prev.map((r) => r.poOrderItemId).lastIndexOf(row.poOrderItemId);
    const copy = [...prev];
    copy.splice(idx + 1, 0, { ...row, rowId: rid(), pcs: String(leftover), labourId: '' });
    return copy;
  });
  const removeRow = (rowId: string) => setRows((prev) => (prev.length > 1 ? prev.filter((r) => r.rowId !== rowId) : prev));
  // How many rows this item is split across (for showing the split/remove UI).
  const itemRowCount = (poOrderItemId: string) => rows.filter((r) => r.poOrderItemId === poOrderItemId).length;

  const totalPcs = rows.reduce((s, r) => s + (parseInt(r.pcs) || 0), 0);

  // WT (KG.) per line = allotted pcs × weight per piece. Recomputed live as pcs
  // is edited. 3-decimal precision mirrors weights shown elsewhere in the app.
  const fmtWt = (n: number) => (Number.isFinite(n) ? n : 0).toFixed(3);
  const rowWt = (r: RowState) => (parseInt(r.pcs) || 0) * (r.weightPerPc || 0);

  /* Slitting plan — a toroidal core is wound from CRGO strip, so the strip width
     to slit IS the core height (ht). Group the allotted work by ht + grade +
     material and total it, which is exactly what the slitting operator needs:
     which widths, in which grade/material, and how much. Derived from the rows,
     so it always matches the allotment above and needs no storage of its own. */
  const slittingPlan = (() => {
    const map = new Map<string, { ht: number; grade: string; material: string; pcs: number; weight: number }>();
    for (const r of rows) {
      const pcs = parseInt(r.pcs) || 0;
      if (pcs <= 0) continue;
      const key = `${r.ht}|${r.grade}|${r.material}`;
      const g = map.get(key) ?? { ht: r.ht, grade: r.grade, material: r.material, pcs: 0, weight: 0 };
      g.pcs += pcs;
      g.weight += pcs * (r.weightPerPc || 0);
      map.set(key, g);
    }
    // Ascending width is the order the slitter actually works in.
    return [...map.values()].sort((a, b) => a.ht - b.ht || a.grade.localeCompare(b.grade) || a.material.localeCompare(b.material));
  })();
  const slitTotals = slittingPlan.reduce((t, g) => ({ pcs: t.pcs + g.pcs, weight: t.weight + g.weight }), { pcs: 0, weight: 0 });
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
    }
    // A split item's total (across all its worker rows) can't exceed its remaining.
    const byItem = new Map<string, { sum: number; max: number; label: string }>();
    for (const r of rows) {
      const cur = byItem.get(r.poOrderItemId) ?? { sum: 0, max: r.maxPcs, label: r.measure || r.grade };
      cur.sum += parseInt(r.pcs) || 0;
      byItem.set(r.poOrderItemId, cur);
    }
    for (const { sum, max, label } of byItem.values()) {
      if (sum > max) return `Total pcs (${sum}) for ${label} exceeds remaining (${max}).`;
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

    // ── Page-by-page rendering ───────────────────────────────────────────
    // Split the document into separate page-sized DIVs (measured row heights,
    // header repeated, signature kept whole) and render EACH page as its own
    // canvas onto its own PDF page. The previous approach rendered one tall
    // canvas that html2pdf sliced at computed offsets — rounding drift
    // accumulated page after page, so by page ~5 headers overlapped rows.
    // With one canvas per page there is nothing to slice, so nothing can
    // drift, overlap or ghost — on page 2 or page 50.
    const MARGIN_MM = 8;
    const pxPerMm = A4_USABLE_PX / (297 - 2 * MARGIN_MM);   // clone px ↔ usable mm
    // Usable landscape page height in clone px, packed to 93% — headroom for
    // html2canvas laying content out a few px taller than we measure here.
    const PAGE_H = (210 - 2 * MARGIN_MM) * pxPerMm * 0.93;

    const srcTable = clone.querySelector('table');
    const thead = srcTable?.querySelector('thead') ?? null;
    const colgroup = srcTable?.querySelector('colgroup') ?? null;
    const tbody = srcTable?.querySelector('tbody') ?? null;
    const signature = clone.querySelector<HTMLElement>('.wa-signature');
    // Pulled out first: the paginator only moves table rows and the signature,
    // and discards whatever is left in the clone. The slitting plan gets its own
    // page at the end so the slitter can be handed just that sheet.
    const slitting = clone.querySelector<HTMLElement>('.wa-slitting');
    if (slitting) slitting.remove();

    let pages: HTMLElement[] = [clone];
    if (srcTable && tbody) {
      const theadH = thead?.getBoundingClientRect().height ?? 0;
      const sigH = signature?.getBoundingClientRect().height ?? 0;
      // Everything above the table (company header + info band) → page 1 only.
      const preTable: HTMLElement[] = [];
      for (const child of Array.from(clone.children) as HTMLElement[]) {
        if (child === srcTable) break;
        preTable.push(child);
      }
      const preH = preTable.reduce((s, n) => s + n.getBoundingClientRect().height, 0);

      // Pack whole rows into pages using their real rendered heights.
      const groups: HTMLElement[][] = [];
      let current: HTMLElement[] = [];
      let used = preH + theadH;
      for (const tr of Array.from(tbody.children) as HTMLElement[]) {
        const h = tr.getBoundingClientRect().height;
        if (current.length && used + h > PAGE_H) {
          groups.push(current);
          current = [];
          used = theadH; // pages 2+ start with just the repeated column header
        }
        current.push(tr);
        used += h;
      }
      if (current.length) groups.push(current);
      const sigOnLastPage = used + sigH <= PAGE_H;

      const mkPage = () => {
        const p = document.createElement('div');
        p.className = clone.className;
        p.style.width = `${A4_USABLE_PX}px`;
        p.style.minWidth = '0';
        p.style.overflow = 'visible';
        p.style.borderRadius = '0';
        p.style.boxShadow = 'none';
        p.style.background = '#ffffff';
        return p;
      };

      pages = groups.map((group, gi) => {
        const page = mkPage();
        if (gi === 0) preTable.forEach((n) => page.appendChild(n)); // moves nodes
        const t = document.createElement('table');
        t.className = srcTable.className;
        if (colgroup) t.appendChild(colgroup.cloneNode(true));
        if (thead) t.appendChild(thead.cloneNode(true));
        const tb = document.createElement('tbody');
        group.forEach((tr) => tb.appendChild(tr)); // moves rows out of the clone
        t.appendChild(tb);
        page.appendChild(t);
        return page;
      });
      if (signature) {
        const host = sigOnLastPage ? pages[pages.length - 1] : mkPage();
        host.appendChild(signature);
        if (!sigOnLastPage) pages.push(host);
      }
      if (slitting) {
        const host = mkPage();
        slitting.style.marginTop = '0';
        host.appendChild(slitting);
        pages.push(host);
      }
      pages.forEach((p) => offscreen.appendChild(p));
      offscreen.removeChild(clone); // the gutted clone is no longer needed
    } else if (slitting) {
      // No item table to paginate — put the plan back so it still prints.
      clone.appendChild(slitting);
    }

    const filename = `Work-Allotment-${waNumber || 'WA'}.pdf`;
    const OPTS = {
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
    };
    // Render page 1, then for each further page element: add a blank PDF page
    // and render that element onto it. The explicit .toContainer().toCanvas()
    // .toPdf() re-runs the pipeline per element — the prerequisite system
    // would otherwise just reuse the previous canvas.
    // The worker-chain API (toPdf/get/toContainer/toCanvas) isn't in the
    // package's type stubs — go through `any` for the whole chain.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let worker: any = (html2pdf() as any).set(OPTS).from(pages[0]).toPdf();
    for (const pageEl of pages.slice(1)) {
      worker = worker
        .get('pdf')
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .then((pdf: any) => { pdf.addPage(); })
        .from(pageEl).toContainer().toCanvas().toPdf();
    }

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

  /* Reusable colgroup / header / row renderer for the printable items table.
     The doc renders as one table; pagination is decided in buildPdfJob by
     measuring real row heights, so a wrapped (taller) cell can never make a
     row straddle — and get sliced/ghosted across — a page boundary. */
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
    <tr key={r.rowId} className="h-9 border-b border-slate-200">
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
                  <th className="px-3 py-2 text-center">Split</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((r) => {
                  const split = itemRowCount(r.poOrderItemId) > 1;
                  return (
                  <tr key={r.rowId} className="hover:bg-slate-50">
                    <td className="px-3 py-2 font-medium">{r.customerCode}{split && <span className="ml-1.5 rounded bg-brand-50 px-1.5 py-0.5 text-[10px] font-medium text-brand-700">split</span>}</td>
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
                          onChange={(e) => updateRow(r.rowId, 'pcs', e.target.value)}
                        />
                        <span className="text-[10px] text-slate-400">/{r.maxPcs}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums font-mono text-xs text-slate-700">{fmtWt(rowWt(r))}</td>
                    <td className="px-3 py-2">
                      <select
                        className="input w-44"
                        value={r.labourId}
                        onChange={(e) => updateRow(r.rowId, 'labourId', e.target.value)}
                      >
                        <option value="">— select worker —</option>
                        {labours.map((l) => (
                          <option key={l.id} value={l.id}>{l.name}</option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-2 text-center">
                      <div className="inline-flex items-center gap-1">
                        <button type="button" onClick={() => addSplit(r)} title="Split — assign part of this item to another worker"
                          className="rounded p-1 text-brand-600 hover:bg-brand-50"><Scissors className="h-4 w-4" /></button>
                        {split && (
                          <button type="button" onClick={() => removeRow(r.rowId)} title="Remove this split row"
                            className="rounded p-1 text-red-500 hover:bg-red-50"><X className="h-4 w-4" /></button>
                        )}
                      </div>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile — one card per row, structured for easy editing */}
          <div className="md:hidden divide-y divide-slate-100">
            {rows.map((r, idx) => (
              <div key={r.rowId} className="px-4 py-3 space-y-2.5">
                {/* Header — index + customer */}
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-[10px] uppercase tracking-wide text-slate-400 font-medium">
                      Item {idx + 1} · {fmtDate(r.orderDate)}
                      {itemRowCount(r.poOrderItemId) > 1 && <span className="ml-1.5 rounded bg-brand-50 px-1.5 py-0.5 text-[9px] font-medium text-brand-700">split</span>}
                    </div>
                    <div className="font-semibold text-sm text-slate-900 truncate">{r.customerCode}</div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button type="button" onClick={() => addSplit(r)} title="Split to another worker" className="rounded p-1 text-brand-600 hover:bg-brand-50"><Scissors className="h-4 w-4" /></button>
                    {itemRowCount(r.poOrderItemId) > 1 && (
                      <button type="button" onClick={() => removeRow(r.rowId)} title="Remove this split" className="rounded p-1 text-red-500 hover:bg-red-50"><X className="h-4 w-4" /></button>
                    )}
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
                      onChange={(e) => updateRow(r.rowId, 'pcs', e.target.value)}
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
                      onChange={(e) => updateRow(r.rowId, 'labourId', e.target.value)}
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

          {/* Items table — column order: SR | Cust Code | SO Date | Measure |
              Grade | Material | Pcs | WT (KG.) | Flux | Turns | Voltage | Iemax |
              Worker. Page breaks are inserted per-row in buildPdfJob. */}
          <table className="w-full text-sm border-collapse table-fixed">
            {docColgroup}
            {docThead}
            <tbody>
              {rows.map((r, idx) => renderRow(r, idx))}
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
            </tbody>
          </table>

          {/* Signature footer — kept atomic (page-break-inside: avoid) so it moves
              whole to a fresh page rather than being sliced. */}
          <div className="wa-signature grid grid-cols-2 border-t-2 border-slate-400 mt-2" style={{ pageBreakInside: 'avoid' }}>
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

          {/* Slitting plan — lifted onto its own PDF page by buildPdfJob. A toroid
              is wound from strip, so the width to slit IS the core height. */}
          {slittingPlan.length > 0 && (
            <div className="wa-slitting mt-4">
              <div className="border-b-2 border-slate-400 pb-1 mb-2 flex items-baseline justify-between">
                <h3 className="text-sm font-black uppercase tracking-wider text-slate-800">Slitting Plan</h3>
                <span className="text-[10px] text-slate-500">
                  Strip width = core height (HT) · {slittingPlan.length} width{slittingPlan.length === 1 ? '' : 's'} to slit
                </span>
              </div>
              <table className="w-full border-collapse">
                <colgroup>
                  <col style={{ width: '8%' }} /><col style={{ width: '14%' }} />
                  <col style={{ width: '26%' }} /><col style={{ width: '30%' }} />
                  <col style={{ width: '11%' }} /><col style={{ width: '11%' }} />
                </colgroup>
                <thead>
                  <tr className="bg-slate-100 border-y-2 border-slate-400 text-[10px] font-black uppercase tracking-wide text-slate-700">
                    <th className="px-1 py-1.5 border-r border-slate-400 text-center">Sr</th>
                    <th className="px-1 py-1.5 border-r border-slate-400 text-center">HT (mm)</th>
                    <th className="px-2 py-1.5 border-r border-slate-400 text-left">Grade</th>
                    <th className="px-2 py-1.5 border-r border-slate-400 text-left">Material</th>
                    <th className="px-1 py-1.5 border-r border-slate-400 text-center">Qty (Pcs)</th>
                    <th className="px-1 py-1.5 text-center">Wt (Kg.)</th>
                  </tr>
                </thead>
                <tbody>
                  {slittingPlan.map((g, i) => (
                    <tr key={`${g.ht}-${g.grade}-${g.material}`} className="border-b border-slate-300 text-xs">
                      <td className="px-1 py-1 border-r border-slate-400 text-center text-slate-500 tabular-nums">{i + 1}</td>
                      <td className="px-1 py-1 border-r border-slate-400 text-center font-black tabular-nums text-slate-900">{g.ht}</td>
                      <td className="px-2 py-1 border-r border-slate-400 font-semibold text-slate-800">{g.grade || '—'}</td>
                      <td className="px-2 py-1 border-r border-slate-400 text-slate-700">{g.material || '—'}</td>
                      <td className="px-1 py-1 border-r border-slate-400 text-center font-bold tabular-nums">{g.pcs}</td>
                      <td className="px-1 py-1 text-center font-bold tabular-nums">{fmtWt(g.weight)}</td>
                    </tr>
                  ))}
                  <tr className="border-y-2 border-slate-400 bg-slate-100">
                    <td colSpan={4} className="px-2 py-1.5 border-r border-slate-400 text-right text-xs font-black uppercase tracking-wide text-slate-700">
                      Total
                    </td>
                    <td className="px-1 py-1.5 border-r border-slate-400 text-center text-xs font-black tabular-nums text-slate-900">{slitTotals.pcs}</td>
                    <td className="px-1 py-1.5 text-center text-xs font-black tabular-nums text-slate-900">{fmtWt(slitTotals.weight)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}

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
