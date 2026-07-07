import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Save, Trash2, Loader2, Truck } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useConfirm } from '@/hooks/useConfirm';
import { useAuthStore } from '@/store/auth';

type Company = { id: string; name: string };
type Supplier = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  gstNumber: string | null;
  state: string | null;
  gstRate: number;
  dueDays: number | null;
  notes: string | null;
  companies: { company: Company }[];
};

type Form = {
  name: string;
  email: string;
  phone: string;
  address: string;
  gstNumber: string;
  state: string;
  gstRate: number;
  dueDays: string;
  notes: string;
};

const empty: Form = {
  name: '', email: '', phone: '', address: '', gstNumber: '', state: '', gstRate: 0, dueDays: '', notes: '',
};

export const SupplierFormPage = () => {
  const { id } = useParams();
  const isEdit = !!id;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<Form>(empty);
  const [selectedCompanies, setSelectedCompanies] = useState<string[]>([]);
  const [error, setError] = useState<{ message: string; details?: string[] } | null>(null);
  const { confirm, confirmDialog } = useConfirm();

  // Pull company list from the auth store — no extra API call needed.
  const memberships = useAuthStore((s) => s.memberships);
  const activeCompanyId = useAuthStore((s) => s.activeCompanyId);
  const companies: Company[] = memberships.map((m) => ({ id: m.companyId, name: m.companyName }));

  const { data: existing } = useQuery({
    queryKey: ['supplier', id],
    queryFn: () => api<Supplier>(`/suppliers/${id}`),
    enabled: isEdit,
  });

  useEffect(() => {
    if (existing) {
      setForm({
        name: existing.name,
        email: existing.email ?? '',
        phone: existing.phone ?? '',
        address: existing.address ?? '',
        gstNumber: existing.gstNumber ?? '',
        state: existing.state ?? '',
        gstRate: existing.gstRate ?? 0,
        dueDays: existing.dueDays != null ? String(existing.dueDays) : '',
        notes: existing.notes ?? '',
      });
      setSelectedCompanies(existing.companies.map((c) => c.company.id));
    } else if (!isEdit && activeCompanyId) {
      // Default: just the active company is checked on a new supplier.
      setSelectedCompanies([activeCompanyId]);
    }
  }, [existing, isEdit, activeCompanyId]);

  const save = useMutation({
    mutationFn: (body: unknown) =>
      isEdit
        ? api<Supplier>(`/suppliers/${id}`, { method: 'PATCH', json: body })
        : api<Supplier>('/suppliers', { method: 'POST', json: body }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['suppliers'] });
      queryClient.invalidateQueries({ queryKey: ['supplier', id] });
      queryClient.invalidateQueries({ queryKey: ['creditor-aging'] });
      navigate('/settings/suppliers');
    },
    onError: (e) => {
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
    },
  });

  const remove = useMutation({
    mutationFn: () => api(`/suppliers/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['suppliers'] });
      navigate('/settings/suppliers');
    },
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const missing: string[] = [];
    if (!form.name.trim()) missing.push('Name is required');
    if (selectedCompanies.length === 0) missing.push('Assign to at least one company');
    if (missing.length) {
      setError({ message: 'Please fix the form', details: missing });
      return;
    }
    save.mutate({ ...form, dueDays: form.dueDays === '' ? null : Number(form.dueDays), companyIds: selectedCompanies });
  };

  const set = <K extends keyof Form>(key: K, value: Form[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const toggleCompany = (cid: string) => {
    setSelectedCompanies((prev) =>
      prev.includes(cid) ? prev.filter((x) => x !== cid) : [...prev, cid]
    );
  };

  const busy = save.isPending;

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-center gap-3">
        <Link to="/settings/suppliers" className="btn-ghost text-slate-600">
          <ArrowLeft className="h-4 w-4" /> Back
        </Link>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Truck className="h-5 w-5 text-brand-600" />
          {isEdit ? `Edit supplier${existing ? ` — ${existing.name}` : ''}` : 'New supplier'}
        </h1>
      </div>

      <form onSubmit={submit} className="card p-5 space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" required>
            <input className="input" value={form.name ?? ''} onChange={(e) => set('name', e.target.value.toUpperCase())} required />
          </Field>
          <Field label="Phone">
            <input className="input" value={form.phone ?? ''} onChange={(e) => set('phone', e.target.value)} placeholder="+91 98765 43210" />
          </Field>
          <Field label="Email">
            <input className="input" type="email" value={form.email ?? ''} onChange={(e) => set('email', e.target.value)} />
          </Field>
          <Field label="State">
            <input className="input" value={form.state ?? ''} onChange={(e) => set('state', e.target.value.toUpperCase())} placeholder="e.g. MAHARASHTRA" />
          </Field>
          <Field label="GSTIN">
            <input className="input" value={form.gstNumber ?? ''} onChange={(e) => set('gstNumber', e.target.value.toUpperCase())} placeholder="22AAAAA0000A1Z5" />
          </Field>
          <Field label="GST Rate %" required>
            <input
              className="input" type="number" inputMode="decimal" step="0.01" min={0} max={100}
              value={form.gstRate}
              onChange={(e) => set('gstRate', parseFloat(e.target.value) || 0)}
              placeholder="18"
            />
          </Field>
          <Field label="Credit Terms (Due Days)">
            <input
              className="input" type="number" min={0} max={3650} step="1" inputMode="numeric"
              value={form.dueDays}
              onChange={(e) => set('dueDays', e.target.value)}
              placeholder="e.g. 30"
            />
            <span className="mt-1 block text-[10px] text-slate-400">
              Days allowed to pay after the bill date. Amount Payable uses this to age bills; leave blank to age by bill date.
            </span>
          </Field>
          <Field label="Address" full>
            <textarea
              className="input min-h-[80px]"
              value={form.address ?? ''}
              onChange={(e) => set('address', e.target.value.toUpperCase())}
              rows={2}
            />
          </Field>
          <Field label="Notes" full>
            <textarea
              className="input min-h-[80px]"
              value={form.notes ?? ''}
              onChange={(e) => set('notes', e.target.value)}
              placeholder="Internal notes — payment terms, lead time, etc."
              rows={2}
            />
          </Field>
        </div>

        {/* Company memberships — same supplier can belong to many companies. */}
        <div className="pt-2 border-t border-slate-200">
          <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
            Available in companies <span className="text-red-500">*</span>
          </span>
          <p className="mb-2 text-[11px] text-slate-500">
            Tick every company that should see this supplier in its Supplier PO dropdown.
          </p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {companies.map((c) => (
              <label key={c.id} className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 hover:bg-slate-50">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-slate-300 accent-brand-600"
                  checked={selectedCompanies.includes(c.id)}
                  onChange={() => toggleCompany(c.id)}
                />
                <span className="text-sm font-medium">{c.name}</span>
              </label>
            ))}
          </div>
        </div>

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
                  title: 'Delete supplier?',
                  message: <>Delete <strong>{existing?.name ?? 'this supplier'}</strong>? This cannot be undone.</>,
                  tone: 'danger',
                  confirmLabel: 'Delete',
                });
                if (ok) remove.mutate();
              }}
              className="btn-danger"
              disabled={remove.isPending}
            >
              <Trash2 className="h-4 w-4" /> Delete
            </button>
          ) : <span />}
          <div className="flex gap-3">
            <Link to="/settings/suppliers" className="btn-ghost">Cancel</Link>
            <button type="submit" disabled={busy} className="btn-primary">
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              <Save className="h-4 w-4" /> {isEdit ? 'Save changes' : 'Create supplier'}
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
