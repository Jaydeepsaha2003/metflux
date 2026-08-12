// Party Ledger — a running account statement for one trading party, in a
// Tally-style ERP layout (brand header band, dense gridded ledger, running
// Dr/Cr balance). Balances tie exactly to Amount Receivable / Payable.
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BookOpen, Download, Loader2, Calendar, User2, ArrowUpRight, ArrowDownRight } from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { SearchableSelect } from '@/components/SearchableSelect';
import { DateRangeFilter } from '@/components/DateRangeFilter';
import { downloadXlsx, todayStamp } from '@/lib/excel';

type Party = { key: string; name: string; isCustomer: boolean; isSupplier: boolean; balance: number };
type Row = { date: string; type: string; voucherNo: string; particulars: string; debit: number; credit: number; balance: number };
type Ledger = {
  party: { key: string; name: string; isCustomer: boolean; isSupplier: boolean };
  openingBalance: number; closingBalance: number;
  totals: { debit: number; credit: number };
  rows: Row[];
};

const fmt = (n: number) => Math.abs(Number(n) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const drcr = (n: number) => (Math.abs(n) < 0.005 ? '0.00' : `${fmt(n)} ${n >= 0 ? 'Dr' : 'Cr'}`);
const fmtDate = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
};

const typeStyle: Record<string, string> = {
  'Sales Invoice': 'bg-brand-50 text-brand-700 ring-brand-200',
  'Purchase Bill': 'bg-indigo-50 text-indigo-700 ring-indigo-200',
  Receipt:         'bg-emerald-50 text-emerald-700 ring-emerald-200',
  Payment:         'bg-amber-50 text-amber-700 ring-amber-200',
  'Credit Note':   'bg-rose-50 text-rose-700 ring-rose-200',
  'Debit Note':    'bg-rose-50 text-rose-700 ring-rose-200',
  Journal:         'bg-slate-100 text-slate-600 ring-slate-200',
};

