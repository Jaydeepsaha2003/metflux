import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Search, MessageCircle, Plus, Pencil, Building2, Link2, Check } from 'lucide-react';
import { api } from '@/lib/api';
import { Pagination } from '@/components/Pagination';
import { useHideCustomerNames } from '@/store/auth';

type Customer = {
  id: string;
  customerCode: string;
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  state: string | null;
  gstNumber: string | null;
  gstRate: number;
  shareToken: string | null;
  createdAt: string;
};

type ListResp = { items: Customer[]; total: number; page: number; pageSize: number };

const PAGE_SIZE = 20;

export const CustomersPage = () => {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const copyPortalLink = async (c: Customer) => {
    if (!c.shareToken) return;
    const url = `${window.location.origin}/s/admin/portal/${c.shareToken}`;
    await navigator.clipboard.writeText(url);
    setCopiedId(c.id);
    setTimeout(() => setCopiedId(null), 2000);
  };
  const hideNames = useHideCustomerNames();
  // Reset to page 1 when the user changes the search — otherwise an empty page
  // would show because the result count usually shrinks.
  useEffect(() => { setPage(1); }, [search]);
  const { data, isLoading } = useQuery({
    queryKey: ['customers', search, page],
    queryFn: () => api<ListResp>(`/customers?search=${encodeURIComponent(search)}&page=${page}&pageSize=${PAGE_SIZE}`),
  });

  const shareWhatsapp = async (c: Customer) => {
    if (!c.phone) return;
    const res = await api<{ url: string }>('/whatsapp/share-url', {
      method: 'POST',
      json: { phone: c.phone, message: `Hi ${c.name}, this is from Metflux.` },
    });
    window.open(res.url, '_blank', 'noopener,noreferrer');
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold tracking-tight">Customers</h1>
        <Link to="/customers/new" className="btn-primary">
          <Plus className="h-4 w-4" /> Add Customer
        </Link>
      </div>

      <div className="card overflow-hidden">
        <div className="flex items-center gap-3 border-b border-slate-200 px-4 py-3">
          <div className="relative flex-1 max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              className="input pl-9"
              placeholder="Search by name, email or phone"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="text-xs text-slate-500">{data ? `${data.total} customer${data.total === 1 ? '' : 's'}` : ''}</div>
        </div>

        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Code</th>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Email</th>
              <th className="px-4 py-3">Phone</th>
              <th className="px-4 py-3">GSTIN</th>
              <th className="px-4 py-3 text-right">GST %</th>
              <th className="px-4 py-3">State</th>
              <th className="px-4 py-3 w-40 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr><td colSpan={8} className="px-4 py-10 text-center text-slate-400">Loading…</td></tr>
            )}
            {!isLoading && data?.items.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-slate-400">
                  <div className="flex flex-col items-center gap-2">
                    <Building2 className="h-6 w-6 text-slate-300" />
                    <span>No customers yet.</span>
                    <Link to="/customers/new" className="text-brand-700 hover:text-brand-800 text-sm font-medium">
                      Add your first customer →
                    </Link>
                  </div>
                </td>
              </tr>
            )}
            {data?.items.map((c) => (
              <tr key={c.id} className="border-t border-slate-100 hover:bg-slate-50">
                <td className="px-4 py-3 font-mono text-xs font-semibold text-brand-700">{c.customerCode}</td>
                <td className="px-4 py-3 font-medium text-slate-900">{hideNames ? '••••••' : c.name}</td>
                <td className="px-4 py-3 text-slate-600">{c.email ?? '—'}</td>
                <td className="px-4 py-3 text-slate-600 font-mono text-xs">{c.phone ?? '—'}</td>
                <td className="px-4 py-3 text-slate-600 font-mono text-xs">{c.gstNumber ?? '—'}</td>
                <td className="px-4 py-3 text-right tabular-nums text-slate-600">{c.gstRate ? `${c.gstRate}%` : '—'}</td>
                <td className="px-4 py-3 text-slate-600">{c.state ?? '—'}</td>
                <td className="px-4 py-3 text-right">
                  <div className="inline-flex items-center gap-1">
                    {c.phone && (
                      <button
                        onClick={() => shareWhatsapp(c)}
                        className="btn-ghost text-emerald-700 hover:bg-emerald-50"
                        title="Share via WhatsApp"
                      >
                        <MessageCircle className="h-4 w-4" />
                      </button>
                    )}
                    {c.shareToken && (
                      <button
                        onClick={() => copyPortalLink(c)}
                        className={`btn-ghost transition-colors ${
                          copiedId === c.id
                            ? 'text-emerald-600 hover:bg-emerald-50'
                            : 'text-slate-500 hover:bg-slate-100'
                        }`}
                        title={copiedId === c.id ? 'Link copied!' : 'Copy customer portal link'}
                      >
                        {copiedId === c.id
                          ? <Check className="h-4 w-4" />
                          : <Link2 className="h-4 w-4" />
                        }
                      </button>
                    )}
                    <Link
                      to={`/customers/${c.id}`}
                      className="btn-ghost text-brand-700 hover:bg-brand-50"
                      title="Edit customer"
                    >
                      <Pencil className="h-4 w-4" />
                    </Link>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {data && (
          <Pagination
            page={page}
            pageSize={PAGE_SIZE}
            total={data.total}
            onPageChange={setPage}
          />
        )}
      </div>
    </div>
  );
};
