// Shape description and the pure reasoning about it.
//
// Deliberately free of any three.js import. This module is pulled in by the
// order form itself, while the THREE builders next door are behind a lazy
// boundary — put them in one file and the whole of three.js is hoisted into the
// page chunk, which is exactly what happened the first time (a 53KB page became
// 633KB). Anything here must stay importable without a 3D engine.
import type { CompositeRule } from '@/lib/calc';

export type Tri = { id: number; od: number; ht: number };

/** Where the line of cut sits on a cut core. */
export type CutAt = 'TOP' | 'CENTRE' | 'BOTTOM';

/**
 * How far off centre the line of cut sits, in mm along the ID2 axis.
 *
 * A quarter of the window each way: far enough to see and to matter, and still
 * across the limbs rather than through the yoke — cut past the window and you
 * are no longer making two C halves, you are making a C and a lid.
 */
export const cutOffsetMm = (id2: number, at: CutAt | undefined) =>
  (at === 'TOP' ? id2 / 4 : at === 'BOTTOM' ? -id2 / 4 : 0);

export const CUT_AT_LABEL: Record<CutAt, string> = {
  TOP: 'Nearer the top yoke',
  CENTRE: 'Centre — two equal halves',
  BOTTOM: 'Nearer the bottom yoke',
};

export type CoreShape =
  | { kind: 'TOROIDAL'; dims: Tri }
  /** A toroid cut into two mating C halves. Dimensioned by the core it was cut
   *  from, so the weight and area formulas are the toroidal ones; `gapMm` is
   *  the total controlled air gap across both joints, 0 for a plain cut core. */
  | { kind: 'CUT_ROUND'; dims: Tri; gapMm: number }
  | { kind: 'RECTANGULAR'; id1: number; id2: number; od1: number; od2: number; ht: number }
  /** A rectangular window core sawn straight across both limbs into two C
   *  halves. Same dimensions as the ring it came from; `gapMm` is the total
   *  controlled air gap across both joints. */
  | {
      kind: 'CUT_RECT'; id1: number; id2: number; od1: number; od2: number; ht: number;
      gapMm: number;
      /** Where along the limbs the line of cut falls. Centre gives two equal C
       *  halves; top or bottom gives a deep C and a shallow one. */
      cutAt?: CutAt;
    }
  | { kind: 'NANO'; dims: Tri; cased: boolean }
  /** A stacked E+I lamination core, quoted the way the trade quotes it: the
   *  centre limb (tongue), the window it encloses, and the stack depth. The
   *  outer limbs are half the tongue and the yokes likewise, which is what
   *  makes an E an E rather than a set of four free dimensions. */
  | { kind: 'E_CORE'; tongue: number; windowW: number; windowH: number; stack: number }
  /** A wound core with radiused ends — the obround, or racetrack. Same five
   *  dimensions as the rectangular, but the ends are true semicircles, which
   *  is both what a strip can actually be wound around and what shortens the
   *  magnetic path against a square-cornered window of the same size. */
  | { kind: 'WOUND_CORE'; id1: number; id2: number; od1: number; od2: number; ht: number }
  /** A limb whose section is stepped to approximate a circle — plates of
   *  decreasing width stacked to fill a bore. The steps give the area; the
   *  window it is built into gives the magnetic path. */
  | { kind: 'STEP_CORE'; steps: { width: number; stack: number }[]; id1: number; id2: number }
  | { kind: 'COMPOSITE'; rule: CompositeRule; crgo: Tri; nano: Tri };

export const triOk = (t: Tri) => t.id > 0 && t.od > 0 && t.ht > 0 && t.od > t.id;

export const shapeIsDrawable = (s: CoreShape): boolean => {
  switch (s.kind) {
    case 'TOROIDAL':
    case 'NANO':
    case 'CUT_ROUND':
      return triOk(s.dims);
    case 'RECTANGULAR':
    case 'CUT_RECT':
    case 'WOUND_CORE':
      return s.id1 > 0 && s.id2 > 0 && s.od1 > 0 && s.od2 > 0 && s.ht > 0
        && s.od1 > s.id1 && s.od2 > s.id2;
    case 'E_CORE':
      return s.tongue > 0 && s.windowW > 0 && s.windowH > 0 && s.stack > 0;
    case 'STEP_CORE':
      return s.id1 > 0 && s.id2 > 0
        && s.steps.length > 0 && s.steps.every((t) => t.width > 0 && t.stack > 0);
    case 'COMPOSITE':
      return triOk(s.crgo) && triOk(s.nano);
  }
};

/** Where the two halves of a composite sit relative to each other.
 *  Mirrors compositeCalc() in lib/calc.ts: concentric for a continuous loop,
 *  stacked (heights adding) for the two split rules. */
export const compositeLayout = (rule: CompositeRule, crgo: Tri, nano: Tri) => {
  if (rule === 'CONTINUOUS_LOOP') {
    // Concentric and the same height — each keeps its own radii, both centred.
    return { crgoY: 0, nanoY: 0, totalHt: Math.max(crgo.ht, nano.ht) };
  }
  // Stacked: CRGO below, nano above, the pair centred on the origin.
  const total = crgo.ht + nano.ht;
  return {
    crgoY: -total / 2 + crgo.ht / 2,
    nanoY: total / 2 - nano.ht / 2,
    totalHt: total,
  };
};

/** The largest dimension in play, used to frame the camera and size the floor
 *  grid. Without this a 90mm core and a 900mm core would look identical. */
