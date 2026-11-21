// Proforma settings — the template's "Exporter, bank & terms — set once". Saved per
// company and printed on every proforma invoice; company admins edit it.
import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, FileSpreadsheet, Loader2, Plus, Save, Trash2 } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { usePiSettings } from '@/lib/proformaApi';
import { DEFAULT_TERMS } from '@/lib/proformaLists';
import type { PiSettings } from '@/lib/proformaXlsx';

type K = keyof Omit<PiSettings, 'terms'>;
// Required ones are those a foreign bank or customs will ask for; the red outline mirrors the workbook's.
const GROUPS: { title: string; fields: { k: K; label: string; required?: boolean; note?: string; area?: boolean }[] }[] = [
  { title: 'Exporter', fields: [
    { k: 'address', label: 'Address', required: true, area: true },
    { k: 'phone', label: 'Phone', required: true },
    { k: 'email', label: 'Email', required: true },
    { k: 'gstin', label: 'GSTIN', required: true },
    { k: 'pan', label: 'PAN', required: true, note: 'Characters 3–12 of your GSTIN.' },
    { k: 'iec', label: 'IEC (Importer Exporter Code)', required: true, note: 'Mandatory for any export from India. Issued by DGFT; usually the same as your PAN.' },
    { k: 'lutArn', label: 'LUT ARN (GST)', required: true, note: 'Letter of Undertaking filed on the GST portal to export without paying IGST.' },
    { k: 'adCode', label: 'AD Code', required: true, note: "Authorised Dealer code from your bank, registered with customs for the port of shipment." },
    { k: 'rcmc', label: 'RCMC (EEPC India)', note: 'Needed to claim export incentives.' },
    { k: 'signatory', label: 'Authorised signatory name' },
  ] },
  { title: 'Bank (for remittance)', fields: [
    { k: 'beneficiary', label: 'Beneficiary name', required: true },
    { k: 'bankName', label: 'Bank name', required: true },
    { k: 'bankBranch', label: 'Bank branch & address', required: true, area: true, note: 'Full branch address is asked by foreign banks.' },
    { k: 'accountNo', label: 'Account no.', required: true, note: 'Confirm this account can receive foreign currency.' },
    { k: 'ifsc', label: 'IFSC', required: true },
    { k: 'swift', label: 'SWIFT / BIC code', required: true, note: 'Compulsory for an overseas buyer to send money.' },
    { k: 'intermediaryBank', label: 'Intermediary / correspondent bank', area: true, note: "Your bank's correspondent (name + SWIFT) — reduces failed or delayed remittances." },
  ] },
];

export const ProformaSettingsPage = () => {
  const qc = useQueryClient();
  const { settings, company, ready } = usePiSettings();
  const [form, setForm] = useState<PiSettings | null>(null);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  useEffect(() => { if (settings && !form) setForm(settings); }, [settings, form]);

  const save = useMutation({
    mutationFn: () => api<PiSettings>('/company-settings/proforma', { method: 'PUT', json: form }),
    onSuccess: () => { setSaved(true); setError(''); qc.invalidateQueries({ queryKey: ['company-settings', 'proforma'] }); },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Could not save'),
  });
  if (!ready || !form) return <div className="card p-10 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-slate-400" /></div>;
  const set = (k: K, v: string) => { setForm({ ...form, [k]: v }); setSaved(false); };
  const setTerm = (i: number, patch: Partial<PiSettings['terms'][number]>) => { setForm({ ...form, terms: form.terms.map((t, n) => (n === i ? { ...t, ...patch } : t)) }); setSaved(false); };

  return (
    <div className="mx-auto max-w-4xl space-y-4 pb-6">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight text-slate-900 sm:text-2xl"><FileSpreadsheet className="h-5 w-5 text-brand-600" /> Proforma Invoice Settings</h1>
        <p className="mt-0.5 text-sm text-slate-500">Set once — printed on every proforma invoice for {company?.name ?? 'your company'}. Fields in red are what an overseas buyer, bank or customs will ask for.</p>
      </div>

      {GROUPS.map((g) => (
        <section key={g.title} className="card p-3 sm:p-4">
          <h2 className="mb-3 text-xs font-bold uppercase tracking-wider text-brand-700">{g.title}</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {g.fields.map((f) => {
              const empty = f.required && !form[f.k].trim();
              const cls = cn('input w-full text-sm', f.area ? 'min-h-[64px] py-2' : 'h-9', empty && 'border-red-400 bg-red-50/40');
              return (
                <label key={f.k} className={cn('block', f.area && 'sm:col-span-2')}>
                  <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-slate-500">{f.label}{f.required && <span className={empty ? ' text-red-500' : ' text-slate-300'}> *</span>}</span>
                  {f.area
                    ? <textarea className={cls} value={form[f.k]} onChange={(e) => set(f.k, e.target.value)} />
                    : <input className={cls} value={form[f.k]} onChange={(e) => set(f.k, e.target.value)} />}
                  {f.note && <span className="mt-0.5 block text-[11px] text-slate-400">{f.note}</span>}
                </label>
              );
            })}
          </div>
        </section>
      ))}

      <section className="card p-3 sm:p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-xs font-bold uppercase tracking-wider text-brand-700">Terms &amp; conditions</h2>
          <div className="flex gap-2">
            <button type="button" className="btn-ghost text-xs" onClick={() => { setForm({ ...form, terms: DEFAULT_TERMS }); setSaved(false); }}>Reset to standard terms</button>
            <button type="button" className="btn-ghost text-xs" onClick={() => { setForm({ ...form, terms: [...form.terms, { title: '', text: '', print: true }] }); setSaved(false); }}><Plus className="h-3.5 w-3.5" /> Add term</button>
          </div>
        </div>
        <p className="mb-3 text-xs text-slate-500">Untick “Print” to leave a term off the invoice without deleting it. Terms print in this order, numbered.</p>
        <div className="space-y-2">
          {form.terms.map((t, i) => (
            <div key={i} className="rounded-lg border border-slate-200 p-2.5">
              <div className="flex items-center gap-2">
                <input className="input h-8 flex-1 text-sm font-medium" value={t.title} onChange={(e) => setTerm(i, { title: e.target.value })} placeholder="Title" />
                <label className="flex items-center gap-1 text-xs text-slate-600"><input type="checkbox" checked={t.print} onChange={(e) => setTerm(i, { print: e.target.checked })} /> Print</label>
                <button type="button" onClick={() => { setForm({ ...form, terms: form.terms.filter((_, n) => n !== i) }); setSaved(false); }} className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600" aria-label="Remove term"><Trash2 className="h-4 w-4" /></button>
              </div>
              <textarea className="input mt-2 min-h-[56px] w-full py-2 text-xs" value={t.text} onChange={(e) => setTerm(i, { text: e.target.value })} placeholder="Wording" />
            </div>
          ))}
        </div>
      </section>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
      <div className="flex items-center justify-end gap-3">
        {saved && <span className="flex items-center gap-1 text-sm text-emerald-700"><Check className="h-4 w-4" /> Saved</span>}
        <button type="button" onClick={() => save.mutate()} disabled={save.isPending} className="btn-primary">
          {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save settings
        </button>
      </div>
    </div>
  );
};
