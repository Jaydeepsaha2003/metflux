// What goes ON the spec sheet, decided once and rendered twice.
//
// The PDF and the JPG used to each own their own idea of the content, which is
// how the two quietly drift apart: a figure added to one is missing from the
// other and nobody notices until a customer holds both. So the sheet is built
// as a model here — sections, rows, working lines, notes — and the two
// renderers next door do nothing but lay it out.
//
// The aim is that every number on the order line can be checked from this sheet
// alone: what was ordered, what it measures, what area and path that gives,
// what it therefore weighs, and what it should read on test. A figure with no
// working beside it is a figure a customer has to take on trust.
import {
  TOROIDAL_FACTOR, RECT_STACK_FACTOR, stackOr,
  toroidalGrossArea, toroidalMeanPath,
} from '@/lib/calc';
import {
  MATERIALS, materialOf, factorToSF, netArea, testVoltage, gapAmpereTurns,
  type MaterialKey,
} from '@/lib/coreMaterials';
import {
  compositeLayout, cutCoreCode, eCoreOutline, stepCoreSpan, shapeCaption, shapeTitle,
  type CoreShape,
} from './shape';
import {
  eCoreMeanPath, woundMeanPath, stepGrossArea, defaultRectStack,
} from '@/lib/calc';

export type SheetMeta = {
  company?: string | null;
  customer?: string | null;
  orderNo?: string | null;
  grade?: string | null;
  material?: string | null;
  pcs?: number | null;
  /** Stacking factor actually used for this line. */
  factor?: number | null;
  weightPerPc?: number | null;
  totalWeight?: number | null;
  /* The magnetic test figures, when the line carries them. A gapped core is
     bought for its ampere-turns as much as its weight, so the sheet has to
     show how the test voltage and the magnetising current were arrived at. */
  turns?: number | null;
  flux?: number | null;
  ateCm?: number | null;
  testVoltage?: number | null;
  testCurrent?: number | null;
  /** Ampere-turns the steel path needs on its own. */
  steelAt?: number | null;
  /** Ampere-turns the air gap needs — usually the larger share. */
  gapAt?: number | null;
  /** The grade's whole ATe/cm curve, so the sheet can tabulate every test
   *  level rather than only the one this line happens to be booked at. */
  fluxPoints?: { flux: number; ateCm: number }[] | null;
  /** Material family. Absent = CRGO. */
  alloy?: MaterialKey | null;
};

export type Section = {
  heading: string;
  rows?: [string, string][];
  /** A columnar table — the test figures at each flux level. */
  table?: { head: string[]; rows: string[][] };
  /** Free lines. Notes only: the sheet carries no formulas. */
  lines?: string[];
};

export type SheetModel = {
  title: string;
  subtitle: string;
  sections: Section[];
  notes: string[];
};

/* ── formatting ──────────────────────────────────────────────────────────── */

const n = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(2));
const mm = (v: number) => `${n(v)} mm`;
const kg = (v: number | null | undefined) => (v == null ? '—' : `${v.toFixed(3)} kg`);
const cm2 = (v: number) => `${v.toFixed(3)} cm²`;
const mm2 = (v: number) => `${Math.round(v).toLocaleString('en-IN')} mm²`;

const titleOf = shapeTitle;

const gapOf = (shape: CoreShape) =>
  (shape.kind === 'CUT_ROUND' || shape.kind === 'CUT_RECT') ? shape.gapMm : 0;

const isCut = (shape: CoreShape) =>
  shape.kind === 'CUT_ROUND' || shape.kind === 'CUT_RECT';

/* ── the sections ────────────────────────────────────────────────────────── */

const identification = (shape: CoreShape, meta: SheetMeta): Section => {
  const rows: [string, string][] = [
    ['Product', titleOf(shape)],
  ];
  if (shape.kind === 'CUT_RECT') {
    rows.push(['Trade code', cutCoreCode(shape.id1, shape.id2, shape.od1, shape.ht)]);
  }
  rows.push(['Size', shapeCaption(shape)]);
  if (meta.grade) rows.push(['Grade', meta.grade]);
  if (meta.material) rows.push(['Material', meta.material]);
  // Named on every sheet, not only when it is unusual: "CRGO" on the paperwork
  // is a statement, and its absence on a nanocrystalline core would be read as
  // one too.
  rows.push(['Alloy', materialOf(meta.alloy).label]);
  rows.push([
    'Construction',
    isCut(shape) ? '2 mating halves — 1 pc = 1 complete core'
    : shape.kind === 'NANO' ? (shape.cased ? 'Wound ribbon, cased' : 'Wound ribbon, epoxy / plastic')
    : shape.kind === 'COMPOSITE' ? shape.rule.replace(/_/g, ' ').toLowerCase()
    : 'Continuously wound, uncut',
  ]);
  return { heading: 'Product', rows };
};