export const shapeExtent = (s: CoreShape): number => {
  switch (s.kind) {
    case 'TOROIDAL':
    case 'CUT_ROUND': return Math.max(s.dims.od, s.dims.ht);
    case 'NANO':     return Math.max(s.dims.od + 5, s.dims.ht + 5);
    case 'RECTANGULAR':
    case 'CUT_RECT':
    case 'WOUND_CORE': return Math.max(s.od1, s.od2, s.ht);
    case 'E_CORE': return Math.max(eCoreOutline(s).width, eCoreOutline(s).height, s.stack);
    case 'STEP_CORE': return Math.max(
      s.id1, s.id2,
      s.steps.reduce((t, x) => Math.max(t, x.width), 0),
      s.steps.reduce((t, x) => t + x.stack, 0),
    );
    case 'COMPOSITE': {
      const { totalHt } = compositeLayout(s.rule, s.crgo, s.nano);
      return Math.max(s.crgo.od, s.nano.od, totalHt);
    }
  }
};

/**
 * A cut core written the way the trade writes it: CD strip x build x window
 * width / window height, as it appears on the customer's own drawing — e.g.
 * CD 43x43x50/125. The build-up is derived, being half the difference between
 * the outer and the window on that axis.
 */
export const cutCoreCode = (
  id1: number, id2: number, od1: number, ht: number,
) => {
  const n2 = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));
  const build = (od1 - id1) / 2;
  return `CD ${n2(ht)}x${n2(build)}x${n2(id1)}/${n2(id2)}`;
};

/**
 * The E's outline, derived from the four figures the trade quotes.
 *
 * Outer limbs are half the tongue and the yokes the same, so the flux divides
 * evenly and each half-limb carries half the centre limb's flux. Writing it
 * down once here keeps the drawing, the 3D solid and the weight agreeing about
 * what the part looks like.
 */
export const eCoreOutline = (s: { tongue: number; windowW: number; windowH: number }) => {
  const yoke = s.tongue / 2;
  return {
    yoke,
    /** Across the laminations: half-limb, window, tongue, window, half-limb. */
    width: s.tongue * 2 + s.windowW * 2,
    /** The E alone; the I sits on top of it. */
    eHeight: s.windowH + yoke,
    /** E plus the I bar that closes it. */
    height: s.windowH + s.tongue,
  };
};

/** Total stacked depth of a step core, and the bore it fits. */
export const stepCoreSpan = (s: { steps: { width: number; stack: number }[] }) => {
  const depth = s.steps.reduce((t, x) => t + x.stack, 0);
  const width = s.steps.reduce((t, x) => Math.max(t, x.width), 0);
  // The circle the stepped section is inscribed in — the figure a limb is
  // actually specified by, and the one the winding has to clear.
  const circle = Math.sqrt(width * width + depth * depth);
  return { depth, width, circle };
};

const KIND_NAME = {
  TOROIDAL: 'Toroidal core',
  RECTANGULAR: 'Rectangular core',
  NANO: 'Nano core',
  COMPOSITE: 'Composite core',
  CUT_ROUND: 'Round cut core',
  CUT_RECT: 'Rectangular cut core',
  E_CORE: 'E core',
  WOUND_CORE: 'Wound core',
  STEP_CORE: 'Step core',
} as const;

/**
 * What to call the product.
 *
 * Lives here, with the shape, because a gapped core is a different product from
 * the plain cut core it is made from and three separate places had started
 * deciding that for themselves — the form heading, the preview panel and the
 * spec sheet. Three copies of one rule is two copies too many.
 */
export const shapeTitle = (s: CoreShape): string =>
  (s.kind === 'CUT_ROUND' && s.gapMm > 0) ? 'Round gap core'
  : (s.kind === 'CUT_RECT' && s.gapMm > 0) ? 'Rectangular gap core'
  : KIND_NAME[s.kind];

/** The measure string shown under the viewer — same wording as the form. */
export const shapeCaption = (s: CoreShape): string => {
  const n = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));
  switch (s.kind) {
    case 'TOROIDAL':
    case 'NANO':
      return `${n(s.dims.id)} × ${n(s.dims.od)} × ${n(s.dims.ht)} mm`;
    case 'CUT_ROUND':
      return `${n(s.dims.id)} × ${n(s.dims.od)} × ${n(s.dims.ht)} mm`
        + (s.gapMm > 0 ? ` · gap ${n(s.gapMm)}` : '');
    case 'RECTANGULAR':
      return `${n(s.id1)} × ${n(s.id2)} × ${n(s.od1)} × ${n(s.od2)} × ${n(s.ht)} mm`;
    case 'CUT_RECT':
      // The trade writes a cut core as CD strip x build x window x window,
      // which is how the customer's own drawing will name it.
      return cutCoreCode(s.id1, s.id2, s.od1, s.ht)
        + (s.gapMm > 0 ? ` · gap ${n(s.gapMm)}` : '');
    case 'COMPOSITE': {
      const { totalHt } = compositeLayout(s.rule, s.crgo, s.nano);
      const id = Math.min(s.crgo.id, s.nano.id);
      const od = Math.max(s.crgo.od, s.nano.od);
      return `${n(id)} × ${n(od)} × ${n(totalHt)} mm`;
    }
    case 'E_CORE':
      // Tongue first, because that is the figure an E core is ordered by.
      return `T${n(s.tongue)} · window ${n(s.windowW)} × ${n(s.windowH)} · stack ${n(s.stack)} mm`;
    case 'WOUND_CORE':
      return `${n(s.id1)} × ${n(s.id2)} × ${n(s.od1)} × ${n(s.od2)} × ${n(s.ht)} mm · radiused`;
    case 'STEP_CORE': {
      const { circle, depth } = stepCoreSpan(s);
      return `${s.steps.length} steps · Ø${n(circle)} · build ${n(depth)} · window ${n(s.id1)} × ${n(s.id2)} mm`;
    }
  }
};
