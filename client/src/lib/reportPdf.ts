// Vector PDF generation for the Packing List and Testing Report, using pdfmake.
//
// Why not html2pdf: html2pdf rasterises the DOM to a JPEG and embeds that image,
// so downloads are blurry, heavy, and have non-selectable text. pdfmake emits a
// real vector PDF — crisp text, true table borders, tiny files — and lets us
// paint a branded header band in each deployment's brand colour.
//
// pdfmake + its font VFS are loaded lazily (dynamic import) so they stay out of
// the main app bundle until a PDF is actually generated.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { brandShadeHex } from '@/lib/brandColor';

// Documents use Montserrat overall; the Packing List item rows use Carlito
// (Calibri-compatible). Italics map to the upright faces (no italic text).
const FONTS = {
  Montserrat: {
    normal: 'Montserrat-Regular.ttf',
    bold: 'Montserrat-SemiBold.ttf',
    italics: 'Montserrat-Regular.ttf',
    bolditalics: 'Montserrat-SemiBold.ttf',
  },
  Carlito: {
    normal: 'Carlito-Regular.ttf',
    bold: 'Carlito-Bold.ttf',
    italics: 'Carlito-Regular.ttf',
    bolditalics: 'Carlito-Bold.ttf',
  },
};

let _pdfMake: any = null;
const loadPdfMake = async (): Promise<any> => {
  if (_pdfMake) return _pdfMake;
  const [pdfMakeMod, mont, carl]: any = await Promise.all([
    import('pdfmake/build/pdfmake'),
    import('@/assets/montserratVfs'),
    import('@/assets/carlitoVfs'),
  ]);
  const pdfMake = pdfMakeMod.default ?? pdfMakeMod;
  pdfMake.vfs = { ...mont.montserratVfs, ...carl.carlitoVfs };
  pdfMake.fonts = FONTS;
  _pdfMake = pdfMake;
  return pdfMake;
};

/* ── Shared bits ─────────────────────────────────────────────── */
export type PdfCompany = {
  name?: string | null; address?: string | null; phone?: string | null;
  whatsappNumber?: string | null; email?: string | null;
  gstNumber?: string | null; logoUrl?: string | null;
};

const WHITE = '#ffffff';
const INK = '#0f172a';
const GREY = '#475569';
const LIGHT = '#e2e8f0';

// Company letterhead + a brand-coloured title banner, as a borderless table.
const header = (company: PdfCompany, title: string, brandDark: string) => {
  const infoLines: any[] = [
    { text: company?.name || 'Company Name', bold: true, fontSize: 14, color: brandDark, characterSpacing: 0.3 },
  ];
  const addr = company?.address?.replace(/\n+/g, ', ').trim();
  if (addr) infoLines.push({ text: addr, fontSize: 8, color: GREY, margin: [0, 2, 0, 0] });
  const contact = [company?.phone, company?.whatsappNumber, company?.email].filter(Boolean).join('  |  ');
  if (contact) infoLines.push({ text: contact, fontSize: 8, color: GREY, margin: [0, 1, 0, 0] });
  if (company?.gstNumber) infoLines.push({ text: `GSTIN: ${company.gstNumber}`, fontSize: 8, color: GREY, margin: [0, 1, 0, 0] });

  const left: any = { stack: infoLines };
  if (company?.logoUrl) {
    left.stack = [
      { columns: [
        { image: company.logoUrl, width: 46, height: 46, fit: [46, 46] },
        { stack: infoLines, width: '*', margin: [8, 0, 0, 0] },
      ] },
    ];
  }

  return {
    table: {
      widths: ['*', 'auto'],
      body: [[
        left,
        { text: title, alignment: 'center', color: WHITE, bold: true, fontSize: 12,
          characterSpacing: 1.5, fillColor: brandDark, margin: [12, 12, 12, 12] },
      ]],
    },
    layout: {
      hLineWidth: () => 0, vLineWidth: () => 0,
      paddingLeft: () => 0, paddingRight: () => 0, paddingTop: () => 0, paddingBottom: () => 6,
    },
    margin: [0, 0, 0, 4],
  };
};