const dimensions = (shape: CoreShape): Section => {
  const rows: [string, string][] = (() => {
    switch (shape.kind) {
      case 'TOROIDAL':
      case 'NANO':
      case 'CUT_ROUND':
        return [
          ['Inner diameter  ID', mm(shape.dims.id)],
          ['Outer diameter  OD', mm(shape.dims.od)],
          ['Height  HT', mm(shape.dims.ht)],
          ['Build-up', mm((shape.dims.od - shape.dims.id) / 2)],
        ] as [string, string][];
      case 'RECTANGULAR':
      case 'CUT_RECT':
        return [
          ['Window  ID1', mm(shape.id1)],
          ['Window  ID2', mm(shape.id2)],
          ['Outer  OD1', mm(shape.od1)],
          ['Outer  OD2', mm(shape.od2)],
          ['Strip width  HT', mm(shape.ht)],
          ['Build-up', mm((shape.od1 - shape.id1) / 2)],
        ] as [string, string][];
      case 'COMPOSITE': {
        const { totalHt } = compositeLayout(shape.rule, shape.crgo, shape.nano);
        return [
          ['CRGO  ID / OD / HT', `${n(shape.crgo.id)} / ${n(shape.crgo.od)} / ${n(shape.crgo.ht)} mm`],
          ['Nano  ID / OD / HT', `${n(shape.nano.id)} / ${n(shape.nano.od)} / ${n(shape.nano.ht)} mm`],
          ['Overall height', mm(totalHt)],
        ] as [string, string][];
      }
      case 'E_CORE': {
        const o = eCoreOutline(shape);
        return [
          ['Tongue  T', mm(shape.tongue)],
          ['Window  W × H', `${n(shape.windowW)} × ${n(shape.windowH)} mm`],
          ['Stack  D', mm(shape.stack)],
          ['Outer limb / yoke', mm(o.yoke)],
          ['Overall  W × H', `${n(o.width)} × ${n(o.height)} mm`],
        ] as [string, string][];
      }
      case 'WOUND_CORE':
        return [
          ['Window  ID1', mm(shape.id1)],
          ['Window  ID2', mm(shape.id2)],
          ['Outer  OD1', mm(shape.od1)],
          ['Outer  OD2', mm(shape.od2)],
          ['Strip width  HT', mm(shape.ht)],
          ['Build-up', mm((shape.od1 - shape.id1) / 2)],
          ['Ends', `Radiused — R${n(Math.min(shape.id1, shape.id2) / 2)} inner`],
        ] as [string, string][];
      case 'STEP_CORE': {
        const sp = stepCoreSpan(shape);
        return [
          ['Steps', String(shape.steps.length)],
          ['Widest plate', mm(sp.width)],
          ['Stacked build', mm(sp.depth)],
          ['Circumscribing circle', `Ø ${n(sp.circle)} mm`],
          ['Window  ID1 × ID2', `${n(shape.id1)} × ${n(shape.id2)} mm`],
        ] as [string, string][];
      }
    }
  })();

  if (isCut(shape)) {
    const g = gapOf(shape);
    rows.push(['Total air gap', g > 0 ? mm(g) : 'None — butt joint']);
  }
  if (shape.kind === 'NANO' && shape.cased) {
    rows.push(['Case  ID / OD', `${n(shape.dims.id - 5)} / ${n(shape.dims.od + 5)} mm`]);
  }
  return { heading: 'Dimensions', rows };
};

/**
 * The geometry behind the testing table.
 *
 * Net area and mean path are what a reader needs to check the test voltage and
 * the magnetising current for themselves. The stacking factor and the density
 * used to sit here too and have been taken out: they are inputs to the weight
 * calculation and to nothing else on this sheet, and the stacking factor in
 * particular is the figure agreed with this one customer — not something to
 * print on a drawing that gets passed around.
 */
