// Sales Order Summary — items grouped by PO with expand/collapse.
// Each PO row shows aggregate quantities; expanding reveals the individual
// items. "Edit PO" opens the full PO editor; "Edit item" opens the single
// item editor. Header tally is server-side across the full filtered dataset.
import { Fragment, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Search, Loader2, BarChart3, Eye, EyeOff, FileText, Activity,
  Download, ChevronDown, ChevronRight, Pencil, Trash2, RotateCcw,
} from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { Pagination } from '@/components/Pagination';
import { downloadXlsx, todayStamp } from '@/lib/excel';
import { useHideCustomerNames } from '@/store/auth';
import { ConfirmDialog } from '@/components/ConfirmDialog';

type SummaryItem = {
  id: string;
  poOrderId: string;
  poNumber: string;
  orderDate: string;
  deliveryDate: string;
  customerName: string;
  customerCode: string | null;
  coreType: 'TOROIDAL' | 'RECTANGULAR';
  grade: string;
  material: string;
  measure: string;
  pcsOrdered: number;
  pcsProduced: number;
  pcsOverproduced: number;
  pcsDispatched: number;
  pcsPending: number;
  weightPerPc: number;
  totalWeight: number;
  turns:       number | null;
  flux:        number | null;
  ateCm:       number | null;
  testVoltage: number | null;
  testCurrent: number | null;
  status: 'ACTIVE' | 'CANCELLED';
};

type Aggregates = {
  pcsOrdered: number;
  pcsProduced: number;
  pcsOverproduced: number;
  pcsDispatched: number;
  pcsPending: number;
};

type Status = 'ACTIVE' | 'CANCELLED' | 'ALL';

const fmtDate = (iso: string | null | undefined) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? String(iso)
    : d.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
};

const coreBadge: Record<SummaryItem['coreType'], string> = {
  TOROIDAL:    'bg-amber-50 text-amber-700 border border-amber-200',
  RECTANGULAR: 'bg-rose-50 text-rose-700 border border-rose-200',
};

const PAGE_SIZE = 20;

/* Group flat items array by poOrderId */
type PoGroup = {
  poOrderId: string;
  poNumber: string;
  orderDate: string;
  customerName: string;
  customerCode: string | null;
  items: SummaryItem[];
  totalOrdered: number;
  totalProduced: number;
  totalOverproduced: number;
  totalDispatched: number;
  totalPending: number;
};

const groupByPo = (items: SummaryItem[]): PoGroup[] => {
  const map = new Map<string, PoGroup>();
  for (const it of items) {
    if (!map.has(it.poOrderId)) {
      map.set(it.poOrderId, {
        poOrderId: it.poOrderId,
        poNumber: it.poNumber,
        orderDate: it.orderDate,
        customerName: it.customerName,
        customerCode: it.customerCode,
        items: [],
        totalOrdered: 0, totalProduced: 0, totalOverproduced: 0, totalDispatched: 0, totalPending: 0,
      });
    }
    const g = map.get(it.poOrderId)!;
    g.items.push(it);
    g.totalOrdered      += it.pcsOrdered;
    g.totalProduced     += it.pcsProduced;
    g.totalOverproduced += it.pcsOverproduced;
    g.totalDispatched   += it.pcsDispatched;
    g.totalPending      += it.pcsPending;
  }
  return [...map.values()];
};

