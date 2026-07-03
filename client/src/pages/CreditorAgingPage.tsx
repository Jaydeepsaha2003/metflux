// Creditor Aging — outstanding payable per supplier, bucketed by how old the
// bill is. Purchase bills carry no due date and suppliers have no credit terms,
// so this ages by BILL DATE (days since the invoice date), not by overdue days.
// Debit notes reduce the supplier's total. This is the AP mirror of Debtor Aging.
import { Fragment, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Clock, Loader2, ChevronDown, ChevronRight, CreditCard, ImageDown } from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { makeAgingImageBlob, shareOrDownloadImage } from '@/lib/agingImage';
import { SearchableSelect } from '@/components/SearchableSelect';

type AgingBill = { id: string; invoiceNumber: string; invoiceDate: string; balance: number; ageDays: number; docType: 'INVOICE' | 'DEBIT_NOTE' };
type AgingSupplier = {
  supplierName: string;
  b0_30: number; b31_60: number; b61_90: number; b90: number;
  total: number; oldestDays: number; invoices: AgingBill[];
};
type AgingResp = { suppliers: AgingSupplier[]; totals: { b0_30: number; b31_60: number; b61_90: number; b90: number; total: number } };

const inr = (n: number) => '₹' + Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
const inr2 = (n: number) => '₹' + Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const fmtDate = (iso: string | null) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
};

const severity = (days: number) => (days <= 30 ? 'low' : days <= 60 ? 'mid' : 'high');
const SEV_DOT: Record<string, string> = { low: 'bg-amber-400', mid: 'bg-orange-500', high: 'bg-red-500' };

