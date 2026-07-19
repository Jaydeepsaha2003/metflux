// New Quotation entry. Structurally a Sales Order form — it reuses the exact
// core-type entry sub-forms (Toroidal / Rectangular / Nano / Composite) exported
// by POOrderNewPage — but saves a standalone Quotation document (own MEI/SQ
// number, PDF print). A quotation touches nothing downstream until it is
// converted into a Sales Order from the Quotations list.
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Save, Loader2, Trash2, Copy, FileText, Calendar, Hash, User2, Plus } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { SearchableSelect } from '@/components/SearchableSelect';
import { type Item, ToroidalForm, RectangularForm, NanoForm } from '@/pages/POOrderNewPage';

/* Local item = SO item + quotation-only print fields (HSN/SAC + unit). */
type QItem = Item & { hsnCode?: string; unit?: string };

type CoreType = 'TOROIDAL' | 'RECTANGULAR' | 'NANO' | 'COMPOSITE';
type Customer = { id: string; name: string; gstRate?: number };
type GradeRow = { grade: string; materials: { id: string; material: string }[]; coreTypes?: CoreType[] };
type FluxGroup = { grade: string; points: { flux: number; ateCm: number }[] };

const gradeAppliesTo = (g: GradeRow, ct: CoreType) => !g.coreTypes || g.coreTypes.length === 0 || g.coreTypes.includes(ct);
const todayISO = () => new Date().toISOString().slice(0, 10);
const money0 = (n: number | undefined | null) => Math.round(Number(n) || 0).toLocaleString('en-IN');

const coreBadge = (ct: CoreType) =>
  ct === 'TOROIDAL' ? 'bg-amber-50 text-amber-700'
  : ct === 'RECTANGULAR' ? 'bg-rose-50 text-rose-700'
  : ct === 'COMPOSITE' ? 'bg-teal-50 text-teal-700'
  : 'bg-violet-50 text-violet-700';
const coreShort = (ct: CoreType) => (ct === 'TOROIDAL' ? 'Toro' : ct === 'RECTANGULAR' ? 'Rect' : ct === 'COMPOSITE' ? 'Comp' : 'Nano');

const cellInput =
  'h-7 w-full rounded-md border border-slate-300 bg-white px-2 text-[13px] outline-none ' +
  'focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20';

/* Manual / custom quotation line — free-text description + qty + rate, for items
   not in the grade/material catalogue. No core spec or dimensions. */