const geometry = (shape: CoreShape, meta: SheetMeta): Section | null => {
  switch (shape.kind) {
    case 'TOROIDAL':
    case 'CUT_ROUND': {
      const { id, od, ht } = shape.dims;
      if (!(od > id && ht > 0)) return null;
      const fx = stackOr(meta.factor, TOROIDAL_FACTOR);
      const sf = factorToSF(fx, materialOf(meta.alloy).density);
      const ag = toroidalGrossArea(id, od, ht);
      return {
        heading: 'Geometry',
        rows: [
          ['Gross section  Ag', mm2(ag)],
          ['Net core area  Ae', cm2(netArea(ag, sf))],
          ['Mean path  Lm', `${toroidalMeanPath(id, od).toFixed(2)} cm`],
          ['Window area', mm2((Math.PI / 4) * id * id)],
        ],
      };
    }
    case 'RECTANGULAR':
    case 'CUT_RECT': {
      const { id1, id2, od2, ht } = shape;
      if (!(od2 > id2 && ht > 0)) return null;
      const s = stackOr(meta.factor, RECT_STACK_FACTOR);
      const ag = ((od2 - id2) / 2) * ht;
      const d13 = ((od2 - id2) / 20) * 3.14;
      return {
        heading: 'Geometry',
        rows: [
          ['Gross section  Ag', mm2(ag)],
          ['Net core area  Ac', cm2((ag * s) / 100)],
          ['Mean path  Ml', `${(0.2 * (id1 + id2) + d13).toFixed(2)} cm`],
          ['Corner term  D13', `${d13.toFixed(3)} cm`],
          ['Window area', mm2(id1 * id2)],
        ],
      };
    }
    case 'NANO': {
      const { id, od, ht } = shape.dims;
      if (!(od > id && ht > 0)) return null;
      const sf = MATERIALS.NANOCRYSTALLINE.stackingFactor;
      const ag = toroidalGrossArea(id, od, ht);
      return {
        heading: 'Geometry',
        rows: [
          ['Gross section  Ag', mm2(ag)],
          ['Net core area  Ae', cm2(netArea(ag, sf))],
          ['Mean path  Lm', `${toroidalMeanPath(id, od).toFixed(2)} cm`],
        ],
      };
    }
    case 'E_CORE': {
      if (!(shape.tongue > 0 && shape.stack > 0)) return null;
      const sf = stackOr(meta.factor, defaultRectStack(meta.alloy));
      const ag = shape.tongue * shape.stack;
      return {
        heading: 'Geometry',
        rows: [
          ['Gross section  Ag', mm2(ag)],
          ['Net core area  Ae', cm2((ag * sf) / 100)],
          ['Mean path  Lm', `${eCoreMeanPath(shape.tongue, shape.windowW, shape.windowH).toFixed(2)} cm`],
          ['Window area (each)', mm2(shape.windowW * shape.windowH)],
        ],
      };
    }
    case 'WOUND_CORE': {
      if (!(shape.od2 > shape.id2 && shape.ht > 0)) return null;
      const sf = stackOr(meta.factor, defaultRectStack(meta.alloy));
      const ag = ((shape.od2 - shape.id2) / 2) * shape.ht;
      const build = (shape.od1 - shape.id1) / 2;
      return {
        heading: 'Geometry',
        rows: [
          ['Gross section  Ag', mm2(ag)],
          ['Net core area  Ac', cm2((ag * sf) / 100)],
          ['Mean path  Lm', `${woundMeanPath(shape.id1, shape.id2, build).toFixed(2)} cm`],
          ['Window area', mm2(shape.id1 * shape.id2)],
        ],
      };
    }
    case 'STEP_CORE': {
      const gross = stepGrossArea(shape.steps);
      if (!(gross > 0 && shape.id1 > 0 && shape.id2 > 0)) return null;
      const sf = stackOr(meta.factor, defaultRectStack(meta.alloy));
      const sp = stepCoreSpan(shape);
      return {
        heading: 'Geometry',
        rows: [
          ['Gross section  Ag', mm2(gross)],
          ['Net core area  Ac', cm2((gross * sf) / 100)],
          ['Mean path  Lm', `${(0.2 * (shape.id1 + shape.id2) + sp.depth * 0.314).toFixed(2)} cm`],
          ['Space factor in circle', `${((gross / (Math.PI / 4 * sp.circle * sp.circle)) * 100).toFixed(1)} %`],
        ],
        table: {
          head: ['Step', 'Width (mm)', 'Stack (mm)'],
          rows: shape.steps.map((st, i) => [String(i + 1), n(st.width), n(st.stack)]),
        },
      };
    }
    case 'COMPOSITE': {
      const fx = stackOr(meta.factor, TOROIDAL_FACTOR);
      const sfC = factorToSF(fx, materialOf(meta.alloy).density);
      const sfN = MATERIALS.NANOCRYSTALLINE.stackingFactor;
      const agC = toroidalGrossArea(shape.crgo.id, shape.crgo.od, shape.crgo.ht);
      const agN = toroidalGrossArea(shape.nano.id, shape.nano.od, shape.nano.ht);
      return {
        heading: 'Geometry',
        rows: [
          ['CRGO  net area', cm2(netArea(agC, sfC))],
          ['CRGO  mean path', `${toroidalMeanPath(shape.crgo.id, shape.crgo.od).toFixed(2)} cm`],
          ['Nano  net area', cm2(netArea(agN, sfN))],
          ['Nano  mean path', `${toroidalMeanPath(shape.nano.id, shape.nano.od).toFixed(2)} cm`],
        ],
      };
    }
  }
};

