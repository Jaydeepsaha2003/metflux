// Create / view / advance a single Return record. New mode picks PO items
// off the customer's history; edit mode shows full state with status buttons
// and per-row item details.
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Save, Loader2, Plus, Trash2, RotateCcw, CheckCircle2, Truck, AlertCircle } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { SearchableSelect } from '@/components/SearchableSelect';

type ReturnStatus = 'PENDING' | 'RECEIVED' | 'IN_REWORK' | 'REDISPATCHED' | 'CLOSED' | 'CANCELLED';
type ReferenceType = 'SO_NUMBER' | 'INVOICE_NUMBER' | 'WO_NUMBER';

type Customer = { id: string; name: string };
type PoItem = {
  id: string;
  poNumber: string;
  customerId: string;
  customerName: string;
  coreType: 'TOROIDAL' | 'RECTANGULAR';
  grade: string;
  material: string;
  measure: string;
  pcs: number;
};

type ReturnItemDetail = {
  id: string;
  poOrderItemId: string;
  pcs: number;
  reason: string | null;
  poNumber: string | null;
  coreType: 'TOROIDAL' | 'RECTANGULAR' | null;
  grade: string | null;
  material: string | null;
  measure: string | null;
};

type ReturnDetail = {
  id: string;
  returnNumber: string;
  returnDate: string;
  referenceType: ReferenceType;
  referenceValue: string;
  status: ReturnStatus;
  receivedAt: string | null;
  reworkAt: string | null;
  redispatchAt: string | null;
  redispatchVehicle: string | null;
  closedAt: string | null;
  reason: string | null;
  notes: string | null;
  customerId: string;
  customerName: string | null;
  itemCount: number;
  totalPcs: number;
  createdAt: string;
  updatedAt: string;
  items: ReturnItemDetail[];
};

type DraftItem = {
  poOrderItemId: string;
  pcs: number;
  reason: string;
  // local-only metadata for display
  meta?: { poNumber: string; measure: string; grade: string; material: string };
};

const todayISO = () => new Date().toISOString().slice(0, 10);
const fmtDate = (iso: string | null | undefined) => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
};
const fmtDateTime = (iso: string | null | undefined) => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};

const STATUS_BADGE: Record<ReturnStatus, string> = {
  PENDING:      'bg-amber-50 text-amber-700 ring-1 ring-amber-200',
  RECEIVED:     'bg-blue-50 text-blue-700 ring-1 ring-blue-200',
  IN_REWORK:    'bg-violet-50 text-violet-700 ring-1 ring-violet-200',
  REDISPATCHED: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200',
  CLOSED:       'bg-slate-100 text-slate-600 ring-1 ring-slate-200',
  CANCELLED:    'bg-rose-50 text-rose-700 ring-1 ring-rose-200',
};
const STATUS_LABEL: Record<ReturnStatus, string> = {
  PENDING: 'Pending', RECEIVED: 'Received', IN_REWORK: 'In Rework',
  REDISPATCHED: 'Re-dispatched', CLOSED: 'Closed', CANCELLED: 'Cancelled',
};

