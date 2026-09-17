// A dimensioned 2D drawing of a core, as SVG.
//
// One SVG serves two outputs: rasterised to JPG, and embedded as vector in the
// pdfmake spec sheet. Keeping a single source means the drawing on paper and
// the drawing on screen can never drift apart.
//
// Laid out as a set of VIEWS rather than a fixed pair of pictures, because the
// six families do not all need the same drawing. A toroid is fully described by
// a plan and a section; a cut core is not — the thing that makes it a cut core
// is a joint two millimetres wide on a part two hundred across, which at the
// drawing's own scale is a hairline. So a cut core gets a third view, an
// enlarged detail of that joint, exactly as a workshop drawing would give it.
//
// Every view is drawn to ONE shared scale, except a detail, which says in its
// own title that it is enlarged. Two views at two silent scales is how a
// drawing lies to the person measuring off it.
//
// No external fonts, no CSS, no <style>, no <defs>, no patterns and no clip
// paths — pdfmake's SVG support handles plain shapes and text with explicit
// attributes, and anything else silently drops. Section hatching is therefore
// computed as individual line segments rather than asked for as a fill.
import {
  compositeLayout, cutCoreCode, cutOffsetMm, eCoreOutline, stepCoreSpan,
  type CoreShape,
} from './shape';

const INK = '#0f172a';
const DIM = '#1d4ed8';
const NOTE = '#475569';

/** Materials get their own ink, so a composite reads at a glance. */
const STEEL = { fill: '#f4ecd8', edge: '#8a6d2f', hatch: '#bc9b52' };
const NANO = { fill: '#efe9fb', edge: '#6d4fa6', hatch: '#9b81cd' };

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const n = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));
const f = (v: number) => Number(v.toFixed(2));

type P = { x: number; y: number };
type Skin = { fill: string; edge: string; hatch: string };

/* ── primitives ──────────────────────────────────────────────────────────── */

const line = (a: P, b: P, stroke: string, w = 1, dash = '') =>
  `<line x1="${f(a.x)}" y1="${f(a.y)}" x2="${f(b.x)}" y2="${f(b.y)}" stroke="${stroke}"`
  + ` stroke-width="${f(w)}"${dash ? ` stroke-dasharray="${dash}"` : ''}/>`;

const text = (
  at: P, s: string, size: number,
  { fill = INK, weight = 400, anchor = 'middle', opacity = 1, rotate = 0 } = {},
) =>
  `<text x="${f(at.x)}" y="${f(at.y)}" fill="${fill}" font-size="${f(size)}"`
  + ` font-weight="${weight}" text-anchor="${anchor}" dominant-baseline="central"`
  + (opacity !== 1 ? ` opacity="${opacity}"` : '')
  + (rotate ? ` transform="rotate(${rotate} ${f(at.x)} ${f(at.y)})"` : '')
  + `>${esc(s)}</text>`;

/**
 * 45° section hatching, as explicit segments clipped to the rectangle.
 *
 * A <pattern> would be one line of SVG and is exactly the sort of thing that
 * disappears without warning on the PDF side, taking the section's meaning with
 * it — an unhatched section is just an outline, and an outline of a toroid's
 * wall is indistinguishable from an outline of a solid disc. `dir` mirrors the
 * angle, which is how a drawing shows that two adjoining bodies are separate
 * parts rather than one.
 */
const hatch = (
  x: number, y: number, w: number, h: number, step: number, colour: string, dir: 1 | -1 = 1,
) => {
  if (w <= 0 || h <= 0) return '';
  const out: string[] = [];
  const x1 = x + w, y1 = y + h;
  const d = Math.max(step, 2);
  if (dir === 1) {
    // Lines of x + y = k, sweeping the whole rectangle.
    for (let k = x + y + d; k < x1 + y1; k += d) {
      const xa = Math.max(x, k - y1), xb = Math.min(x1, k - y);
      if (xb - xa > 0.4) out.push(line({ x: xa, y: k - xa }, { x: xb, y: k - xb }, colour, 0.7));
    }
  } else {
    // Lines of x − y = k.
    for (let k = x - y1 + d; k < x1 - y; k += d) {
      const xa = Math.max(x, y + k), xb = Math.min(x1, y1 + k);
      if (xb - xa > 0.4) out.push(line({ x: xa, y: xa - k }, { x: xb, y: xb - k }, colour, 0.7));
    }
  }
  return out.join('');
};

/** A hatched, outlined body — the unit every section is built from. */
const solidRect = (
  x: number, y: number, w: number, h: number, skin: Skin, s: number, dir: 1 | -1 = 1,
) =>
  `<rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}" fill="${skin.fill}"`
  + ` stroke="${skin.edge}" stroke-width="1.2"/>`
  + hatch(x, y, w, h, s * 0.75, skin.hatch, dir);

/** An arrowhead as a filled triangle, pointing along the vector at→towards. */
const arrow = (at: P, towards: P, size: number) => {
  const dx = towards.x - at.x, dy = towards.y - at.y;
  const L = Math.hypot(dx, dy) || 1;
  const ux = dx / L, uy = dy / L;
  const px = -uy, py = ux;
  const b = { x: at.x + ux * size, y: at.y + uy * size };
  return `<polygon points="${f(at.x)},${f(at.y)} ${f(b.x + px * size * 0.3)},${f(b.y + py * size * 0.3)}`
    + ` ${f(b.x - px * size * 0.3)},${f(b.y - py * size * 0.3)}" fill="${DIM}"/>`;
};

/**
 * A complete linear dimension: two extension lines off the feature, a dimension
 * line between them with an arrowhead at each end, and the value sitting on a
 * cleared patch of that line.
 *
 * When the span is too short to hold its own arrowheads — a two-millimetre gap,
 * a thin build — the heads flip to the outside and point inwards, which is what
 * a draughtsman does and is the only way the dimension stays readable.
 */
