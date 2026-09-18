// The wound-core drawing set: exactly two A4 landscape sheets.
//
//   Sheet 1  GENERAL ARRANGEMENT — plan, section A-A, notes, signatures, and a
//            data column carrying material, physical spec and magnetics.
//   Sheet 2  VIEWS AND DETAIL — front and end elevations, the wound-strip
//            detail B, a pictorial, revision history, and a data column
//            carrying winding data, tolerances, finish and the remaining notes.
//
// Both sheets are emitted as one full-page SVG each, drawn in PDF points, and
// handed to pdfmake whole. That is deliberate: this is a draughted sheet, not a
// flowed document — every rule, dimension and title block sits at a coordinate
// somebody chose — and expressing it as pdfmake tables would mean fighting a
// layout engine for control it is designed not to give up.
//
// Coordinates are written origin-bottom-left, the way a drawing office and
// every CAD package counts, and flipped once on the way out by `fy`. Writing
// them SVG-style (y downwards) meant every vertical offset in the file read
// backwards from the dimension it was describing.
//
// Nothing here rasterises: the text stays selectable and the geometry stays
// vector, so a printed sheet is as sharp as the printer and a zoomed screen
// copy is sharper still.
import { woundCoreCalc } from '@/lib/calc';
import { materialOf, type MaterialKey } from '@/lib/coreMaterials';
import type { CoreShape } from './shape';
import type { SheetMeta } from './sheetModel';

export type WoundShape = Extract<CoreShape, { kind: 'WOUND_CORE' }>;

/* ── page and grid ────────────────────────────────────────────────────────
   A4 landscape in points, and the frame the whole set is hung on. These are
   the reference sheet's own figures; changing one moves both sheets together,
   which is the point of naming them. */
const PT_PER_MM = 72 / 25.4;
const W = 841.89;
const H = 595.28;

const M_OUT = 16;        // heavy outer frame
const M_IN = 21;         // light inner frame
const COL_X = 586;       // the data column's left edge
const COL_W = 240;
const L0 = 34;           // drawing region, left
const L1 = 572;          // drawing region, right
const ROW_H = 12.5;      // data row pitch
const HEAD_H = 13;       // block header bar height

/* ── palette ──────────────────────────────────────────────────────────── */
const INK = '#1E2A33';
const RULE = '#C8C4B8';
const ACCENT = '#9A6410';
const SUB = '#5E6B73';
const HID = '#93A1AA';
const MAT = '#F3F1EA';
const MAT_D = '#E2DFD4';
const DARK = '#3A3936';
const HEAD_BG = '#F0EDE4';
const WHITE = '#ffffff';
const HATCH_INK = '#A9A396';
const WRAP_INK = '#B8B2A4';
const CENTRE_INK = '#8FA0AA';

/* Nominal strip thickness by alloy, millimetres. Not a shape dimension — it is
   what the mill delivered — so it is a stated nominal here and the wrap count
   derived from it carries a note saying so. Weight does not depend on it: the
   same steel wound from thinner strip is more wraps of the same total build. */
const STRIP_T: Record<MaterialKey, number> = {
  CRGO: 0.27,
  NANOCRYSTALLINE: 0.025,
  AMORPHOUS: 0.025,
};

/* ── small helpers ────────────────────────────────────────────────────── */
const esc = (s: string) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const f = (v: number) => (Math.round(v * 1000) / 1000).toString();
const n2 = (v: number) => (Number.isFinite(v) ? v.toFixed(2) : '—');

/** Flip a bottom-left y into SVG's top-left space. Applied once, on emit. */
const fy = (y: number) => H - y;

/* Drawing scales, largest first. A generator cannot hardcode 1.5:1 the way a
   single hand-drawn sheet can: the same core family runs from a 30 mm CT core
   to a 400 mm distribution core, and one fixed scale either shrinks the first
   to a dot or runs the second off the paper. */
const SCALES: { ratio: number; label: string }[] = [
  { ratio: 20, label: '20:1' }, { ratio: 10, label: '10:1' },
  { ratio: 5, label: '5:1' }, { ratio: 2, label: '2:1' },
  { ratio: 1.5, label: '1.5:1' }, { ratio: 1, label: '1:1' },
  { ratio: 0.5, label: '1:2' }, { ratio: 0.4, label: '1:2.5' },
  { ratio: 0.2, label: '1:5' }, { ratio: 0.1, label: '1:10' },
  { ratio: 0.05, label: '1:20' }, { ratio: 0.02, label: '1:50' },
];

/** The largest standard scale at which `needW × needH` mm still fits the box. */
const pickScale = (needW: number, needH: number, boxW: number, boxH: number) => {
  const fit = SCALES.find(({ ratio }) =>
    needW * ratio * PT_PER_MM <= boxW && needH * ratio * PT_PER_MM <= boxH);
  return fit ?? SCALES[SCALES.length - 1];
};

/* ── the pen ──────────────────────────────────────────────────────────────
   One object collecting SVG fragments, with a method per draughting idiom.
   Everything takes bottom-left coordinates. */
class Pen {
  private out: string[] = [];

  svg(): string {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${f(W)}" height="${f(H)}"`
      + ` viewBox="0 0 ${f(W)} ${f(H)}">`
      + `<rect x="0" y="0" width="${f(W)}" height="${f(H)}" fill="${WHITE}"/>`
      + this.out.join('') + '</svg>';
  }