const ManualLineForm = ({ onAdd }: { onAdd: (item: QItem) => void }) => {
  const [description, setDescription] = useState('');
  const [hsnCode, setHsnCode] = useState('');
  const [unit, setUnit] = useState('Pcs');
  const [qty, setQty] = useState(0);
  const [rate, setRate] = useState(0);
  const [err, setErr] = useState('');

  const add = () => {
    if (!description.trim()) { setErr('Enter a description.'); return; }
    if (qty <= 0) { setErr('Enter a quantity.'); return; }
    setErr('');
    onAdd({
      // coreType is required by the item shape but unused on the quotation print
      // (which lists items ungrouped); a manual line carries no core spec.
      coreType: 'TOROIDAL',
      grade: '', material: description.trim(), measure: '',
      id1: 0, od1: 0, ht: 0, weightPerPc: 0, pcs: qty, totalWeight: 0,
      hsnCode: hsnCode.trim(), unit: unit.trim() || 'Pcs',
      rateBasis: 'PER_PCS',
      rateValue: rate > 0 ? rate : undefined,
      ratePerPc: rate > 0 ? rate : undefined,
      totalAmount: rate > 0 ? +(rate * qty).toFixed(2) : undefined,
    });
    setDescription(''); setHsnCode(''); setUnit('Pcs'); setQty(0); setRate(0);
  };

  return (
    <div className="rounded-lg border border-brand-200 bg-brand-50/40 p-3">
      <div className="mb-2 flex items-center gap-2">
        <span className="h-1.5 w-1.5 rounded-full bg-brand-500" />
        <span className="text-[11px] font-semibold uppercase tracking-wider text-brand-800">Custom item</span>
        <span className="text-[11px] text-slate-400">— free text, no core specification</span>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-6">
        <label className="col-span-2 block sm:col-span-3">
          <span className="mb-1 block text-[11px] text-slate-500">Description</span>
          <input className={cellInput} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. Copper winding wire 1.2mm" />
        </label>
        <label className="block">
          <span className="mb-1 block text-[11px] text-slate-500">HSN/SAC</span>
          <input className={cellInput} value={hsnCode} onChange={(e) => setHsnCode(e.target.value)} placeholder="85049010" />
        </label>
        <label className="block">
          <span className="mb-1 block text-[11px] text-slate-500">Qty</span>
          <input type="number" min={0} className={cellInput} value={qty || ''} onChange={(e) => setQty(parseInt(e.target.value, 10) || 0)} />
        </label>
        <label className="block">
          <span className="mb-1 block text-[11px] text-slate-500">Unit</span>
          <input className={cellInput} value={unit} onChange={(e) => setUnit(e.target.value)} />
        </label>
      </div>
      <div className="mt-2 grid grid-cols-2 items-end gap-2 sm:grid-cols-6">
        <label className="block sm:col-span-2">
          <span className="mb-1 block text-[11px] text-slate-500">Rate (₹ / unit)</span>
          <input type="number" min={0} className={cellInput} value={rate || ''} onChange={(e) => setRate(parseFloat(e.target.value) || 0)} />
        </label>
        <div className="text-xs text-slate-500 sm:col-span-2">
          Amount: <span className="font-semibold text-brand-700 tabular-nums">₹{money0(rate * qty)}</span>
        </div>
        <div className="col-span-2 flex justify-end sm:col-span-2">
          <button type="button" onClick={add} className="btn-primary w-full sm:w-auto"><Plus className="h-4 w-4" /> Add custom line</button>
        </div>
      </div>
      {err && <div className="mt-2 text-[11px] text-red-600">{err}</div>}
    </div>
  );
};

