// All production records — flat table with search and per-row edit/delete.
// Mirrors the .NET Modify_Production grid.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Search, Pencil, Trash2, Factory } from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useConfirm } from '@/hooks/useConfirm';
import { Pagination } from '@/components/Pagination';

type Row = {
  id: string;
  poNumber: string;
  customerName: string;
  coreType: 'TOROIDAL' | 'RECTANGULAR';
  grade: string;
  material: string;
  measure: string;
  itemPcs: number;
  prodDate: string;
  pcs: number;
  weightPerPc: number;
  totalWeight: number;
  labourName: string;
  amount: number | null;
};
type ListResp = { items: Row[]; total: number };

const formatDate = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
};

const PAGE_SIZE = 20;

export const ProductionListPage = () => {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  useEffect(() => { setPage(1); }, [search]);
  const queryClient = useQueryClient();
  const { confirm, confirmDialog } = useConfirm();

  const { data, isLoading } = useQuery({
    queryKey: ['production', search, page],
    queryFn: () => api<ListResp>(`/production?search=${encodeURIComponent(search)}&page=${page}&pageSize=${PAGE_SIZE}`),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api(`/production/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['production'] }),
  });

  return (
    <div className="space-y-4 max-w-[1400px]">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Factory className="h-5 w-5 text-brand-600" /> Production
        </h1>
        <Link to="/production/new" className="btn-primary">
          <Plus className="h-4 w-4" /> Record Production
        </Link>
      </div>

      <div className="card overflow-hidden">
        <div className="flex items-center gap-3 border-b border-slate-200 px-4 py-3">
          <div className="relative flex-1 max-w-md">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              className="input pl-9"
              placeholder="Search by PO#, customer, labour, measure, grade or material"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="text-xs text-slate-500 ml-auto">
            {data ? `${data.total} record${data.total === 1 ? '' : 's'}` : ''}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2.5 font-medium">Date</th>
                <th className="px-3 py-2.5 font-medium">PO #</th>
                <th className="px-3 py-2.5 font-medium">Customer</th>
                <th className="px-3 py-2.5 font-medium">Labour</th>
                <th className="px-3 py-2.5 font-medium">Type</th>
                <th className="px-3 py-2.5 font-medium">Grade</th>
                <th className="px-3 py-2.5 font-medium">Material</th>
                <th className="px-3 py-2.5 font-medium">Measure</th>
                <th className="px-3 py-2.5 font-medium text-right">Pcs</th>
                <th className="px-3 py-2.5 font-medium text-right">Wt/pc</th>
                <th className="px-3 py-2.5 font-medium text-right">Total Wt</th>
                <th className="px-3 py-2.5 font-medium text-right">Amount</th>
                <th className="w-24 px-3 py-2.5"></th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr><td colSpan={13} className="px-3 py-10 text-center text-slate-400">Loading…</td></tr>
              )}
              {!isLoading && data?.items.length === 0 && (
                <tr>
                  <td colSpan={13} className="px-3 py-10 text-center text-slate-400">
                    No production records yet.{' '}
                    <Link to="/production/new" className="text-brand-700 hover:text-brand-800 font-medium">
                      Record your first one →
                    </Link>
                  </td>
                </tr>
              )}
              {data?.items.map((p) => (
                <tr key={p.id} className="border-t border-slate-100 hover:bg-slate-50/60">
                  <td className="px-3 py-2 text-slate-600">{formatDate(p.prodDate)}</td>
                  <td className="px-3 py-2 font-mono text-xs">{p.poNumber}</td>
                  <td className="px-3 py-2">{p.customerName}</td>
                  <td className="px-3 py-2 font-medium">{p.labourName}</td>
                  <td className="px-3 py-2">
                    <span className={cn(
                      'rounded-full px-2 py-0.5 text-[11px] font-medium',
                      p.coreType === 'TOROIDAL' ? 'bg-amber-50 text-amber-700' : 'bg-rose-50 text-rose-700'
                    )}>
                      {p.coreType === 'TOROIDAL' ? 'Toro' : 'Rect'}
                    </span>
                  </td>
                  <td className="px-3 py-2">{p.grade}</td>
                  <td className="px-3 py-2">{p.material}</td>
                  <td className="px-3 py-2 font-mono text-xs">{p.measure}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{p.pcs}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">{p.weightPerPc.toFixed(3)}</td>
                  <td className="px-3 py-2 text-right font-mono font-semibold tabular-nums">{p.totalWeight.toFixed(3)}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-brand-700">
                    {p.amount != null ? `₹${p.amount.toFixed(2)}` : '—'}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <div className="inline-flex items-center gap-1">
                      <Link to={`/production/${p.id}`} className="btn-ghost text-brand-700 hover:bg-brand-50" title="Edit">
                        <Pencil className="h-4 w-4" />
                      </Link>
                      <button
                        onClick={async () => {
                          const ok = await confirm({
                            title: 'Delete production entry?',
                            message: <>Delete production entry of <strong>{p.pcs} pcs</strong> by <strong>{p.labourName}</strong>?</>,
                            tone: 'danger',
                            confirmLabel: 'Delete',
                          });
                          if (ok) remove.mutate(p.id);
                        }}
                        className="btn-ghost text-red-600 hover:bg-red-50"
                        title="Delete"
                        disabled={remove.isPending}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
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
      {confirmDialog}
    </div>
  );
};