// A thin brand rule under the header.
const rule = (brandDark: string) => ({
  canvas: [{ type: 'line', x1: 0, y1: 0, x2: 547, y2: 0, lineWidth: 1.4, lineColor: brandDark }],
  margin: [0, 0, 0, 6],
});

// 2-up label/value info grid (Customer / State / WO / Invoice …).
const infoGrid = (pairs: [string, string][], brandLight: string) => {
  const body: any[] = [];
  for (let i = 0; i < pairs.length; i += 2) {
    const a = pairs[i]; const b = pairs[i + 1] ?? ['', ''];
    body.push([
      { text: a[0], bold: true, fontSize: 7.5, color: GREY, fillColor: brandLight },
      { text: a[1] || '—', fontSize: 9 },
      { text: b[0], bold: true, fontSize: 7.5, color: GREY, fillColor: brandLight },
      { text: b[1] || '—', fontSize: 9 },
    ]);
  }
  return {
    table: { widths: [70, '*', 70, '*'], body },
    layout: {
      hLineWidth: () => 0.5, vLineWidth: () => 0.5, hLineColor: () => LIGHT, vLineColor: () => LIGHT,
      paddingLeft: () => 5, paddingRight: () => 5, paddingTop: () => 3, paddingBottom: () => 3,
    },
    margin: [0, 0, 0, 8],
  };
};

const signatures = (testedBy: string, approvedBy: string, dateStr: string, brandDark: string) => ({
  table: {
    widths: ['*', '*'],
    body: [[
      { stack: [
        { text: 'TESTED BY', bold: true, fontSize: 8, color: GREY },
        { text: testedBy || ' ', fontSize: 10, bold: true, margin: [0, 14, 0, 2] },
        { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 220, y2: 0, lineWidth: 0.5, lineColor: GREY }] },
        { text: 'Name & Signature', fontSize: 7.5, color: GREY, margin: [0, 2, 0, 0] },
        { text: `Date: ${dateStr || '____________'}`, fontSize: 7.5, color: GREY, margin: [0, 3, 0, 0] },
      ], margin: [0, 6, 0, 6] },
      { stack: [
        { text: 'APPROVED BY', bold: true, fontSize: 8, color: GREY },
        { text: approvedBy || ' ', fontSize: 10, bold: true, margin: [0, 14, 0, 2] },
        { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 220, y2: 0, lineWidth: 0.5, lineColor: GREY }] },
        { text: 'Name & Signature', fontSize: 7.5, color: GREY, margin: [0, 2, 0, 0] },
        { text: `Date: ${dateStr || '____________'}`, fontSize: 7.5, color: GREY, margin: [0, 3, 0, 0] },
      ], margin: [10, 6, 0, 6] },
    ]],
  },
  layout: {
    hLineWidth: (i: number) => (i === 0 ? 1.2 : 0), vLineWidth: (i: number) => (i === 1 ? 0.5 : 0),
    hLineColor: () => brandDark, vLineColor: () => LIGHT,
    paddingLeft: () => 6, paddingRight: () => 6, paddingTop: () => 4, paddingBottom: () => 4,
  },
  margin: [0, 10, 0, 0],
});

const docFooter = (company: PdfCompany) => (currentPage: number, pageCount: number) => ({
  margin: [24, 6, 24, 0],
  columns: [
    { text: company?.name || '', fontSize: 7, color: GREY },
    { text: `Page ${currentPage} of ${pageCount}`, alignment: 'right', fontSize: 7, color: GREY },
  ],
});

