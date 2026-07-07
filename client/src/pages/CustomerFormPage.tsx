import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Save, Trash2, Loader2, Building2 } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useConfirm } from '@/hooks/useConfirm';

type Customer = {
  id: string;
  customerCode: string;
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  gstNumber: string | null;
  gstRate: number;
  state: string | null;
  dueDays: number | null;
  notes: string | null;
};

type Form = Omit<Customer, 'id' | 'gstRate' | 'dueDays'> & { gstRate: string; dueDays: string };

const empty: Form = {
  customerCode: '', name: '', email: '', phone: '', address: '', gstNumber: '', gstRate: '0', state: '', dueDays: '', notes: '',
};

/** Suggested code from a customer name: first 3 alpha chars (uppercase). */
const codePrefixFromName = (name: string) => {
  const letters = name.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3);
  return letters.length ? letters : '';
};

export const CustomerFormPage = () => {
  const { id } = useParams();
  const isEdit = !!id;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<Form>(empty);
  const [error, setError] = useState<string | null>(null);
  const { confirm, confirmDialog } = useConfirm();

  const { data: existing } = useQuery({
    queryKey: ['customer', id],
    queryFn: () => api<Customer>(`/customers/${id}`),
    enabled: isEdit,
  });

  useEffect(() => {
    if (!existing) return;
    setForm({
      customerCode: existing.customerCode ?? '',
      name: existing.name,
      email: existing.email ?? '',
      phone: existing.phone ?? '',
      address: existing.address ?? '',
      gstNumber: existing.gstNumber ?? '',
      gstRate: String(existing.gstRate ?? 0),
      state: existing.state ?? '',
      dueDays: existing.dueDays != null ? String(existing.dueDays) : '',
      notes: existing.notes ?? '',
    });
  }, [existing]);

  // customerCode is owned by the server — never sent from this form.
  // dueDays goes out as a number (or null when blank, so it isn't coerced to 0).
  type Payload = Omit<Form, 'customerCode' | 'dueDays'> & { dueDays: number | null };

  const create = useMutation({
    mutationFn: (body: Payload) => api<Customer>('/customers', { method: 'POST', json: body }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      navigate('/customers');
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Save failed'),
  });

  const update = useMutation({
    mutationFn: (body: Partial<Payload>) => api<Customer>(`/customers/${id}`, { method: 'PATCH', json: body }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      queryClient.invalidateQueries({ queryKey: ['customer', id] });
      queryClient.invalidateQueries({ queryKey: ['debtor-aging'] });
      navigate('/customers');
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Save failed'),
  });

  const remove = useMutation({
    mutationFn: () => api(`/customers/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      navigate('/customers');
    },
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    // The customer code is never editable from the UI — server owns it.
    // Strip it from the payload so the server keeps existing (PATCH) or
    // auto-generates a fresh one (POST).
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { customerCode: _omit, dueDays, ...rest } = form;
    const payload: Payload = { ...rest, dueDays: dueDays.trim() === '' ? null : Number(dueDays) };
    if (isEdit) update.mutate(payload);
    else create.mutate(payload);
  };

  const set = <K extends keyof Form>(key: K, value: Form[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const busy = create.isPending || update.isPending;

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-center gap-3">
        <Link to="/customers" className="btn-ghost text-slate-600">
          <ArrowLeft className="h-4 w-4" /> Back
        </Link>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Building2 className="h-5 w-5 text-brand-600" />
          {isEdit ? `Edit customer${existing ? ` — ${existing.name}` : ''}` : 'New customer'}
        </h1>
      </div>

      <form onSubmit={submit} className="card p-5 space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" required>
            <input
              className="input"
              value={form.name ?? ''}
              onChange={(e) => set('name', e.target.value)}
              required
            />
          </Field>
          <Field label="Customer Code">
            <input
              className="input font-mono uppercase bg-slate-50 text-slate-600 cursor-not-allowed"
              value={
                isEdit
                  ? (form.customerCode || '—')
                  : (codePrefixFromName(form.name)
                      ? `${codePrefixFromName(form.name)}-### (auto-assigned)`
                      : 'Auto-assigned on save')
              }
              readOnly
              tabIndex={-1}
            />
            <span className="mt-1 block text-[10px] text-slate-400">
              {isEdit
                ? 'Customer codes are permanent — they appear in production, dispatch and exports.'
                : 'Derived from the first three letters of the name. Assigned automatically when you save.'}
            </span>
          </Field>
          <Field label="Phone">
            <input className="input" value={form.phone ?? ''} onChange={(e) => set('phone', e.target.value)} placeholder="+91 98765 43210" />
          </Field>
          <Field label="Email">
            <input className="input" type="email" value={form.email ?? ''} onChange={(e) => set('email', e.target.value)} />
          </Field>
          <Field label="State">
            <input className="input" value={form.state ?? ''} onChange={(e) => set('state', e.target.value)} placeholder="e.g. Maharashtra" />
          </Field>
          <Field label="GSTIN">
            <input className="input" value={form.gstNumber ?? ''} onChange={(e) => set('gstNumber', e.target.value)} placeholder="22AAAAA0000A1Z5" />
          </Field>
          <Field label="GST Rate (%)">
            <input
              className="input"
              type="number" min={0} max={100} step="0.01" inputMode="decimal"
              value={form.gstRate}
              onChange={(e) => set('gstRate', e.target.value)}
              placeholder="e.g. 18"
            />
          </Field>
          <Field label="Credit Terms (Due Days)">
            <input
              className="input"
              type="number" min={0} max={3650} step="1" inputMode="numeric"
              value={form.dueDays}
              onChange={(e) => set('dueDays', e.target.value)}
              placeholder="e.g. 30"
            />
            <span className="mt-1 block text-[10px] text-slate-400">
              Days allowed for payment after the invoice date. Sales Invoices uses this to set due dates; leave blank if not agreed.
            </span>
          </Field>
          <Field label="Address" full>
            <textarea
              className="input min-h-[80px]"
              value={form.address ?? ''}
              onChange={(e) => set('address', e.target.value)}
              rows={2}
            />
          </Field>
          <Field label="Notes" full>
            <textarea
              className="input min-h-[80px]"
              value={form.notes ?? ''}
              onChange={(e) => set('notes', e.target.value)}
              placeholder="Internal notes — not shared with the customer"
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
                  title: 'Delete customer?',
                  message: <>Delete <strong>{existing?.name ?? 'this customer'}</strong>? This cannot be undone.</>,
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
            <Link to="/customers" className="btn-ghost">Cancel</Link>
            <button type="submit" disabled={busy} className="btn-primary">
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              <Save className="h-4 w-4" /> {isEdit ? 'Save changes' : 'Create customer'}
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