const linearDim = (a: P, b: P, off: P, label: string, s: number): string => {
  const A = { x: a.x + off.x, y: a.y + off.y };
  const B = { x: b.x + off.x, y: b.y + off.y };
  const oL = Math.hypot(off.x, off.y) || 1;
  const ox = (off.x / oL) * s * 0.8, oy = (off.y / oL) * s * 0.8;
  const span = Math.hypot(B.x - A.x, B.y - A.y);
  const vertical = Math.abs(B.y - A.y) > Math.abs(B.x - A.x);
  const head = s * 0.85;
  const outside = span < head * 2.6;
  const ux = (B.x - A.x) / (span || 1), uy = (B.y - A.y) / (span || 1);

  const parts = [
    line(a, { x: A.x + ox, y: A.y + oy }, DIM, 0.7),
    line(b, { x: B.x + ox, y: B.y + oy }, DIM, 0.7),
  ];

  if (outside) {
    // Stubs either side, heads pointing in at the two extension lines.
    const tail = s * 2.2;
    parts.push(
      line({ x: A.x - ux * tail, y: A.y - uy * tail }, A, DIM, 0.7),
      line({ x: B.x + ux * tail, y: B.y + uy * tail }, B, DIM, 0.7),
      line(A, B, DIM, 0.7),
      arrow(A, { x: A.x - ux, y: A.y - uy }, head),
      arrow(B, { x: B.x + ux, y: B.y + uy }, head),
    );
  } else {
    parts.push(line(A, B, DIM, 0.7), arrow(A, B, head), arrow(B, A, head));
  }

  // The value: on the line for a normal dimension, off to one side when the
  // heads went outside and there is nothing between them to write on.
  const mid = { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 };
  const tw = label.length * s * 0.5 + s * 0.6;
  const at = outside
    ? { x: B.x + ux * (s * 2.8 + tw / 2), y: B.y + uy * (s * 2.8 + tw / 2) }
    : mid;
  const clear = (vertical && !outside)
    ? `<rect x="${f(at.x - s * 0.8)}" y="${f(at.y - tw / 2)}" width="${f(s * 1.6)}" height="${f(tw)}" fill="#ffffff"/>`
    : `<rect x="${f(at.x - tw / 2)}" y="${f(at.y - s * 0.8)}" width="${f(tw)}" height="${f(s * 1.6)}" fill="#ffffff"/>`;

  parts.push(
    outside ? '' : clear,
    text(at, label, s * 1.1, {
      fill: DIM, weight: 700, rotate: (vertical && !outside) ? -90 : 0,
    }),
  );
  return parts.join('');
};

/** A note written ON the drawing, on a cleared patch so the metal beneath it
 *  does not show through the letters. */
const noteOnPart = (at: P, label: string, s: number) => {
  const w = label.length * s * 0.5 + s * 0.6;
  return `<rect x="${f(at.x - w / 2)}" y="${f(at.y - s * 0.62)}" width="${f(w)}"`
    + ` height="${f(s * 1.24)}" fill="#ffffff"/>`
    + text(at, label, s * 0.9, { fill: NOTE });
};

/** A leader: an arrow on the feature and a note at the end of a short tail. */
const leaderNote = (at: P, to: P, label: string, s: number, colour = INK) => [
  line(at, to, colour, 0.7),
  arrow(at, to, s * 0.8),
  text({ x: to.x + s * 0.5, y: to.y }, label, s * 0.95, { fill: colour, anchor: 'start' }),
].join('');

const centreMarks = (cx: number, cy: number, rx: number, ry = rx) => [
  line({ x: cx - rx, y: cy }, { x: cx + rx, y: cy }, INK, 0.5, '7 3 1.5 3'),
  line({ x: cx, y: cy - ry }, { x: cx, y: cy + ry }, INK, 0.5, '7 3 1.5 3'),
].join('');

/* ── the view model ──────────────────────────────────────────────────────── */

type Ctx = {
  /** Type / arrow scale, in drawing units. Fixed, so labels stay legible
   *  whatever the part's size. */
  s: number;
  /** Millimetres → drawing units, at the drawing's shared scale. */
  m: (mm: number) => number;
  /** This view's centre. */
  cx: number; cy: number;
  /** This view's cell, for a detail that sets its own scale. */
  cw: number; ch: number;
  out: string[];
};

type View = {
  title: string;
  /** Real extent, mm. Drives how much of the sheet the view is given. */
  w: number; h: number;
  /** Room for dimensions and notes, in multiples of the text scale. */
  pad?: { l?: number; r?: number; t?: number; b?: number };
  /** A detail sets its own enlarged scale and says so in its title. */
  ownScale?: boolean;
  draw: (c: Ctx) => void;
};

const PAD_DEFAULT = { l: 1.4, r: 1.4, t: 3.4, b: 3.6 };
const padOf = (v: View) => ({ ...PAD_DEFAULT, ...(v.pad ?? {}) });

/* ── the views themselves ────────────────────────────────────────────────── */

/** Plan of an annular core: the two circles, their diameters, centre marks. */
const annularPlan = (
  id: number, od: number, skin: Skin, extra?: (c: Ctx, ro: number, ri: number) => void,
): View => ({
  title: 'PLAN',
  w: od, h: od,
  draw: (c) => {
    const ro = c.m(od) / 2, ri = c.m(id) / 2;
    c.out.push(
      `<circle cx="${f(c.cx)}" cy="${f(c.cy)}" r="${f(ro)}" fill="${skin.fill}" stroke="${skin.edge}" stroke-width="1.2"/>`,
      `<circle cx="${f(c.cx)}" cy="${f(c.cy)}" r="${f(ri)}" fill="#ffffff" stroke="${skin.edge}" stroke-width="1.2"/>`,
      centreMarks(c.cx, c.cy, ro + c.s * 1.2),
      linearDim(
        { x: c.cx - ro, y: c.cy }, { x: c.cx + ro, y: c.cy },
        { x: 0, y: ro + c.s * 2.4 }, `OD ${n(od)}`, c.s,
      ),
      linearDim(
        { x: c.cx - ri, y: c.cy }, { x: c.cx + ri, y: c.cy },
        { x: 0, y: -(ro + c.s * 2.4) }, `ID ${n(id)}`, c.s,
      ),
    );
    extra?.(c, ro, ri);
  },
});