/**
 * The weight, as figures only.
 *
 * The working used to be printed underneath — the formula with this line's own
 * numbers substituted in. It is gone deliberately: the sheet goes to a
 * customer, and the weight formula carries the stacking factor that was agreed
 * with them, which is commercial information and not something to hand over on
 * every drawing.
 */
const weight = (_shape: CoreShape, meta: SheetMeta): Section => ({
  heading: 'Weight',
  rows: [
    ['Weight / pc', kg(meta.weightPerPc)],
    ['Pieces', meta.pcs ? String(meta.pcs) : '—'],
    ['Total weight', kg(meta.totalWeight)],
  ],
});

/**
 * Net core area and mean magnetic path — the two numbers the test figures are
 * computed from.
 *
 * Pulled out of geometry() so the test table can work them out for itself at
 * any flux level, rather than being limited to the single point this order line
 * happens to be booked at.
 */
const electrical = (shape: CoreShape, meta: SheetMeta) => {
  switch (shape.kind) {
    case 'TOROIDAL':
    case 'CUT_ROUND': {
      const { id, od, ht } = shape.dims;
      if (!(od > id && ht > 0)) return null;
      const sf = factorToSF(stackOr(meta.factor, TOROIDAL_FACTOR), materialOf(meta.alloy).density);
      return {
        areaCm2: netArea(toroidalGrossArea(id, od, ht), sf),
        meanPathCm: toroidalMeanPath(id, od),
      };
    }
    case 'RECTANGULAR':
    case 'CUT_RECT': {
      const { id1, id2, od2, ht } = shape;
      if (!(od2 > id2 && ht > 0)) return null;
      const sfac = stackOr(meta.factor, RECT_STACK_FACTOR);
      return {
        areaCm2: (((od2 - id2) / 2) * ht * sfac) / 100,
        meanPathCm: 0.2 * (id1 + id2) + ((od2 - id2) / 20) * 3.14,
      };
    }
    case 'E_CORE': {
      if (!(shape.tongue > 0 && shape.stack > 0)) return null;
      const sf = stackOr(meta.factor, defaultRectStack(meta.alloy));
      return {
        areaCm2: (shape.tongue * shape.stack * sf) / 100,
        meanPathCm: eCoreMeanPath(shape.tongue, shape.windowW, shape.windowH),
      };
    }
    case 'WOUND_CORE': {
      if (!(shape.od2 > shape.id2 && shape.ht > 0)) return null;
      const sf = stackOr(meta.factor, defaultRectStack(meta.alloy));
      return {
        areaCm2: (((shape.od2 - shape.id2) / 2) * shape.ht * sf) / 100,
        meanPathCm: woundMeanPath(shape.id1, shape.id2, (shape.od1 - shape.id1) / 2),
      };
    }
    case 'STEP_CORE': {
      const gross = stepGrossArea(shape.steps);
      if (!(gross > 0 && shape.id1 > 0 && shape.id2 > 0)) return null;
      const sf = stackOr(meta.factor, defaultRectStack(meta.alloy));
      return {
        areaCm2: (gross * sf) / 100,
        meanPathCm: 0.2 * (shape.id1 + shape.id2) + stepCoreSpan(shape).depth * 0.314,
      };
    }
    default:
      return null;
  }
};

