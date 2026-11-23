// Export test certificate as a vector PDF, laid out like the workbook's printed sheet
// (and the KANHSEEI sample): letterhead + logo, title banner, certificate details,
// specification, ten-row results table with min / max / average, the verdict strip,
// test method, certification and signatures. One A4 page per certificate, so several
// sizes download as one PDF. Company brand colour, through pdfmake like the PI.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { brandShadeHex } from '@/lib/brandColor';
import { loadPdfMake } from '@/lib/reportPdf';
import { calcTc, fsnOf, maxSize, minSize, tolText, MAX_SAMPLES, type TcForm } from './testCert';
import type { PiSettings, PiLogo } from './proformaXlsx';

const INK = '#0f172a', GREY = '#475569', LIGHT = '#cbd5e1', WHITE = '#ffffff', BLUE = '#1e3a8a', RED = '#b91c1c', SUM = '#e2e8f0';
// The standard statement certifies the lot as accepted; a rejected lot must not print it.
const REJECTED_TEXT = 'The samples listed above were tested as per the specified grade and dimensions. One or more test parameters are outside the permissible limits; the material is NOT accepted and is not released for dispatch.';
const dmy = (iso: string) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '');
const f2 = (v: string | number | null | undefined) => {
  if (v === null || v === undefined || String(v).trim() === '') return '';
  const x = Number(v);
  return Number.isFinite(x) ? x.toFixed(2) : String(v);
};
const f0 = (v: number | null | undefined) => (v === null || v === undefined ? '' : String(Math.round(v)));

