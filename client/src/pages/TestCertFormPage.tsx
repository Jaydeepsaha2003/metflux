// New / edit export test certificate — the workbook's "TC <size>" sheet as a form.
// One certificate per core size. Details can be filled from a proforma invoice (and a
// size picked from its items); readings are judged live as the sheet does, and the
// certificate downloads as the same one-page PDF.
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, BadgeCheck, ClipboardCheck, FileText, Loader2, Plus, Ruler, Save, Trash2, XCircle, Zap } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { usePiSettings } from '@/lib/proformaApi';
import { brandColorFor } from '@/lib/brandColor';
import { useBranding } from '@/store/branding';
import { downloadTestCertPdf } from '@/lib/testCertPdf';
import {
  MAX_SAMPLES, blankSample, blankTc, calcTc, fromRecord, fsnOf, maxSize, minSize, missing, sizeFromText, toPayload,
  type Sample, type TcForm,
} from '@/lib/testCert';

type TcRecord = { id: string; certNo: string; certDate: string; data: Partial<TcForm> };
type PiRow = { id: string; piNumber: string; buyerName: string };
type PiRecord = { piNumber: string; data: { buyerName?: string; buyerCountry?: string; poRef?: string; poDate?: string; items?: { desc: string; grade?: string; qty?: number }[] } };

const dmy = (iso?: string) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '');

const Input = ({ label, value, onChange, required, type = 'text', placeholder, hint, className }: {
  label: string; value: string; onChange: (v: string) => void; required?: boolean; type?: string; placeholder?: string; hint?: string; className?: string;
}) => {
  const empty = required && !value.trim();
  return (
    <label className={cn('block', className)}>
      <span className="mb-1 flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-slate-500">
        {label}{required && <span className={empty ? 'text-red-500' : 'text-slate-300'}>*</span>}
      </span>
      <input type={type} inputMode={type === 'number' ? 'decimal' : undefined} step={type === 'number' ? 'any' : undefined}
        className={cn('input h-9 w-full text-sm', empty && 'border-red-400 bg-red-50/40')} value={value} placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)} />
      {hint && <span className="mt-0.5 block text-[11px] leading-snug text-slate-400">{hint}</span>}
    </label>
  );
};

const Section = ({ icon: Icon, title, children, aside }: { icon: typeof Ruler; title: string; children: React.ReactNode; aside?: React.ReactNode }) => (
  <section className="card overflow-hidden">
    <div className="flex items-center gap-2 border-b border-slate-100 bg-gradient-to-r from-brand-50/70 to-white px-4 py-3">
      <span className="grid h-7 w-7 place-items-center rounded-lg bg-brand-100 text-brand-700"><Icon className="h-4 w-4" /></span>
      <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
      {aside && <div className="ml-auto">{aside}</div>}
    </div>
    <div className="p-4">{children}</div>
  </section>
);

const remarkCls = (r: string) => (r === 'Out of limit' || r === 'NOT OK' ? 'text-red-600' : r ? 'text-emerald-700' : 'text-slate-300');