export const SOSummaryPage = () => {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<Status>('ACTIVE');
  const hideNames = useHideCustomerNames();
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set()); // item test panels
  const [expandedPos, setExpandedPos] = useState<Set<string>>(new Set());     // PO groups
  const [page, setPage] = useState(1);
  const [deleteTarget, setDeleteTarget] = useState<SummaryItem | null>(null);
  const [restoreTarget, setRestoreTarget] = useState<SummaryItem | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  useEffect(() => { setPage(1); }, [search, status]);

  const { data, isLoading } = useQuery({
    queryKey: ['po-summary', search, status, page],
    queryFn: () =>
      api<{ items: SummaryItem[]; total: number; aggregates: Aggregates }>(
        `/po-orders/summary?status=${status}&page=${page}&pageSize=${PAGE_SIZE}${search ? `&search=${encodeURIComponent(search)}` : ''}`
      ),
  });

  const items = data?.items ?? [];
  const groups = useMemo(() => groupByPo(items), [items]);
  const aggregates = data?.aggregates;

  const togglePoExpand = (poOrderId: string) =>
    setExpandedPos((prev) => {
      const next = new Set(prev);
      if (next.has(poOrderId)) next.delete(poOrderId); else next.add(poOrderId);
      return next;
    });

  const toggleItemTest = (itemId: string) =>
    setExpandedItems((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId); else next.add(itemId);
      return next;
    });

  /* Delete item permanently */
  const deleteItem = useMutation({
    mutationFn: (id: string) => api(`/po-orders/items/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['po-summary'] });
      queryClient.invalidateQueries({ queryKey: ['po-items'] });
      setDeleteTarget(null);
    },
    onError: (e) => {
      setDeleteTarget(null);
      setActionError(e instanceof ApiError ? e.message : 'Delete failed');
    },
  });

  /* Restore cancelled item */
  const restoreItem = useMutation({
    mutationFn: (id: string) => api(`/po-orders/items/${id}/restore`, { method: 'POST' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['po-summary'] });
      queryClient.invalidateQueries({ queryKey: ['po-items'] });
      setRestoreTarget(null);
    },
    onError: (e) => {
      setRestoreTarget(null);
      setActionError(e instanceof ApiError ? e.message : 'Restore failed');
    },
  });

  /* Export every matching SO item to Excel */
  const [exporting, setExporting] = useState(false);
  const onExport = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const all = await api<{ items: SummaryItem[] }>(
        `/po-orders/summary?status=${status}&page=1&pageSize=10000${search ? `&search=${encodeURIComponent(search)}` : ''}`
      );
      const rows = all.items.map((it) => ({
        'SO Date':       fmtDate(it.orderDate),
        'PO #':          it.poNumber,
        'Customer Code': it.customerCode ?? '',
        ...(hideNames ? {} : { 'Customer': it.customerName }),
        'Type':          it.coreType,
        'Grade':         it.grade,
        'Material':      it.material,
        'Measure':       it.measure,
        'Ordered':       it.pcsOrdered,
        'Produced':      it.pcsProduced,
        'Overproduced':  it.pcsOverproduced,
        'Dispatched':    it.pcsDispatched,
        'Pending':       it.pcsPending,
        'Wt / pc':       it.weightPerPc,
        'Total Wt':      it.totalWeight,
        'Delivery Date': fmtDate(it.deliveryDate),
        'Turns':         it.turns,
        'Flux (T)':      it.flux,
        'ATe/cm':        it.ateCm,
        'V (Volts)':     it.testVoltage,
        'Ie max (mA)':   it.testCurrent,
        'Status':        it.status,
      }));
      downloadXlsx(`so-summary-${status.toLowerCase()}-${todayStamp()}`, 'SO Summary', rows);
    } catch (e) {
      setActionError(e instanceof ApiError ? e.message : 'Export failed. Please try again.');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <BarChart3 className="h-5 w-5 text-brand-600" /> SO Summary
        </h1>
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <div className="relative flex-1 sm:w-72">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              className="input pl-9"
              placeholder="Search PO#, customer, grade, measure…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <button
            onClick={onExport}
            disabled={exporting || isLoading || !items.length}
            className="btn-ghost shrink-0 text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
            title="Download all matching rows as Excel"
          >
            {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            <span className="hidden sm:inline">Excel</span>
          </button>
        </div>
      </div>

      {/* Status chips + server-side aggregate counts */}
      <div className="flex flex-wrap items-center gap-2">
        {(['ACTIVE', 'CANCELLED', 'ALL'] as const).map((s) => (
          <button
            key={s}
            onClick={() => setStatus(s)}
            className={cn(
              'rounded-full px-3 py-1 text-xs font-medium border transition',
              status === s
                ? 'bg-brand-600 text-white border-brand-600'
                : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'
            )}
          >
            {s.charAt(0) + s.slice(1).toLowerCase()}
          </button>
        ))}
        {aggregates && (
          <div className="ml-auto hidden flex-wrap items-center gap-3 text-xs text-slate-500 sm:flex">
            <Tally label="Ordered"    value={aggregates.pcsOrdered}    />
            <span className="text-slate-300">·</span>
            <Tally label="Produced"   value={aggregates.pcsProduced}   />
            <span className="text-slate-300">·</span>
            <Tally label="Overproduced" value={aggregates.pcsOverproduced} over />
            <span className="text-slate-300">·</span>
            <Tally label="Dispatched" value={aggregates.pcsDispatched} />
            <span className="text-slate-300">·</span>
            <Tally label="Pending"    value={aggregates.pcsPending} accent />
          </div>
        )}
      </div>

      {/* Loading / empty */}
      {isLoading && (
        <div className="card p-10 text-center text-slate-400">
          <Loader2 className="h-5 w-5 animate-spin mx-auto" />
        </div>
      )}
      {!isLoading && !items.length && (
        <div className="card p-10 text-center text-sm text-slate-400">
          No sales-order items match.
        </div>
      )}

      {/* Grouped table — desktop md+ */}
      {!isLoading && groups.length > 0 && (
        <div className="card overflow-hidden hidden md:block">
          <table className="w-full text-sm whitespace-nowrap">
            <thead className="bg-slate-50 text-left text-xs tracking-wide text-slate-500">
              <tr>
                <th className="w-8 px-2 py-2" />
                <th className="px-3 py-2 font-medium w-28">SO Date</th>
                <th className="px-3 py-2 font-medium">PO #</th>
                <th className="px-3 py-2 font-medium min-w-[160px]">Customer</th>
                <th className="px-3 py-2 font-medium text-right w-20">Ordered</th>
                <th className="px-3 py-2 font-medium text-right w-20">Produced</th>
                <th className="px-3 py-2 font-medium text-right w-24">Overproduced</th>
                <th className="px-3 py-2 font-medium text-right w-24">Dispatched</th>
                <th className="px-3 py-2 font-medium text-right w-20">Pending</th>
                <th className="px-3 py-2 font-medium text-right w-32">Actions</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((group) => {
                const isPoOpen = expandedPos.has(group.poOrderId);
                return (
                  <Fragment key={group.poOrderId}>
                    {/* PO header row */}
                    <tr
                      className={cn(
                        'border-t border-slate-200 cursor-pointer transition-colors',
                        isPoOpen ? 'bg-brand-50/60' : 'hover:bg-slate-50 bg-slate-50/40'
                      )}
                      onClick={() => togglePoExpand(group.poOrderId)}
                    >
                      <td className="px-2 py-2.5 text-center">
                        {isPoOpen
                          ? <ChevronDown className="h-4 w-4 text-brand-600 inline" />
                          : <ChevronRight className="h-4 w-4 text-slate-400 inline" />}
                      </td>
                      <td className="px-3 py-2.5 text-slate-600">{fmtDate(group.orderDate)}</td>
                      <td className="px-3 py-2.5 font-semibold text-slate-900">{group.poNumber}</td>
                      <td className="px-3 py-2.5 font-medium text-slate-900">
                        {hideNames
                          ? <span className="font-mono text-xs text-brand-700">{group.customerCode ?? '—'}</span>
                          : group.customerName}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums font-medium">{group.totalOrdered}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-slate-600">{group.totalProduced}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">
                        {group.totalOverproduced > 0
                          ? <span className="inline-block min-w-[2.5rem] rounded-md bg-orange-50 px-2 py-0.5 font-semibold text-orange-700">{group.totalOverproduced}</span>
                          : <span className="text-slate-300">0</span>}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-slate-600">{group.totalDispatched}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">
                        <span className={cn(
                          'inline-block min-w-[2.5rem] rounded-md px-2 py-0.5 font-semibold',
                          group.totalPending > 0 ? 'bg-yellow-50 text-yellow-800' : 'bg-green-50 text-green-700'
                        )}>
                          {group.totalPending}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-right" onClick={(e) => e.stopPropagation()} />
                    </tr>

                    {/* Expanded item rows */}
                    {isPoOpen && group.items.map((it) => {
                      const isTestOpen = expandedItems.has(it.id);
                      return (
                        <Fragment key={it.id}>
                          <tr className={cn(
                            'border-t border-slate-100 transition-colors',
                            isTestOpen ? 'bg-amber-50/30' : 'bg-white hover:bg-slate-50/60'
                          )}>
                            <td className="px-2 py-2 pl-8 text-center">
                              <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-medium', coreBadge[it.coreType])}>
                                {it.coreType === 'TOROIDAL' ? 'T' : 'R'}
                              </span>
                            </td>
                            <td className="px-3 py-2 text-slate-500 text-xs">{it.grade}</td>
                            <td className="px-3 py-2 text-slate-500 text-xs">{it.material}</td>
                            <td className="px-3 py-2 font-mono text-xs text-slate-700">{it.measure}</td>
                            <td className="px-3 py-2 text-right tabular-nums text-slate-700">{it.pcsOrdered}</td>
                            <td className="px-3 py-2 text-right tabular-nums text-slate-500">{it.pcsProduced}</td>
                            <td className="px-3 py-2 text-right tabular-nums">
                              {it.pcsOverproduced > 0
                                ? <span className="inline-block min-w-[2.5rem] rounded px-1.5 py-0.5 text-xs font-medium bg-orange-50 text-orange-700">{it.pcsOverproduced}</span>
                                : <span className="text-slate-300">0</span>}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums text-slate-500">{it.pcsDispatched}</td>
                            <td className="px-3 py-2 text-right tabular-nums">
                              <span className={cn(
                                'inline-block min-w-[2.5rem] rounded px-1.5 py-0.5 text-xs font-medium',
                                it.pcsPending > 0 ? 'bg-yellow-50 text-yellow-700' : 'bg-green-50 text-green-700'
                              )}>
                                {it.pcsPending}
                              </span>
                            </td>
                            <td className="px-3 py-2 text-right">
                              <div className="inline-flex items-center gap-1">
                                <button
                                  onClick={() => toggleItemTest(it.id)}
                                  title={isTestOpen ? 'Hide test data' : 'View test data'}
                                  className={cn(
                                    'inline-flex h-7 w-7 items-center justify-center rounded-full transition',
                                    isTestOpen
                                      ? 'bg-brand-600 text-white shadow-sm hover:bg-brand-700'
                                      : 'bg-slate-100 text-slate-600 hover:bg-brand-50 hover:text-brand-700'
                                  )}
                                >
                                  {isTestOpen ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                                </button>
                                {it.status === 'ACTIVE' && (
                                  <Link
                                    to={`/po/manage/${it.id}`}
                                    className="btn-ghost text-xs text-brand-700 hover:bg-brand-50"
                                    title="Edit this item"
                                  >
                                    <Pencil className="h-3.5 w-3.5" />
                                  </Link>
                                )}
                                {it.status === 'CANCELLED' && (
                                  <button
                                    onClick={() => setRestoreTarget(it)}
                                    className="btn-ghost text-xs text-emerald-700 hover:bg-emerald-50"
                                    title="Restore cancelled item"
                                  >
                                    <RotateCcw className="h-3.5 w-3.5" />
                                  </button>
                                )}
                                {it.pcsProduced === 0 && it.pcsDispatched === 0 && (
                                  <button
                                    onClick={() => setDeleteTarget(it)}
                                    className="btn-ghost text-xs text-red-600 hover:bg-red-50"
                                    title="Delete item permanently"
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                          {isTestOpen && (
                            <tr className="bg-gradient-to-br from-brand-50/40 via-white to-amber-50/40">
                              <td colSpan={10} className="px-4 py-4 pl-10">
                                <TestPanel item={it} />
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
          {data && (
            <Pagination page={page} pageSize={PAGE_SIZE} total={data.total} onPageChange={setPage} />
          )}
        </div>
      )}

      {/* Mobile cards — < md */}
      {!isLoading && groups.length > 0 && (
        <div className="space-y-3 md:hidden">
          {groups.map((group) => {
            const isPoOpen = expandedPos.has(group.poOrderId);
            return (
              <div key={group.poOrderId} className="card overflow-hidden">
                <button
                  onClick={() => togglePoExpand(group.poOrderId)}
                  className="w-full px-3 py-3 text-left hover:bg-slate-50 transition-colors"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs text-slate-500">{fmtDate(group.orderDate)}</span>
                        <span className="text-sm font-semibold text-slate-800">{group.poNumber}</span>
                      </div>
                      <div className="mt-0.5 text-sm font-medium text-slate-900 truncate">
                        {hideNames
                          ? <span className="font-mono text-xs text-brand-700">{group.customerCode ?? '—'}</span>
                          : group.customerName}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={cn(
                        'text-xs font-semibold tabular-nums rounded px-1.5 py-0.5',
                        group.totalPending > 0 ? 'bg-yellow-50 text-yellow-800' : 'bg-green-50 text-green-700'
                      )}>
                        {group.totalPending} pend
                      </span>
                      {isPoOpen
                        ? <ChevronDown className="h-4 w-4 text-brand-600 shrink-0" />
                        : <ChevronRight className="h-4 w-4 text-slate-400 shrink-0" />}
                    </div>
                  </div>
                  <div className="mt-2 grid grid-cols-5 gap-1.5 text-center">
                    <Pill label="Ord"  value={group.totalOrdered} />
                    <Pill label="Prod" value={group.totalProduced} muted />
                    <Pill label="Over" value={group.totalOverproduced} accent={group.totalOverproduced > 0 ? 'over' : undefined} muted />
                    <Pill label="Disp" value={group.totalDispatched} muted />
                    <Pill label="Pend" value={group.totalPending} accent={group.totalPending > 0 ? 'warning' : 'ok'} />
                  </div>
                </button>
                {isPoOpen && (
                  <div className="border-t border-slate-200">
                    <div className="flex items-center px-3 py-2 bg-slate-50">
                      <span className="text-xs font-semibold text-slate-600 uppercase tracking-wide">
                        {group.items.length} item{group.items.length !== 1 ? 's' : ''}
                      </span>
                    </div>
                    {group.items.map((it) => {
                      const isTestOpen = expandedItems.has(it.id);
                      return (
                        <div key={it.id} className="border-t border-slate-100">
                          <div className="px-3 py-2.5 space-y-2">
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-1.5">
                                  <span className={cn('rounded-full px-1.5 py-0.5 text-[10px] font-medium', coreBadge[it.coreType])}>
                                    {it.coreType === 'TOROIDAL' ? 'Toro' : 'Rect'}
                                  </span>
                                  <span className="text-xs text-slate-600 font-medium">{it.grade}</span>
                                  <span className="text-xs text-slate-500">{it.material}</span>
                                </div>
                                <div className="mt-0.5 font-mono text-xs text-slate-700 truncate">{it.measure}</div>
                              </div>
                              <div className="flex items-center gap-1 shrink-0">
                                <button onClick={() => toggleItemTest(it.id)} className={cn(
                                  'h-7 w-7 flex items-center justify-center rounded-full',
                                  isTestOpen ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600'
                                )}>
                                  {isTestOpen ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                                </button>
                                {it.status === 'ACTIVE' && (
                                  <Link to={`/po/manage/${it.id}`} className="btn-ghost text-xs text-brand-700">
                                    <Pencil className="h-3.5 w-3.5" />
                                  </Link>
                                )}
                                {it.status === 'CANCELLED' && (
                                  <button onClick={() => setRestoreTarget(it)} className="btn-ghost text-xs text-emerald-700">
                                    <RotateCcw className="h-3.5 w-3.5" />
                                  </button>
                                )}
                                {it.pcsProduced === 0 && it.pcsDispatched === 0 && (
                                  <button onClick={() => setDeleteTarget(it)} className="btn-ghost text-xs text-red-600">
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </button>
                                )}
                              </div>
                            </div>
                            <div className="grid grid-cols-5 gap-1.5 text-center">
                              <Pill label="Ord"  value={it.pcsOrdered} />
                              <Pill label="Prod" value={it.pcsProduced} muted />
                              <Pill label="Over" value={it.pcsOverproduced} accent={it.pcsOverproduced > 0 ? 'over' : undefined} muted />
                              <Pill label="Disp" value={it.pcsDispatched} muted />
                              <Pill label="Pend" value={it.pcsPending} accent={it.pcsPending > 0 ? 'warning' : 'ok'} />
                            </div>
                          </div>
                          {isTestOpen && (
                            <div className="border-t border-slate-200 bg-gradient-to-br from-brand-50/40 via-white to-amber-50/40 px-3 py-3">
                              <TestPanel item={it} />
                            </div>
                          )}
                        </div>
                      );
                    })}
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
        cancelLabel="Keep it"
        loading={deleteItem.isPending}
        onConfirm={() => deleteTarget && deleteItem.mutate(deleteTarget.id)}
        onCancel={() => setDeleteTarget(null)}
        message={deleteTarget ? (
          <div className="space-y-2 text-sm">
            <div className="rounded-lg bg-slate-50 px-3 py-2 text-xs">
              <div className="font-medium text-slate-900">{deleteTarget.poNumber}</div>
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
          <div className="text-sm rounded-lg bg-slate-50 px-3 py-2">
            <div className="font-medium text-slate-900">{restoreTarget.poNumber}</div>
            <div className="text-slate-600">{restoreTarget.grade} · {restoreTarget.material}</div>
            <div className="font-mono text-xs text-slate-700">{restoreTarget.measure}</div>
          </div>
        ) : null}
      />

      {/* Error alert */}
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

/* ---------- expanded test panel ---------- */
const TestPanel = ({ item }: { item: SummaryItem }) => {
  const hasTest = item.flux != null || item.testVoltage != null || item.testCurrent != null;
  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center gap-1.5 border-b border-slate-100 px-3 py-2 text-[11px] font-bold tracking-wide text-slate-600">
          <FileText className="h-3.5 w-3.5 text-slate-500" />
          PO Reference
        </div>
        <div className="grid grid-cols-2 gap-x-3 gap-y-2 px-3 py-2.5 sm:grid-cols-3 lg:grid-cols-6">
          <FieldCell label="PO Number"  value={item.poNumber} mono />
          <FieldCell label="Material"   value={item.material} />
          <FieldCell label="Wt / pc"    value={item.weightPerPc.toFixed(3)} mono />
          <FieldCell label="Total Wt"   value={item.totalWeight.toFixed(3)} mono />
          <FieldCell label="Delivery"   value={(() => { const d = new Date(item.deliveryDate); return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' }); })()} />
          <FieldCell label="Status"     value={item.status} />
        </div>
      </div>
      <div className="rounded-xl border border-amber-200 bg-gradient-to-br from-amber-50/80 to-white shadow-sm">
        <div className="flex items-center gap-1.5 border-b border-amber-100 px-3 py-2 text-[11px] font-bold tracking-wide text-amber-800">
          <Activity className="h-3.5 w-3.5" />
          Flux-Test Calibration
        </div>
        {!hasTest ? (
          <div className="px-3 py-3 text-xs italic text-slate-400">
            No flux-test data captured at PO entry.
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2 px-3 py-2.5 sm:grid-cols-3 lg:grid-cols-5">
            <FluxField label="Turns"       value={item.turns != null ? String(item.turns) : '—'} />
            <FluxField label="Flux ( T )"  value={item.flux != null ? `${item.flux.toFixed(2)} T` : '—'} />
            <FluxField label="ATe/cm"      value={item.ateCm != null ? item.ateCm.toFixed(3) : '—'} />
            <FluxField label="V (Volts)"   value={item.testVoltage != null ? item.testVoltage.toFixed(3) : '—'} />
            <FluxField label="Ie max (mA)" value={item.testCurrent != null ? item.testCurrent.toFixed(2) : '—'} highlight />
          </div>
        )}
      </div>
    </div>
  );
};

const FieldCell = ({ label, value, mono }: { label: string; value: string; mono?: boolean }) => (
  <div className="min-w-0">
    <div className="text-[10px] font-medium tracking-wide text-slate-500">{label}</div>
    <div className={cn('truncate text-sm text-slate-900 leading-tight', mono && 'font-mono tabular-nums')}>{value}</div>
  </div>
);

const FluxField = ({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) => (
  <div className={cn(
    'min-w-0 rounded-lg border px-2.5 py-1.5 transition',
    highlight ? 'border-amber-400 bg-white shadow-sm' : 'border-amber-200 bg-white/70'
  )}>
    <div className={cn('text-[10px] font-medium tracking-wide', highlight ? 'text-amber-700' : 'text-amber-600/80')}>{label}</div>
    <div className={cn('truncate font-mono tabular-nums leading-tight mt-0.5', highlight ? 'text-base font-bold text-amber-900' : 'text-sm font-semibold text-slate-900')}>
      {value}
    </div>
  </div>
);

const Tally = ({ label, value, accent, over }: { label: string; value: number; accent?: boolean; over?: boolean }) => (
  <span className="inline-flex items-baseline gap-1">
    <span className="text-[10px] uppercase">{label}</span>
    <span className={cn(
      'font-semibold tabular-nums text-sm',
      over ? (value > 0 ? 'text-orange-600' : 'text-slate-400') : accent ? 'text-amber-700' : 'text-slate-900'
    )}>{value}</span>
  </span>
);

const Pill = ({ label, value, muted, accent }: {
  label: string; value: number; muted?: boolean; accent?: 'ok' | 'warning' | 'over';
}) => (
  <div className={cn(
    'rounded-md px-2 py-1',
    accent === 'warning' ? 'bg-yellow-50' : accent === 'ok' ? 'bg-green-50' : accent === 'over' ? 'bg-orange-50' : 'bg-slate-50'
  )}>
    <div className={cn('text-[10px] font-medium', accent === 'warning' ? 'text-yellow-700' : accent === 'ok' ? 'text-green-700' : accent === 'over' ? 'text-orange-700' : 'text-slate-500')}>{label}</div>
    <div className={cn('tabular-nums text-sm font-semibold', accent === 'warning' ? 'text-yellow-800' : accent === 'ok' ? 'text-green-800' : accent === 'over' ? 'text-orange-800' : muted ? 'text-slate-600' : 'text-slate-900')}>{value}</div>
  </div>
);