const certPage = (t: TcForm, s: PiSettings, company: string, brand: string | null, logo: PiLogo | null, first: boolean): any[] => {
  const dark = brandShadeHex(brand, 700), mid = brandShadeHex(brand, 600), tint = brandShadeHex(brand, 50);
  const c = calcTc(t);
  const grid = { hLineWidth: () => 0.5, vLineWidth: () => 0.5, hLineColor: () => LIGHT, vLineColor: () => LIGHT, paddingLeft: () => 5, paddingRight: () => 5, paddingTop: () => 1.6, paddingBottom: () => 1.6 };
  const banner = (text: string, margin: number[] = [0, 7, 0, 0]) => ({
    table: { widths: ['*'], body: [[{ text, color: WHITE, bold: true, fontSize: 8.5, fillColor: mid, margin: [2, 1, 2, 1] }]] }, layout: 'noBorders', margin,
  });
  const k = (text: string) => ({ text, fontSize: 7.5, bold: true, color: GREY, fillColor: '#f8fafc' });
  const vg = (text: string) => ({ text: text || '', fontSize: 8.5, bold: true, color: dark });
  const vi = (text: string) => ({ text: text || '', fontSize: 8.5, bold: true, color: INK });
  const pairs = (rows: [string, any, string, any][]) => ({
    table: { widths: [100, '*', 100, '*'], body: rows.map(([a, b, cc, d]) => [k(a), b, k(cc), d]) }, layout: grid,
  });

  const head = {
    columns: [
      { width: '*', stack: [
        { text: company, fontSize: 17, bold: true, color: dark },
        { text: s.address, fontSize: 7.5, color: GREY, margin: [0, 3, 0, 0] },
        { text: `Tel: ${s.phone}   |   Email: ${s.email}`, fontSize: 7.5, color: GREY },
        { text: `GSTIN: ${s.gstin}`, fontSize: 7.5, color: GREY },
      ] },
      ...(logo ? [{ width: 120, image: `data:image/png;base64,${logo.base64}`, fit: [110, 58], alignment: 'right' }] : []),
    ],
    columnGap: 12,
  };
  const title = {
    table: { widths: ['*'], body: [[{ text: `TEST CERTIFICATE  –  ${(t.coreName || 'CORE').toUpperCase()}`, color: WHITE, bold: true, fontSize: 11.5, alignment: 'center', fillColor: dark, margin: [0, 4, 0, 4] }]] },
    layout: 'noBorders', margin: [0, 8, 0, 0],
  };

  const details = pairs([
    ['Customer', vg(t.customer), 'Certificate No.', vg(t.certNo)],
    ['Country', vg(t.country), 'Certificate Date', vg(dmy(t.certDate))],
    ['Customer PO No. / Date', vg(t.poRef), 'Format No.', vi(s.tcFormatNo ?? '')],
    ['Our PI / Invoice No.', vg(t.piRef), 'Test Station / Works', vg(t.works || s.tcWorks || '')],
    ['Lot Qty Supplied (Pcs)', vg(t.lotQty), 'FSN (Material Code)', vg(fsnOf(t, company))],
  ]);
  const spec = pairs([
    ['Nominal Size (OD×ID×HT)', vi(`${t.od} × ${t.id} × ${t.ht} mm`), 'Grade / Material', vg(t.grade)],
    ['Max. Size (OD×ID×HT)', vi(maxSize(t)), 'Frequency (Hz)', vg(t.frequency)],
    ['Min. Size (OD×ID×HT)', vi(minSize(t)), 'Applied Voltage (mV)', vg(t.voltage)],
    ['Tolerance (mm)', vi(tolText(t)), 'No. of Turns', vg(t.turns)],
    ['Test Type', vi(t.testType), 'Permissible Current (mA)', vg(t.permCurrent)],
  ]);

  const h = (text: string, extra: any = {}) => ({ text, fontSize: 7.5, bold: true, alignment: 'center', fillColor: tint, color: INK, ...extra });
  const remark = (r: string) => ({ text: r, fontSize: 8, alignment: 'center', color: r === 'Out of limit' ? RED : mid });
  const rows: any[] = [
    [h('Sr. No.', { rowSpan: 2, margin: [0, 7, 0, 0] }), h('MECHANICAL DIMENSIONS', { colSpan: 4, color: dark }), {}, {}, {}, h('ELECTRICAL PARAMETERS', { colSpan: 2, color: dark }), {}, h('Overall Result', { rowSpan: 2, margin: [0, 7, 0, 0] })],
    [{}, h('OD (mm)'), h('ID (mm)'), h('HT (mm)'), h('Remarks'), h('Actual Current (mA)'), h('Remarks'), {}],
  ];
  for (let i = 0; i < MAX_SAMPLES; i++) {
    const smp = t.samples[i];
    const r = smp ? c.rows[i] : null;
    const val = (v: string, dp = true) => ({ text: smp ? (dp ? f2(v) : v) : '', fontSize: 8.5, alignment: 'center', color: BLUE });
    rows.push([
      { text: r?.sr ? String(r.sr) : '', fontSize: 8.5, alignment: 'center' },
      val(smp?.od ?? ''), val(smp?.id ?? ''), val(smp?.ht ?? ''), remark(r?.dimRemark ?? ''),
      val(smp?.current ?? '', false), remark(r?.curRemark ?? ''),
      { text: r?.overall ?? '', fontSize: 8.5, bold: true, alignment: 'center', color: r?.overall === 'NOT OK' ? RED : mid },
    ]);
  }
  const sumRow = (label: string, pick: 'min' | 'max' | 'avg') => {
    const cell = (v: string) => ({ text: v, fontSize: 8.5, bold: true, alignment: 'center', fillColor: SUM });
    return [
      { text: label, fontSize: 7, bold: true, color: GREY, alignment: 'center', fillColor: SUM },
      cell(f2(c.od?.[pick])), cell(f2(c.id?.[pick])), cell(f2(c.ht?.[pick])), cell(''),
      cell(f0(c.current?.[pick])), cell(''), cell(''),
    ];
  };
  rows.push(sumRow('Minimum', 'min'), sumRow('Maximum', 'max'), sumRow('Average', 'avg'));
  const results = {
    table: { headerRows: 2, widths: [46, '*', '*', '*', '*', 70, '*', 62], heights: (r: number) => (r >= 2 && r < 2 + MAX_SAMPLES ? 12.5 : undefined), body: rows },
    layout: grid,
  };

  const verdictColour = c.verdict === 'REJECTED' ? RED : dark;
  const strip = {
    table: {
      widths: ['*', 60, '*', 60, 120],
      body: [[
        { text: 'SAMPLES TESTED', fontSize: 7.5, bold: true, color: GREY, alignment: 'center', fillColor: '#f8fafc', margin: [0, 5, 0, 5] },
        { text: String(c.tested || ''), fontSize: 11, bold: true, alignment: 'center', margin: [0, 3, 0, 3] },
        { text: 'SAMPLES WITHIN LIMIT', fontSize: 7.5, bold: true, color: GREY, alignment: 'center', fillColor: '#f8fafc', margin: [0, 5, 0, 5] },
        { text: String(c.tested ? c.within : ''), fontSize: 11, bold: true, alignment: 'center', margin: [0, 3, 0, 3] },
        { text: c.verdict, fontSize: 12, bold: true, color: WHITE, alignment: 'center', fillColor: verdictColour, margin: [0, 3, 0, 3] },
      ]],
    },
    layout: grid, margin: [0, 8, 0, 0],
  };

  const para = (text: string, bold = false) => ({
    table: { widths: ['*'], body: [[{ text, fontSize: 7.5, bold, fillColor: tint, margin: [2, 1.5, 2, 3] }]] }, layout: 'noBorders',
  });
  const sig = (label: string, name: string, colour = INK, date = true) => ({
    stack: [
      { text: label, fontSize: 7.5, bold: true, color: colour },
      { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 160, y2: 0, lineWidth: 0.5, lineColor: LIGHT }], margin: [0, 30, 0, 3] },
      { text: name || 'Name & Signature', fontSize: 7.5, bold: true },
      ...(date ? [{ text: 'Date:', fontSize: 7, color: GREY, margin: [0, 4, 0, 0] }] : []),
    ],
  });
  const signatures = {
    columns: [
      sig('TESTED BY', t.testedBy || s.tcTestedBy || ''),
      sig('APPROVED BY (QA)', t.approvedBy || s.tcApprovedBy || ''),
      sig(`For ${company}`, 'Authorised Signatory & Company Seal', dark, false),
    ],
    columnGap: 16, margin: [6, 10, 0, 0],
  };

  return [
    { ...head, ...(first ? {} : { pageBreak: 'before' }) },
    title,
    banner('CERTIFICATE DETAILS'), details,
    banner('SPECIFICATION'), spec,
    banner('TEST RESULTS'), results,
    strip,
    banner('TEST METHOD', [0, 8, 0, 0]), para(s.tcTestMethod ?? ''),
    banner('CERTIFICATION', [0, 6, 0, 0]),
    para(c.verdict === 'REJECTED' ? REJECTED_TEXT : s.tcCertification ?? '', true),
    signatures,
  ];
};

