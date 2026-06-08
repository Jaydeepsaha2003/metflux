// New Supplier PO — material orders we place WITH a supplier.
// Items carry HSN codes (and optional unit) so the GST invoice from the
// supplier can be reconciled later.
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, Save, Loader2, Calendar, Hash, Truck, Package } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { SearchableSelect } from '@/components/SearchableSelect';
import { ItemTypeahead } from '@/components/ItemTypeahead';
import { useConfirm } from '@/hooks/useConfirm';

type Supplier = { id: string; name: string; gstRate: number; gstNumber: string | null; state: string | null };
type CompanyMe = { name: string };

type Item = {
  description: string;
  hsnCode: string;
  qty: number;
  unit: string;
  rate: number;
  amount: number;
};

const todayISO = () => new Date().toISOString().slice(0, 10);
const addDays = (iso: string, days: number) => {
  const d = new Date(iso); d.setDate(d.getDate() + days); return d.toISOString().slice(0, 10);
};

// Indian fiscal year (Apr–Mar). 2026-05-10 → "26-27"; 2026-02-10 → "25-26".
const fiscalYear = (date: Date = new Date()) => {
  const y = date.getFullYear() % 100;
  const startYear = date.getMonth() >= 3 ? y : y - 1;
  return `${String(startYear).padStart(2, '0')}-${String((startYear + 1) % 100).padStart(2, '0')}`;
};

const DRAFT_KEY = 'supplier_po_draft_new';

const inputCls =
  'h-9 w-full rounded-md border border-slate-300 bg-white px-2.5 text-sm text-slate-900 ' +
  'placeholder:text-slate-400 outline-none transition ' +
  'focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20';

