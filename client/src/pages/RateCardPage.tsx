// Customer rate card — the agreed rate per customer per grade, which the
// Sales Order screen fills in automatically when a line is priced.
//
// A row may name one core type or leave it blank to cover the grade outright;
// the lookup prefers the specific row, so "All core types" acts as the
// fallback. That is why the table sorts the blanket row alongside its
// siblings rather than hiding it.
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { IndianRupee, Loader2, Pencil, Plus, Search, Trash2, X } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useConfirm } from '@/hooks/useConfirm';
import { useDebounced } from '@/hooks/useDebounced';
import { SearchableSelect } from '@/components/SearchableSelect';
import { useHideCustomerNames } from '@/store/auth';

type Rate = {
  id: string;
  customerId: string;
  customerName: string;
  customerCode: string | null;
  grade: string;
  coreType: string;
  rateBasis: 'PER_KG' | 'PER_PCS';
  rateValue: number;
  notes: string | null;
};
type ListResp = { items: Rate[] };
type CustomerResp = { items: { id: string; name: string; customerCode: string }[] };
type GradeResp = { grades: { grade: string }[] };

const CORE_TYPES = ['TOROIDAL', 'RECTANGULAR', 'NANO', 'COMPOSITE'] as const;
const coreLabel = (c: string) =>
  c ? c.charAt(0) + c.slice(1).toLowerCase() : 'All core types';
const basisLabel = (b: string) => (b === 'PER_KG' ? '/kg' : '/pc');
const money = (n: number) => '₹' + n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

type Draft = {
  id?: string;
  customerId: string;
  grade: string;
  coreType: string;
  rateBasis: 'PER_KG' | 'PER_PCS';
  rateValue: number;
  notes: string;
};
const emptyDraft = (): Draft => ({ customerId: '', grade: '', coreType: '', rateBasis: 'PER_KG', rateValue: 0, notes: '' });

