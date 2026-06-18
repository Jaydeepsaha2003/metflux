// Testing Calculator — build a flux-test sheet for toroidal cores.
// Add PO items (or your own), set turns, pick a grade + one or more flux levels,
// and the page computes Volt + Ie max per flux (same math as the PO/Testing
// Report) and exports an Excel matching the lab template.
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import * as XLSX from 'xlsx';
import {
  Calculator, Plus, Trash2, Download, FileDown, X, Search, Loader2, Beaker,
} from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { fluxTestCalc } from '@/lib/calc';
import { todayStamp } from '@/lib/excel';

type FluxPoint = { flux: number; ateCm: number };
type FluxGroup = { grade: string; points: FluxPoint[] };
type Item = {
  key: string;
  id: string; od: string; ht: string; turns: string;
  grade: string;
  fluxes: number[];      // selected flux levels (T)
  source?: string;       // e.g. PO number when imported
};
type PoSummaryItem = {
  id: string; poNumber: string; coreType: 'TOROIDAL' | 'RECTANGULAR';
  grade: string; measure: string; turns: number | null;
};

let seq = 0;
const mkItem = (p: Partial<Item> = {}): Item => ({
  key: `it_${++seq}`, id: '', od: '', ht: '', turns: '', grade: '', fluxes: [], ...p,
});

const numOk = (it: Item) => +it.id > 0 && +it.od > 0 && +it.ht > 0 && +it.turns > 0 && +it.od > +it.id;

/* Parse a toroidal measure "180 x 110 x 200" → { id, od, ht }. */
const parseToroidal = (measure: string) => {
  const nums = (measure || '').split(/[x×*]/i).map((s) => s.trim()).filter(Boolean);
  return { id: nums[0] ?? '', od: nums[1] ?? '', ht: nums[2] ?? '' };
};

