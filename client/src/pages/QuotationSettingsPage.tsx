// Quotation Settings — set the bank details + Terms & Conditions once per
// company; every quotation PDF pre-fills from here (still editable per-quote
// before download). Company-admin editable, stored per company.
import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { FileText, Loader2, Save, Check, ClipboardList } from 'lucide-react';
import { api, ApiError } from '@/lib/api';

type QuotationSettings = {
  bankName: string; bankBranch: string; bankAccountName: string;
  bankAccountNumber: string; bankIfsc: string; terms: string;
};

const EMPTY: QuotationSettings = {
  bankName: '', bankBranch: '', bankAccountName: '', bankAccountNumber: '', bankIfsc: '', terms: '',
};

const SAMPLE_TERMS = `Payment Terms
- Credit Facility: 30 DAYS AGAINST PDC
- Mode: RTGS / NEFT / Bank Transfer

Freight & Logistics
- Delivery Terms: Ex-works Vadodara, Gujarat
- Freight: Extra at actuals (prepaid or to-pay basis)
- Transit Insurance: Customer's responsibility unless specified

Packaging Charges
- Standard Packaging: Included (corrugated box + strapping)
- Heavy-duty Packaging: Included (bulk shipments)
- Export Packaging: ISPM-compliant wooden crates, charged at actuals

Commercial Notes
- Prices are exclusive of GST @18%
- Validity of quotation: 30 days from issue
- Lead time: 1 week depending on grade and size
- Custom sizes available on request`;

const field = 'h-9 w-full rounded-md border border-slate-300 px-2.5 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20';

export const QuotationSettingsPage = () => {
  const qc = useQueryClient();
  const [form, setForm] = useState<QuotationSettings>(EMPTY);
  const [error, setError] = useState('');
  const [savedOk, setSavedOk] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['company-settings', 'quotation'],
    queryFn: () => api<QuotationSettings>('/company-settings/quotation'),
  });
  useEffect(() => { if (data) setForm({ ...EMPTY, ...data }); }, [data]);

  const set = (k: keyof QuotationSettings, v: string) => { setForm((f) => ({ ...f, [k]: v })); setSavedOk(false); };

  const save = useMutation({
    mutationFn: () => api<QuotationSettings>('/company-settings/quotation', { method: 'PUT', json: form }),
    onSuccess: (r) => { setForm({ ...EMPTY, ...r }); setSavedOk(true); setError(''); qc.invalidateQueries({ queryKey: ['company-settings', 'quotation'] }); },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Could not save'),
  });

  if (isLoading) return <div className="card p-10 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-slate-400" /></div>;

  return (
    <div className="max-w-3xl space-y-5">
      <div>
        <h1 className="flex items-center gap-2.5 text-2xl font-bold tracking-tight">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-brand-50 text-brand-600"><FileText className="h-5 w-5" /></span>
          Quotation Settings
        </h1>
        <p className="mt-1 text-sm text-slate-500">Bank details and Terms &amp; Conditions used on every quotation. Set them once here — each quotation pre-fills these and you can still tweak before downloading.</p>
      </div>

      {/* Bank details */}
      <div className="card p-5 space-y-4">
        <h2 className="text-sm font-semibold text-slate-900">Bank Details</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block"><span className="mb-1 block text-xs font-medium text-slate-600">Bank Name</span>
            <input className={field} value={form.bankName} onChange={(e) => set('bankName', e.target.value)} placeholder="ICICI BANK" /></label>
          <label className="block"><span className="mb-1 block text-xs font-medium text-slate-600">Branch</span>
            <input className={field} value={form.bankBranch} onChange={(e) => set('bankBranch', e.target.value)} placeholder="POR, VADODARA" /></label>
          <label className="block"><span className="mb-1 block text-xs font-medium text-slate-600">Account Name</span>
            <input className={field} value={form.bankAccountName} onChange={(e) => set('bankAccountName', e.target.value)} placeholder="TOROFLUX INDUSTRIES" /></label>
          <label className="block"><span className="mb-1 block text-xs font-medium text-slate-600">Account Number</span>
            <input className={field} value={form.bankAccountNumber} onChange={(e) => set('bankAccountNumber', e.target.value)} placeholder="401305500230" /></label>
          <label className="block"><span className="mb-1 block text-xs font-medium text-slate-600">IFSC Code</span>
            <input className={field} value={form.bankIfsc} onChange={(e) => set('bankIfsc', e.target.value)} placeholder="ICIC0004013" /></label>
        </div>
      </div>

      {/* Terms & Conditions */}
      <div className="card p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900">Terms &amp; Conditions</h2>
          <button type="button" onClick={() => set('terms', SAMPLE_TERMS)}
            className="btn-ghost border border-slate-300 text-slate-600 hover:bg-slate-50 text-xs">
            <ClipboardList className="h-3.5 w-3.5" /> Insert sample template
          </button>
        </div>
        <p className="text-xs text-slate-500">Payment terms, freight &amp; logistics, packaging, commercial notes — anything you want printed under Terms on the quotation.</p>
        <textarea
          className="w-full rounded-md border border-slate-300 p-3 text-sm leading-relaxed outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
          rows={16} value={form.terms} onChange={(e) => set('terms', e.target.value)}
          placeholder="Payment Terms&#10;- Credit Facility: 30 DAYS AGAINST PDC&#10;..."
        />
      </div>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

      <div className="flex items-center justify-end gap-3">
        {savedOk && <span className="inline-flex items-center gap-1 text-sm font-medium text-emerald-600"><Check className="h-4 w-4" /> Saved</span>}
        <button onClick={() => save.mutate()} disabled={save.isPending} className="btn-primary disabled:opacity-60">
          {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save Settings
        </button>
      </div>
    </div>
  );
};

export default QuotationSettingsPage;
