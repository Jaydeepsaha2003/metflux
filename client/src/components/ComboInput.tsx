// A text box with a real drop-down list of suggestions that still accepts free text
// ("pick or type your own"). Replaces <datalist>, which hides every option that
// doesn't match the box's current text — so a pre-filled field showed nothing.
// The list is portalled with fixed positioning so a scrolling table can't clip it.
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/cn';

type Props = {
  value: string;
  onChange: (value: string) => void;
  options: readonly string[];
  className?: string;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'className'>;

export const ComboInput = ({ value, onChange, options, className, ...rest }: Props) => {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState(false);       // filter only once the user starts typing
  const [hi, setHi] = useState(0);
  const [box, setBox] = useState<{ left: number; top: number; width: number; up: boolean } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const listId = useId();

  const q = value.trim().toLowerCase();
  const shown = typed && q ? options.filter((o) => o.toLowerCase().includes(q)) : options;

  const place = () => {
    const r = inputRef.current?.getBoundingClientRect();
    if (!r) return;
    const up = window.innerHeight - r.bottom < 240 && r.top > window.innerHeight - r.bottom;
    setBox({ left: r.left, top: up ? r.top - 4 : r.bottom + 4, width: Math.max(r.width, 180), up });
  };

  const show = () => {
    if (open) return;
    place();
    setTyped(false);
    setHi(Math.max(0, options.indexOf(value)));
    setOpen(true);
  };

  useLayoutEffect(() => { if (open) place(); }, [open, value]);

  // Close when the page (not the list itself) scrolls or resizes — the box would drift.
  useEffect(() => {
    if (!open) return;
    const onScroll = (e: Event) => { if (!listRef.current?.contains(e.target as Node)) setOpen(false); };
    const onResize = () => setOpen(false);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    return () => { window.removeEventListener('scroll', onScroll, true); window.removeEventListener('resize', onResize); };
  }, [open]);

  useEffect(() => {
    if (open) listRef.current?.querySelector<HTMLElement>(`[data-i="${hi}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [hi, open]);

  const pick = (o: string) => { onChange(o); setOpen(false); };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) { show(); return; }
      const n = shown.length;
      if (n) setHi((h) => (e.key === 'ArrowDown' ? (h + 1) % n : (h - 1 + n) % n));
    } else if (e.key === 'Enter' && open && shown[hi] !== undefined) {
      e.preventDefault();
      pick(shown[hi]);
    } else if (e.key === 'Escape' && open) {
      e.preventDefault();
      setOpen(false);
    }
  };

  return (
    <div className="relative">
      <input
        {...rest}
        ref={inputRef}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        autoComplete="off"
        className={cn(className, 'pr-8')}
        value={value}
        onChange={(e) => { onChange(e.target.value); setTyped(true); setHi(0); if (!open) { place(); setOpen(true); } }}
        onClick={show}
        onFocus={show}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
      />
      <button
        type="button"
        tabIndex={-1}
        aria-label="Show options"
        // mousedown, not click: keep focus in the input so blur doesn't close the list first
        onMouseDown={(e) => { e.preventDefault(); if (open) setOpen(false); else { inputRef.current?.focus(); show(); } }}
        className="absolute inset-y-0 right-0 flex w-8 items-center justify-center text-slate-400 hover:text-slate-700"
      >
        <ChevronDown className={cn('h-4 w-4 transition-transform', open && 'rotate-180')} />
      </button>
      {open && box && createPortal(
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          style={{ position: 'fixed', left: box.left, width: box.width, ...(box.up ? { bottom: window.innerHeight - box.top } : { top: box.top }) }}
          className="z-[1000] max-h-60 overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 text-sm shadow-xl"
          onMouseDown={(e) => e.preventDefault()}
        >
          {shown.length === 0 ? (
            <li className="px-3 py-2 text-xs text-slate-400">No match — your text will be used as typed.</li>
          ) : shown.map((o, i) => (
            <li
              key={o}
              data-i={i}
              role="option"
              aria-selected={o === value}
              onMouseEnter={() => setHi(i)}
              onClick={() => pick(o)}
              className={cn('cursor-pointer px-3 py-1.5', i === hi && 'bg-brand-50 text-brand-900', o === value && 'font-semibold')}
            >
              {o}
            </li>
          ))}
        </ul>,
        document.body,
      )}
    </div>
  );
};