/**
 * Section of an annular core: two walls with the bore between them.
 *
 * Drawn as two separate bodies rather than one block with a dashed rectangle in
 * it, because that is what a cut through a ring actually looks like — and it is
 * the view where the build-up, the number the trade sizes a core by, is a real
 * measurable width rather than something to be worked out from OD and ID.
 */
const annularSection = (id: number, od: number, ht: number, skin: Skin): View => ({
  title: 'SECTION',
  w: od, h: ht,
  pad: { r: 5.5, b: 4.6 },
  draw: (c) => {
    const ro = c.m(od) / 2, ri = c.m(id) / 2, h = c.m(ht);
    const top = c.cy - h / 2;
    const build = ro - ri;
    c.out.push(
      solidRect(c.cx - ro, top, build, h, skin, c.s),
      solidRect(c.cx + ri, top, build, h, skin, c.s),
      centreMarks(c.cx, c.cy, ro + c.s * 1.2, h / 2 + c.s * 1.2),
      linearDim(
        { x: c.cx + ro, y: top }, { x: c.cx + ro, y: top + h },
        { x: c.s * 2.6, y: 0 }, `HT ${n(ht)}`, c.s,
      ),
      linearDim(
        { x: c.cx - ro, y: top + h }, { x: c.cx - ri, y: top + h },
        { x: 0, y: c.s * 2.4 }, `BUILD ${n((od - id) / 2)}`, c.s,
      ),
    );
  },
});

/** Plan of a window core: outer body, window, all four across-flats. */
const rectPlan = (
  id1: number, id2: number, od1: number, od2: number, skin: Skin,
  extra?: (c: Ctx, W: number, H: number) => void,
): View => ({
  title: 'PLAN',
  w: od1, h: od2,
  pad: { l: 5.4, r: 5.4 },
  draw: (c) => {
    const W = c.m(od1), H = c.m(od2), wI = c.m(id1), hI = c.m(id2);
    const r = c.m(Math.min(od1, od2) * 0.035);
    c.out.push(
      `<rect x="${f(c.cx - W / 2)}" y="${f(c.cy - H / 2)}" width="${f(W)}" height="${f(H)}" rx="${f(r)}"`
      + ` fill="${skin.fill}" stroke="${skin.edge}" stroke-width="1.2"/>`,
      `<rect x="${f(c.cx - wI / 2)}" y="${f(c.cy - hI / 2)}" width="${f(wI)}" height="${f(hI)}"`
      + ` rx="${f(c.m(Math.min(id1, id2) * 0.1))}" fill="#ffffff" stroke="${skin.edge}" stroke-width="1.2"/>`,
      centreMarks(c.cx, c.cy, W / 2 + c.s * 1.2, H / 2 + c.s * 1.2),
      linearDim(
        { x: c.cx - W / 2, y: c.cy + H / 2 }, { x: c.cx + W / 2, y: c.cy + H / 2 },
        { x: 0, y: c.s * 2.4 }, `OD1 ${n(od1)}`, c.s,
      ),
      linearDim(
        { x: c.cx - wI / 2, y: c.cy - hI / 2 }, { x: c.cx + wI / 2, y: c.cy - hI / 2 },
        { x: 0, y: -(H / 2 - hI / 2 + c.s * 2.4) }, `ID1 ${n(id1)}`, c.s,
      ),
      linearDim(
        { x: c.cx - W / 2, y: c.cy - H / 2 }, { x: c.cx - W / 2, y: c.cy + H / 2 },
        { x: -c.s * 2.6, y: 0 }, `OD2 ${n(od2)}`, c.s,
      ),
      linearDim(
        { x: c.cx + wI / 2, y: c.cy - hI / 2 }, { x: c.cx + wI / 2, y: c.cy + hI / 2 },
        { x: (W - wI) / 2 + c.s * 2.6, y: 0 }, `ID2 ${n(id2)}`, c.s,
      ),
    );
    extra?.(c, W, H);
  },
});

/** Section of a window core: a cut across the window, so two limbs stand up. */
const rectSection = (id1: number, od1: number, ht: number, skin: Skin): View => ({
  title: 'SECTION',
  w: od1, h: ht,
  pad: { r: 5.5, b: 4.6 },
  draw: (c) => {
    const W = c.m(od1) / 2, wI = c.m(id1) / 2, h = c.m(ht);
    const top = c.cy - h / 2;
    const build = W - wI;
    c.out.push(
      solidRect(c.cx - W, top, build, h, skin, c.s),
      solidRect(c.cx + wI, top, build, h, skin, c.s),
      centreMarks(c.cx, c.cy, W + c.s * 1.2, h / 2 + c.s * 1.2),
      linearDim(
        { x: c.cx + W, y: top }, { x: c.cx + W, y: top + h },
        { x: c.s * 2.6, y: 0 }, `HT ${n(ht)}`, c.s,
      ),
      linearDim(
        { x: c.cx - W, y: top + h }, { x: c.cx - wI, y: top + h },
        { x: 0, y: c.s * 2.4 }, `BUILD ${n((od1 - id1) / 2)}`, c.s,
      ),
    );
  },
});

