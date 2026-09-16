// The downloadable core spec sheet: a dimensioned drawing, the figures behind
// every number on the order line, and the working that produced them.
//
// Two formats from one model. PDF goes through pdfmake, the same path the
// Packing List and Testing Report already use, so the drawing stays vector and
// the text stays selectable. JPG rasterises the same content for anyone who
// wants to paste a picture into WhatsApp or an email.
//
// What is ON the sheet lives in sheetModel.ts; this file only lays it out. The
// split exists because the two renderers had each grown their own idea of the
// content, which is how a figure ends up on the PDF and missing from the JPG.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { buildSketch, scaleLabel } from './sketch';
import { buildSheetModel, fileStem, type SheetMeta, type Section } from './sheetModel';
import type { CoreShape } from './shape';

export type { SheetMeta } from './sheetModel';

const stamp = () => new Date().toLocaleDateString('en-IN', {
  day: '2-digit', month: 'short', year: 'numeric',
});

/* ── JPG ──────────────────────────────────────────────────────────────────
   Laid out by hand into an SVG and painted to a canvas. The sheet grows to fit
   what is on it rather than being a fixed height — a toroid quoted on weight
   alone is half the sheet of a gap core with a full test block, and a fixed
   canvas either crops the second or leaves the first mostly blank. */

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const T = (
  x: number, y: number, s: string, size = 19,
  { weight = 400, fill = '#0f172a', anchor = 'start' } = {},
) =>
  `<text x="${x}" y="${y}" font-family="Helvetica, Arial, sans-serif" font-size="${size}"`
  + ` font-weight="${weight}" fill="${fill}" text-anchor="${anchor}">${esc(s)}</text>`;

const HEAD_H = 30;      // section heading band
const ROW_H = 30;       // one key/value row
const LINE_H = 23;      // one working line
const SEC_GAP = 26;     // between sections in a column

/* Rough advance width for Helvetica at a given size. Good enough to decide
   where to break — the alternative is measuring text in a canvas, which means
   a second rendering pass for the sake of a line break. */
const widthOf = (str: string, size: number, bold = false) =>
  str.length * size * (bold ? 0.55 : 0.5);

/** Greedy word wrap to a pixel width. */
const wrap = (str: string, size: number, w: number): string[] => {
  const words = str.split(' ');
  const out: string[] = [];
  let cur = '';
  words.forEach((word) => {
    const next = cur ? `${cur} ${word}` : word;
    if (cur && widthOf(next, size) > w) { out.push(cur); cur = word; } else { cur = next; }
  });
  if (cur) out.push(cur);
  return out;
};

const drawSection = (sec: Section, x: number, y: number, w: number): [string, number] => {
  const out: string[] = [T(x, y, sec.heading.toUpperCase(), 15, { weight: 700, fill: '#64748b' })];
  out.push(`<line x1="${x}" y1="${y + 9}" x2="${x + w}" y2="${y + 9}" stroke="#0f172a" stroke-width="1.1"/>`);
  let cy = y + HEAD_H;

  (sec.rows ?? []).forEach(([k, v]) => {
    // A long value drops to its own line rather than being written through the
    // key. "Construction: 2 mating halves — 1 pc = 1 complete core" is a real
    // row on a real sheet, and side by side the two overprinted each other.
    const twoLine = widthOf(k, 18) + widthOf(v, 18, true) + 16 > w;
    out.push(T(x, cy, k, 18, { fill: '#334155' }));
    if (twoLine) {
      cy += 22;
      wrap(v, 18, w).forEach((l, i) => {
        if (i) cy += 22;
        out.push(T(x + w, cy, l, 18, { weight: 700, anchor: 'end' }));
      });
    } else {
      out.push(T(x + w, cy, v, 18, { weight: 700, anchor: 'end' }));
    }
    out.push(`<line x1="${x}" y1="${cy + 9}" x2="${x + w}" y2="${cy + 9}" stroke="#e2e8f0"/>`);
    cy += ROW_H;
  });

  if (sec.table) {
    const cols = sec.table.head.length;
    const colW = w / cols;
    // Right-aligned but for the first column: these are all numbers, and
    // numbers that do not line up at the decimal point are numbers nobody
    // checks.
    const at = (i: number) => (i === 0 ? x + 4 : x + colW * (i + 1) - 4);
    const anchor = (i: number) => (i === 0 ? 'start' : 'end');

    cy += 12;
    out.push(`<rect x="${x}" y="${cy - 14}" width="${w}" height="26" fill="#f1f5f9"/>`);
    sec.table.head.forEach((h, i) => {
      out.push(T(at(i), cy, h.toUpperCase(), 14, { weight: 700, fill: '#475569', anchor: anchor(i) }));
    });
    cy += 24;
    sec.table.rows.forEach((row) => {
      row.forEach((v, i) => {
        out.push(T(at(i), cy, v, 18, { weight: i === 0 ? 700 : 400, anchor: anchor(i) }));
      });
      out.push(`<line x1="${x}" y1="${cy + 9}" x2="${x + w}" y2="${cy + 9}" stroke="#e2e8f0"/>`);
      cy += ROW_H;
    });
  }

  if (sec.lines?.length) {
    cy += 10;
    sec.lines.forEach((l) => {
      wrap(l, 15.5, w).forEach((part) => {
        out.push(T(x, cy, part, 15.5, { fill: '#475569' }));
        cy += LINE_H;
      });
    });
  }
  return [out.join(''), cy];
};

