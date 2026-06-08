// Full PO editor — header fields + view/manage all existing items + add new items.
// Route: /po/edit/:poId (linked from SO Summary's "Edit PO" button).
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft, Plus, Pencil, Trash2, RotateCcw, Ban,
  Save, Loader2, Hash, User2, CheckCircle2, XCircle,
} from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { SearchableSelect } from '@/components/SearchableSelect';
import { ToroidalForm, RectangularForm } from '@/pages/POOrderNewPage';
import type { Item as POItemNew } from '@/pages/POOrderNewPage';

/* ---------- types ---------- */
type CoreType = 'TOROIDAL' | 'RECTANGULAR';

type POItem = {
  id: string;
  poOrderId: string;
  coreType: CoreType;
  grade: string;
  material: string;
  measure: string;
  pcs: number;
  pcsProduced: number;
  pcsDispatched: number;
  weightPerPc: number;
  totalWeight: number;
  totalAmount: number | null;
  status: 'ACTIVE' | 'CANCELLED';
};

type POHeader = {
  id: string;
  poNumber: string;
  customerId: string;
  orderDate: string;
  deliveryDate: string;
  deliveryDays: number;
  notes: string | null;
  customer?: { id: string; name: string };
};

type GradeRow  = { grade: string; materials: { id: string; material: string }[] };
type FluxGroup = { grade: string; points: { flux: number; ateCm: number }[] };
type Customer  = { id: string; name: string };

const fmtDate = (iso: string | null | undefined) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? String(iso)
    : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
};

