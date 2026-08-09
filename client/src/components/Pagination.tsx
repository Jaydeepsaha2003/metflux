// Compact, reusable pagination control. Drop in below any list table.
//   <Pagination page={page} pageSize={pageSize} total={total} onPageChange={setPage}
//               onPageSizeChange={setPageSize} />
// Shows a "Rows per page" selector when onPageSizeChange is supplied. Hides
// itself only when there's nothing to show at all (total === 0) — the count +
// rows-per-page selector stay visible even on a single page, so the choice is
// always available; the Prev/page-number/Next cluster only appears once
// there's more than one page.
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/cn';

type Props = {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (next: number) => void;
  onPageSizeChange?: (next: number) => void;
  pageSizeOptions?: number[];
};

const DEFAULT_PAGE_SIZE_OPTIONS = [10, 20, 50, 100];

export const Pagination = ({
  page, pageSize, total, onPageChange, onPageSizeChange, pageSizeOptions = DEFAULT_PAGE_SIZE_OPTIONS,
}: Props) => {
  if (total === 0) return null;
  const lastPage = Math.max(1, Math.ceil(total / pageSize));

  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  // Build a short page-number window — first, last, and ±1 around current.
  const nums: (number | '…')[] = [];
  const push = (n: number | '…') => { if (nums[nums.length - 1] !== n) nums.push(n); };
  push(1);
  for (let n = page - 1; n <= page + 1; n++) {
    if (n > 1 && n < lastPage) {
      if (n - (typeof nums[nums.length - 1] === 'number' ? (nums[nums.length - 1] as number) : 0) > 1) push('…');
      push(n);
    }
  }
  if (lastPage > 1) {
    if (lastPage - (typeof nums[nums.length - 1] === 'number' ? (nums[nums.length - 1] as number) : 0) > 1) push('…');
    push(lastPage);
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-slate-50/50 px-3 py-2 text-xs text-slate-600">
      <div className="flex flex-wrap items-center gap-3">
        <span className="tabular-nums">
          {from}–{to} of <strong className="text-slate-800">{total}</strong>
        </span>
        {onPageSizeChange && (
          <label className="flex items-center gap-1.5">
            <span className="text-slate-500">Rows per page</span>
            <select
              className="rounded-md border border-slate-300 bg-white px-1.5 py-1 text-xs text-slate-700 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-200"
              value={pageSize}
              onChange={(e) => onPageSizeChange(Number(e.target.value))}
            >
              {pageSizeOptions.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
        )}
      </div>
      {lastPage > 1 && (
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onPageChange(Math.max(1, page - 1))}
            disabled={page === 1}
            className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2 py-1 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ChevronLeft className="h-3.5 w-3.5" /> Prev
          </button>
          {nums.map((n, i) =>
            n === '…' ? (
              <span key={`e-${i}`} className="px-1 text-slate-400">…</span>
            ) : (
              <button
                key={n}
                type="button"
                onClick={() => onPageChange(n)}
                className={cn(
                  'rounded-md border px-2.5 py-1 tabular-nums',
                  n === page
                    ? 'border-brand-600 bg-brand-600 text-white'
                    : 'border-slate-300 bg-white hover:bg-slate-50'
                )}
              >
                {n}
              </button>
            )
          )}
          <button
            type="button"
            onClick={() => onPageChange(Math.min(lastPage, page + 1))}
            disabled={page === lastPage}
            className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2 py-1 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Next <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </div>
  );
};
