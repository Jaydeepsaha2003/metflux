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
  taxableTotal?: number;
  taxTotal?: number;
  componentsTotal?: number;
  componentGap?: number;
  /** Does the chosen amount column equal taxable + tax? null = no tax columns. */
  reconcilesWithTax?: boolean | null;
};

const inr = (n: number) => '₹' + Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const ImportCheck = ({ check }: { check?: ImportFileCheck | null }) => {
  if (!check) return null;
  // Two independent tests: the file's own total, and whether the column we chose
  // actually equals taxable + tax. The second is what catches a pre-tax column,
  // which the first cannot — it would sum the wrong column correctly.
  const taxBad = check.reconcilesWithTax === false;
  const ok = check.matches === true && !taxBad;
  const bad = check.matches === false || taxBad;

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

      {check.reconcilesWithTax != null && (
        <div className={cn('mt-1 font-mono tabular-nums', taxBad && 'font-bold')}>
          Taxable {inr(check.taxableTotal ?? 0)} + tax {inr(check.taxTotal ?? 0)} = {inr(check.componentsTotal ?? 0)}
          {taxBad
            ? <span className="font-sans"> — does NOT match the amount column (off by {inr(Math.abs(check.componentGap ?? 0))})</span>
            : <span className="font-sans"> ✓ matches the amount column</span>}
        </div>
      )}

      {/* Naming the source column turns a silent misread into an obvious one. */}
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 opacity-80">
        <span>Amount ← <b>{check.columns.amount ?? '—'}</b></span>
        {check.columns.taxable && <span>Taxable ← <b>{check.columns.taxable}</b></span>}
        <span>Date ← <b>{check.columns.date ?? '—'}</b> ({check.dateOrder === 'DMY' ? 'day-first' : 'month-first'})</span>
        <span>Party ← <b>{check.columns.party ?? '—'}</b></span>
      </div>

      {taxBad && (
        <div className="mt-1 font-sans">
          <b>Amount ← “{check.columns.amount}”</b> doesn't equal taxable + tax, so it is probably a pre-tax column.
          The register would read short by the GST. Re-export with the tax-inclusive total (usually “Total Amount”).
        </div>
      )}
      {check.matches === false && !taxBad && (
        <div className="mt-1 font-sans">
          The rows read don't add up to the file's own total — the file may be missing rows, or its total may exclude
          credit notes.
        </div>
      )}
      {check.statedTotal == null && (
        <div className="mt-1 font-sans opacity-75">No grand-total row found in the file, so the amount couldn't be cross-checked.</div>
      )}
    </div>
  );
};
