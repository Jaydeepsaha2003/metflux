// Lightweight localStorage-backed draft autosave so in-progress work on the
// "build" pages (Packing List, Work Allotment) survives page refreshes,
// accidental navigation, and tab closes. One draft slot per `key`. Drafts older
// than MAX_AGE_MS are ignored and cleaned up so an ancient draft never
// resurfaces unexpectedly. No backend involved — purely client-side recovery.
import { useCallback, useEffect, useRef, useState } from 'react';

const PREFIX = 'metflux:draft:';
const MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000; // 3 days
const DEBOUNCE_MS = 600;

type Envelope<T> = { v: 1; savedAt: number; data: T };

/**
 * Synchronously read a draft (call once on mount). Returns null if the draft is
 * absent, stale, malformed, or storage is unavailable (private mode). A stale
 * draft is removed as a side effect.
 */
export function readDraft<T>(key: string): { data: T; savedAt: number } | null {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (!raw) return null;
    const env = JSON.parse(raw) as Envelope<T>;
    if (!env || env.v !== 1 || typeof env.savedAt !== 'number') return null;
    if (Date.now() - env.savedAt > MAX_AGE_MS) {
      localStorage.removeItem(PREFIX + key);
      return null;
    }
    return { data: env.data, savedAt: env.savedAt };
  } catch {
    return null;
  }
}

/**
 * Debounced autosave of `data` to localStorage under `key`. Pass enabled=false
 * (e.g. in read-only / view mode, or before the form is populated) to pause
 * saving. Returns the last-saved timestamp (for a "Draft saved" indicator) and a
 * clear() to drop the draft once the work has been committed to the server.
 */
export function useFormDraft<T>(
  key: string | null,
  data: T,
  enabled: boolean,
): { savedAt: number | null; clear: () => void } {
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const timer = useRef<number | null>(null);
  const serialized = JSON.stringify(data);

  useEffect(() => {
    if (!enabled || !key) return;
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      try {
        const env: Envelope<T> = { v: 1, savedAt: Date.now(), data };
        localStorage.setItem(PREFIX + key, JSON.stringify(env));
        setSavedAt(env.savedAt);
      } catch {
        /* private mode / quota exceeded — silently skip, nothing we can do */
      }
    }, DEBOUNCE_MS);
    return () => { if (timer.current) window.clearTimeout(timer.current); };
    // serialized stands in for a deep compare of `data`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled, serialized]);

  const clear = useCallback(() => {
    if (!key) return;
    try { localStorage.removeItem(PREFIX + key); } catch { /* ignore */ }
    setSavedAt(null);
  }, [key]);

  return { savedAt, clear };
}

/** Short local date-time for the "draft recovered from …" banner. */
export function fmtDraftTime(ts: number): string {
  try {
    return new Date(ts).toLocaleString('en-GB', {
      day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return '';
  }
}
