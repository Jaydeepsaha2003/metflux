// Export test certificate — the workbook's "TC <size>" sheet: one certificate per
// core size, nominal size ± tolerance and a permissible excitation current, up to
// ten measured samples, each judged "Within limit" / "Out of limit", and the lot
// ACCEPTED only when every sample tested is OK. Same formulas as the sheet.

export const MAX_SAMPLES = 10;

export type Sample = { od: string; id: string; ht: string; current: string };

export type TcForm = {
  certNo: string; certDate: string;
  customer: string; country: string; poRef: string; piRef: string; lotQty: string; works: string;
  coreName: string; productCode: string; grade: string;
  od: string; id: string; ht: string; odTol: string; idTol: string; htTol: string;
  frequency: string; voltage: string; turns: string; permCurrent: string; testType: string;
  testedBy: string; approvedBy: string;
  samples: Sample[];
};

const todayISO = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
};
export const blankSample = (): Sample => ({ od: '', id: '', ht: '', current: '' });
export const blankTc = (): TcForm => ({
  certNo: '', certDate: todayISO(),
  customer: '', country: '', poRef: '', piRef: '', lotQty: '', works: '',
  coreName: 'TOROIDAL CORE', productCode: 'TC', grade: '',
  od: '', id: '', ht: '', odTol: '1', idTol: '0.5', htTol: '0.5',
  frequency: '50', voltage: '', turns: '', permCurrent: '', testType: 'Dimensional & Electrical',
  testedBy: '', approvedBy: '',
  samples: Array.from({ length: 5 }, blankSample),
});

const n = (v: string) => (v.trim() === '' ? null : Number(v));
const ok = (v: number | null): v is number => v !== null && Number.isFinite(v);
const num = (v: string) => { const x = n(v); return ok(x) ? x : 0; };

export type SampleResult = { sr: number | ''; dimRemark: '' | 'Within limit' | 'Out of limit'; curRemark: '' | 'Within limit' | 'Out of limit'; overall: '' | 'OK' | 'NOT OK' };

/** One sample row, exactly as the sheet's E / G / H columns judge it. */
export const judgeSample = (t: TcForm, s: Sample, index: number): SampleResult => {
  const od = n(s.od), id = n(s.id), ht = n(s.ht), cur = n(s.current);
  const dims = [od, id, ht].filter(ok).length;
  const any = dims > 0 || ok(cur);
  const dimRemark = dims < 3 ? '' : (Math.abs(od! - num(t.od)) <= num(t.odTol) && Math.abs(id! - num(t.id)) <= num(t.idTol) && Math.abs(ht! - num(t.ht)) <= num(t.htTol)) ? 'Within limit' : 'Out of limit';
  const curRemark = !ok(cur) ? '' : cur <= num(t.permCurrent) ? 'Within limit' : 'Out of limit';
  const overall = !dimRemark || !curRemark ? '' : dimRemark === 'Within limit' && curRemark === 'Within limit' ? 'OK' : 'NOT OK';
  return { sr: any ? index + 1 : '', dimRemark, curRemark, overall };
};

const stats = (vals: number[]) => vals.length
  ? { min: Math.min(...vals), max: Math.max(...vals), avg: vals.reduce((a, b) => a + b, 0) / vals.length }
  : null;

export const calcTc = (t: TcForm) => {
  const rows = t.samples.map((s, i) => judgeSample(t, s, i));
  const col = (k: keyof Sample) => t.samples.map((s) => n(s[k])).filter(ok);
  const tested = rows.filter((r) => r.overall).length;
  const within = rows.filter((r) => r.overall === 'OK').length;
  return {
    rows,
    od: stats(col('od')), id: stats(col('id')), ht: stats(col('ht')), current: stats(col('current')),
    tested, within,
    verdict: (tested === 0 ? '' : within === tested ? 'ACCEPTED' : 'REJECTED') as '' | 'ACCEPTED' | 'REJECTED',
  };
};

/** Same initials rule the server numbers documents with: METFLUX ELECTRICAL INDUSTRIES → MEI. */
export const companyPrefix = (name: string) => {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return words.length >= 2 ? words.map((w) => w[0]).join('').slice(0, 4).toUpperCase() : (name || 'CO').slice(0, 3).toUpperCase();
};
const pad3 = (v: string) => { const x = num(v); return Number.isInteger(x) ? String(x).padStart(3, '0') : String(x); };
/** FSN (material code): MEI-TC-M4-195-100-060, as the sheet builds it. */
export const fsnOf = (t: TcForm, company: string) =>
  t.od && t.id && t.ht ? `${companyPrefix(company)}-${t.productCode.trim()}-${t.grade.toUpperCase().replace(/\s+/g, '')}-${pad3(t.od)}-${pad3(t.id)}-${pad3(t.ht)}` : '';

