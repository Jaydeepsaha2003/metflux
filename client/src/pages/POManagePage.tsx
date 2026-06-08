// Modify Sales Order — flat list of every line item in the active company.
// Search, filter by status, edit one item, cancel the unprocessed remainder.
// Cancel logic on the backend: if no production/dispatch yet → full cancel;
// if partial → reduces ordered pcs to whatever's already been built.
import { Fragment, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Search, Pencil, Ban, FileText, CheckCircle2, XCircle, RotateCcw, Trash2,
  ChevronDown, ChevronRight,
} from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Pagination } from '@/components/Pagination';

type Status = 'ACTIVE' | 'CANCELLED';

type Item = {
  id: string;
  poOrderId: string;
  poNumber: string;
  customerName: string;
  orderDate: string;
  deliveryDate: string;
  coreType: 'TOROIDAL' | 'RECTANGULAR';
  grade: string;
  material: string;
  measure: string;
  weightPerPc: number;
  pcs: number;
  totalWeight: number;
  pcsProduced: number | null;
  pcsDispatched: number | null;
  status: Status;
};

type ListResp = { items: Item[]; total: number; page: number; pageSize: number };

type PoGroup = {
  poOrderId: string;
  poNumber: string;
  customerName: string;
  orderDate: string;
  items: Item[];
  totalPcs: number;
  totalWeight: number;
};

const groupByPo = (items: Item[]): PoGroup[] => {
  const map = new Map<string, PoGroup>();
  for (const it of items) {
    if (!map.has(it.poOrderId)) {
      map.set(it.poOrderId, {
        poOrderId: it.poOrderId,
        poNumber: it.poNumber,
        customerName: it.customerName,
        orderDate: it.orderDate,
        items: [],
        totalPcs: 0,
        totalWeight: 0,
      });
    }
    const g = map.get(it.poOrderId)!;
    g.items.push(it);
    g.totalPcs += it.pcs;
    g.totalWeight += it.totalWeight;
  }
  return [...map.values()];
};

const formatDate = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
};

const PAGE_SIZE = 20;