export const PartyLedgerPage = () => {
  const [partyKey, setPartyKey] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const { data: partyResp } = useQuery({
    queryKey: ['party-ledger', 'parties'],
    queryFn: () => api<{ parties: Party[] }>('/party-ledger/parties'),
  });
  const parties = partyResp?.parties ?? [];

  const { data: ledger, isLoading, isFetching } = useQuery({
    queryKey: ['party-ledger', partyKey, from, to],
    queryFn: () => api<Ledger>(`/party-ledger?key=${encodeURIComponent(partyKey)}${from ? `&from=${from}` : ''}${to ? `&to=${to}` : ''}`),
    enabled: !!partyKey,
  });

  const options = useMemo(
    () => parties.map((p) => ({ value: p.key, label: `${p.name}  ·  ${drcr(p.balance)}` })),
    [parties]
  );

  const onExport = () => {
    if (!ledger) return;
    const rows: Record<string, string | number>[] = [
      { Date: '', Voucher: '', Type: 'Opening Balance', Particulars: '', Debit: '', Credit: '', Balance: drcr(ledger.openingBalance) },
      ...ledger.rows.map((r) => ({
        Date: fmtDate(r.date), Voucher: r.voucherNo, Type: r.type, Particulars: r.particulars,
        Debit: r.debit || '', Credit: r.credit || '', Balance: drcr(r.balance),
      })),
      { Date: '', Voucher: '', Type: 'Closing Balance', Particulars: '', Debit: ledger.totals.debit, Credit: ledger.totals.credit, Balance: drcr(ledger.closingBalance) },
    ];
    downloadXlsx(`ledger-${ledger.party.name.replace(/[^a-z0-9]+/gi, '-')}-${todayStamp()}`, 'Ledger', rows);
  };

  const receivable = (ledger?.closingBalance ?? 0) >= 0;

  return (
    <div className="space-y-4 sm:space-y-5">
      {/* ── Brand header band (follows the active company's brand colour) ── */}
      <div className="flex flex-col gap-3 rounded-xl bg-brand-600 px-4 py-3.5 text-white shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-white/15 ring-1 ring-white/20">
            <BookOpen className="h-5 w-5" />
          </span>
          <div>
            <h1 className="text-base font-bold leading-tight tracking-wide sm:text-lg">Party Ledger</h1>
            <p className="text-[11px] text-white/75">Running account statement · ties to Amount Receivable / Payable</p>
          </div>
        </div>
        <button
          type="button" onClick={onExport} disabled={!ledger || !ledger.rows.length}
          className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-white/25 bg-white/15 px-3 py-2 text-sm font-semibold text-white hover:bg-white/25 disabled:opacity-50 sm:w-auto"
        >
          <Download className="h-4 w-4" /> Export Excel
        </button>
      </div>

      {/* ── Toolbar: party + date range ── */}
      <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm sm:p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="block lg:col-span-2">
            <span className="mb-1 flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500"><User2 className="h-3.5 w-3.5" /> Party</span>
            <SearchableSelect value={partyKey} onChange={setPartyKey} options={options} placeholder="Search a customer or supplier…" />
          </label>
          <div className="block lg:col-span-2">
            <span className="mb-1 flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500"><Calendar className="h-3.5 w-3.5" /> Date range</span>
            <DateRangeFilter from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t); }} label="Filter ledger by date" className="w-full" />
          </div>
        </div>
      </div>

      {!partyKey && (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-400">
          Pick a party above to view their ledger.
        </div>
      )}

      {partyKey && (isLoading || isFetching) && !ledger && (
        <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-400">
          <Loader2 className="mx-auto h-5 w-5 animate-spin" />
        </div>
      )}

      {ledger && (
        <>
          {/* ── Summary strip ── */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <div className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm lg:col-span-1">
              <div className="text-[10.5px] font-semibold uppercase tracking-wide text-slate-400">Party</div>
              <div className="mt-1 truncate text-sm font-bold text-slate-900" title={ledger.party.name}>{ledger.party.name}</div>
              <div className="mt-1.5 flex gap-1.5">
                {ledger.party.isCustomer && <span className="rounded-full bg-brand-50 px-2 py-0.5 text-[10px] font-semibold text-brand-700 ring-1 ring-brand-200">Customer</span>}
                {ledger.party.isSupplier && <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-semibold text-indigo-700 ring-1 ring-indigo-200">Supplier</span>}
              </div>
            </div>
            <Stat label="Opening" value={drcr(ledger.openingBalance)} tone="slate" />
            <Stat label="Total Debit" value={fmt(ledger.totals.debit)} tone="slate" sub={`Credit ${fmt(ledger.totals.credit)}`} />
            <div className={cn('relative overflow-hidden rounded-xl border p-3.5 shadow-sm', receivable ? 'border-brand-200 bg-brand-50' : 'border-amber-200 bg-amber-50')}>
              <span className={cn('absolute inset-y-0 left-0 w-1', receivable ? 'bg-brand-500' : 'bg-amber-500')} />
              <div className="flex items-center gap-1 text-[10.5px] font-semibold uppercase tracking-wide text-slate-500">
                {receivable ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />} Closing · {receivable ? 'Receivable' : 'Payable'}
              </div>
              <div className={cn('mt-1 text-lg font-bold tabular-nums', receivable ? 'text-brand-700' : 'text-amber-700')}>{drcr(ledger.closingBalance)}</div>
            </div>
          </div>

          {/* ── Ledger — Tally-style dense table (desktop) ── */}
          <div className="hidden overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm md:block">
            <table className="w-full min-w-[760px] text-[13px]">
              <thead>
                <tr className="border-b-2 border-slate-300 bg-slate-100 text-left text-[10.5px] uppercase tracking-wide text-slate-500">
                  <th className="px-3 py-2 font-semibold">Date</th>
                  <th className="px-3 py-2 font-semibold">Particulars</th>
                  <th className="px-3 py-2 font-semibold">Voucher</th>
                  <th className="px-3 py-2 text-right font-semibold">Debit</th>
                  <th className="px-3 py-2 text-right font-semibold">Credit</th>
                  <th className="px-3 py-2 text-right font-semibold">Balance</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-slate-200 bg-slate-50/70 text-slate-500">
                  <td className="px-3 py-2 font-medium italic" colSpan={5}>Opening Balance</td>
                  <td className="px-3 py-2 text-right font-bold tabular-nums">{drcr(ledger.openingBalance)}</td>
                </tr>
                {ledger.rows.map((r, i) => (
                  <tr key={i} className="border-b border-slate-100 last:border-0 odd:bg-white even:bg-slate-50/40 hover:bg-brand-50/40">
                    <td className="whitespace-nowrap px-3 py-1.5 text-slate-600">{fmtDate(r.date)}</td>
                    <td className="px-3 py-1.5">
                      <span className={cn('mr-2 inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold ring-1', typeStyle[r.type] ?? 'bg-slate-100 text-slate-600 ring-slate-200')}>{r.type}</span>
                      <span className="text-slate-600">{r.particulars}</span>
                    </td>
                    <td className="px-3 py-1.5 font-mono text-[11px] text-slate-500">{r.voucherNo || '—'}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{r.debit ? fmt(r.debit) : <span className="text-slate-300">—</span>}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{r.credit ? fmt(r.credit) : <span className="text-slate-300">—</span>}</td>
                    <td className="px-3 py-1.5 text-right font-medium tabular-nums text-slate-700">{drcr(r.balance)}</td>
                  </tr>
                ))}
                <tr className="border-t-2 border-slate-300 bg-slate-100 font-bold text-slate-800">
                  <td className="px-3 py-2.5" colSpan={3}>Closing Balance</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{fmt(ledger.totals.debit)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{fmt(ledger.totals.credit)}</td>
                  <td className={cn('px-3 py-2.5 text-right tabular-nums', receivable ? 'text-brand-700' : 'text-amber-700')}>{drcr(ledger.closingBalance)}</td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* ── Ledger — mobile cards ── */}
          <div className="space-y-2.5 md:hidden">
            <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs">
              <span className="font-medium italic text-slate-500">Opening Balance</span>
              <span className="font-bold tabular-nums text-slate-700">{drcr(ledger.openingBalance)}</span>
            </div>
            {ledger.rows.map((r, i) => (
              <div key={i} className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className={cn('rounded px-1.5 py-0.5 text-[10px] font-semibold ring-1', typeStyle[r.type] ?? 'bg-slate-100 text-slate-600 ring-slate-200')}>{r.type}</span>
                  <span className="text-xs text-slate-500">{fmtDate(r.date)}</span>
                </div>
                <div className="mt-1 font-mono text-[11px] text-slate-500">{r.voucherNo} {r.particulars && `· ${r.particulars}`}</div>
                <div className="mt-2 flex items-center justify-between text-sm">
                  <span className="tabular-nums text-slate-700">{r.debit ? `Dr ${fmt(r.debit)}` : r.credit ? `Cr ${fmt(r.credit)}` : ''}</span>
                  <span className="font-semibold tabular-nums text-slate-800">{drcr(r.balance)}</span>
                </div>
              </div>
            ))}
            <div className={cn('flex items-center justify-between rounded-xl border px-3 py-2.5 text-sm font-bold', receivable ? 'border-brand-200 bg-brand-50 text-brand-700' : 'border-amber-200 bg-amber-50 text-amber-700')}>
              <span>Closing Balance</span>
              <span className="tabular-nums">{drcr(ledger.closingBalance)}</span>
            </div>
            {ledger.rows.length === 0 && (
              <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-400">No transactions in this period.</div>
            )}
          </div>
        </>
      )}
    </div>
  );
};

const Stat = ({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone: 'slate' }) => (
  <div className="relative overflow-hidden rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm">
    <span className={cn('absolute inset-y-0 left-0 w-1', tone === 'slate' && 'bg-slate-300')} />
    <div className="text-[10.5px] font-semibold uppercase tracking-wide text-slate-400">{label}</div>
    <div className="mt-1 text-lg font-bold tabular-nums text-slate-700">{value}</div>
    {sub && <div className="mt-0.5 text-[11px] text-slate-400 tabular-nums">{sub}</div>}
  </div>
);

export default PartyLedgerPage;