export const ReturnFormPage = () => {
  const { id } = useParams();
  const isEdit = !!id;
  const navigate = useNavigate();
  const qc = useQueryClient();

  const { data: existing, isLoading: loadingExisting } = useQuery({
    queryKey: ['return', id],
    queryFn: () => api<ReturnDetail>(`/returns/${id}`),
    enabled: isEdit,
  });

  const { data: customersResp } = useQuery({
    queryKey: ['customers', 'all'],
    queryFn: () => api<{ items: Customer[] }>('/customers?pageSize=200'),
  });

  // For "Add item" picker we list ALL PO items for the chosen customer.
  const [customerId, setCustomerId] = useState('');
  const { data: itemsForCustomer } = useQuery({
    queryKey: ['po-items-by-customer', customerId],
    queryFn: () => api<{ items: PoItem[] }>(`/po-orders/items?pageSize=200`),
    enabled: !!customerId && !isEdit,
  });
  const customerItems = (itemsForCustomer?.items ?? []).filter((i) => i.customerId === customerId);

  // Reference value options — fetched lazily based on referenceType.
  // SO numbers come from /po-orders, invoice + WO numbers from /packing-lists.
  // We filter to the selected customer so the dropdown stays relevant.
  const { data: poList } = useQuery({
    queryKey: ['po-orders-by-customer', customerId],
    queryFn: () => api<{ items: { poNumber: string; customer: { id: string; name: string } }[] }>('/po-orders?pageSize=500'),
    enabled: !!customerId && !isEdit,
  });
  const { data: plList } = useQuery({
    queryKey: ['packing-lists-by-customer', customerId],
    queryFn: () => api<{ items: { plNumber: string; invoiceNo: string | null; customerName: string | null }[] }>('/packing-lists'),
    enabled: !!customerId && !isEdit,
  });
  const selectedCustomerName = customersResp?.items.find((c) => c.id === customerId)?.name ?? '';

  /* Form state — only meaningful in NEW mode */
  const [returnNumber, setReturnNumber]     = useState('');
  const [returnDate, setReturnDate]         = useState(todayISO());
  const [referenceType, setReferenceType]   = useState<ReferenceType>('SO_NUMBER');
  const [referenceValue, setReferenceValue] = useState('');
  const [reason, setReason]                 = useState('');
  const [notes, setNotes]                   = useState('');
  const [draftItems, setDraftItems]         = useState<DraftItem[]>([]);

  const [error, setError] = useState<string | null>(null);

  /* Mutations */
  const create = useMutation({
    mutationFn: (body: unknown) => api<ReturnDetail>('/returns', { method: 'POST', json: body }),
    onSuccess: (created) => {
      qc.invalidateQueries({ queryKey: ['returns'] });
      navigate(`/returns/${created.id}`);
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Save failed'),
  });

  const transition = useMutation({
    mutationFn: (body: { to: ReturnStatus; vehicleNo?: string | null }) =>
      api<ReturnDetail>(`/returns/${id}/transition`, { method: 'POST', json: body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['return', id] });
      qc.invalidateQueries({ queryKey: ['returns'] });
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Status update failed'),
  });

  const onCreate = () => {
    setError(null);
    if (!returnNumber.trim()) return setError('Return number is required.');
    if (!customerId) return setError('Pick a customer.');
    if (!referenceValue.trim()) return setError('Reference number is required.');
    if (draftItems.length === 0) return setError('Add at least one returned item.');
    for (const i of draftItems) {
      if (!i.pcs || i.pcs <= 0) return setError(`Pcs must be > 0 for ${i.meta?.measure ?? 'item'}.`);
    }
    create.mutate({
      returnNumber, returnDate, referenceType, referenceValue,
      customerId, reason: reason || null, notes: notes || null,
      items: draftItems.map((i) => ({
        poOrderItemId: i.poOrderItemId, pcs: i.pcs, reason: i.reason || null,
      })),
    });
  };

  /* Reference-value dropdown options — depend on referenceType + customer.
     De-duped, sorted, and filtered to the chosen customer. */
  const referenceOptions = useMemo(() => {
    if (!customerId) return [];
    if (referenceType === 'SO_NUMBER') {
      const seen = new Set<string>();
      const out: { value: string; label: string }[] = [];
      for (const po of poList?.items ?? []) {
        if (po.customer?.id !== customerId) continue;
        if (seen.has(po.poNumber)) continue;
        seen.add(po.poNumber);
        out.push({ value: po.poNumber, label: po.poNumber });
      }
      return out.sort((a, b) => a.label.localeCompare(b.label));
    }
    // Packing-list-based references — filter by customer NAME (the only key
    // exposed on the list endpoint).
    const wanted = (plList?.items ?? []).filter((p) => p.customerName === selectedCustomerName);
    if (referenceType === 'INVOICE_NUMBER') {
      const seen = new Set<string>();
      const out: { value: string; label: string }[] = [];
      for (const p of wanted) {
        if (!p.invoiceNo) continue;
        if (seen.has(p.invoiceNo)) continue;
        seen.add(p.invoiceNo);
        out.push({ value: p.invoiceNo, label: p.invoiceNo });
      }
      return out.sort((a, b) => a.label.localeCompare(b.label));
    }
    // WO_NUMBER
    const seen = new Set<string>();
    const out: { value: string; label: string }[] = [];
    for (const p of wanted) {
      if (seen.has(p.plNumber)) continue;
      seen.add(p.plNumber);
      out.push({ value: p.plNumber, label: p.plNumber });
    }
    return out.sort((a, b) => a.label.localeCompare(b.label));
  }, [referenceType, customerId, selectedCustomerName, poList, plList]);

  // Whenever the reference type or customer changes, blank the chosen value
  // so an old selection from a different scope doesn't linger.
  useEffect(() => { setReferenceValue(''); }, [referenceType, customerId]);

  /* New-mode: add an item from the picker */
  const [pickerItemId, setPickerItemId] = useState('');
  const [pickerPcs, setPickerPcs]       = useState(0);
  const [pickerReason, setPickerReason] = useState('');

  const addDraft = () => {
    if (!pickerItemId || pickerPcs <= 0) return;
    const meta = customerItems.find((i) => i.id === pickerItemId);
    if (!meta) return;
    setDraftItems((prev) => [
      ...prev,
      {
        poOrderItemId: pickerItemId,
        pcs: pickerPcs,
        reason: pickerReason,
        meta: { poNumber: meta.poNumber, measure: meta.measure, grade: meta.grade, material: meta.material },
      },
    ]);
    setPickerItemId(''); setPickerPcs(0); setPickerReason('');
  };

  const dropDraft = (idx: number) =>
    setDraftItems((prev) => prev.filter((_, i) => i !== idx));

  /* Allowed transitions for the current status */
  const transitions: Array<{ to: ReturnStatus; label: string; tone: 'primary' | 'ghost' | 'danger' }> = useMemo(() => {
    if (!existing) return [];
    switch (existing.status) {
      case 'PENDING':      return [
        { to: 'RECEIVED',     label: 'Mark Received',  tone: 'primary' },
        { to: 'CANCELLED',    label: 'Cancel return',  tone: 'danger' },
      ];
      case 'RECEIVED':     return [
        { to: 'IN_REWORK',    label: 'Start Rework',   tone: 'primary' },
        { to: 'CANCELLED',    label: 'Cancel return',  tone: 'danger' },
      ];
      case 'IN_REWORK':    return [{ to: 'REDISPATCHED', label: 'Re-dispatch to customer', tone: 'primary' }];
      case 'REDISPATCHED': return [{ to: 'CLOSED', label: 'Close return', tone: 'primary' }];
      default: return [];
    }
  }, [existing]);

  const [redispatchVehicle, setRedispatchVehicle] = useState('');

  if (isEdit && loadingExisting) return (
    <div className="card p-10 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-slate-400" /></div>
  );

  /* ====== NEW MODE ====== */
  if (!isEdit) return (
    <div className="space-y-4 max-w-5xl">
      <div className="flex items-center gap-3">
        <Link to="/returns" className="btn-ghost text-slate-600">
          <ArrowLeft className="h-4 w-4" /> Back
        </Link>
        <h1 className="text-xl font-bold tracking-tight flex items-center gap-2">
          <RotateCcw className="h-5 w-5 text-brand-600" /> New Return
        </h1>
      </div>

      <section className="card p-3 sm:p-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          <Field label="Return No." required>
            <input className="input" value={returnNumber} onChange={(e) => setReturnNumber(e.target.value.toUpperCase())} />
          </Field>
          <Field label="Return Date" required>
            <input className="input" type="date" value={returnDate} onChange={(e) => setReturnDate(e.target.value)} />
          </Field>
          <Field label="Customer" required>
            <SearchableSelect
              value={customerId}
              onChange={(v) => { setCustomerId(v); setDraftItems([]); }}
              options={(customersResp?.items ?? []).map((c) => ({ value: c.id, label: c.name }))}
              placeholder="Select customer…"
            />
          </Field>
          <Field label="Reference Type" required>
            <select className="input" value={referenceType} onChange={(e) => setReferenceType(e.target.value as ReferenceType)}>
              <option value="SO_NUMBER">Sales Order No.</option>
              <option value="INVOICE_NUMBER">Invoice No.</option>
              <option value="WO_NUMBER">Work Order / WO No.</option>
            </select>
          </Field>
          <Field label="Reference Value" required>
            {/* Free-text input with a <datalist> that suggests numbers we already
                know about for the selected customer + reference type. The user
                can still type any value (e.g. one that doesn't exist in our DB
                yet — common when the return predates the related record). */}
            <input
              className="input"
              value={referenceValue}
              onChange={(e) => setReferenceValue(e.target.value.toUpperCase())}
              placeholder={
                referenceType === 'SO_NUMBER' ? 'e.g. SO/2026/001'
                : referenceType === 'INVOICE_NUMBER' ? 'e.g. INV-0001'
                : 'e.g. METWO-001'
              }
              list={`ref-suggestions-${referenceType}`}
            />
            {referenceOptions.length > 0 && (
              <datalist id={`ref-suggestions-${referenceType}`}>
                {referenceOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </datalist>
            )}
          </Field>
          <Field label="Reason" full>
            <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Dimension out of tolerance" />
          </Field>
          <Field label="Notes" full>
            <textarea className="input min-h-[60px]" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional internal notes" />
          </Field>
        </div>
      </section>

      {/* Item picker — only after a customer is chosen */}
      <section className="card p-3 sm:p-4 space-y-3">
        <h2 className="text-sm font-semibold text-slate-900">Returned items</h2>
        {!customerId && (
          <div className="rounded-lg border border-dashed border-slate-300 px-4 py-6 text-center text-sm text-slate-500">
            Pick a customer above to start adding items.
          </div>
        )}
        {customerId && (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-5">
              <Field label="PO item" full>
                <SearchableSelect
                  value={pickerItemId}
                  onChange={setPickerItemId}
                  options={customerItems.map((i) => ({
                    value: i.id,
                    label: `${i.poNumber} — ${i.measure} (${i.grade})`,
                  }))}
                  placeholder={customerItems.length ? 'Pick an item…' : 'No items for this customer'}
                  disabled={!customerItems.length}
                />
              </Field>
              <Field label="Pcs">
                <input
                  type="number" min={1} inputMode="numeric"
                  className="input" value={pickerPcs || ''}
                  onChange={(e) => setPickerPcs(parseInt(e.target.value || '0', 10))}
                />
              </Field>
              <Field label="Reason">
                <input className="input" value={pickerReason} onChange={(e) => setPickerReason(e.target.value)} placeholder="Optional" />
              </Field>
              <div className="flex items-end">
                <button
                  type="button" onClick={addDraft}
                  disabled={!pickerItemId || pickerPcs <= 0}
                  className="btn-primary w-full"
                >
                  <Plus className="h-4 w-4" /> Add
                </button>
              </div>
            </div>

            {draftItems.length > 0 && (
              <div className="overflow-x-auto rounded-lg border border-slate-200">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500 text-left">
                    <tr>
                      <th className="px-3 py-2">PO #</th>
                      <th className="px-3 py-2">Measure</th>
                      <th className="px-3 py-2">Grade · Material</th>
                      <th className="px-3 py-2 text-right">Pcs</th>
                      <th className="px-3 py-2">Reason</th>
                      <th className="w-10"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {draftItems.map((d, idx) => (
                      <tr key={idx} className="hover:bg-slate-50">
                        <td className="px-3 py-2 font-mono text-xs">{d.meta?.poNumber}</td>
                        <td className="px-3 py-2 font-mono text-xs">{d.meta?.measure}</td>
                        <td className="px-3 py-2 text-slate-600">{d.meta?.grade} · {d.meta?.material}</td>
                        <td className="px-3 py-2 text-right tabular-nums font-semibold">{d.pcs}</td>
                        <td className="px-3 py-2 text-slate-500 text-xs">{d.reason || '—'}</td>
                        <td className="px-3 py-2 text-right">
                          <button
                            onClick={() => dropDraft(idx)}
                            className="rounded-md p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                            title="Remove"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </section>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
      )}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end sm:gap-3">
        <Link to="/returns" className="btn-ghost w-full sm:w-auto justify-center">Cancel</Link>
        <button onClick={onCreate} disabled={create.isPending} className="btn-primary w-full sm:w-auto justify-center">
          {create.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Save Return
        </button>
      </div>
    </div>
  );

  /* ====== EDIT / VIEW MODE ====== */
  if (!existing) return null;

  return (
    <div className="space-y-4 max-w-5xl">
      <div className="flex items-center gap-3">
        <Link to="/returns" className="btn-ghost text-slate-600">
          <ArrowLeft className="h-4 w-4" /> Back
        </Link>
        <h1 className="text-xl font-bold tracking-tight flex items-center gap-2 min-w-0">
          <RotateCcw className="h-5 w-5 text-brand-600 shrink-0" />
          <span className="truncate">{existing.returnNumber}</span>
          <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-medium shrink-0', STATUS_BADGE[existing.status])}>
            {STATUS_LABEL[existing.status]}
          </span>
        </h1>
      </div>

      {/* Header info */}
      <section className="card p-3 sm:p-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 text-sm">
          <Stat label="Customer"    value={existing.customerName ?? '—'} />
          <Stat label="Return Date" value={fmtDate(existing.returnDate)} />
          <Stat label="Reference"   value={`${existing.referenceType.replace('_NUMBER','')} · ${existing.referenceValue}`} mono />
          <Stat label="Items"       value={`${existing.itemCount} · ${existing.totalPcs} pcs`} />
          {existing.reason && <div className="col-span-full"><Stat label="Reason" value={existing.reason} /></div>}
          {existing.notes && <div className="col-span-full"><Stat label="Notes" value={existing.notes} /></div>}
        </div>
      </section>

      {/* Status timeline */}
      <section className="card p-3 sm:p-4">
        <h2 className="mb-2 text-sm font-semibold text-slate-900">Lifecycle</h2>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5 text-xs">
          <Timeline label="Logged"        date={fmtDateTime(existing.createdAt)} active />
          <Timeline label="Received"      date={fmtDateTime(existing.receivedAt)}    active={!!existing.receivedAt} />
          <Timeline label="In Rework"     date={fmtDateTime(existing.reworkAt)}      active={!!existing.reworkAt} />
          <Timeline label="Re-dispatched" date={fmtDateTime(existing.redispatchAt)}  active={!!existing.redispatchAt} sub={existing.redispatchVehicle ?? undefined} />
          <Timeline label="Closed"        date={fmtDateTime(existing.closedAt)}      active={!!existing.closedAt} />
        </div>
      </section>

      {/* Items list */}
      <section className="card overflow-hidden">
        <div className="border-b border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-900">Items returned</div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm whitespace-nowrap">
            <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500 text-left">
              <tr>
                <th className="px-4 py-3">PO #</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Grade</th>
                <th className="px-4 py-3">Material</th>
                <th className="px-4 py-3">Measure</th>
                <th className="px-4 py-3 text-right">Pcs</th>
                <th className="px-4 py-3">Reason</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {existing.items.map((it) => (
                <tr key={it.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-mono text-xs">{it.poNumber ?? '—'}</td>
                  <td className="px-4 py-3">
                    <span className={cn(
                      'rounded-full px-2 py-0.5 text-[11px] font-medium',
                      it.coreType === 'TOROIDAL' ? 'bg-amber-50 text-amber-700' : 'bg-rose-50 text-rose-700'
                    )}>
                      {it.coreType === 'TOROIDAL' ? 'Toro' : it.coreType === 'RECTANGULAR' ? 'Rect' : '—'}
                    </span>
                  </td>
                  <td className="px-4 py-3">{it.grade ?? '—'}</td>
                  <td className="px-4 py-3">{it.material ?? '—'}</td>
                  <td className="px-4 py-3 font-mono text-xs">{it.measure ?? '—'}</td>
                  <td className="px-4 py-3 text-right tabular-nums font-semibold">{it.pcs}</td>
                  <td className="px-4 py-3 text-slate-500 text-xs">{it.reason ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Status transition controls */}
      {transitions.length > 0 && (
        <section className="card p-3 sm:p-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-900">Update status</h2>
          {transitions.some((t) => t.to === 'REDISPATCHED') && (
            <div className="mb-3">
              <Field label="Re-dispatch vehicle (optional)">
                <input className="input max-w-xs" value={redispatchVehicle} onChange={(e) => setRedispatchVehicle(e.target.value)} placeholder="e.g. MH-12-XX-1234" />
              </Field>
            </div>
          )}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:flex-wrap sm:gap-3">
            {transitions.map((t) => (
              <button
                key={t.to}
                onClick={() => transition.mutate({ to: t.to, vehicleNo: t.to === 'REDISPATCHED' ? (redispatchVehicle || null) : null })}
                disabled={transition.isPending}
                className={cn(
                  'w-full sm:w-auto justify-center',
                  t.tone === 'danger' ? 'btn-danger' : t.tone === 'ghost' ? 'btn-ghost border border-slate-300' : 'btn-primary'
                )}
              >
                {transition.isPending ? <Loader2 className="h-4 w-4 animate-spin" />
                  : t.to === 'REDISPATCHED' ? <Truck className="h-4 w-4" />
                  : t.to === 'CANCELLED' ? <AlertCircle className="h-4 w-4" />
                  : <CheckCircle2 className="h-4 w-4" />}
                {t.label}
              </button>
            ))}
          </div>
        </section>
      )}

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
      )}
    </div>
  );
};

/* ── small helpers ── */
const Field = ({
  label, children, required, full,
}: { label: string; children: React.ReactNode; required?: boolean; full?: boolean }) => (
  <label className={cn('block', full && 'sm:col-span-2 lg:col-span-4')}>
    <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-slate-500">
      {label}{required && <span className="ml-1 text-red-500">*</span>}
    </span>
    {children}
  </label>
);

const Stat = ({ label, value, mono }: { label: string; value: string; mono?: boolean }) => (
  <div className="min-w-0">
    <div className="text-[10px] font-medium uppercase tracking-wide text-slate-500">{label}</div>
    <div className={cn('truncate text-sm text-slate-900 font-medium', mono && 'font-mono')}>{value}</div>
  </div>
);

const Timeline = ({ label, date, active, sub }: { label: string; date: string; active: boolean; sub?: string }) => (
  <div className={cn(
    'rounded-lg border px-2.5 py-2 text-center',
    active ? 'border-brand-200 bg-brand-50' : 'border-slate-200 bg-slate-50/60 text-slate-400'
  )}>
    <div className="text-[9px] uppercase tracking-wide font-semibold">{label}</div>
    <div className="mt-0.5 text-[11px]">{active ? date : '—'}</div>
    {sub && <div className="mt-0.5 text-[10px] text-slate-500 truncate">{sub}</div>}
  </div>
);