/**
 * The joint, enlarged.
 *
 * The one view a cut core cannot do without and the one the shared scale cannot
 * carry: at 1:3 a 2 mm gap is two thirds of a millimetre on paper, and a butt
 * joint is nothing at all. Drawn at whatever scale fills its cell, mirrored
 * hatching on the two halves so they read as separate parts, and labelled
 * "enlarged" so nobody scales a rule off it.
 */
const jointDetail = (gapMm: number, htMm: number, skin: Skin): View => ({
  title: gapMm > 0 ? 'DETAIL A — JOINT (enlarged)' : 'DETAIL A — BUTT JOINT (enlarged)',
  w: 100, h: 62,
  ownScale: true,
  pad: { t: 3.4, b: 4.4 },
  draw: (c) => {
    // One unit of "limb" either side of the joint, sized so the gap is legible
    // even when it is a fraction of a millimetre.
    const gapShare = gapMm > 0 ? Math.min(0.34, Math.max(0.1, gapMm / (gapMm + htMm * 0.9))) : 0;
    const usableW = c.cw - c.s * 2;
    const usableH = c.ch - c.s * 6;
    const g = usableW * gapShare;
    const limb = (usableW - g) / 2;
    const h = Math.min(usableH, limb * 1.5);
    const top = c.cy - h / 2;
    const leftX = c.cx - g / 2 - limb;

    c.out.push(
      solidRect(leftX, top, limb, h, skin, c.s),
      solidRect(c.cx + g / 2, top, limb, h, skin, c.s, -1),
      line({ x: c.cx, y: top - c.s * 1.1 }, { x: c.cx, y: top + h + c.s * 1.1 }, INK, 0.5, '7 3 1.5 3'),
    );

    if (gapMm > 0) {
      c.out.push(
        linearDim(
          { x: c.cx - g / 2, y: top + h }, { x: c.cx + g / 2, y: top + h },
          { x: 0, y: c.s * 2.4 }, `GAP ${n(gapMm)}`, c.s,
        ),
        text({ x: c.cx, y: top - c.s * 1.9 }, 'total across both joints', c.s * 0.92,
          { fill: NOTE }),
      );
    } else {
      c.out.push(
        leaderNote(
          { x: c.cx, y: top + h * 0.5 },
          { x: c.cx + limb * 0.75, y: top + h + c.s * 2.6 },
          'faces lapped, no gap', c.s, NOTE,
        ),
      );
    }
    c.out.push(text(
      { x: c.cx, y: top + h + c.s * (gapMm > 0 ? 4.6 : 4.8) },
      `strip width ${n(htMm)} mm`, c.s * 0.92, { fill: NOTE },
    ));
  },
});

/** The "A" balloon on the plan, marking where the detail was taken from. */
const detailBalloon = (c: Ctx, at: P) => {
  c.out.push(
    `<circle cx="${f(at.x)}" cy="${f(at.y)}" r="${f(c.s * 1.35)}" fill="#ffffff" stroke="${INK}"`
    + ` stroke-width="0.8" stroke-dasharray="4 2.5"/>`,
    text(at, 'A', c.s * 1.05, { weight: 700 }),
  );
};

/* ── which views a shape gets ────────────────────────────────────────────── */

