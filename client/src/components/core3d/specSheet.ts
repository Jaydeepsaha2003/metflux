// The downloadable core spec sheet: a dimensioned drawing, the dimension
// table, and the weight calculation written out so it can be checked.
//
// Two formats from one drawing. PDF goes through pdfmake, the same path the
// Packing List and Testing Report already use, so the sketch stays vector and
// the text stays selectable. JPG rasterises the same SVG for anyone who wants
// to paste a picture into WhatsApp or an email.
//
// The weight line is spelled out rather than just stated. A customer querying a
// weight wants to see which factor produced it, and an operator checking a
// quote wants to know whether the 5.77 or an agreed figure was used.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { TOROIDAL_FACTOR, RECT_STACK_FACTOR, stackOr } from '@/lib/calc';
import { buildSketch } from './sketch';
import { compositeLayout, shapeCaption, type CoreShape } from './shape';

export type SheetMeta = {
  company?: string | null;
  customer?: string | null;
  grade?: string | null;
  material?: string | null;
  pcs?: number | null;
  /** Stacking factor actually used for this line. */
  factor?: number | null;
  weightPerPc?: number | null;
  totalWeight?: number | null;
};

const n = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(2));
const kg = (v: number | null | undefined) => (v == null ? '—' : `${v.toFixed(3)} kg`);

const TITLE = {
  TOROIDAL: 'Toroidal core',
  RECTANGULAR: 'Rectangular core',
  NANO: 'Nano core',
  COMPOSITE: 'Composite core (Nano + CRGO)',
} as const;

/** Rows for the dimension table, in the order an operator reads them. */
const dimensionRows = (shape: CoreShape): [string, string][] => {
  switch (shape.kind) {
    case 'TOROIDAL':
    case 'NANO':
      return [
        ['Inner diameter (ID)', `${n(shape.dims.id)} mm`],
        ['Outer diameter (OD)', `${n(shape.dims.od)} mm`],
        ['Height (HT)', `${n(shape.dims.ht)} mm`],
      ];
    case 'RECTANGULAR':
      return [
        ['Window ID 1', `${n(shape.id1)} mm`],
        ['Window ID 2', `${n(shape.id2)} mm`],
        ['Outer OD 1', `${n(shape.od1)} mm`],
        ['Outer OD 2', `${n(shape.od2)} mm`],
        ['Height (HT)', `${n(shape.ht)} mm`],
        ['Built-up', `${n((shape.od1 - shape.id1) / 2)} mm`],
      ];
    case 'COMPOSITE': {
      const { totalHt } = compositeLayout(shape.rule, shape.crgo, shape.nano);
      return [
        ['CRGO  ID / OD / HT', `${n(shape.crgo.id)} / ${n(shape.crgo.od)} / ${n(shape.crgo.ht)} mm`],
        ['Nano  ID / OD / HT', `${n(shape.nano.id)} / ${n(shape.nano.od)} / ${n(shape.nano.ht)} mm`],
        ['Join type', shape.rule.replace(/_/g, ' ').toLowerCase()],
        ['Overall height', `${n(totalHt)} mm`],
      ];
    }
  }
};

/** The weight formula, written with this line's own numbers substituted in. */
const weightWorking = (shape: CoreShape, meta: SheetMeta): string[] => {
  switch (shape.kind) {
    case 'TOROIDAL': {
      const { id, od, ht } = shape.dims;
      const fx = stackOr(meta.factor, TOROIDAL_FACTOR);
      return [
        'Weight / pc = (OD² − ID²) × HT × F × 1e-6',
        `= (${n(od)}² − ${n(id)}²) × ${n(ht)} × ${fx} × 1e-6`,
        `F = ${fx} (stacking factor${fx === TOROIDAL_FACTOR ? ', standard' : ', agreed for this customer'})`,
      ];
    }
    case 'RECTANGULAR': {
      const { id2, od2, ht } = shape;
      const sf = stackOr(meta.factor, RECT_STACK_FACTOR);
      return [
        'Core area  Ac = ((OD2 − ID2) / 2) × HT × S / 100',
        `= ((${n(od2)} − ${n(id2)}) / 2) × ${n(ht)} × ${sf} / 100`,
        'Mean length  Ml = 0.2 × (ID1 + ID2) + ((OD2 − ID2) / 20) × π',
        'Weight / pc = Ac × Ml × 7.65 / 1000',
        `S = ${sf} (stacking factor${sf === RECT_STACK_FACTOR ? ', standard' : ', agreed for this customer'})`,
      ];
    }
    case 'NANO':
      return [
        'Core weight = (OD² − ID²) × HT × 4.5559e-6',
        'Case weight = (caseOD + caseID) × HT × 3.4876e-5 + (ssOD² − ssID²) × 7.68e-6',
        'Weight / pc = core + case (case omitted for epoxy / plastic)',
      ];
    case 'COMPOSITE': {
      const fx = stackOr(meta.factor, TOROIDAL_FACTOR);
      return [
        'Weight / pc = Nano (core + case) + CRGO',
        'Nano core = (OD² − ID²) × HT × 4.5559e-6',
        `CRGO = (OD² − ID²) × HT × ${fx} × 1e-6`,
        `F = ${fx} (stacking factor for the CRGO half)`,
      ];
    }
  }
};

