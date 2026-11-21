import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Search, ShieldCheck, UserCog, Building2, Trash2, Loader2 } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { useConfirm } from '@/hooks/useConfirm';
import { cn } from '@/lib/cn';
import { Pagination } from '@/components/Pagination';

type UserRow = {
  id: string;
  email: string;
  username: string;
  name: string;
  isPlatformAdmin: boolean;
  isActive: boolean;
  memberships: { companyName: string; role: string }[];
};

type ListResp = { items: UserRow[]; total: number; page: number; pageSize: number };

const PAGE_SIZE = 20;

export const UsersListPage = () => {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZE);
  const changePageSize = (n: number) => { setPageSize(n); setPage(1); };
  useEffect(() => { setPage(1); }, [search]);
  const qc = useQueryClient();
  const { confirm, alert, confirmDialog } = useConfirm();
  const meId = useAuthStore((st) => st.user?.id);
  const [busyId, setBusyId] = useState<string | null>(null);

  const removeUser = useMutation({
    mutationFn: (id: string) => api(`/users/${id}/permanent`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  });

  // Ask first: `createdById` has no cascade, so anyone who has actually done
  // work must be disabled rather than deleted, or their records lose an author.
  const onDelete = async (u: UserRow) => {
    setBusyId(u.id);
    try {
      const chk = await api<{ deletable: boolean; blockers: string[] }>(`/users/${u.id}/deletable`);
      if (!chk.deletable) {
        await alert({
          title: 'Can’t delete this user',
          message: (
            <>
              <strong>{u.name}</strong> has created {chk.blockers.join(', ')}. Deleting the account would leave those records
              without an author, so <strong>disable</strong> it instead — they keep their access removed but the history stays intact.
            </>
          ),
          tone: 'warning',
        });
        return;
      }
      const ok = await confirm({
        title: 'Delete user?',
        message: <>Permanently delete <strong>{u.name}</strong> (@{u.username})? They have created nothing, so no records are affected. Their sessions and memberships go with them. This cannot be undone.</>,
        tone: 'danger', confirmLabel: 'Delete',
      });
      if (ok) removeUser.mutate(u.id);
    } finally { setBusyId(null); }
  };
  const { data, isLoading } = useQuery({
    queryKey: ['users', search, page, pageSize],
    queryFn: () => api<ListResp>(`/users?search=${encodeURIComponent(search)}&page=${page}&pageSize=${pageSize}`),
  });

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-bold tracking-tight sm:text-2xl">Users</h1>
        <Link to="/settings/users/new" className="btn-primary">
          <Plus className="h-4 w-4" /> Add User
        </Link>
      </div>

      <div className="card overflow-hidden">
        <div className="flex items-center gap-3 border-b border-slate-200 px-3 py-3 sm:px-4">
          <div className="relative min-w-0 flex-1 sm:max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              className="input pl-9"
              placeholder="Search name, email, User ID"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="shrink-0 text-xs text-slate-500">{data ? `${data.total} user${data.total === 1 ? '' : 's'}` : ''}</div>
        </div>

        {/* Phones: one card per user. The table needs ~800px, so it only shows from lg up. */}
        <ul className="divide-y divide-slate-100 lg:hidden">
          {isLoading && <li className="px-4 py-10 text-center text-sm text-slate-400">Loading…</li>}
          {!isLoading && data?.items.length === 0 && (
            <li className="px-4 py-10 text-center text-sm text-slate-400">No users yet — tap "Add User" to get started.</li>
          )}
          {data?.items.map((u) => (
            <li key={u.id} className="px-3 py-3">
              <div className="flex items-start gap-3">
                <Avatar u={u} />
                <Link to={`/settings/users/${u.id}`} className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <span className="font-medium text-slate-900">{u.name}</span>
                    <StatusPill active={u.isActive} />
                  </div>
                  <div className="truncate font-mono text-xs text-slate-500">@{u.username}</div>
                  <div className="truncate text-xs text-slate-500">{u.email}</div>
                  {u.isPlatformAdmin && <PlatformTag />}
                </Link>
                <RowActions u={u} meId={meId} busy={busyId === u.id || removeUser.isPending} spinning={busyId === u.id} onDelete={onDelete} />
              </div>
              <div className="mt-2 pl-10"><Companies list={u.memberships} /></div>
            </li>
          ))}
        </ul>

        <div className="hidden overflow-x-auto lg:block">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">User ID</th>
              <th className="px-4 py-3">Email</th>
              <th className="px-4 py-3">Companies</th>
              <th className="px-4 py-3 w-24">Status</th>
              <th className="px-4 py-3 w-20"></th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr><td colSpan={6} className="px-4 py-10 text-center text-slate-400">Loading…</td></tr>
            )}
            {!isLoading && data?.items.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-10 text-center text-slate-400">No users yet — click "Add User" to get started.</td></tr>
            )}
            {data?.items.map((u) => (
              <tr key={u.id} className="border-t border-slate-100 hover:bg-slate-50">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <Avatar u={u} />
                    <div>
                      <div className="font-medium text-slate-900">{u.name}</div>
                      {u.isPlatformAdmin && <PlatformTag />}
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3 font-mono text-xs text-slate-600">@{u.username}</td>
                <td className="px-4 py-3 text-slate-600">{u.email}</td>
                <td className="px-4 py-3"><Companies list={u.memberships} /></td>
                <td className="px-4 py-3"><StatusPill active={u.isActive} /></td>
                <td className="px-4 py-3 text-right">
                  <RowActions u={u} meId={meId} busy={busyId === u.id || removeUser.isPending} spinning={busyId === u.id} onDelete={onDelete} />
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

const Avatar = ({ u }: { u: UserRow }) => (
  <div className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-brand-100 text-xs font-semibold text-brand-700">
    {u.name?.[0]?.toUpperCase()}
  </div>
);

const PlatformTag = () => (
  <div className="flex items-center gap-1 text-[10px] font-semibold text-amber-700">
    <ShieldCheck className="h-3 w-3" /> PLATFORM
  </div>
);

const StatusPill = ({ active }: { active: boolean }) => (
  <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-medium', active ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500')}>
    {active ? 'Active' : 'Disabled'}
  </span>
);

const Companies = ({ list }: { list: UserRow['memberships'] }) =>
  list.length === 0 ? <span className="text-xs text-slate-400">No company</span> : (
    <div className="flex flex-wrap gap-1">
      {list.slice(0, 3).map((m, i) => (
        <span key={i} className="inline-flex max-w-full items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-700">
          <Building2 className="h-3 w-3 shrink-0" />
          <span className="truncate">{m.companyName}</span>
          <span className="text-slate-400">·</span>
          <span className="text-brand-700">{m.role}</span>
        </span>
      ))}
      {list.length > 3 && <span className="text-[11px] text-slate-400">+{list.length - 3}</span>}
    </div>
  );

const RowActions = ({ u, meId, busy, spinning, onDelete }: {
  u: UserRow; meId?: string; busy: boolean; spinning: boolean; onDelete: (u: UserRow) => void;
}) => (
  <div className="inline-flex shrink-0 items-center gap-1">
    <Link to={`/settings/users/${u.id}`} className="btn-ghost text-brand-700 hover:bg-brand-50" title="Edit user" aria-label={`Edit ${u.name}`}>
      <UserCog className="h-4 w-4" />
    </Link>
    {u.id !== meId && (
      <button
        onClick={() => onDelete(u)}
        disabled={busy}
        className="btn-ghost text-red-600 hover:bg-red-50 disabled:opacity-40"
        title="Delete user (only if they've created nothing)"
        aria-label={`Delete ${u.name}`}
      >
        {spinning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
      </button>
    )}
  </div>
);
