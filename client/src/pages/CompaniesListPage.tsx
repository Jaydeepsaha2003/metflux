// Multi-tenant company management — platform admin only.
// List, add, edit and soft-delete companies. The company switcher in the
// sidebar refreshes automatically when memberships change.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Plus, Search, Pencil, Building2 } from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';

type Row = {
  id: string;
  name: string;
  slug: string;
  gstNumber: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  isActive: boolean;
  counts?: { members: number; customers: number; poOrders: number };
};

export const CompaniesListPage = () => {
  const [search, setSearch] = useState('');
  const { data, isLoading } = useQuery({
    queryKey: ['companies', search],
    queryFn: () => api<{ items: Row[] }>(`/companies?search=${encodeURIComponent(search)}`),
  });

  return (
    <div className="space-y-5 max-w-6xl">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Building2 className="h-5 w-5 text-brand-600" /> Companies
        </h1>
        <Link to="/settings/companies/new" className="btn-primary">
          <Plus className="h-4 w-4" /> Add Company
        </Link>
      </div>

      <div className="card overflow-hidden">
        <div className="flex items-center gap-3 border-b border-slate-200 px-4 py-3">
          <div className="relative flex-1 max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              className="input pl-9"
              placeholder="Search by name or slug"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="text-xs text-slate-500">
            {data ? `${data.items.length} compan${data.items.length === 1 ? 'y' : 'ies'}` : ''}
          </div>
        </div>

        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Slug</th>
              <th className="px-4 py-3">GSTIN</th>
              <th className="px-4 py-3 text-right">Members</th>
              <th className="px-4 py-3 text-right">Customers</th>
              <th className="px-4 py-3 text-right">POs</th>
              <th className="px-4 py-3 w-24">Status</th>
              <th className="px-4 py-3 w-16"></th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr><td colSpan={8} className="px-4 py-10 text-center text-slate-400">Loading…</td></tr>
            )}
            {!isLoading && data?.items.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-slate-400">
                  No companies yet —{' '}
                  <Link to="/settings/companies/new" className="text-brand-700 hover:text-brand-800 font-medium">
                    add the first one →
                  </Link>
                </td>
              </tr>
            )}
            {data?.items.map((c) => (
              <tr key={c.id} className="border-t border-slate-100 hover:bg-slate-50">
                <td className="px-4 py-3 font-medium text-slate-900">{c.name}</td>
                <td className="px-4 py-3 font-mono text-xs text-slate-500">{c.slug}</td>
                <td className="px-4 py-3 font-mono text-xs text-slate-600">{c.gstNumber ?? '—'}</td>
                <td className="px-4 py-3 text-right tabular-nums">{c.counts?.members ?? 0}</td>
                <td className="px-4 py-3 text-right tabular-nums">{c.counts?.customers ?? 0}</td>
                <td className="px-4 py-3 text-right tabular-nums">{c.counts?.poOrders ?? 0}</td>
                <td className="px-4 py-3">
                  <span className={cn(
                    'rounded-full px-2 py-0.5 text-[11px] font-medium',
                    c.isActive ? 'bg-green-50 text-green-700' : 'bg-slate-100 text-slate-500'
                  )}>
                    {c.isActive ? 'Active' : 'Disabled'}
                  </span>
                </td>
                <td className="px-4 py-3 text-right">
                  <Link to={`/settings/companies/${c.id}`} className="btn-ghost text-brand-700 hover:bg-brand-50" title="Edit">
                    <Pencil className="h-4 w-4" />
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
