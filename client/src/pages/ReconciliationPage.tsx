// Receivable / Payable reconciliation — upload the accounting package's
// "Amount Receivable" and "Amount Payable" statements and see, party by party,
// exactly where this system disagrees.
//
// Read-only by design: it posts nothing and adjusts nothing. Its job is to name
// the errors. System figures come from the same ledger basis as the Amount
// Receivable / Amount Payable pages, so the two always agree.
import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import {
  Scale, Upload, Loader2, CheckCircle2, AlertTriangle, Download, X, FileSpreadsheet, Search,
} from 'lucide-react';
import { api } from '@/lib/api';
import { readXlsxMatrix, downloadXlsx, todayStamp } from '@/lib/excel';
import { cn } from '@/lib/cn';
import { Panel, Th, StatStrip, num } from '@/components/tally';

type Status = 'MATCH' | 'DIFFERS' | 'MISSING_IN_SYSTEM' | 'MISSING_IN_FILE';
type Hint = {
  kind: 'OTHER_SIDE' | 'NEAR_MATCH' | 'NO_RECORD';
  text: string;
  near?: { name: string; score: number; balance: number; otherSide: boolean };
};
type Row = {
  name: string; systemName: string | null;
  fileBalance: number; systemBalance: number; difference: number; status: Status;
  hint?: Hint | null;
};
type Side = {
  asOn: string | null;
  rows: Row[];
  totals: {
    file: number; system: number; difference: number; parties: number;
    matched: number; differs: number; missingInSystem: number; missingInFile: number;
  };
};
type Result = { receivable: Side | null; payable: Side | null; tolerance: number };

const STATUS_META: Record<Status, { label: string; cls: string; hint: string }> = {
  MATCH:             { label: 'Matches',        cls: 'bg-emerald-50 text-emerald-700 ring-emerald-200', hint: 'System agrees with the statement.' },
  DIFFERS:           { label: 'Differs',        cls: 'bg-red-50 text-red-700 ring-red-200',             hint: 'Both have the party, but the balances disagree.' },
  MISSING_IN_SYSTEM: { label: 'Not in system',  cls: 'bg-amber-50 text-amber-700 ring-amber-200',       hint: 'On the statement, but this system carries no balance — usually invoices never imported.' },
  MISSING_IN_FILE:   { label: 'Not in file',    cls: 'bg-violet-50 text-violet-700 ring-violet-200',    hint: 'This system carries a balance the statement does not list at all.' },
};

const FilePicker = ({ label, file, onPick, onClear, tone }: {
  label: string; file: File | null; onPick: (f: File) => void; onClear: () => void; tone: string;
}) => {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div className={cn('flex items-center gap-2 rounded border px-3 py-2', file ? tone : 'border-dashed border-slate-300 bg-white')}>
      <FileSpreadsheet className={cn('h-4 w-4 shrink-0', file ? '' : 'text-slate-400')} />
      <div className="min-w-0 flex-1">
        <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{label}</div>
        <div className="truncate text-xs font-medium text-slate-700">{file ? file.name : 'No file chosen'}</div>
      </div>
      <input ref={ref} type="file" accept=".csv,.xlsx,.xls" className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onPick(f); e.target.value = ''; }} />
      {file
        ? <button onClick={onClear} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-red-600" title="Remove"><X className="h-3.5 w-3.5" /></button>
        : <button onClick={() => ref.current?.click()} className="inline-flex h-7 items-center gap-1 rounded border border-slate-300 bg-white px-2 text-[11px] font-semibold text-slate-700 hover:bg-slate-50">
            <Upload className="h-3 w-3" /> Choose
          </button>}
    </div>
  );
};