export const TestCertFormPage = () => {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { id: editId } = useParams<{ id?: string }>();
  const isEdit = !!editId;
  const [search] = useSearchParams();
  const copyId = isEdit ? undefined : search.get('copy') || undefined;   // "Save & next size"
  const piParam = isEdit ? undefined : search.get('pi') || undefined;     // started from a proforma
  const { settings, company, ready } = usePiSettings();
  const [tc, setTc] = useState<TcForm>(blankTc);
  const [loaded, setLoaded] = useState(!editId && !copyId);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof TcForm>(k: K, v: TcForm[K]) => setTc((t) => ({ ...t, [k]: v }));
  const setSample = (i: number, patch: Partial<Sample>) => setTc((t) => ({ ...t, samples: t.samples.map((s, n) => (n === i ? { ...s, ...patch } : s)) }));

  const source = useQuery({ queryKey: ['test-certificate', editId ?? copyId], queryFn: () => api<TcRecord>(`/test-certificates/${editId ?? copyId}`), enabled: !!(editId ?? copyId) });
  useEffect(() => {
    if (loaded || !source.data) return;
    const rec = fromRecord(source.data);
    // A copy keeps the customer, PI and test set-up; the size, lot and readings are the next size's.
    setTc(isEdit ? rec : { ...rec, certNo: '', certDate: blankTc().certDate, od: '', id: '', ht: '', lotQty: '', voltage: '', permCurrent: '', samples: blankTc().samples });
    setLoaded(true);
  }, [source.data, loaded, isEdit]);

  const next = useQuery({ queryKey: ['test-certificate-next', tc.certDate], queryFn: () => api<{ certNo: string }>(`/test-certificates/next-number?date=${tc.certDate}`), enabled: !isEdit });
  const [autoNo, setAutoNo] = useState('');
  useEffect(() => {
    if (!next.data?.certNo || isEdit) return;
    setTc((t) => ({ ...t, certNo: t.certNo === '' || t.certNo === autoNo ? next.data!.certNo : t.certNo }));
    setAutoNo(next.data.certNo);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [next.data?.certNo]);

  // A new certificate starts from the company's test station.
  useEffect(() => { if (!isEdit && settings?.tcWorks) setTc((t) => (t.works ? t : { ...t, works: settings.tcWorks! })); }, [settings?.tcWorks, isEdit]);

  /* ----- fill from a proforma invoice ----- */
  const [piId, setPiId] = useState(piParam ?? '');
  const pis = useQuery({ queryKey: ['proforma-invoices', 'for-tc'], queryFn: () => api<{ items: PiRow[] }>('/proforma-invoices?pageSize=200') });
  const pi = useQuery({ queryKey: ['proforma-invoice', piId], queryFn: () => api<PiRecord>(`/proforma-invoices/${piId}`), enabled: !!piId });
  const [piApplied, setPiApplied] = useState('');
  useEffect(() => {
    if (!pi.data || piApplied === piId) return;
    const d = pi.data.data;
    setTc((t) => ({ ...t, customer: d.buyerName || t.customer, country: d.buyerCountry || t.country, piRef: pi.data!.piNumber,
      poRef: d.poRef ? `${d.poRef}${d.poDate ? ` dt. ${dmy(d.poDate)}` : ''}` : t.poRef }));
    setPiApplied(piId);
  }, [pi.data, piId, piApplied]);
  const pickItem = (it: { desc: string; grade?: string; qty?: number }) => {
    const size = sizeFromText(it.desc);
    setTc((t) => ({ ...t, ...(size ?? {}), grade: it.grade?.replace(/^CRGO\s+/i, '') || t.grade, lotQty: it.qty ? String(it.qty) : t.lotQty }));
  };

  const calc = useMemo(() => calcTc(tc), [tc]);
  const gaps = missing(tc);

  const save = useMutation({
    mutationFn: () => api<{ id: string }>(isEdit ? `/test-certificates/${editId}` : '/test-certificates', { method: isEdit ? 'PUT' : 'POST', json: toPayload(tc) }),
    onSuccess: () => { ['test-certificates', 'test-certificate-next'].forEach((k) => qc.invalidateQueries({ queryKey: [k] })); setError(''); },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Could not save the certificate'),
  });
  const onSave = async (thenNext: boolean) => {
    if (gaps.length) { setError(`Fill in: ${gaps.join(', ')}`); return; }
    const res = await save.mutateAsync().catch(() => null);
    if (!res) return;
    if (thenNext) { setLoaded(false); navigate(`/test-certificates/new?copy=${res.id}`, { replace: false }); }
    else navigate('/test-certificates');
  };
  const onPdf = async () => {
    if (!settings) return;
    setBusy(true);
    try {
      await downloadTestCertPdf([tc], settings, { name: company?.name ?? 'Company', logoUrl: company?.logoUrl }, brandColorFor(company?.name) ?? useBranding.getState().brandColor);
    } finally { setBusy(false); }
  };

  if (!ready || !loaded) return <div className="card p-10 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-slate-400" /></div>;
  const companyName = company?.name ?? '';
  const verdictCls = calc.verdict === 'ACCEPTED' ? 'from-emerald-600 to-emerald-700' : calc.verdict === 'REJECTED' ? 'from-red-600 to-red-700' : 'from-slate-400 to-slate-500';

  return (
    <div className="w-full space-y-4 pb-6">
      <div className="flex flex-wrap items-center gap-3">
        <Link to="/test-certificates" className="btn-ghost border border-slate-200" aria-label="Back to test certificates"><ArrowLeft className="h-4 w-4" /></Link>
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">
            <ClipboardCheck className="h-5 w-5 text-brand-600" /> {isEdit ? 'Edit Test Certificate' : 'New Test Certificate'}
          </h1>
          <div className="font-mono text-xs text-slate-500">{tc.certNo || '—'}{tc.od && ` · ${tc.od} × ${tc.id} × ${tc.ht} mm`}</div>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-4">
          <Section icon={FileText} title="Certificate details" aside={
            <select aria-label="Fill from a proforma invoice" className="input h-8 w-56 py-0 text-xs" value={piId} onChange={(e) => setPiId(e.target.value)}>
              <option value="">Fill from proforma invoice…</option>
              {(pis.data?.items ?? []).map((p) => <option key={p.id} value={p.id}>{p.piNumber} · {p.buyerName}</option>)}
            </select>
          }>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <Input label="Certificate No." value={tc.certNo} onChange={(v) => set('certNo', v)} hint="Running series per financial year. Filled in for you." />
              <Input label="Certificate date" type="date" value={tc.certDate} onChange={(v) => set('certDate', v)} />
              <Input label="Customer" required value={tc.customer} onChange={(v) => set('customer', v)} />
              <Input label="Country" value={tc.country} onChange={(v) => set('country', v)} />
              <Input label="Customer PO No. / Date" value={tc.poRef} onChange={(v) => set('poRef', v)} placeholder="PO-26-0903 dt. 13/11/2026" />
              <Input label="Our PI / Invoice No." value={tc.piRef} onChange={(v) => set('piRef', v)} />
              <Input label="Lot qty supplied (pcs)" type="number" value={tc.lotQty} onChange={(v) => set('lotQty', v)} />
              <Input label="Test station / works" value={tc.works} onChange={(v) => set('works', v)} />
              <Input label="Core (title)" value={tc.coreName} onChange={(v) => set('coreName', v)} hint="Prints as TEST CERTIFICATE – TOROIDAL CORE." />
            </div>
            {pi.data?.data.items?.length ? (
              <div className="mt-3 rounded-lg border border-brand-100 bg-brand-50/40 p-3">
                <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-brand-800">Pick the size from {pi.data.piNumber}</div>
                <div className="flex flex-wrap gap-2">
                  {pi.data.data.items.filter((it) => it.desc?.trim()).map((it, i) => (
                    <button key={i} type="button" onClick={() => pickItem(it)}
                      className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-left text-xs text-slate-700 shadow-sm transition-colors hover:border-brand-400 hover:bg-brand-50">
                      <span className="font-medium">{it.desc}</span>{it.qty ? <span className="text-slate-400"> · {it.qty} pcs</span> : null}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </Section>

          <Section icon={Ruler} title="Specification">
            <div className="grid gap-3 sm:grid-cols-3">
              <Input label="Nominal OD (mm)" required type="number" value={tc.od} onChange={(v) => set('od', v)} />
              <Input label="Nominal ID (mm)" required type="number" value={tc.id} onChange={(v) => set('id', v)} />
              <Input label="Nominal HT (mm)" required type="number" value={tc.ht} onChange={(v) => set('ht', v)} />
              <Input label="OD tolerance ±" type="number" value={tc.odTol} onChange={(v) => set('odTol', v)} />
              <Input label="ID tolerance ±" type="number" value={tc.idTol} onChange={(v) => set('idTol', v)} />
              <Input label="HT tolerance ±" type="number" value={tc.htTol} onChange={(v) => set('htTol', v)} />
              <Input label="Grade / material" required value={tc.grade} onChange={(v) => set('grade', v)} placeholder="M4" />
              <Input label="Product code (FSN)" value={tc.productCode} onChange={(v) => set('productCode', v)} hint="TC = toroidal core." />
              <Input label="Test type" value={tc.testType} onChange={(v) => set('testType', v)} />
              <Input label="Frequency (Hz)" type="number" value={tc.frequency} onChange={(v) => set('frequency', v)} />
              <Input label="Applied voltage (mV)" type="number" value={tc.voltage} onChange={(v) => set('voltage', v)} />
              <Input label="No. of turns" type="number" value={tc.turns} onChange={(v) => set('turns', v)} />
              <Input label="Permissible current (mA)" required type="number" value={tc.permCurrent} onChange={(v) => set('permCurrent', v)} />
            </div>
            {tc.od && tc.id && tc.ht && (
              <div className="mt-3 grid gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600 sm:grid-cols-3">
                <div><span className="text-slate-400">Max </span><span className="font-semibold">{maxSize(tc)}</span></div>
                <div><span className="text-slate-400">Min </span><span className="font-semibold">{minSize(tc)}</span></div>
                <div><span className="text-slate-400">FSN </span><span className="font-mono font-semibold text-brand-700">{fsnOf(tc, companyName)}</span></div>
              </div>
            )}
          </Section>

          <Section icon={Zap} title="Test results" aside={<span className="text-xs text-slate-500">{tc.samples.length} / {MAX_SAMPLES} samples</span>}>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead>
                  <tr className="text-[10px] uppercase tracking-wide text-slate-500">
                    <th className="w-10 px-1 py-1.5 text-center">Sr.</th>
                    <th className="px-1 py-1.5">OD (mm)</th><th className="px-1 py-1.5">ID (mm)</th><th className="px-1 py-1.5">HT (mm)</th>
                    <th className="px-1 py-1.5">Dimensions</th>
                    <th className="px-1 py-1.5">Current (mA)</th><th className="px-1 py-1.5">Current</th>
                    <th className="px-1 py-1.5 text-center">Result</th><th className="w-8" />
                  </tr>
                </thead>
                <tbody>
                  {tc.samples.map((s, i) => {
                    const r = calc.rows[i];
                    const cell = (k: keyof Sample) => (
                      <td className="px-1 py-1"><input type="number" step="any" inputMode="decimal" aria-label={`Sample ${i + 1} ${k}`} className="input h-8 w-full py-0 text-right text-sm tabular-nums" value={s[k]} onChange={(e) => setSample(i, { [k]: e.target.value })} /></td>
                    );
                    return (
                      <tr key={i} className={cn('border-t border-slate-100', r.overall === 'NOT OK' && 'bg-red-50/50')}>
                        <td className="px-1 py-1 text-center text-xs text-slate-400">{i + 1}</td>
                        {cell('od')}{cell('id')}{cell('ht')}
                        <td className={cn('whitespace-nowrap px-1 py-1 text-xs font-medium', remarkCls(r.dimRemark))}>{r.dimRemark || '—'}</td>
                        {cell('current')}
                        <td className={cn('whitespace-nowrap px-1 py-1 text-xs font-medium', remarkCls(r.curRemark))}>{r.curRemark || '—'}</td>
                        <td className={cn('whitespace-nowrap px-1 py-1 text-center text-xs font-bold', remarkCls(r.overall))}>{r.overall || '—'}</td>
                        <td className="px-1 py-1">
                          <button type="button" onClick={() => setTc((t) => ({ ...t, samples: t.samples.length > 1 ? t.samples.filter((_, n) => n !== i) : [blankSample()] }))}
                            className="rounded p-1 text-slate-300 hover:bg-red-50 hover:text-red-600" aria-label={`Remove sample ${i + 1}`}><Trash2 className="h-3.5 w-3.5" /></button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot className="border-t-2 border-slate-200 text-xs font-semibold text-slate-600">
                  {(['min', 'max', 'avg'] as const).map((k) => (
                    <tr key={k}>
                      <td className="px-1 py-1 text-center text-[10px] uppercase text-slate-400">{k === 'avg' ? 'Avg' : k}</td>
                      {(['od', 'id', 'ht'] as const).map((d) => <td key={d} className="px-2 py-1 text-right tabular-nums">{calc[d]?.[k]?.toFixed(2) ?? ''}</td>)}
                      <td />
                      <td className="px-2 py-1 text-right tabular-nums">{calc.current ? Math.round(calc.current[k]) : ''}</td>
                      <td colSpan={3} />
                    </tr>
                  ))}
                </tfoot>
              </table>
            </div>
            <button type="button" disabled={tc.samples.length >= MAX_SAMPLES} onClick={() => setTc((t) => ({ ...t, samples: [...t.samples, blankSample()] }))}
              className="btn-ghost mt-2 border border-dashed border-slate-300 text-sm text-brand-700 disabled:opacity-40"><Plus className="h-4 w-4" /> Add sample</button>
          </Section>

          <Section icon={BadgeCheck} title="Signatures">
            <div className="grid gap-3 sm:grid-cols-2">
              <Input label="Tested by" value={tc.testedBy} onChange={(v) => set('testedBy', v)} placeholder={settings?.tcTestedBy || 'Name & Signature'} />
              <Input label="Approved by (QA)" value={tc.approvedBy} onChange={(v) => set('approvedBy', v)} placeholder={settings?.tcApprovedBy || 'Name & Signature'} />
            </div>
            <p className="mt-2 text-[11px] text-slate-400">Test method, certification statement and format no. come from Settings → Proforma / Export.</p>
          </Section>
        </div>

        <aside className="space-y-3 xl:sticky xl:top-4 xl:self-start">
          <div className={cn('rounded-xl bg-gradient-to-br p-4 text-white shadow-lg', verdictCls)}>
            <div className="text-[11px] font-semibold uppercase tracking-wider opacity-80">Lot result</div>
            <div className="mt-1 flex items-center gap-2 text-2xl font-bold">
              {calc.verdict === 'REJECTED' ? <XCircle className="h-6 w-6" /> : <BadgeCheck className="h-6 w-6" />}{calc.verdict || 'No readings yet'}
            </div>
            <div className="mt-2 text-sm opacity-90">{calc.within} of {calc.tested} samples within limit</div>
          </div>
          {gaps.length > 0 && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
              <div className="mb-1 font-semibold">Still needed</div>
              <ul className="list-inside list-disc">{gaps.map((g) => <li key={g}>{g}</li>)}</ul>
            </div>
          )}
          {error && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
          <div className="card space-y-2 p-3">
            <button type="button" onClick={() => onSave(false)} disabled={save.isPending} className="btn-primary w-full justify-center">
              {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} {isEdit ? 'Save changes' : 'Save certificate'}
            </button>
            {!isEdit && (
              <button type="button" onClick={() => onSave(true)} disabled={save.isPending} className="btn-ghost w-full justify-center border border-slate-300" title="Save, then start the next size with the same customer and PI">
                <Plus className="h-4 w-4" /> Save &amp; next size
              </button>
            )}
            <button type="button" onClick={onPdf} disabled={busy || gaps.length > 0} className="btn-ghost w-full justify-center border border-slate-300 text-rose-700 hover:bg-rose-50 disabled:opacity-50">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />} Download PDF
            </button>
          </div>
        </aside>
      </div>
    </div>
  );
};