const viewsFor = (shape: CoreShape): View[] => {
  switch (shape.kind) {
    case 'TOROIDAL': {
      const { id, od, ht } = shape.dims;
      return [annularPlan(id, od, STEEL), annularSection(id, od, ht, STEEL)];
    }

    case 'NANO': {
      const { id, od, ht } = shape.dims;
      return [
        annularPlan(id, od, NANO, (c, ro) => {
          if (!shape.cased) return;
          // The case stands 2.5 mm proud of the ribbon all round; shown as an
          // outline so it is clear the bought size is not the wound size.
          c.out.push(
            `<circle cx="${f(c.cx)}" cy="${f(c.cy)}" r="${f(ro + c.m(2.5))}" fill="none"`
            + ` stroke="${NANO.edge}" stroke-width="0.8" stroke-dasharray="5 3"/>`,
            leaderNote(
              { x: c.cx + (ro + c.m(2.5)) * 0.71, y: c.cy - (ro + c.m(2.5)) * 0.71 },
              { x: c.cx + ro * 0.95, y: c.cy - ro - c.s * 2.2 },
              'case', c.s, NOTE,
            ),
          );
        }),
        annularSection(id, od, ht, NANO),
      ];
    }

    case 'CUT_ROUND': {
      const { id, od, ht } = shape.dims;
      return [
        annularPlan(id, od, STEEL, (c, ro, ri) => {
          if (shape.gapMm > 0) {
            c.out.push(
              // One radial joint at the top, matching a real gapped ring.
              line({ x: c.cx, y: c.cy - ro }, { x: c.cx, y: c.cy - ri }, STEEL.edge, 1.5),
              noteOnPart({ x: c.cx + c.s * 1.05, y: c.cy - (ri + ro) / 2 }, 'GAP', c.s),
            );
            detailBalloon(c, { x: c.cx, y: c.cy - (ri + ro) / 2 });
          } else {
            c.out.push(
              line({ x: c.cx - ro, y: c.cy }, { x: c.cx + ro, y: c.cy }, STEEL.edge, 1.5),
              noteOnPart({ x: c.cx - ro * 0.5, y: c.cy - c.s * 1.15 }, 'LINE OF CUT', c.s),
            );
            detailBalloon(c, { x: c.cx + (ri + ro) / 2, y: c.cy });
          }
        }),
        annularSection(id, od, ht, STEEL),
        jointDetail(shape.gapMm, ht, STEEL),
      ];
    }

    case 'RECTANGULAR': {
      const { id1, id2, od1, od2, ht } = shape;
      return [rectPlan(id1, id2, od1, od2, STEEL), rectSection(id1, od1, ht, STEEL)];
    }

    case 'CUT_RECT': {
      const { id1, id2, od1, od2, ht } = shape;
      return [
        rectPlan(id1, id2, od1, od2, STEEL, (c, W) => {
          const cy = c.cy - c.m(cutOffsetMm(id2, shape.cutAt));
          const innerRight = c.cx + c.m(id1) / 2;
          if (shape.gapMm > 0) {
            c.out.push(
              // A gapped rectangular core is one C-shaped path with its joint
              // on the right limb, not two halves divided through the part.
              line({ x: innerRight, y: cy }, { x: c.cx + W / 2, y: cy }, STEEL.edge, 1.5),
              noteOnPart({ x: innerRight + c.s * 0.8, y: cy - c.s * 1.15 }, 'GAP', c.s),
            );
            detailBalloon(c, { x: c.cx + W / 2 - c.m((od1 - id1) / 4), y: cy });
          } else {
            c.out.push(
              line({ x: c.cx - W / 2, y: cy }, { x: c.cx + W / 2, y: cy }, STEEL.edge, 1.5),
              noteOnPart({ x: c.cx, y: cy - c.s * 1.15 }, 'LINE OF CUT', c.s),
            );
            detailBalloon(c, { x: c.cx + W / 2 - c.m((od1 - id1) / 4), y: cy });
          }
        }),
        rectSection(id1, od1, ht, STEEL),
        jointDetail(shape.gapMm, ht, STEEL),
      ];
    }

    /* An EI core is drawn front-on, because that is the view its four figures
       live in: the tongue, the two windows and the yokes are all in it. The
       side view carries the stack, the one thing the front cannot show. */
    case 'E_CORE': {
      const o = eCoreOutline(shape);
      return [{
        title: 'FRONT — OPEN E', w: o.width, h: o.eHeight,
        pad: { l: 5.4, r: 5.4, b: 4.2 },
        draw: (c) => {
          const W=c.m(o.width), H=c.m(o.eHeight), t=c.m(shape.tongue), y=c.m(o.yoke);
          const l=c.cx-W/2, top=c.cy-H/2, b=top+H;
          c.out.push(`<path d="M ${f(l)} ${f(b)} L ${f(l+W)} ${f(b)} L ${f(l+W)} ${f(top)} L ${f(l+W-y)} ${f(top)} L ${f(l+W-y)} ${f(b-y)} L ${f(c.cx+t/2)} ${f(b-y)} L ${f(c.cx+t/2)} ${f(top)} L ${f(c.cx-t/2)} ${f(top)} L ${f(c.cx-t/2)} ${f(b-y)} L ${f(l+y)} ${f(b-y)} L ${f(l+y)} ${f(top)} L ${f(l)} ${f(top)} Z" fill="${STEEL.fill}" stroke="${STEEL.edge}" stroke-width="1.2"/>`,
            linearDim({x:l,y:b},{x:l+W,y:b},{x:0,y:c.s*2.4},n(o.width),c.s),
            linearDim({x:l,y:top},{x:l,y:b},{x:-c.s*2.4,y:0},n(o.eHeight),c.s),
            linearDim({x:c.cx-t/2,y:top},{x:c.cx+t/2,y:top},{x:0,y:-c.s*2.4},`T ${n(shape.tongue)}`,c.s),
            linearDim({x:l+y,y:top},{x:c.cx-t/2,y:top},{x:0,y:c.s*2},`W ${n(shape.windowW)}`,c.s));
        },
      },{
        title:'SIDE',w:shape.stack,h:o.eHeight,pad:{r:5.5},
        draw:(c)=>{
          const D=c.m(shape.stack),H=c.m(o.eHeight),l=c.cx-D/2,t=c.cy-H/2;
          c.out.push(solidRect(l,t,D,H,STEEL,c.s),linearDim({x:l,y:t+H},{x:l+D,y:t+H},{x:0,y:c.s*2.4},`STACK ${n(shape.stack)}`,c.s));
        },
      }];
    }
    case 'EI_CORE': {
      const o = eCoreOutline(shape);
      return [
        {
          title: 'FRONT — E + I',
          w: o.width, h: o.height,
          pad: { l: 5.4, r: 5.4, b: 4.2 },
          draw: (c) => {
            const W = c.m(o.width), H = c.m(o.height);
            const yoke = c.m(o.yoke), win = c.m(shape.windowW), winH = c.m(shape.windowH);
            const left = c.cx - W / 2, top = c.cy - H / 2;
            const white = (x: number, y: number, w: number, h: number) =>
              `<rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}" fill="#ffffff"`
              + ` stroke="${STEEL.edge}" stroke-width="1.2"/>`;
            /* The I bar is its own body with its hatching mirrored, because it
               is a separate part: that is how a drawing says so. */
            c.out.push(
              solidRect(left, top, W, yoke, STEEL, c.s, -1),
              solidRect(left, top + yoke, W, H - yoke, STEEL, c.s),
              white(left + yoke, top + yoke, win, winH),
              white(left + W - yoke - win, top + yoke, win, winH),
              line({ x: left, y: top + yoke }, { x: left + W, y: top + yoke }, INK, 0.9, '9 3 2 3'),
              noteOnPart({ x: c.cx, y: top + yoke * 0.5 }, 'I', c.s),
              centreMarks(c.cx, c.cy, W / 2 + c.s * 1.2, H / 2 + c.s * 1.2),
              linearDim(
                { x: left, y: top + H }, { x: left + W, y: top + H },
                { x: 0, y: c.s * 2.4 }, n(o.width), c.s,
              ),
              linearDim(
                { x: c.cx - c.m(shape.tongue) / 2, y: top + yoke },
                { x: c.cx + c.m(shape.tongue) / 2, y: top + yoke },
                { x: 0, y: -(yoke + c.s * 2.4) }, `T ${n(shape.tongue)}`, c.s,
              ),
              linearDim(
                { x: left + yoke, y: top + yoke }, { x: left + yoke + win, y: top + yoke },
                { x: 0, y: winH + c.s * 2.2 }, `W ${n(shape.windowW)}`, c.s,
              ),
              linearDim(
                { x: left + yoke, y: top + yoke }, { x: left + yoke, y: top + yoke + winH },
                { x: -(yoke + c.s * 2.6), y: 0 }, `H ${n(shape.windowH)}`, c.s,
              ),
            );
          },
        },
        {
          title: 'SIDE',
          w: shape.stack, h: o.height,
          pad: { r: 5.5 },
          draw: (c) => {
            const D = c.m(shape.stack), H = c.m(o.height), yoke = c.m(o.yoke);
            const left = c.cx - D / 2, top = c.cy - H / 2;
            c.out.push(
              solidRect(left, top, D, yoke, STEEL, c.s, -1),
              solidRect(left, top + yoke, D, H - yoke, STEEL, c.s),
              centreMarks(c.cx, c.cy, D / 2 + c.s * 1.2, H / 2 + c.s * 1.2),
              linearDim(
                { x: left, y: top + H }, { x: left + D, y: top + H },
                { x: 0, y: c.s * 2.4 }, `STACK ${n(shape.stack)}`, c.s,
              ),
              linearDim(
                { x: left + D, y: top }, { x: left + D, y: top + H },
                { x: c.s * 2.6, y: 0 }, n(o.height), c.s,
              ),
            );
          },
        },
      ];
    }

    /* The obround. Same plan as the rectangular but with true semicircular
       ends — the difference is the whole product, so the drawing shows it
       rather than leaving it to a note. */
    case 'WOUND_CORE': {
      const { id1, id2, od1, od2, ht } = shape;
      return [
        {
          title: 'PLAN',
          w: od1, h: od2,
          pad: { l: 5.4, r: 5.4 },
          draw: (c) => {
            const W = c.m(od1), H = c.m(od2), wI = c.m(id1), hI = c.m(id2);
            const stadium = (x: number, y: number, w: number, h: number, fill: string) => {
              const r = Math.min(w, h) / 2;
              return `<rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}"`
                + ` rx="${f(r)}" ry="${f(r)}" fill="${fill}" stroke="${STEEL.edge}" stroke-width="1.2"/>`;
            };
            c.out.push(
              stadium(c.cx - W / 2, c.cy - H / 2, W, H, STEEL.fill),
              stadium(c.cx - wI / 2, c.cy - hI / 2, wI, hI, '#ffffff'),
              centreMarks(c.cx, c.cy, W / 2 + c.s * 1.2, H / 2 + c.s * 1.2),
              linearDim(
                { x: c.cx - W / 2, y: c.cy + H / 2 }, { x: c.cx + W / 2, y: c.cy + H / 2 },
                { x: 0, y: c.s * 2.4 }, `OD1 ${n(od1)}`, c.s,
              ),
              linearDim(
                { x: c.cx - wI / 2, y: c.cy - hI / 2 }, { x: c.cx + wI / 2, y: c.cy - hI / 2 },
                { x: 0, y: -((H - hI) / 2 + c.s * 2.4) }, `ID1 ${n(id1)}`, c.s,
              ),
              linearDim(
                { x: c.cx - W / 2, y: c.cy - H / 2 }, { x: c.cx - W / 2, y: c.cy + H / 2 },
                { x: -c.s * 2.6, y: 0 }, `OD2 ${n(od2)}`, c.s,
              ),
              linearDim(
                { x: c.cx + wI / 2, y: c.cy - hI / 2 }, { x: c.cx + wI / 2, y: c.cy + hI / 2 },
                { x: (W - wI) / 2 + c.s * 2.6, y: 0 }, `ID2 ${n(id2)}`, c.s,
              ),
              noteOnPart({ x: c.cx, y: c.cy }, `R${n(Math.min(id1, id2) / 2)} ENDS`, c.s),
            );
          },
        },
        rectSection(id1, od1, ht, STEEL),
      ];
    }

    /* The stepped limb, end-on: the view the steps exist in, inside the circle
       they are cut to fill. */
    case 'STEP_CORE': {
      const sp = stepCoreSpan(shape);
      const minId1 = Math.min(...shape.steps.map((step) => step.id1));
      const minId2 = Math.min(...shape.steps.map((step) => step.id2));
      return [
        {
          title: 'LIMB SECTION',
          w: sp.circle, h: sp.circle,
          pad: { l: 5.4, r: 5.4, b: 4.2 },
          draw: (c) => {
            const R = c.m(sp.circle) / 2;
            c.out.push(
              `<circle cx="${f(c.cx)}" cy="${f(c.cy)}" r="${f(R)}" fill="none"`
              + ` stroke="${DIM}" stroke-width="0.8" stroke-dasharray="6 4"/>`,
            );
            let y = c.cy - c.m(sp.depth) / 2;
            shape.steps.forEach((st) => {
              const w = c.m(st.id1), h = c.m(st.builtup);
              c.out.push(solidRect(c.cx - w / 2, y, w, h, STEEL, c.s));
              y += h;
            });
            c.out.push(
              centreMarks(c.cx, c.cy, R + c.s * 1.2),
              linearDim(
                { x: c.cx - c.m(sp.width) / 2, y: c.cy + c.m(sp.depth) / 2 },
                { x: c.cx + c.m(sp.width) / 2, y: c.cy + c.m(sp.depth) / 2 },
                { x: 0, y: c.s * 2.4 }, n(sp.width), c.s,
              ),
              linearDim(
                { x: c.cx + c.m(sp.width) / 2, y: c.cy - c.m(sp.depth) / 2 },
                { x: c.cx + c.m(sp.width) / 2, y: c.cy + c.m(sp.depth) / 2 },
                { x: c.s * 2.6, y: 0 }, n(sp.depth), c.s,
              ),
              text({ x: c.cx, y: c.cy - R - c.s * 1.4 }, `\u00d8 ${n(sp.circle)}`, c.s * 1.05,
                { fill: DIM, weight: 700 }),
            );
          },
        },
        {
          title: 'WINDOW',
          w: minId1, h: minId2,
          pad: { l: 5.4, r: 5.4 },
          draw: (c) => {
            const W = c.m(minId1), H = c.m(minId2);
            c.out.push(
              `<rect x="${f(c.cx - W / 2)}" y="${f(c.cy - H / 2)}" width="${f(W)}" height="${f(H)}"`
              + ` fill="#ffffff" stroke="${STEEL.edge}" stroke-width="1.2" stroke-dasharray="7 4"/>`,
              centreMarks(c.cx, c.cy, W / 2 + c.s * 1.2, H / 2 + c.s * 1.2),
              linearDim(
                { x: c.cx - W / 2, y: c.cy + H / 2 }, { x: c.cx + W / 2, y: c.cy + H / 2 },
                { x: 0, y: c.s * 2.4 }, `ID1 ${n(minId1)}`, c.s,
              ),
              linearDim(
                { x: c.cx - W / 2, y: c.cy - H / 2 }, { x: c.cx - W / 2, y: c.cy + H / 2 },
                { x: -c.s * 2.6, y: 0 }, `ID2 ${n(minId2)}`, c.s,
              ),
              text({ x: c.cx, y: c.cy }, 'magnetic path', c.s * 0.95, { fill: NOTE }),
            );
          },
        },
      ];
    }

    case 'COMPOSITE': {
      const { totalHt } = compositeLayout(shape.rule, shape.crgo, shape.nano);
      const od = Math.max(shape.crgo.od, shape.nano.od);
      const id = Math.min(shape.crgo.id, shape.nano.id);
      const loop = shape.rule === 'CONTINUOUS_LOOP';
      const outerIsCrgo = shape.crgo.od >= shape.nano.od;

      return [
        {
          title: 'PLAN',
          w: od, h: od,
          draw: (c) => {
            const ro = c.m(od) / 2, ri = c.m(id) / 2;
            if (loop) {
              const outer = outerIsCrgo ? shape.crgo : shape.nano;
              const inner = outerIsCrgo ? shape.nano : shape.crgo;
              const oSkin = outerIsCrgo ? STEEL : NANO;
              const iSkin = outerIsCrgo ? NANO : STEEL;
              c.out.push(
                `<circle cx="${f(c.cx)}" cy="${f(c.cy)}" r="${f(c.m(outer.od) / 2)}" fill="${oSkin.fill}" stroke="${oSkin.edge}" stroke-width="1.2"/>`,
                `<circle cx="${f(c.cx)}" cy="${f(c.cy)}" r="${f(c.m(outer.id) / 2)}" fill="${iSkin.fill}" stroke="${iSkin.edge}" stroke-width="1.2"/>`,
                `<circle cx="${f(c.cx)}" cy="${f(c.cy)}" r="${f(c.m(inner.id) / 2)}" fill="#ffffff" stroke="${iSkin.edge}" stroke-width="1.2"/>`,
                leaderNote(
                  { x: c.cx - (c.m(outer.od) / 2) * 0.86, y: c.cy - (c.m(outer.od) / 2) * 0.5 },
                  { x: c.cx - ro - c.s * 0.5, y: c.cy - ro - c.s * 1.8 },
                  outerIsCrgo ? 'CRGO' : 'Nano', c.s, NOTE,
                ),
              );
            } else {
              c.out.push(
                `<circle cx="${f(c.cx)}" cy="${f(c.cy)}" r="${f(ro)}" fill="${STEEL.fill}" stroke="${STEEL.edge}" stroke-width="1.2"/>`,
                `<circle cx="${f(c.cx)}" cy="${f(c.cy)}" r="${f(ri)}" fill="#ffffff" stroke="${STEEL.edge}" stroke-width="1.2"/>`,
              );
            }
            c.out.push(
              centreMarks(c.cx, c.cy, ro + c.s * 1.2),
              linearDim(
                { x: c.cx - ro, y: c.cy }, { x: c.cx + ro, y: c.cy },
                { x: 0, y: ro + c.s * 2.4 }, `OD ${n(od)}`, c.s,
              ),
              linearDim(
                { x: c.cx - ri, y: c.cy }, { x: c.cx + ri, y: c.cy },
                { x: 0, y: -(ro + c.s * 2.4) }, `ID ${n(id)}`, c.s,
              ),
            );
          },
        },
        {
          title: 'SECTION',
          w: od, h: totalHt,
          pad: { r: 6.5, b: 4.2 },
          draw: (c) => {
            const H = c.m(totalHt);
            const top = c.cy - H / 2;
            const wall = (t: { id: number; od: number }, y: number, h: number, skin: Skin) => {
              const ro = c.m(t.od) / 2, ri = c.m(t.id) / 2;
              c.out.push(
                solidRect(c.cx - ro, y, ro - ri, h, skin, c.s),
                solidRect(c.cx + ri, y, ro - ri, h, skin, c.s),
              );
            };
            if (loop) {
              wall(shape.crgo, c.cy - c.m(shape.crgo.ht) / 2, c.m(shape.crgo.ht), STEEL);
              wall(shape.nano, c.cy - c.m(shape.nano.ht) / 2, c.m(shape.nano.ht), NANO);
            } else {
              wall(shape.nano, top, c.m(shape.nano.ht), NANO);
              wall(shape.crgo, top + c.m(shape.nano.ht), c.m(shape.crgo.ht), STEEL);
              c.out.push(
                leaderNote(
                  { x: c.cx + c.m(shape.nano.od) / 2 * 0.8, y: top + c.m(shape.nano.ht) / 2 },
                  { x: c.cx + c.m(od) / 2 + c.s * 0.8, y: top - c.s * 1.6 },
                  'Nano', c.s, NOTE,
                ),
                leaderNote(
                  { x: c.cx + c.m(shape.crgo.od) / 2 * 0.8, y: top + c.m(shape.nano.ht) + c.m(shape.crgo.ht) / 2 },
                  { x: c.cx + c.m(od) / 2 + c.s * 0.8, y: top + H + c.s * 1.6 },
                  'CRGO', c.s, NOTE,
                ),
              );
            }
            c.out.push(linearDim(
              { x: c.cx + c.m(od) / 2, y: top }, { x: c.cx + c.m(od) / 2, y: top + H },
              { x: c.s * 3.4, y: 0 }, `HT ${n(totalHt)}`, c.s,
            ));
          },
        },
      ];
    }
  }
};

