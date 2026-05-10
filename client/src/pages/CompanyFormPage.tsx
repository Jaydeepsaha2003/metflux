// Add or edit a company. Platform-admin only. After creating, refreshes the
// auth state so the new company appears in the sidebar's company switcher
// without needing a page reload.
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Save, Trash2, Loader2, Building2, ImagePlus, X } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useAuthStore, type LoginPayload } from '@/store/auth';
import { useConfirm } from '@/hooks/useConfirm';

type Company = {
  id: string;
  name: string;
  slug: string;
  gstNumber: string | null;
  address: string | null;
  phone: string | null;
  whatsappNumber: string | null;
  email: string | null;
  logoUrl: string | null;
  isActive: boolean;
};

type Form = {
  name: string;
  gstNumber: string;
  address: string;
  phone: string;
  whatsappNumber: string;
  email: string;
};

const empty: Form = { name: '', gstNumber: '', address: '', phone: '', whatsappNumber: '', email: '' };

export const CompanyFormPage = () => {
  const { id } = useParams();
  const isEdit = !!id;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const setSession = useAuthStore((s) => s.setSession);

  const [form, setForm] = useState<Form>(empty);
  const [joinAsAdmin, setJoinAsAdmin] = useState(true);
  const [error, setError] = useState<{ message: string; details?: string[] } | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [logoError, setLogoError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const { confirm, confirmDialog } = useConfirm();

  const { data: existing } = useQuery({
    queryKey: ['company', id],
    queryFn: () => api<Company>(`/companies/${id}`),
    enabled: isEdit,
  });

  useEffect(() => {
    if (!existing) return;
    setForm({
      name: existing.name,
      gstNumber: existing.gstNumber ?? '',
      address: existing.address ?? '',
      phone: existing.phone ?? '',
      whatsappNumber: existing.whatsappNumber ?? '',
      email: existing.email ?? '',
    });
    setLogoPreview(existing.logoUrl ?? null);
  }, [existing]);

  // After creating, pull a fresh refresh-token round-trip so the sidebar
  // switcher picks up the new company immediately.
  const refreshAuth = async () => {
    try {
      const data = await api<LoginPayload>('/auth/refresh', { method: 'POST' });
      setSession(data);
    } catch { /* ignore — user can sign in again if it fails */ }
  };

  const uploadLogo = useMutation({
    mutationFn: ({ companyId, file }: { companyId: string; file: File }) => {
      const fd = new FormData();
      fd.append('logo', file);
      return api<Company>(`/companies/${companyId}/logo`, { method: 'POST', body: fd });
    },
    onSuccess: async (data) => {
      setLogoPreview(data.logoUrl);
      setLogoError(null);
      queryClient.invalidateQueries({ queryKey: ['company', id] });
      await refreshAuth();
    },
    onError: () => setLogoError('Upload failed — check file type and size (max 2 MB).'),
  });

  const removeLogo = useMutation({
    mutationFn: (companyId: string) => api(`/companies/${companyId}/logo`, { method: 'DELETE' }),
    onSuccess: async () => {
      setLogoPreview(null);
      queryClient.invalidateQueries({ queryKey: ['company', id] });
      await refreshAuth();
    },
  });

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !id) return;
    uploadLogo.mutate({ companyId: id, file });
    e.target.value = '';
  };

  // Surface Zod field errors so the user sees *which* field broke.
  const handleApiError = (e: unknown) => {
    if (e instanceof ApiError) {
      const d = (e.details ?? {}) as { fieldErrors?: Record<string, string[]>; formErrors?: string[] };
      const lines: string[] = [];
      for (const [field, msgs] of Object.entries(d.fieldErrors ?? {})) {
        for (const m of msgs ?? []) lines.push(`${field}: ${m}`);
      }
      for (const m of d.formErrors ?? []) lines.push(m);
      setError({ message: e.message, details: lines.length ? lines : undefined });
    } else {
      setError({ message: 'Save failed' });
    }
  };

  const create = useMutation({
    mutationFn: (body: Form & { joinAsAdmin: boolean }) =>
      api<Company>('/companies', { method: 'POST', json: body }),
    onSuccess: async () => {
      queryClient.invalidateQueries({ queryKey: ['companies'] });
      await refreshAuth();
      navigate('/settings/companies');
    },
    onError: handleApiError,
  });

  const update = useMutation({
    mutationFn: (body: Form) => api<Company>(`/companies/${id}`, { method: 'PATCH', json: body }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['companies'] });
      queryClient.invalidateQueries({ queryKey: ['company', id] });
      navigate('/settings/companies');
    },
    onError: handleApiError,
  });

  const remove = useMutation({
    mutationFn: () => api(`/companies/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['companies'] });
      navigate('/settings/companies');
    },
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (isEdit) update.mutate(form);
    else create.mutate({ ...form, joinAsAdmin });
  };

  const set = <K extends keyof Form>(key: K, value: Form[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const busy = create.isPending || update.isPending;

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-center gap-3">
        <Link to="/settings/companies" className="btn-ghost text-slate-600">
          <ArrowLeft className="h-4 w-4" /> Back
        </Link>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Building2 className="h-5 w-5 text-brand-600" />
          {isEdit ? `Edit company${existing ? ` — ${existing.name}` : ''}` : 'New company'}
        </h1>
      </div>

      <form onSubmit={submit} className="card p-5 space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Company name" required>
            <input className="input" value={form.name} onChange={(e) => set('name', e.target.value.toUpperCase())} required />
          </Field>
          <Field label="Company Phone">
            <input className="input" value={form.phone} onChange={(e) => set('phone', e.target.value)} placeholder="+91 11 4567 8900" />
          </Field>
          <Field label="WhatsApp Number">
            <input className="input" value={form.whatsappNumber} onChange={(e) => set('whatsappNumber', e.target.value)} placeholder="+91 98765 43210" />
          </Field>
          <Field label="Email">
            <input className="input" type="email" value={form.email} onChange={(e) => set('email', e.target.value)} />
          </Field>
          <Field label="GSTIN">
            <input className="input" value={form.gstNumber} onChange={(e) => set('gstNumber', e.target.value.toUpperCase())} placeholder="22AAAAA0000A1Z5" />
          </Field>
          <Field label="Address" full>
            <textarea
              className="input min-h-[80px]"
              value={form.address}
              onChange={(e) => set('address', e.target.value.toUpperCase())}
              rows={2}
            />
          </Field>
        </div>

        {/* Logo upload — only available after company is created */}
        {isEdit && (
          <div className="space-y-2">
            <span className="block text-xs font-medium uppercase tracking-wide text-slate-500">Company Logo</span>
            <div className="flex items-center gap-4">
              {/* Preview box */}
              <div className="relative flex h-20 w-20 shrink-0 items-center justify-center rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 overflow-hidden">
                {logoPreview ? (
                  <>
                    <img
                      src={logoPreview}
                      alt="Company logo"
                      className="h-full w-full object-contain p-1"
                    />
                    <button
                      type="button"
                      onClick={() => id && removeLogo.mutate(id)}
                      disabled={removeLogo.isPending}
                      title="Remove logo"
                      className="absolute right-0.5 top-0.5 rounded-full bg-red-500 p-0.5 text-white opacity-0 hover:opacity-100 focus:opacity-100 transition-opacity"
                      style={{ opacity: removeLogo.isPending ? 1 : undefined }}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </>
                ) : (
                  <Building2 className="h-8 w-8 text-slate-300" />
                )}
              </div>
              <div className="space-y-1.5">
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  disabled={uploadLogo.isPending}
                  className="btn-ghost text-sm"
                >
                  {uploadLogo.isPending
                    ? <><Loader2 className="h-4 w-4 animate-spin" /> Uploading…</>
                    : <><ImagePlus className="h-4 w-4" /> {logoPreview ? 'Change logo' : 'Upload logo'}</>
                  }
                </button>
                <p className="text-[11px] text-slate-400">JPEG, PNG, WebP or SVG · max 2 MB</p>
                {logoError && <p className="text-[11px] text-red-600">{logoError}</p>}
              </div>
              <input
                ref={fileRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/svg+xml"
                className="hidden"
                onChange={onFileChange}
              />
            </div>
          </div>
        )}

        {!isEdit && (
          <div className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-500">
            <span className="font-medium text-slate-700">Logo:</span> You can upload a company logo after creating the company.
          </div>
        )}

        {!isEdit && (
          <label className="flex items-start gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4"
              checked={joinAsAdmin}
              onChange={(e) => setJoinAsAdmin(e.target.checked)}
            />
            <span>
              <span className="font-medium text-slate-900">Add me as Company Admin</span>
              <span className="block text-xs text-slate-500">
                Recommended — gives you full access in the new company so it appears in your sidebar switcher.
              </span>
            </span>
          </label>
        )}

        {existing && (
          <div className="rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-600">
            <span className="font-medium">Slug:</span> <span className="font-mono">{existing.slug}</span>
            <span className="ml-3 text-slate-400">(used internally; cannot be changed)</span>
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            <div className="font-medium">{error.message}</div>
            {error.details && (
              <ul className="mt-1 list-disc pl-5 text-xs">
                {error.details.map((d, i) => <li key={i}>{d}</li>)}
              </ul>
            )}
          </div>
        )}

        <div className="flex justify-between gap-3 border-t border-slate-200 pt-4">
          {isEdit ? (
            <button
              type="button"
              onClick={async () => {
                const ok = await confirm({
                  title: 'Disable company?',
                  message: <>Disable <strong>{existing?.name ?? 'this company'}</strong>? Users won't be able to switch into it.</>,
                  tone: 'warning',
                  confirmLabel: 'Disable',
                });
                if (ok) remove.mutate();
              }}
              className="btn-danger"
              disabled={remove.isPending}
            >
              <Trash2 className="h-4 w-4" /> Disable
            </button>
          ) : <span />}
          <div className="flex gap-3">
            <Link to="/settings/companies" className="btn-ghost">Cancel</Link>
            <button type="submit" disabled={busy} className="btn-primary">
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              <Save className="h-4 w-4" /> {isEdit ? 'Save changes' : 'Create company'}
            </button>
          </div>
        </div>
      </form>
      {confirmDialog}
    </div>
  );
};

const Field = ({
  label, children, required, full,
}: { label: string; children: React.ReactNode; required?: boolean; full?: boolean }) => (
  <label className={`block ${full ? 'sm:col-span-2' : ''}`}>
    <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
      {label}
      {required && <span className="ml-1 text-red-500">*</span>}
    </span>
    {children}
  </label>
);