/* ── Packing List ────────────────────────────────────────────── */
export type PackingListPdf = {
  company: PdfCompany;
  brand?: string | null;
  meta: { customer: string; state: string; woNo: string; woDate: string; invoiceNo: string; invoiceDate: string };
  groups: Array<{
    label: string; pcs: number; weight: number;
    grades: Array<{
      grade: string; multi: boolean;
      rows: Array<{ poNo: string; poDate: string; description: string; qty: string; rate: string; weight: string; remarks: string }>;
      subtotalPcs: number; subtotalWeight: number;
    }>;
  }>;
  grandPcs: number; grandWeight: number;
  testedBy: string; approvedBy: string; dateStr: string;
};

const buildPackingListDoc = (d: PackingListPdf) => {
  const brandDark = brandShadeHex(d.brand, 700);
  const brandMid = brandShadeHex(d.brand, 600);
  const brandLight = brandShadeHex(d.brand, 50);

  // 7 columns (Rate removed): SR | PO NO | PO DATE | DESCRIPTION | QTY | TOTAL WT | REMARKS
  const COLS = [20, 74, 62, '*', 42, 66, 66];
  const th = (t: string, align: any = 'center') => ({ text: t, bold: true, fontSize: 7.5, color: WHITE, fillColor: brandMid, alignment: align, characterSpacing: 0.2 });
  // Item-row cell — Calibri-compatible (Carlito) bold 11, per request.
  const rc = (t: string, align: any = 'center') => ({ text: t, alignment: align, font: 'Carlito', bold: true, fontSize: 11 });

  const content: any[] = [header(d.company, 'PACKING LIST', brandDark), rule(brandDark)];
  content.push(infoGrid([
    ['CUSTOMER', d.meta.customer], ['STATE', d.meta.state],
    ['WO NO.', d.meta.woNo], ['WO DATE', d.meta.woDate],
    ['INVOICE NO.', d.meta.invoiceNo], ['INVOICE DATE', d.meta.invoiceDate],
  ], brandLight));

  for (const g of d.groups) {
    const body: any[] = [];
    // Section header (spans all columns)
    body.push([
      { text: g.label.toUpperCase(), colSpan: 7, bold: true, color: WHITE, fillColor: brandDark, fontSize: 8.5, characterSpacing: 1, margin: [2, 2, 2, 2] },
      {}, {}, {}, {}, {}, {},
    ]);
    // Column headers
    body.push([th('SR'), th('PO NO'), th('PO DATE'), th('ITEM DESCRIPTION', 'left'), th('QTY (PCS)'), th('TOTAL WT (KG)'), th('REMARKS', 'left')]);

    let sr = 0;
    for (const grp of g.grades) {
      if (grp.multi) {
        body.push([
          { text: `Grade: ${grp.grade}`, colSpan: 7, bold: true, fontSize: 7, color: GREY, fillColor: '#f1f5f9', margin: [2, 1, 2, 1] },
          {}, {}, {}, {}, {}, {},
        ]);
      }
      for (const r of grp.rows) {
        sr += 1;
        body.push([
          rc(String(sr)), rc(r.poNo), rc(r.poDate), rc(r.description, 'left'),
          rc(r.qty), rc(r.weight, 'right'), rc(r.remarks, 'left'),
        ]);
      }
      if (grp.multi) {
        body.push([
          { text: `Grade ${grp.grade} Subtotal`, colSpan: 4, alignment: 'right', bold: true, fontSize: 7, color: GREY, fillColor: '#f8fafc', margin: [2, 1, 2, 1] },
          {}, {}, {},
          { text: String(grp.subtotalPcs), alignment: 'center', bold: true, fontSize: 8, fillColor: '#f8fafc' },
          { text: grp.subtotalWeight.toFixed(3), alignment: 'right', bold: true, fontSize: 8, fillColor: '#f8fafc' },
          { text: '', fillColor: '#f8fafc' },
        ]);
      }
    }
    // Core-type total
    body.push([
      { text: `${g.label} Total`, colSpan: 4, alignment: 'right', bold: true, fontSize: 8, color: INK, fillColor: '#e2e8f0', margin: [2, 2, 2, 2] },
      {}, {}, {},
      { text: String(g.pcs), alignment: 'center', bold: true, fontSize: 9, fillColor: '#e2e8f0' },
      { text: g.weight.toFixed(3), alignment: 'right', bold: true, fontSize: 9, fillColor: '#e2e8f0' },
      { text: '', fillColor: '#e2e8f0' },
    ]);

    content.push({
      table: { headerRows: 0, widths: COLS, dontBreakRows: true, body },
      layout: {
        hLineWidth: () => 0.4, vLineWidth: () => 0.4, hLineColor: () => LIGHT, vLineColor: () => LIGHT,
        paddingLeft: () => 3, paddingRight: () => 3, paddingTop: () => 2.5, paddingBottom: () => 2.5,
      },
      margin: [0, 0, 0, 6],
    });
  }

  // Grand total strip
  content.push({
    table: {
      widths: ['*', 'auto', 'auto'],
      body: [[
        { text: 'GRAND TOTAL', color: WHITE, bold: true, fontSize: 10, characterSpacing: 1, fillColor: brandDark, margin: [6, 6, 6, 6] },
        { text: `${d.grandPcs} pcs`, color: WHITE, bold: true, fontSize: 12, alignment: 'right', fillColor: brandDark, margin: [6, 5, 12, 5] },
        { text: `${d.grandWeight.toFixed(3)} kg`, color: WHITE, bold: true, fontSize: 12, alignment: 'right', fillColor: brandDark, margin: [6, 5, 6, 5] },
      ]],
    },
    layout: { hLineWidth: () => 0, vLineWidth: () => 0, paddingLeft: () => 0, paddingRight: () => 0, paddingTop: () => 0, paddingBottom: () => 0 },
    margin: [0, 2, 0, 0],
  });

  content.push(signatures(d.testedBy, d.approvedBy, d.dateStr, brandDark));

  return {
    pageSize: 'A4', pageMargins: [24, 22, 24, 28],
    defaultStyle: { font: 'Montserrat', fontSize: 9, color: INK, lineHeight: 1.05 },
    content, footer: docFooter(d.company),
  };
};