  line(x0: number, y0: number, x1: number, y1: number,
       stroke = INK, w = 0.5, dash = '') {
    this.out.push(`<line x1="${f(x0)}" y1="${f(fy(y0))}" x2="${f(x1)}" y2="${f(fy(y1))}"`
      + ` stroke="${stroke}" stroke-width="${f(w)}"`
      + (dash ? ` stroke-dasharray="${dash}"` : '') + '/>');
  }

  rect(x: number, y: number, w: number, h: number,
       { fill = '', stroke = '', lw = 0.5, r = 0, dash = '' } = {}) {
    this.out.push(`<rect x="${f(x)}" y="${f(fy(y + h))}" width="${f(w)}" height="${f(h)}"`
      + (r ? ` rx="${f(r)}" ry="${f(r)}"` : '')
      + ` fill="${fill || 'none'}"`
      + (stroke ? ` stroke="${stroke}" stroke-width="${f(lw)}"` : '')
      + (dash ? ` stroke-dasharray="${dash}"` : '') + '/>');
  }

  circle(x: number, y: number, r: number,
         { fill = '', stroke = INK, lw = 0.5, dash = '' } = {}) {
    this.out.push(`<circle cx="${f(x)}" cy="${f(fy(y))}" r="${f(r)}"`
      + ` fill="${fill || 'none'}" stroke="${stroke}" stroke-width="${f(lw)}"`
      + (dash ? ` stroke-dasharray="${dash}"` : '') + '/>');
  }

