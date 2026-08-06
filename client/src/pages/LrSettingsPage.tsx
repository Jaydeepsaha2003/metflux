// Transporter Settings — master record used as the letterhead on printed Lorry
// Receipts. A company can save one or more transporters (each with a logo) and
// mark one as the default that pre-fills new LRs.
import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useConfirm } from '@/hooks/useConfirm';
import { type LrTransporter } from '@/lib/lr';
import {
  Truck, Plus, Save, Trash2, Loader2, Star, Upload,
  Image as ImageIcon, Building2, ArrowLeft,
} from 'lucide-react';

type FormState = {
  name: string; tagline: string; address: string; phone: string;
  email: string; gstin: string; pan: string; logo: string | null; isDefault: boolean;
};

const EMPTY: FormState = {
  name: '', tagline: '', address: '', phone: '', email: '', gstin: '', pan: '', logo: null, isDefault: false,
};

const MAX_LOGO_BYTES = 1.5 * 1024 * 1024; // ~1.5 MB

export const LrSettingsPage = () => {
  const qc = useQueryClient();
  const { confirm, confirmDialog } = useConfirm();
  const fileRef = useRef<HTMLInputElement>(null);

  const [form, setForm] = useState<FormState>(EMPTY);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['lr-transporters'],
    queryFn: () => api<{ items: LrTransporter[] }>('/lorry-receipts/transporters'),
  });
  const transporters = data?.items ?? [];

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const resetForm = () => { setForm(EMPTY); setEditingId(null); setError(''); };

  const startEdit = (t: LrTransporter) => {
    setEditingId(t.id);
    setError('');
    setForm({
      name: t.name ?? '',
      tagline: t.tagline ?? '',
      address: t.address ?? '',
      phone: t.phone ?? '',
      email: t.email ?? '',
      gstin: t.gstin ?? '',
      pan: t.pan ?? '',
      logo: t.logo ?? null,
      isDefault: !!t.isDefault,
    });
  };

  const onPickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file later
    if (!file) return;
    if (file.size > MAX_LOGO_BYTES) {
      setError('Logo is too large — please use an image under 1.5 MB.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => { setError(''); set('logo', String(reader.result)); };
    reader.onerror = () => setError('Could not read that image file.');
    reader.readAsDataURL(file);
  };

  const save = useMutation({
    mutationFn: () => {
      const payload = {
        name: form.name.trim(),
        tagline: form.tagline.trim() || null,
        address: form.address.trim() || null,
        phone: form.phone.trim() || null,
        email: form.email.trim() || null,
        gstin: form.gstin.trim() || null,
        pan: form.pan.trim() || null,
        logo: form.logo,
        isDefault: form.isDefault,
      };
      return editingId
        ? api<LrTransporter>(`/lorry-receipts/transporters/${editingId}`, { method: 'PUT', body: JSON.stringify(payload) })
        : api<LrTransporter>('/lorry-receipts/transporters', { method: 'POST', body: JSON.stringify(payload) });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['lr-transporters'] });
      resetForm();
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Could not save transporter.'),
  });

  const del = useMutation({
    mutationFn: (id: string) => api(`/lorry-receipts/transporters/${id}`, { method: 'DELETE' }),
    onSuccess: (_r, id) => {
      qc.invalidateQueries({ queryKey: ['lr-transporters'] });
      if (editingId === id) resetForm();
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Could not delete transporter.'),
  });

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) { setError('Transporter name is required.'); return; }
    setError('');
    save.mutate();
  };

  const onDelete = async (t: LrTransporter) => {
    const ok = await confirm({
      title: 'Delete transporter?',
      message: `"${t.name}" will be removed. This cannot be undone.`,
      tone: 'danger',
      confirmLabel: 'Delete',
    });
    if (ok) del.mutate(t.id);
  };

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4 sm:p-6">
      {/* Header */}
      <div className="space-y-2">
        <Link to="/lr" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700">
          <ArrowLeft className="h-4 w-4" /> Back to Lorry Receipts
        </Link>
        <div className="flex items-center gap-2.5">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-50 text-brand-600">
            <Truck className="h-5 w-5" />
          </span>
          <div>
            <h1 className="text-xl font-bold tracking-tight sm:text-2xl">Transporter Settings</h1>
            <p className="text-sm text-slate-500">Details &amp; logo printed on your Lorry Receipts</p>
          </div>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr,1.2fr]">
        {/* LEFT — saved transporters */}
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <h2 className="text-sm font-semibold text-slate-700">Saved transporters</h2>
            <span className="text-xs text-slate-400">{transporters.length}</span>
          </div>

          {isLoading ? (
            <div className="flex items-center gap-2 px-4 py-8 text-sm text-slate-400">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : transporters.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-slate-400">
              No transporters yet — add one on the right.
            </div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {transporters.map((t) => (
                <li
                  key={t.id}
                  className={cn(
                    'flex items-center gap-3 px-4 py-3',
                    editingId === t.id && 'bg-brand-50/50',
                  )}
                >
                  {t.logo ? (
                    <img
                      src={t.logo}
                      alt={t.name}
                      className="h-10 w-10 shrink-0 rounded-md border border-slate-200 object-contain p-0.5"
                    />
                  ) : (
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-slate-100 text-slate-400">
                      <Building2 className="h-5 w-5" />
                    </span>
                  )}

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate font-semibold text-slate-800">{t.name}</span>
                      {!!t.isDefault && (
                        <Star className="h-3.5 w-3.5 shrink-0 fill-amber-400 text-amber-400" />
                      )}
                    </div>
                    <div className="truncate text-xs text-slate-500">
                      {[t.phone, t.gstin].filter(Boolean).join(' · ') || '—'}
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-1">
                    <button type="button" className="btn-ghost h-8 px-2 text-xs" onClick={() => startEdit(t)}>
                      Edit
                    </button>
                    <button
                      type="button"
                      className="grid h-8 w-8 place-items-center rounded-md text-slate-400 hover:bg-red-50 hover:text-red-600"
                      title="Delete"
                      disabled={del.isPending}
                      onClick={() => onDelete(t)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* RIGHT — add / edit form */}
        <form
          onSubmit={onSubmit}
          className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5"
        >
          <div className="mb-4 flex items-center justify-between">
            <h2 className="flex items-center gap-1.5 text-sm font-semibold text-slate-700">
              {editingId ? <Save className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
              {editingId ? 'Edit transporter' : 'Add transporter'}
            </h2>
            {editingId && (
              <button type="button" className="btn-ghost h-8 px-2.5 text-xs" onClick={resetForm}>
                <Plus className="mr-1 h-3.5 w-3.5" /> New
              </button>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block sm:col-span-2">
              <span className="text-xs font-medium text-slate-600">Name *</span>
              <input
                className="input mt-1"
                value={form.name}
                onChange={(e) => set('name', e.target.value)}
                placeholder="Transporter / company name"
              />
            </label>

            <label className="block sm:col-span-2">
              <span className="text-xs font-medium text-slate-600">Tagline</span>
              <input
                className="input mt-1"
                value={form.tagline}
                onChange={(e) => set('tagline', e.target.value)}
                placeholder="e.g. Fleet Owners & Transport Contractors"
              />
            </label>

            <label className="block sm:col-span-2">
              <span className="text-xs font-medium text-slate-600">Address</span>
              <textarea
                className="input mt-1 min-h-[64px] resize-y py-2"
                value={form.address}
                onChange={(e) => set('address', e.target.value)}
                placeholder="Head office address"
              />
            </label>

            <label className="block">
              <span className="text-xs font-medium text-slate-600">Phone</span>
              <input
                className="input mt-1"
                value={form.phone}
                onChange={(e) => set('phone', e.target.value)}
              />
            </label>

            <label className="block">
              <span className="text-xs font-medium text-slate-600">Email</span>
              <input
                type="email"
                className="input mt-1"
                value={form.email}
                onChange={(e) => set('email', e.target.value)}
              />
            </label>

            <label className="block">
              <span className="text-xs font-medium text-slate-600">GSTIN</span>
              <input
                className="input mt-1"
                value={form.gstin}
                onChange={(e) => set('gstin', e.target.value)}
              />
            </label>

            <label className="block">
              <span className="text-xs font-medium text-slate-600">PAN</span>
              <input
                className="input mt-1"
                value={form.pan}
                onChange={(e) => set('pan', e.target.value)}
              />
            </label>

            {/* Logo uploader */}
            <div className="sm:col-span-2">
              <span className="text-xs font-medium text-slate-600">Logo</span>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={onPickFile}
              />
              <div className="mt-1 flex items-center gap-3">
                {form.logo ? (
                  <img
                    src={form.logo}
                    alt="Logo preview"
                    className="h-16 w-16 shrink-0 rounded-md border border-slate-200 object-contain p-1"
                  />
                ) : (
                  <span className="grid h-16 w-16 shrink-0 place-items-center rounded-md border border-dashed border-slate-300 bg-slate-50 text-slate-400">
                    <ImageIcon className="h-6 w-6" />
                  </span>
                )}
                <div className="flex flex-col gap-1.5">
                  <button
                    type="button"
                    className="btn-ghost h-8 px-2.5 text-xs"
                    onClick={() => fileRef.current?.click()}
                  >
                    <Upload className="mr-1 h-3.5 w-3.5" /> {form.logo ? 'Replace' : 'Upload'} logo
                  </button>
                  {form.logo && (
                    <button
                      type="button"
                      className="text-left text-xs text-red-600 hover:underline"
                      onClick={() => set('logo', null)}
                    >
                      Remove
                    </button>
                  )}
                  <span className="text-[11px] text-slate-400">PNG or JPG, up to ~1.5 MB.</span>
                </div>
              </div>
            </div>

            <label className="mt-1 flex items-center gap-2 sm:col-span-2">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500/30"
                checked={form.isDefault}
                onChange={(e) => set('isDefault', e.target.checked)}
              />
              <span className="text-sm text-slate-700">Use as default on new LRs</span>
            </label>
          </div>

          <div className="mt-5 flex items-center gap-2">
            <button type="submit" className="btn-primary" disabled={save.isPending}>
              {save.isPending ? (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              ) : (
                <Save className="mr-1.5 h-4 w-4" />
              )}
              {editingId ? 'Update transporter' : 'Save transporter'}
            </button>
            {editingId && (
              <button type="button" className="btn-ghost" onClick={resetForm}>
                Cancel
              </button>
            )}
          </div>
        </form>
      </div>

      {confirmDialog}
    </div>
  );
};

export default LrSettingsPage;
