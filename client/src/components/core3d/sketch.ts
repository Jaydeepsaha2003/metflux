// A dimensioned 2D drawing of a core, as SVG.
//
// One SVG serves two outputs: rasterised to JPG, and embedded as vector in the
// pdfmake spec sheet. Keeping a single source means the drawing on paper and
// the drawing on screen can never drift apart.
//
// Two views, as a workshop drawing has them: a PLAN looking down the axis,
// which is where the diameters or the window dimensions live, and a SECTION
// looking from the side, which is where the height lives. A single isometric
// looks nicer and is harder to measure from.
//
// No external fonts, no CSS, no <style> — pdfmake's SVG support handles plain
// shapes and text with explicit attributes, and anything else silently drops.
import { compositeLayout, type CoreShape } from './shape';

const INK = '#0f172a';
const DIM = '#1d4ed8';
const STEEL = '#e7dcc0';
const STEEL_EDGE = '#a98b46';
const NANO = '#e6ddf7';
const NANO_EDGE = '#7c5bb5';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const n = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));
const f = (v: number) => Number(v.toFixed(2));

type P = { x: number; y: number };

/** An arrowhead as a filled triangle, pointing along the vector a→b. */
const arrow = (at: P, towards: P, size: number) => {
  const dx = towards.x - at.x, dy = towards.y - at.y;
  const L = Math.hypot(dx, dy) || 1;
  const ux = dx / L, uy = dy / L;
  const px = -uy, py = ux;                       // perpendicular
  const b = { x: at.x + ux * size, y: at.y + uy * size };
  return `<polygon points="${f(at.x)},${f(at.y)} ${f(b.x + px * size * 0.32)},${f(b.y + py * size * 0.32)} ${f(b.x - px * size * 0.32)},${f(b.y - py * size * 0.32)}" fill="${DIM}"/>`;
};

/** A complete linear dimension: extension lines, dimension line, two inward
 *  arrowheads, and the value on a cleared patch of the line. */
const linearDim = (
  a: P, b: P, off: P, text: string, s: number,
): string => {
  const A = { x: a.x + off.x, y: a.y + off.y };
  const B = { x: b.x + off.x, y: b.y + off.y };
  const oL = Math.hypot(off.x, off.y) || 1;
  const ox = (off.x / oL) * s * 0.9, oy = (off.y / oL) * s * 0.9;
  const mid = { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 };
  const vertical = Math.abs(B.y - A.y) > Math.abs(B.x - A.x);
  const tw = text.length * s * 0.52 + s * 0.5;

  return [
    `<line x1="${f(a.x)}" y1="${f(a.y)}" x2="${f(A.x + ox)}" y2="${f(A.y + oy)}" stroke="${DIM}" stroke-width="0.8"/>`,
    `<line x1="${f(b.x)}" y1="${f(b.y)}" x2="${f(B.x + ox)}" y2="${f(B.y + oy)}" stroke="${DIM}" stroke-width="0.8"/>`,
    `<line x1="${f(A.x)}" y1="${f(A.y)}" x2="${f(B.x)}" y2="${f(B.y)}" stroke="${DIM}" stroke-width="0.8"/>`,
    arrow(A, B, s * 0.9),
    arrow(B, A, s * 0.9),
    // A white patch under the value, so the dimension line does not strike
    // through the digits.
    vertical
      ? `<rect x="${f(mid.x - s * 0.85)}" y="${f(mid.y - tw / 2)}" width="${f(s * 1.7)}" height="${f(tw)}" fill="#ffffff"/>`
      : `<rect x="${f(mid.x - tw / 2)}" y="${f(mid.y - s * 0.85)}" width="${f(tw)}" height="${f(s * 1.7)}" fill="#ffffff"/>`,
    vertical
      ? `<text x="${f(mid.x)}" y="${f(mid.y)}" fill="${DIM}" font-size="${f(s * 1.15)}" font-weight="700" text-anchor="middle" dominant-baseline="central" transform="rotate(-90 ${f(mid.x)} ${f(mid.y)})">${esc(text)}</text>`
      : `<text x="${f(mid.x)}" y="${f(mid.y)}" fill="${DIM}" font-size="${f(s * 1.15)}" font-weight="700" text-anchor="middle" dominant-baseline="central">${esc(text)}</text>`,
  ].join('');
};

