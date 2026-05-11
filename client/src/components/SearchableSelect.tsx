import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Search, X } from 'lucide-react';
import { cn } from '@/lib/cn';

export type SelectOption = { value: string; label: string };

type Props = {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  /** Match the dense inputCls used on PO pages */
  dense?: boolean;
};

export const SearchableSelect = ({
  value, onChange, options, placeholder = 'Select…', disabled, className, dense,
}: Props) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [highlighted, setHighlighted] = useState(0);

  const filtered = query.trim()
    ? options.filter((o) => o.label.toLowerCase().includes(query.toLowerCase()))
    : options;

  const selectedLabel = options.find((o) => o.value === value)?.label;

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Focus search input when opened
  useEffect(() => {
    if (open) {
      setQuery('');
      setHighlighted(0);
      setTimeout(() => searchRef.current?.focus(), 30);
    }
  }, [open]);

  const select = (opt: SelectOption) => {
    onChange(opt.value);
    setOpen(false);
  };

  const clear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange('');
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { setOpen(false); return; }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlighted((h) => Math.min(h + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlighted((h) => Math.max(h - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filtered[highlighted]) select(filtered[highlighted]);
    }
  };

  // Dense mirrors POOrderNewPage's `inputCls` exactly so dropdowns line up
  // pixel-for-pixel with native <input>/<select> in the same row (h-8 / px-2).
  const triggerCls = dense
    ? 'h-8 w-full rounded-md border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400'
    : 'input';

  return (
    <div ref={containerRef} className={cn('relative', className)}>
      {/* Trigger */}
      <button
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setOpen((v) => !v)}
        onKeyDown={open ? onKeyDown : undefined}
        className={cn(
          triggerCls,
          'flex items-center justify-between gap-2 text-left cursor-pointer',
          !selectedLabel && 'text-slate-400',
          open && 'border-brand-500 ring-2 ring-brand-500/20'
        )}
      >
        <span className="truncate flex-1">{selectedLabel ?? placeholder}</span>
        <span className="flex items-center gap-0.5 shrink-0">
          {selectedLabel && (
            <span
              role="button"
              tabIndex={0}
              onClick={clear}
              onKeyDown={(e) => e.key === 'Enter' && clear(e as unknown as React.MouseEvent)}
              className="rounded p-0.5 text-slate-400 hover:text-slate-600"
            >
              <X className="h-3.5 w-3.5" />
            </span>
          )}
          <ChevronDown className={cn('h-4 w-4 text-slate-400 transition-transform', open && 'rotate-180')} />
        </span>
      </button>

      {/* Dropdown panel — z-[100] so it always sits above sibling cards/tables.
          min-w prevents narrow grid columns (e.g. the 6-col Flux field) from
          squashing the panel into a cramped strip. Search is hidden for short
          option lists where it would just add visual noise. */}
      {open && (
        <div className="absolute left-0 top-full z-[100] mt-1.5 min-w-full w-56 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
          {/* Search — only shown when there are enough options to need it */}
          {options.length > 6 && (
            <div className="border-b border-slate-100 px-3 py-2">
              <div className="flex items-center gap-2 rounded-lg bg-slate-50 px-2.5 py-1.5">
                <Search className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                <input
                  ref={searchRef}
                  value={query}
                  onChange={(e) => { setQuery(e.target.value); setHighlighted(0); }}
                  onKeyDown={onKeyDown}
                  className="flex-1 bg-transparent text-sm outline-none placeholder:text-slate-400"
                  placeholder="Search…"
                />
              </div>
            </div>
          )}

          {/* Options list */}
          <ul ref={listRef} className="max-h-52 overflow-y-auto p-1.5">
            {filtered.length === 0 && (
              <li className="px-3 py-6 text-center text-sm text-slate-400">No results</li>
            )}
            {filtered.map((opt, i) => (
              <li key={opt.value}>
                <button
                  type="button"
                  onClick={() => select(opt)}
                  onMouseEnter={() => setHighlighted(i)}
                  className={cn(
                    'flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition',
                    i === highlighted && 'bg-brand-50 text-brand-700',
                    opt.value === value && 'font-medium'
                  )}
                >
                  <span className="flex-1 text-left">{opt.label}</span>
                  {opt.value === value && <Check className="h-3.5 w-3.5 shrink-0 text-brand-600" />}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};