export const ReconciliationPage = () => {
  const [recFile, setRecFile] = useState<File | null>(null);
  const [payFile, setPayFile] = useState<File | null>(null);
  const [tolerance, setTolerance] = useState('1');
  const [result, setResult] = useState<Result | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const run = useMutation({
    mutationFn: async () => {
      const body: Record<string, unknown> = { tolerance: Number(tolerance) || 0 };
      if (recFile) body.receivableRows = await readXlsxMatrix(recFile);
      if (payFile) body.payableRows = await readXlsxMatrix(payFile);
      return api<Result>('/reconciliation/compare', { method: 'POST', json: body });
    },
    onSuccess: (r) => { setResult(r); setErr(null); },
    onError: (e) => { setErr(e instanceof Error ? e.message : 'Could not compare the files.'); setResult(null); },
  });

  const canRun = (!!recFile || !!payFile) && !run.isPending;

  return (
    <div className="max-w-full space-y-3 text-[13px]">
      <div className="flex flex-col gap-2 rounded border border-brand-700 bg-brand-600 px-3 py-2 text-white sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2.5">
          <span className="grid h-8 w-8 place-items-center rounded bg-white/15 ring-1 ring-white/25"><Scale className="h-4 w-4" /></span>
          <div>
            <h1 className="text-sm font-bold uppercase tracking-wider sm:text-base">Receivable / Payable Reconciliation</h1>
            <p className="text-[10.5px] text-white/75">Upload both statements as on today — every disagreement is listed party by party</p>
          </div>
        </div>
      </div>

      <Panel title={<><Upload className="h-3.5 w-3.5" /> Statements</>}>
        <div className="grid gap-2 p-2 sm:grid-cols-2">
          <FilePicker label="Amount Receivable" file={recFile} tone="border-emerald-300 bg-emerald-50/60"
            onPick={setRecFile} onClear={() => setRecFile(null)} />
          <FilePicker label="Amount Payable" file={payFile} tone="border-rose-300 bg-rose-50/60"
            onPick={setPayFile} onClear={() => setPayFile(null)} />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-slate-50 px-3 py-2">
          <label className="flex items-center gap-2 text-[11px] text-slate-600">
            <span className="font-semibold uppercase tracking-wider text-slate-500">Tolerance ₹</span>
            <input type="number" min="0" step="0.01" value={tolerance} onChange={(e) => setTolerance(e.target.value)}
              className="h-7 w-20 rounded border border-slate-300 px-2 text-right font-mono text-xs" />
            <span className="text-slate-400">differences up to this count as a match</span>
          </label>
          <button onClick={() => run.mutate()} disabled={!canRun}
            className="inline-flex h-8 items-center gap-1.5 rounded bg-brand-600 px-4 text-xs font-bold uppercase tracking-wide text-white hover:bg-brand-700 disabled:opacity-50">
            {run.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Scale className="h-3.5 w-3.5" />} Reconcile
          </button>
        </div>
        {!recFile && !payFile && (
          <p className="border-t border-slate-100 px-3 py-2 text-[11px] text-slate-500">
            Export <b>Amount Receivable</b> and <b>Amount Payable</b> from your accounting package as on today and choose them above.
            You can reconcile just one side if you prefer. Nothing is posted or changed — this only reports.
          </p>
        )}
      </Panel>

      {err && <div className="rounded border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700">{err}</div>}

      {result?.receivable && <SideReport title="Amount Receivable" side={result.receivable} tone="emerald" />}
      {result?.payable && <SideReport title="Amount Payable" side={result.payable} tone="rose" />}
    </div>
  );
};