export const CreditorAgingPage = () => {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [filterKey, setFilterKey] = useState('');
  const [imaging, setImaging] = useState<string | null>(null);
  const { data, isLoading } = useQuery({ queryKey: ['creditor-aging'], queryFn: () => api<AgingResp>('/purchases/aging') });
  const { data: company } = useQuery({ queryKey: ['company-me'], queryFn: () => api<{ name: string }>('/companies/me') });
  const toggle = (key: string) => setExpanded((prev) => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });
  const t = data?.totals;

  const allSuppliers = data?.suppliers ?? [];
  const supOptions = allSuppliers.map((s) => ({ value: s.supplierName, label: s.supplierName }));
  const shownSuppliers = filterKey ? allSuppliers.filter((s) => s.supplierName === filterKey) : allSuppliers;

  const shareImage = async (s: AgingSupplier) => {
    setImaging(s.supplierName);
    try {
      const blob = await makeAgingImageBlob({
        companyName: company?.name ?? 'Statement',
        title: 'Payable Statement (aged by bill date)',
        partyName: s.supplierName,
        dateLabel: `As on ${fmtDate(new Date().toISOString())}`,
        buckets: [
          { label: '0–30 days', value: s.b0_30 },
          { label: '31–60 days', value: s.b31_60 },
          { label: '61–90 days', value: s.b61_90 },
          { label: '90+ days', value: s.b90 },
        ],
        total: s.total,
        lines: s.invoices.slice(0, 14).map(
          (i) => `${i.invoiceNumber}  —  ${inr2(i.balance)}  (${fmtDate(i.invoiceDate)}, ${i.ageDays}d${i.docType === 'DEBIT_NOTE' ? ', debit note' : ''})`,
        ),
        footer: s.invoices.length > 14 ? `…and ${s.invoices.length - 14} more bill(s)` : (company?.name ?? ''),
      });
      const caption = `*Payable Statement${company?.name ? ` — ${company.name}` : ''}*\n${s.supplierName}: ${inr2(s.total)} outstanding as on ${fmtDate(new Date().toISOString())}.`;
      await shareOrDownloadImage(blob, `payable-${s.supplierName}`.replace(/[^\w-]+/g, '_'), caption);
    } finally {
      setImaging(null);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Clock className="h-5 w-5 text-brand-600" /> Creditor Aging
        </h1>
        <div className="flex items-center gap-2">
          <div className="w-full sm:w-72">
            <SearchableSelect value={filterKey} onChange={setFilterKey} options={supOptions} placeholder="Search supplier…" />
          </div>
          <Link to="/accounts/bills-payable" className="btn-ghost border border-slate-300 text-emerald-700 hover:bg-emerald-50 shrink-0">
            <CreditCard className="h-4 w-4" /> <span className="hidden sm:inline">Bills Payable</span>
          </Link>
        </div>
      </div>

      <p className="text-xs text-slate-500 -mt-2">
        Aged by bill date (suppliers have no credit terms). Debit notes reduce the balance.
      </p>

      {/* Aging totals strip */}
      {t && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <Bucket label="Total Payable" value={inr(t.total)} tone="brand" />
          <Bucket label="0–30 days" value={inr(t.b0_30)} tone="ok" />
          <Bucket label="31–60 days" value={inr(t.b31_60)} tone="low" />
          <Bucket label="61–90 days" value={inr(t.b61_90)} tone="mid" />
          <Bucket label="90+ days" value={inr(t.b90)} tone="high" />
        </div>
      )}

      <div className="card overflow-hidden">
        {isLoading ? (
          <div className="py-12 text-center text-slate-400"><Loader2 className="h-5 w-5 animate-spin mx-auto" /></div>
        ) : !data?.suppliers.length ? (
          <div className="py-12 text-center text-sm text-slate-400">No outstanding payables. 🎉</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm whitespace-nowrap">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2.5 w-8" />
                  <th className="px-3 py-2.5">Supplier</th>
                  <th className="px-3 py-2.5 text-right">0–30</th>
                  <th className="px-3 py-2.5 text-right">31–60</th>
                  <th className="px-3 py-2.5 text-right">61–90</th>
                  <th className="px-3 py-2.5 text-right">90+</th>
                  <th className="px-3 py-2.5 text-right">Total</th>
                  <th className="px-3 py-2.5 text-center">Share</th>
                </tr>
              </thead>
              <tbody>
                {shownSuppliers.map((s) => {
                  const key = s.supplierName;
                  const open = expanded.has(key);
                  const sev = severity(s.oldestDays);
                  return (
                    <Fragment key={key}>
                      <tr className={cn('border-t border-slate-100 cursor-pointer hover:bg-slate-50/60', open && 'bg-brand-50/40')} onClick={() => toggle(key)}>
                        <td className="px-3 py-2.5 text-center">{open ? <ChevronDown className="h-4 w-4 text-brand-600 inline" /> : <ChevronRight className="h-4 w-4 text-slate-400 inline" />}</td>
                        <td className="px-3 py-2.5">
                          <div className="flex items-center gap-2">
                            <span className={cn('h-2 w-2 rounded-full shrink-0', SEV_DOT[sev])} title={`oldest bill ${s.oldestDays}d`} />
                            <span className="font-medium text-slate-900">{s.supplierName}</span>
                          </div>
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-slate-500">{s.b0_30 ? inr(s.b0_30) : '—'}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-orange-700">{s.b31_60 ? inr(s.b31_60) : '—'}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-orange-800">{s.b61_90 ? inr(s.b61_90) : '—'}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-red-700 font-medium">{s.b90 ? inr(s.b90) : '—'}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums font-bold text-slate-900">{inr(s.total)}</td>
                        <td className="px-3 py-2.5 text-center" onClick={(e) => e.stopPropagation()}>
                          <button
                            onClick={() => shareImage(s)}
                            disabled={imaging === s.supplierName}
                            className="btn-ghost text-brand-700 hover:bg-brand-50"
                            title="Share payable aging as image"
                          >
                            {imaging === s.supplierName ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImageDown className="h-4 w-4" />}
                          </button>
                        </td>
                      </tr>
                      {open && (
                        <tr className="bg-slate-50/60">
                          <td />
                          <td colSpan={7} className="px-3 py-2">
                            <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
                              <table className="w-full text-xs">
                                <thead className="bg-slate-50 text-left text-slate-500">
                                  <tr><th className="px-2 py-1.5">Bill #</th><th className="px-2 py-1.5">Date</th><th className="px-2 py-1.5">Type</th><th className="px-2 py-1.5 text-right">Balance</th><th className="px-2 py-1.5 text-right">Age</th></tr>
                                </thead>
                                <tbody>
                                  {s.invoices.map((i) => (
                                    <tr key={i.id} className="border-t border-slate-100">
                                      <td className="px-2 py-1.5 font-medium">{i.invoiceNumber}</td>
                                      <td className="px-2 py-1.5 text-slate-500">{fmtDate(i.invoiceDate)}</td>
                                      <td className="px-2 py-1.5">{i.docType === 'DEBIT_NOTE' ? <span className="rounded bg-rose-50 px-1.5 py-0.5 text-[10px] text-rose-700">Debit note</span> : <span className="text-slate-400">Bill</span>}</td>
                                      <td className="px-2 py-1.5 text-right tabular-nums">{inr2(i.balance)}</td>
                                      <td className="px-2 py-1.5 text-right tabular-nums text-slate-500">{i.ageDays}d</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

const Bucket = ({ label, value, tone }: { label: string; value: string; tone: 'brand' | 'ok' | 'low' | 'mid' | 'high' }) => {
  const c = tone === 'brand' ? 'border-brand-200 bg-brand-50 text-brand-700'
    : tone === 'ok' ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
    : tone === 'low' ? 'border-amber-200 bg-amber-50 text-amber-700'
    : tone === 'mid' ? 'border-orange-200 bg-orange-50 text-orange-700'
    : 'border-red-200 bg-red-50 text-red-700';
  return (
    <div className={cn('rounded-xl border p-3', c)}>
      <div className="text-[11px] font-medium uppercase tracking-wide opacity-80">{label}</div>
      <div className="mt-1 text-lg font-bold tabular-nums">{value}</div>
    </div>
  );
};
