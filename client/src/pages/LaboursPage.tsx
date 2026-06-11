import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, Trash2, Users2, Search } from 'lucide-react';
import { api } from '@/lib/api';
import { useConfirm } from '@/hooks/useConfirm';
import { BulkExcel, type BulkExcelConfig } from '@/components/BulkExcel';

type LabourCompany = { id: string; name: string };
type Labour = {
  id: string;
  name: string;
  phone: string | null;
  isActive: boolean;
  companies: { company: LabourCompany }[];
};

export const LaboursPage = () => {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['labours', search],
    queryFn: () => api<{ labours: Labour[] }>(`/labours?search=${encodeURIComponent(search)}`),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api(`/labours/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['labours'] }),
  });
  const { confirm, confirmDialog } = useConfirm();

  const bulkConfig: BulkExcelConfig = {
    entityLabel: 'Workers',
    filenameBase: 'workers',
    sheetName: 'Workers',
    template: [
      { header: 'Name', example: 'Ramesh Kumar' },
      { header: 'Phone', example: '+91 98765 43210' },
    ],
    fetchExportRows: async () => {
      const all = await api<{ labours: Array<Record<string, unknown>> }>('/labours');
      return all.labours.map((l) => ({
        'Name': (l.name as string) ?? '',
        'Phone': (l.phone as string) ?? '',
      }));
    },
    importPath: '/labours/import',
    onImported: () => queryClient.invalidateQueries({ queryKey: ['labours'] }),
  };

  return (
    <div className="space-y-4 max-w-4xl">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Users2 className="h-5 w-5 text-brand-600" /> Workers
        </h1>
        <div className="flex items-center gap-2">
          <BulkExcel config={bulkConfig} />
          <Link to="/settings/labours/new" className="btn-primary">
            <Plus className="h-4 w-4" /> Add Worker
          </Link>
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="flex items-center gap-3 border-b border-slate-200 px-4 py-3">
          <div className="relative flex-1 max-w-md">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              className="input pl-9"
              placeholder="Search workers…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="text-xs text-slate-500 ml-auto">
            {data ? `${data.labours.length} worker${data.labours.length === 1 ? '' : 's'}` : ''}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2.5 font-medium">Name</th>
                <th className="px-4 py-2.5 font-medium">Phone</th>
                <th className="px-4 py-2.5 font-medium">Companies</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
                <th className="px-4 py-2.5 w-24"></th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr><td colSpan={5} className="px-4 py-10 text-center text-slate-400">Loading…</td></tr>
              )}
              {!isLoading && data?.labours.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-slate-400">
                    No workers yet.{' '}
                    <Link to="/settings/labours/new" className="text-brand-700 font-medium hover:text-brand-800">
                      Add your first worker →
                    </Link>
                  </td>
                </tr>
              )}
              {data?.labours.map((l) => (
                <tr key={l.id} className="border-t border-slate-100 hover:bg-slate-50/60">
                  <td className="px-4 py-2.5 font-medium">{l.name}</td>
                  <td className="px-4 py-2.5 text-slate-600">{l.phone ?? '—'}</td>
                  <td className="px-4 py-2.5">
                    <div className="flex flex-wrap gap-1">
                      {l.companies.map(({ company }) => (
                        <span key={company.id} className="rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-medium text-brand-700">
                          {company.name}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-2.5">
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${l.isActive ? 'bg-green-50 text-green-700' : 'bg-slate-100 text-slate-500'}`}>
                      {l.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <div className="inline-flex items-center gap-1">
                      <Link to={`/settings/labours/${l.id}`} className="btn-ghost text-brand-700 hover:bg-brand-50" title="Edit">
                        <Pencil className="h-4 w-4" />
                      </Link>
                      <button
                        onClick={async () => {
                          const ok = await confirm({
                            title: 'Delete worker?',
                            message: <>Delete worker <strong>{l.name}</strong>?</>,
                            tone: 'danger',
                            confirmLabel: 'Delete',
                          });
                          if (ok) remove.mutate(l.id);
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
      </div>
      {confirmDialog}
    </div>
  );
};
