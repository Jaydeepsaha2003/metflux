// The Testing Calculator's lab sheet as a real vector PDF.
//
// The first version captured an offscreen DOM with html2pdf, which rasterises
// the page to a JPEG: blurry digits on a sheet people read from a bench, no
// selectable text, and a heavy file. This builds the document with pdfmake, the
// same path the Packing List and Testing Report already use, so the figures stay
// sharp at any zoom and take the company's brand colour.
//
// One size per landscape A4 page, so a sheet can be pulled out and clipped to
// the core it describes.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { brandShadeHex } from '@/lib/brandColor';
import { loadPdfMake, type PdfCompany } from '@/lib/reportPdf';

export type CalcPdfRow = { flux: string; volt: string; mv: string; ieA: string; ie: string };
export type CalcPdfSize = {
  core: string;
  measure: string;
  /** Label / value pairs for the specification card. */
  spec: [string, string][];
  rows: CalcPdfRow[];
};
export type CalcPdf = {
  company: PdfCompany;
  brand: string | null;
  date: string;
  sizes: CalcPdfSize[];
  filename: string;
};

const INK = '#0f172a';
const GREY = '#64748b';
const LIGHT = '#e2e8f0';
const WHITE = '#ffffff';

const buildDoc = (d: CalcPdf) => {
  const dark = brandShadeHex(d.brand, 700);
  const mid = brandShadeHex(d.brand, 600);
  const tint = brandShadeHex(d.brand, 50);
  const c = d.company;
  const total = d.sizes.length;

  const letterhead = () => {
    const lines: any[] = [{ text: c.name || 'Company Name', bold: true, fontSize: 17, color: dark }];
    const addr = c.address?.replace(/\n+/g, ', ').trim();
    if (addr) lines.push({ text: addr, fontSize: 8.5, color: GREY, margin: [0, 2, 0, 0] });
    const contact = [c.phone, c.whatsappNumber, c.email].filter(Boolean).join('   |   ');
    if (contact) lines.push({ text: contact, fontSize: 8.5, color: GREY, margin: [0, 1, 0, 0] });
    if (c.gstNumber) lines.push({ text: `GSTIN  ${c.gstNumber}`, fontSize: 8.5, color: GREY, margin: [0, 1, 0, 0] });
    return {
      columns: [
        ...(c.logoUrl ? [{ image: c.logoUrl, width: 44, fit: [44, 44], margin: [0, 0, 10, 0] }] : []),
        { width: '*', stack: lines },
        {
          width: 'auto',
          table: { body: [[{ text: 'TESTING REPORT', color: WHITE, bold: true, fontSize: 14, characterSpacing: 1.6, fillColor: dark, margin: [18, 8, 18, 8], noWrap: true }]] },
          layout: 'noBorders',
        },
      ],
      columnGap: 4,
    };
  };

  // Both of these are functions, not constants: pdfmake writes layout positions
  // onto the nodes it is given, so an object reused on page 2 dragged page 1's
  // rule and signature lines to wherever page 2 had put them.
  const rule = () => ({
    canvas: [{ type: 'line', x1: 0, y1: 0, x2: 782, y2: 0, lineWidth: 1.6, lineColor: dark }],
    margin: [0, 8, 0, 10],
  });

  const specCard = (spec: [string, string][]) => {
    // Up to 4 across; each is a small caption over a bold value.
    const per = 4;
    const body: any[] = [];
    for (let i = 0; i < spec.length; i += per) {
      const row = spec.slice(i, i + per);
      while (row.length < per) row.push(['', '']);
      body.push(row.map(([k, v]) => ({
        stack: [
          { text: k.toUpperCase(), fontSize: 7, bold: true, color: GREY, characterSpacing: 0.6 },
          { text: k ? (v || '—') : '', fontSize: 13, bold: true, color: INK, margin: [0, 2, 0, 0] },
        ],
        margin: [10, 7, 10, 7],
      })));
    }
    return {
      table: { widths: Array(per).fill('*'), body },
      layout: {
        fillColor: () => tint,
        hLineWidth: (i: number) => (i === 0 || i === body.length ? 0 : 0.6),
        vLineWidth: (i: number) => (i === 0 || i === per ? 0 : 0.6),
        hLineColor: () => WHITE, vLineColor: () => WHITE,
      },
      margin: [0, 0, 0, 12],
    };
  };

  const resultsTable = (rows: CalcPdfRow[]) => {
    const th = (t: string, a: 'left' | 'right' = 'right') => ({
      text: t, bold: true, fontSize: 8.5, color: WHITE, fillColor: mid, alignment: a, margin: [8, 6, 8, 6], characterSpacing: 0.4,
    });
    const td = (t: string, o: any = {}) => ({ text: t, fontSize: 11, alignment: 'right', margin: [8, 5, 8, 5], ...o });
    return {
      table: {
        headerRows: 1,
        widths: [90, '*', '*', '*', '*'],
        body: [
          [th('FLUX (T)', 'left'), th('VOLT (V)'), th('V (mV)'), th('Ie MAX (A)'), th('Ie MAX (mA)')],
          ...rows.map((r) => [
            td(r.flux, { alignment: 'left', bold: true, color: dark }),
            td(r.volt, { bold: true }),
            td(r.mv),
            td(r.ieA),
            // The figure the bench actually works to, so it is picked out.
            td(r.ie, { bold: true, fillColor: tint, color: dark }),
          ]),
        ],
      },
      layout: {
        hLineWidth: (i: number, n: any) => (i === 0 || i === n.table.body.length ? 0 : 0.5),
        vLineWidth: () => 0,
        hLineColor: () => LIGHT,
        fillColor: (i: number) => (i > 0 && i % 2 === 0 ? '#f8fafc' : null),
      },
    };
  };

  const signoff = () => ({
    columns: ['Tested by', 'Checked by', 'Approved by'].map((t) => ({
      width: '*',
      stack: [
        { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 200, y2: 0, lineWidth: 0.6, lineColor: GREY }], margin: [0, 26, 0, 3] },
        { text: t, fontSize: 8, color: GREY },
      ],
    })),
    columnGap: 30,
    margin: [0, 22, 0, 0],
  });

  const content: any[] = [];
  d.sizes.forEach((s, i) => {
    content.push(
      { stack: [
        letterhead(),
        rule(),
        {
          columns: [
            { text: [{ text: s.core, bold: true, color: dark }, { text: '   ·   ', color: LIGHT }, { text: s.measure, bold: true }], fontSize: 12 },
            { text: `Size ${i + 1} of ${total}   ·   ${d.date}`, fontSize: 9, color: GREY, alignment: 'right' },
          ],
          margin: [0, 0, 0, 8],
        },
        specCard(s.spec),
        resultsTable(s.rows),
        signoff(),
      ], ...(i > 0 ? { pageBreak: 'before' } : {}) },
    );
  });

  return {
    pageSize: 'A4',
    pageOrientation: 'landscape',
    pageMargins: [30, 28, 30, 38],
    defaultStyle: { font: 'Montserrat', fontSize: 10, color: INK },
    content,
    footer: (page: number, pages: number) => ({
      columns: [
        { text: 'Calculated values for test planning. Verify against calibrated instruments.', fontSize: 7, color: GREY, margin: [30, 0, 0, 0] },
        { text: `Page ${page} of ${pages}`, fontSize: 7, color: GREY, alignment: 'right', margin: [0, 0, 30, 0] },
      ],
    }),
  };
};

export const downloadTestingCalcPdf = async (d: CalcPdf) => {
  const pdfMake = await loadPdfMake();
  pdfMake.createPdf(buildDoc(d)).download(d.filename);
};