export const downloadSheetJpg = async (shape: CoreShape, meta: SheetMeta) => {
  const W = 1400;
  const M = 44;                                     // sheet margin
  const model = buildSheetModel(shape, meta);
  const sk = buildSketch(shape, W - M * 2, 430);

  // Notes ride along as one more section, so the packing below balances them
  // with everything else instead of leaving a ragged block at the bottom.
  const sections: Section[] = [...model.sections, { heading: 'Notes', lines: model.notes }];

  /* Three columns, filled across rather than down: Product · Dimensions ·
     Geometry on the first line, Weight · Magnetic test · Notes on the second.
     Dropping each section into whichever column was shortest balanced the page
     better and scrambled the reading order, which on a document someone checks
     a figure against is the thing that actually matters. */
  const COLS = 3;
  const colW = (W - M * 2 - 40 * (COLS - 1)) / COLS;
  const colX = Array.from({ length: COLS }, (_, i) => M + i * (colW + 40));
  const top = 150 + sk.height + 34;
  const colY = Array.from({ length: COLS }, () => top);
  const body: string[] = [];

  sections.forEach((sec, idx) => {
    const i = idx % COLS;
    // Keep a section's working with its rows: never split one across columns.
    const [svg, end] = drawSection(sec, colX[i], colY[i], colW);
    body.push(svg);
    colY[i] = end + SEC_GAP;
  });

  const bodyBottom = Math.max(...colY);

  /* Title block, as a drawing has one: who, when, at what scale, in what
     units. Without it the sheet is a picture; with it, it is a document. */
  const tbH = 62;
  const tbY = bodyBottom + 10;
  const cells: [string, string][] = [
    ['COMPANY', meta.company || '—'],
    ['CUSTOMER', meta.customer || '—'],
    ['ORDER', meta.orderNo || '—'],
    // A raster has no physical size, so there is no honest ratio to print.
    ['SCALE', 'NTS'],
    ['UNITS', 'mm'],
    ['DATE', stamp()],
  ];
  const cw = (W - M * 2) / cells.length;
  const tb: string[] = [
    `<rect x="${M}" y="${tbY}" width="${W - M * 2}" height="${tbH}" fill="#f8fafc" stroke="#0f172a" stroke-width="1.1"/>`,
  ];
  cells.forEach(([k, v], i) => {
    const x = M + i * cw;
    if (i > 0) tb.push(`<line x1="${x}" y1="${tbY}" x2="${x}" y2="${tbY + tbH}" stroke="#cbd5e1"/>`);
    tb.push(
      T(x + 12, tbY + 22, k, 13, { weight: 700, fill: '#64748b' }),
      T(x + 12, tbY + 45, v.length > 26 ? `${v.slice(0, 25)}…` : v, 17, { weight: 700 }),
    );
  });

  const H = Math.ceil(tbY + tbH + M);

  const header = [
    `<rect x="0" y="0" width="${W}" height="${H}" fill="#ffffff"/>`,
    `<rect x="0" y="0" width="${W}" height="7" fill="#0f172a"/>`,
    T(M, 62, meta.company || 'Core specification', 30, { weight: 700 }),
    T(M, 94, `${model.title} · ${model.subtitle}`, 19, { fill: '#475569' }),
    meta.customer ? T(W - M, 62, meta.customer, 21, { weight: 700, anchor: 'end' }) : '',
    T(W - M, 94, [meta.grade, meta.material].filter(Boolean).join(' · '), 17,
      { fill: '#475569', anchor: 'end' }),
    `<line x1="${M}" y1="112" x2="${W - M}" y2="112" stroke="#cbd5e1"/>`,
    `<rect x="${M}" y="140" width="${W - M * 2}" height="${sk.height + 10}" fill="#ffffff" stroke="#e2e8f0"/>`,
  ].join('');

  const sheet =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`
    + header
    + `<g transform="translate(${M},145)">${sk.svg.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '')}</g>`
    + body.join('')
    + tb.join('')
    + `</svg>`;

  /* The SVG goes to the decoder as a data URL rather than a blob URL: a tainted
     canvas cannot be exported, and a same-origin blob is still enough to taint
     it in some browsers once foreign content is involved. */
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(sheet)}`;
  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('Could not render the sketch'));
    img.src = url;
  });

  const canvas = document.createElement('canvas');
  canvas.width = W * 2;                       // 2x for a crisp raster
  canvas.height = H * 2;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff';                  // JPEG has no alpha; fill first
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  const a = document.createElement('a');
  a.href = canvas.toDataURL('image/jpeg', 0.92);
  a.download = `${fileStem(shape, meta)}.jpg`;
  a.click();
};

