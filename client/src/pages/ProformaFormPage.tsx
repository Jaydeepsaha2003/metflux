// New / edit proforma invoice. The page is one loop over SECTIONS (lib/proforma.ts),
// the same fields in the same order as the export workbook's Input sheet, with its
// Required flags: a compulsory field that is still empty is outlined in red, and the
// header counts them, exactly as the sheet did. Items can be typed in or calculated
// with the same core builder the Sales Order and Quotation use.
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft, Banknote, Boxes, Check, ChevronDown, Copy, Download, FileCheck2, FileSpreadsheet, FileText, Loader2, MapPin, Plus, Receipt,
  Save, Scale, Ship, Trash2, UserRound,
} from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useConfirm } from '@/hooks/useConfirm';
import { CoreBuilder } from '@/components/CoreBuilder';
import { ComboInput } from '@/components/ComboInput';
import type { Item as CoreItem } from '@/pages/POOrderNewPage';
import { coreLabel } from '@/lib/coreTypes';
import { CurrencyContext } from '@/lib/currency';
import {
  SECTIONS, amountWords, blankItem, blankPi, calcPi, fmt2, fromRecord, isMissing, lineAmount, lineNetWt, missingFields, missingRequired, toPayload,
  type Field, type PiForm, type PiItem,
} from '@/lib/proforma';
import { LIST_FOR_FIELD, PI_CURRENCIES, listOptions } from '@/lib/proformaLists';
import { downloadPiForm, usePiSettings } from '@/lib/proformaApi';

const itemFromCore = (c: CoreItem): PiItem => {
  const perPc = c.ratePerPc ?? (c.pcs ? (c.totalAmount ?? 0) / c.pcs : 0);
  return {
    desc: `${coreLabel(c.coreType).toUpperCase()} — ${c.measure}`,
    grade: [c.material, c.grade].filter(Boolean).join(' '),
    hsn: '85049010', qty: c.pcs, unit: 'Pcs',
    netWtUnit: +c.weightPerPc.toFixed(4), price: +perPc.toFixed(2),
  };
};

const num = (v: string) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };

/** One field of the form, drawn from its definition. */
const FieldInput = ({ f, pi, set, options }: { f: Field; pi: PiForm; set: (k: keyof PiForm, v: never) => void; options?: readonly string[] }) => {
  const value = pi[f.key] as string | number;
  const empty = isMissing(pi, f);
  const cls = cn('input h-9 w-full text-sm', empty && 'border-red-400 bg-red-50/40');
  // `.input` pads top and bottom; inside a fixed 36px box that pushes a select's text down and clips it.
  const selCls = cn(cls, 'py-0 leading-9');
  const id = `pi-${f.key}`;
  const tag = { 'data-field': f.key };   // lets the missing-details list jump to and focus this control
  let control: React.ReactNode;
  if (f.kind === 'date') control = <input {...tag} type="date" className={cls} value={value as string} onChange={(e) => set(f.key, e.target.value as never)} />;
  else if (f.kind === 'number') control = <input {...tag} type="number" min={0} step="any" className={cls} value={value || ''} onChange={(e) => set(f.key, num(e.target.value) as never)} />;
  else if (f.kind === 'percent') control = (
    <div className="relative">
      <input {...tag} type="number" min={0} max={100} step="any" className={cn(cls, 'pr-7')} value={value ? +(Number(value) * 100).toFixed(4) : ''}
        onChange={(e) => set(f.key, Math.min(1, num(e.target.value) / 100) as never)} />
      <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-slate-400">%</span>
    </div>
  );
  else if (f.kind === 'yesno') control = (
    <select {...tag} className={selCls} value={value as string} onChange={(e) => set(f.key, e.target.value as never)}>
      <option>Yes</option><option>No</option>
    </select>
  );
  else if (f.key === 'currency') control = (
    // A real dropdown: the amount in words and the headings depend on a known code, so no free typing.
    <select {...tag} className={selCls} value={value as string} onChange={(e) => set(f.key, e.target.value as never)}>
      {!PI_CURRENCIES.some((c) => c.code === value) && <option value={value as string}>{value as string}</option>}
      {PI_CURRENCIES.map((c) => <option key={c.code} value={c.code}>{c.code} — {c.name}</option>)}
    </select>
  );
  else if (options) control = (
    <ComboInput {...tag} id={id} className={cls} options={options} value={value as string} onChange={(v) => set(f.key, v as never)} />
  );
  else control = <input {...tag} id={id} className={cls} value={value as string} onChange={(e) => set(f.key, e.target.value as never)} />;
  return (
    <label className="block">
      <span className="mb-1 flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-slate-500">
        {f.label}{f.required && <span className={empty ? 'text-red-500' : 'text-slate-300'}>*</span>}
      </span>
      {control}
      {f.note && <span className="mt-0.5 block text-[11px] leading-snug text-slate-400">{f.note}</span>}
    </label>
  );
};