/* ── Testing Report ──────────────────────────────────────────── */
export type TestingReportPdf = {
  company: PdfCompany;
  brand?: string | null;
  reportDate: string;
  groups: Array<{
    reportNo: string; customer: string; state: string; poNumber: string; poDate: string;
    woNumber: string; woDate: string; invoiceNo: string; invoiceDate: string;
    testedBy: string; approvedBy: string;
    items: Array<{
      measure: string; grade: string; turns: string; appliedVoltage: string;
      pcs: string; samplePcs: string; samplingRate: string; maxCurrent: string;
      samples: (number | null)[];
    }>;
  }>;
};

const buildTestingReportDoc = (d: TestingReportPdf) => {
  const brandDark = brandShadeHex(d.brand, 700);
  const brandMid = brandShadeHex(d.brand, 600);
  const brandLight = brandShadeHex(d.brand, 50);
  const content: any[] = [];

  d.groups.forEach((g, gi) => {
    if (gi > 0) content.push({ text: '', pageBreak: 'before' });
    content.push(header(d.company, 'TESTING REPORT', brandDark), rule(brandDark));
    content.push(infoGrid([
      ['REPORT NO.', g.reportNo], ['REPORT DATE', d.reportDate],
      ['CUSTOMER', g.customer], ['STATE', g.state],
      ['PO NO.', g.poNumber], ['PO DATE', g.poDate],
      ['WO NO.', g.woNumber], ['WO DATE', g.woDate],
      ['INVOICE NO.', g.invoiceNo], ['INVOICE DATE', g.invoiceDate],
    ], brandLight));

    for (const it of g.items) {
      // Item spec band — 4 label/value pairs across two rows.
      const band = (label: string, value: string, strong = false) => ({
        stack: [
          { text: label, fontSize: 7, bold: true, color: GREY },
          { text: value || '—', fontSize: 9, bold: strong, color: strong ? INK : GREY, margin: [0, 1, 0, 0] },
        ],
        fillColor: brandLight, margin: [4, 3, 4, 3],
      });
      content.push({
        table: {
          widths: ['*', '*', '*', '*'],
          body: [
            [band('Measure', it.measure), band('Grade', it.grade), band('No. of Turns', it.turns), band('Applied Voltage (V)', it.appliedVoltage)],
            [band('No. of Pcs', it.pcs, true), band('Sample Pcs', it.samplePcs, true), band('Sampling Rate', it.samplingRate, true), band('Max Allowed Current', it.maxCurrent, true)],
          ],
        },
        layout: { hLineWidth: () => 0.4, vLineWidth: () => 0.4, hLineColor: () => LIGHT, vLineColor: () => LIGHT, paddingLeft: () => 0, paddingRight: () => 0, paddingTop: () => 0, paddingBottom: () => 0 },
        margin: [0, 0, 0, 0], unbreakable: true,
      });

      // Sample readings — SN | Actual IeMax pairs, 4-up.
      const PER = Math.min(4, Math.max(1, it.samples.length));
      const headRow: any[] = [];
      for (let i = 0; i < PER; i++) {
        headRow.push({ text: 'SN', bold: true, fontSize: 7, color: WHITE, fillColor: brandMid, alignment: 'center' });
        headRow.push({ text: 'Actual IeMax (mA)', bold: true, fontSize: 7, color: WHITE, fillColor: brandMid, alignment: 'center' });
      }
      const body: any[] = [headRow];
      for (let i = 0; i < it.samples.length; i += PER) {
        const slice = it.samples.slice(i, i + PER);
        const row: any[] = [];
        for (let c = 0; c < PER; c++) {
          const present = c < slice.length;
          const sn = i + c + 1;
          row.push({ text: present ? String(sn) : '', alignment: 'center', fontSize: 8, color: GREY });
          row.push({ text: present ? (slice[c] != null ? (slice[c] as number).toFixed(2) : '—') : '', alignment: 'center', fontSize: 8 });
        }
        body.push(row);
      }
      const widths: any[] = [];
      for (let i = 0; i < PER; i++) { widths.push(22); widths.push('*'); }
      content.push({
        table: { headerRows: 1, widths, body, dontBreakRows: true },
        layout: { hLineWidth: () => 0.4, vLineWidth: () => 0.4, hLineColor: () => LIGHT, vLineColor: () => LIGHT, paddingLeft: () => 2, paddingRight: () => 2, paddingTop: () => 2, paddingBottom: () => 2 },
        margin: [0, 0, 0, 8],
      });
    }

    content.push(signatures(g.testedBy, g.approvedBy, g.woDate, brandDark));
  });

  return {
    pageSize: 'A4', pageMargins: [24, 22, 24, 28],
    defaultStyle: { font: 'Montserrat', fontSize: 9, color: INK, lineHeight: 1.05 },
    content, footer: docFooter(d.company),
  };
};

/* ── Public API ──────────────────────────────────────────────── */
export const downloadPackingListPdf = async (data: PackingListPdf, filename: string) => {
  const pdfMake = await loadPdfMake();
  pdfMake.createPdf(buildPackingListDoc(data)).download(filename);
};
export const packingListPdfBlob = async (data: PackingListPdf): Promise<Blob> => {
  const pdfMake = await loadPdfMake();
  return new Promise((resolve) => pdfMake.createPdf(buildPackingListDoc(data)).getBlob(resolve));
};
export const downloadTestingReportPdf = async (data: TestingReportPdf, filename: string) => {
  const pdfMake = await loadPdfMake();
  pdfMake.createPdf(buildTestingReportDoc(data)).download(filename);
};
export const testingReportPdfBlob = async (data: TestingReportPdf): Promise<Blob> => {
  const pdfMake = await loadPdfMake();
  return new Promise((resolve) => pdfMake.createPdf(buildTestingReportDoc(data)).getBlob(resolve));
};
