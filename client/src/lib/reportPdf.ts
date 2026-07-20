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
  Poppins: {
    normal: 'Poppins-Regular.ttf',
    bold: 'Poppins-SemiBold.ttf',
    italics: 'Poppins-Regular.ttf',
    bolditalics: 'Poppins-SemiBold.ttf',
  },
};

let _pdfMake: any = null;
const loadPdfMake = async (): Promise<any> => {
  if (_pdfMake) return _pdfMake;
  const [pdfMakeMod, mont, carl, pop]: any = await Promise.all([
    import('pdfmake/build/pdfmake'),
    import('@/assets/montserratVfs'),
    import('@/assets/carlitoVfs'),
    import('@/assets/poppinsVfs'),
  ]);
  const pdfMake = pdfMakeMod.default ?? pdfMakeMod;
  pdfMake.vfs = { ...mont.montserratVfs, ...carl.carlitoVfs, ...pop.poppinsVfs };
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

// Company letterhead (logo vertically centred against the text) + a slim
// brand-coloured title banner. Uses a `columns` layout (not a table) so the
// banner is only as tall as its own text instead of stretching to the height
// of the company block.
const header = (company: PdfCompany, title: string, brandDark: string) => {
  const infoLines: any[] = [
    // Dark company name (matches the on-screen preview); the brand colour lives
    // in the banner + rule, not the name.
    { text: company?.name || 'Company Name', bold: true, fontSize: 16, color: INK, characterSpacing: 0.3 },
  ];
  const addr = company?.address?.replace(/\n+/g, ', ').trim();
  if (addr) infoLines.push({ text: addr, fontSize: 9, color: GREY, margin: [0, 2, 0, 0] });
  const contact = [company?.phone, company?.whatsappNumber, company?.email].filter(Boolean).join('  |  ');
  if (contact) infoLines.push({ text: [{ text: 'Contact: ', bold: true }, contact], fontSize: 9, color: GREY, margin: [0, 1, 0, 0] });
  if (company?.gstNumber) infoLines.push({ text: `GSTIN: ${company.gstNumber}`, fontSize: 9, color: GREY, margin: [0, 1, 0, 0] });

  const LOGO = 46;
  // Approximate text-block height (name line + the smaller lines) to nudge the
  // logo down so it sits centred against the text rather than aligned to the top.
  const textH = 20 + (infoLines.length - 1) * 12;
  const logoTop = Math.max(0, Math.round((textH - LOGO) / 2));

  const leftColumn: any = company?.logoUrl
    ? {
        width: '*',
        columns: [
          { image: company.logoUrl, width: LOGO, fit: [LOGO, LOGO], margin: [0, logoTop, 0, 0] },
          { width: '*', stack: infoLines, margin: [8, 0, 0, 0] },
        ],
      }
    : { width: '*', stack: infoLines };

  // Slim banner — font just above the company-name heading; tight padding.
  const titleColumn: any = {
    width: 'auto',
    table: {
      widths: ['auto'],
      body: [[
        { text: title, alignment: 'center', color: WHITE, bold: true, fontSize: 17,
          characterSpacing: 1.2, fillColor: brandDark, margin: [18, 7, 18, 7] },
      ]],
    },
    layout: { hLineWidth: () => 0, vLineWidth: () => 0, paddingLeft: () => 0, paddingRight: () => 0, paddingTop: () => 0, paddingBottom: () => 0 },
  };

  return {
    columns: [leftColumn, titleColumn],
    columnGap: 12,
    margin: [0, 0, 0, 6],
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
      { text: a[0], bold: true, fontSize: 9, color: GREY, fillColor: brandLight },
      { text: a[1] || '—', fontSize: 9.5, bold: true },
      { text: b[0], bold: true, fontSize: 9, color: GREY, fillColor: brandLight },
      { text: b[1] || '—', fontSize: 9.5, bold: true },
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
    { text: company?.name || '', fontSize: 7, color: GREY, font: 'Montserrat' },
    { text: `Page ${currentPage} of ${pageCount}`, alignment: 'right', fontSize: 7, color: GREY, font: 'Montserrat' },
  ],
});