  /** Closed polygon from bottom-left points. */
  poly(pts: [number, number][], { fill = '', stroke = '', lw = 0.8, close = true } = {}) {
    if (!pts.length) return;
    const d = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${f(x)} ${f(fy(y))}`).join(' ')
      + (close ? ' Z' : '');
    this.out.push(`<path d="${d}" fill="${fill || 'none'}"`
      + (stroke ? ` stroke="${stroke}" stroke-width="${f(lw)}"` : '')
      + ' stroke-linejoin="round"/>');
  }

  /** Baseline text, exactly as a drawString places it. */
  text(x: number, y: number, s: string, size: number,
       { fill = INK, bold = false, anchor = 'start', rotate = 0 } = {}) {
    const body = `font-size="${f(size)}" font-weight="${bold ? 700 : 400}"`
      + ` fill="${fill}" text-anchor="${anchor}">${esc(s)}</text>`;
    if (rotate) {
      // Running bottom-to-top on the page is a -90 turn once y points down.
      this.out.push(`<text transform="translate(${f(x)} ${f(fy(y))}) rotate(${-rotate})"`
        + ` x="0" y="0" ${body}`);
    } else {
      this.out.push(`<text x="${f(x)}" y="${f(fy(y))}" ${body}`);
    }
  }

  /** Solid arrow head at (x,y) pointing along `ang` (radians, CCW from +x). */
  arrow(x: number, y: number, ang: number, size = 6.5, col = INK) {
    const w = size * 0.32;
    const dx = Math.cos(ang); const dy = Math.sin(ang);
    const px = -dy; const py = dx;
    this.poly([
      [x, y],
      [x + dx * size + px * w, y + dy * size + py * w],
      [x + dx * size - px * w, y + dy * size - py * w],
    ], { fill: col });
  }

  /** Thin witness line from the feature out to the dimension line. */
  ext(x0: number, y0: number, x1: number, y1: number) {
    this.line(x0, y0, x1, y1, RULE, 0.4);
  }

  dimH(x1: number, x2: number, y: number, label: string, tickFrom?: number) {
    if (tickFrom !== undefined) {
      const d = y > tickFrom ? 6 : -6;
      this.ext(x1, tickFrom, x1, y + d);
      this.ext(x2, tickFrom, x2, y + d);
    }
    this.line(x1, y, x2, y, INK, 0.5);
    this.arrow(x1, y, 0);
    this.arrow(x2, y, Math.PI);
    this.text((x1 + x2) / 2, y + 3.5, label, 7, { anchor: 'middle' });
  }

  dimV(y1: number, y2: number, x: number, label: string, tickFrom?: number) {
    if (tickFrom !== undefined) {
      const d = x > tickFrom ? 6 : -6;
      this.ext(tickFrom, y1, x + d, y1);
      this.ext(tickFrom, y2, x + d, y2);
    }
    this.line(x, y1, x, y2, INK, 0.5);
    this.arrow(x, y1, Math.PI / 2);
    this.arrow(x, y2, -Math.PI / 2);
    this.text(x - 3.5, (y1 + y2) / 2, label, 7, { anchor: 'middle', rotate: 90 });
  }

  centreLine(x0: number, y0: number, x1: number, y1: number) {
    this.line(x0, y0, x1, y1, CENTRE_INK, 0.4, '7,2.5,1.2,2.5');
  }

  hidden(x0: number, y0: number, x1: number, y1: number) {
    this.line(x0, y0, x1, y1, HID, 0.6, '4,2.5');
  }

  /** 45° section hatching, as explicit clipped segments — pdfmake's SVG reader
      drops <pattern> without a word, so a patterned section prints blank. */
  hatch(x: number, y: number, w: number, h: number, step = 6) {
    const id = `h${Math.round(x * 7 + y * 13 + w * 3 + h)}`;
    this.out.push(`<clipPath id="${id}"><rect x="${f(x)}" y="${f(fy(y + h))}"`
      + ` width="${f(w)}" height="${f(h)}"/></clipPath>`
      + `<g clip-path="url(#${id})">`);
    for (let xx = x - h; xx < x + w + h; xx += step) {
      this.line(xx, y, xx + h, y + h, HATCH_INK, 0.45);
    }
    this.out.push('</g>');
  }

  viewLabel(cx: number, y: number, name: string, scale: string) {
    this.text(cx, y, name, 8.5, { bold: true, anchor: 'middle' });
    this.text(cx, y - 11, scale, 6.8, { fill: SUB, anchor: 'middle' });
  }
}

/* ── data-column blocks ───────────────────────────────────────────────── */

/** Header bar whose TOP sits at y. Returns the baseline for the first row. */
const head = (p: Pen, x: number, y: number, w: number, label: string) => {
  p.rect(x, y - HEAD_H, w, HEAD_H, { fill: HEAD_BG });
  p.line(x, y - HEAD_H, x + w, y - HEAD_H, RULE, 0.5);
  p.line(x, y, x + w, y, RULE, 0.5);
  p.text(x + 7, y - HEAD_H + 4.3, label, 6.5, { bold: true, fill: ACCENT });
  return y - HEAD_H - 14;
};

const kv = (p: Pen, x: number, y: number, w: number,
            key: string, val: string, bold = false) => {
  p.text(x + 7, y, key, 6.6, { fill: SUB });
  p.text(x + w - 7, y, val, 7.4, { bold, anchor: 'end' });
  return y - ROW_H;
};

/** Description · symbol · value · tolerance. */
const spec = (p: Pen, x: number, y: number, w: number,
              desc: string, sym: string, val: string, tol: string) => {
  p.text(x + 7, y, desc, 6.6, { fill: SUB });
  p.text(x + w - 96, y, sym, 7, { bold: true, fill: ACCENT, anchor: 'middle' });
  p.text(x + w - 46, y, val, 7.4, { bold: true, anchor: 'end' });
  p.text(x + w - 7, y, tol, 6.6, { fill: SUB, anchor: 'end' });
  return y - ROW_H;
};

const specCols = (p: Pen, x: number, y: number, w: number) => {
  p.text(x + w - 96, y, 'SYM', 5.6, { fill: HID, anchor: 'middle' });
  p.text(x + w - 46, y, 'mm', 5.6, { fill: HID, anchor: 'end' });
  p.text(x + w - 7, y, 'TOL', 5.6, { fill: HID, anchor: 'end' });
  return y - 9.5;
};

/* ── sheet chrome ─────────────────────────────────────────────────────── */

const frame = (p: Pen) => {
  p.rect(M_OUT, M_OUT, W - 2 * M_OUT, H - 2 * M_OUT, { stroke: INK, lw: 1.1 });
  p.rect(M_IN, M_IN, W - 2 * M_IN, H - 2 * M_IN, { stroke: RULE, lw: 0.5 });
  p.line(COL_X, M_OUT, COL_X, H - M_OUT, INK, 0.8);
};

const sheetHeader = (p: Pen, title: string, sub: string) => {
  p.rect(M_IN, H - 56, COL_X - M_IN, 3, { fill: ACCENT });
  p.text(L0, H - 47, title, 12.5, { bold: true });
  // Montserrat is wider than the Helvetica this layout was drawn in, so the
  // subtitle is placed from a measured advance rather than a fixed offset.
  p.text(L0 + title.length * 12.5 * 0.62 + 10, H - 47, sub, 9, { fill: SUB });
};

const companyBlock = (p: Pen, company: string, sheetNo: number, total = 2) => {
  p.rect(COL_X, H - 62, COL_W, 46, { fill: INK });
  const words = company.split(' ');
  const name = words[0] ?? '';
  const rest = words.slice(1).join(' ');
  p.text(COL_X + 12, H - 34, name, 10.5, { bold: true, fill: WHITE });
  p.text(COL_X + 12, H - 45, rest, 7.2, { fill: '#B9C4CB' });
  p.text(COL_X + COL_W - 12, H - 45, `Sheet ${sheetNo} of ${total}`, 6.2,
    { fill: '#8FA0AA', anchor: 'end' });
};

const colFooter = (p: Pen, scaleTxt: string, rev: string, date: string) => {
  p.line(COL_X, 62, COL_X + COL_W, 62, RULE, 0.5);
  const cols: [string, string][] = [
    ['UNITS', 'mm'], ['SCALE', scaleTxt], ['REV', rev], ['DATE', date],
  ];
  const cw = COL_W / 4;
  cols.forEach(([k, v], i) => {
    const cx = COL_X + cw * i;
    if (i) p.line(cx, 26, cx, 62, RULE, 0.5);
    p.text(cx + 6, 50, k, 5.6, { fill: SUB });
    p.text(cx + 6, 36, v, 7, { bold: true });
  });
  p.line(COL_X, 26, COL_X + COL_W, 26, RULE, 0.5);
};

const disclaimer = (p: Pen, y: number, company: string) => {
  p.rect(L0, y, L1 - L0, 30, { stroke: RULE, lw: 0.5 });
  p.text(L0 + 7, y + 20, 'NOTICE / DISCLAIMER', 5.6, { bold: true, fill: ACCENT });
  p.text(L0 + 7, y + 11,
    `This drawing is the property of ${company} and is furnished subject to return on `
    + 'demand. It shall not be reproduced or copied,', 5.6, { fill: SUB });
  p.text(L0 + 7, y + 4,
    'in whole or in part, nor disclosed to any third party, without prior written '
    + 'authorisation. Dimensions govern; do not scale from a resized print.',
    5.6, { fill: SUB });
};

const notesBlock = (p: Pen, x: number, y: number, title: string, items: string[]) => {
  p.text(x, y, title, 6.5, { bold: true, fill: ACCENT });
  let yy = y - 11;
  items.forEach((n) => { p.text(x, yy, n, 6.6, { fill: SUB }); yy -= 9.5; });
  return yy;
};

const signBlock = (p: Pen, x: number, y: number, w: number, h: number,
                   title: string, fields: string[], stamp = false) => {
  p.rect(x, y, w, h, { stroke: INK, lw: 0.6 });
  p.rect(x, y + h - HEAD_H, w, HEAD_H, { fill: HEAD_BG });
  p.line(x, y + h - HEAD_H, x + w, y + h - HEAD_H, RULE, 0.5);
  p.text(x + 7, y + h - HEAD_H + 4.3, title, 6.5, { bold: true, fill: ACCENT });
  const fw = w - 14 - (stamp ? 58 : 0);
  const step = (h - HEAD_H - 14) / fields.length;
  let yy = y + h - HEAD_H - 16;
  fields.forEach((label) => {
    p.line(x + 7, yy, x + 7 + fw, yy, RULE, 0.5);
    p.text(x + 7, yy - 7, label, 5.6, { fill: HID });
    yy -= step;
  });
  if (stamp) {
    p.rect(x + w - 54, y + 10, 44, h - HEAD_H - 20,
      { stroke: HID, lw: 0.5, dash: '3,2' });
    p.text(x + w - 32, y + h / 2 - 16, 'STAMP', 5.6, { fill: HID, anchor: 'middle' });
  }
};

const revTable = (p: Pen, x: number, y: number, w: number, rows = 4) => {
  const fixed: [string, number][] = [
    ['NO.', 26], ['REV', 30], ['DATE', 56], ['ECN NO.', 60],
  ];
  const tail: [string, number][] = [['CHECKED', 60], ['APPROVED', 60]];
  const used = [...fixed, ...tail].reduce((t, [, cw]) => t + cw, 0);
  const cols: [string, number][] = [...fixed, ['REVISION DETAILS', w - used], ...tail];
  const rh = 14;
  const th = rh * (rows + 1);
  p.rect(x, y, w, th, { stroke: INK, lw: 0.6 });
  p.rect(x, y + th - rh, w, rh, { fill: HEAD_BG });
  let cx = x;
  cols.forEach(([name, cw]) => {
    p.text(cx + 5, y + th - rh + 5, name, 5.8, { bold: true, fill: ACCENT });
    cx += cw;
    if (cx < x + w - 0.5) p.line(cx, y, cx, y + th, RULE, 0.5);
  });
  for (let i = 0; i <= rows; i += 1) p.line(x, y + rh * i, x + w, y + rh * i, RULE, 0.5);
};

/* ── the figures behind the sheet ─────────────────────────────────────── */

const derive = (s: WoundShape, meta: SheetMeta) => {
  const alloy: MaterialKey = meta.alloy ?? 'CRGO';
  const mat = materialOf(alloy);
  // The order line's own arithmetic, not a second copy of it: a drawing that
  // disagrees with the weight it was sold on is worse than no drawing.
  const calc = woundCoreCalc({
    id1: s.id1, id2: s.id2, od1: s.od1, od2: s.od2, ht: s.ht,
    pcs: meta.pcs ?? 0, factor: meta.factor, alloy,
  });
  const buildW = (s.od2 - s.id2) / 2;   // across the width — what Ac uses
  const buildL = (s.od1 - s.id1) / 2;   // along the length
  const rin = s.id2 / 2;
  const rout = rin + buildW;
  const lmMm = calc.coreMl * 10;
  // Stadium window: the straight part plus the two half-ends.
  const waMm2 = (s.id1 - s.id2) * s.id2 + Math.PI * rin * rin;
  const t = STRIP_T[alloy];
  return {
    alloy,
    density: mat.density,
    sf: calc.coreAc > 0 && buildW > 0 && s.ht > 0
      ? (calc.coreAc * 100) / (buildW * s.ht) : mat.stackingFactor,
    buildW,
    buildL,
    rin,
    rout,
    acCm2: calc.coreAc,
    lmMm,
    lmCm: calc.coreMl,
    waCm2: waMm2 / 100,
    apCm4: calc.coreAc * (waMm2 / 100),
    weightKg: calc.weightPerPc,
    totalKg: calc.totalWeight,
    stripT: t,
    wraps: t > 0 ? buildW / t : 0,
    stripLenM: t > 0 ? (buildW * lmMm) / t / 1000 : 0,
    /* A wound core has one build all the way round. If the two axes disagree
       the customer has been quoted on the width build, so say so on the sheet
       rather than drawing a shape that cannot be wound. */
    buildMismatch: Math.abs(buildW - buildL) > 0.05,
  };
};

export const woundDesignation = (s: WoundShape) => {
  const n = (v: number) => (Number.isInteger(v) ? String(v) : String(v));
  return `WC ${n(s.id1)}-${n(s.id2)}-${n(s.od1)}-${n(s.od2)}-${n(s.ht)}`;
};

/* ── sheet 1 ──────────────────────────────────────────────────────────── */

const sheetOne = (s: WoundShape, meta: SheetMeta, d: ReturnType<typeof derive>,
                  designation: string, dateTxt: string, company: string) => {
  const p = new Pen();
  frame(p);
  sheetHeader(p, 'GENERAL ARRANGEMENT', `wound core  ${designation}`);
  companyBlock(p, company, 1);

  /* The plan and the section share one scale, chosen so both fit their boxes;
     they are the same object seen two ways and a reader compares them. */
  const sc = pickScale(
    Math.max(s.od1, d.buildW * 2.4), Math.max(s.od2, s.ht),
    250, 150,
  );
  const PPM = sc.ratio * PT_PER_MM;

  /* ---- PLAN ---- */
  const pcx = 190; const pcy = 432;
  const ow = s.od1 * PPM; const oh = s.od2 * PPM;
  const iw = s.id1 * PPM; const ih = s.id2 * PPM;

  p.rect(pcx - ow / 2, pcy - oh / 2, ow, oh,
    { fill: MAT, stroke: INK, lw: 0.9, r: d.rout * PPM });
  p.rect(pcx - iw / 2, pcy - ih / 2, iw, ih,
    { fill: WHITE, stroke: INK, lw: 0.9, r: d.rin * PPM });
  p.centreLine(pcx - ow / 2 - 20, pcy, pcx + ow / 2 + 20, pcy);
  p.centreLine(pcx, pcy - oh / 2 - 20, pcx, pcy + oh / 2 + 20);

  const yC = pcy - oh / 2 - 30;
  const yF = yC - 24;
  p.dimH(pcx - iw / 2, pcx + iw / 2, yC, `c  ${n2(s.id1)}`, pcy - ih / 2);
  p.dimH(pcx - ow / 2, pcx + ow / 2, yF, `f  ${n2(s.od1)}`, pcy - oh / 2);
  const xB = pcx + ow / 2 + 30;
  p.dimV(pcy - ih / 2, pcy + ih / 2, xB, `b  ${n2(s.id2)}`, pcx + iw / 2);
  p.dimV(pcy - oh / 2, pcy + oh / 2, xB + 24, `e  ${n2(s.od2)}`, pcx + ow / 2);

  const radiusLeader = (cx: number, rad: number, deg: number, run: number,
                        elbow: number, label: string, anchor: 'start' | 'end') => {
    const a = (deg * Math.PI) / 180;
    const px = cx + rad * Math.cos(a);
    const py = pcy + rad * Math.sin(a);
    const ex = px + run * Math.cos(a);
    const ey = py + run * Math.sin(a);
    p.line(px, py, ex, ey, INK, 0.5);
    p.line(ex, ey, ex + elbow, ey, INK, 0.5);
    p.arrow(px, py, a + Math.PI);
    p.text(anchor === 'end' ? ex + elbow - 3 : ex + elbow + 3, ey - 2.5,
      label, 7, { anchor: anchor === 'end' ? 'end' : 'start' });
  };
  radiusLeader(pcx - iw / 2 + d.rin * PPM, d.rin * PPM, 128, 74, -18,
    `R${n2(d.rin)}`, 'end');
  radiusLeader(pcx + ow / 2 - d.rout * PPM, d.rout * PPM, 52, 40, 20,
    `R${n2(d.rout)}`, 'start');

  /* The cutting plane for section A-A. It falls inside the window's span, so it
     crosses the two straight limbs rather than an end radius, and the section
     below shows one of them — build by height, which is the figure the winder
     works to. Taken nearer an end and it would cut the radius, where the wall
     is not square to the plane and the section would be wider than the build. */
  const cutX = pcx - iw / 4;
  p.line(cutX, pcy - oh / 2 - 14, cutX, pcy + oh / 2 + 14, ACCENT, 1.4, '9,3,2,3');
  [pcy + oh / 2 + 14, pcy - oh / 2 - 14].forEach((yy) => {
    p.line(cutX, yy, cutX + 14, yy, ACCENT, 1.4);
    p.poly([[cutX + 14, yy], [cutX + 8, yy + 2.6], [cutX + 8, yy - 2.6]], { fill: ACCENT });
    p.text(cutX - 4, yy - 2.8, 'A', 8, { bold: true, fill: ACCENT, anchor: 'end' });
  });
  p.viewLabel(pcx, 292, 'PLAN', `scale ${sc.label}`);

  /* ---- SECTION A-A ---- */
  const scx = 452; const scy = 432;
  const sw = d.buildW * PPM; const sh = s.ht * PPM;
  p.rect(scx - sw / 2, scy - sh / 2, sw, sh, { fill: MAT, stroke: INK, lw: 0.9 });
  p.hatch(scx - sw / 2, scy - sh / 2, sw, sh);
  p.rect(scx - sw / 2, scy - sh / 2, sw, sh, { stroke: INK, lw: 0.9 });
  for (let i = 1; i < 7; i += 1) {
    const xx = scx - sw / 2 + (sw * i) / 7;
    p.line(xx, scy - sh / 2 + 2, xx, scy + sh / 2 - 2, WRAP_INK, 0.3);
  }
  p.dimH(scx - sw / 2, scx + sw / 2, scy + sh / 2 + 22, `a  ${n2(d.buildW)}`,
    scy + sh / 2);
  p.dimV(scy - sh / 2, scy + sh / 2, scx + sw / 2 + 30, `d  ${n2(s.ht)}`,
    scx + sw / 2);
  const bx = scx; const by = scy - sh / 4;
  p.circle(bx, by, 22, { stroke: ACCENT, lw: 0.9, dash: '3,2' });
  p.line(bx + 15.6, by - 15.6, bx + 38, by - 38, ACCENT, 0.5);
  p.text(bx + 41, by - 41, 'B', 8, { bold: true, fill: ACCENT });
  p.text(bx + 41, by - 50, 'see sheet 2', 6.5, { fill: SUB });
  p.viewLabel(scx, 292, 'SECTION A-A', `scale ${sc.label} · one limb shown`);

  /* ---- notes, signatures, disclaimer ---- */
  const notes = [
    '1.  All dimensions in millimetres. Dimensions govern; do not scale from a resized print.',
    `2.  Ends fully radiused. Inner radius R${n2(d.rin)} = b/2, outer radius R${n2(d.rout)} = R${n2(d.rin)} + a.`,
    '3.  Core weight is calculated from net area x mean path x density, not weighed.',
    '4.  Cutting, slitting and handling losses are not deducted. Tolerances to be agreed at approval.',
  ];
  if (d.buildMismatch) {
    notes.push(`4a. Build differs across the two axes (${n2(d.buildL)} along f, ${n2(d.buildW)} across e). `
      + 'Area and weight are taken on the width build. Confirm before manufacture.');
  }
  notesBlock(p, L0, 266, 'NOTES', notes);

  const bw = (L1 - L0 - 12) / 3;
  signBlock(p, L0, 96, bw, 104, 'PREPARED BY', ['Name', 'Signature', 'Date']);
  signBlock(p, L0 + bw + 6, 96, bw, 104, 'CHECKED AND APPROVED BY',
    ['Name', 'Signature', 'Date']);
  signBlock(p, L0 + 2 * (bw + 6), 96, bw, 104, 'CUSTOMER APPROVAL',
    ['Company', 'Approver name', 'Signature', 'Date'], true);
  disclaimer(p, 50, company);

  /* ---- data column ---- */
  let y = H - 62;
  y = head(p, COL_X, y, COL_W, 'MATERIAL');
  y = kv(p, COL_X, y, COL_W, 'Alloy', materialOf(d.alloy).label);
  y = kv(p, COL_X, y, COL_W, 'Grade', meta.grade || '—');
  y = kv(p, COL_X, y, COL_W, 'Construction', 'Continuously wound, uncut');
  y = kv(p, COL_X, y, COL_W, 'Ends', 'Radiused');
  y -= 4;

  y = head(p, COL_X, y + 14, COL_W, 'PHYSICAL SPECIFICATION') + 4;
  y = specCols(p, COL_X, y, COL_W);
  ([
    ['Core build', 'a', n2(d.buildW)],
    ['Window width', 'b', n2(s.id2)],
    ['Window length', 'c', n2(s.id1)],
    ['Core height', 'd', n2(s.ht)],
    ['Core width', 'e', n2(s.od2)],
    ['Core length', 'f', n2(s.od1)],
  ] as [string, string, string][]).forEach(([desc, sym, val]) => {
    y = spec(p, COL_X, y, COL_W, desc, sym, val, '—');
  });
  y = spec(p, COL_X, y, COL_W, 'Core weight', 'g',
    d.weightKg >= 1 ? `${d.weightKg.toFixed(3)} kg` : `${(d.weightKg * 1000).toFixed(1)} g`, '—');
  y -= 6;

  y = head(p, COL_X, y + 14, COL_W, 'MAGNETIC CHARACTERISTICS') + 4;
  y = kv(p, COL_X, y, COL_W, 'Mean magnetic path  (lm)', `${d.lmCm.toFixed(2)} cm`, true);
  y = kv(p, COL_X, y, COL_W, 'Net cross section area  (Ac)', `${d.acCm2.toFixed(3)} cm2`, true);
  y = kv(p, COL_X, y, COL_W, 'Window area  (Wa)', `${d.waCm2.toFixed(3)} cm2`);
  y = kv(p, COL_X, y, COL_W, 'Area product  (Ap)', `${d.apCm4.toFixed(2)} cm4`);
  y = kv(p, COL_X, y, COL_W, 'Stacking factor', d.sf.toFixed(3));
  y -= 6;

  y = head(p, COL_X, y + 14, COL_W, 'CORE SIZE') + 2;
  p.text(COL_X + COL_W / 2, y - 6, designation, 14, { bold: true, fill: ACCENT, anchor: 'middle' });
  y -= 26;

  y = head(p, COL_X, y + 14, COL_W, 'ORDER') + 4;
  y = kv(p, COL_X, y, COL_W, 'Order / enquiry no.', meta.orderNo || '—');
  y = kv(p, COL_X, y, COL_W, 'Customer', meta.customer || '—');
  y = kv(p, COL_X, y, COL_W, 'Pieces', meta.pcs ? String(meta.pcs) : '—');
  y = kv(p, COL_X, y, COL_W, 'Total weight',
    d.totalKg > 0 ? `${d.totalKg.toFixed(3)} kg` : '—');

  colFooter(p, sc.label, '00', dateTxt);
  return p.svg();
};

/* ── sheet 2 ──────────────────────────────────────────────────────────── */

/** Obround outline: straight runs of (A−B) closed by two half-circles of B/2. */
const stadium = (A: number, B: number, n = 40): [number, number][] => {
  const r = B / 2;
  const straight = (A - B) / 2;
  const pts: [number, number][] = [];
  for (let i = 0; i <= n; i += 1) {
    const a = -Math.PI / 2 + (Math.PI * i) / n;
    pts.push([straight + r * Math.cos(a), r * Math.sin(a)]);
  }
  for (let i = 0; i <= n; i += 1) {
    const a = Math.PI / 2 + (Math.PI * i) / n;
    pts.push([-straight + r * Math.cos(a), r * Math.sin(a)]);
  }
  return pts;
};

const sheetTwo = (s: WoundShape, meta: SheetMeta, d: ReturnType<typeof derive>,
                  designation: string, dateTxt: string, company: string) => {
  const p = new Pen();
  frame(p);
  sheetHeader(p, 'VIEWS AND DETAIL', `wound core  ${designation}`);
  companyBlock(p, company, 2);

  const sc = pickScale(Math.max(s.od1, s.od2), s.ht, 210, 120);
  const PPM = sc.ratio * PT_PER_MM;

  /* ---- FRONT ELEVATION ---- */
  const fx = 165; const fyc = 440;
  const fw = s.od1 * PPM; const fh = s.ht * PPM;
  p.rect(fx - fw / 2, fyc - fh / 2, fw, fh, { fill: MAT, stroke: INK, lw: 0.9 });
  [-1, 1].forEach((sg) => {
    const hx = fx + (sg * s.id1 * PPM) / 2;
    p.hidden(hx, fyc - fh / 2, hx, fyc + fh / 2);
  });
  p.centreLine(fx, fyc - fh / 2 - 14, fx, fyc + fh / 2 + 14);
  p.dimH(fx - fw / 2, fx + fw / 2, fyc - fh / 2 - 26, `f  ${n2(s.od1)}`, fyc - fh / 2);
  p.dimH(fx - (s.id1 * PPM) / 2, fx + (s.id1 * PPM) / 2, fyc + fh / 2 + 20,
    `c  ${n2(s.id1)}`, fyc + fh / 2);
  p.dimV(fyc - fh / 2, fyc + fh / 2, fx + fw / 2 + 26, `d  ${n2(s.ht)}`, fx + fw / 2);
  p.text(fx, fyc - 4, 'window shown hidden', 6.5, { fill: HID, anchor: 'middle' });
  p.viewLabel(fx, 332, 'FRONT ELEVATION', `scale ${sc.label}`);

  /* ---- END ELEVATION ---- */
  const ex = 410; const ey = 440;
  const ew = s.od2 * PPM; const eh = s.ht * PPM;
  p.rect(ex - ew / 2, ey - eh / 2, ew, eh, { fill: MAT, stroke: INK, lw: 0.9 });
  [-1, 1].forEach((sg) => {
    const hx = ex + (sg * s.id2 * PPM) / 2;
    p.hidden(hx, ey - eh / 2, hx, ey + eh / 2);
  });
  p.centreLine(ex, ey - eh / 2 - 14, ex, ey + eh / 2 + 14);
  p.dimH(ex - ew / 2, ex + ew / 2, ey - eh / 2 - 26, `e  ${n2(s.od2)}`, ey - eh / 2);
  p.dimH(ex - (s.id2 * PPM) / 2, ex + (s.id2 * PPM) / 2, ey + eh / 2 + 20,
    `b  ${n2(s.id2)}`, ey + eh / 2);
  p.dimV(ey - eh / 2, ey + eh / 2, ex + ew / 2 + 26, `d  ${n2(s.ht)}`, ex + ew / 2);
  p.viewLabel(ex, 332, 'END ELEVATION', `scale ${sc.label}`);

  /* ---- DETAIL B: the wound strip ---- */
  const dx0 = 76; const dy0 = 195;
  const dW = 212; const dH = 96;
  // Enough wraps to read as wound strip without drawing all 150 of them.
  const shown = Math.max(8, Math.min(28, Math.round(d.wraps)));
  const pitch = dW / shown;
  p.rect(dx0, dy0, dW, dH, { fill: MAT, stroke: INK, lw: 0.9 });
  for (let i = 1; i < shown; i += 1) {
    p.line(dx0 + i * pitch, dy0, dx0 + i * pitch, dy0 + dH, '#9E9788', 0.55);
  }
  // Ragged break lines: this is a slice out of the build, not the whole of it.
  [dx0, dx0 + dW].forEach((bxp) => {
    const pts: [number, number][] = [[bxp, dy0]];
    for (let j = 0; j < 10; j += 1) {
      pts.push([bxp + (j % 2 ? 5 : -5), dy0 + (dH * (j + 1)) / 10]);
    }
    p.poly(pts, { stroke: INK, lw: 0.8, close: false });
  });
  const lx = dx0 + 8 * pitch;
  p.line(lx, dy0 + dH, lx + 30, dy0 + dH + 22, INK, 0.5);
  p.line(lx + 30, dy0 + dH + 22, lx + 66, dy0 + dH + 22, INK, 0.5);
  p.arrow(lx, dy0 + dH, (-144 * Math.PI) / 180);
  p.text(lx + 69, dy0 + dH + 19.5, `strip t ${d.stripT} nom.`, 7);
  p.text(dx0 + dW / 2, dy0 - 15,
    `build a = ${n2(d.buildW)}, ${Math.round(d.wraps)} wraps nominal at ${d.stripT} mm`,
    6.6, { fill: SUB, anchor: 'middle' });
  p.viewLabel(dx0 + dW / 2, dy0 - 33, 'DETAIL B', 'schematic, not to scale');

  /* ---- PICTORIAL ---- */
  const IS = Math.min(1.95, 150 / Math.max(s.od1, s.od2, 1));
  const iox = 452; const ioy = 191;
  const iso = (px: number, py: number, pz: number): [number, number] => [
    iox + (px - py) * 0.866 * IS,
    ioy + ((px + py) * 0.5 + pz) * IS,
  ];
  const outer = stadium(s.od1, s.od2);
  const inner = stadium(s.id1, s.id2);
  const topO = outer.map(([x, y]) => iso(x, y, s.ht));
  const botO = outer.map(([x, y]) => iso(x, y, 0));
  const idx = topO.map((_, i) => i);
  const imin = idx.reduce((a, b) => (topO[b][0] < topO[a][0] ? b : a), 0);
  const imax = idx.reduce((a, b) => (topO[b][0] > topO[a][0] ? b : a), 0);
  let ca = imin <= imax ? idx.slice(imin, imax + 1)
    : [...idx.slice(imin), ...idx.slice(0, imax + 1)];
  let cb = [...idx.slice(imax), ...idx.slice(0, imin + 1)];
  const meanY = (g: number[]) => g.reduce((t, i) => t + topO[i][1], 0) / g.length;
  // `ca` must end up the FAR chain — the one higher up the page — so that the
  // silhouette runs along its top edge and down the near chain's bottom edge.
  // Choosing the other way round builds the skirt on the far side and the solid
  // reads inside out: a ring with its wall behind the hole instead of in front.
  if (meanY(ca) < meanY(cb)) { const tmp = ca; ca = cb; cb = tmp; }
  p.poly([...ca.map((i) => topO[i]), ...cb.map((i) => botO[i])],
    { fill: MAT_D, stroke: INK, lw: 0.8 });
  p.poly(topO, { fill: MAT, stroke: INK, lw: 0.8 });
  p.poly(inner.map(([x, y]) => iso(x, y, s.ht)), { fill: DARK, stroke: INK, lw: 0.8 });
  [0.25, 0.5, 0.75].forEach((fr) => {
    const lay = stadium(s.id1 + (s.od1 - s.id1) * fr, s.id2 + (s.od2 - s.id2) * fr);
    p.poly(lay.map(([x, y]) => iso(x, y, s.ht)), { stroke: HATCH_INK, lw: 0.35 });
  });
  p.text(iox, 138, 'concentric lines indicate wound strip layers', 6.6,
    { fill: SUB, anchor: 'middle' });
  p.viewLabel(iox, 120, 'PICTORIAL', 'not to scale');

  p.text(L0, 108, 'REVISION HISTORY', 6.5, { bold: true, fill: ACCENT });
  revTable(p, L0, 32, L1 - L0, 4);

  /* ---- data column ---- */
  let y = H - 62;
  y = head(p, COL_X, y, COL_W, 'WINDING DATA');
  ([
    ['Strip grade', meta.grade || materialOf(d.alloy).label],
    ['Nominal thickness', `${d.stripT} mm`],
    ['Slit strip width', `${n2(s.ht)} mm`],
    ['Wraps, nominal', String(Math.round(d.wraps))],
    ['Strip length', `${d.stripLenM.toFixed(2)} m`],
    ['Mandrel', `${n2(s.id1)} x ${n2(s.id2)}  R${n2(d.rin)}`],
    ['Heat treatment', 'Stress relief anneal'],
    ['Retention', 'To be agreed'],
  ] as [string, string][]).forEach(([k, v]) => { y = kv(p, COL_X, y, COL_W, k, v); });
  y -= 6;

  y = head(p, COL_X, y + 14, COL_W, 'TOLERANCES') + 4;
  ['Window b / c', 'Outer e / f', 'Core height d', 'Build a', 'Core weight']
    .forEach((k) => { y = kv(p, COL_X, y, COL_W, k, 'to be agreed'); });
  y -= 6;

  y = head(p, COL_X, y + 14, COL_W, 'FINISH AND PACKING') + 4;
  ([
    ['Surface', 'As annealed'], ['Edge protection', 'To be agreed'],
    ['Marking', 'Core size and lot'], ['Packing', 'To be agreed'],
  ] as [string, string][]).forEach(([k, v]) => { y = kv(p, COL_X, y, COL_W, k, v); });
  y -= 6;

  y = head(p, COL_X, y + 14, COL_W, 'NOTES') + 2;
  [
    '5.  Hidden detail shown dashed. The window',
    '     is a through opening.',
    '6.  Detail B is schematic. The wrap count',
    '     shown is fewer than actual.',
    '7.  Wraps and strip length depend on the',
    '     delivered thickness. Weight is not',
    '     affected.',
    '8.  Pictorial is for identification only.',
    '     Do not dimension from it.',
  ].forEach((ln) => { p.text(COL_X + 7, y, ln, 6.5, { fill: SUB }); y -= 9.2; });

  colFooter(p, 'as noted', '00', dateTxt);
  return p.svg();
};

/* ── entry point ──────────────────────────────────────────────────────── */

export type WoundDrawingSet = {
  designation: string;
  /** Two full-page SVGs, A4 landscape, in PDF points. */
  pages: [string, string];
};

export const buildWoundDrawing = (s: WoundShape, meta: SheetMeta): WoundDrawingSet => {
  const d = derive(s, meta);
  const designation = woundDesignation(s);
  const dateTxt = new Date().toLocaleDateString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
  const company = meta.company || 'Core manufacturer';
  return {
    designation,
    pages: [
      sheetOne(s, meta, d, designation, dateTxt, company),
      sheetTwo(s, meta, d, designation, dateTxt, company),
    ],
  };
};
