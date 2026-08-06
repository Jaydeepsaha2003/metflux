import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft, Save, Trash2, Building2, Star, ShieldCheck, Loader2, Eye, EyeOff,
  UserCog, LayoutDashboard, FileText, ShoppingCart, ClipboardList, Factory,
  Calculator, Truck, PackageCheck, RotateCcw, Receipt, Layers, Check, X,
  type LucideIcon,
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
  hideCustomerNames: boolean;
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

// Same icon language as the sidebar nav (AppLayout) — so a category card here
// visually ties back to the menu it actually gates.
const GROUP_ICON: Record<string, LucideIcon> = {
  Overview: LayoutDashboard,
  'Sales Orders': FileText,
  'Supplier Orders': ShoppingCart,
  'Work Allotment': ClipboardList,
  Production: Factory,
  Testing: Calculator,
  Dispatch: Truck,
  'Lorry Receipts': PackageCheck,
  Returns: RotateCcw,
  Accounts: Receipt,
  'Master Data': Layers,
  Administration: ShieldCheck,
};

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
      hideCustomerNames: !!(m as Membership).hideCustomerNames,
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
      {
        companyId, companyName: co.name, role: 'STAFF', permissions: [],
        isPrimary: prev.length === 0, hideCustomerNames: false,
      },
    ]);
  };

  const updateLocal = (idx: number, patch: Partial<Membership>) => {
    setMemberships((prev) => prev.map((m, i) => (i === idx ? { ...m, ...patch } : m)));
  };

  const setPrimary = (idx: number) => {
    setMemberships((prev) => prev.map((m, i) => ({ ...m, isPrimary: i === idx })));
  };

  /* ----- live membership endpoints (only when editing) -----
     Each of these surfaces server-side errors back into the page-level
     `error` state — previously a silent onError meant a 4xx response left
     the UI completely unchanged, so users would click Save and think the
     request was being ignored.  */
  const surfaceErr = (fallback: string) => (e: unknown) =>
    setError(e instanceof ApiError ? e.message : fallback);

  const persistMembership = useMutation({
    mutationFn: (m: Membership) =>
      api<UserDetail>(`/users/${id}/memberships`, { method: 'POST', json: m }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['user', id] }); setError(null); },
    onError: surfaceErr('Could not save membership'),
  });
  const updateMembershipMut = useMutation({
    mutationFn: (m: Membership) =>
      api<UserDetail>(`/users/${id}/memberships/${m.id}`, { method: 'PATCH', json: m }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['user', id] }); setError(null); },
    onError: surfaceErr('Could not save membership'),
  });
  const removeMembershipMut = useMutation({
    mutationFn: (mid: string) =>
      api(`/users/${id}/memberships/${mid}`, { method: 'DELETE' }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['user', id] }); setError(null); },
    onError: surfaceErr('Could not remove membership'),
  });

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Link to="/settings/users" className="btn-ghost text-slate-600">
            <ArrowLeft className="h-4 w-4" /> Back
          </Link>
          <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight sm:text-2xl">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand-50 text-brand-600">
              <UserCog className="h-4 w-4" />
            </span>
            {isEdit ? `Edit user${user ? ` — ${user.name}` : ''}` : 'New user'}
          </h1>
        </div>
      </div>

      <form onSubmit={submit} className="space-y-5">
        {/* Basic info */}
        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
          <h2 className="mb-4 text-sm font-semibold text-slate-900">Account</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name" value={name} onChange={setName} required />
            <Field label="Email" type="email" value={email} onChange={setEmail} required />
            <Field label="User ID" value={username} onChange={(v) => setUsername(v.toLowerCase())} required hint="3–30 chars: letters, numbers, _ and -" />
            <PasswordField label={isEdit ? 'New password (leave blank to keep)' : 'Password'} value={password} onChange={setPassword} required={!isEdit} hint="Min 8 characters" />
          </div>
          {me?.isPlatformAdmin && (
            <label className="mt-4 flex cursor-pointer items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 transition-colors hover:bg-amber-100/70">
              <input type="checkbox" className="mt-0.5 h-4 w-4 rounded border-amber-300 accent-amber-600" checked={isPlatformAdmin} onChange={(e) => setIsPlatformAdmin(e.target.checked)} />
              <span>
                <span className="flex items-center gap-1.5 text-sm font-semibold text-amber-900">
                  <ShieldCheck className="h-4 w-4 text-amber-600" /> Platform admin
                </span>
                <span className="mt-0.5 block text-xs text-amber-700">Can access every company on this server.</span>
              </span>
            </label>
          )}
        </section>

        {/* Memberships */}
        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">Company assignments</h2>
              <p className="mt-0.5 text-xs text-slate-500">Pick a role and tick the actions this person can perform in each company.</p>
            </div>
            {availableCompanies.length > 0 && (
              <select
                className="input w-full sm:w-56"
                onChange={(e) => { if (e.target.value) addMembership(e.target.value); e.currentTarget.value = ''; }}
                defaultValue=""
              >
                <option value="">+ Add company…</option>
                {availableCompanies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            )}
          </div>

          {memberships.length === 0 && (
            <div className="mt-4 rounded-lg border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
              No company assigned yet. Use the dropdown to add one.
            </div>
          )}

          <div className="mt-4 space-y-3">
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

// Password field with a show/hide (eye) toggle so you can verify what you type.
const PasswordField = ({
  label, value, onChange, required, hint,
}: {
  label: string; value: string; onChange: (v: string) => void; required?: boolean; hint?: string;
}) => {
  const [show, setShow] = useState(false);
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">{label}</span>
      <div className="relative">
        <input
          className="input pr-10"
          type={show ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          required={required}
          autoComplete="new-password"
        />
        <button
          type="button"
          onClick={() => setShow((s) => !s)}
          tabIndex={-1}
          title={show ? 'Hide password' : 'Show password'}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
        >
          {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
      {hint && <span className="mt-1 block text-xs text-slate-400">{hint}</span>}
    </label>
  );
};

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
  const setGroup = (keys: PermissionKey[], on: boolean) => {
    const next = on
      ? Array.from(new Set([...membership.permissions, ...keys]))
      : membership.permissions.filter((k) => !keys.includes(k));
    onChange({ permissions: next });
  };
  const totalKeys = PERMISSION_GROUPS.reduce((n, g) => n + g.keys.length, 0);
  const grantedCount = membership.permissions.length;

  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-4 py-3">
        <div className="flex items-center gap-2 font-medium text-slate-900">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand-50 text-brand-600">
            <Building2 className="h-4 w-4" />
          </span>
          {membership.companyName ?? membership.companyId}
        </div>

        {/* Role — segmented control instead of a native select, so the current
            role reads at a glance and matches the app's other filter pickers. */}
        <div className="inline-flex rounded-lg bg-slate-100 p-0.5 text-xs">
          {(['COMPANY_ADMIN', 'MANAGER', 'STAFF'] as const).map((r) => (
            <button
              key={r} type="button" onClick={() => onChange({ role: r })}
              className={cn(
                'rounded-md px-2.5 py-1.5 font-semibold transition-colors',
                membership.role === r ? 'bg-white text-brand-700 shadow-sm' : 'text-slate-500 hover:text-slate-800'
              )}
            >
              {r === 'COMPANY_ADMIN' ? 'Admin' : r === 'MANAGER' ? 'Manager' : 'Staff'}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={onSetPrimary}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium transition-colors',
            membership.isPrimary ? 'text-amber-600' : 'text-slate-400 hover:text-slate-600'
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

      <div className="p-4">
        {/* Privacy toggle — applies to MANAGER and STAFF. Company admins
            always see names since they often manage the customer records. */}
        {!isAdmin && (
          <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 transition-colors hover:bg-slate-100">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 rounded border-slate-300 accent-brand-600"
              checked={!!membership.hideCustomerNames}
              onChange={(e) => onChange({ hideCustomerNames: e.target.checked })}
            />
            <span className="flex-1">
              <span className="flex items-center gap-1.5 text-sm font-medium text-slate-700">
                <EyeOff className="h-3.5 w-3.5 text-slate-500" />
                Hide customer names in this company
              </span>
              <span className="mt-0.5 block text-[11px] text-slate-500">
                When ticked, this user only sees customer codes (e.g. AAR-001) in production,
                dispatch and reports. Names stay visible on PDFs that go to customers.
              </span>
            </span>
          </label>
        )}

        {isAdmin ? (
          <div className="mt-3 flex items-center gap-2 rounded-lg bg-brand-50 px-3 py-2.5 text-xs text-brand-800">
            <ShieldCheck className="h-4 w-4 shrink-0 text-brand-600" />
            Company admins automatically have every permission in this company.
          </div>
        ) : (
          <>
            <div className="mt-3 flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                Menu &amp; page permissions
              </span>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600 tabular-nums">
                {grantedCount} / {totalKeys} granted
              </span>
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {PERMISSION_GROUPS.map((group) => {
                const Icon = GROUP_ICON[group.label] ?? Layers;
                const allOn = group.keys.every((k) => membership.permissions.includes(k));
                const someOn = group.keys.some((k) => membership.permissions.includes(k));
                return (
                  <div key={group.label} className="rounded-lg border border-slate-200 bg-slate-50/60 p-3">
                    <div className="mb-2 flex items-center gap-2">
                      <span className={cn(
                        'grid h-6 w-6 shrink-0 place-items-center rounded-md',
                        someOn ? 'bg-brand-100 text-brand-700' : 'bg-slate-200 text-slate-500'
                      )}>
                        <Icon className="h-3.5 w-3.5" />
                      </span>
                      <span className="flex-1 text-xs font-semibold uppercase tracking-wide text-slate-600">{group.label}</span>
                      <button
                        type="button"
                        onClick={() => setGroup(group.keys, !allOn)}
                        className="rounded p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-700"
                        title={allOn ? 'Clear this group' : 'Grant all in this group'}
                      >
                        {allOn ? <X className="h-3.5 w-3.5" /> : <Check className="h-3.5 w-3.5" />}
                      </button>
                    </div>
                    <div className="space-y-0.5">
                      {group.keys.map((key) => {
                        const on = membership.permissions.includes(key);
                        return (
                          <label
                            key={key}
                            className={cn(
                              'flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-[13px] transition-colors',
                              on ? 'bg-brand-50 text-brand-900' : 'text-slate-600 hover:bg-slate-100'
                            )}
                          >
                            <input
                              type="checkbox"
                              className="h-3.5 w-3.5 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                              checked={on}
                              onChange={(e) => togglePerm(key, e.target.checked)}
                            />
                            <span className="leading-snug">{labelFor(key)}</span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

/* lightweight label lookup to avoid importing the labels object — we already have the keys grouped. */
import { PERMISSION_LABELS } from '@/lib/permissions';
const labelFor = (k: PermissionKey) => PERMISSION_LABELS[k];