/* ── Packing List ────────────────────────────────────────────── */
export type PackingListPdf = {
  company: PdfCompany;
  brand?: string | null;
  meta: { customer: string; state: string; woNo: string; woDate: string; invoiceNo: string; invoiceDate: string };
  groups: Array<{
    label: string; pcs: number; box: number; weight: number;
    grades: Array<{
      grade: string; multi: boolean;
      rows: Array<{ poNo: string; poDate: string; description: string; qty: string; box: string; rate: string; weight: string; remarks: string }>;
      subtotalPcs: number; subtotalBox: number; subtotalWeight: number;
    }>;
  }>;
  grandPcs: number; grandBox: number; grandWeight: number;
  testedBy: string; approvedBy: string; dateStr: string;
};

const buildPackingListDoc = (d: PackingListPdf) => {
  const brandDark = brandShadeHex(d.brand, 700);
  const brandMid = brandShadeHex(d.brand, 600);
  const brandLight = brandShadeHex(d.brand, 50);

  // 8 columns: SR | PO NO | PO DATE | DESCRIPTION | QTY | BOX | WT | REMARKS
  const COLS = [20, 72, 58, '*', 40, 34, 60, 60];
  const th = (t: string, align: any = 'center') => ({ text: t, bold: true, fontSize: 9, color: WHITE, fillColor: brandMid, alignment: align, characterSpacing: 0.2 });
  // Item-row cell — Calibri-compatible (Carlito), regular weight (Carlito has no
  // separate semibold), size 10 so rows read a touch smaller than the headings.
  const rc = (t: string, align: any = 'center') => ({ text: t, alignment: align, font: 'Carlito', fontSize: 10 });

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
      { text: g.label.toUpperCase(), colSpan: 8, bold: true, color: WHITE, fillColor: brandDark, fontSize: 10, characterSpacing: 1, margin: [2, 3, 2, 3] },
      {}, {}, {}, {}, {}, {}, {},
    ]);
    // Column headers
    body.push([th('SR'), th('PO NO'), th('PO DATE'), th('ITEM DESCRIPTION', 'left'), th('QTY (PCS)'), th('BOX'), th('WT (KG)'), th('REMARKS', 'left')]);

    let sr = 0;
    for (const grp of g.grades) {
      if (grp.multi) {
        body.push([
          { text: `Grade: ${grp.grade}`, colSpan: 8, bold: true, fontSize: 8.5, color: GREY, fillColor: '#f1f5f9', margin: [2, 1.5, 2, 1.5] },
          {}, {}, {}, {}, {}, {}, {},
        ]);
      }
      for (const r of grp.rows) {
        sr += 1;
        body.push([
          rc(String(sr)), rc(r.poNo), rc(r.poDate), rc(r.description, 'left'),
          rc(r.qty), rc(r.box), rc(r.weight, 'right'), rc(r.remarks, 'left'),
        ]);
      }
      if (grp.multi) {
        body.push([
          { text: `Grade ${grp.grade} Subtotal`, colSpan: 4, alignment: 'right', bold: true, fontSize: 9, color: GREY, fillColor: '#f8fafc', margin: [2, 1.5, 2, 1.5] },
          {}, {}, {},
          { text: String(grp.subtotalPcs), alignment: 'center', bold: true, fontSize: 10, fillColor: '#f8fafc' },
          { text: grp.subtotalBox ? String(grp.subtotalBox) : '', alignment: 'center', bold: true, fontSize: 10, fillColor: '#f8fafc' },
          { text: grp.subtotalWeight.toFixed(3), alignment: 'right', bold: true, fontSize: 10, fillColor: '#f8fafc' },
          { text: '', fillColor: '#f8fafc' },
        ]);
      }
    }
    // Core-type total
    body.push([
      { text: `${g.label} Total`, colSpan: 4, alignment: 'right', bold: true, fontSize: 10, color: INK, fillColor: '#e2e8f0', margin: [2, 3, 2, 3] },
      {}, {}, {},
      { text: String(g.pcs), alignment: 'center', bold: true, fontSize: 11, fillColor: '#e2e8f0' },
      { text: g.box ? String(g.box) : '', alignment: 'center', bold: true, fontSize: 11, fillColor: '#e2e8f0' },
      { text: g.weight.toFixed(3), alignment: 'right', bold: true, fontSize: 11, fillColor: '#e2e8f0' },
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
      widths: d.grandBox > 0 ? ['*', 'auto', 'auto', 'auto'] : ['*', 'auto', 'auto'],
      body: [[
        { text: 'GRAND TOTAL', color: WHITE, bold: true, fontSize: 12, characterSpacing: 1, fillColor: brandDark, margin: [6, 7, 6, 7] },
        { text: `${d.grandPcs} pcs`, color: WHITE, bold: true, fontSize: 15, alignment: 'right', fillColor: brandDark, margin: [6, 6, 12, 6] },
        ...(d.grandBox > 0 ? [{ text: `${d.grandBox} box`, color: WHITE, bold: true, fontSize: 15, alignment: 'right', fillColor: brandDark, margin: [6, 6, 12, 6] }] : []),
        { text: `${d.grandWeight.toFixed(3)} kg`, color: WHITE, bold: true, fontSize: 15, alignment: 'right', fillColor: brandDark, margin: [6, 6, 6, 6] },
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
          { text: label, fontSize: 8, bold: true, color: GREY },
          { text: value || '—', fontSize: 10.5, bold: true, color: strong ? INK : GREY, margin: [0, 1.5, 0, 0] },
        ],
        fillColor: brandLight, margin: [4, 4, 4, 4],
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
        headRow.push({ text: 'SN', bold: true, fontSize: 8.5, color: WHITE, fillColor: brandMid, alignment: 'center' });
        headRow.push({ text: 'Actual IeMax (mA)', bold: true, fontSize: 8.5, color: WHITE, fillColor: brandMid, alignment: 'center' });
      }
      const body: any[] = [headRow];
      for (let i = 0; i < it.samples.length; i += PER) {
        const slice = it.samples.slice(i, i + PER);
        const row: any[] = [];
        for (let c = 0; c < PER; c++) {
          const present = c < slice.length;
          const sn = i + c + 1;
          row.push({ text: present ? String(sn) : '', alignment: 'center', fontSize: 9.5, color: GREY });
          row.push({ text: present ? (slice[c] != null ? (slice[c] as number).toFixed(2) : '—') : '', alignment: 'center', fontSize: 10.5, bold: true });
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

/* ── Sales Quotation ─────────────────────────────────────────── */
export type QuotationPdf = {
  company: PdfCompany;
  brand?: string | null;
  quotationNo: string; quotationDate: string; validUntil: string; status: string;
  party: { name: string; lines: string[]; phone: string; gstin: string };
  items: Array<{ description: string; sub: string; hsn: string; qty: string; unit: string; price: string; amount: string }>;
  totalQty: string; unit: string; subTotal: string;
  gstRate: number; intra: boolean; tax: string; grandTotal: string; amountWords: string;
  bank: { name: string; accountName: string; accountNumber: string; ifsc: string; branch: string };
  terms: string; notes: string;
};

const buildQuotationDoc = (d: QuotationPdf) => {
  const brandDark = brandShadeHex(d.brand, 700);
  const brandMid = brandShadeHex(d.brand, 600);
  const brandLight = brandShadeHex(d.brand, 50);
  // Item table headers + rows stay in Montserrat; the rest of the document uses
  // Poppins (set via defaultStyle below).
  const th = (t: string, align: any = 'center') => ({ text: t, bold: true, fontSize: 8.5, color: WHITE, fillColor: brandMid, alignment: align, font: 'Montserrat' });

  // Quotation-specific letterhead: company text on the LEFT; logo on the
  // TOP-RIGHT with the SALES QUOTATION banner stacked directly beneath it.
  const c = d.company;
  // Letterhead + footers use Montserrat (matching the packing list / testing report).
  const MONT = 'Montserrat';
  const infoLines: any[] = [{ text: c.name || 'Company Name', bold: true, fontSize: 17, color: brandDark, characterSpacing: 0.3, font: MONT }];
  const addr = c.address?.replace(/\n+/g, ', ').trim();
  if (addr) infoLines.push({ text: addr, fontSize: 9, color: GREY, margin: [0, 2, 0, 0], font: MONT });
  const contact = [c.phone, c.whatsappNumber, c.email].filter(Boolean).join('  |  ');
  if (contact) infoLines.push({ text: [{ text: 'Contact: ', bold: true }, contact], fontSize: 9, color: GREY, margin: [0, 1, 0, 0], font: MONT });
  if (c.gstNumber) infoLines.push({ text: `GSTIN: ${c.gstNumber}`, fontSize: 9, color: GREY, margin: [0, 1, 0, 0], font: MONT });

  const noBorders = { hLineWidth: () => 0, vLineWidth: () => 0, paddingLeft: () => 0, paddingRight: () => 0, paddingTop: () => 0, paddingBottom: () => 0 };
  const rightStack: any[] = [];
  if (c.logoUrl) rightStack.push({ image: c.logoUrl, fit: [216, 78], alignment: 'right', margin: [0, 0, 0, 4] });
  // Compact, bold, single-line banner — auto width, right-aligned.
  rightStack.push({
    columns: [
      { text: '', width: '*' },
      { width: 'auto', table: { widths: ['auto'], body: [[
        { text: 'SALES QUOTATION', color: WHITE, bold: true, fontSize: 12, characterSpacing: 1.2, fillColor: brandDark, margin: [12, 6, 12, 6], noWrap: true, font: MONT },
      ]] }, layout: noBorders },
    ],
  });

  const content: any[] = [
    { columns: [{ width: '*', stack: infoLines, margin: [0, 4, 0, 0] }, { width: 220, stack: rightStack }], columnGap: 16, margin: [0, 0, 0, 6] },
    rule(brandDark),
  ];

  // Party details (left) + quotation meta (right)
  const metaRow = (label: string, value: string) => ({
    columns: [
      { text: label, width: 66, fontSize: 9, color: GREY, bold: true, font: 'Poppins' },
      { text: value || '—', width: '*', fontSize: 9, bold: true, font: 'Poppins', noWrap: true },
    ], margin: [0, 0, 0, 2],
  });
  content.push({
    columns: [
      { width: '*', stack: [
        { text: 'PARTY DETAILS', bold: true, fontSize: 8, color: brandDark, characterSpacing: 0.5 },
        { text: d.party.name, bold: true, fontSize: 11, margin: [0, 2, 0, 0] },
        ...d.party.lines.map((l) => ({ text: l, fontSize: 9, color: GREY })),
        ...(d.party.phone ? [{ text: `Phone ${d.party.phone}`, fontSize: 9, color: GREY }] : []),
        { text: [{ text: 'GSTIN: ', bold: true }, d.party.gstin || '—'], fontSize: 9, margin: [0, 2, 0, 0] },
      ], margin: [0, 0, 12, 0] },
      { width: 190, stack: [
        metaRow('Quotation No.', d.quotationNo),
        metaRow('Dated', d.quotationDate),
        ...(d.validUntil ? [metaRow('Valid Until', d.validUntil)] : []),
        metaRow('Status', d.status),
      ] },
    ],
    margin: [0, 0, 0, 8],
  });

  // Items table
  const body: any[] = [[
    th('S.N'), th('Description of Goods', 'left'), th('HSN/SAC'), th('Qty', 'right'), th('Unit'), th('Price', 'right'), th('Amount', 'right'),
  ]];
  d.items.forEach((it, i) => {
    body.push([
      { text: String(i + 1), alignment: 'center', fontSize: 9, font: 'Montserrat' },
      { stack: [{ text: it.description, fontSize: 9, bold: true }, ...(it.sub ? [{ text: it.sub, fontSize: 8, color: GREY }] : [])], font: 'Montserrat' },
      { text: it.hsn || '—', alignment: 'center', fontSize: 9, font: 'Montserrat' },
      { text: it.qty, alignment: 'right', fontSize: 9, font: 'Montserrat' },
      { text: it.unit, alignment: 'center', fontSize: 9, font: 'Montserrat' },
      { text: it.price, alignment: 'right', fontSize: 9, font: 'Montserrat' },
      { text: it.amount, alignment: 'right', fontSize: 9, bold: true, font: 'Montserrat' },
    ]);
  });
  body.push([
    { text: 'Total', colSpan: 3, alignment: 'right', bold: true, fontSize: 9, color: INK, fillColor: '#e2e8f0', margin: [2, 2, 2, 2], font: 'Montserrat' }, {}, {},
    { text: d.totalQty, alignment: 'right', bold: true, fontSize: 9, fillColor: '#e2e8f0', font: 'Montserrat' },
    { text: d.unit, alignment: 'center', fontSize: 9, fillColor: '#e2e8f0', font: 'Montserrat' },
    { text: '', fillColor: '#e2e8f0' },
    { text: d.subTotal, alignment: 'right', bold: true, fontSize: 9, fillColor: '#e2e8f0', font: 'Montserrat' },
  ]);
  content.push({
    table: { headerRows: 1, widths: [24, '*', 55, 40, 34, 58, 66], dontBreakRows: true, body },
    layout: { hLineWidth: () => 0.4, vLineWidth: () => 0.4, hLineColor: () => LIGHT, vLineColor: () => LIGHT, paddingLeft: () => 3, paddingRight: () => 3, paddingTop: () => 2.5, paddingBottom: () => 2.5 },
    margin: [0, 0, 0, 0],
  });

  // Amount in words (left) + totals (right)
  const totalLines: any[] = [{ columns: [{ text: 'Sub Total', width: '*', fontSize: 9, color: GREY }, { text: d.subTotal, width: 'auto', fontSize: 9, alignment: 'right' }] }];
  if (d.gstRate > 0) {
    if (d.intra) {
      const half = (parseFloat(d.tax.replace(/,/g, '')) / 2).toFixed(2);
      totalLines.push({ columns: [{ text: `CGST @ ${(d.gstRate / 2).toFixed(2)}%`, width: '*', fontSize: 9, color: GREY }, { text: half, width: 'auto', fontSize: 9, alignment: 'right' }] });
      totalLines.push({ columns: [{ text: `SGST @ ${(d.gstRate / 2).toFixed(2)}%`, width: '*', fontSize: 9, color: GREY }, { text: half, width: 'auto', fontSize: 9, alignment: 'right' }] });
    } else {
      totalLines.push({ columns: [{ text: `IGST @ ${d.gstRate.toFixed(2)}%`, width: '*', fontSize: 9, color: GREY }, { text: d.tax, width: 'auto', fontSize: 9, alignment: 'right' }] });
    }
  }
  totalLines.push({
    columns: [{ text: 'Grand Total', width: '*', fontSize: 11, bold: true, color: brandDark }, { text: `₹ ${d.grandTotal}`, width: 'auto', fontSize: 11, bold: true, alignment: 'right', color: brandDark }],
    margin: [0, 3, 0, 0],
  });
  content.push({
    table: { widths: ['*', 'auto'], body: [[
      { stack: [{ text: 'AMOUNT IN WORDS', bold: true, fontSize: 8, color: GREY }, { text: `INR ${d.amountWords}`, bold: true, fontSize: 9.5, margin: [0, 2, 0, 0] }], margin: [0, 2, 10, 2] },
      { width: 200, stack: totalLines, margin: [0, 2, 0, 2] },
    ]] },
    layout: { hLineWidth: (i: number) => (i === 0 || i === 1 ? 0.5 : 0), vLineWidth: (i: number) => (i === 1 ? 0.5 : 0), hLineColor: () => LIGHT, vLineColor: () => LIGHT, paddingLeft: () => 6, paddingRight: () => 6, paddingTop: () => 2, paddingBottom: () => 2 },
    margin: [0, 0, 0, 8],
  });

  // Tax breakup
  if (d.gstRate > 0) {
    const taxLabel = d.intra ? 'CGST + SGST' : 'IGST';
    content.push({
      table: { widths: ['*', '*', '*', '*'], body: [
        [{ text: 'Tax Rate', bold: true, fontSize: 8, color: GREY, fillColor: brandLight }, { text: 'Taxable Amt', bold: true, fontSize: 8, color: GREY, alignment: 'right', fillColor: brandLight }, { text: `${taxLabel} Amt`, bold: true, fontSize: 8, color: GREY, alignment: 'right', fillColor: brandLight }, { text: 'Total Tax', bold: true, fontSize: 8, color: GREY, alignment: 'right', fillColor: brandLight }],
        [{ text: `${d.gstRate.toFixed(0)}%`, fontSize: 9 }, { text: d.subTotal, fontSize: 9, alignment: 'right' }, { text: d.tax, fontSize: 9, alignment: 'right' }, { text: d.tax, fontSize: 9, bold: true, alignment: 'right' }],
      ] },
      layout: { hLineWidth: () => 0.4, vLineWidth: () => 0.4, hLineColor: () => LIGHT, vLineColor: () => LIGHT, paddingLeft: () => 5, paddingRight: () => 5, paddingTop: () => 2.5, paddingBottom: () => 2.5 },
      margin: [0, 0, 0, 8],
    });
  }

  if (d.notes) content.push({ text: [{ text: 'Note: ', bold: true, color: GREY }, d.notes], fontSize: 9, margin: [0, 0, 0, 8] });

  // Bank details — one flowing line (wraps to 2 if long)
  const bankSegs: any[] = [{ text: 'Bank Details   ', bold: true, color: brandDark }];
  const seg = (label: string, value: string) => { if (value) bankSegs.push({ text: `${label}: `, color: GREY }, { text: value + '    ' }); };
  seg('Bank', d.bank.name); seg('A/C Name', d.bank.accountName); seg('A/C No', d.bank.accountNumber);
  seg('IFSC', d.bank.ifsc); seg('Branch', d.bank.branch);
  if (bankSegs.length > 1) content.push({ text: bankSegs, fontSize: 9, lineHeight: 1.25, margin: [0, 0, 0, 6] });

  // Terms — full-width brand-tinted panel with a left accent bar; semibold text.
  if (d.terms) {
    content.push({
      table: { widths: ['*'], body: [
        [{ text: 'TERMS & CONDITIONS', bold: true, fontSize: 9, color: WHITE, fillColor: brandDark, characterSpacing: 1, margin: [8, 4, 8, 4] }],
        [{ text: d.terms, fontSize: 8.5, bold: true, color: INK, lineHeight: 1.35, fillColor: brandLight, margin: [8, 6, 8, 8] }],
      ] },
      layout: {
        hLineWidth: () => 0, vLineWidth: (i: number) => (i === 0 ? 2.5 : 0), vLineColor: () => brandMid,
        paddingLeft: () => 0, paddingRight: () => 0, paddingTop: () => 0, paddingBottom: () => 0,
      },
      margin: [0, 2, 0, 8],
    });
  }

  // Signature footer (Montserrat, like the reports)
  content.push({
    columns: [
      { width: '*', stack: [{ text: "Receiver's Signature", fontSize: 9, color: GREY, font: MONT }, { text: 'E. & O.E.', fontSize: 8, color: GREY, margin: [0, 24, 0, 0], font: MONT }] },
      { width: '*', stack: [{ text: `For, ${d.company.name || ''}`, fontSize: 9, bold: true, alignment: 'right', font: MONT }, { text: 'Authorised Signatory', fontSize: 9, color: GREY, alignment: 'right', margin: [0, 24, 0, 0], font: MONT }] },
    ],
    margin: [0, 6, 0, 0],
  });

  return {
    pageSize: 'A4', pageMargins: [24, 22, 24, 28],
    // Whole quotation in Poppins except the items table (headers + rows), which
    // set font: 'Montserrat' per cell above.
    defaultStyle: { font: 'Poppins', fontSize: 9, color: INK, lineHeight: 1.05 },
    content, footer: docFooter(d.company),
  };
};

/* ── Public API ──────────────────────────────────────────────── */
export const downloadQuotationPdf = async (data: QuotationPdf, filename: string) => {
  const pdfMake = await loadPdfMake();
  pdfMake.createPdf(buildQuotationDoc(data)).download(filename);
};
export const quotationPdfBlob = async (data: QuotationPdf): Promise<Blob> => {
  const pdfMake = await loadPdfMake();
  return new Promise((resolve) => pdfMake.createPdf(buildQuotationDoc(data)).getBlob(resolve));
};
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
