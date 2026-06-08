// Edit existing Supplier PO — replaces all items in one save (PUT replaces).
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Save, Loader2, Plus, Trash2, Truck, Calendar, Hash } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { SearchableSelect } from '@/components/SearchableSelect';
import { ItemTypeahead } from '@/components/ItemTypeahead';

type Supplier = { id: string; name: string; gstRate: number; gstNumber: string | null; state: string | null };

type Item = {
  id?: string;
  description: string;
  hsnCode: string;
  qty: number;
  unit: string;
  rate: number;
  amount: number;
  notes: string;
};

type SupplierOrder = {
  id: string;
  poNumber: string;
  orderDate: string;
  expectedDate: string | null;
  status: 'PENDING' | 'PARTIAL' | 'RECEIVED' | 'CANCELLED';
  notes: string | null;
  supplier: Supplier;
  items: Array<{ id: string; description: string; hsnCode: string | null; qty: number; unit: string; rate: number; amount: number; notes: string | null }>;
};

const inputCls =
  'h-9 w-full rounded-md border border-slate-300 bg-white px-2.5 text-sm text-slate-900 ' +
  'placeholder:text-slate-400 outline-none transition ' +
  'focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20';

export const SupplierOrderEditPage = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [poNumber, setPoNumber]     = useState('');
  const [supplierId, setSupplierId] = useState('');
  const [orderDate, setOrderDate]   = useState('');
  const [expectedDate, setExpectedDate] = useState('');
  const [items, setItems] = useState<Item[]>([]);
  const [error, setError] = useState<{ message: string; details?: string[] } | null>(null);

  const { data: po, isLoading } = useQuery({
    queryKey: ['supplier-order', id],
    queryFn: () => api<SupplierOrder>(`/supplier-orders/${id}`),
    enabled: !!id,
  });

  const { data: suppliersResp } = useQuery({
    queryKey: ['suppliers', 'all'],
    queryFn: () => api<{ items: Supplier[] }>('/suppliers?pageSize=200'),
  });

  useEffect(() => {
    if (!po) return;
    setPoNumber(po.poNumber);
    setSupplierId(po.supplier.id);
    setOrderDate(po.orderDate.slice(0, 10));
    setExpectedDate(po.expectedDate?.slice(0, 10) ?? '');
    setItems(po.items.map((it) => ({
      id: it.id,
      description: it.description,
      hsnCode: it.hsnCode ?? '',
      qty: it.qty,
      unit: it.unit,
      rate: it.rate,
      amount: it.amount,
      notes: it.notes ?? '',
    })));
  }, [po]);

  const supplier = (suppliersResp?.items ?? []).find((s) => s.id === supplierId);
  const subtotal = items.reduce((s, x) => s + x.amount, 0);
  const taxRate  = supplier?.gstRate ?? 0;
  const taxAmt   = +(subtotal * (taxRate / 100)).toFixed(2);
  const grand    = +(subtotal + taxAmt).toFixed(2);

  const update = useMutation({
    mutationFn: (body: unknown) => api(`/supplier-orders/${id}`, { method: 'PUT', json: body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['supplier-orders'] });
      qc.invalidateQueries({ queryKey: ['supplier-order', id] });
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
      } else setError({ message: 'Save failed' });
    },
  });

  const onSave = () => {
    setError(null);
    if (!items.length) { setError({ message: 'Add at least one item' }); return; }
    update.mutate({
      poNumber: poNumber.trim(),
      supplierId,
      orderDate,
      expectedDate: expectedDate || null,
      items,
    });
  };

  const updateItem = (idx: number, patch: Partial<Item>) =>
    setItems((prev) => prev.map((it, i) => {
      if (i !== idx) return it;
      const next = { ...it, ...patch };
      next.amount = +(next.qty * next.rate).toFixed(2);
      return next;
    }));

  const addBlank = () =>
    setItems((prev) => [...prev, { description: '', hsnCode: '', qty: 0, unit: 'KG', rate: 0, amount: 0, notes: '' }]);

  if (isLoading) return <div className="card p-10 text-center"><Loader2 className="h-5 w-5 animate-spin mx-auto text-slate-400" /></div>;
  if (!po)       return <div className="card p-10 text-center text-slate-400">PO not found.</div>;

  return (
    <div className="space-y-4 max-w-7xl pb-4">
      <div className="flex items-center gap-3">
        <Link to="/supplier-po/manage" className="btn-ghost text-slate-600">
          <ArrowLeft className="h-4 w-4" /> Back
        </Link>
        <h1 className="text-lg sm:text-2xl font-bold tracking-tight flex items-center gap-2">
          <Truck className="h-5 w-5 text-brand-600" /> Edit PO — {po.poNumber}
        </h1>
        <Link
          to={`/supplier-po/print/${po.id}`}
          className="ml-auto btn-ghost text-slate-700 hover:bg-slate-100"
          title="Open the printable / shareable PDF view"
        >
          Print / PDF
        </Link>
      </div>

      <section className="card p-3 sm:p-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          <Field label="PO Number" icon={Hash}>
            <input className={inputCls} value={poNumber} onChange={(e) => setPoNumber(e.target.value.toUpperCase())} />
          </Field>
          <Field label="Supplier" icon={Truck} className="col-span-2 sm:col-span-1">
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
          <Field label="Expected Date">
            <input className={inputCls} type="date" value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} />
          </Field>
        </div>
      </section>

      <section className="card overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2.5 sm:px-4">
          <h2 className="text-sm font-semibold text-slate-900">Items</h2>
          <button onClick={addBlank} type="button" className="btn-ghost text-sm border border-slate-300">
            <Plus className="h-4 w-4" /> Add row
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-2 py-2">Description</th>
                <th className="px-2 py-2 w-28">HSN</th>
                <th className="px-2 py-2 w-20 text-right">Qty</th>
                <th className="px-2 py-2 w-20">Unit</th>
                <th className="px-2 py-2 w-24 text-right">Rate</th>
                <th className="px-2 py-2 w-24 text-right">Amount</th>
                <th className="w-10 px-2 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {items.map((it, idx) => (
                <tr key={idx} className="border-t border-slate-100">
                  <td className="px-2 py-1.5">
                    <ItemTypeahead
                      value={it.description}
                      onChange={(v) => updateItem(idx, { description: v })}
                      onPick={(s) => updateItem(idx, {
                        description: s.description,
                        hsnCode: s.hsnCode ?? it.hsnCode,
                        unit:    s.unit    || it.unit,
                      })}
                      inputClassName={inputCls}
                    />
                    <input
                      className={`${inputCls} mt-1 h-8 text-xs`}
                      value={it.notes}
                      onChange={(e) => updateItem(idx, { notes: e.target.value })}
                      placeholder="Notes (optional)"
                    />
                  </td>
                  <td className="px-2 py-1.5">
                    <ItemTypeahead
                      value={it.hsnCode}
                      onChange={(v) => updateItem(idx, { hsnCode: v })}
                      onPick={(s) => updateItem(idx, {
                        description: s.description,
                        hsnCode: s.hsnCode ?? it.hsnCode,
                        unit:    s.unit    || it.unit,
                      })}
                      inputClassName={inputCls}
                    />
                  </td>
                  <td className="px-2 py-1.5">
                    <input className={`${inputCls} text-right`} type="number" inputMode="decimal" step="any" min={0}
                      value={it.qty || ''} onChange={(e) => updateItem(idx, { qty: parseFloat(e.target.value) || 0 })} />
                  </td>
                  <td className="px-2 py-1.5">
                    <input className={inputCls} value={it.unit}
                      onChange={(e) => updateItem(idx, { unit: e.target.value.toUpperCase() })} />
                  </td>
                  <td className="px-2 py-1.5">
                    <input className={`${inputCls} text-right`} type="number" inputMode="decimal" step="any" min={0}
                      value={it.rate || ''} onChange={(e) => updateItem(idx, { rate: parseFloat(e.target.value) || 0 })} />
                  </td>
                  <td className="px-2 py-1.5 text-right font-mono tabular-nums font-semibold">{it.amount.toFixed(2)}</td>
                  <td className="px-2 py-1.5 text-right">
                    <button onClick={() => setItems((prev) => prev.filter((_, i) => i !== idx))}
                      className="rounded-md p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-slate-50 text-sm">
              <tr className="border-t border-slate-200">
                <td colSpan={5} className="px-2 py-2 text-right font-medium text-slate-600">Subtotal</td>
                <td className="px-2 py-2 text-right font-mono font-semibold">{subtotal.toFixed(2)}</td>
                <td />
              </tr>
              <tr>
                <td colSpan={5} className="px-2 py-2 text-right font-medium text-slate-600">GST @ {taxRate}%</td>
                <td className="px-2 py-2 text-right font-mono">{taxAmt.toFixed(2)}</td>
                <td />
              </tr>
              <tr className="border-t border-slate-300">
                <td colSpan={5} className="px-2 py-2 text-right font-bold text-slate-800">Grand Total</td>
                <td className="px-2 py-2 text-right font-mono font-bold tabular-nums">₹ {grand.toFixed(2)}</td>
                <td />
              </tr>
            </tfoot>
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
        <Link to="/supplier-po/manage" className="btn-ghost w-full sm:w-auto">Cancel</Link>
        <button onClick={onSave} disabled={update.isPending} className="btn-primary w-full sm:w-auto">
          {update.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Save changes
        </button>
      </div>
    </div>
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
