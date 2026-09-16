// Shape description and the pure reasoning about it.
//
// Deliberately free of any three.js import. This module is pulled in by the
// order form itself, while the THREE builders next door are behind a lazy
// boundary — put them in one file and the whole of three.js is hoisted into the
// page chunk, which is exactly what happened the first time (a 53KB page became
// 633KB). Anything here must stay importable without a 3D engine.
import type { CompositeRule } from '@/lib/calc';

export type Tri = { id: number; od: number; ht: number };

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
  | { kind: 'CUT_RECT'; id1: number; id2: number; od1: number; od2: number; ht: number; gapMm: number }
  | { kind: 'NANO'; dims: Tri; cased: boolean }
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
      return s.id1 > 0 && s.id2 > 0 && s.od1 > 0 && s.od2 > 0 && s.ht > 0
        && s.od1 > s.id1 && s.od2 > s.id2;
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
    case 'CUT_RECT': return Math.max(s.od1, s.od2, s.ht);
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
  }
};