/* ── layout ──────────────────────────────────────────────────────────────── */

export type SketchResult = {
  svg: string; width: number; height: number;
  /** Drawing units per millimetre of real part. */
  unitsPerMm: number;
};

/**
 * The drawing's scale, written the way a title block writes it.
 *
 * `mmPerUnit` is how big one drawing unit ends up on paper, which only the
 * renderer knows: on the PDF a unit is a point scaled by however much pdfmake
 * stretched the SVG to fit the column. Without it the ratio is pixels per
 * millimetre, which is not a scale and printing it as one is a lie — a raster
 * has no physical size at all, which is why the JPG says NTS instead.
 */
export const scaleLabel = (unitsPerMm: number, mmPerUnit: number) => {
  const r = unitsPerMm * mmPerUnit;
  if (!(r > 0)) return '—';
  if (r >= 0.995) return `${Number(r.toFixed(r >= 10 ? 0 : 1))}:1`;
  const inv = 1 / r;
  return `1:${Number(inv.toFixed(inv >= 10 ? 0 : 1))}`;
};

/**
 * Draw the shape into `width` x `height`.
 *
 * The scale is solved rather than guessed: every view's real width is summed,
 * the room its dimensions need is subtracted first, and what is left divides
 * out. The previous version multiplied a rough fit by 0.62 for safety, which is
 * why the part sat small in a sea of white on every sheet.
 */
