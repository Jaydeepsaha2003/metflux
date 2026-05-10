import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Save, Trash2, Loader2, Truck } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useConfirm } from '@/hooks/useConfirm';

type Supplier = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  gstNumber: string | null;
  state: string | null;
  gstRate: number;
  notes: string | null;
};

type Form = Omit<Supplier, 'id'>;

const empty: Form = {
  name: '', email: '', phone: '', address: '', gstNumber: '', state: '', gstRate: 0, notes: '',
};

export const SupplierFormPage = () => {
  const { id } = useParams();
  const isEdit = !!id;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<Form>(empty);
  const [error, setError] = useState<string | null>(null);
  const { confirm, confirmDialog } = useConfirm();

  const { data: existing } = useQuery({
    queryKey: ['supplier', id],
    queryFn: () => api<Supplier>(`/suppliers/${id}`),
    enabled: isEdit,
  });

  useEffect(() => {
    if (!existing) return;
    setForm({
      name: existing.name,
      email: existing.email ?? '',
      phone: existing.phone ?? '',
      address: existing.address ?? '',
      gstNumber: existing.gstNumber ?? '',
      state: existing.state ?? '',
      gstRate: existing.gstRate ?? 0,
      notes: existing.notes ?? '',
    });
  }, [existing]);

  const create = useMutation({
    mutationFn: (body: Form) => api<Supplier>('/suppliers', { method: 'POST', json: body }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['suppliers'] });
      navigate('/settings/suppliers');
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Save failed'),
  });

  const update = useMutation({
    mutationFn: (body: Partial<Form>) => api<Supplier>(`/suppliers/${id}`, { method: 'PATCH', json: body }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['suppliers'] });
      queryClient.invalidateQueries({ queryKey: ['supplier', id] });
      navigate('/settings/suppliers');
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Save failed'),
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
    if (isEdit) update.mutate(form);
    else create.mutate(form);
  };

  const set = <K extends keyof Form>(key: K, value: Form[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const busy = create.isPending || update.isPending;

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

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
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
