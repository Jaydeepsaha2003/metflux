import { useEffect, useState } from 'react';

/**
 * Delays a fast-changing value so it can be used in a react-query key without
 * firing a request on every keystroke.
 *
 * Typing into a search box updates state on each character, and when that value
 * is part of a query key every character starts a new request and puts the list
 * back into its loading state — so the table flickers through "Loading…" while
 * you type, and by the time you finish there is a queue of stale requests
 * behind you. Keep binding the input to the raw state so it stays responsive,
 * and pass the debounced value to the query.
 *
 *   const [search, setSearch] = useState('');
 *   const debouncedSearch = useDebounced(search);
 *   useQuery({ queryKey: ['thing', debouncedSearch], ... });
 */
export const useDebounced = <T,>(value: T, delay = 300): T => {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setSettled(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return settled;
};