export const buildSketch = (shape: CoreShape, width = 720, height = 340): SketchResult => {
  const s = Math.max(8.5, Math.min(width / 58, height / 26));
  const views = viewsFor(shape);
  const gutter = s * 2.6;
  const marginX = s * 1.6;
  const marginTop = s * 3.2;             // the view titles live here
  const marginBottom = s * 1.4;

  const pads = views.map(padOf);
  const padX = pads.reduce((t, p) => t + (p.l + p.r) * s, 0);
  const padY = Math.max(...pads.map((p) => (p.t + p.b) * s));

  // Detail views are given a share of the sheet but do not join the shared
  // scale, so they must not drag it down: their nominal extent is excluded.
  const scaled = views.filter((v) => !v.ownScale);
  const sumW = scaled.reduce((t, v) => t + v.w, 0) || 1;
  const maxH = Math.max(1, ...scaled.map((v) => v.h));

  // A detail takes a fixed slice of the width; the rest is shared by scale.
  const detailShare = views.filter((v) => v.ownScale).length * 0.26;
  const availW = width - marginX * 2 - gutter * (views.length - 1) - padX;
  const availH = height - marginTop - marginBottom - padY;
  const scale = Math.max(0.01, Math.min(
    (availW * (1 - detailShare)) / sumW,
    availH / maxH,
  ));

  const m = (mm: number) => mm * scale;
  const cy = marginTop + (height - marginTop - marginBottom) / 2;

  const cellW = views.map((v) => (v.ownScale
    ? (availW * detailShare) / Math.max(1, views.filter((x) => x.ownScale).length)
    : m(v.w)));

  /* Centre the block of views. The scale is usually settled by height rather
     than width — a core is wider than it is tall — so the drawing would
     otherwise sit hard left with a third of the sheet blank beside it. */
  const used = cellW.reduce((t, w, i) => t + w + (pads[i].l + pads[i].r) * s, 0)
    + gutter * (views.length - 1);
  const out: string[] = [];
  let x = Math.max(marginX, (width - used) / 2);
  views.forEach((v, i) => {
    const p = pads[i];
    const cx = x + p.l * s + cellW[i] / 2;
    out.push(text({ x: cx, y: marginTop * 0.52 }, v.title, s * 1.02,
      { fill: INK, weight: 700, opacity: 0.68 }));
    v.draw({
      s, m, cx, cy,
      cw: cellW[i], ch: height - marginTop - marginBottom - p.t * s,
      out,
    });
    x += p.l * s + cellW[i] + p.r * s + gutter;
  });

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`
    + `<rect x="0" y="0" width="${width}" height="${height}" fill="#ffffff"/>`
    + out.join('')
    // No units note here: the sheet prints one in its own title block, and two
    // of them land on top of each other.
    + `</svg>`;

  return { svg, width, height, unitsPerMm: scale };
};

/** The drawing's own name for the part, used as the sheet's sub-heading. */
export const sketchSubject = (shape: CoreShape): string => {
  switch (shape.kind) {
    case 'CUT_RECT': return cutCoreCode(shape.id1, shape.id2, shape.od1, shape.ht);
    default: return '';
  }
};