export const SupplierOrderNewPage = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [poNumber, setPoNumber]       = useState('');
  const [supplierId, setSupplierId]   = useState('');
  const [orderDate, setOrderDate]     = useState(todayISO());
  const [expectedDays, setExpectedDays] = useState(0);
  const expectedDate = useMemo(() => addDays(orderDate, expectedDays), [orderDate, expectedDays]);

  const [items, setItems] = useState<Item[]>([]);

  const [draftAvailable, setDraftAvailable] = useState(false);
  const [draftData, setDraftData] = useState<null | {
    poNumber: string; supplierId: string; orderDate: string; expectedDays: number; items: Item[];
  }>(null);

  const { data: suppliersResp } = useQuery({
    queryKey: ['suppliers', 'all'],
    queryFn: () => api<{ items: Supplier[] }>('/suppliers?pageSize=200'),
  });
  // For auto-generating the PO number prefix.
  const { data: company } = useQuery({
    queryKey: ['company-me'],
    queryFn: () => api<CompanyMe>('/companies/me'),
  });
  const { data: existingPos } = useQuery({
    queryKey: ['supplier-orders', 'all-numbers'],
    queryFn: () => api<{ items: Array<{ poNumber: string }> }>('/supplier-orders?pageSize=200'),
  });

  // Auto-generate Supplier PO number once company + existing list have loaded.
  // Format: <COMPANY-3>/PO/<FY>/<3-digit serial>  →  MET/PO/26-27/001
  useEffect(() => {
    if (poNumber || !company || !existingPos) return;
    const prefix = `${company.name.slice(0, 3).toUpperCase()}/PO/${fiscalYear()}/`;
    const used = existingPos.items.filter((p) => p.poNumber.startsWith(prefix)).length;
    setPoNumber(`${prefix}${String(used + 1).padStart(3, '0')}`);
  }, [company, existingPos, poNumber]);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(DRAFT_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed?.poNumber || parsed?.supplierId || (parsed?.items?.length ?? 0) > 0) {
          setDraftData(parsed);
          setDraftAvailable(true);
        }
      }
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!poNumber && !supplierId && items.length === 0) return;
    const id = setTimeout(() => {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ poNumber, supplierId, orderDate, expectedDays, items }));
    }, 1500);
    return () => clearTimeout(id);
  }, [poNumber, supplierId, orderDate, expectedDays, items]);

  const restoreDraft = () => {
    if (!draftData) return;
    setPoNumber(draftData.poNumber ?? '');
    setSupplierId(draftData.supplierId ?? '');
    setOrderDate(draftData.orderDate ?? todayISO());
    setExpectedDays(draftData.expectedDays ?? 0);
    setItems(draftData.items ?? []);
    setDraftAvailable(false);
  };

  const discardDraft = () => {
    localStorage.removeItem(DRAFT_KEY);
    setDraftAvailable(false);
  };

  const supplier = (suppliersResp?.items ?? []).find((s) => s.id === supplierId);

  const [error, setError] = useState<{ message: string; details?: string[] } | null>(null);
  const submit = useMutation({
    mutationFn: (body: unknown) => api('/supplier-orders', { method: 'POST', json: body }),
    onSuccess: () => {
      localStorage.removeItem(DRAFT_KEY);
      queryClient.invalidateQueries({ queryKey: ['supplier-orders'] });
      navigate('/supplier-po/manage');
    },
    onError: (e) => {
      if (e instanceof ApiError) {
        const d = (e.details ?? {}) as { fieldErrors?: Record<string, string[]>; formErrors?: string[] };
        const lines: string[] = [];
        for (const [field, msgs] of Object.entries(d.fieldErrors ?? {})) {
          for (const m of msgs ?? []) lines.push(`${field}: ${m}`);
        }
        for (const m of d.formErrors ?? []) lines.push(m);
        setError({ message: e.message, details: lines.length ? lines : undefined });
      } else {
        setError({ message: 'Save failed' });
      }
    },
  });

  const onSubmit = () => {
    setError(null);
    const missing: string[] = [];
    if (!poNumber.trim())  missing.push('PO Number');
    if (!supplierId)       missing.push('Supplier');
    if (items.length === 0) missing.push('At least one item');
    if (missing.length) {
      setError({ message: 'Please fill required fields', details: missing });
      return;
    }
    submit.mutate({
      poNumber: poNumber.trim(),
      supplierId,
      orderDate,
      expectedDate,
      items,
    });
  };

  const subtotal = items.reduce((s, x) => s + x.amount, 0);
  const taxRate  = supplier?.gstRate ?? 0;
  const taxAmt   = +(subtotal * (taxRate / 100)).toFixed(2);
  const grand    = +(subtotal + taxAmt).toFixed(2);

  return (
    <div className="space-y-4 max-w-7xl pb-4">
      {draftAvailable && draftData && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
          <div className="text-sm text-amber-800">
            <span className="font-semibold">Unsaved draft found</span>
            {draftData.poNumber && <span className="ml-2 font-mono text-amber-700">{draftData.poNumber}</span>}
            {(draftData.items?.length ?? 0) > 0 && (
              <span className="ml-2 text-xs text-amber-600">({draftData.items.length} item{draftData.items.length !== 1 ? 's' : ''})</span>
            )}
          </div>
          <div className="flex gap-2">
            <button onClick={discardDraft} className="btn-ghost text-sm text-amber-700 hover:bg-amber-100">Discard</button>
            <button onClick={restoreDraft} className="btn-primary text-sm bg-amber-600 hover:bg-amber-700 text-white border-amber-600">
              Restore draft
            </button>
          </div>
        </div>
      )}
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-lg sm:text-2xl font-bold tracking-tight text-slate-900 flex items-center gap-2">
          <Truck className="h-5 w-5 text-brand-600" /> New Supplier PO
        </h1>
        {items.length > 0 && (
          <div className="hidden sm:flex items-center gap-2 text-xs text-slate-500">
            <Package className="h-3.5 w-3.5" />
            <span>{items.length} item{items.length === 1 ? '' : 's'}</span>
            <span className="text-slate-300">·</span>
            <span>₹ {grand.toFixed(2)}</span>
          </div>
        )}
      </div>

      {/* HEADER */}
      <section className="card p-3 sm:p-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <Field label="PO Number" icon={Hash} className="col-span-2 sm:col-span-1">
            <input
              className={inputCls}
              value={poNumber}
              onChange={(e) => setPoNumber(e.target.value.toUpperCase())}
              placeholder="MET/PO/26-27/001"
            />
          </Field>
          <Field label="Supplier" icon={Truck} className="col-span-2 sm:col-span-2 lg:col-span-1">
            <SearchableSelect
              dense
              value={supplierId}
              onChange={setSupplierId}
              options={(suppliersResp?.items ?? []).map((s) => ({ value: s.id, label: s.name }))}
              placeholder="Select supplier…"
            />
          </Field>
          <Field label="Order Date" icon={Calendar}>
            <input className={inputCls} type="date" value={orderDate} onChange={(e) => setOrderDate(e.target.value)} />
          </Field>
          <Field label="Expected (days)">
            <input
              className={inputCls} type="number" inputMode="numeric" min={0}
              value={expectedDays || ''} onChange={(e) => setExpectedDays(parseInt(e.target.value || '0', 10))}
              placeholder="0"
            />
          </Field>
          <Field label="Expected Date">
            <input className={`${inputCls} bg-slate-50`} type="date" value={expectedDate} readOnly />
          </Field>
        </div>
        {supplier && (
          <div className="mt-2 rounded-md bg-slate-50 px-3 py-1.5 text-xs text-slate-600">
            <span className="font-semibold text-slate-700">{supplier.name}</span>
            {supplier.gstNumber && <> · GSTIN <span className="font-mono">{supplier.gstNumber}</span></>}
            {supplier.state && <> · {supplier.state}</>}
            <> · GST <span className="font-semibold">{supplier.gstRate}%</span></>
          </div>
        )}
      </section>

      {/* ITEM ENTRY */}
      <ItemEntry onAdd={(it) => setItems((prev) => [...prev, it])} />

      {/* ITEMS LIST */}
      <section className="card overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2.5 sm:px-4">
          <h2 className="text-sm font-semibold text-slate-900">
            Items <span className="font-normal text-slate-400">({items.length})</span>
          </h2>
          <div className="text-xs text-slate-500 hidden sm:block">
            Subtotal: <span className="font-semibold text-slate-900 tabular-nums">₹ {subtotal.toFixed(2)}</span>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2 font-medium w-8">SN</th>
                <th className="px-3 py-2 font-medium">Description</th>
                <th className="px-3 py-2 font-medium">HSN</th>
                <th className="px-3 py-2 font-medium text-right">Qty</th>
                <th className="px-3 py-2 font-medium">Unit</th>
                <th className="px-3 py-2 font-medium text-right">Rate</th>
                <th className="px-3 py-2 font-medium text-right">Amount</th>
                <th className="w-10 px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 && (
                <tr><td colSpan={8} className="px-3 py-8 text-center text-sm text-slate-400">No items added yet.</td></tr>
              )}
              {items.map((it, idx) => (
                <tr key={idx} className="border-t border-slate-100 hover:bg-slate-50/60">
                  <td className="px-3 py-2 font-mono text-xs text-slate-500">{idx + 1}</td>
                  <td className="px-3 py-2">{it.description}</td>
                  <td className="px-3 py-2 font-mono text-xs text-slate-600">{it.hsnCode || '—'}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{it.qty}</td>
                  <td className="px-3 py-2 text-slate-600">{it.unit}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">{it.rate.toFixed(2)}</td>
                  <td className="px-3 py-2 text-right font-mono font-semibold tabular-nums">{it.amount.toFixed(2)}</td>
                  <td className="px-3 py-2 text-right">
                    <button
                      type="button"
                      onClick={() => setItems((prev) => prev.filter((_, i) => i !== idx))}
                      className="rounded-md p-1.5 text-slate-400 transition hover:bg-red-50 hover:text-red-600"
                      aria-label="Remove item"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
            {items.length > 0 && (
              <tfoot className="bg-slate-50 text-sm">
                <tr className="border-t border-slate-200">
                  <td colSpan={6} className="px-3 py-2 text-right font-medium text-slate-600">Subtotal</td>
                  <td className="px-3 py-2 text-right font-mono font-semibold tabular-nums">{subtotal.toFixed(2)}</td>
                  <td />
                </tr>
                <tr>
                  <td colSpan={6} className="px-3 py-2 text-right font-medium text-slate-600">GST @ {taxRate}%</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">{taxAmt.toFixed(2)}</td>
                  <td />
                </tr>
                <tr className="border-t border-slate-300">
                  <td colSpan={6} className="px-3 py-2 text-right font-bold text-slate-800">Grand Total</td>
                  <td className="px-3 py-2 text-right font-mono font-bold tabular-nums text-base">₹ {grand.toFixed(2)}</td>
                  <td />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </section>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          <div className="font-medium">{error.message}</div>
          {error.details && (
            <ul className="mt-1 list-disc pl-5 text-xs">
              {error.details.map((d, i) => <li key={i}>{d}</li>)}
            </ul>
          )}
        </div>
      )}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end sm:gap-3">
        <button type="button" onClick={() => navigate('/supplier-po/manage')} className="btn-ghost w-full sm:w-auto">Cancel</button>
        <button type="button" onClick={onSubmit} disabled={submit.isPending} className="btn-primary w-full sm:w-auto">
          {submit.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Submit PO
        </button>
      </div>
    </div>
  );
};

/* ---------- inline item entry sub-form ---------- */
const ItemEntry = ({ onAdd }: { onAdd: (item: Item) => void }) => {
  const [description, setDescription] = useState('');
  const [hsnCode, setHsnCode] = useState('');
  const [qty, setQty] = useState(0);
  const [unit, setUnit] = useState('KG');
  const [rate, setRate] = useState(0);

  const amount = useMemo(() => +(qty * rate).toFixed(2), [qty, rate]);
  const { alert: showAlert, confirmDialog: alertDialog } = useConfirm();

  const reset = () => { setDescription(''); setHsnCode(''); setQty(0); setUnit('KG'); setRate(0); };

  const add = async () => {
    if (!description.trim()) {
      await showAlert({ title: 'Missing description', message: 'Enter an item description.', tone: 'warning' });
      return;
    }
    if (qty <= 0) {
      await showAlert({ title: 'Invalid quantity', message: 'Quantity must be greater than zero.', tone: 'warning' });
      return;
    }
    if (rate <= 0) {
      await showAlert({ title: 'Invalid rate', message: 'Rate must be greater than zero.', tone: 'warning' });
      return;
    }
    onAdd({
      description: description.trim().toUpperCase(),
      hsnCode: hsnCode.trim().toUpperCase(),
      qty, unit: unit.trim().toUpperCase(), rate, amount,
    });
    reset();
  };

  return (
    <section className="card p-3 sm:p-4 space-y-3">
      <h2 className="text-sm font-semibold text-slate-900">Add line item</h2>
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 md:grid-cols-6">
        <Field label="Description" className="col-span-2 sm:col-span-3 md:col-span-2">
          <ItemTypeahead
            value={description}
            onChange={setDescription}
            onPick={(s) => {
              setDescription(s.description);
              if (s.hsnCode) setHsnCode(s.hsnCode);
              if (s.unit)    setUnit(s.unit);
            }}
            placeholder="STEEL SHEET 0.23MM"
            inputClassName={inputCls}
          />
        </Field>
        <Field label="HSN Code">
          <ItemTypeahead
            value={hsnCode}
            onChange={setHsnCode}
            onPick={(s) => {
              if (s.hsnCode) setHsnCode(s.hsnCode);
              setDescription(s.description);
              if (s.unit) setUnit(s.unit);
            }}
            placeholder="72251990"
            inputClassName={inputCls}
          />
        </Field>
        <Field label="Qty">
          <input className={inputCls} type="number" inputMode="decimal" step="any" min={0}
            value={qty || ''} onChange={(e) => setQty(parseFloat(e.target.value) || 0)} placeholder="0" />
        </Field>
        <Field label="Unit">
          <input className={inputCls} value={unit} onChange={(e) => setUnit(e.target.value.toUpperCase())} placeholder="KG" />
        </Field>
        <Field label="Rate">
          <input className={inputCls} type="number" inputMode="decimal" step="any" min={0}
            value={rate || ''} onChange={(e) => setRate(parseFloat(e.target.value) || 0)} placeholder="0.00" />
        </Field>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-xs text-slate-500">
          Amount: <span className="font-mono font-semibold text-slate-900">₹ {amount.toFixed(2)}</span>
        </div>
        <button onClick={add} type="button" className="btn-primary w-full sm:w-auto">
          <Plus className="h-4 w-4" /> Add item
        </button>
      </div>
      {alertDialog}
    </section>
  );
};

const Field = ({
  label, icon: Icon, children, className,
}: {
  label: string;
  icon?: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
  className?: string;
}) => (
  <label className={`block ${className ?? ''}`}>
    <span className="mb-1 flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-slate-500">
      {Icon && <Icon className="h-3 w-3" />}
      {label}
    </span>
    {children}
  </label>
);