export const POManagePage = () => {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<'ACTIVE' | 'CANCELLED' | 'ALL'>('ACTIVE');
  const [page, setPage] = useState(1);
  useEffect(() => { setPage(1); }, [search, status]);
  const queryClient = useQueryClient();

  const [cancelTarget,  setCancelTarget]  = useState<Item | null>(null);
  const [deleteTarget,  setDeleteTarget]  = useState<Item | null>(null);
  const [restoreTarget, setRestoreTarget] = useState<Item | null>(null);
  const [errorMsg, setErrorMsg]           = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['po-items', search, status, page],
    queryFn: () =>
      api<ListResp>(`/po-orders/items?search=${encodeURIComponent(search)}&status=${status}&page=${page}&pageSize=${PAGE_SIZE}`),
  });

  const groups = useMemo(() => groupByPo(data?.items ?? []), [data]);
  const [expandedPos, setExpandedPos] = useState<Set<string>>(new Set());
  const togglePoExpand = (poOrderId: string) =>
    setExpandedPos((prev) => {
      const next = new Set(prev);
      if (next.has(poOrderId)) next.delete(poOrderId); else next.add(poOrderId);
      return next;
    });

  const cancel = useMutation({
    mutationFn: (id: string) => api(`/po-orders/items/${id}/cancel`, { method: 'POST' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['po-items'] });
      setCancelTarget(null);
    },
    onError: (e) => {
      setCancelTarget(null);
      setErrorMsg(e instanceof ApiError ? e.message : 'Could not cancel the item.');
    },
  });

  const deleteItem = useMutation({
    mutationFn: (id: string) => api(`/po-orders/items/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['po-items'] });
      setDeleteTarget(null);
    },
    onError: (e) => {
      setDeleteTarget(null);
      setErrorMsg(e instanceof ApiError ? e.message : 'Could not delete the item.');
    },
  });

  const restoreItem = useMutation({
    mutationFn: (id: string) => api(`/po-orders/items/${id}/restore`, { method: 'POST' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['po-items'] });
      setRestoreTarget(null);
    },
    onError: (e) => {
      setRestoreTarget(null);
      setErrorMsg(e instanceof ApiError ? e.message : 'Could not restore the item.');
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Modify Sales Order</h1>
        <Link to="/po/new" className="btn-primary w-full sm:w-auto">
          <FileText className="h-4 w-4" /> New Sales Order
        </Link>
      </div>

      {/* Filters */}
      <div className="card p-3 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            className="input pl-9"
            placeholder="Search SO #, customer, measure, grade or material"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="inline-flex rounded-lg bg-slate-100 p-0.5 text-sm">
          {(['ACTIVE', 'CANCELLED', 'ALL'] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setStatus(s)}
              className={cn(
                'rounded-md px-3 py-1.5 font-medium transition',
                status === s ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
              )}
            >
              {s === 'ACTIVE' ? 'Active' : s === 'CANCELLED' ? 'Cancelled' : 'All'}
            </button>
          ))}
        </div>
        <div className="text-xs text-slate-500 ml-auto">
          {data ? `${data.total} item${data.total === 1 ? '' : 's'}` : ''}
        </div>
      </div>

      {/* Loading / empty states */}
      {isLoading && (
        <div className="card p-10 text-center text-slate-400">Loading…</div>
      )}
      {!isLoading && data?.items.length === 0 && (
        <div className="card p-10 text-center text-slate-400">
          No sales-order items found.{' '}
          <Link to="/po/new" className="text-brand-700 hover:text-brand-800 font-medium">
            Create the first one →
          </Link>
        </div>
      )}

      {/* Desktop table — md+ */}
      {!isLoading && data && data.items.length > 0 && (
        <div className="card overflow-hidden hidden md:block">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2.5 font-medium whitespace-nowrap">SO #</th>
                  <th className="px-3 py-2.5 font-medium whitespace-nowrap min-w-[160px]">Customer</th>
                  <th className="px-3 py-2.5 font-medium whitespace-nowrap">Order</th>
                  <th className="px-3 py-2.5 font-medium whitespace-nowrap">Type</th>
                  <th className="px-3 py-2.5 font-medium whitespace-nowrap">Grade</th>
                  <th className="px-3 py-2.5 font-medium whitespace-nowrap">Material</th>
                  <th className="px-3 py-2.5 font-medium whitespace-nowrap min-w-[200px]">Measure</th>
                  <th className="px-3 py-2.5 font-medium text-right whitespace-nowrap">Pcs</th>
                  <th className="px-3 py-2.5 font-medium text-right whitespace-nowrap">Wt/pc</th>
                  <th className="px-3 py-2.5 font-medium text-right whitespace-nowrap">Total Wt</th>
                  <th className="px-3 py-2.5 font-medium text-center whitespace-nowrap w-16">Status</th>
                  <th className="w-24 px-3 py-2.5"></th>
                </tr>
              </thead>
              <tbody>
                {groups.map((group) => {
                  const isOpen = expandedPos.has(group.poOrderId);
                  return (
                    <Fragment key={group.poOrderId}>
                      <tr
                        className={cn(
                          'border-t border-slate-200 cursor-pointer select-none',
                          isOpen ? 'bg-brand-50/40' : 'bg-slate-50/60 hover:bg-slate-50'
                        )}
                        onClick={() => togglePoExpand(group.poOrderId)}
                      >
                        <td className="px-3 py-2.5 font-semibold text-slate-900 whitespace-nowrap">
                          <span className="inline-flex items-center gap-1.5">
                            {isOpen
                              ? <ChevronDown className="h-3.5 w-3.5 text-brand-600 shrink-0" />
                              : <ChevronRight className="h-3.5 w-3.5 text-slate-400 shrink-0" />}
                            {group.poNumber}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-slate-900 font-medium whitespace-nowrap">{group.customerName}</td>
                        <td className="px-3 py-2.5 text-slate-600 whitespace-nowrap">{formatDate(group.orderDate)}</td>
                        <td className="px-3 py-2.5 text-xs text-slate-500 whitespace-nowrap">{group.items.length} item{group.items.length !== 1 ? 's' : ''}</td>
                        <td className="px-3 py-2.5 whitespace-nowrap" />
                        <td className="px-3 py-2.5 whitespace-nowrap" />
                        <td className="px-3 py-2.5 whitespace-nowrap" />
                        <td className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap font-semibold">{group.totalPcs}</td>
                        <td className="px-3 py-2.5 whitespace-nowrap" />
                        <td className="px-3 py-2.5 text-right font-mono font-semibold tabular-nums whitespace-nowrap">{group.totalWeight.toFixed(3)}</td>
                        <td className="px-3 py-2.5 whitespace-nowrap" />
                        <td className="px-3 py-2.5 text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                          <Link
                            to={`/po/new/${group.poOrderId}`}
                            className="btn-ghost text-brand-700 hover:bg-brand-50 text-xs"
                            title="Edit whole PO (add / remove / modify items)"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                            <span className="hidden lg:inline ml-1">Edit PO</span>
                          </Link>
                        </td>
                      </tr>
                      {isOpen && group.items.map((it) => (
                        <tr key={it.id} className="border-t border-slate-100 hover:bg-slate-50/60">
                          <td className="pl-8 pr-3 py-2.5 text-xs text-slate-400 whitespace-nowrap">{it.poNumber}</td>
                          <td className="px-3 py-2.5 text-slate-900 font-medium whitespace-nowrap">{it.customerName}</td>
                          <td className="px-3 py-2.5 text-slate-600 whitespace-nowrap">{formatDate(it.orderDate)}</td>
                          <td className="px-3 py-2.5 whitespace-nowrap">
                            <span className={cn(
                              'rounded-full px-2 py-0.5 text-xs font-medium',
                              it.coreType === 'TOROIDAL' ? 'bg-amber-50 text-amber-700' : 'bg-rose-50 text-rose-700'
                            )}>
                              {it.coreType === 'TOROIDAL' ? 'Toro' : 'Rect'}
                            </span>
                          </td>
                          <td className="px-3 py-2.5 text-slate-700 font-medium whitespace-nowrap">{it.grade}</td>
                          <td className="px-3 py-2.5 text-slate-700 whitespace-nowrap">{it.material}</td>
                          <td className="px-3 py-2.5 font-mono text-slate-700 whitespace-nowrap">{it.measure}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap">{it.pcs}</td>
                          <td className="px-3 py-2.5 text-right font-mono tabular-nums whitespace-nowrap">{it.weightPerPc.toFixed(3)}</td>
                          <td className="px-3 py-2.5 text-right font-mono font-semibold tabular-nums whitespace-nowrap">{it.totalWeight.toFixed(3)}</td>
                          <td className="px-3 py-2.5 text-center whitespace-nowrap">
                            {it.status === 'ACTIVE'
                              ? <CheckCircle2 className="h-5 w-5 text-green-600 inline" aria-label="Active" />
                              : <XCircle className="h-5 w-5 text-slate-400 inline" aria-label="Cancelled" />}
                          </td>
                          <td className="px-3 py-2.5 text-right whitespace-nowrap">
                            <div className="inline-flex items-center gap-1">
                              {it.status === 'ACTIVE' && (
                                <>
                                  <Link
                                    to={`/po/manage/${it.id}`}
                                    className={cn(
                                      'btn-ghost',
                                      (it.pcsProduced ?? 0) > 0
                                        ? 'text-slate-300 hover:bg-slate-50'
                                        : 'text-brand-700 hover:bg-brand-50'
                                    )}
                                    title={(it.pcsProduced ?? 0) > 0
                                      ? `Locked — ${it.pcsProduced} pcs produced. Use Cancel to shrink remaining qty.`
                                      : 'Edit'}
                                  >
                                    <Pencil className="h-4 w-4" />
                                  </Link>
                                  <button
                                    onClick={() => setCancelTarget(it)}
                                    className="btn-ghost text-amber-600 hover:bg-amber-50"
                                    title="Cancel item"
                                    disabled={cancel.isPending}
                                  >
                                    <Ban className="h-4 w-4" />
                                  </button>
                                </>
                              )}
                              {it.status === 'CANCELLED' && (
                                <button
                                  onClick={() => setRestoreTarget(it)}
                                  className="btn-ghost text-emerald-700 hover:bg-emerald-50"
                                  title="Restore cancelled item"
                                  disabled={restoreItem.isPending}
                                >
                                  <RotateCcw className="h-4 w-4" />
                                </button>
                              )}
                              {(it.pcsProduced ?? 0) === 0 && (it.pcsDispatched ?? 0) === 0 && (
                                <button
                                  onClick={() => setDeleteTarget(it)}
                                  className="btn-ghost text-red-600 hover:bg-red-50"
                                  title="Delete permanently"
                                  disabled={deleteItem.isPending}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          {data && (
            <Pagination page={page} pageSize={PAGE_SIZE} total={data.total} onPageChange={setPage} />
          )}
        </div>
      )}

      {/* Mobile cards — < md */}
      {!isLoading && data && data.items.length > 0 && (
        <div className="space-y-3 md:hidden">
          {groups.map((group) => {
            const isOpen = expandedPos.has(group.poOrderId);
            return (
              <div key={group.poOrderId} className="card overflow-hidden">
                <button
                  type="button"
                  onClick={() => togglePoExpand(group.poOrderId)}
                  className="w-full px-3 py-3 text-left"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-semibold text-slate-800">{group.poNumber}</span>
                        <span className="text-xs font-medium text-slate-900 truncate">{group.customerName}</span>
                      </div>
                      <div className="mt-0.5 text-[11px] text-slate-500">
                        {formatDate(group.orderDate)} · {group.items.length} item{group.items.length !== 1 ? 's' : ''}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-xs font-mono tabular-nums font-semibold text-slate-700">{group.totalWeight.toFixed(3)} kg</span>
                      {isOpen
                        ? <ChevronDown className="h-4 w-4 text-brand-600" />
                        : <ChevronRight className="h-4 w-4 text-slate-400" />}
                    </div>
                  </div>
                </button>

                {isOpen && (
                  <div className="border-t border-slate-200">
                    <div className="flex items-center justify-between px-3 py-2 bg-slate-50">
                      <span className="text-xs text-slate-500 font-medium">{group.totalPcs} pcs · {group.totalWeight.toFixed(3)} kg</span>
                      <Link
                        to={`/po/new/${group.poOrderId}`}
                        className="btn-ghost text-xs text-brand-700 hover:bg-brand-50"
                        title="Edit whole PO"
                      >
                        <Pencil className="h-3.5 w-3.5" /> Edit PO
                      </Link>
                    </div>
                    {group.items.map((it) => (
                      <div key={it.id} className="border-t border-slate-100">
                        <div className="px-3 py-3 space-y-2">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className={cn(
                                  'rounded-full px-1.5 py-0.5 text-[10px] font-medium',
                                  it.coreType === 'TOROIDAL' ? 'bg-amber-50 text-amber-700' : 'bg-rose-50 text-rose-700'
                                )}>
                                  {it.coreType === 'TOROIDAL' ? 'Toro' : 'Rect'}
                                </span>
                                <span className="text-xs text-slate-700 font-medium">{it.grade}</span>
                              </div>
                              <div className="mt-0.5 font-mono text-xs text-slate-600 truncate">{it.measure}</div>
                              <div className="mt-0.5 text-[11px] text-slate-500">{it.material}</div>
                            </div>
                            <div className="shrink-0">
                              {it.status === 'ACTIVE'
                                ? <CheckCircle2 className="h-5 w-5 text-green-600" aria-label="Active" />
                                : <XCircle className="h-5 w-5 text-slate-400" aria-label="Cancelled" />}
                            </div>
                          </div>
                          <div className="grid grid-cols-3 gap-2">
                            <Stat label="Pcs"      value={String(it.pcs)} />
                            <Stat label="Wt / pc"  value={it.weightPerPc.toFixed(3)} />
                            <Stat label="Total Wt" value={it.totalWeight.toFixed(3)} accent />
                          </div>
                          {it.status === 'ACTIVE' && (
                            <div className="flex justify-end gap-2 border-t border-slate-100 pt-2">
                              <Link
                                to={`/po/manage/${it.id}`}
                                className="btn-ghost border border-slate-300 text-sm flex-1 justify-center"
                              >
                                <Pencil className="h-4 w-4" /> Edit
                              </Link>
                              <button
                                onClick={() => setCancelTarget(it)}
                                className="btn-ghost border border-amber-200 text-amber-700 text-sm flex-1 justify-center hover:bg-amber-50"
                                disabled={cancel.isPending}
                              >
                                <Ban className="h-4 w-4" /> Cancel
                              </button>
                            </div>
                          )}
                          {it.status === 'CANCELLED' && (
                            <div className="flex justify-end gap-2 border-t border-slate-100 pt-2">
                              <button
                                onClick={() => setRestoreTarget(it)}
                                className="btn-ghost border border-emerald-200 text-emerald-700 text-sm flex-1 justify-center hover:bg-emerald-50"
                                disabled={restoreItem.isPending}
                              >
                                <RotateCcw className="h-4 w-4" /> Restore
                              </button>
                              {(it.pcsProduced ?? 0) === 0 && (it.pcsDispatched ?? 0) === 0 && (
                                <button
                                  onClick={() => setDeleteTarget(it)}
                                  className="btn-ghost border border-red-200 text-red-600 text-sm flex-1 justify-center hover:bg-red-50"
                                  disabled={deleteItem.isPending}
                                >
                                  <Trash2 className="h-4 w-4" /> Delete
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          {data && (
            <div className="card overflow-hidden">
              <Pagination page={page} pageSize={PAGE_SIZE} total={data.total} onPageChange={setPage} />
            </div>
          )}
        </div>
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
              <div className="font-semibold text-slate-900">{deleteTarget.poNumber}</div>
              <div className="text-slate-600">{deleteTarget.grade} · {deleteTarget.material}</div>
              <div className="font-mono text-slate-700">{deleteTarget.measure}</div>
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
            <div className="font-semibold text-slate-900">{restoreTarget.poNumber}</div>
            <div className="text-slate-600 text-xs">{restoreTarget.grade} · {restoreTarget.material}</div>
            <div className="font-mono text-xs text-slate-700">{restoreTarget.measure}</div>
          </div>
        ) : null}
      />

      {/* Cancel confirmation modal */}
      <ConfirmDialog
        open={!!cancelTarget}
        title="Cancel sales-order item?"
        tone={cancelTarget && (cancelTarget.pcsProduced ?? 0) === 0 && (cancelTarget.pcsDispatched ?? 0) === 0
          ? 'danger'
          : 'warning'}
        confirmLabel="Cancel item"
        cancelLabel="Keep it"
        loading={cancel.isPending}
        onConfirm={() => cancelTarget && cancel.mutate(cancelTarget.id)}
        onCancel={() => setCancelTarget(null)}
        message={cancelTarget ? <CancelBreakdown item={cancelTarget} /> : null}
      />

      {/* Error alert */}
      <ConfirmDialog
        open={!!errorMsg}
        title="Couldn't cancel"
        tone="danger"
        alertOnly
        confirmLabel="OK"
        message={errorMsg}
        onConfirm={() => setErrorMsg(null)}
        onCancel={() => setErrorMsg(null)}
      />
    </div>
  );
};

/* ---------- mini stat tile (used by mobile card) ---------- */
const Stat = ({ label, value, accent }: { label: string; value: string; accent?: boolean }) => (
  <div className="rounded-md bg-slate-50 px-2 py-1.5 text-center">
    <div className="text-[10px] font-medium text-slate-500">{label}</div>
    <div className={cn(
      'text-sm font-mono tabular-nums',
      accent ? 'font-bold text-slate-900' : 'font-semibold text-slate-700'
    )}>{value}</div>
  </div>
);

/* ---------- breakdown panel inside the cancel modal ---------- */
const CancelBreakdown = ({ item }: { item: Item }) => {
  const produced   = item.pcsProduced   ?? 0;
  const dispatched = item.pcsDispatched ?? 0;
  const processed  = Math.max(produced, dispatched);
  const remaining  = Math.max(item.pcs - processed, 0);
  const fullCancel = processed === 0;

  return (
    <div className="space-y-3">
      <div className="rounded-lg bg-slate-50 px-3 py-2 text-xs">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
          <span className="text-slate-500">SO</span>
          <span className="font-medium text-slate-900">{item.poNumber}</span>
          <span className="text-slate-300">·</span>
          <span className="text-slate-700">{item.customerName}</span>
        </div>
        <div className="mt-1 text-slate-600">
          {item.grade} · {item.material} · <span className="font-mono">{item.measure}</span>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-2 text-center">
        <Tile label="Ordered"    value={item.pcs}   />
        <Tile label="Produced"   value={produced}   />
        <Tile label="Dispatched" value={dispatched} />
        <Tile label="Remaining"  value={remaining} accent={remaining > 0 ? 'warning' : 'muted'} />
      </div>

      {remaining === 0 ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          Everything is already produced or dispatched — there's nothing left to cancel.
        </div>
      ) : fullCancel ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Nothing has been built yet. The item will be marked <strong>Cancelled</strong> and won't appear in production / dispatch lists anymore.
        </div>
      ) : (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Only the unprocessed <strong>{remaining} pcs</strong> can be cancelled. The order will be reduced from <strong>{item.pcs}</strong> to <strong>{processed} pcs</strong>; production / dispatch records stay intact.
        </div>
      )}
    </div>
  );
};

const Tile = ({ label, value, accent }: {
  label: string; value: number; accent?: 'warning' | 'muted';
}) => (
  <div className={cn(
    'rounded-md px-2 py-1.5',
    accent === 'warning' ? 'bg-amber-50' : 'bg-slate-50'
  )}>
    <div className={cn(
      'text-[10px] font-medium tracking-wide',
      accent === 'warning' ? 'text-amber-700' : 'text-slate-500'
    )}>
      {label}
    </div>
    <div className={cn(
      'text-sm font-bold tabular-nums',
      accent === 'warning' ? 'text-amber-900' : accent === 'muted' ? 'text-slate-400' : 'text-slate-900'
    )}>
      {value}
    </div>
  </div>
);