const SideReport = ({ title, side, tone }: { title: string; side: Side; tone: 'emerald' | 'rose' }) => {
  const [filter, setFilter] = useState<'ALL' | Status>('ALL');
  const [search, setSearch] = useState('');
  const t = side.totals;
  const clean = t.differs === 0 && t.missingInSystem === 0 && t.missingInFile === 0;

  const rows = side.rows.filter((r) =>
    (filter === 'ALL' || r.status === filter) &&
    (!search.trim() || r.name.toLowerCase().includes(search.trim().toLowerCase())));

  const exportExcel = () => downloadXlsx(`reconciliation-${title.toLowerCase().replace(/\s+/g, '-')}-${todayStamp()}`, 'Reconciliation',
    side.rows.map((r) => ({
      Party: r.name, Status: STATUS_META[r.status].label,
      'Statement balance': r.fileBalance, 'System balance': r.systemBalance, Difference: r.difference,
    })));

  const chip = (key: 'ALL' | Status, label: string, count: number) => (
    <button key={key} onClick={() => setFilter(key)}
      className={cn('rounded px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-wide ring-1 transition',
        filter === key ? 'bg-brand-600 text-white ring-brand-600' : 'bg-white text-slate-600 ring-slate-300 hover:bg-slate-50')}>
      {label} {count}
    </button>
  );

  return (
    <Panel
      title={<>{title} {side.asOn && <span className="font-normal normal-case tracking-normal text-slate-400">· as on {side.asOn}</span>}</>}
      right={
        <button onClick={exportExcel} className="inline-flex h-7 items-center gap-1 rounded border border-slate-300 px-2 text-[10.5px] font-bold uppercase tracking-wide text-emerald-700 hover:bg-emerald-50">
          <Download className="h-3 w-3" /> Excel
        </button>
      }
    >
      <div className={cn('flex items-center gap-1.5 border-b px-3 py-2 text-[11px] font-bold uppercase tracking-wider',
        clean ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-red-200 bg-red-50 text-red-800')}>
        {clean
          ? <><CheckCircle2 className="h-3.5 w-3.5" /> All {t.parties} parties reconcile</>
          : <><AlertTriangle className="h-3.5 w-3.5" /> {t.differs + t.missingInSystem + t.missingInFile} of {t.parties} parties need attention</>}
      </div>

      <StatStrip cols={4} items={[
        { label: 'Statement total', value: num(t.file), tone: tone === 'emerald' ? 'text-emerald-700' : 'text-rose-700' },
        { label: 'System total', value: num(t.system), tone: 'text-slate-700' },
        { label: 'Difference', value: num(t.difference), tone: Math.abs(t.difference) < 1 ? 'text-emerald-700' : 'text-red-600' },
        { label: 'Parties', value: String(t.parties), tone: 'text-slate-700' },
      ]} />

      <div className="flex flex-wrap items-center gap-2 border-y border-slate-200 bg-slate-50 px-3 py-2">
        <div className="flex flex-wrap gap-1.5">
          {chip('ALL', 'All', t.parties)}
          {chip('DIFFERS', 'Differs', t.differs)}
          {chip('MISSING_IN_SYSTEM', 'Not in system', t.missingInSystem)}
          {chip('MISSING_IN_FILE', 'Not in file', t.missingInFile)}
          {chip('MATCH', 'Matches', t.matched)}
        </div>
        <div className="relative ml-auto min-w-[160px] flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <input className="h-7 w-full rounded border border-slate-300 bg-white pl-7 pr-2 text-xs" placeholder="Find a party…"
            value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="py-8 text-center text-xs text-slate-400">Nothing in this group.</div>
      ) : (
        <div className="max-h-[560px] overflow-auto">
          <table className="w-full border-collapse text-xs whitespace-nowrap">
            <thead className="sticky top-0 z-10"><tr>
              <Th>Party</Th>
              <Th className="w-36">Status</Th>
              <Th align="right" className="w-36 border-l border-slate-300">Statement</Th>
              <Th align="right" className="w-36">System</Th>
              <Th align="right" className="w-36">Difference</Th>
            </tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={`${r.name}-${i}`} className={cn('border-b border-slate-100 hover:bg-brand-50/40',
                  r.status === 'DIFFERS' && 'bg-red-50/40')}>
                  <td className="max-w-[340px] px-2 py-1">
                    <div className="truncate font-medium text-slate-800" title={r.name}>{r.name}</div>
                    {r.hint && (
                      <div className={cn('truncate text-[10.5px]',
                        r.hint.kind === 'NEAR_MATCH' ? 'text-amber-700' : 'text-slate-400')} title={r.hint.text}>
                        {r.hint.kind === 'NEAR_MATCH' ? '↳ ' : ''}{r.hint.text}
                        {r.hint.near && r.hint.near.balance > 0 && <> · carries {num(r.hint.near.balance)}</>}
                      </div>
                    )}
                  </td>
                  <td className="px-2 py-1">
                    <span className={cn('rounded px-1.5 py-0.5 text-[10px] font-medium ring-1', STATUS_META[r.status].cls)}
                      title={STATUS_META[r.status].hint}>
                      {STATUS_META[r.status].label}
                    </span>
                  </td>
                  <td className="border-l border-slate-200 px-2 py-1 text-right font-mono tabular-nums text-slate-700">{num(r.fileBalance)}</td>
                  <td className="px-2 py-1 text-right font-mono tabular-nums text-slate-700">{num(r.systemBalance)}</td>
                  <td className={cn('px-2 py-1 text-right font-mono tabular-nums font-semibold',
                    Math.abs(r.difference) < 1 ? 'text-slate-400' : r.difference < 0 ? 'text-red-600' : 'text-brand-700')}>
                    {r.difference === 0 ? '—' : num(r.difference)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="border-t border-slate-200 bg-slate-50 px-3 py-2 text-[11px] leading-relaxed text-slate-500">
        <b>Differs</b> — both sides know the party but disagree; usually a missing invoice or an unrecorded receipt/payment.{' '}
        <b>Not in system</b> — on the statement but this system has no balance, normally invoices that were never imported (check the{' '}
        <Link to="/sales-invoices" className="font-semibold text-brand-700 underline">Sales</Link> /{' '}
        <Link to="/accounts/purchases" className="font-semibold text-brand-700 underline">Purchase</Link> register).{' '}
        <b>Not in file</b> — this system carries a balance the statement omits. Open a party in the{' '}
        <Link to="/accounts/party-ledger" className="font-semibold text-brand-700 underline">Party Ledger</Link> to see how its figure was built.
        <div className="mt-1.5 border-t border-slate-200 pt-1.5">
          <b className="text-slate-600">Working order:</b>{' '}
          <b>1.</b> Fix the <span className="text-amber-700">↳ possibly the same party</span> rows first — those are one party under two
          spellings, so both sides are wrong until they're merged.{' '}
          <b>2.</b> Then “No invoices imported” rows — re-upload the register that should contain them.{' '}
          <b>3.</b> Only then chase what's left; genuine differences are usually a missing receipt or an unrecorded credit note.
        </div>
      </div>
    </Panel>
  );
};
