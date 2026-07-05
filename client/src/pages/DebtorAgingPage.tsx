// Debtor Aging — outstanding balance per customer, bucketed by how overdue it
// is, with a one-tap WhatsApp payment reminder. This is the AR reminder system:
// pick the customers who owe the most / longest and nudge them.
import { Fragment, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Clock, Loader2, MessageCircle, ChevronDown, ChevronRight, AlertTriangle, Wallet, ImageDown, Mail, X, CheckCircle2,
} from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { normalisePhone } from '@/lib/share';
import { makeStatementImageBlob, makeStatementPdfBlob, shareOrDownloadImage, type StatementBill, type StatementInput } from '@/lib/agingImage';
import { buildStatementXlsxBlob, buildStatementHtml, blobToBase64 } from '@/lib/statement';
import { SearchableSelect } from '@/components/SearchableSelect';
import { useHideCustomerNames } from '@/store/auth';

type AgingInvoice = { id: string; invoiceNumber: string; invoiceDate: string; dueDate: string | null; balance: number; daysOverdue: number | null };
type AgingCustomer = {
  customerId: string | null; customerName: string; customerCode: string | null; phone: string | null;
  dueDays: number | null; email: string | null; contra?: number;
  notDue: number; d1_30: number; d31_60: number; d61_90: number; d90: number; noTerms: number;
  total: number; maxDaysOverdue: number; invoices: AgingInvoice[];
};
type AgingResp = { customers: AgingCustomer[]; totals: { notDue: number; d1_30: number; d31_60: number; d61_90: number; d90: number; noTerms: number; total: number } };
type Company = { name: string; email?: string | null; phone?: string | null };

// dd-MMM-yyyy for the statement image (e.g. 03-Jun-2025).
const fmtStmt = (iso: string | null) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).replace(/ /g, '-');
};

const inr = (n: number) => '₹' + Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
const inr2 = (n: number) => '₹' + Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const fmtDate = (iso: string | null) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
};

const severity = (days: number) => (days <= 0 ? 'ok' : days <= 30 ? 'low' : days <= 60 ? 'mid' : 'high');
const SEV_DOT: Record<string, string> = { ok: 'bg-emerald-400', low: 'bg-amber-400', mid: 'bg-orange-500', high: 'bg-red-500' };

