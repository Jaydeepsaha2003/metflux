// Typeahead input for SupplierOrderItem description.
// • User types freely → value updates as usual (onChange).
// • Below the input, a panel lists historical (description, hsnCode, unit)
//   tuples that match what's typed. Clicking one fires onPick with the full
//   tuple so the caller can also pre-fill HSN + unit.
// • Behaves like a normal text input when no suggestions match — the value
//   the user typed is always the final answer.
import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search, Sparkles } from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';

export type ItemSuggestion = {
  description: string;
  hsnCode: string | null;
  unit: string;
  uses: number;
};

type Props = {
  value: string;
  onChange: (v: string) => void;
  onPick: (s: ItemSuggestion) => void;
  placeholder?: string;
  className?: string;
  inputClassName?: string;
};

export const ItemTypeahead = ({
  value, onChange, onPick, placeholder, className, inputClassName,
}: Props) => {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close panel on outside click.
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Fetch the full history once and filter client-side — at this scale there
  // are at most a few hundred distinct lines and it makes typing snappy.
  const { data } = useQuery({
    queryKey: ['supplier-order-item-suggestions'],
    queryFn: () => api<{ items: ItemSuggestion[] }>('/supplier-orders/item-suggestions'),
    staleTime: 5 * 60_000,
  });

  const all = data?.items ?? [];
  const query = value.trim().toUpperCase();
  const filtered = query
    ? all.filter((it) =>
        it.description.toUpperCase().includes(query)
        || (it.hsnCode ?? '').toUpperCase().includes(query)
      )
    : all;

  return (
    <div ref={containerRef} className={cn('relative', className)}>
      <input
        className={inputClassName}
        value={value}
        onChange={(e) => { onChange(e.target.value.toUpperCase()); setOpen(true); }}
        onFocus={() => setOpen(true)}
        placeholder={placeholder}
        autoComplete="off"
      />
      {open && filtered.length > 0 && (
        <div className="absolute left-0 right-0 top-full z-30 mt-1 max-h-72 overflow-auto rounded-md border border-slate-200 bg-white shadow-lg">
          <div className="sticky top-0 flex items-center gap-1.5 border-b border-slate-100 bg-slate-50 px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
            <Sparkles className="h-3 w-3" />
            Previously used items
            <span className="ml-auto font-normal normal-case tracking-normal text-slate-400">
              {filtered.length}
            </span>
          </div>
          {!query && (
            <div className="px-2.5 pt-1.5 text-[10px] text-slate-400 flex items-center gap-1">
              <Search className="h-3 w-3" /> Type to filter — or pick one to fill description, HSN &amp; unit
            </div>
          )}
          <ul className="py-1">
            {filtered.slice(0, 100).map((s, i) => (
              <li key={`${s.description}::${s.hsnCode ?? ''}::${s.unit}::${i}`}>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}      // keep focus on input
                  onClick={() => { onPick(s); setOpen(false); }}
                  className="flex w-full items-start gap-2 px-2.5 py-1.5 text-left hover:bg-brand-50"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-slate-900">
                      {s.description}
                    </div>
                    <div className="mt-0.5 flex items-center gap-2 text-[11px] text-slate-500">
                      {s.hsnCode && (
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono tabular-nums">
                          HSN {s.hsnCode}
                        </span>
                      )}
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 font-medium">{s.unit}</span>
                      <span className="ml-auto text-[10px] tabular-nums text-slate-400">
                        ×{s.uses}
                      </span>
                    </div>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};
