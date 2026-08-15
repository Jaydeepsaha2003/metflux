import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Search, MessageCircle, Plus, Pencil, Building2, Link2, Check, Trash2, Loader2, Tag } from 'lucide-react';
import { api } from '@/lib/api';
import { useConfirm } from '@/hooks/useConfirm';
import { cn } from '@/lib/cn';
import { Pagination } from '@/components/Pagination';
import { BulkExcel, type BulkExcelConfig } from '@/components/BulkExcel';
import { useHideCustomerNames } from '@/store/auth';

type Customer = {
  id: string;
  customerCode: string;
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  state: string | null;
  gstNumber: string | null;
  gstRate: number;
  shareToken: string | null;
  portalShortCode: string | null;
  portalInitialPassword: string | null;
  portalPasswordSet: number | boolean;
  createdAt: string;
};

type ListResp = { items: Customer[]; total: number; page: number; pageSize: number };

const PAGE_SIZE = 20;

export const CustomersPage = () => {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZE);
  const changePageSize = (n: number) => { setPageSize(n); setPage(1); };
  const { confirm, alert, confirmDialog } = useConfirm();
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const [copiedId, setCopiedId] = useState<string | null>(null);
  const qc = useQueryClient();

  const removeCustomer = useMutation({
    mutationFn: (id: string) => api(`/customers/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['customers'] }),
  });

  const toExpense = useMutation({
    mutationFn: ({ id, category }: { id: string; category: string }) =>
      api(`/customers/${id}/convert-to-expense`, { method: 'POST', json: { category } }),
    onSuccess: () => ['customers', 'debtor-aging', 'account-heads', 'cashbook-summary', 'non-customers']
      .forEach((k) => qc.invalidateQueries({ queryKey: [k] })),
  });

  // For heads that were never customers at all (salary, rent, freight). Removes
  // the customer record AND remembers the head under an expense category, so the
  // Cashbook Summary groups it properly and the next import doesn't re-ask.
  const onConvertToExpense = async (c: { id: string; name: string }) => {
    setDeletingId(c.id);
    try {
      const chk = await api<{ deletable: boolean; blockers: string[] }>(`/customers/${c.id}/deletable`);
      if (!chk.deletable) {
        await alert({
          title: 'Can’t convert this customer',
          message: <><strong>{c.name}</strong> still has {chk.blockers.join(', ')}. A sale can’t become an expense — clear or reassign those first.</>,
          tone: 'warning',
        });
        return;
      }
      const category = window.prompt(
        `Expense category for "${c.name}"

e.g. Salary, Rent, Freight, Bank Charges`, 'Expense',
      );
      if (category === null) return;
      const ok = await confirm({
        title: 'Convert to expense head?',
        message: (
          <>
            Treat <strong>{c.name}</strong> as the expense category <strong>{category.trim() || 'Expense'}</strong> instead of a customer.
            <br /><br />
            They stop appearing on Amount Receivable, their bank entries group under that category in the Cashbook Summary,
            and future imports recognise them automatically.
          </>
        ),
        tone: 'warning', confirmLabel: 'Convert',
      });
      if (ok) toExpense.mutate({ id: c.id, category: category.trim() || 'Expense' });
    } finally { setDeletingId(null); }
  };

  // Ask the server what's referencing this customer BEFORE prompting, so the
  // dialog can state the reason rather than failing after the user commits.
  const onDelete = async (c: { id: string; name: string }) => {
    setDeletingId(c.id);
    try {
      const chk = await api<{ deletable: boolean; blockers: string[]; counts?: { derivedPayments?: number } }>(`/customers/${c.id}/deletable`);
      if (!chk.deletable) {
        await alert({
          title: 'Can’t delete this customer',
          message: <><strong>{c.name}</strong> still has {chk.blockers.join(', ')}. Delete or reassign those first, so nothing is left orphaned.</>,
          tone: 'warning',
        });
        return;
      }
      const ok = await confirm({
        title: 'Delete customer?',
        message: (
          <>
            Delete <strong>{c.name}</strong>? Nothing you entered references them, so no invoices or orders are affected.
            {!!chk.counts?.derivedPayments && (
              <> The {chk.counts.derivedPayments} payment{chk.counts.derivedPayments === 1 ? '' : 's'} the cash-book
              reconciliation generated for them {chk.counts.derivedPayments === 1 ? 'is' : 'are'} removed too — those are
              rebuilt from the bank book each time you Recompute.</>
            )}
            {' '}This cannot be undone.
          </>
        ),
        tone: 'danger', confirmLabel: 'Delete',
      });
      if (ok) removeCustomer.mutate(c.id);
    } finally { setDeletingId(null); }
  };

  // Build the ready-to-send message a customer receives: greeting, the short
  // portal link, and — while they're still on the auto-generated password —
  // the password itself plus a note that they'll set their own on first login.
  const buildPortalMessage = (c: Customer) => {
    const shortUrl = c.portalShortCode
      ? `${window.location.origin}/p/${c.portalShortCode}`
      : `${window.location.origin}/s/admin/portal/${c.shareToken}`;
    const lines = [
      `Hi ${c.name},`,
      '',
      'You can track your orders on our Customer Portal here:',
      shortUrl,
      '',
    ];
    const alreadySet = c.portalPasswordSet === true || c.portalPasswordSet === 1;
    if (!alreadySet && c.portalInitialPassword) {
      lines.push(`Password: ${c.portalInitialPassword}`);
    } else {
      lines.push('Please log in with the password you set earlier.');
    }
    return lines.join('\n');
  };

  const copyPortalLink = async (c: Customer) => {
    if (!c.shareToken && !c.portalShortCode) return;
    const message = buildPortalMessage(c);
    let ok = false;
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(message);
        ok = true;
      }
    } catch { /* fall through to the legacy copy path */ }
    if (!ok) {
      // Fallback for mobile / non-secure contexts where the async Clipboard API
      // is unavailable or blocked — a hidden textarea + execCommand still works.
      try {
        const ta = document.createElement('textarea');
        ta.value = message;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        ok = document.execCommand('copy');
        document.body.removeChild(ta);
      } catch { ok = false; }
    }
    if (ok) {
      setCopiedId(c.id);
      setTimeout(() => setCopiedId(null), 2000);
    } else {
      // Last resort: surface the message so it can be copied by hand.
      window.prompt('Copy this customer portal message:', message);
    }
  };
  const hideNames = useHideCustomerNames();
  // Reset to page 1 when the user changes the search — otherwise an empty page
  // would show because the result count usually shrinks.
  useEffect(() => { setPage(1); }, [search]);
  const { data, isLoading } = useQuery({
    queryKey: ['customers', search, page, pageSize],
    queryFn: () => api<ListResp>(`/customers?search=${encodeURIComponent(search)}&page=${page}&pageSize=${pageSize}`),
  });

  const shareWhatsapp = async (c: Customer) => {
    if (!c.phone) return;
    // Send the same portal message (link + password) we'd put on the clipboard.
    const message = (c.shareToken || c.portalShortCode)
      ? buildPortalMessage(c)
      : `Hi ${c.name}, this is from Metflux.`;
    const res = await api<{ url: string }>('/whatsapp/share-url', {
      method: 'POST',
      json: { phone: c.phone, message },
    });
    window.open(res.url, '_blank', 'noopener,noreferrer');
  };

  const bulkConfig: BulkExcelConfig = {
    entityLabel: 'Customers',
    filenameBase: 'customers',
    sheetName: 'Customers',
    template: [
      { header: 'Name', example: 'Aarti Steels' },
      { header: 'Customer Code', example: '(blank = auto)' },
      { header: 'Phone', example: '+91 98765 43210' },
      { header: 'Email', example: 'accounts@aarti.com' },
      { header: 'State', example: 'Maharashtra' },
      { header: 'GSTIN', example: '27AAAAA0000A1Z5' },
      { header: 'GST Rate', example: '18' },
      { header: 'Credit Terms (Days)', example: '30' },
      { header: 'Address', example: 'Plot 12, MIDC' },
      { header: 'Notes', example: '' },
    ],
    fetchExportRows: async () => {
      const all = await api<{ items: Array<Record<string, unknown>> }>('/customers?pageSize=500');
      return all.items.map((c) => ({
        'Customer Code': (c.customerCode as string) ?? '',
        'Name': (c.name as string) ?? '',
        'Phone': (c.phone as string) ?? '',
        'Email': (c.email as string) ?? '',
        'State': (c.state as string) ?? '',
        'GSTIN': (c.gstNumber as string) ?? '',
        'GST Rate': (c.gstRate as number) ?? 0,
        'Credit Terms (Days)': (c.dueDays as number | null) ?? '',
        'Address': (c.address as string) ?? '',
        'Notes': (c.notes as string) ?? '',
      }));
    },
    importPath: '/customers/import',
    onImported: () => qc.invalidateQueries({ queryKey: ['customers'] }),
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Customers</h1>
        <div className="flex items-center gap-2">
          <BulkExcel config={bulkConfig} />
          <Link to="/customers/new" className="btn-primary">
            <Plus className="h-4 w-4" /> Add Customer
          </Link>
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="flex items-center gap-3 border-b border-slate-200 px-4 py-3">
          <div className="relative flex-1 max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              className="input pl-9"
              placeholder="Search by name, email or phone"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="text-xs text-slate-500">{data ? `${data.total} customer${data.total === 1 ? '' : 's'}` : ''}</div>
        </div>

        {isLoading ? (
          <div className="px-4 py-10 text-center text-slate-400">Loading…</div>
        ) : !data?.items.length ? (
          <div className="px-4 py-10 text-center text-slate-400">
            <div className="flex flex-col items-center gap-2">
              <Building2 className="h-6 w-6 text-slate-300" />
              <span>No customers{search ? ' match your search.' : ' yet.'}</span>
              {!search && (
                <Link to="/customers/new" className="text-brand-700 hover:text-brand-800 text-sm font-medium">
                  Add your first customer →
                </Link>
              )}
            </div>
          </div>
        ) : (
          <>
            {/* Desktop / tablet — table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Code</th>
                    <th className="px-4 py-3">Name</th>
                    <th className="px-4 py-3">Email</th>
                    <th className="px-4 py-3">Phone</th>
                    <th className="px-4 py-3">GSTIN</th>
                    <th className="px-4 py-3 text-right">GST %</th>
                    <th className="px-4 py-3">State</th>
                    <th className="px-4 py-3 w-40 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((c) => (
                    <tr key={c.id} className="border-t border-slate-100 hover:bg-slate-50">
                      <td className="px-4 py-3 font-mono text-xs font-semibold text-brand-700">{c.customerCode}</td>
                      <td className="px-4 py-3 font-medium text-slate-900">{hideNames ? '••••••' : c.name}</td>
                      <td className="px-4 py-3 text-slate-600">{c.email ?? '—'}</td>
                      <td className="px-4 py-3 text-slate-600 font-mono text-xs">{c.phone ?? '—'}</td>
                      <td className="px-4 py-3 text-slate-600 font-mono text-xs">{c.gstNumber ?? '—'}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-slate-600">{c.gstRate ? `${c.gstRate}%` : '—'}</td>
                      <td className="px-4 py-3 text-slate-600">{c.state ?? '—'}</td>
                      <td className="px-4 py-3 text-right">
                        <div className="inline-flex items-center gap-1">
                          {c.phone && (
                            <button onClick={() => shareWhatsapp(c)} className="btn-ghost text-emerald-700 hover:bg-emerald-50" title="Share via WhatsApp">
                              <MessageCircle className="h-4 w-4" />
                            </button>
                          )}
                          {(c.shareToken || c.portalShortCode) && (
                            <button
                              onClick={() => copyPortalLink(c)}
                              className={cn('btn-ghost transition-colors', copiedId === c.id ? 'text-emerald-600 hover:bg-emerald-50' : 'text-slate-500 hover:bg-slate-100')}
                              title={copiedId === c.id ? 'Message copied!' : 'Copy portal link + password'}
                            >
                              {copiedId === c.id ? <Check className="h-4 w-4" /> : <Link2 className="h-4 w-4" />}
                            </button>
                          )}
                          <Link to={`/customers/${c.id}`} className="btn-ghost text-brand-700 hover:bg-brand-50" title="Edit customer">
                            <Pencil className="h-4 w-4" />
                          </Link>
                          <button
                            onClick={() => onConvertToExpense(c)}
                            disabled={deletingId === c.id || toExpense.isPending}
                            className="btn-ghost text-amber-600 hover:bg-amber-50 disabled:opacity-40"
                            title="Not a customer — convert to an expense head (salary, rent, freight…)"
                          >
                            <Tag className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => onDelete(c)}
                            disabled={deletingId === c.id || removeCustomer.isPending}
                            className="btn-ghost text-red-600 hover:bg-red-50 disabled:opacity-40"
                            title="Delete customer (only if nothing references them)"
                          >
                            {deletingId === c.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile — one card per customer, with reachable actions */}
            <div className="md:hidden divide-y divide-slate-100">
              {data.items.map((c) => (
                <div key={c.id} className="px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-slate-900 truncate">{hideNames ? '••••••' : c.name}</div>
                      <div className="mt-0.5 font-mono text-xs font-semibold text-brand-700">{c.customerCode}</div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <Link
                        to={`/customers/${c.id}`}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-brand-700 active:bg-brand-50"
                      >
                        <Pencil className="h-3.5 w-3.5" /> Edit
                      </Link>
                      <button
                        onClick={() => onConvertToExpense(c)}
                        disabled={deletingId === c.id || toExpense.isPending}
                        className="inline-flex items-center rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-amber-600 active:bg-amber-50 disabled:opacity-40"
                        aria-label={`Convert ${c.name} to an expense head`}
                      >
                        <Tag className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => onDelete(c)}
                        disabled={deletingId === c.id || removeCustomer.isPending}
                        className="inline-flex items-center rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-red-600 active:bg-red-50 disabled:opacity-40"
                        aria-label={`Delete ${c.name}`}
                      >
                        {deletingId === c.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                      </button>
                    </div>
                  </div>

                  <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                    {c.phone && <Detail label="Phone" value={c.phone} mono />}
                    {c.gstRate ? <Detail label="GST" value={`${c.gstRate}%`} /> : null}
                    {c.gstNumber && <Detail label="GSTIN" value={c.gstNumber} mono />}
                    {c.state && <Detail label="State" value={c.state} />}
                    {c.email && <Detail label="Email" value={c.email} full />}
                  </dl>

                  {(c.shareToken || c.portalShortCode || c.phone) && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {(c.shareToken || c.portalShortCode) && (
                        <button
                          onClick={() => copyPortalLink(c)}
                          className={cn(
                            'inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors',
                            copiedId === c.id ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-slate-200 text-slate-600 active:bg-slate-50'
                          )}
                        >
                          {copiedId === c.id ? <Check className="h-3.5 w-3.5" /> : <Link2 className="h-3.5 w-3.5" />}
                          {copiedId === c.id ? 'Copied' : 'Copy portal message'}
                        </button>
                      )}
                      {c.phone && (
                        <button
                          onClick={() => shareWhatsapp(c)}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 px-3 py-1.5 text-xs font-medium text-emerald-700 active:bg-emerald-50"
                        >
                          <MessageCircle className="h-3.5 w-3.5" /> WhatsApp
                        </button>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
        {data && (
          <Pagination
            page={page}
            pageSize={pageSize}
            total={data.total}
            onPageChange={setPage}
            onPageSizeChange={changePageSize}
          />
        )}
      </div>
      {confirmDialog}
    </div>
  );
};

/* Label/value pair for the mobile customer cards. */
const Detail = ({ label, value, mono, full }: { label: string; value: string; mono?: boolean; full?: boolean }) => (
  <div className={full ? 'col-span-2 min-w-0' : 'min-w-0'}>
    <dt className="text-[10px] font-medium uppercase tracking-wide text-slate-400">{label}</dt>
    <dd className={cn('truncate text-slate-700', mono && 'font-mono text-[11px]')}>{value}</dd>
  </div>
);
