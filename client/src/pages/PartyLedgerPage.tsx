// Party Ledger — a running account statement for one trading party. Balances
// tie exactly to Amount Receivable / Payable (same ledger-basis sources).
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BookOpen, Download, Loader2, ArrowUpRight, ArrowDownRight } from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { SearchableSelect } from '@/components/SearchableSelect';
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
  'Sales Invoice': 'bg-brand-50 text-brand-700',
  'Purchase Bill': 'bg-indigo-50 text-indigo-700',
  Receipt:         'bg-green-50 text-green-700',
  Payment:         'bg-amber-50 text-amber-700',
  'Credit Note':   'bg-rose-50 text-rose-700',
  'Debit Note':    'bg-rose-50 text-rose-700',
  Journal:         'bg-slate-100 text-slate-600',
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

  return (
    <div className="space-y-4 sm:space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight sm:text-2xl">
          <BookOpen className="h-6 w-6 text-brand-600" /> Party Ledger
        </h1>
        <button
          type="button" onClick={onExport} disabled={!ledger || !ledger.rows.length}
          className="btn-ghost w-full justify-center border border-slate-300 text-emerald-700 hover:bg-emerald-50 disabled:opacity-50 sm:w-auto"
        >
          <Download className="h-4 w-4" /> Excel
        </button>
      </div>

      {/* Controls */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="block lg:col-span-2">
            <span className="mb-1 block text-xs font-medium text-slate-600">Party</span>
            <SearchableSelect value={partyKey} onChange={setPartyKey} options={options} placeholder="Search a customer or supplier…" />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-600">From</span>
            <input type="date" className="input w-full" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-600">To</span>
            <input type="date" className="input w-full" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
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
          {/* Summary */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm lg:col-span-2">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Party</div>
              <div className="mt-1 text-base font-bold text-slate-900">{ledger.party.name}</div>
              <div className="mt-1 flex gap-1.5">
                {ledger.party.isCustomer && <span className="rounded-full bg-brand-50 px-2 py-0.5 text-[10px] font-semibold text-brand-700">Customer</span>}
                {ledger.party.isSupplier && <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-semibold text-indigo-700">Supplier</span>}
              </div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Opening</div>
              <div className="mt-1 text-lg font-bold tabular-nums text-slate-700">{drcr(ledger.openingBalance)}</div>
            </div>
            <div className={cn('rounded-xl border p-4 shadow-sm', ledger.closingBalance >= 0 ? 'border-brand-200 bg-brand-50' : 'border-amber-200 bg-amber-50')}>
              <div className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                {ledger.closingBalance >= 0 ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />} Closing ({ledger.closingBalance >= 0 ? 'Receivable' : 'Payable'})
              </div>
              <div className={cn('mt-1 text-lg font-bold tabular-nums', ledger.closingBalance >= 0 ? 'text-brand-700' : 'text-amber-700')}>{drcr(ledger.closingBalance)}</div>
            </div>
          </div>

          {/* Ledger — desktop table */}
          <div className="hidden overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm md:block">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500">
                  <th className="px-3 py-2.5">Date</th>
                  <th className="px-3 py-2.5">Voucher</th>
                  <th className="px-3 py-2.5">Particulars</th>
                  <th className="px-3 py-2.5 text-right">Debit</th>
                  <th className="px-3 py-2.5 text-right">Credit</th>
                  <th className="px-3 py-2.5 text-right">Balance</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-slate-100 bg-slate-50/40 text-slate-500">
                  <td className="px-3 py-2 font-medium" colSpan={5}>Opening Balance</td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums">{drcr(ledger.openingBalance)}</td>
                </tr>
                {ledger.rows.map((r, i) => (
                  <tr key={i} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/60">
                    <td className="whitespace-nowrap px-3 py-2 text-slate-600">{fmtDate(r.date)}</td>
                    <td className="px-3 py-2">
                      <span className={cn('mr-2 inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold', typeStyle[r.type] ?? 'bg-slate-100 text-slate-600')}>{r.type}</span>
                      <span className="font-mono text-xs text-slate-500">{r.voucherNo}</span>
                    </td>
                    <td className="px-3 py-2 text-slate-600">{r.particulars}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.debit ? fmt(r.debit) : <span className="text-slate-300">—</span>}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.credit ? fmt(r.credit) : <span className="text-slate-300">—</span>}</td>
                    <td className="px-3 py-2 text-right font-medium tabular-nums text-slate-700">{drcr(r.balance)}</td>
                  </tr>
                ))}
                <tr className="border-t-2 border-slate-200 bg-slate-50 font-semibold">
                  <td className="px-3 py-2.5" colSpan={3}>Closing Balance</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{fmt(ledger.totals.debit)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{fmt(ledger.totals.credit)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{drcr(ledger.closingBalance)}</td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Ledger — mobile cards */}
          <div className="space-y-2.5 md:hidden">
            {ledger.rows.map((r, i) => (
              <div key={i} className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className={cn('rounded px-1.5 py-0.5 text-[10px] font-semibold', typeStyle[r.type] ?? 'bg-slate-100 text-slate-600')}>{r.type}</span>
                  <span className="text-xs text-slate-500">{fmtDate(r.date)}</span>
                </div>
                <div className="mt-1 font-mono text-xs text-slate-500">{r.voucherNo} {r.particulars && `· ${r.particulars}`}</div>
                <div className="mt-2 flex items-center justify-between text-sm">
                  <span className="tabular-nums">{r.debit ? <span className="text-slate-700">Dr {fmt(r.debit)}</span> : r.credit ? <span className="text-slate-700">Cr {fmt(r.credit)}</span> : ''}</span>
                  <span className="font-semibold tabular-nums text-slate-800">{drcr(r.balance)}</span>
                </div>
              </div>
            ))}
            {ledger.rows.length === 0 && (
              <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-400">No transactions in this period.</div>
            )}
          </div>
        </>
      )}
    </div>
  );
};

export default PartyLedgerPage;