/** The flux levels every test sheet is written at. */
const TEST_FLUX = [0.5, 1.0, 1.5];

/**
 * The testing parameters, as a table.
 *
 * One row per standard flux level, in volts and amps — not millivolts and
 * milliamps, which is how the figures are carried internally but not how a
 * test bench is set up or how a certificate reads.
 *
 * The voltage needs no grade data, so it is given at every level even when the
 * grade has an ATe/cm figure for only one of them; the current is left blank
 * rather than guessed. A blank is a question someone can answer. A number
 * pulled from the wrong flux level is not.
 */
const testing = (shape: CoreShape, meta: SheetMeta): Section | null => {
  const turns = meta.turns ?? 0;
  if (!(turns > 0)) return null;

  const e = electrical(shape, meta);
  const gapMm = gapOf(shape);

  // Nano and composite run their own voltage formula, with a frequency and a
  // stacking factor of their own. Rather than tabulate them on the CRGO one,
  // they keep the single point the line was booked at.
  if (!e) {
    if (!(meta.flux && meta.flux > 0)) return null;
    return {
      heading: 'Testing parameters',
      rows: [
        ['Test turns  N', String(turns)],
        ['Frequency', '50 Hz'],
        ['Flux density  B', `${meta.flux.toFixed(2)} T`],
        ['Test voltage', `${(meta.testVoltage ?? 0).toFixed(3)} V`],
        ['Ie max', `${((meta.testCurrent ?? 0) / 1000).toFixed(4)} A`],
      ],
    };
  }

  const ateAt = (flux: number) =>
    (meta.fluxPoints ?? []).find((pt) => Math.abs(pt.flux - flux) < 1e-6)?.ateCm
    ?? (meta.flux != null && Math.abs(meta.flux - flux) < 1e-6 ? meta.ateCm ?? null : null);

  const rows = TEST_FLUX.map((flux) => {
    const volts = testVoltage(e.areaCm2, turns, flux);
    const ate = ateAt(flux);
    const amps = ate == null
      ? null
      : (ate * e.meanPathCm + (gapMm > 0 ? gapAmpereTurns(flux, gapMm) : 0)) / turns;
    return [
      flux.toFixed(2),
      volts.toFixed(3),
      amps == null ? '—' : amps.toFixed(4),
    ];
  });

  const head: [string, string][] = [
    ['Test turns  N', String(turns)],
    ['Frequency', '50 Hz'],
  ];
  if (gapMm > 0) head.push(['Air gap', mm(gapMm)]);

  return {
    heading: 'Testing parameters',
    rows: head,
    table: { head: ['Flux (T)', 'Volts (V)', 'Amps (A)'], rows },
  };
};

/** Standing notes. Short, and only the ones that apply to this shape. */
const notesFor = (shape: CoreShape): string[] => {
  const out = ['All dimensions in millimetres unless stated.'];
  if (isCut(shape)) {
    out.push(
      'Both halves are cut from the same wound core and are matched — they are not interchangeable between cores.',
      gapOf(shape) > 0
        ? 'The air gap shown is the TOTAL across both joints; set half of it at each.'
        : 'Butt joint: mating faces lapped, assembled with no deliberate gap.',
    );
  }
  if (shape.kind === 'NANO') {
    out.push('Nanocrystalline ribbon is brittle; handle cased cores by the case only.');
  }
  if (shape.kind === 'COMPOSITE') {
    out.push('Weights are the sum of the two halves; each is calculated on its own material constants.');
  }
  out.push('Weight is calculated, not weighed. Cutting and handling losses are not deducted.');
  return out;
};

/* ── the model ───────────────────────────────────────────────────────────── */

export const buildSheetModel = (shape: CoreShape, meta: SheetMeta): SheetModel => {
  const sections: Section[] = [identification(shape, meta), dimensions(shape)];
  const geo = geometry(shape, meta);
  if (geo) sections.push(geo);
  sections.push(weight(shape, meta));
  const test = testing(shape, meta);
  if (test) sections.push(test);

  return {
    title: titleOf(shape),
    subtitle: shapeCaption(shape),
    sections,
    notes: notesFor(shape),
  };
};

export const fileStem = (shape: CoreShape, meta: SheetMeta) => {
  const bits = [meta.customer, titleOf(shape), shapeCaption(shape)]
    .filter(Boolean)
    .join(' ')
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-');
  return bits.slice(0, 80) || 'core-spec';
};