export const TestingCalculatorPage = () => {
  const [items, setItems] = useState<Item[]>([mkItem()]);
  const [importOpen, setImportOpen] = useState(false);

  const { data: fluxData } = useQuery({
    queryKey: ['flux-grades-grouped', 'TOROIDAL'],
    queryFn: () => api<{ grades: FluxGroup[] }>('/flux-grades/grouped?coreType=TOROIDAL'),
  });
  const grades = fluxData?.grades ?? [];
  const pointsFor = (grade: string) => grades.find((g) => g.grade === grade)?.points ?? [];
  const ateFor = (grade: string, flux: number) => pointsFor(grade).find((p) => p.flux === flux)?.ateCm ?? 0;

  const patch = (key: string, p: Partial<Item>) => setItems((its) => its.map((i) => (i.key === key ? { ...i, ...p } : i)));
  const remove = (key: string) => setItems((its) => its.filter((i) => i.key !== key));
  const addBlank = () => setItems((its) => [...its, mkItem()]);

  // Picking a grade pre-selects all its flux points (user can trim).
  const onGrade = (key: string, grade: string) => patch(key, { grade, fluxes: pointsFor(grade).map((p) => p.flux) });
  const toggleFlux = (key: string, flux: number) => setItems((its) => its.map((i) => {
    if (i.key !== key) return i;
    const has = i.fluxes.includes(flux);
    return { ...i, fluxes: (has ? i.fluxes.filter((f) => f !== flux) : [...i.fluxes, flux]).sort((a, b) => a - b) };
  }));

  // Columns = every flux level picked across all items, ascending.
  const fluxCols = useMemo(() => {
    const s = new Set<number>();
    items.forEach((i) => i.fluxes.forEach((f) => s.add(f)));
    return [...s].sort((a, b) => a - b);
  }, [items]);

  const cell = (it: Item, flux: number) => {
    if (!numOk(it) || !it.fluxes.includes(flux)) return null;
    const r = fluxTestCalc({ id: +it.id, od: +it.od, ht: +it.ht, turns: +it.turns, flux, ateCm: ateFor(it.grade, flux) });
    return { volt: r.testVoltage, leMax: r.testCurrent };
  };

  const addFromPo = (po: PoSummaryItem) => {
    const { id, od, ht } = parseToroidal(po.measure);
    const grade = grades.some((g) => g.grade === po.grade) ? po.grade : '';
    setItems((its) => [...its, mkItem({
      id, od, ht, turns: po.turns != null ? String(po.turns) : '',
      grade, fluxes: grade ? pointsFor(grade).map((p) => p.flux) : [], source: po.poNumber,
    })]);
  };

  /* ── Excel export (merged two-row header per the lab sheet) ── */
  const exportExcel = () => {
    const rows = items.filter((it) => numOk(it) && it.fluxes.length);
    if (!rows.length || !fluxCols.length) return;
    const fixed = ['ID', 'OD', 'HT', 'TURNS', 'GRADE'];
    const head0: (string | number)[] = [...fixed];
    const head1: (string | number)[] = fixed.map(() => '');
    fluxCols.forEach((fx) => { head0.push(`${fx} T`, ''); head1.push('Volt (V)', 'Ie max (mA)'); });

    const body = rows.map((it) => {
      const r: (string | number)[] = [+it.id, +it.od, +it.ht, +it.turns, it.grade || '—'];
      fluxCols.forEach((fx) => {
        const c = cell(it, fx);
        r.push(c ? c.volt : '', c ? c.leMax : '');
      });
      return r;
    });

    const ws = XLSX.utils.aoa_to_sheet([head0, head1, ...body]);
    const merges: { s: { r: number; c: number }; e: { r: number; c: number } }[] = [];
    fixed.forEach((_, c) => merges.push({ s: { r: 0, c }, e: { r: 1, c } }));      // vertical span for fixed cols
    fluxCols.forEach((_, i) => { const c = fixed.length + i * 2; merges.push({ s: { r: 0, c }, e: { r: 0, c: c + 1 } }); }); // flux label spans its pair
    ws['!merges'] = merges;
    ws['!cols'] = [
      { wch: 7 }, { wch: 7 }, { wch: 7 }, { wch: 8 }, { wch: 10 },
      ...fluxCols.flatMap(() => [{ wch: 10 }, { wch: 12 }]),
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Testing');
    XLSX.writeFile(wb, `testing-calc-${todayStamp()}.xlsx`);
  };

  const exportable = items.some((it) => numOk(it) && it.fluxes.length) && fluxCols.length > 0;

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <Calculator className="h-5 w-5 text-brand-600" /> Testing Calculator
          </h1>
          <p className="mt-1 text-sm text-slate-500">Pick items, turns &amp; flux levels → get Volt + Ie max, then export the lab sheet.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => setImportOpen(true)} className="btn-ghost border border-slate-300 text-slate-600 hover:bg-slate-50">
            <FileDown className="h-4 w-4" /> Import PO items
          </button>
          <button onClick={addBlank} className="btn-ghost border border-slate-300 text-slate-600 hover:bg-slate-50">
            <Plus className="h-4 w-4" /> Add item
          </button>
          <button onClick={exportExcel} disabled={!exportable} className="btn-primary disabled:opacity-50">
            <Download className="h-4 w-4" /> Download Excel
          </button>
        </div>
      </div>

      {grades.length === 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          No toroidal flux grades found. Add them under <strong>Settings → Flux Grades</strong> so Ie max can be computed (Volt still works without).
        </div>
      )}

      {/* Item editors */}
      <div className="space-y-3">
        {items.map((it, idx) => {
          const pts = pointsFor(it.grade);
          return (
            <div key={it.key} className="card p-4">
              <div className="mb-3 flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Item {idx + 1}{it.source && <span className="ml-2 rounded bg-brand-50 px-1.5 py-0.5 font-mono text-[10px] text-brand-700">{it.source}</span>}
                </span>
                <button onClick={() => remove(it.key)} className="btn-ghost text-red-600 hover:bg-red-50" title="Remove item"><Trash2 className="h-4 w-4" /></button>
              </div>

              <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                <Field label="ID (mm)"><input className="input" type="number" inputMode="decimal" value={it.id} onChange={(e) => patch(it.key, { id: e.target.value })} /></Field>
                <Field label="OD (mm)"><input className="input" type="number" inputMode="decimal" value={it.od} onChange={(e) => patch(it.key, { od: e.target.value })} /></Field>
                <Field label="HT (mm)"><input className="input" type="number" inputMode="decimal" value={it.ht} onChange={(e) => patch(it.key, { ht: e.target.value })} /></Field>
                <Field label="Turns"><input className="input" type="number" inputMode="numeric" value={it.turns} onChange={(e) => patch(it.key, { turns: e.target.value })} /></Field>
                <Field label="Grade">
                  <select className="input" value={it.grade} onChange={(e) => onGrade(it.key, e.target.value)}>
                    <option value="">— Select —</option>
                    {grades.map((g) => <option key={g.grade} value={g.grade}>{g.grade}</option>)}
                  </select>
                </Field>
              </div>

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
    </div>
  );
};

const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <label className="block">
    <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</span>
    {children}
  </label>
);

/* ── Import-from-PO dialog ── */
const ImportDialog = ({ onClose, onAdd }: { onClose: () => void; onAdd: (po: PoSummaryItem) => void }) => {
  const [search, setSearch] = useState('');
  const { data, isLoading } = useQuery({
    queryKey: ['testing-po-items'],
    queryFn: () => api<{ items: PoSummaryItem[] }>('/po-orders/summary?status=ACTIVE&pageSize=10000'),
  });
  const items = (data?.items ?? [])
    .filter((i) => i.coreType === 'TOROIDAL')
    .filter((i) => !search.trim() || `${i.poNumber} ${i.measure} ${i.grade}`.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="flex max-h-[80vh] w-full max-w-lg flex-col rounded-2xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <h3 className="font-bold text-slate-900">Import toroidal PO items</h3>
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
            <div className="py-10 text-center text-sm text-slate-400">No matching toroidal items.</div>
          ) : items.map((i) => (
            <button key={i.id} onClick={() => onAdd(i)} className="flex w-full items-center justify-between gap-3 border-t border-slate-100 px-4 py-2.5 text-left hover:bg-brand-50/50">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-slate-800">{i.measure}</div>
                <div className="text-[11px] text-slate-500">{i.poNumber} · {i.grade || 'no grade'} · {i.turns ?? '—'} turns</div>
              </div>
              <Plus className="h-4 w-4 shrink-0 text-brand-600" />
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