/* ── PDF ─────────────────────────────────────────────────────────────────── */

const PAGE_W = 531;      // A4 less the margins below

const pdfSection = (sec: Section): any[] => {
  const out: any[] = [
    { text: sec.heading.toUpperCase(), fontSize: 8, bold: true, color: '#64748b', margin: [0, 0, 0, 1] },
    { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 250, y2: 0, lineWidth: 0.8, lineColor: '#0f172a' }], margin: [0, 0, 0, 4] },
  ];
  if (sec.rows?.length) {
    out.push({
      table: {
        widths: ['*', 'auto'],
        body: sec.rows.map(([k, v]) => [
          { text: k, color: '#334155' },
          { text: v, bold: true, alignment: 'right' },
        ]),
      },
      layout: {
        hLineWidth: (i: number, node: any) => (i === node.table.body.length ? 0 : 0.5),
        vLineWidth: () => 0,
        hLineColor: () => '#e2e8f0',
        paddingTop: () => 1.8, paddingBottom: () => 1.8, paddingLeft: () => 0, paddingRight: () => 0,
      },
    });
  }
  if (sec.table) {
    out.push({
      table: {
        headerRows: 1,
        widths: sec.table.head.map((_, i) => (i === 0 ? 'auto' : '*')),
        body: [
          sec.table.head.map((h, i) => ({
            text: h.toUpperCase(), fontSize: 6.5, bold: true, color: '#475569',
            alignment: i === 0 ? 'left' : 'right',
          })),
          ...sec.table.rows.map((row) => row.map((v, i) => ({
            text: v, bold: i === 0, alignment: i === 0 ? 'left' : 'right',
          }))),
        ],
      },
      layout: {
        hLineWidth: (i: number, node: any) => (i === 1 ? 0.8 : i === node.table.body.length ? 0 : 0.5),
        vLineWidth: () => 0,
        hLineColor: (i: number) => (i === 1 ? '#0f172a' : '#e2e8f0'),
        fillColor: (i: number) => (i === 0 ? '#f1f5f9' : null),
        paddingTop: () => 2.5, paddingBottom: () => 2.5, paddingLeft: () => 3, paddingRight: () => 3,
      },
      margin: [0, 5, 0, 0],
    });
  }

  if (sec.lines?.length) {
    out.push(...sec.lines.map((l, i) => ({
      text: l, fontSize: 7.5, color: '#475569', margin: [0, i === 0 ? 4 : 0, 0, 1],
    })));
  }
  // A zero-height spacer: an empty text node still takes a full line, which
  // across six sections was most of the overflow onto a second page.
  out.push({ text: '', fontSize: 1, margin: [0, 0, 0, 7] });
  return out;
};