const fileStem = (shape: CoreShape, meta: SheetMeta) => {
  const bits = [meta.customer, TITLE[shape.kind], shapeCaption(shape)]
    .filter(Boolean)
    .join(' ')
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-');
  return bits.slice(0, 80) || 'core-spec';
};

/* ── JPG ──────────────────────────────────────────────────────── */

/**
 * Rasterise the whole sheet — drawing, tables and all — by laying it out as one
 * SVG and painting it to a canvas.
 *
 * The SVG is handed to the image decoder as a data URL rather than a blob URL:
 * a tainted canvas cannot be exported, and a same-origin blob is still enough
 * to taint it in some browsers once foreign content is involved. A data URL
 * with no external references keeps the canvas clean, which is the whole
 * requirement for toDataURL to work at all.
 */
export const downloadSheetJpg = async (shape: CoreShape, meta: SheetMeta) => {
  const W = 1400, H = 990;
  const sk = buildSketch(shape, W - 80, 430);
  const rows = dimensionRows(shape);
  const working = weightWorking(shape, meta);

  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const t = (x: number, y: number, s: string, size = 20, weight = 400, fill = '#0f172a', anchor = 'start') =>
    `<text x="${x}" y="${y}" font-family="Helvetica, Arial, sans-serif" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}">${esc(s)}</text>`;

  let y = 560;
  const body: string[] = [];
  body.push(t(40, y, 'DIMENSIONS', 15, 700, '#64748b')); y += 28;
  rows.forEach(([k, v]) => {
    body.push(t(40, y, k, 19), t(430, y, v, 19, 700));
    body.push(`<line x1="40" y1="${y + 9}" x2="660" y2="${y + 9}" stroke="#e2e8f0"/>`);
    y += 32;
  });

  let y2 = 560;
  body.push(t(720, y2, 'WEIGHT', 15, 700, '#64748b')); y2 += 28;
  [
    ['Weight / pc', kg(meta.weightPerPc)],
    ['Pieces', meta.pcs ? String(meta.pcs) : '—'],
    ['Total weight', kg(meta.totalWeight)],
  ].forEach(([k, v]) => {
    body.push(t(720, y2, k, 19), t(1110, y2, v, 19, 700));
    body.push(`<line x1="720" y1="${y2 + 9}" x2="1360" y2="${y2 + 9}" stroke="#e2e8f0"/>`);
    y2 += 32;
  });
  y2 += 12;
  body.push(t(720, y2, 'CALCULATION', 15, 700, '#64748b')); y2 += 26;
  working.forEach((line) => { body.push(t(720, y2, line, 16, 400, '#334155')); y2 += 24; });

  const header = [
    `<rect x="0" y="0" width="${W}" height="${H}" fill="#ffffff"/>`,
    `<rect x="0" y="0" width="${W}" height="6" fill="#0f172a"/>`,
    t(40, 58, meta.company || 'Core specification', 30, 700),
    t(40, 88, `${TITLE[shape.kind]} · ${shapeCaption(shape)}`, 19, 400, '#475569'),
    meta.customer ? t(1360, 58, meta.customer, 20, 700, '#0f172a', 'end') : '',
    meta.grade ? t(1360, 88, [meta.grade, meta.material].filter(Boolean).join(' · '), 17, 400, '#475569', 'end') : '',
    `<line x1="40" y1="106" x2="1360" y2="106" stroke="#cbd5e1"/>`,
  ].join('');

  const sheet =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`
    + header
    + `<g transform="translate(40,120)">${sk.svg.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '')}</g>`
    + body.join('')
    + t(40, H - 24, `Generated ${new Date().toLocaleDateString('en-IN')} · all dimensions in mm`, 15, 400, '#94a3b8')
    + `</svg>`;

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

/* ── PDF ──────────────────────────────────────────────────────── */

export const downloadSheetPdf = async (shape: CoreShape, meta: SheetMeta) => {
  const { loadPdfMake } = await import('@/lib/reportPdf');
  const pdfMake = await loadPdfMake();
  const sk = buildSketch(shape, 740, 360);
  const rows = dimensionRows(shape);

  const doc: any = {
    pageSize: 'A4',
    pageMargins: [32, 30, 32, 34],
    defaultStyle: { font: 'Montserrat', fontSize: 9, color: '#0f172a' },
    content: [
      {
        columns: [
          [
            { text: meta.company || 'Core specification', fontSize: 15, bold: true },
            { text: `${TITLE[shape.kind]} · ${shapeCaption(shape)}`, fontSize: 9, color: '#475569', margin: [0, 2, 0, 0] },
          ],
          {
            width: 'auto',
            alignment: 'right',
            stack: [
              { text: meta.customer || '', fontSize: 10, bold: true },
              { text: [meta.grade, meta.material].filter(Boolean).join(' · '), fontSize: 8, color: '#475569' },
            ],
          },
        ],
      },
      { canvas: [{ type: 'line', x1: 0, y1: 4, x2: 531, y2: 4, lineWidth: 0.7, lineColor: '#cbd5e1' }], margin: [0, 4, 0, 8] },
      // The drawing stays vector in the PDF — zoom in and the dimension text is
      // still sharp, which a rasterised sketch would not be.
      { svg: sk.svg, width: 531, margin: [0, 0, 0, 10] },
      {
        columns: [
          {
            width: '*',
            stack: [
              { text: 'DIMENSIONS', fontSize: 8, bold: true, color: '#64748b', margin: [0, 0, 0, 4] },
              {
                table: { widths: ['*', 'auto'], body: rows.map(([k, v]) => [
                  { text: k, color: '#334155' },
                  { text: v, bold: true, alignment: 'right' },
                ]) },
                layout: {
                  hLineWidth: (i: number, node: any) => (i === node.table.body.length ? 0 : 0.5),
                  vLineWidth: () => 0,
                  hLineColor: () => '#e2e8f0',
                  paddingTop: () => 3, paddingBottom: () => 3, paddingLeft: () => 0,
                },
              },
            ],
          },
          { width: 16, text: '' },
          {
            width: '*',
            stack: [
              { text: 'WEIGHT', fontSize: 8, bold: true, color: '#64748b', margin: [0, 0, 0, 4] },
              {
                table: { widths: ['*', 'auto'], body: [
                  [{ text: 'Weight / pc', color: '#334155' }, { text: kg(meta.weightPerPc), bold: true, alignment: 'right' }],
                  [{ text: 'Pieces', color: '#334155' }, { text: meta.pcs ? String(meta.pcs) : '—', bold: true, alignment: 'right' }],
                  [{ text: 'Total weight', color: '#334155' }, { text: kg(meta.totalWeight), bold: true, alignment: 'right' }],
                ] },
                layout: {
                  hLineWidth: (i: number, node: any) => (i === node.table.body.length ? 0 : 0.5),
                  vLineWidth: () => 0,
                  hLineColor: () => '#e2e8f0',
                  paddingTop: () => 3, paddingBottom: () => 3, paddingLeft: () => 0,
                },
              },
              { text: 'CALCULATION', fontSize: 8, bold: true, color: '#64748b', margin: [0, 10, 0, 4] },
              ...weightWorking(shape, meta).map((line) => ({
                text: line, fontSize: 8, color: '#334155', margin: [0, 0, 0, 2],
              })),
            ],
          },
        ],
      },
    ],
    footer: () => ({
      columns: [
        { text: `Generated ${new Date().toLocaleDateString('en-IN')}`, fontSize: 7, color: '#94a3b8', margin: [32, 0, 0, 0] },
        { text: 'All dimensions in mm', fontSize: 7, color: '#94a3b8', alignment: 'right', margin: [0, 0, 32, 0] },
      ],
    }),
  };

  pdfMake.createPdf(doc).download(`${fileStem(shape, meta)}.pdf`);
};