export const buildTestCertPdfDoc = (certs: TcForm[], s: PiSettings, company: string, brand: string | null, logo: PiLogo | null = null) => ({
  pageSize: 'A4',
  pageMargins: [28, 24, 28, 34],
  defaultStyle: { font: 'Montserrat', fontSize: 8.5, color: INK, lineHeight: 1 },
  info: { title: certs.length === 1 ? `Test Certificate ${certs[0].certNo}` : `Test Certificates (${certs.length})` },
  content: certs.flatMap((t, i) => certPage(t, s, company, brand, logo, i === 0)),
  footer: (page: number, pages: number) => ({
    columns: [
      { text: `This certificate relates only to the samples tested. Not to be reproduced except in full without written approval of ${company}.`, fontSize: 6, color: GREY },
      { text: `Page ${page} of ${pages}`, fontSize: 7, color: GREY, alignment: 'right', width: 70 },
    ],
    margin: [28, 10, 28, 0],
  }),
});

export const downloadTestCertPdf = async (
  certs: TcForm[], s: PiSettings, company: { name: string; logoUrl?: string | null }, brand: string | null,
) => {
  let logo: PiLogo | null = null;
  if (company.logoUrl) {
    try {
      const { dataUrlToPng } = await import('./image');
      const p = await dataUrlToPng(company.logoUrl, 400);
      logo = { base64: p.dataUrl.replace(/^data:image\/png;base64,/, ''), w: p.w, h: p.h };
    } catch { /* an unreadable logo must not stop the PDF */ }
  }
  const pdfMake = await loadPdfMake();
  const safe = (v: string) => v.replace(/[\\/:*?"<>|]/g, '-');
  const name = certs.length === 1
    ? `Test-Certificate-${safe(certs[0].certNo) || 'draft'}.pdf`
    : `Test-Certificates-${safe(certs[0].customer || 'export')}-${certs.length}-sizes.pdf`;
  pdfMake.createPdf(buildTestCertPdfDoc(certs, s, company.name, brand, logo)).download(name);
};