const SECTION_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  'Proforma invoice details': FileText, 'Buyer (bill to)': UserRound, 'Consignee (ship to)': MapPin, Shipment: Ship,
  'Commercial terms': Scale, 'Charges (in invoice currency)': Receipt, 'Packing details': Boxes, 'Documents to be provided': FileCheck2,
};
const slug = (t: string) => `sec-${t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
const short = (t: string) => t.replace(/ \(.*\)/, '');

export const ProformaFormPage = () => {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { id } = useParams<{ id?: string }>();
  const isEdit = !!id;
  const { confirm, confirmDialog } = useConfirm();
  const [pi, setPi] = useState<PiForm>(blankPi);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const { settings, company, ready } = usePiSettings();

  const set = (k: keyof PiForm, v: never) => setPi((p) => ({ ...p, [k]: v }));
  const setItem = (i: number, patch: Partial<PiItem>) => setPi((p) => ({ ...p, items: p.items.map((it, n) => (n === i ? { ...it, ...patch } : it)) }));
  const addItems = (add: PiItem[]) => setPi((p) => {
    // A form that still holds only its empty starter row replaces it rather than keeping a blank above.
    const kept = p.items.length === 1 && !p.items[0].desc.trim() ? [] : p.items;
    return { ...p, items: [...kept, ...add] };
  });

  // Existing invoice
  const { data: existing, isLoading } = useQuery({
    queryKey: ['proforma-invoice', id],
    queryFn: () => api<Parameters<typeof fromRecord>[0]>(`/proforma-invoices/${id}`),
    enabled: isEdit,
  });
  const [loaded, setLoaded] = useState(false);
  useEffect(() => { if (existing && !loaded) { setPi(fromRecord(existing)); setLoaded(true); } }, [existing, loaded]);

  // New invoice: take the next number in the series.
  useEffect(() => {
    if (isEdit || pi.piNumber) return;
    api<{ piNumber: string }>(`/proforma-invoices/next-number?date=${pi.piDate}`)
      .then((r) => setPi((p) => (p.piNumber ? p : { ...p, piNumber: r.piNumber }))).catch(() => { /* typed by hand then */ });
  }, [isEdit, pi.piNumber, pi.piDate]);

  const calc = useMemo(() => calcPi(pi), [pi]);
  const missing = useMemo(() => missingRequired(pi), [pi]);

  const save = useMutation({
    mutationFn: () => api<{ id: string }>(isEdit ? `/proforma-invoices/${id}` : '/proforma-invoices', { method: isEdit ? 'PUT' : 'POST', json: toPayload(pi) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['proforma-invoices'] }); qc.invalidateQueries({ queryKey: ['proforma-invoice', id] }); navigate('/proforma/manage'); },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Could not save'),
  });

  const onSave = () => {
    setError('');
    if (!pi.buyerName.trim()) return setError('Enter the buyer name.');
    if (!pi.items.some((i) => i.desc.trim() && i.qty > 0)) return setError('Add at least one item with a description and quantity.');
    save.mutate();
  };

  const onDownload = async (kind: 'xlsx' | 'pdf' = 'xlsx') => {
    if (!settings) return;
    if (missing.length) {
      const ok = await confirm({
        title: `${missing.length} required detail${missing.length === 1 ? ' is' : 's are'} empty`,
        message: `${missing.slice(0, 8).join(', ')}${missing.length > 8 ? '…' : ''}. The sheet will print with those blank. Download anyway?`,
        confirmLabel: 'Download anyway',
      });
      if (!ok) return;
    }
    setBusy(true);
    try { await downloadPiForm(pi, settings, company, kind); }
    catch { setError(`The ${kind === 'pdf' ? 'PDF' : 'Excel sheet'} could not be built.`); }
    finally { setBusy(false); }
  };

  /* Sections can be folded away once they are done; the summary and the nav read the same
     per-section tally so they never disagree about what is left. */
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const toggle = (t: string) => setClosed((c) => { const n = new Set(c); if (n.has(t)) n.delete(t); else n.add(t); return n; });
  const sectionState = useMemo(() => SECTIONS.map((sec) => {
    const need = sec.fields.filter((f) => f.required && (!f.consignee || pi.consigneeSame === 'No'));
    return { title: sec.title, total: need.length, missing: need.filter((f) => isMissing(pi, f)).length };
  }), [pi]);
  const totalRequired = sectionState.reduce((n, st) => n + st.total, 0);
  const filledPct = totalRequired ? Math.round(((totalRequired - missing.length) / totalRequired) * 100) : 100;
  const missingList = useMemo(() => missingFields(pi), [pi]);
  const jumpTo = (title: string) => {
    setClosed((c) => { const n = new Set(c); n.delete(title); return n; });
    setTimeout(() => document.getElementById(slug(title))?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 30);
  };
  const focusField = (key: string, title: string) => {
    jumpTo(title);
    setTimeout(() => (document.querySelector(`[data-field="${key}"]`) as HTMLElement | null)?.focus(), 350);
  };
  const sectionOf = (key: string) => SECTIONS.find((sec) => sec.fields.some((f) => f.key === key))?.title ?? SECTIONS[0].title;

  if (isEdit && isLoading) return <div className="card p-10 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-slate-400" /></div>;

  return (
    <CurrencyContext.Provider value={pi.currency}>
      <div className="w-full space-y-4 pb-6">
        {/* Title bar */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Link to="/proforma/manage" className="rounded-lg border border-slate-200 bg-white p-2 text-slate-500 shadow-sm hover:bg-slate-50" aria-label="Back"><ArrowLeft className="h-4 w-4" /></Link>
            <div>
              <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">
                <FileSpreadsheet className="h-5 w-5 text-brand-600" /> {isEdit ? 'Edit' : 'New'} Proforma Invoice
              </h1>
              <p className="font-mono text-xs text-slate-500">{pi.piNumber || 'Number is assigned when you save'}</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 xl:hidden">
            <button type="button" onClick={() => onDownload('pdf')} disabled={busy || !ready} className="btn-ghost border border-slate-300 text-rose-700 hover:bg-rose-50 disabled:opacity-50">
              <FileText className="h-4 w-4" /> PDF
            </button>
            <button type="button" onClick={() => onDownload('xlsx')} disabled={busy || !ready} className="btn-ghost border border-slate-300 text-emerald-700 hover:bg-emerald-50 disabled:opacity-50">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Excel
            </button>
            <button type="button" onClick={onSave} disabled={save.isPending} className="btn-primary">
              {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save
            </button>
          </div>
        </div>

        {error && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
          <div className="min-w-0 space-y-4">
            {/* Section navigator: where each part stands, one click away */}
            <nav aria-label="Sections" className="sticky top-0 z-10 -mx-1 flex gap-1.5 overflow-x-auto bg-slate-50/90 px-1 py-2 backdrop-blur">
              {SECTIONS.map((sec, i) => {
                const st = sectionState[i]; const Icon = SECTION_ICON[sec.title] ?? FileText;
                const done = st.total > 0 && st.missing === 0;
                return (
                  <button key={sec.title} type="button" onClick={() => jumpTo(sec.title)}
                    className={cn('flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition',
                      st.missing ? 'border-red-200 bg-red-50 text-red-700 hover:bg-red-100' : done ? 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50')}>
                    <Icon className="h-3.5 w-3.5" />
                    <span>{short(sec.title)}</span>
                    {st.missing > 0 && <span className="rounded-full bg-red-600 px-1.5 text-[10px] font-bold text-white">{st.missing}</span>}
                    {done && <Check className="h-3.5 w-3.5" />}
                  </button>
                );
              })}
              <button type="button" onClick={() => document.getElementById('sec-items')?.scrollIntoView({ behavior: 'smooth' })}
                className="flex shrink-0 items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50">
                <Banknote className="h-3.5 w-3.5" /> Items <span className="rounded-full bg-slate-200 px-1.5 text-[10px] font-bold text-slate-700">{pi.items.filter((it) => it.desc.trim()).length}</span>
              </button>
            </nav>

            {SECTIONS.map((sec, i) => {
              const st = sectionState[i]; const Icon = SECTION_ICON[sec.title] ?? FileText; const open = !closed.has(sec.title);
              return (
                <section key={sec.title} id={slug(sec.title)} className="card scroll-mt-14 overflow-hidden">
                  <button type="button" onClick={() => toggle(sec.title)} aria-expanded={open}
                    className="flex w-full items-center gap-2.5 border-b border-slate-100 bg-gradient-to-r from-brand-50/70 to-transparent px-3 py-2.5 text-left sm:px-4">
                    <span className="grid h-7 w-7 place-items-center rounded-lg bg-brand-100 text-brand-700"><Icon className="h-4 w-4" /></span>
                    <h2 className="flex-1 text-sm font-semibold text-slate-900">{sec.title}</h2>
                    {st.total > 0 && (st.missing
                      ? <span className="rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-medium text-red-700">{st.missing} of {st.total} required missing</span>
                      : <span className="flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700"><Check className="h-3 w-3" /> Complete</span>)}
                    <ChevronDown className={cn('h-4 w-4 text-slate-400 transition-transform', !open && '-rotate-90')} />
                  </button>
                  {open && (
                    <div className="grid gap-3 p-3 sm:grid-cols-2 sm:p-4 lg:grid-cols-3">
                      {sec.fields.filter((f) => !f.consignee || pi.consigneeSame === 'No').map((f) => (
                        <FieldInput key={f.key} f={f} pi={pi} set={set} options={LIST_FOR_FIELD[f.key] ? listOptions(settings?.lists, LIST_FOR_FIELD[f.key]!) : f.options} />
                      ))}
                    </div>
                  )}
                </section>
              );
            })}

            {/* Items */}
            <section id="sec-items" className="card scroll-mt-14 overflow-hidden">
              <div className="flex items-center gap-2.5 border-b border-slate-100 bg-gradient-to-r from-brand-50/70 to-transparent px-3 py-2.5 sm:px-4">
                <span className="grid h-7 w-7 place-items-center rounded-lg bg-brand-100 text-brand-700"><Banknote className="h-4 w-4" /></span>
                <h2 className="flex-1 text-sm font-semibold text-slate-900">Items</h2>
                <button type="button" onClick={() => setPi((p) => ({ ...p, items: [...p.items, blankItem()] }))} className="btn-ghost border border-slate-200 bg-white text-xs"><Plus className="h-3.5 w-3.5" /> Add row</button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[1020px] text-sm">
                  <thead className="bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="w-8 px-2 py-2">#</th><th className="px-2 py-2">Description of goods</th><th className="px-2 py-2">Grade / spec</th>
                      <th className="px-2 py-2">HSN</th><th className="w-20 px-2 py-2 text-right">Qty</th><th className="w-20 px-2 py-2">Unit</th>
                      <th className="w-24 px-2 py-2 text-right">Net wt / unit (kg)</th><th className="w-24 px-2 py-2 text-right">Unit price ({pi.currency || '—'})</th>
                      <th className="w-28 px-2 py-2 text-right">Amount</th><th className="w-24 px-2 py-2 text-right">Net wt (kg)</th><th className="w-16" />
                    </tr>
                  </thead>
                  <tbody>
                    {pi.items.map((it, i) => (
                      <tr key={i} className="border-t border-slate-100 align-top hover:bg-slate-50/50">
                        <td className="px-2 py-1.5 font-mono text-xs text-slate-500">{i + 1}</td>
                        <td className="px-2 py-1.5"><input className="input h-8 w-full text-xs" value={it.desc} onChange={(e) => setItem(i, { desc: e.target.value })} placeholder="TOROIDAL CORE — 100x195x60 mm" /></td>
                        <td className="px-2 py-1.5"><input className="input h-8 w-full text-xs" value={it.grade} onChange={(e) => setItem(i, { grade: e.target.value })} placeholder="CRGO M4" /></td>
                        <td className="px-2 py-1.5"><input className="input h-8 w-full text-xs" value={it.hsn} onChange={(e) => setItem(i, { hsn: e.target.value })} /></td>
                        <td className="px-2 py-1.5"><input type="number" min={0} step="any" className="input h-8 w-full text-right text-xs" value={it.qty || ''} onChange={(e) => setItem(i, { qty: num(e.target.value) })} /></td>
                        <td className="px-2 py-1.5"><ComboInput aria-label="Unit" className="input h-8 w-full py-0 text-xs" options={listOptions(settings?.lists, 'units')} value={it.unit} onChange={(v) => setItem(i, { unit: v })} /></td>
                        <td className="px-2 py-1.5"><input type="number" min={0} step="any" className="input h-8 w-full text-right text-xs" value={it.netWtUnit || ''} onChange={(e) => setItem(i, { netWtUnit: num(e.target.value) })} /></td>
                        <td className="px-2 py-1.5"><input type="number" min={0} step="any" className="input h-8 w-full text-right text-xs" value={it.price || ''} onChange={(e) => setItem(i, { price: num(e.target.value) })} /></td>
                        <td className="px-2 py-2 text-right font-semibold tabular-nums">{lineAmount(it) ? fmt2(lineAmount(it)) : ''}</td>
                        <td className="px-2 py-2 text-right tabular-nums text-slate-600">{lineNetWt(it) ? fmt2(lineNetWt(it)) : ''}</td>
                        <td className="px-1 py-1.5">
                          <div className="flex justify-end">
                            <button type="button" title="Duplicate row" onClick={() => setPi((p) => ({ ...p, items: [...p.items.slice(0, i + 1), { ...it }, ...p.items.slice(i + 1)] }))}
                              className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Duplicate row"><Copy className="h-4 w-4" /></button>
                            <button type="button" disabled={pi.items.length === 1} title="Remove row"
                              onClick={() => setPi((p) => ({ ...p, items: p.items.filter((_, n) => n !== i) }))}
                              className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-30" aria-label="Remove item"><Trash2 className="h-4 w-4" /></button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="border-t-2 border-slate-200 bg-slate-50 text-sm font-semibold">
                    <tr>
                      <td colSpan={4} className="px-2 py-2 text-right text-xs uppercase tracking-wide text-slate-500">Total</td>
                      <td className="px-2 py-2 text-right tabular-nums">{calc.qty.toLocaleString('en-IN')}</td>
                      <td colSpan={3} />
                      <td className="px-2 py-2 text-right tabular-nums">{fmt2(calc.goods)}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{fmt2(calc.netWt)}</td><td />
                    </tr>
                  </tfoot>
                </table>
              </div>
            </section>

            {/* Calculate an item from its dimensions, instead of typing its weight and price */}
            <div>
              <p className="mb-1.5 text-xs text-slate-500">Or calculate a core from its dimensions — it is added as a row above, with its weight and price per piece.</p>
              <CoreBuilder customerName={pi.buyerName || null} orderNo={pi.piNumber || null} onAdd={(c) => addItems([itemFromCore(c)])} />
            </div>
          </div>

          {/* Summary: stays in view while the long form scrolls */}
          <aside className="min-w-0 xl:sticky xl:top-3 xl:self-start">
            <div className="card overflow-hidden">
              <div className="bg-gradient-to-br from-brand-600 to-brand-800 px-4 py-4 text-white">
                <div className="text-[11px] font-medium uppercase tracking-wider text-white/70">Grand total</div>
                <div className="mt-0.5 text-2xl font-bold tabular-nums">{pi.currency || '—'} {fmt2(calc.grand)}</div>
                {calc.advPct > 0 && <div className="mt-1 text-xs text-white/80">Advance now ({Math.round(calc.advPct * 100)}%): {pi.currency} {fmt2(calc.advance)}</div>}
              </div>
              <dl className="space-y-1 px-4 py-3 text-sm">
                {([['Goods value', calc.goods], [`Export packing @ ${(pi.packingPct * 100).toFixed(1)}%`, calc.packing], ['Freight', calc.freight],
                  ['Insurance', calc.insurance], [pi.otherLabel || 'Other charges', calc.other], ['Discount', calc.discount]] as [string, number][]).map(([k, v]) => (
                  <div key={k} className="flex justify-between"><dt className="text-slate-500">{k}</dt><dd className="tabular-nums text-slate-800">{v ? fmt2(v) : '–'}</dd></div>
                ))}
                <div className="flex justify-between border-t border-slate-100 pt-1.5 text-xs text-slate-500">
                  <dt>{calc.qty.toLocaleString('en-IN')} piece(s)</dt><dd className="tabular-nums">Net {fmt2(calc.netWt)} kg</dd>
                </div>
              </dl>
              <div className="border-t border-slate-100 px-4 py-3">
                <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Amount in words</div>
                <div className="mt-0.5 text-xs font-semibold leading-snug text-slate-800">{calc.grand > 0 ? amountWords(calc.grand, pi.currency) : '—'}</div>
              </div>

              {/* How complete the invoice is, and exactly what is left */}
              <div className="border-t border-slate-100 px-4 py-3">
                <div className="mb-1 flex items-center justify-between text-xs">
                  <span className="font-medium text-slate-700">Required details</span>
                  <span className={cn('font-semibold', missing.length ? 'text-red-600' : 'text-emerald-600')}>{filledPct}%</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
                  <div className={cn('h-full rounded-full transition-all', missing.length ? 'bg-amber-400' : 'bg-emerald-500')} style={{ width: `${filledPct}%` }} />
                </div>
                {missingList.length > 0 ? (
                  <ul className="mt-2 max-h-44 space-y-0.5 overflow-y-auto pr-1">
                    {missingList.map((f) => (
                      <li key={f.key}>
                        <button type="button" onClick={() => focusField(f.key, sectionOf(f.key))}
                          className="flex w-full items-center justify-between gap-2 rounded px-1.5 py-1 text-left text-xs text-slate-600 hover:bg-red-50 hover:text-red-700">
                          <span className="truncate">{f.label}</span><span className="shrink-0 text-[10px] text-slate-400">{short(sectionOf(f.key))}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : <p className="mt-2 flex items-center gap-1 text-xs text-emerald-700"><Check className="h-3.5 w-3.5" /> Everything required is filled in.</p>}
              </div>

              <div className="hidden gap-2 border-t border-slate-100 bg-slate-50 px-4 py-3 xl:flex">
                <button type="button" onClick={() => onDownload('pdf')} disabled={busy || !ready} className="btn-ghost flex-1 justify-center border border-slate-300 bg-white text-rose-700 hover:bg-rose-50 disabled:opacity-50">
                  <FileText className="h-4 w-4" /> PDF
                </button>
                <button type="button" onClick={() => onDownload('xlsx')} disabled={busy || !ready} className="btn-ghost flex-1 justify-center border border-slate-300 bg-white text-emerald-700 hover:bg-emerald-50 disabled:opacity-50">
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Excel
                </button>
                <button type="button" onClick={onSave} disabled={save.isPending} className="btn-primary flex-1 justify-center">
                  {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save
                </button>
              </div>
            </div>
          </aside>
        </div>

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end xl:hidden">
          <button type="button" onClick={() => navigate('/proforma/manage')} className="btn-ghost w-full sm:w-auto">Cancel</button>
          <button type="button" onClick={onSave} disabled={save.isPending} className="btn-primary w-full sm:w-auto">
            {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save proforma invoice
          </button>
        </div>
        {confirmDialog}
      </div>
    </CurrencyContext.Provider>
  );
};
