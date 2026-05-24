// Modify Supplier PO — list view with edit / delete actions.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Search, Pencil, Trash2, Plus, ListChecks, Loader2, Download, FileText } from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useConfirm } from '@/hooks/useConfirm';
import { downloadXlsx, todayStamp } from '@/lib/excel';

type SupplierOrder = {
  id: string;
  poNumber: string;
  orderDate: string;
  expectedDate: string | null;
  status: 'PENDING' | 'PARTIAL' | 'RECEIVED' | 'CANCELLED';
  supplier: { id: string; name: string };
  items: Array<{ id: string; description: string; qty: number; rate: number; amount: number; receivedQty: number }>;
  createdAt: string;
};

const fmt = (iso: string | null | undefined) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
};

const statusBadge = {
  PENDING:   'bg-slate-100 text-slate-700',
  PARTIAL:   'bg-amber-50 text-amber-700',
  RECEIVED:  'bg-green-50 text-green-700',
  CANCELLED: 'bg-red-50 text-red-700',
} as const;

export const SupplierOrderManagePage = () => {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const { confirm, confirmDialog } = useConfirm();

  const { data, isLoading } = useQuery({
    queryKey: ['supplier-orders', search],
    queryFn: () =>
      api<{ items: SupplierOrder[]; total: number }>(
        `/supplier-orders${search ? `?search=${encodeURIComponent(search)}` : ''}`
      ),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api(`/supplier-orders/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['supplier-orders'] }),
  });

  /* Export — one row per line item so the spreadsheet has full detail.
     Header columns (PO #, Supplier, Date…) repeat per line so each row stands
     on its own when sorted/filtered in Excel. */
  const onExport = () => {
    const orders = data?.items ?? [];
    if (!orders.length) return;
    const rows: Record<string, string | number | null> [] = [];
    for (const po of orders) {
      const total = po.items.reduce((s, it) => s + it.amount, 0);
      if (po.items.length === 0) {
        rows.push({
          'PO Number':    po.poNumber,
          'Supplier':     po.supplier.name,
          'Order Date':   fmt(po.orderDate),
          'Expected':     fmt(po.expectedDate),
          'Status':       po.status,
          'PO Total (₹)': +total.toFixed(2),
          'Description':  null,
          'Qty':          null,
          'Rate':         null,
          'Amount (₹)':   null,
          'Received Qty': null,
        });
        continue;
      }
      for (const it of po.items) {
        rows.push({
          'PO Number':    po.poNumber,
          'Supplier':     po.supplier.name,
          'Order Date':   fmt(po.orderDate),
          'Expected':     fmt(po.expectedDate),
          'Status':       po.status,
          'PO Total (₹)': +total.toFixed(2),
          'Description':  it.description,
          'Qty':          it.qty,
          'Rate':         it.rate,
          'Amount (₹)':   it.amount,
          'Received Qty': it.receivedQty,
        });
      }
    }
    downloadXlsx(`supplier-orders-${todayStamp()}`, 'Supplier POs', rows);
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <ListChecks className="h-5 w-5 text-brand-600" /> Modify Supplier POs
        </h1>
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <button
            type="button"
            onClick={onExport}
            disabled={isLoading || !data?.items.length}
            className="btn-ghost text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
            title="Download all matching rows as Excel"
          >
            <Download className="h-4 w-4" />
            <span className="hidden sm:inline">Excel</span>
          </button>
          <Link to="/supplier-po/new" className="btn-primary w-full sm:w-auto">
            <Plus className="h-4 w-4" /> New PO
          </Link>
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-slate-200 px-4 py-3 sm:flex-row sm:items-center">
          <div className="relative flex-1 sm:max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              className="input pl-9"
              placeholder="Search PO#, supplier, HSN, description"
              value={search} onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="text-xs text-slate-500">{data ? `${data.total} order${data.total === 1 ? '' : 's'}` : ''}</div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm whitespace-nowrap">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">PO Number</th>
                <th className="px-4 py-3">Supplier</th>
                <th className="px-4 py-3">Order Date</th>
                <th className="px-4 py-3">Expected</th>
                <th className="px-4 py-3 text-center">Items</th>
                <th className="px-4 py-3 text-right">Total</th>
                <th className="px-4 py-3 text-center">Status</th>
                <th className="px-4 py-3 w-32 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr><td colSpan={8} className="px-4 py-10 text-center text-slate-400">
                  <Loader2 className="h-5 w-5 animate-spin inline mr-2" /> Loading…
                </td></tr>
              )}
              {!isLoading && !data?.items.length && (
                <tr><td colSpan={8} className="px-4 py-10 text-center text-slate-400">
                  No supplier POs yet. <Link to="/supplier-po/new" className="text-brand-700 hover:underline">Create one →</Link>
                </td></tr>
              )}
              {data?.items.map((po) => {
                const total = po.items.reduce((s, it) => s + it.amount, 0);
                return (
                  <tr key={po.id} className="border-t border-slate-100 hover:bg-slate-50">
                    <td className="px-4 py-3 font-mono text-xs font-semibold text-brand-700">{po.poNumber}</td>
                    <td className="px-4 py-3 font-medium">{po.supplier.name}</td>
                    <td className="px-4 py-3 text-slate-600">{fmt(po.orderDate)}</td>
                    <td className="px-4 py-3 text-slate-600">{fmt(po.expectedDate)}</td>
                    <td className="px-4 py-3 text-center">
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                        {po.items.length}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums font-mono">{total.toFixed(2)}</td>
                    <td className="px-4 py-3 text-center">
                      <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-medium', statusBadge[po.status])}>
                        {po.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="inline-flex items-center gap-1">
                        <Link
                          to={`/supplier-po/print/${po.id}`}
                          className="btn-ghost text-slate-700 hover:bg-slate-100"
                          title="Print / Download PDF"
                        >
                          <FileText className="h-4 w-4" />
                        </Link>
                        <Link to={`/supplier-po/manage/${po.id}`} className="btn-ghost text-brand-700 hover:bg-brand-50" title="Edit">
                          <Pencil className="h-4 w-4" />
                        </Link>
                        <button
                          onClick={async () => {
                            const ok = await confirm({
                              title: 'Delete supplier PO?',
                              message: <>Delete PO <strong>{po.poNumber}</strong>? This cannot be undone.</>,
                              tone: 'danger',
                              confirmLabel: 'Delete',
                            });
                            if (ok) remove.mutate(po.id);
                          }}
                          className="btn-ghost text-red-600 hover:bg-red-50"
                          title="Delete"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      {confirmDialog}
    </div>
  );
};