export const DebtorAgingPage = () => {
  const hideNames = useHideCustomerNames();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [filterKey, setFilterKey] = useState('');
  const [imaging, setImaging] = useState<string | null>(null);
  const [emailFor, setEmailFor] = useState<AgingCustomer | null>(null);

  const { data, isLoading } = useQuery({ queryKey: ['debtor-aging'], queryFn: () => api<AgingResp>('/sales-invoices/aging') });
  const { data: company } = useQuery({ queryKey: ['company-me'], queryFn: () => api<Company>('/companies/me') });
  const { data: emailCfg } = useQuery({ queryKey: ['email-config'], queryFn: () => api<{ configured: boolean; senderEmail: string }>('/email/config') });

  const toggle = (key: string) => setExpanded((prev) => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });

  // Build the wa.me link and open it synchronously inside the click handler.
  // (Opening after an await trips the popup blocker; building client-side also
  // means a bare 10-digit number still works — normalisePhone adds +91.)
  // Polite reminder — totals only, no per-invoice dump.
  const reminderText = (cust: AgingCustomer) => {
    const overdueAmt = cust.d1_30 + cust.d31_60 + cust.d61_90 + cust.d90;
    const lines = [
      '*Payment Reminder*',
      `Dear ${cust.customerName},`,
      `As per our records, a total of ${inr2(cust.total)} is outstanding against your account${overdueAmt > 0 ? `, of which ${inr2(overdueAmt)} is past due` : ''}.`,
      '',
      'We kindly request you to arrange the payment at your earliest convenience.',
    ];
    if (company?.name) lines.push('Regards,', company.name);
    return lines.join('\n');
  };

  const sendReminder = (cust: AgingCustomer) => {
    if (!cust.phone) return;
    const phone = normalisePhone(cust.phone);
    const message = reminderText(cust);
    const url = phone
      ? `https://wa.me/${phone}?text=${encodeURIComponent(message)}`
      : `https://api.whatsapp.com/send?text=${encodeURIComponent(message)}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  // Generate a PNG statement of this customer's aging and share it (WhatsApp on
  // mobile) or download it (desktop).
  const paymentTerm = (d: number | null) => (d == null ? 'As agreed' : d === 0 ? 'Advance' : `${d} Days`);
  const overdueAmt = (c: AgingCustomer) => c.d1_30 + c.d31_60 + c.d61_90 + c.d90;

  // Shared statement definition — feeds the PNG, the Excel and the email HTML.
  const statementInputFor = (cust: AgingCustomer): StatementInput => {
    // ALL bills — the PDF and Excel list every invoice; the PNG caps at 10 itself.
    const bills: StatementBill[] = cust.invoices.map((i) => {
      const od = i.daysOverdue ?? 0;
      return {
        no: i.invoiceNumber,
        date: fmtStmt(i.invoiceDate),
        due: fmtStmt(i.dueDate),
        badge: i.dueDate == null ? 'No terms' : od > 0 ? `${od} Days` : 'Not due',
        level: od > 60 ? 'bad' : od > 0 ? 'warn' : 'ok',
        overdueDays: Math.max(od, 0),
        amount: i.balance,
      };
    });
    return {
      companyName: company?.name ?? 'Statement',
      companyEmail: company?.email ?? null,
      companyPhone: company?.phone ?? null,
      title: 'Outstanding Statement',
      asOnLabel: `As on ${fmtStmt(new Date().toISOString())}`,
      partyName: hideNames ? (cust.customerCode ?? 'Customer') : cust.customerName,
      paymentTerm: paymentTerm(cust.dueDays),
      totalLabel: 'TOTAL OUTSTANDING',
      total: cust.total,
      overdue: overdueAmt(cust),
      overdueLabel: 'DUE',
      columns: ['Invoice No', 'Invoice Date', 'Due Date', 'Overdue', 'Outstanding'],
      bills,
      closing1: 'If payment has already been processed, kindly ignore this communication.',
      closing2: 'If not, we request you to arrange the payment at your earliest convenience as per mutually agreed terms.',
      teamLabel: 'Accounts Receivable Team',
    };
  };

  const shareImage = async (cust: AgingCustomer) => {
    const k = cust.customerId ?? cust.customerName;
    setImaging(k);
    try {
      const blob = await makeStatementImageBlob(statementInputFor(cust));
      const name = (hideNames ? cust.customerCode : cust.customerName) ?? 'statement';
      await shareOrDownloadImage(blob, `statement-${name}`.replace(/[^\w-]+/g, '_'), reminderText(cust));
    } finally {
      setImaging(null);
    }
  };

  const t = data?.totals;

  const allCustomers = data?.customers ?? [];
  const keyOf = (c: AgingCustomer) => c.customerId ?? `x:${c.customerName}`;
  const custOptions = allCustomers.map((c) => ({
    value: keyOf(c),
    label: hideNames
      ? (c.customerCode ?? c.customerName)
      : (c.customerCode ? `${c.customerCode} · ${c.customerName}` : c.customerName),
  }));
  const shownCustomers = filterKey ? allCustomers.filter((c) => keyOf(c) === filterKey) : allCustomers;

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Clock className="h-5 w-5 text-brand-600" /> Debtor Aging
        </h1>
        <div className="flex items-center gap-2">
          <div className="w-full sm:w-72">
            <SearchableSelect
              value={filterKey}
              onChange={setFilterKey}
              options={custOptions}
              placeholder="Search customer…"
            />
          </div>
          <Link to="/sales-invoices/payments" className="btn-ghost border border-slate-300 text-emerald-700 hover:bg-emerald-50 shrink-0">
            <Wallet className="h-4 w-4" /> <span className="hidden sm:inline">Receive Payments</span>
          </Link>
        </div>
      </div>

      {/* Aging totals strip */}
      {t && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Bucket label="Amount Receivable" value={inr(t.total)} tone="brand" />
          <Bucket label="Not Due" value={inr(t.notDue)} tone="ok" />
          <Bucket label="1–30 days" value={inr(t.d1_30)} tone="low" />
          <Bucket label="31–60 days" value={inr(t.d31_60)} tone="mid" />
          <Bucket label="61–90 days" value={inr(t.d61_90)} tone="mid" />
          <Bucket label="90+ days" value={inr(t.d90)} tone="high" />
        </div>
      )}

      <div className="card overflow-hidden">
        {isLoading ? (
          <div className="py-12 text-center text-slate-400"><Loader2 className="h-5 w-5 animate-spin mx-auto" /></div>
        ) : !data?.customers.length ? (
          <div className="py-12 text-center text-sm text-slate-400">No outstanding balances. 🎉</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm whitespace-nowrap">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2.5 w-8" />
                  <th className="px-3 py-2.5">Customer</th>
                  <th className="px-3 py-2.5 text-right">Not Due</th>
                  <th className="px-3 py-2.5 text-right">1–30</th>
                  <th className="px-3 py-2.5 text-right">31–60</th>
                  <th className="px-3 py-2.5 text-right">61–90</th>
                  <th className="px-3 py-2.5 text-right">90+</th>
                  <th className="px-3 py-2.5 text-right">Amount Receivable</th>
                  <th className="px-3 py-2.5 text-center">Send</th>
                </tr>
              </thead>
              <tbody>
                {shownCustomers.map((c) => {
                  const key = c.customerId ?? `x:${c.customerName}`;
                  const open = expanded.has(key);
                  const sev = severity(c.maxDaysOverdue);
                  return (
                    <Fragment key={key}>
                      <tr className={cn('border-t border-slate-100 cursor-pointer hover:bg-slate-50/60', open && 'bg-brand-50/40')} onClick={() => toggle(key)}>
                        <td className="px-3 py-2.5 text-center">{open ? <ChevronDown className="h-4 w-4 text-brand-600 inline" /> : <ChevronRight className="h-4 w-4 text-slate-400 inline" />}</td>
                        <td className="px-3 py-2.5">
                          <div className="flex items-center gap-2">
                            <span className={cn('h-2 w-2 rounded-full shrink-0', SEV_DOT[sev])} title={c.maxDaysOverdue > 0 ? `${c.maxDaysOverdue}d overdue` : 'not overdue'} />
                            {c.customerId ? (
                              <span className="font-medium text-slate-900">{hideNames ? (c.customerCode ?? '••••') : c.customerName}</span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-red-600" title="Unmatched customer — fix on the Invoices page">
                                <AlertTriangle className="h-3.5 w-3.5" /> {hideNames ? '••••' : c.customerName}
                              </span>
                            )}
                            {c.noTerms > 0 && <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-700" title="Has invoices with no due date">no-terms {inr(c.noTerms)}</span>}
                            {!!c.contra && c.contra > 0 && <span className="rounded bg-violet-50 px-1.5 py-0.5 text-[10px] text-violet-700" title="Also a supplier — receivable shown net of their purchase payable">net of {inr(c.contra)} purch.</span>}
                          </div>
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-slate-500">{c.notDue ? inr(c.notDue) : '—'}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{c.d1_30 ? inr(c.d1_30) : '—'}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-orange-700">{c.d31_60 ? inr(c.d31_60) : '—'}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-orange-800">{c.d61_90 ? inr(c.d61_90) : '—'}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-red-700 font-medium">{c.d90 ? inr(c.d90) : '—'}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums font-bold text-slate-900">{inr(c.total)}</td>
                        <td className="px-3 py-2.5 text-center" onClick={(e) => e.stopPropagation()}>
                          <div className="inline-flex items-center gap-1">
                            <button
                              onClick={() => shareImage(c)}
                              disabled={imaging === (c.customerId ?? c.customerName)}
                              className="btn-ghost text-brand-700 hover:bg-brand-50"
                              title="Share aging as image"
                            >
                              {imaging === (c.customerId ?? c.customerName) ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImageDown className="h-4 w-4" />}
                            </button>
                            <button
                              onClick={() => setEmailFor(c)}
                              className="btn-ghost text-sky-700 hover:bg-sky-50"
                              title="Email statement (image + Excel)"
                            >
                              <Mail className="h-4 w-4" />
                            </button>
                            {c.phone ? (
                              <button onClick={() => sendReminder(c)} className="btn-ghost text-emerald-700 hover:bg-emerald-50" title="Send WhatsApp reminder">
                                <MessageCircle className="h-4 w-4" />
                              </button>
                            ) : (
                              <span className="text-[10px] text-slate-400" title="No phone on the customer record">no phone</span>
                            )}
                          </div>
                        </td>
                      </tr>
                      {open && (
                        <tr className="bg-slate-50/60">
                          <td />
                          <td colSpan={8} className="px-3 py-2">
                            <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
                              <table className="w-full text-xs">
                                <thead className="bg-slate-50 text-left text-slate-500">
                                  <tr><th className="px-2 py-1.5">Invoice #</th><th className="px-2 py-1.5">Date</th><th className="px-2 py-1.5">Due</th><th className="px-2 py-1.5 text-right">Balance</th><th className="px-2 py-1.5 text-right">Overdue</th></tr>
                                </thead>
                                <tbody>
                                  {c.invoices.map((i) => (
                                    <tr key={i.id} className="border-t border-slate-100">
                                      <td className="px-2 py-1.5 font-medium">{i.invoiceNumber}</td>
                                      <td className="px-2 py-1.5 text-slate-500">{fmtDate(i.invoiceDate)}</td>
                                      <td className="px-2 py-1.5 text-slate-500">{fmtDate(i.dueDate)}</td>
                                      <td className="px-2 py-1.5 text-right tabular-nums">{inr2(i.balance)}</td>
                                      <td className={cn('px-2 py-1.5 text-right tabular-nums', (i.daysOverdue ?? 0) > 0 ? 'text-red-600 font-medium' : 'text-slate-400')}>
                                        {i.daysOverdue == null ? '—' : i.daysOverdue > 0 ? `${i.daysOverdue}d` : 'not due'}
                                      </td>
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

      {emailFor && (
        <EmailReminderModal
          cust={emailFor}
          input={statementInputFor(emailFor)}
          configured={!!emailCfg?.configured}
          onClose={() => setEmailFor(null)}
        />
      )}
    </div>
  );
};

/* ── Email statement modal ── */
const EmailReminderModal = ({
  cust, input, configured, onClose,
}: { cust: AgingCustomer; input: StatementInput; configured: boolean; onClose: () => void }) => {
  const [to, setTo] = useState(cust.email ?? '');
  const [save, setSave] = useState(!cust.email);
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async () => {
    setError(null);
    if (!/^\S+@\S+\.\S+$/.test(to.trim())) { setError('Enter a valid email address'); return; }
    setSending(true);
    try {
      const base = `Statement-${(input.partyName || 'customer').replace(/[^\w-]+/g, '_')}`;
      const pdf = await makeStatementPdfBlob(input);
      const xlsx = buildStatementXlsxBlob(input);
      const [pdfB64, xlsxB64] = await Promise.all([blobToBase64(pdf), blobToBase64(xlsx)]);
      const html = buildStatementHtml(input); // responsive HTML body; PDF + Excel attached
      await api('/email/reminder', {
        method: 'POST',
        json: {
          customerId: cust.customerId,
          to: to.trim(),
          saveEmail: save,
          subject: `${input.companyName} — Outstanding Statement for ${input.partyName} (${inr2(input.total)})`,
          html,
          attachments: [
            { name: `${base}.pdf`, content: pdfB64 },
            { name: `${base}.xlsx`, content: xlsxB64 },
          ],
        },
      });
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not send email');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="w-full max-w-md rounded-xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <h2 className="text-sm font-semibold text-slate-900 flex items-center gap-2"><Mail className="h-4 w-4 text-sky-600" /> Email statement</h2>
          <button onClick={onClose} className="rounded p-1 text-slate-400 hover:bg-slate-100"><X className="h-4 w-4" /></button>
        </div>
        {done ? (
          <div className="px-5 py-6 space-y-3">
            <div className="flex items-center gap-2 text-emerald-700 text-sm font-medium"><CheckCircle2 className="h-5 w-5" /> Statement emailed to {to}.</div>
            <button onClick={onClose} className="btn-primary text-sm">Done</button>
          </div>
        ) : (
          <div className="px-5 py-4 space-y-4">
            <div className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
              {input.partyName} · <strong>{inr2(input.total)}</strong> outstanding{input.overdue ? ` · ${inr2(input.overdue)} past due` : ''}
              <div className="mt-0.5 text-slate-400">Sends the statement as a PDF with an Excel attachment.</div>
            </div>
            {!configured && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                Email isn’t set up on the server yet. Ask the admin to configure Brevo (API key + sender).
              </div>
            )}
            <label className="block">
              <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-slate-500">Recipient email</span>
              <input className="input" type="email" value={to} onChange={(e) => setTo(e.target.value)} placeholder="customer@example.com" />
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={save} onChange={(e) => setSave(e.target.checked)} className="rounded border-slate-300 text-brand-600 focus:ring-brand-500" />
              Save this email on the customer &amp; use it every time
            </label>
            {error && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}
            <div className="flex justify-end gap-3 border-t border-slate-200 pt-3">
              <button onClick={onClose} className="btn-ghost text-sm">Cancel</button>
              <button onClick={send} disabled={sending || !configured} className="btn-primary text-sm">
                {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />} Send email
              </button>
            </div>
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
