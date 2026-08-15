// Proof that a register import read the file correctly.
//
// The registers state their own grand total, so after parsing we can compare
// what we read against what the file says it contains. It also names which
// column each figure came from — the single most common cause of a register not
// tying out is the importer picking "Sale Amount" (pre-tax) instead of
// "Total Amount", which is invisible unless you say so.
import { AlertTriangle, CheckCircle2, Info } from 'lucide-react';
import { cn } from '@/lib/cn';

export type ImportFileCheck = {
  columns: { amount: string | null; taxable: string | null; date: string | null; voucher: string | null; party: string | null };
  dateOrder: 'DMY' | 'MDY';
  rowsInFile: number;
  parsedTotal: number;
  statedTotal: number | null;
  difference: number | null;
  matches: boolean | null;
};

const inr = (n: number) => '₹' + Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const ImportCheck = ({ check }: { check?: ImportFileCheck | null }) => {
  if (!check) return null;
  const ok = check.matches === true;
  const bad = check.matches === false;

  return (
    <div className={cn('rounded-lg border px-3 py-2 text-xs',
      ok ? 'border-emerald-300 bg-emerald-50 text-emerald-900'
        : bad ? 'border-red-300 bg-red-50 text-red-900'
        : 'border-slate-200 bg-slate-50 text-slate-700')}>
      <div className="flex items-center gap-1.5 font-bold uppercase tracking-wider">
        {ok ? <><CheckCircle2 className="h-3.5 w-3.5" /> File verified — totals tie out</>
          : bad ? <><AlertTriangle className="h-3.5 w-3.5" /> Totals do not tie out</>
          : <><Info className="h-3.5 w-3.5" /> Read {check.rowsInFile} row{check.rowsInFile === 1 ? '' : 's'}</>}
      </div>

      <div className="mt-1 font-mono tabular-nums">
        Read <b>{inr(check.parsedTotal)}</b> from {check.rowsInFile} row{check.rowsInFile === 1 ? '' : 's'}
        {check.statedTotal != null && <> · file's own total <b>{inr(check.statedTotal)}</b></>}
        {bad && check.difference != null && (
          <span className="font-sans font-bold"> · off by {inr(Math.abs(check.difference))}</span>
        )}
      </div>

      {/* Naming the source column turns a silent misread into an obvious one. */}
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 opacity-80">
        <span>Amount ← <b>{check.columns.amount ?? '—'}</b></span>
        {check.columns.taxable && <span>Taxable ← <b>{check.columns.taxable}</b></span>}
        <span>Date ← <b>{check.columns.date ?? '—'}</b> ({check.dateOrder === 'DMY' ? 'day-first' : 'month-first'})</span>
        <span>Party ← <b>{check.columns.party ?? '—'}</b></span>
      </div>

      {bad && (
        <div className="mt-1 font-sans">
          Check the <b>Amount</b> column named above is the one you expect — if it's a component such as “Sale Amount”
          or “Taxable Amount”, the register will read short by the tax. Otherwise the file may be missing rows or carry a
          total that excludes credit notes.
        </div>
      )}
      {check.statedTotal == null && (
        <div className="mt-1 font-sans opacity-75">No grand-total row found in the file, so the amount couldn't be cross-checked.</div>
      )}
    </div>
  );
};
