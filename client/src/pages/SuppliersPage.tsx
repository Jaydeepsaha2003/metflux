import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Search, Plus, Pencil, Truck } from 'lucide-react';
import { api } from '@/lib/api';
import { Pagination } from '@/components/Pagination';

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
  useEffect(() => { setPage(1); }, [search]);
  const { data, isLoading } = useQuery({
    queryKey: ['suppliers', search, page],
    queryFn: () => api<ListResp>(`/suppliers?search=${encodeURIComponent(search)}&page=${page}&pageSize=${PAGE_SIZE}`),
  });

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Truck className="h-5 w-5 text-brand-600" /> Suppliers
        </h1>
        <Link to="/settings/suppliers/new" className="btn-primary w-full sm:w-auto">
          <Plus className="h-4 w-4" /> Add Supplier
        </Link>
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
                    <Link
                      to={`/settings/suppliers/${s.id}`}
                      className="btn-ghost text-brand-700 hover:bg-brand-50"
                      title="Edit supplier"
                    >
                      <Pencil className="h-4 w-4" />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {data && (
          <Pagination page={page} pageSize={PAGE_SIZE} total={data.total} onPageChange={setPage} />
        )}
      </div>
    </div>
  );
};
