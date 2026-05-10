import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft, Save, Trash2, Building2, Star, ShieldCheck, Loader2,
} from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { cn } from '@/lib/cn';
import { PERMISSION_GROUPS, type PermissionKey } from '@/lib/permissions';

type Role = 'COMPANY_ADMIN' | 'MANAGER' | 'STAFF';

type Membership = {
  id?: string;            // present for existing memberships
  companyId: string;
  companyName?: string;
  role: Role;
  permissions: PermissionKey[];
  isPrimary: boolean;
};

type UserDetail = {
  id: string;
  name: string;
  email: string;
  username: string;
  isPlatformAdmin: boolean;
  isActive: boolean;
  memberships: (Membership & { id: string; companyName: string })[];
};

type Company = { id: string; name: string };

export const UserFormPage = () => {
  const { id } = useParams();
  const isEdit = !!id;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const me = useAuthStore((s) => s.user);

  /* ----- existing user data ----- */
  const { data: user } = useQuery({
    queryKey: ['user', id],
    queryFn: () => api<UserDetail>(`/users/${id}`),
    enabled: isEdit,
  });

  /* ----- companies the caller can assign to ----- */
  const { data: meta } = useQuery({
    queryKey: ['users-meta-companies'],
    queryFn: () => api<{ companies: Company[] }>('/users/_meta/companies'),
  });

  /* ----- form state ----- */
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false);
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    setName(user.name);
    setEmail(user.email);
    setUsername(user.username);
    setIsPlatformAdmin(user.isPlatformAdmin);
    setMemberships(user.memberships.map((m) => ({
      id: m.id, companyId: m.companyId, companyName: m.companyName,
      role: m.role, permissions: m.permissions, isPrimary: m.isPrimary,
    })));
  }, [user]);

  /* ----- create / update ----- */
  const create = useMutation({
    mutationFn: (body: unknown) => api<UserDetail>('/users', { method: 'POST', json: body }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      navigate('/settings/users');
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Save failed'),
  });

  const updateBasic = useMutation({
    mutationFn: (body: unknown) => api<UserDetail>(`/users/${id}`, { method: 'PATCH', json: body }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      queryClient.invalidateQueries({ queryKey: ['user', id] });
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Save failed'),
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (isEdit) {
      const body: Record<string, unknown> = { name, email, username, isPlatformAdmin };
      if (password) body.password = password;
      updateBasic.mutate(body);
    } else {
      create.mutate({ name, email, username, password, isPlatformAdmin, memberships });
    }
  };

  /* ----- memberships UI handlers ----- */
  const availableCompanies = useMemo(() => {
    const used = new Set(memberships.map((m) => m.companyId));
    return (meta?.companies ?? []).filter((c) => !used.has(c.id));
  }, [memberships, meta]);

  const addMembership = (companyId: string) => {
    const co = meta?.companies.find((c) => c.id === companyId);
    if (!co) return;
    setMemberships((prev) => [
      ...prev,
      { companyId, companyName: co.name, role: 'STAFF', permissions: [], isPrimary: prev.length === 0 },
    ]);
  };

  const updateLocal = (idx: number, patch: Partial<Membership>) => {
    setMemberships((prev) => prev.map((m, i) => (i === idx ? { ...m, ...patch } : m)));
  };

  const setPrimary = (idx: number) => {
    setMemberships((prev) => prev.map((m, i) => ({ ...m, isPrimary: i === idx })));
  };

  /* ----- live membership endpoints (only when editing) ----- */
  const persistMembership = useMutation({
    mutationFn: (m: Membership) =>
      api<UserDetail>(`/users/${id}/memberships`, { method: 'POST', json: m }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['user', id] }),
  });
  const updateMembershipMut = useMutation({
    mutationFn: (m: Membership) =>
      api<UserDetail>(`/users/${id}/memberships/${m.id}`, { method: 'PATCH', json: m }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['user', id] }),
  });
  const removeMembershipMut = useMutation({
    mutationFn: (mid: string) =>
      api(`/users/${id}/memberships/${mid}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['user', id] }),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link to="/settings/users" className="btn-ghost text-slate-600">
          <ArrowLeft className="h-4 w-4" /> Back
        </Link>
        <h1 className="text-2xl font-bold tracking-tight">
          {isEdit ? `Edit user${user ? ` — ${user.name}` : ''}` : 'New user'}
        </h1>
      </div>

      <form onSubmit={submit} className="space-y-6">
        {/* Basic info */}
        <section className="card p-5 space-y-4">
          <h2 className="font-semibold text-slate-900">Account</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name" value={name} onChange={setName} required />
            <Field label="Email" type="email" value={email} onChange={setEmail} required />
            <Field label="User ID" value={username} onChange={(v) => setUsername(v.toLowerCase())} required hint="3–30 chars: letters, numbers, _ and -" />
            <Field label={isEdit ? 'New password (leave blank to keep)' : 'Password'} type="password" value={password} onChange={setPassword} required={!isEdit} hint="Min 8 characters" />
          </div>
          {me?.isPlatformAdmin && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="h-4 w-4" checked={isPlatformAdmin} onChange={(e) => setIsPlatformAdmin(e.target.checked)} />
              <ShieldCheck className="h-4 w-4 text-amber-600" />
              <span className="font-medium">Platform admin</span>
              <span className="text-slate-500">— can access every company on this server</span>
            </label>
          )}
        </section>

        {/* Memberships */}
        <section className="card p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-semibold text-slate-900">Company assignments</h2>
              <p className="text-sm text-slate-500">Pick a role and tick the actions this person can perform in each company.</p>
            </div>
            {availableCompanies.length > 0 && (
              <select
                className="input w-56"
                onChange={(e) => { if (e.target.value) addMembership(e.target.value); e.currentTarget.value = ''; }}
                defaultValue=""
              >
                <option value="">+ Add company…</option>
                {availableCompanies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            )}
          </div>

          {memberships.length === 0 && (
            <div className="rounded-lg border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
              No company assigned yet. Use the dropdown to add one.
            </div>
          )}

          <div className="space-y-3">
            {memberships.map((m, idx) => (
              <MembershipCard
                key={m.companyId}
                membership={m}
                isEdit={isEdit}
                onChange={(patch) => updateLocal(idx, patch)}
                onSetPrimary={() => setPrimary(idx)}
                onSaveLive={() => {
                  if (!isEdit) return;
                  if (m.id) updateMembershipMut.mutate(m);
                  else persistMembership.mutate(m);
                }}
                onRemove={() => {
                  if (isEdit && m.id) removeMembershipMut.mutate(m.id);
                  setMemberships((prev) => prev.filter((_, i) => i !== idx));
                }}
              />
            ))}
          </div>
        </section>

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
        )}

        <div className="flex justify-end gap-3">
          <Link to="/settings/users" className="btn-ghost">Cancel</Link>
          <button
            type="submit"
            disabled={create.isPending || updateBasic.isPending}
            className="btn-primary"
          >
            {(create.isPending || updateBasic.isPending) && <Loader2 className="h-4 w-4 animate-spin" />}
            <Save className="h-4 w-4" /> {isEdit ? 'Save account' : 'Create user'}
          </button>
        </div>
      </form>
    </div>
  );
};

/* ---------- field ---------- */
const Field = ({
  label, value, onChange, type = 'text', required, hint,
}: {
  label: string; value: string; onChange: (v: string) => void;
  type?: string; required?: boolean; hint?: string;
}) => (
  <label className="block">
    <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">{label}</span>
    <input className="input" type={type} value={value} onChange={(e) => onChange(e.target.value)} required={required} />
    {hint && <span className="mt-1 block text-xs text-slate-400">{hint}</span>}
  </label>
);

/* ---------- membership card ---------- */
const MembershipCard = ({
  membership, isEdit, onChange, onSetPrimary, onSaveLive, onRemove,
}: {
  membership: Membership;
  isEdit: boolean;
  onChange: (patch: Partial<Membership>) => void;
  onSetPrimary: () => void;
  onSaveLive: () => void;
  onRemove: () => void;
}) => {
  const isAdmin = membership.role === 'COMPANY_ADMIN';
  const togglePerm = (key: PermissionKey, on: boolean) => {
    const next = on
      ? Array.from(new Set([...membership.permissions, key]))
      : membership.permissions.filter((k) => k !== key);
    onChange({ permissions: next });
  };

  return (
    <div className="rounded-xl border border-slate-200 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 font-medium text-slate-900">
          <Building2 className="h-4 w-4 text-brand-600" />
          {membership.companyName ?? membership.companyId}
        </div>
        <select
          className="input w-40"
          value={membership.role}
          onChange={(e) => onChange({ role: e.target.value as Role })}
        >
          <option value="COMPANY_ADMIN">Company admin</option>
          <option value="MANAGER">Manager</option>
          <option value="STAFF">Staff</option>
        </select>
        <button
          type="button"
          onClick={onSetPrimary}
          className={cn(
            'btn-ghost text-xs',
            membership.isPrimary ? 'text-amber-600' : 'text-slate-400'
          )}
          title={membership.isPrimary ? 'Primary company (default after sign-in)' : 'Set as primary company'}
        >
          <Star className={cn('h-3.5 w-3.5', membership.isPrimary && 'fill-amber-400 text-amber-500')} />
          {membership.isPrimary ? 'Primary' : 'Set primary'}
        </button>
        <div className="ml-auto flex gap-2">
          {isEdit && (
            <button type="button" onClick={onSaveLive} className="btn-ghost text-brand-700 hover:bg-brand-50">
              <Save className="h-4 w-4" /> Save
            </button>
          )}
          <button type="button" onClick={onRemove} className="btn-ghost text-red-600 hover:bg-red-50">
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      {isAdmin ? (
        <div className="mt-3 rounded-lg bg-brand-50 px-3 py-2 text-xs text-brand-800">
          Company admins automatically have every permission in this company.
        </div>
      ) : (
        <div className="mt-4 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {PERMISSION_GROUPS.map((group) => (
            <div key={group.label}>
              <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">{group.label}</div>
              <div className="space-y-1">
                {group.keys.map((key) => (
                  <label key={key} className="flex items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-slate-50">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                      checked={membership.permissions.includes(key)}
                      onChange={(e) => togglePerm(key, e.target.checked)}
                    />
                    <span className="text-slate-700">{labelFor(key)}</span>
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

/* lightweight label lookup to avoid importing the labels object — we already have the keys grouped. */
import { PERMISSION_LABELS } from '@/lib/permissions';
const labelFor = (k: PermissionKey) => PERMISSION_LABELS[k];