export const RateCardPage = () => {
  const queryClient = useQueryClient();
  const { confirm, confirmDialog } = useConfirm();
  const hideNames = useHideCustomerNames();

  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounced(search);
  const [customerId, setCustomerId] = useState('');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);

  const qs = new URLSearchParams();
  if (debouncedSearch.trim()) qs.set('search', debouncedSearch.trim());
  if (customerId) qs.set('customerId', customerId);

  const { data, isLoading } = useQuery({
    queryKey: ['customer-rates', debouncedSearch, customerId],
    queryFn: () => api<ListResp>(`/customer-rates?${qs.toString()}`),
  });
  const { data: customers } = useQuery({
    queryKey: ['customers-options'],
    queryFn: () => api<CustomerResp>('/customers?pageSize=500'),
  });
  const { data: gradeData } = useQuery({
    queryKey: ['material-grades'],
    queryFn: () => api<GradeResp>('/material-grades'),
  });

  const customerOptions = (customers?.items ?? []).map((c) => ({
    value: c.id,
    label: hideNames ? c.customerCode : `${c.customerCode} · ${c.name}`,
  }));
  const gradeOptions = (gradeData?.grades ?? []).map((g) => ({ value: g.grade, label: g.grade }));

  const save = useMutation({
    mutationFn: (d: Draft) => {
      const body = {
        customerId: d.customerId, grade: d.grade.trim(), coreType: d.coreType,
        rateBasis: d.rateBasis, rateValue: d.rateValue, notes: d.notes.trim() || null,
      };
      // POST upserts by scope, so an edit that keeps the same customer/grade/
      // core type lands on the same row either way.
      return d.id
        ? api(`/customer-rates/${d.id}`, { method: 'PATCH', json: body })
        : api('/customer-rates', { method: 'POST', json: body });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customer-rates'] });
      // The booking screen caches lookups; drop them so a new rate shows up
      // on the very next line rather than after a stale window.
      queryClient.invalidateQueries({ queryKey: ['customer-rate'] });
      setDraft(null);
      setError(null);
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Could not save this rate.'),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api(`/customer-rates/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customer-rates'] });
      queryClient.invalidateQueries({ queryKey: ['customer-rate'] });
    },
  });

  const onDelete = async (r: Rate) => {
    const ok = await confirm({
      title: 'Remove this rate?',
      tone: 'danger',
      confirmLabel: 'Remove',
      message: (
        <>
          <strong>{r.grade}</strong> for <strong>{hideNames ? r.customerCode : r.customerName}</strong>{' '}
          ({coreLabel(r.coreType)}) will stop filling in automatically on new order lines.
        </>
      ),
    });
    if (ok) remove.mutate(r.id);
  };

  const onSubmit = () => {
    if (!draft) return;
    if (!draft.customerId) return setError('Pick a customer.');
    if (!draft.grade.trim()) return setError('Pick a grade.');
    if (!(draft.rateValue > 0)) return setError('Enter a rate above zero.');
    setError(null);
    save.mutate(draft);
  };

  // Grouped so a customer's rates read as one card rather than a flat list
  // where the same name repeats down the page.
  const groups = useMemo(() => {
    const map = new Map<string, { name: string; code: string | null; rates: Rate[] }>();
    for (const r of data?.items ?? []) {
      if (!map.has(r.customerId)) map.set(r.customerId, { name: r.customerName, code: r.customerCode, rates: [] });
      map.get(r.customerId)!.rates.push(r);
    }
    return [...map.entries()].map(([id, g]) => ({ id, ...g }));
  }, [data]);

  return (
    <div className="max-w-full space-y-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-extrabold tracking-tight text-slate-900 sm:text-2xl">
            <IndianRupee className="h-5 w-5 text-brand-600" /> Customer Rate Card
          </h1>
          <p className="mt-0.5 text-[13px] text-slate-500">
            The agreed rate per customer and grade. Sales Order lines fill this in automatically, and stay editable.
          </p>
        </div>
        <button onClick={() => { setDraft(emptyDraft()); setError(null); }} className="btn-primary justify-center">
          <Plus className="h-4 w-4" /> Add rate
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-2.5 rounded-xl border border-slate-200/70 bg-white p-3 shadow-e1 lg:flex-row lg:items-end">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            className="input h-9 pl-9 text-sm"
            placeholder="Search customer or grade"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="w-full lg:w-72">
          <SearchableSelect value={customerId} onChange={setCustomerId} options={customerOptions} placeholder="All customers" />
        </div>
        {(search || customerId) && (
          <button
            onClick={() => { setSearch(''); setCustomerId(''); }}
            className="flex h-9 items-center gap-1 text-[11px] font-bold uppercase tracking-[0.06em] text-brand-700 hover:text-brand-800"
          >
            <X className="h-3 w-3" /> Clear
          </button>
        )}
      </div>

      {/* Add / edit form */}
      {draft && (
        <div className="rounded-xl border border-brand-200 bg-gradient-to-b from-brand-50/70 to-white p-3 shadow-e1 sm:p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-[13px] font-extrabold uppercase tracking-[0.08em] text-slate-700">
              {draft.id ? 'Edit rate' : 'New rate'}
            </h2>
            <button onClick={() => { setDraft(null); setError(null); }} className="text-slate-400 hover:text-slate-600" aria-label="Close">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <Field label="Customer">
              <SearchableSelect
                value={draft.customerId}
                onChange={(v) => setDraft({ ...draft, customerId: v })}
                options={customerOptions}
                placeholder="Select customer…"
              />
            </Field>
            <Field label="Grade">
              <SearchableSelect
                value={draft.grade}
                onChange={(v) => setDraft({ ...draft, grade: v })}
                options={gradeOptions}
                placeholder="Select grade…"
              />
            </Field>
            <Field label="Core type">
              <select
                className="input h-9 text-sm"
                value={draft.coreType}
                onChange={(e) => setDraft({ ...draft, coreType: e.target.value })}
              >
                <option value="">All core types</option>
                {CORE_TYPES.map((c) => <option key={c} value={c}>{coreLabel(c)}</option>)}
              </select>
              <div className="mt-1 text-[11px] text-slate-400">
                Leave as “All” unless this grade is priced differently by shape.
              </div>
            </Field>
            <Field label="Basis">
              <select
                className="input h-9 text-sm"
                value={draft.rateBasis}
                onChange={(e) => setDraft({ ...draft, rateBasis: e.target.value as Draft['rateBasis'] })}
              >
                <option value="PER_KG">Per kg</option>
                <option value="PER_PCS">Per piece</option>
              </select>
            </Field>
            <Field label={draft.rateBasis === 'PER_KG' ? 'Rate (₹/kg)' : 'Rate (₹/pc)'}>
              <input
                className="input h-9 font-num text-sm"
                type="number" inputMode="decimal" min={0} step="0.01"
                value={draft.rateValue || ''}
                onChange={(e) => setDraft({ ...draft, rateValue: parseFloat(e.target.value || '0') })}
              />
            </Field>
          </div>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Note (optional)">
              <input
                className="input h-9 text-sm"
                placeholder="e.g. agreed Apr 2026, review quarterly"
                value={draft.notes}
                onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
              />
            </Field>
          </div>
          {error && <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
          <div className="mt-3 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button onClick={() => { setDraft(null); setError(null); }} className="btn-ghost justify-center">Cancel</button>
            <button onClick={onSubmit} disabled={save.isPending} className="btn-primary justify-center">
              {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {draft.id ? 'Save changes' : 'Add rate'}
            </button>
          </div>
        </div>
      )}

      {/* The card itself */}
      {isLoading && !data ? (
        <div className="rounded-xl border border-slate-200/70 bg-white py-12 text-center text-slate-400 shadow-e1">
          <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" /> Loading…
        </div>
      ) : !groups.length ? (
        <div className="rounded-xl border border-slate-200/70 bg-white py-12 text-center shadow-e1">
          <p className="text-sm text-slate-500">
            {search || customerId ? 'No rates match those filters.' : 'No rates recorded yet.'}
          </p>
          <p className="mt-1 text-[12.5px] text-slate-400">
            Add one here, or price a Sales Order line and keep the rate when asked.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {groups.map((g) => (
            <div key={g.id} className="overflow-hidden rounded-xl border border-slate-200/70 bg-white shadow-e1">
              <div className="flex items-center gap-2 border-b border-slate-100 bg-slate-50/70 px-3 py-2">
                <span className="font-num text-[12.5px] font-bold text-brand-700">{g.code ?? '—'}</span>
                {!hideNames && <span className="text-[13px] font-semibold text-slate-800">{g.name}</span>}
                <span className="ml-auto text-[11px] text-slate-400">
                  {g.rates.length} rate{g.rates.length === 1 ? '' : 's'}
                </span>
              </div>
              <table className="w-full text-[13px] font-semibold">
                <thead className="bg-slate-50 text-left text-[10.5px] uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-3 py-2 font-semibold">Grade</th>
                    <th className="px-3 py-2 font-semibold">Core type</th>
                    <th className="px-3 py-2 text-right font-semibold">Rate</th>
                    <th className="px-3 py-2 font-semibold">Note</th>
                    <th className="w-20 px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {g.rates.map((r) => (
                    <tr key={r.id} className="border-t border-slate-100 transition-colors hover:bg-brand-50/40">
                      <td className="px-3 py-2">{r.grade}</td>
                      <td className="px-3 py-2">
                        <span className={cn(
                          'inline-flex items-center rounded-md px-1.5 py-[3px] text-[10px] font-bold uppercase tracking-[0.06em] ring-1 ring-inset',
                          r.coreType
                            ? 'bg-[#EAF0FA] text-[#1B4E82] ring-[#C6DAF0]'
                            : 'bg-slate-50 text-slate-600 ring-slate-200',
                        )}>
                          {coreLabel(r.coreType)}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right font-num tabular-nums text-brand-700">
                        {money(Number(r.rateValue))}<span className="text-slate-400">{basisLabel(r.rateBasis)}</span>
                      </td>
                      <td className="px-3 py-2 font-normal text-slate-500">{r.notes || '—'}</td>
                      <td className="px-3 py-2">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => {
                              setError(null);
                              setDraft({
                                id: r.id, customerId: r.customerId, grade: r.grade, coreType: r.coreType,
                                rateBasis: r.rateBasis, rateValue: Number(r.rateValue), notes: r.notes ?? '',
                              });
                            }}
                            className="rounded p-1.5 text-brand-700 hover:bg-brand-50" title="Edit"
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => onDelete(r)}
                            disabled={remove.isPending}
                            className="rounded p-1.5 text-red-600 hover:bg-red-50" title="Remove"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}
      {confirmDialog}
    </div>
  );
};

const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <label className="block">
    <span className="mb-1 block text-[10px] font-bold uppercase tracking-[0.09em] text-slate-500">{label}</span>
    {children}
  </label>
);