export const QuotationNewPage = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  /* ----- header ----- */
  const [quotationNo, setQuotationNo] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [quotationDate, setQuotationDate] = useState(todayISO());
  const [validUntil, setValidUntil] = useState('');
  const [notes, setNotes] = useState('');

  /* ----- entry ----- */
  const [coreType, setCoreType] = useState<CoreType | 'MANUAL' | ''>('');
  const [items, setItems] = useState<QItem[]>([]);

  /* Copy grade / material / rate-basis from a row into the entry form. */
  const [prefill, setPrefill] = useState<
    null | { coreType: CoreType; grade: string; material: string; rateBasis: 'PER_KG' | 'PER_PCS' }
  >(null);
  const copyToForm = (it: QItem) => {
    setCoreType(it.coreType);
    setPrefill({ coreType: it.coreType, grade: it.grade, material: it.material, rateBasis: it.rateBasis ?? 'PER_KG' });
  };

  const addItem = (item: Item) => setItems((prev) => [...prev, { ...item, unit: 'Pcs', hsnCode: '' }]);
  const addManual = (item: QItem) => setItems((prev) => [...prev, item]);
  const patchItem = (idx: number, patch: Partial<QItem>) =>
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  const removeItem = (idx: number) => setItems((prev) => prev.filter((_, i) => i !== idx));

  /* ----- dropdown data (same sources the SO form uses) ----- */
  const { data: customersResp } = useQuery({
    queryKey: ['customers', 'all'],
    queryFn: () => api<{ items: Customer[] }>('/customers?pageSize=200'),
  });
  const { data: gradesResp } = useQuery({
    queryKey: ['material-grades'],
    queryFn: () => api<{ grades: GradeRow[] }>('/material-grades'),
  });
  const { data: fluxResp } = useQuery({
    queryKey: ['flux-grades-grouped', 'TOROIDAL'],
    queryFn: () => api<{ grades: FluxGroup[] }>('/flux-grades/grouped?coreType=TOROIDAL'),
  });
  const { data: fluxRespRect } = useQuery({
    queryKey: ['flux-grades-grouped', 'RECTANGULAR'],
    queryFn: () => api<{ grades: FluxGroup[] }>('/flux-grades/grouped?coreType=RECTANGULAR'),
  });
  const { data: fluxRespNano } = useQuery({
    queryKey: ['flux-grades-grouped', 'NANO'],
    queryFn: () => api<{ grades: FluxGroup[] }>('/flux-grades/grouped?coreType=NANO'),
  });

  /* Auto-suggest the next quotation number when the date changes (only while the
     field is empty or holds a previous auto-suggestion the user hasn't edited). */
  const { data: nextNo } = useQuery({
    queryKey: ['quotation-next', quotationDate],
    queryFn: () => api<{ quotationNo: string }>(`/quotations/next-number?date=${quotationDate}`),
  });
  const [autoNo, setAutoNo] = useState('');
  useEffect(() => {
    if (!nextNo?.quotationNo) return;
    setQuotationNo((cur) => (cur === '' || cur === autoNo ? nextNo.quotationNo : cur));
    setAutoNo(nextNo.quotationNo);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nextNo?.quotationNo]);

  const customer = useMemo(
    () => (customersResp?.items ?? []).find((c) => c.id === customerId) ?? null,
    [customersResp, customerId]
  );
  const totalWeight = items.reduce((s, it) => s + (it.totalWeight ?? 0), 0);
  const totalAmount = items.reduce((s, it) => s + (it.totalAmount ?? 0), 0);

  /* ----- submit ----- */
  const [error, setError] = useState('');
  const createMut = useMutation({
    mutationFn: () =>
      api<{ id: string }>('/quotations', {
        method: 'POST',
        body: JSON.stringify({
          quotationNo: quotationNo.trim(),
          customerId,
          quotationDate,
          validUntil: validUntil || null,
          notes: notes.trim() || null,
          items: items.map((it) => ({ ...it, _dbId: undefined, _locked: undefined })),
        }),
      }),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['quotations'] });
      navigate(`/quotation/${res.id}/print`);
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Failed to save quotation'),
  });

  const submit = () => {
    setError('');
    if (!customerId) return setError('Select a customer.');
    if (!quotationNo.trim()) return setError('Enter a quotation number.');
    if (items.length === 0) return setError('Add at least one item.');
    createMut.mutate();
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Link to="/quotation/manage" className="btn-ghost text-slate-600">Back</Link>
        <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight">
          <FileText className="h-5 w-5 text-brand-600" /> New Quotation
        </h1>
      </div>

      {/* ============ HEADER ============ */}
      <section className="card p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="block">
            <span className="mb-1 flex items-center gap-1 text-xs font-medium text-slate-600"><Hash className="h-3.5 w-3.5" /> Quotation No.</span>
            <input className={cellInput} value={quotationNo} onChange={(e) => setQuotationNo(e.target.value)} placeholder="MEI/SQ/1/2026-27" />
          </label>
          <label className="block">
            <span className="mb-1 flex items-center gap-1 text-xs font-medium text-slate-600"><User2 className="h-3.5 w-3.5" /> Customer</span>
            <SearchableSelect
              value={customerId}
              onChange={setCustomerId}
              options={(customersResp?.items ?? []).map((c) => ({ value: c.id, label: c.name }))}
              placeholder="Select customer…"
            />
          </label>
          <label className="block">
            <span className="mb-1 flex items-center gap-1 text-xs font-medium text-slate-600"><Calendar className="h-3.5 w-3.5" /> Quotation Date</span>
            <input type="date" className={cellInput} value={quotationDate} onChange={(e) => setQuotationDate(e.target.value)} />
          </label>
          <label className="block">
            <span className="mb-1 flex items-center gap-1 text-xs font-medium text-slate-600"><Calendar className="h-3.5 w-3.5" /> Valid Until <span className="text-slate-400">(optional)</span></span>
            <input type="date" className={cellInput} value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
          </label>
        </div>
        {customer && (customer.gstRate ?? 0) > 0 && (
          <div className="mt-2 text-[11px] text-slate-500">GST @ {customer.gstRate}% will be applied on the printed quotation.</div>
        )}
      </section>

      {/* ============ ITEM ENTRY ============ */}
      <section className="card p-4">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-slate-900">Add item</span>
          <div className="inline-flex rounded-lg bg-slate-100 p-0.5 text-sm">
            {(['TOROIDAL', 'RECTANGULAR', 'NANO', 'COMPOSITE'] as CoreType[]).map((ct) => (
              <button key={ct} type="button" onClick={() => setCoreType(ct)}
                className={cn('rounded-md px-3 py-1.5 font-medium transition',
                  coreType === ct ? 'bg-white text-brand-700 shadow-sm' : 'text-slate-600 hover:text-slate-900')}>
                {ct === 'TOROIDAL' ? 'Toroidal' : ct === 'RECTANGULAR' ? 'Rectangular' : ct === 'NANO' ? 'Nano' : 'Composite'}
              </button>
            ))}
          </div>
          <span className="text-xs text-slate-400">or</span>
          <button type="button" onClick={() => setCoreType('MANUAL')}
            className={cn('inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-sm font-medium transition',
              coreType === 'MANUAL' ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-slate-300 text-slate-600 hover:bg-slate-50')}>
            <Plus className="h-3.5 w-3.5" /> Custom item
          </button>
        </div>

        {coreType === 'TOROIDAL' && (
          <ToroidalForm hideTesting
            grades={(gradesResp?.grades ?? []).filter((g) => gradeAppliesTo(g, 'TOROIDAL'))}
            fluxGrades={fluxResp?.grades ?? []}
            onAdd={addItem} prefill={prefill} onPrefillConsumed={() => setPrefill(null)}
            edit={null} onEditConsumed={() => {}}
          />
        )}
        {coreType === 'RECTANGULAR' && (
          <RectangularForm hideTesting
            grades={(gradesResp?.grades ?? []).filter((g) => gradeAppliesTo(g, 'RECTANGULAR'))}
            fluxGrades={fluxRespRect?.grades ?? []}
            onAdd={addItem} prefill={prefill} onPrefillConsumed={() => setPrefill(null)}
            edit={null} onEditConsumed={() => {}}
          />
        )}
        {coreType === 'NANO' && (
          <NanoForm hideTesting
            grades={(gradesResp?.grades ?? []).filter((g) => gradeAppliesTo(g, 'NANO'))}
            fluxGrades={fluxRespNano?.grades ?? []}
            onAdd={addItem} prefill={prefill} onPrefillConsumed={() => setPrefill(null)}
            edit={null} onEditConsumed={() => {}}
          />
        )}
        {coreType === 'COMPOSITE' && (
          <NanoForm composite hideTesting
            grades={(gradesResp?.grades ?? []).filter((g) => gradeAppliesTo(g, 'NANO'))}
            typeGrades={(gradesResp?.grades ?? []).filter((g) => gradeAppliesTo(g, 'COMPOSITE'))}
            fluxGrades={fluxRespNano?.grades ?? []}
            onAdd={addItem} prefill={prefill} onPrefillConsumed={() => setPrefill(null)}
            edit={null} onEditConsumed={() => {}}
          />
        )}
        {coreType === 'MANUAL' && <ManualLineForm onAdd={addManual} />}
        {!coreType && (
          <div className="rounded-lg border border-dashed border-slate-300 px-4 py-6 text-center text-sm text-slate-500">
            Pick a core type above, or use <span className="font-medium">Custom item</span>, to start adding items.
          </div>
        )}
      </section>

      {/* ============ ITEMS LIST ============ */}
      <section className="card overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2.5">
          <h2 className="text-sm font-semibold text-slate-900">Items <span className="font-normal text-slate-400">({items.length})</span></h2>
          <div className="text-xs text-slate-500">
            Total Wt: <span className="font-semibold text-slate-900 tabular-nums">{totalWeight.toFixed(3)} kg</span>
            <span className="mx-2 text-slate-300">·</span>
            Amount: <span className="font-semibold text-brand-700 tabular-nums">₹{money0(totalAmount)}</span>
          </div>
        </div>

        {items.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-slate-400">No items added yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-[13px]">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500">
                  <th className="px-2 py-2 w-8">#</th>
                  <th className="px-2 py-2">Description</th>
                  <th className="px-2 py-2 w-28">HSN/SAC</th>
                  <th className="px-2 py-2 w-20 text-right">Qty</th>
                  <th className="px-2 py-2 w-20">Unit</th>
                  <th className="px-2 py-2 w-24 text-right">Rate/pc</th>
                  <th className="px-2 py-2 w-28 text-right">Amount</th>
                  <th className="px-2 py-2 w-16"></th>
                </tr>
              </thead>
              <tbody>
                {items.map((it, idx) => (
                  <tr key={idx} className="border-b border-slate-100 align-top">
                    <td className="px-2 py-2 text-slate-500">{idx + 1}</td>
                    <td className="px-2 py-2">
                      {(() => {
                        const manual = !it.grade && !it.measure;
                        const sub = [it.grade, it.measure].filter(Boolean).join(' · ');
                        return (<>
                          <div className="flex items-center gap-1.5">
                            <span className={cn('rounded-full px-1.5 py-0.5 text-[10px] font-medium uppercase',
                              manual ? 'bg-slate-100 text-slate-600' : coreBadge(it.coreType))}>
                              {manual ? 'Custom' : coreShort(it.coreType)}
                            </span>
                            <span className="font-medium text-slate-800">{it.material}</span>
                          </div>
                          {sub && <div className="mt-0.5 font-mono text-[11px] text-slate-500 break-all">{sub}</div>}
                        </>);
                      })()}
                    </td>
                    <td className="px-2 py-2">
                      <input className={cellInput} value={it.hsnCode ?? ''} onChange={(e) => patchItem(idx, { hsnCode: e.target.value })} placeholder="85049010" />
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">{it.pcs}</td>
                    <td className="px-2 py-2">
                      <input className={cellInput} value={it.unit ?? 'Pcs'} onChange={(e) => patchItem(idx, { unit: e.target.value })} />
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">{it.ratePerPc != null ? money0(it.ratePerPc) : '—'}</td>
                    <td className="px-2 py-2 text-right font-semibold tabular-nums">{it.totalAmount != null ? `₹${money0(it.totalAmount)}` : '—'}</td>
                    <td className="px-2 py-2">
                      <div className="flex items-center gap-1">
                        <button type="button" onClick={() => copyToForm(it)} title="Copy grade/material to form" className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><Copy className="h-4 w-4" /></button>
                        <button type="button" onClick={() => removeItem(idx)} title="Remove" className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"><Trash2 className="h-4 w-4" /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ============ NOTES + SUBMIT ============ */}
      <section className="card p-4 space-y-3">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-600">Notes <span className="text-slate-400">(optional — shown on the quotation)</span></span>
          <textarea className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20" rows={2}
            value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
        {error && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
        <div className="flex items-center justify-end gap-2">
          <Link to="/quotation/manage" className="btn-ghost text-slate-600">Cancel</Link>
          <button type="button" onClick={submit} disabled={createMut.isPending} className="btn-primary disabled:opacity-60">
            {createMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Save Quotation
          </button>
        </div>
      </section>
    </div>
  );
};

export default QuotationNewPage;