const centreMarks = (cx: number, cy: number, r: number) => [
  `<line x1="${f(cx - r)}" y1="${f(cy)}" x2="${f(cx + r)}" y2="${f(cy)}" stroke="${INK}" stroke-width="0.5" stroke-dasharray="6 3 1 3" opacity="0.55"/>`,
  `<line x1="${f(cx)}" y1="${f(cy - r)}" x2="${f(cx)}" y2="${f(cy + r)}" stroke="${INK}" stroke-width="0.5" stroke-dasharray="6 3 1 3" opacity="0.55"/>`,
].join('');

const viewTitle = (x: number, y: number, label: string, s: number) =>
  `<text x="${f(x)}" y="${f(y)}" fill="${INK}" font-size="${f(s * 1.05)}" font-weight="700" text-anchor="middle" opacity="0.65">${esc(label)}</text>`;

export type SketchResult = { svg: string; width: number; height: number };

/**
 * Draw the shape at a scale that fits `width` x `height`, with room around the
 * edges for the dimension lines.
 */
export const buildSketch = (shape: CoreShape, width = 720, height = 340): SketchResult => {
  const pad = 46;                       // room for dimension lines and values
  const s = Math.max(9, Math.min(width, height) * 0.032);   // type/arrow scale
  const cellW = (width - pad * 3) / 2;
  const cellH = height - pad * 2;
  const planCx = pad + cellW / 2;
  const sectCx = pad * 2 + cellW + cellW / 2;
  const cy = pad + cellH / 2;

  // Real-world size of each view, so both share one scale factor.
  let planW = 0, planH = 0, sectW = 0, sectH = 0;
  const parts: string[] = [];

  const sizeOf = () => {
    switch (shape.kind) {
      case 'TOROIDAL':
      case 'NANO':
        planW = planH = shape.dims.od;
        sectW = shape.dims.od; sectH = shape.dims.ht;
        break;
      case 'COMPOSITE': {
        const { totalHt } = compositeLayout(shape.rule, shape.crgo, shape.nano);
        const od = Math.max(shape.crgo.od, shape.nano.od);
        planW = planH = od;
        sectW = od; sectH = totalHt;
        break;
      }
      case 'RECTANGULAR':
        planW = shape.od1; planH = shape.od2;
        sectW = shape.od1; sectH = shape.ht;
        break;
    }
  };
  sizeOf();

  const scale = Math.min(
    cellW / Math.max(planW, sectW, 1),
    cellH / Math.max(planH, sectH, 1),
  ) * 0.62;
  const m = (v: number) => v * scale;   // millimetres → drawing units

  /* ---- PLAN ---- */
  if (shape.kind === 'RECTANGULAR') {
    const { id1, id2, od1, od2 } = shape;
    const W = m(od1), H = m(od2), wI = m(id1), hI = m(id2);
    parts.push(
      `<rect x="${f(planCx - W / 2)}" y="${f(cy - H / 2)}" width="${f(W)}" height="${f(H)}" rx="${f(m(Math.min(od1, od2) * 0.04))}" fill="${STEEL}" stroke="${STEEL_EDGE}" stroke-width="1.3"/>`,
      `<rect x="${f(planCx - wI / 2)}" y="${f(cy - hI / 2)}" width="${f(wI)}" height="${f(hI)}" rx="${f(m(Math.min(id1, id2) * 0.12))}" fill="#ffffff" stroke="${STEEL_EDGE}" stroke-width="1.3"/>`,
      centreMarks(planCx, cy, Math.max(W, H) / 2 + s * 1.4),
      linearDim(
        { x: planCx - W / 2, y: cy + H / 2 }, { x: planCx + W / 2, y: cy + H / 2 },
        { x: 0, y: s * 2.4 }, `OD1 ${n(od1)}`, s,
      ),
      linearDim(
        { x: planCx - wI / 2, y: cy - hI / 2 }, { x: planCx + wI / 2, y: cy - hI / 2 },
        { x: 0, y: -s * 2.4 }, `ID1 ${n(id1)}`, s,
      ),
      linearDim(
        { x: planCx - W / 2, y: cy - H / 2 }, { x: planCx - W / 2, y: cy + H / 2 },
        { x: -s * 2.4, y: 0 }, `OD2 ${n(od2)}`, s,
      ),
      linearDim(
        { x: planCx + wI / 2, y: cy - hI / 2 }, { x: planCx + wI / 2, y: cy + hI / 2 },
        { x: s * 2.4, y: 0 }, `ID2 ${n(id2)}`, s,
      ),
    );
  } else {
    const od = shape.kind === 'COMPOSITE'
      ? Math.max(shape.crgo.od, shape.nano.od)
      : shape.dims.od;
    const id = shape.kind === 'COMPOSITE'
      ? Math.min(shape.crgo.id, shape.nano.id)
      : shape.dims.id;
    const ro = m(od) / 2, ri = m(id) / 2;

    // A composite shows both rings in plan, which is the clearest picture of
    // what "concentric" means for a continuous loop.
    if (shape.kind === 'COMPOSITE' && shape.rule === 'CONTINUOUS_LOOP') {
      const outer = shape.crgo.od >= shape.nano.od ? shape.crgo : shape.nano;
      const inner = shape.crgo.od >= shape.nano.od ? shape.nano : shape.crgo;
      const outerIsCrgo = shape.crgo.od >= shape.nano.od;
      parts.push(
        `<circle cx="${f(planCx)}" cy="${f(cy)}" r="${f(m(outer.od) / 2)}" fill="${outerIsCrgo ? STEEL : NANO}" stroke="${outerIsCrgo ? STEEL_EDGE : NANO_EDGE}" stroke-width="1.3"/>`,
        `<circle cx="${f(planCx)}" cy="${f(cy)}" r="${f(m(outer.id) / 2)}" fill="${outerIsCrgo ? NANO : STEEL}" stroke="${outerIsCrgo ? NANO_EDGE : STEEL_EDGE}" stroke-width="1.3"/>`,
        `<circle cx="${f(planCx)}" cy="${f(cy)}" r="${f(m(inner.id) / 2)}" fill="#ffffff" stroke="${outerIsCrgo ? NANO_EDGE : STEEL_EDGE}" stroke-width="1.3"/>`,
      );
    } else {
      parts.push(
        `<circle cx="${f(planCx)}" cy="${f(cy)}" r="${f(ro)}" fill="${shape.kind === 'NANO' ? NANO : STEEL}" stroke="${shape.kind === 'NANO' ? NANO_EDGE : STEEL_EDGE}" stroke-width="1.3"/>`,
        `<circle cx="${f(planCx)}" cy="${f(cy)}" r="${f(ri)}" fill="#ffffff" stroke="${shape.kind === 'NANO' ? NANO_EDGE : STEEL_EDGE}" stroke-width="1.3"/>`,
      );
    }

    parts.push(
      centreMarks(planCx, cy, ro + s * 1.4),
      linearDim(
        { x: planCx - ro, y: cy }, { x: planCx + ro, y: cy },
        { x: 0, y: m(od) / 2 + s * 2.6 }, `OD ${n(od)}`, s,
      ),
      linearDim(
        { x: planCx - ri, y: cy }, { x: planCx + ri, y: cy },
        { x: 0, y: -(m(od) / 2 + s * 2.6) }, `ID ${n(id)}`, s,
      ),
    );
  }
  parts.push(viewTitle(planCx, pad * 0.55, 'PLAN', s));

  /* ---- SECTION ---- */
  const secW = m(sectW), secH = m(sectH);
  const secTop = cy - secH / 2;

  if (shape.kind === 'COMPOSITE') {
    const { totalHt } = compositeLayout(shape.rule, shape.crgo, shape.nano);
    if (shape.rule === 'CONTINUOUS_LOOP') {
      parts.push(
        `<rect x="${f(sectCx - m(shape.crgo.od) / 2)}" y="${f(cy - m(shape.crgo.ht) / 2)}" width="${f(m(shape.crgo.od))}" height="${f(m(shape.crgo.ht))}" fill="${STEEL}" stroke="${STEEL_EDGE}" stroke-width="1.3"/>`,
        `<rect x="${f(sectCx - m(shape.nano.od) / 2)}" y="${f(cy - m(shape.nano.ht) / 2)}" width="${f(m(shape.nano.od))}" height="${f(m(shape.nano.ht))}" fill="none" stroke="${NANO_EDGE}" stroke-width="1.3"/>`,
      );
    } else {
      const crgoH = m(shape.crgo.ht), nanoH = m(shape.nano.ht);
      const top = cy - m(totalHt) / 2;
      parts.push(
        `<rect x="${f(sectCx - m(shape.crgo.od) / 2)}" y="${f(top + nanoH)}" width="${f(m(shape.crgo.od))}" height="${f(crgoH)}" fill="${STEEL}" stroke="${STEEL_EDGE}" stroke-width="1.3"/>`,
        `<rect x="${f(sectCx - m(shape.nano.od) / 2)}" y="${f(top)}" width="${f(m(shape.nano.od))}" height="${f(nanoH)}" fill="${NANO}" stroke="${NANO_EDGE}" stroke-width="1.3"/>`,
      );
    }
    parts.push(linearDim(
      { x: sectCx + secW / 2, y: cy - m(totalHt) / 2 }, { x: sectCx + secW / 2, y: cy + m(totalHt) / 2 },
      { x: s * 2.6, y: 0 }, `HT ${n(totalHt)}`, s,
    ));
  } else {
    const fill = shape.kind === 'NANO' ? NANO : shape.kind === 'RECTANGULAR' ? '#f6dfe2' : STEEL;
    const edge = shape.kind === 'NANO' ? NANO_EDGE : shape.kind === 'RECTANGULAR' ? '#b5616c' : STEEL_EDGE;
    parts.push(
      `<rect x="${f(sectCx - secW / 2)}" y="${f(secTop)}" width="${f(secW)}" height="${f(secH)}" fill="${fill}" stroke="${edge}" stroke-width="1.3"/>`,
    );
    // Show the bore as a dashed void through the section.
    if (shape.kind !== 'RECTANGULAR') {
      const ri = m(shape.dims.id) / 2;
      parts.push(
        `<rect x="${f(sectCx - ri)}" y="${f(secTop)}" width="${f(ri * 2)}" height="${f(secH)}" fill="#ffffff" stroke="${edge}" stroke-width="0.9" stroke-dasharray="5 3"/>`,
      );
    }
    parts.push(linearDim(
      { x: sectCx + secW / 2, y: secTop }, { x: sectCx + secW / 2, y: secTop + secH },
      { x: s * 2.6, y: 0 }, `HT ${n(shape.kind === 'RECTANGULAR' ? shape.ht : shape.dims.ht)}`, s,
    ));
  }
  parts.push(viewTitle(sectCx, pad * 0.55, 'SECTION', s));

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`
    + `<rect x="0" y="0" width="${width}" height="${height}" fill="#ffffff"/>`
    + parts.join('')
    // No units note here: both the PDF and the JPG print one in their own
    // footer, and two of them land on top of each other.
    + `</svg>`;

  return { svg, width, height };
};