/* ============================================================ */
export const POOrderEditPage = () => {
  const { poId } = useParams<{ poId: string }>();
  const queryClient = useQueryClient();

  // PO header
  const { data: po, isLoading: poLoading } = useQuery({
    queryKey: ['po-header', poId],
    queryFn: () => api<POHeader>(`/po-orders/${poId}`),
    enabled: !!poId,
  });

  // All items for this PO (with pcsProduced / pcsDispatched)
  const { data: itemsData, isLoading: itemsLoading } = useQuery({
    queryKey: ['po-items', 'by-po', poId],
    queryFn: () =>
      api<{ items: POItem[] }>(`/po-orders/items?poOrderId=${poId}&pageSize=500&status=ALL`),
    enabled: !!poId,
  });
  const items = itemsData?.items ?? [];
  const hasProduction = items.some((it) => it.pcsProduced > 0);

  // Grade / flux data for the add-item form
  const { data: gradesResp } = useQuery({
    queryKey: ['material-grades'],
    queryFn: () => api<{ grades: GradeRow[] }>('/material-grades'),
  });
  const { data: fluxTor } = useQuery({
    queryKey: ['flux-grades-grouped', 'TOROIDAL'],
    queryFn: () => api<{ grades: FluxGroup[] }>('/flux-grades/grouped?coreType=TOROIDAL'),
  });
  const { data: fluxRect } = useQuery({
    queryKey: ['flux-grades-grouped', 'RECTANGULAR'],
    queryFn: () => api<{ grades: FluxGroup[] }>('/flux-grades/grouped?coreType=RECTANGULAR'),
  });

  // Add-item form toggle
  const [showAddForm, setShowAddForm]   = useState(false);
  const [addType, setAddType]           = useState<CoreType | ''>('');

  // Action dialog targets
  const [deleteTarget,  setDeleteTarget]  = useState<POItem | null>(null);
  const [restoreTarget, setRestoreTarget] = useState<POItem | null>(null);
  const [cancelTarget,  setCancelTarget]  = useState<POItem | null>(null);
  const [actionError,   setActionError]   = useState<string | null>(null);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['po-items'] });
    queryClient.invalidateQueries({ queryKey: ['po-items', 'by-po', poId] });
    queryClient.invalidateQueries({ queryKey: ['po-summary'] });
  };

  const addItem = useMutation({
    mutationFn: (item: POItemNew) =>
      api(`/po-orders/${poId}/items`, { method: 'POST', json: item }),
    onSuccess: () => {
      invalidate();
      setShowAddForm(false);
      setAddType('');
    },
    onError: (e) => setActionError(e instanceof ApiError ? e.message : 'Could not add item'),
  });

  const deleteItem = useMutation({
    mutationFn: (id: string) => api(`/po-orders/items/${id}`, { method: 'DELETE' }),
    onSuccess: () => { invalidate(); setDeleteTarget(null); },
    onError: (e) => { setDeleteTarget(null); setActionError(e instanceof ApiError ? e.message : 'Delete failed'); },
  });

  const restoreItem = useMutation({
    mutationFn: (id: string) => api(`/po-orders/items/${id}/restore`, { method: 'POST' }),
    onSuccess: () => { invalidate(); setRestoreTarget(null); },
    onError: (e) => { setRestoreTarget(null); setActionError(e instanceof ApiError ? e.message : 'Restore failed'); },
  });

  const cancelItem = useMutation({
    mutationFn: (id: string) => api(`/po-orders/items/${id}/cancel`, { method: 'POST' }),
    onSuccess: () => { invalidate(); setCancelTarget(null); },
    onError: (e) => { setCancelTarget(null); setActionError(e instanceof ApiError ? e.message : 'Cancel failed'); },
  });

  if (poLoading) {
    return (
      <div className="space-y-5">
        <div className="flex items-center gap-3">
          <Link to="/po/manage" className="btn-ghost text-slate-600"><ArrowLeft className="h-4 w-4" /> Back</Link>
        </div>
        <div className="card p-10 text-center text-slate-400"><Loader2 className="h-5 w-5 animate-spin mx-auto" /></div>
      </div>
    );
  }

  if (!po) {
    return (
      <div className="space-y-5">
        <div className="flex items-center gap-3">
          <Link to="/po/manage" className="btn-ghost text-slate-600"><ArrowLeft className="h-4 w-4" /> Back</Link>
        </div>
        <div className="card p-10 text-center text-slate-400">Sales order not found.</div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <Link to="/po/manage" className="btn-ghost text-slate-600">
          <ArrowLeft className="h-4 w-4" /> Back
        </Link>
        <h1 className="text-2xl font-bold tracking-tight">Edit Sales Order</h1>
      </div>

      {/* Header editor */}
      <SOHeaderPanel po={po} hasProduction={hasProduction} />

      {/* Items section */}
      <section className="card overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">
              Items <span className="font-normal text-slate-400">({items.length})</span>
            </h2>
            {hasProduction && (
              <div className="text-xs text-amber-700 mt-0.5">
                Production started — editing locked items via "Edit PO" will show a warning.
              </div>
            )}
          </div>
          <button
            onClick={() => { setShowAddForm((v) => !v); setAddType(''); }}
            className={cn('btn-primary text-sm', showAddForm && 'bg-slate-200 text-slate-800 border-slate-300 hover:bg-slate-300')}
          >
            <Plus className="h-4 w-4" />
            {showAddForm ? 'Cancel add' : 'Add item'}
          </button>
        </div>

        {itemsLoading ? (
          <div className="px-4 py-6 text-center text-slate-400 text-sm">
            <Loader2 className="h-4 w-4 animate-spin inline mr-1" /> Loading items…
          </div>
        ) : items.length === 0 ? (
          <div className="px-4 py-8 text-center text-slate-400 text-sm">
            No items yet. Add the first item below.
          </div>
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs tracking-wide text-slate-500">
                  <tr>
                    <th className="px-3 py-2 font-medium">Type</th>
                    <th className="px-3 py-2 font-medium">Grade</th>
                    <th className="px-3 py-2 font-medium">Material</th>
                    <th className="px-3 py-2 font-medium min-w-[180px]">Measure</th>
                    <th className="px-3 py-2 text-right font-medium w-16">Pcs</th>
                    <th className="px-3 py-2 text-right font-medium w-20">Produced</th>
                    <th className="px-3 py-2 text-right font-medium w-24">Dispatched</th>
                    <th className="px-3 py-2 text-center font-medium w-20">Status</th>
                    <th className="px-3 py-2 text-right font-medium w-36">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((it) => (
                    <tr key={it.id} className="border-t border-slate-100 hover:bg-slate-50/60">
                      <td className="px-3 py-2.5">
                        <span className={cn(
                          'rounded-full px-2 py-0.5 text-[10px] font-medium',
                          it.coreType === 'TOROIDAL' ? 'bg-amber-50 text-amber-700' : 'bg-rose-50 text-rose-700'
                        )}>
                          {it.coreType === 'TOROIDAL' ? 'Toro' : 'Rect'}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-slate-700">{it.grade}</td>
                      <td className="px-3 py-2.5 text-slate-600">{it.material}</td>
                      <td className="px-3 py-2.5 font-mono text-xs text-slate-700">{it.measure}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{it.pcs}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-slate-500">{it.pcsProduced}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-slate-500">{it.pcsDispatched}</td>
                      <td className="px-3 py-2.5 text-center">
                        {it.status === 'ACTIVE'
                          ? <CheckCircle2 className="h-4 w-4 text-green-600 inline" />
                          : <XCircle className="h-4 w-4 text-slate-400 inline" />}
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <div className="inline-flex items-center gap-1">
                          {it.status === 'ACTIVE' && (
                            <>
                              <Link
                                to={`/po/manage/${it.id}`}
                                className={cn(
                                  'btn-ghost text-xs',
                                  it.pcsProduced > 0
                                    ? 'text-slate-300 hover:bg-slate-50'
                                    : 'text-brand-700 hover:bg-brand-50'
                                )}
                                title={it.pcsProduced > 0 ? 'Locked — production started' : 'Edit item'}
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </Link>
                              <button
                                onClick={() => setCancelTarget(it)}
                                className="btn-ghost text-xs text-amber-600 hover:bg-amber-50"
                                title="Cancel item"
                                disabled={cancelItem.isPending}
                              >
                                <Ban className="h-3.5 w-3.5" />
                              </button>
                            </>
                          )}
                          {it.status === 'CANCELLED' && (
                            <button
                              onClick={() => setRestoreTarget(it)}
                              className="btn-ghost text-xs text-emerald-700 hover:bg-emerald-50"
                              title="Restore item"
                              disabled={restoreItem.isPending}
                            >
                              <RotateCcw className="h-3.5 w-3.5" />
                            </button>
                          )}
                          {it.pcsProduced === 0 && it.pcsDispatched === 0 && (
                            <button
                              onClick={() => setDeleteTarget(it)}
                              className="btn-ghost text-xs text-red-600 hover:bg-red-50"
                              title="Delete permanently"
                              disabled={deleteItem.isPending}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            <div className="md:hidden divide-y divide-slate-100">
              {items.map((it) => (
                <div key={it.id} className="px-3 py-2.5 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className={cn(
                          'rounded-full px-1.5 py-0.5 text-[10px] font-medium',
                          it.coreType === 'TOROIDAL' ? 'bg-amber-50 text-amber-700' : 'bg-rose-50 text-rose-700'
                        )}>
                          {it.coreType === 'TOROIDAL' ? 'Toro' : 'Rect'}
                        </span>
                        <span className="text-xs font-medium text-slate-700">{it.grade}</span>
                        <span className="text-xs text-slate-500">{it.material}</span>
                      </div>
                      <div className="font-mono text-xs text-slate-700 mt-0.5 truncate">{it.measure}</div>
                      <div className="text-xs text-slate-500 mt-0.5">
                        Ordered: {it.pcs} · Produced: {it.pcsProduced} · Dispatched: {it.pcsDispatched}
                      </div>
                    </div>
                    <div className="shrink-0">
                      {it.status === 'ACTIVE'
                        ? <CheckCircle2 className="h-4 w-4 text-green-600" />
                        : <XCircle className="h-4 w-4 text-slate-400" />}
                    </div>
                  </div>
                  <div className="flex gap-1.5">
                    {it.status === 'ACTIVE' && (
                      <>
                        <Link
                          to={`/po/manage/${it.id}`}
                          className={cn(
                            'btn-ghost text-xs border flex-1 justify-center',
                            it.pcsProduced > 0 ? 'text-slate-300 border-slate-200' : 'text-brand-700 border-slate-300'
                          )}
                        >
                          <Pencil className="h-3.5 w-3.5" /> Edit
                        </Link>
                        <button
                          onClick={() => setCancelTarget(it)}
                          className="btn-ghost text-xs border border-amber-200 text-amber-700 flex-1 justify-center hover:bg-amber-50"
                          disabled={cancelItem.isPending}
                        >
                          <Ban className="h-3.5 w-3.5" /> Cancel
                        </button>
                      </>
                    )}
                    {it.status === 'CANCELLED' && (
                      <button
                        onClick={() => setRestoreTarget(it)}
                        className="btn-ghost text-xs border border-emerald-200 text-emerald-700 flex-1 justify-center hover:bg-emerald-50"
                        disabled={restoreItem.isPending}
                      >
                        <RotateCcw className="h-3.5 w-3.5" /> Restore
                      </button>
                    )}
                    {it.pcsProduced === 0 && it.pcsDispatched === 0 && (
                      <button
                        onClick={() => setDeleteTarget(it)}
                        className="btn-ghost text-xs border border-red-200 text-red-600 flex-1 justify-center hover:bg-red-50"
                        disabled={deleteItem.isPending}
                      >
                        <Trash2 className="h-3.5 w-3.5" /> Delete
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </section>

      {/* Add item form */}
      {showAddForm && (
        <section className="card p-4 space-y-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="text-sm font-semibold text-slate-900">Add new item</h2>
            <div className="inline-flex rounded-lg bg-slate-100 p-0.5 text-sm self-start">
              <button
                type="button"
                onClick={() => setAddType('TOROIDAL')}
                className={cn(
                  'rounded-md px-3 py-1.5 font-medium transition',
                  addType === 'TOROIDAL' ? 'bg-white text-amber-700 shadow-sm' : 'text-slate-600 hover:text-slate-900'
                )}
              >
                Toroidal
              </button>
              <button
                type="button"
                onClick={() => setAddType('RECTANGULAR')}
                className={cn(
                  'rounded-md px-3 py-1.5 font-medium transition',
                  addType === 'RECTANGULAR' ? 'bg-white text-rose-700 shadow-sm' : 'text-slate-600 hover:text-slate-900'
                )}
              >
                Rectangular
              </button>
            </div>
          </div>

          {!addType && (
            <div className="rounded-lg border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500">
              Pick a core type above to add an item.
            </div>
          )}
          {addType === 'TOROIDAL' && (
            <ToroidalForm
              grades={gradesResp?.grades ?? []}
              fluxGrades={fluxTor?.grades ?? []}
              onAdd={(item) => addItem.mutate(item)}
            />
          )}
          {addType === 'RECTANGULAR' && (
            <RectangularForm
              grades={gradesResp?.grades ?? []}
              fluxGrades={fluxRect?.grades ?? []}
              onAdd={(item) => addItem.mutate(item)}
            />
          )}
          {addItem.isPending && (
            <div className="text-center text-sm text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin inline mr-1" /> Saving item…
            </div>
          )}
          {addItem.isError && (
            <div className="text-sm text-red-700 rounded-lg border border-red-200 bg-red-50 px-3 py-2">
              {addItem.error instanceof ApiError ? addItem.error.message : 'Failed to add item. Please try again.'}
            </div>
          )}
        </section>
      )}

      {/* Delete confirmation */}
      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete item permanently?"
        tone="danger"
        confirmLabel="Delete"
        cancelLabel="Keep"
        loading={deleteItem.isPending}
        onConfirm={() => deleteTarget && deleteItem.mutate(deleteTarget.id)}
        onCancel={() => setDeleteTarget(null)}
        message={deleteTarget ? (
          <div className="space-y-2 text-sm">
            <div className="rounded-lg bg-slate-50 px-3 py-2 text-xs">
              <div className="font-semibold text-slate-900">{deleteTarget.grade} · {deleteTarget.material}</div>
              <div className="font-mono text-slate-700 mt-0.5">{deleteTarget.measure}</div>
              <div className="text-slate-600 mt-0.5">{deleteTarget.pcs} pcs</div>
            </div>
            <div className="text-xs text-red-700 rounded-md border border-red-200 bg-red-50 px-3 py-2">
              This item will be permanently removed. This cannot be undone.
            </div>
          </div>
        ) : null}
      />

      {/* Restore confirmation */}
      <ConfirmDialog
        open={!!restoreTarget}
        title="Restore cancelled item?"
        tone="warning"
        confirmLabel="Restore"
        cancelLabel="Cancel"
        loading={restoreItem.isPending}
        onConfirm={() => restoreTarget && restoreItem.mutate(restoreTarget.id)}
        onCancel={() => setRestoreTarget(null)}
        message={restoreTarget ? (
          <div className="rounded-lg bg-slate-50 px-3 py-2 text-sm">
            <div className="font-semibold text-slate-900">{restoreTarget.grade} · {restoreTarget.material}</div>
            <div className="font-mono text-xs text-slate-700 mt-0.5">{restoreTarget.measure}</div>
          </div>
        ) : null}
      />

      {/* Cancel confirmation */}
      <ConfirmDialog
        open={!!cancelTarget}
        title="Cancel item?"
        tone="warning"
        confirmLabel="Cancel item"
        cancelLabel="Keep it"
        loading={cancelItem.isPending}
        onConfirm={() => cancelTarget && cancelItem.mutate(cancelTarget.id)}
        onCancel={() => setCancelTarget(null)}
        message={cancelTarget ? (
          <div className="space-y-2 text-sm">
            <div className="rounded-lg bg-slate-50 px-3 py-2 text-xs">
              <div className="font-semibold text-slate-900">{cancelTarget.grade} · {cancelTarget.material}</div>
              <div className="font-mono text-slate-700 mt-0.5">{cancelTarget.measure}</div>
            </div>
            <div className="text-xs text-amber-800 rounded-md border border-amber-200 bg-amber-50 px-3 py-2">
              Produced: {cancelTarget.pcsProduced} pcs · Dispatched: {cancelTarget.pcsDispatched} pcs.
              {cancelTarget.pcsProduced > 0
                ? ' Order will be reduced to produced qty — production records stay intact.'
                : ' Item will be marked cancelled.'}
            </div>
          </div>
        ) : null}
      />

      {/* General error */}
      <ConfirmDialog
        open={!!actionError}
        title="Action failed"
        tone="danger"
        alertOnly
        confirmLabel="OK"
        message={actionError}
        onConfirm={() => setActionError(null)}
        onCancel={() => setActionError(null)}
      />
    </div>
  );
};

/* ---------- SO Header Panel ---------- */
const SOHeaderPanel = ({
  po,
  hasProduction,
}: { po: POHeader; hasProduction: boolean }) => {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [poNumber,     setPoNumber]     = useState(po.poNumber);
  const [customerId,   setCustomerId]   = useState(po.customerId);
  const [orderDate,    setOrderDate]    = useState(po.orderDate.slice(0, 10));
  const [deliveryDate, setDeliveryDate] = useState(po.deliveryDate.slice(0, 10));
  const [notes,        setNotes]        = useState(po.notes ?? '');

  // Sync if po prop changes (after save)
  useEffect(() => {
    setPoNumber(po.poNumber);
    setCustomerId(po.customerId);
    setOrderDate(po.orderDate.slice(0, 10));
    setDeliveryDate(po.deliveryDate.slice(0, 10));
    setNotes(po.notes ?? '');
  }, [po.poNumber, po.customerId, po.orderDate, po.deliveryDate, po.notes]);

  const { data: customersResp } = useQuery({
    queryKey: ['customers-dropdown'],
    queryFn: () => api<{ items: Customer[] }>('/customers?pageSize=500'),
    enabled: open,
  });

  const save = useMutation({
    mutationFn: () => api(`/po-orders/${po.id}`, {
      method: 'PATCH',
      json: {
        poNumber:     poNumber.trim(),
        customerId,
        orderDate:    new Date(orderDate).toISOString(),
        deliveryDate: new Date(deliveryDate).toISOString(),
        notes:        notes.trim() || null,
      },
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['po-header', po.id] });
      queryClient.invalidateQueries({ queryKey: ['po-items'] });
      queryClient.invalidateQueries({ queryKey: ['po-summary'] });
      setOpen(false);
      setError(null);
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Save failed'),
  });

  return (
    <section className="card p-4 space-y-3">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
        <span className="flex items-center gap-1.5 text-slate-500">
          <Hash className="h-3.5 w-3.5" /> SO
        </span>
        <span className="font-mono font-semibold text-slate-900">{po.poNumber}</span>
        <span className="flex items-center gap-1.5 text-slate-500">
          <User2 className="h-3.5 w-3.5" /> Customer
        </span>
        <span className="text-slate-900">{(po as any).customer?.name ?? '—'}</span>
        <span className="text-xs text-slate-400">{fmtDate(po.orderDate)} → {fmtDate(po.deliveryDate)}</span>
        {hasProduction ? (
          <span className="ml-auto text-xs text-amber-700 font-medium rounded-md border border-amber-200 bg-amber-50 px-2 py-0.5">
            Header locked — production started
          </span>
        ) : (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="ml-auto text-xs font-medium text-brand-700 hover:text-brand-800 inline-flex items-center gap-1"
          >
            {open ? 'Close' : 'Edit header'}
          </button>
        )}
      </div>

      {open && !hasProduction && (
        <div className="border-t border-slate-200 pt-3 space-y-3">
          {!customersResp && (
            <div className="text-xs text-slate-400">Loading customers…</div>
          )}
          {customersResp && (
            <>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3">
                <HField label="SO #">
                  <input className="input" value={poNumber} onChange={(e) => setPoNumber(e.target.value)} placeholder="SO-2026-001" />
                </HField>
                <HField label="Customer">
                  <SearchableSelect
                    value={customerId}
                    onChange={setCustomerId}
                    options={(customersResp.items ?? []).map((c) => ({ value: c.id, label: c.name }))}
                    placeholder="Select customer…"
                  />
                </HField>
                <HField label="Order Date">
                  <input className="input" type="date" value={orderDate} onChange={(e) => setOrderDate(e.target.value)} />
                </HField>
                <HField label="Delivery Date">
                  <input className="input" type="date" value={deliveryDate} onChange={(e) => setDeliveryDate(e.target.value)} />
                </HField>
                <div className="sm:col-span-2 md:col-span-3">
                  <HField label="Notes">
                    <textarea
                      className="input min-h-[56px]"
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      placeholder="Optional remarks…"
                    />
                  </HField>
                </div>
              </div>
              {error && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
              )}
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => { setOpen(false); setError(null); }}
                  className="btn-ghost"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => save.mutate()}
                  disabled={save.isPending || !poNumber.trim() || !customerId}
                  className="btn-primary"
                >
                  {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  Save header
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
};

const HField = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <label className="block">
    <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</span>
    {children}
  </label>
);
