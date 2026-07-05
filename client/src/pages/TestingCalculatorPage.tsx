// Testing Calculator — build a flux-test sheet mixing toroidal AND rectangular
// cores. Each row picks its own core type; the inputs, flux grades and Volt +
// Ie-max math adapt per row (same math as the PO / Testing Report). Export the
// lab sheet as Excel or a styled PDF.
import { useMemo, useRef, useState, Fragment } from 'react';
import { useQuery } from '@tanstack/react-query';
import * as XLSX from 'xlsx';
import {
  Calculator, Plus, Trash2, Download, FileDown, FileText, X, Search, Loader2, Beaker,
} from 'lucide-react';
import html2pdf from 'html2pdf.js';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { fluxTestCalc, rectangularCalc, rectangularFluxTestCalc } from '@/lib/calc';
import { todayStamp } from '@/lib/excel';

type CoreType = 'TOROIDAL' | 'RECTANGULAR';
type FluxPoint = { flux: number; ateCm: number };
type FluxGroup = { grade: string; points: FluxPoint[] };
type Item = {
  key: string;
  coreType: CoreType;
  // toroidal dims
  id: string; od: string; ht: string;
  // rectangular dims
  id1: string; id2: string; od1: string; od2: string;
  turns: string;
  grade: string;
  fluxes: number[];      // selected flux levels (T)
  source?: string;       // e.g. PO number when imported
};
type PoSummaryItem = {
  id: string; poNumber: string; coreType: CoreType;
  grade: string; measure: string; turns: number | null;
};
type CompanyDetail = {
  name: string; address: string | null; phone: string | null;
  whatsappNumber: string | null; email: string | null;
  logoUrl: string | null; gstNumber: string | null;
};

let seq = 0;
const mkItem = (p: Partial<Item> = {}): Item => ({
  key: `it_${++seq}`, coreType: 'TOROIDAL', id: '', od: '', ht: '',
  id1: '', id2: '', od1: '', od2: '', turns: '', grade: '', fluxes: [], ...p,
});

const numOk = (it: Item) => it.coreType === 'TOROIDAL'
  ? (+it.id > 0 && +it.od > 0 && +it.ht > 0 && +it.turns > 0 && +it.od > +it.id)
  : (+it.id1 > 0 && +it.id2 > 0 && +it.od1 > 0 && +it.od2 > 0 && +it.ht > 0 && +it.turns > 0 && +it.od1 > +it.id1 && +it.od2 > +it.id2);

const rectGeom = (it: Item) =>
  rectangularCalc({ id1: +it.id1, id2: +it.id2, od1: +it.od1, od2: +it.od2, ht: +it.ht, pcs: 0 });

const measureOf = (it: Item) => it.coreType === 'TOROIDAL'
  ? `${+it.id} x ${+it.od} x ${+it.ht}`
  : rectGeom(it).measure;

/* Parse a toroidal measure "180 x 110 x 200" → { id, od, ht }. */
const parseToroidal = (measure: string) => {
  const nums = (measure || '').split(/[x×*]/i).map((s) => s.trim()).filter(Boolean);
  return { id: nums[0] ?? '', od: nums[1] ?? '', ht: nums[2] ?? '' };
};
/* Parse a rectangular measure "id1 x id2 x od1 x od2 x ht x builtup" (builtup derived). */
const parseRectangular = (measure: string) => {
  const n = (measure || '').split(/[x×*]/i).map((s) => s.trim()).filter(Boolean);
  return { id1: n[0] ?? '', id2: n[1] ?? '', od1: n[2] ?? '', od2: n[3] ?? '', ht: n[4] ?? '' };
};

const fmtDate = (d: Date) => d.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });

export const TestingCalculatorPage = () => {
  const [items, setItems] = useState<Item[]>([mkItem()]);
  const [importOpen, setImportOpen] = useState(false);

  const torQ = useQuery({
    queryKey: ['flux-grades-grouped', 'TOROIDAL'],
    queryFn: () => api<{ grades: FluxGroup[] }>('/flux-grades/grouped?coreType=TOROIDAL'),
  });
  const rectQ = useQuery({
    queryKey: ['flux-grades-grouped', 'RECTANGULAR'],
    queryFn: () => api<{ grades: FluxGroup[] }>('/flux-grades/grouped?coreType=RECTANGULAR'),
  });
  const { data: company } = useQuery({
    queryKey: ['company-me'],
    queryFn: () => api<CompanyDetail>('/companies/me'),
  });

  const gradesFor = (ct: CoreType) => (ct === 'TOROIDAL' ? torQ.data?.grades : rectQ.data?.grades) ?? [];
  const pointsFor = (ct: CoreType, grade: string) => gradesFor(ct).find((g) => g.grade === grade)?.points ?? [];
  const ateFor = (ct: CoreType, grade: string, flux: number) => pointsFor(ct, grade).find((p) => p.flux === flux)?.ateCm ?? 0;

  const patch = (key: string, p: Partial<Item>) => setItems((its) => its.map((i) => (i.key === key ? { ...i, ...p } : i)));
  const remove = (key: string) => setItems((its) => its.filter((i) => i.key !== key));
  const addBlank = () => setItems((its) => [...its, mkItem()]);

  // Changing a row's core type resets its dims / grade / flux (they differ per shape).
  const setItemCore = (key: string, coreType: CoreType) => setItems((its) => its.map((i) => (
    i.key === key
      ? { ...i, coreType, id: '', od: '', ht: '', id1: '', id2: '', od1: '', od2: '', grade: '', fluxes: [] }
      : i
  )));

  const onGrade = (key: string, grade: string) => setItems((its) => its.map((i) => (
    i.key === key ? { ...i, grade, fluxes: pointsFor(i.coreType, grade).map((p) => p.flux) } : i
  )));
  const toggleFlux = (key: string, flux: number) => setItems((its) => its.map((i) => {
    if (i.key !== key) return i;
    const has = i.fluxes.includes(flux);
    return { ...i, fluxes: (has ? i.fluxes.filter((f) => f !== flux) : [...i.fluxes, flux]).sort((a, b) => a - b) };
  }));

  const fluxCols = useMemo(() => {
    const s = new Set<number>();
    items.forEach((i) => i.fluxes.forEach((f) => s.add(f)));
    return [...s].sort((a, b) => a - b);
  }, [items]);

  const cell = (it: Item, flux: number) => {
    if (!numOk(it) || !it.fluxes.includes(flux)) return null;
    const ateCm = ateFor(it.coreType, it.grade, flux);
    if (it.coreType === 'TOROIDAL') {
      const r = fluxTestCalc({ id: +it.id, od: +it.od, ht: +it.ht, turns: +it.turns, flux, ateCm });
      return { volt: r.testVoltage, leMax: r.testCurrent };
    }
    const g = rectGeom(it);
    const r = rectangularFluxTestCalc({ area: g.coreAc, meanPath: g.coreMl, turns: +it.turns, flux, ateCm });
    return { volt: r.testVoltage, leMax: r.testCurrent };
  };

  // Unified export columns — a Core + Measure pair keeps mixed rows aligned.
  const fixedCols = ['CORE', 'MEASURE', 'TURNS', 'GRADE'];
  const dimsOf = (it: Item): (string | number)[] => [
    it.coreType === 'TOROIDAL' ? 'Toroidal' : 'Rectangular',
    measureOf(it),
    +it.turns,
    it.grade || '—',
  ];

  const addFromPo = (po: PoSummaryItem) => {
    const ct = po.coreType;
    const grade = gradesFor(ct).some((g) => g.grade === po.grade) ? po.grade : '';
    const dims = ct === 'TOROIDAL' ? parseToroidal(po.measure) : parseRectangular(po.measure);
    setItems((its) => [...its, mkItem({
      coreType: ct, ...dims,
      turns: po.turns != null ? String(po.turns) : '',
      grade, fluxes: grade ? pointsFor(ct, grade).map((p) => p.flux) : [], source: po.poNumber,
    })]);
  };

  const exportRows = items.filter((it) => numOk(it) && it.fluxes.length);
  const exportable = exportRows.length > 0 && fluxCols.length > 0;

  /* ── Excel export (merged two-row header per the lab sheet) ── */
  const exportExcel = () => {
    if (!exportable) return;
    const head0: (string | number)[] = [...fixedCols];
    const head1: (string | number)[] = fixedCols.map(() => '');
    fluxCols.forEach((fx) => { head0.push(`${fx} T`, ''); head1.push('Volt (V)', 'Ie max (mA)'); });

    const body = exportRows.map((it) => {
      const r: (string | number)[] = [...dimsOf(it)];
      fluxCols.forEach((fx) => {
        const c = cell(it, fx);
        r.push(c ? c.volt : '', c && c.leMax > 0 ? c.leMax : '');
      });
      return r;
    });

    const ws = XLSX.utils.aoa_to_sheet([head0, head1, ...body]);
    const merges: { s: { r: number; c: number }; e: { r: number; c: number } }[] = [];
    fixedCols.forEach((_, c) => merges.push({ s: { r: 0, c }, e: { r: 1, c } }));
    fluxCols.forEach((_, i) => { const c = fixedCols.length + i * 2; merges.push({ s: { r: 0, c }, e: { r: 0, c: c + 1 } }); });
    ws['!merges'] = merges;
    ws['!cols'] = [
      { wch: 12 }, { wch: 34 }, { wch: 8 }, { wch: 12 },
      ...fluxCols.flatMap(() => [{ wch: 10 }, { wch: 12 }]),
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Testing');
    XLSX.writeFile(wb, `testing-calc-${todayStamp()}.xlsx`);
  };

  /* ── PDF export — styled lab sheet, captured offscreen via html2pdf ── */
  const printRef = useRef<HTMLDivElement>(null);
  const [generating, setGenerating] = useState(false);
  const exportPdf = async () => {
    const el = printRef.current;
    if (!el || !exportable) return;
    setGenerating(true);
    await new Promise((r) => requestAnimationFrame(r));
    try {
      await html2pdf().set({
        margin: 6,
        filename: `testing-calc-${todayStamp()}.pdf`,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true, logging: false, backgroundColor: '#ffffff', windowWidth: 1040 },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'landscape' },
        pagebreak: { mode: ['css', 'legacy'], avoid: ['tr'] },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any).from(el).save();
    } finally {
      setGenerating(false);
    }
  };

  const addressLine = company?.address?.replace(/\n+/g, ', ').trim() ?? '';

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2.5 text-2xl font-bold tracking-tight">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-brand-50 text-brand-600"><Calculator className="h-5 w-5" /></span>
            Testing Calculator
          </h1>
          <p className="mt-1 text-sm text-slate-500">Pick a core type per row, set turns &amp; flux levels → get Volt + Ie max, then export the lab sheet.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => setImportOpen(true)} className="btn-ghost border border-slate-300 text-slate-600 hover:bg-slate-50">
            <FileDown className="h-4 w-4" /> Import PO items
          </button>
          <button onClick={addBlank} className="btn-ghost border border-slate-300 text-slate-600 hover:bg-slate-50">
            <Plus className="h-4 w-4" /> Add item
          </button>
          <button onClick={exportExcel} disabled={!exportable} className="btn-ghost border border-slate-300 text-emerald-700 hover:bg-emerald-50 disabled:opacity-50">
            <Download className="h-4 w-4" /> Excel
          </button>
          <button onClick={exportPdf} disabled={!exportable || generating} className="btn-primary disabled:opacity-50">
            {generating ? <><Loader2 className="h-4 w-4 animate-spin" /> Generating…</> : <><FileText className="h-4 w-4" /> Download PDF</>}
          </button>
        </div>
      </div>

      {/* Summary strip */}
      {items.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1 font-medium text-slate-700">
            {items.length} line{items.length === 1 ? '' : 's'}
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 font-medium text-emerald-700">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> {exportRows.length} ready to export
          </span>
          {items.some((i) => i.coreType === 'TOROIDAL') && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-3 py-1 font-medium text-amber-700">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-400" /> {items.filter((i) => i.coreType === 'TOROIDAL').length} toroidal
            </span>
          )}
          {items.some((i) => i.coreType === 'RECTANGULAR') && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-rose-50 px-3 py-1 font-medium text-rose-700">
              <span className="h-1.5 w-1.5 rounded-full bg-rose-400" /> {items.filter((i) => i.coreType === 'RECTANGULAR').length} rectangular
            </span>
          )}
        </div>
      )}

      {/* Item editors */}
      <div className="space-y-3">
        {items.map((it, idx) => {
          const pts = pointsFor(it.coreType, it.grade);
          const rowGrades = gradesFor(it.coreType);
          const g = it.coreType === 'RECTANGULAR' && numOk(it) ? rectGeom(it) : null;
          const isTor = it.coreType === 'TOROIDAL';
          return (
            <div key={it.key} className={cn('card border-l-4 p-4 transition', isTor ? 'border-l-amber-400' : 'border-l-rose-400')}>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-3">
                  <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Item {idx + 1}{it.source && <span className="ml-2 rounded bg-brand-50 px-1.5 py-0.5 font-mono text-[10px] text-brand-700">{it.source}</span>}
                  </span>
                  {/* Per-row core type selector */}
                  <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5">
                    {(['TOROIDAL', 'RECTANGULAR'] as CoreType[]).map((ct) => (
                      <button key={ct} onClick={() => setItemCore(it.key, ct)}
                        className={cn('rounded-md px-3 py-1 text-xs font-medium transition',
                          it.coreType === ct ? 'bg-brand-600 text-white shadow-sm' : 'text-slate-600 hover:text-slate-900')}>
                        {ct === 'TOROIDAL' ? 'Toroidal' : 'Rectangular'}
                      </button>
                    ))}
                  </div>
                </div>
                <button onClick={() => remove(it.key)} className="btn-ghost text-red-600 hover:bg-red-50" title="Remove item"><Trash2 className="h-4 w-4" /></button>
              </div>

              {isTor ? (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                  <Field label="ID (mm)"><input className="input" type="number" inputMode="decimal" value={it.id} onChange={(e) => patch(it.key, { id: e.target.value })} /></Field>
                  <Field label="OD (mm)"><input className="input" type="number" inputMode="decimal" value={it.od} onChange={(e) => patch(it.key, { od: e.target.value })} /></Field>
                  <Field label="HT (mm)"><input className="input" type="number" inputMode="decimal" value={it.ht} onChange={(e) => patch(it.key, { ht: e.target.value })} /></Field>
                  <Field label="Turns"><input className="input" type="number" inputMode="numeric" value={it.turns} onChange={(e) => patch(it.key, { turns: e.target.value })} /></Field>
                  <Field label="Grade">
                    <select className="input" value={it.grade} onChange={(e) => onGrade(it.key, e.target.value)}>
                      <option value="">— Select —</option>
                      {rowGrades.map((gr) => <option key={gr.grade} value={gr.grade}>{gr.grade}</option>)}
                    </select>
                  </Field>
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
                    <Field label="ID1 (mm)"><input className="input" type="number" inputMode="decimal" value={it.id1} onChange={(e) => patch(it.key, { id1: e.target.value })} /></Field>
                    <Field label="ID2 (mm)"><input className="input" type="number" inputMode="decimal" value={it.id2} onChange={(e) => patch(it.key, { id2: e.target.value })} /></Field>
                    <Field label="OD1 (mm)"><input className="input" type="number" inputMode="decimal" value={it.od1} onChange={(e) => patch(it.key, { od1: e.target.value })} /></Field>
                    <Field label="OD2 (mm)"><input className="input" type="number" inputMode="decimal" value={it.od2} onChange={(e) => patch(it.key, { od2: e.target.value })} /></Field>
                    <Field label="HT (mm)"><input className="input" type="number" inputMode="decimal" value={it.ht} onChange={(e) => patch(it.key, { ht: e.target.value })} /></Field>
                    <Field label="Turns"><input className="input" type="number" inputMode="numeric" value={it.turns} onChange={(e) => patch(it.key, { turns: e.target.value })} /></Field>
                    <Field label="Grade">
                      <select className="input" value={it.grade} onChange={(e) => onGrade(it.key, e.target.value)}>
                        <option value="">— Select —</option>
                        {rowGrades.map((gr) => <option key={gr.grade} value={gr.grade}>{gr.grade}</option>)}
                      </select>
                    </Field>
                  </div>
                  {g && (
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-500">
                      <span>Built-up: <b className="text-slate-700">{g.builtup}</b> mm</span>
                      <span>Core area: <b className="text-slate-700">{g.coreAc}</b> sq.cm</span>
                      <span>Mean path: <b className="text-slate-700">{g.coreMl}</b> cm</span>
                    </div>
                  )}
                </>
              )}

              {rowGrades.length === 0 && (
                <p className="mt-2 text-xs text-amber-600">
                  No {isTor ? 'toroidal' : 'rectangular'} flux grades yet — add them under Settings → Flux Grades (Volt still computes without a grade).
                </p>
              )}

              {/* Flux chips */}
              <div className="mt-3">
                <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-slate-500">Flux levels {it.grade && `(${it.grade})`}</div>
                {!it.grade ? (
                  <p className="text-xs text-slate-400">Select a grade to choose flux levels.</p>
                ) : pts.length === 0 ? (
                  <p className="text-xs text-amber-600">This grade has no flux points. Add them under Settings → Flux Grades.</p>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {pts.map((p) => {
                      const on = it.fluxes.includes(p.flux);
                      return (
                        <button key={p.flux} onClick={() => toggleFlux(it.key, p.flux)}
                          title={`ATe/cm ${p.ateCm}`}
                          className={cn('rounded-full px-2.5 py-1 text-xs font-medium ring-1 transition',
                            on ? 'bg-brand-600 text-white ring-brand-600' : 'bg-white text-slate-600 ring-slate-200 hover:bg-slate-50')}>
                          {p.flux} T
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Live preview */}
              {numOk(it) && it.fluxes.length > 0 && (
                <div className="mt-3 overflow-x-auto rounded-lg border border-slate-100">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-50 text-slate-500">
                      <tr><th className="px-2 py-1.5 text-left">Flux</th>{it.fluxes.map((f) => <th key={f} className="px-2 py-1.5 text-right">{f} T</th>)}</tr>
                    </thead>
                    <tbody>
                      <tr className="border-t border-slate-100"><td className="px-2 py-1.5 font-medium text-slate-600">Volt (V)</td>{it.fluxes.map((f) => <td key={f} className="px-2 py-1.5 text-right tabular-nums">{cell(it, f)?.volt.toFixed(3) ?? '—'}</td>)}</tr>
                      <tr className="border-t border-slate-100"><td className="px-2 py-1.5 font-medium text-slate-600">Ie max (mA)</td>{it.fluxes.map((f) => <td key={f} className="px-2 py-1.5 text-right tabular-nums">{(cell(it, f)?.leMax ?? 0) > 0 ? cell(it, f)?.leMax.toFixed(2) : '—'}</td>)}</tr>
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {items.length === 0 && (
        <div className="card py-12 text-center text-sm text-slate-400">
          <Beaker className="mx-auto mb-2 h-8 w-8 text-slate-300" />
          No items. Add one or import from your sales orders.
        </div>
      )}

      {importOpen && <ImportDialog onClose={() => setImportOpen(false)} onAdd={addFromPo} />}

      {/* ── Offscreen printable document for the PDF ── */}
      <div style={{ position: 'fixed', left: -10000, top: 0, width: 1040 }} aria-hidden>
        <div ref={printRef} className="bg-white text-black" style={{ width: 1040, fontFamily: 'Arial, sans-serif' }}>
          <div className="flex items-center gap-5 border-b-2 border-black px-6 pt-4 pb-3">
            {company?.logoUrl
              ? <img src={company.logoUrl} alt={company.name} className="h-20 w-20 object-contain shrink-0" />
              : <div className="flex h-20 w-20 items-center justify-center rounded-lg bg-slate-100 text-xs text-slate-400">LOGO</div>}
            <div className="min-w-0">
              <div className="text-lg font-black uppercase tracking-wide leading-tight">{company?.name ?? 'Company Name'}</div>
              {addressLine && <div className="mt-0.5 max-w-2xl text-[11px] font-semibold leading-snug text-slate-700">{addressLine}</div>}
              {(company?.phone || company?.whatsappNumber || company?.email) && (
                <div className="mt-0.5 text-[11px] text-slate-600">
                  <span className="font-semibold">Contact:</span> {[company.phone, company.whatsappNumber, company.email].filter(Boolean).join('  |  ')}
                </div>
              )}
              {company?.gstNumber && <div className="mt-0.5 text-[11px] text-slate-600">GSTIN: {company.gstNumber}</div>}
            </div>
          </div>

          <div className="border-b-2 border-black px-6 py-2.5 text-center">
            <span className="inline-block rounded border-2 border-slate-800 px-6 py-1.5 text-lg font-extrabold uppercase tracking-[0.25em] text-slate-900">
              Testing Calculation Sheet
            </span>
          </div>

          <div className="flex justify-between border-b border-slate-300 px-6 py-2 text-sm">
            <span><b>Date:</b> {fmtDate(new Date())}</span>
            <span><b>Items:</b> {exportRows.length}</span>
          </div>

          <div className="px-6 py-4">
            <table className="w-full border-collapse text-[11px]">
              <thead>
                <tr>
                  {fixedCols.map((h) => (
                    <th key={h} rowSpan={2} className="border border-slate-400 bg-slate-100 px-2 py-1.5 text-center font-bold uppercase tracking-wide">{h}</th>
                  ))}
                  {fluxCols.map((fx) => (
                    <th key={fx} colSpan={2} className="border border-slate-400 bg-slate-100 px-2 py-1.5 text-center font-bold">{fx} T</th>
                  ))}
                </tr>
                <tr>
                  {fluxCols.map((fx) => (
                    <Fragment key={fx}>
                      <th className="border border-slate-400 bg-slate-50 px-2 py-1 text-center font-semibold">Volt (V)</th>
                      <th className="border border-slate-400 bg-slate-50 px-2 py-1 text-center font-semibold">Ie max (mA)</th>
                    </Fragment>
                  ))}
                </tr>
              </thead>
              <tbody>
                {exportRows.map((it) => (
                  <tr key={it.key}>
                    {dimsOf(it).map((v, ci) => (
                      <td key={ci} className={cn('border border-slate-300 px-2 py-1.5 tabular-nums', ci === 1 ? 'text-left' : 'text-center')}>{v}</td>
                    ))}
                    {fluxCols.map((fx) => {
                      const c = cell(it, fx);
                      return (
                        <Fragment key={fx}>
                          <td className="border border-slate-300 px-2 py-1.5 text-right tabular-nums">{c ? c.volt.toFixed(3) : '—'}</td>
                          <td className="border border-slate-300 px-2 py-1.5 text-right tabular-nums">{c && c.leMax > 0 ? c.leMax.toFixed(2) : '—'}</td>
                        </Fragment>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="px-6 pb-6 pt-1 text-[9px] leading-relaxed text-slate-500">
            Volt = 222 × Flux × A × Turns ÷ 10000&nbsp;&nbsp;·&nbsp;&nbsp;Ie max = ATe/cm × 1000 × mean-path ÷ Turns.
            {company?.name ? ` Generated by ${company.name}.` : ''}
          </div>
        </div>
      </div>
    </div>
  );
};

const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <label className="block">
    <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</span>
    {children}
  </label>
);

/* ── Import-from-PO dialog (both core types) ── */
const ImportDialog = ({ onClose, onAdd }: { onClose: () => void; onAdd: (po: PoSummaryItem) => void }) => {
  const [search, setSearch] = useState('');
  const { data, isLoading } = useQuery({
    queryKey: ['testing-po-items'],
    queryFn: () => api<{ items: PoSummaryItem[] }>('/po-orders/summary?status=ACTIVE&pageSize=10000'),
  });
  const items = (data?.items ?? [])
    .filter((i) => !search.trim() || `${i.poNumber} ${i.measure} ${i.grade}`.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="flex max-h-[80vh] w-full max-w-lg flex-col rounded-2xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <h3 className="font-bold text-slate-900">Import PO items</h3>
          <button onClick={onClose} className="rounded p-1 text-slate-400 hover:bg-slate-100"><X className="h-4 w-4" /></button>
        </div>
        <div className="border-b border-slate-100 p-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input className="input pl-9" placeholder="Search PO #, measure, grade…" value={search} onChange={(e) => setSearch(e.target.value)} autoFocus />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="py-10 text-center text-slate-400"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></div>
          ) : !items.length ? (
            <div className="py-10 text-center text-sm text-slate-400">No matching items.</div>
          ) : items.map((i) => (
            <button key={i.id} onClick={() => onAdd(i)} className="flex w-full items-center justify-between gap-3 border-t border-slate-100 px-4 py-2.5 text-left hover:bg-brand-50/50">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-slate-800">{i.measure}</div>
                <div className="text-[11px] text-slate-500">{i.poNumber} · {i.grade || 'no grade'} · {i.turns ?? '—'} turns</div>
              </div>
              <span className="flex shrink-0 items-center gap-2">
                <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-medium',
                  i.coreType === 'TOROIDAL' ? 'bg-sky-50 text-sky-700' : 'bg-violet-50 text-violet-700')}>
                  {i.coreType === 'TOROIDAL' ? 'Toroidal' : 'Rectangular'}
                </span>
                <Plus className="h-4 w-4 text-brand-600" />
              </span>
            </button>
          ))}
        </div>
        <div className="border-t border-slate-200 px-4 py-2.5 text-right">
          <button onClick={onClose} className="btn-primary">Done</button>
        </div>
      </div>
    </div>
  );
};