export const downloadSheetPdf = async (shape: CoreShape, meta: SheetMeta) => {
  const { loadPdfMake } = await import('@/lib/reportPdf');
  const pdfMake = await loadPdfMake();
  const model = buildSheetModel(shape, meta);
  // Sized so the whole sheet lands on one page. A spec sheet that runs to two
  // pages with a title block alone on the second is a sheet somebody prints,
  // staples and loses half of.
  const sk = buildSketch(shape, PAGE_W, 198);

  /* Two columns, filled across, so the sheet reads in the same order as the
     JPG: Product · Dimensions, then Geometry · Weight, then Magnetic · Notes. */
  const sections: Section[] = [...model.sections, { heading: 'Notes', lines: model.notes }];
  const colA = sections.filter((_, i) => i % 2 === 0);
  const colB = sections.filter((_, i) => i % 2 === 1);

  const titleBlock: [string, string][] = [
    ['COMPANY', meta.company || '—'],
    ['CUSTOMER', meta.customer || '—'],
    ['ORDER', meta.orderNo || '—'],
    // One drawing unit is one point, stretched by however much pdfmake had to
    // squeeze the SVG into the column; 25.4/72 turns the result into
    // millimetres on the printed page.
    ['SCALE', scaleLabel(sk.unitsPerMm, (25.4 / 72) * ((PAGE_W - 8) / sk.width))],
    ['UNITS', 'mm'],
    ['DATE', stamp()],
  ];

  const doc: any = {
    pageSize: 'A4',
    pageMargins: [32, 30, 32, 40],
    defaultStyle: { font: 'Montserrat', fontSize: 8.5, color: '#0f172a' },
    content: [
      {
        columns: [
          [
            { text: meta.company || 'Core specification', fontSize: 15, bold: true },
            { text: `${model.title} · ${model.subtitle}`, fontSize: 9, color: '#475569', margin: [0, 2, 0, 0] },
          ],
          {
            width: 'auto',
            alignment: 'right',
            stack: [
              { text: meta.customer || '', fontSize: 10, bold: true },
              { text: [meta.grade, meta.material].filter(Boolean).join(' · '), fontSize: 8, color: '#475569' },
              meta.orderNo ? { text: meta.orderNo, fontSize: 8, color: '#475569' } : { text: '' },
            ],
          },
        ],
      },
      { canvas: [{ type: 'line', x1: 0, y1: 4, x2: PAGE_W, y2: 4, lineWidth: 0.7, lineColor: '#cbd5e1' }], margin: [0, 4, 0, 6] },
      // The drawing stays vector in the PDF — zoom in and the dimension text is
      // still sharp, which a rasterised sketch would not be.
      {
        table: { widths: [PAGE_W - 2], body: [[{ svg: sk.svg, width: PAGE_W - 8, margin: [3, 3, 3, 3] }]] },
        layout: {
          hLineWidth: () => 0.5, vLineWidth: () => 0.5,
          hLineColor: () => '#e2e8f0', vLineColor: () => '#e2e8f0',
          paddingTop: () => 0, paddingBottom: () => 0, paddingLeft: () => 0, paddingRight: () => 0,
        },
        margin: [0, 0, 0, 10],
      },
      {
        columns: [
          { width: '*', stack: colA.flatMap(pdfSection) },
          { width: 18, text: '' },
          { width: '*', stack: colB.flatMap(pdfSection) },
        ],
      },
      {
        table: {
          widths: titleBlock.map(() => '*'),
          body: [
            titleBlock.map(([k]) => ({ text: k, fontSize: 6.5, bold: true, color: '#64748b' })),
            titleBlock.map(([, v]) => ({ text: v, fontSize: 8.5, bold: true })),
          ],
        },
        layout: {
          hLineWidth: (i: number, node: any) => (i === 0 || i === node.table.body.length ? 0.8 : 0),
          vLineWidth: () => 0.5,
          hLineColor: () => '#0f172a', vLineColor: () => '#cbd5e1',
          paddingTop: (i: number) => (i === 0 ? 4 : 0), paddingBottom: (i: number) => (i === 0 ? 1 : 4),
          paddingLeft: () => 5, paddingRight: () => 5,
          fillColor: () => '#f8fafc',
        },
        margin: [0, 6, 0, 0],
      },
    ],
    footer: (page: number, total: number) => ({
      columns: [
        { text: `${model.title} · ${model.subtitle}`, fontSize: 7, color: '#94a3b8', margin: [32, 0, 0, 0] },
        { text: `Sheet ${page} of ${total}`, fontSize: 7, color: '#94a3b8', alignment: 'right', margin: [0, 0, 32, 0] },
      ],
    }),
  };

  pdfMake.createPdf(doc).download(`${fileStem(shape, meta)}.pdf`);
};
