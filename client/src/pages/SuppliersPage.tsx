import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Search, Plus, Pencil, Truck, Trash2, Loader2 } from 'lucide-react';
import { api } from '@/lib/api';
import { useConfirm } from '@/hooks/useConfirm';
import { Pagination } from '@/components/Pagination';
import { BulkExcel, type BulkExcelConfig } from '@/components/BulkExcel';

type Supplier = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  state: string | null;
  gstNumber: string | null;
  gstRate: number;
  createdAt: string;
};

type ListResp = { items: Supplier[]; total: number; page: number; pageSize: number };

const PAGE_SIZE = 20;

export const SuppliersPage = () => {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZE);
  const changePageSize = (n: number) => { setPageSize(n); setPage(1); };
  const qc = useQueryClient();
  const { confirm, alert, confirmDialog } = useConfirm();
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const removeSupplier = useMutation({
    mutationFn: (id: string) => api(`/suppliers/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['suppliers'] }),
  });

  // Ask the server what's referencing this supplier BEFORE prompting, so the
  // dialog states the reason instead of failing after the user commits.
  const onDelete = async (sup: { id: string; name: string }) => {
    setDeletingId(sup.id);
    try {
      const chk = await api<{ deletable: boolean; blockers: string[]; otherCompanies: number; counts?: { derivedPayments?: number } }>(`/suppliers/${sup.id}/deletable`);
      if (!chk.deletable) {
        await alert({
          title: 'Can’t delete this supplier',
          message: <><strong>{sup.name}</strong> still has {chk.blockers.join(', ')}. Delete or reassign those first, so nothing is left orphaned.</>,
          tone: 'warning',
        });
        return;
      }
      const ok = await confirm({
        title: 'Delete supplier?',
        message: (
          <>
            Remove <strong>{sup.name}</strong> from this company? Nothing you entered references them, so no bills or orders are affected.
            {!!chk.counts?.derivedPayments && (
              <> The {chk.counts.derivedPayments} payment{chk.counts.derivedPayments === 1 ? '' : 's'} the cash-book
              reconciliation generated for them {chk.counts.derivedPayments === 1 ? 'is' : 'are'} removed too.</>
            )}
            {chk.otherCompanies > 0
              ? <> They stay available to {chk.otherCompanies} other compan{chk.otherCompanies === 1 ? 'y' : 'ies'} that also use them.</>
              : <> This cannot be undone.</>}
          </>
        ),
        tone: 'danger', confirmLabel: 'Delete',
      });
      if (ok) removeSupplier.mutate(sup.id);
    } finally { setDeletingId(null); }
  };
  useEffect(() => { setPage(1); }, [search]);
  const { data, isLoading } = useQuery({
    queryKey: ['suppliers', search, page, pageSize],
    queryFn: () => api<ListResp>(`/suppliers?search=${encodeURIComponent(search)}&page=${page}&pageSize=${pageSize}`),
  });

  const bulkConfig: BulkExcelConfig = {
    entityLabel: 'Suppliers',
    filenameBase: 'suppliers',
    sheetName: 'Suppliers',
    template: [
      { header: 'Name', example: 'Steel Strip Co.' },
      { header: 'Phone', example: '+91 90000 00000' },
      { header: 'Email', example: 'sales@steelstrip.com' },
      { header: 'State', example: 'Gujarat' },
      { header: 'GSTIN', example: '24AAAAA0000A1Z5' },
      { header: 'GST Rate', example: '18' },
      { header: 'Address', example: 'GIDC, Vapi' },
      { header: 'Notes', example: '' },
    ],
    fetchExportRows: async () => {
      const all = await api<{ items: Array<Record<string, unknown>> }>('/suppliers?pageSize=500');
      return all.items.map((s) => ({
        'Name': (s.name as string) ?? '',
        'Phone': (s.phone as string) ?? '',
        'Email': (s.email as string) ?? '',
        'State': (s.state as string) ?? '',
        'GSTIN': (s.gstNumber as string) ?? '',
        'GST Rate': (s.gstRate as number) ?? 0,
        'Address': (s.address as string) ?? '',
        'Notes': (s.notes as string) ?? '',
      }));
    },
    importPath: '/suppliers/import',
    onImported: () => qc.invalidateQueries({ queryKey: ['suppliers'] }),
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Truck className="h-5 w-5 text-brand-600" /> Suppliers
        </h1>
        <div className="flex items-center gap-2">
          <BulkExcel config={bulkConfig} />
          <Link to="/settings/suppliers/new" className="btn-primary">
            <Plus className="h-4 w-4" /> Add Supplier
          </Link>
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-slate-200 px-4 py-3 sm:flex-row sm:items-center">
          <div className="relative flex-1 sm:max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              className="input pl-9"
              placeholder="Search by name, GSTIN, phone, email"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="text-xs text-slate-500">{data ? `${data.total} supplier${data.total === 1 ? '' : 's'}` : ''}</div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">GSTIN</th>
                <th className="px-4 py-3 text-right">GST %</th>
                <th className="px-4 py-3">Phone</th>
                <th className="px-4 py-3">State</th>
                <th className="px-4 py-3 w-20 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr><td colSpan={6} className="px-4 py-10 text-center text-slate-400">Loading…</td></tr>
              )}
              {!isLoading && data?.items.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-slate-400">
                    <div className="flex flex-col items-center gap-2">
                      <Truck className="h-6 w-6 text-slate-300" />
                      <span>No suppliers yet.</span>
                      <Link to="/settings/suppliers/new" className="text-brand-700 hover:text-brand-800 text-sm font-medium">
                        Add your first supplier →
                      </Link>
                    </div>
                  </td>
                </tr>
              )}
              {data?.items.map((s) => (
                <tr key={s.id} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium text-slate-900">{s.name}</td>
                  <td className="px-4 py-3 text-slate-600 font-mono text-xs">{s.gstNumber ?? '—'}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{s.gstRate.toFixed(2)}%</td>
                  <td className="px-4 py-3 text-slate-600 font-mono text-xs">{s.phone ?? '—'}</td>
                  <td className="px-4 py-3 text-slate-600">{s.state ?? '—'}</td>
                  <td className="px-4 py-3 text-right">
                    <div className="inline-flex items-center gap-1">
                      <Link
                        to={`/settings/suppliers/${s.id}`}
                        className="btn-ghost text-brand-700 hover:bg-brand-50"
                        title="Edit supplier"
                      >
                        <Pencil className="h-4 w-4" />
                      </Link>
                      <button
                        onClick={() => onDelete(s)}
                        disabled={deletingId === s.id || removeSupplier.isPending}
                        className="btn-ghost text-red-600 hover:bg-red-50 disabled:opacity-40"
                        title="Delete supplier (only if nothing references them)"
                      >
                        {deletingId === s.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {data && (
          <Pagination page={page} pageSize={pageSize} total={data.total} onPageChange={setPage} onPageSizeChange={changePageSize} />
        )}
      </div>
      {confirmDialog}
    </div>
  );
};