export const sizeLabel = (t: TcForm) => (t.od && t.id && t.ht ? `${t.od} × ${t.id} × ${t.ht}` : '');
const plus = (a: string, b: string, sign: 1 | -1) => +(num(a) + sign * num(b)).toFixed(3);
export const maxSize = (t: TcForm) => `${plus(t.od, t.odTol, 1)} × ${plus(t.id, t.idTol, 1)} × ${plus(t.ht, t.htTol, 1)} mm`;
export const minSize = (t: TcForm) => `${plus(t.od, t.odTol, -1)} × ${plus(t.id, t.idTol, -1)} × ${plus(t.ht, t.htTol, -1)} mm`;
export const tolText = (t: TcForm) => `OD ±${t.odTol}   |   ID ±${t.idTol}   |   HT ±${t.htTol}`;

/** Required before a certificate can be saved — what makes it a certificate at all. */
export const REQUIRED: [keyof TcForm, string][] = [
  ['customer', 'Customer'], ['od', 'Nominal OD'], ['id', 'Nominal ID'], ['ht', 'Nominal HT'], ['grade', 'Grade / Material'], ['permCurrent', 'Permissible current'],
];
export const missing = (t: TcForm) => REQUIRED.filter(([k]) => !String(t[k] ?? '').trim()).map(([, l]) => l);

/** Empty sample rows are not saved; the form pads back to five. */
export const toPayload = (t: TcForm) => {
  const { certNo, certDate, ...data } = t;
  return {
    certNo: certNo.trim() || undefined, certDate,
    data: { ...data, samples: data.samples.filter((s) => s.od || s.id || s.ht || s.current) },
  };
};
export const fromRecord = (r: { certNo: string; certDate: string; data: Partial<TcForm> }): TcForm => {
  const base = blankTc();
  const samples = [...(r.data.samples ?? [])];
  while (samples.length < 5) samples.push(blankSample());
  return { ...base, ...r.data, certNo: r.certNo, certDate: r.certDate, samples };
};

/** OD / ID / HT out of a PI line like "TOROIDAL CORE — 100x195x60 mm": the bigger
 *  of the first two numbers is the OD, the smaller the ID, the third the height. */
export const sizeFromText = (text: string) => {
  const m = text.match(/(\d+(?:\.\d+)?)\s*[x×*]\s*(\d+(?:\.\d+)?)\s*[x×*]\s*(\d+(?:\.\d+)?)/i);
  if (!m) return null;
  const a = Number(m[1]), b = Number(m[2]);
  return { od: String(Math.max(a, b)), id: String(Math.min(a, b)), ht: m[3] };
};

/* Self-check against the workbook's first sheet (TC 195 × 100 × 60): five samples,
   all within limit, min/max/avg as the sheet printed them. Runs once in dev only. */
if (import.meta.env?.DEV) {
  const t: TcForm = { ...blankTc(), od: '195', id: '100', ht: '60', permCurrent: '1647', grade: 'M4',
    samples: [['195.4', '99.95', '60.33', '958'], ['195.36', '99.94', '60.3', '933'], ['195.54', '99.9', '60.38', '1116'], ['195.48', '99.9', '60.33', '929'], ['195.4', '99.95', '60.4', '948']]
      .map(([od, id, ht, current]) => ({ od, id, ht, current })) };
  const c = calcTc(t);
  console.assert(c.tested === 5 && c.within === 5 && c.verdict === 'ACCEPTED', 'testCert: sample sheet should be ACCEPTED 5/5', c);
  console.assert(c.od?.min === 195.36 && c.od?.max === 195.54 && Math.round(c.current!.avg) === 977, 'testCert: min/max/avg', c);
  console.assert(fsnOf(t, 'METFLUX ELECTRICAL INDUSTRIES') === 'MEI-TC-M4-195-100-060', 'testCert: FSN', fsnOf(t, 'METFLUX ELECTRICAL INDUSTRIES'));
  console.assert(judgeSample({ ...t, permCurrent: '900' }, t.samples[0], 0).overall === 'NOT OK', 'testCert: over-current sample is NOT OK');
  console.assert(JSON.stringify(sizeFromText('TOROIDAL CORE (CHAMFERED) — 100x195x60 mm')) === JSON.stringify({ od: '195', id: '100', ht: '60' }), 'testCert: size from PI text');
}
