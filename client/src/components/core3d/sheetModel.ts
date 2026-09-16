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
import { MATERIALS, factorToSF, netArea } from '@/lib/coreMaterials';
import {
  compositeLayout, cutCoreCode, shapeCaption, shapeTitle, type CoreShape,
} from './shape';

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
};

export type Section = {
  heading: string;
  rows?: [string, string][];
  /** Free lines — a formula with this line's own numbers substituted in. */
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
const n1 = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));
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
 * The geometry the formulas actually run on.
 *
 * Gross section, stacking factor, net area and mean path are the four numbers
 * every other figure on the sheet is derived from, and none of them appear on
 * an order line. Printing them is what lets a customer's own engineer check the
 * weight and the test voltage without asking us for the working.
 */
const geometry = (shape: CoreShape, meta: SheetMeta): Section | null => {
  switch (shape.kind) {
    case 'TOROIDAL':
    case 'CUT_ROUND': {
      const { id, od, ht } = shape.dims;
      if (!(od > id && ht > 0)) return null;
      const fx = stackOr(meta.factor, TOROIDAL_FACTOR);
      const sf = factorToSF(fx, MATERIALS.CRGO.density);
      const ag = toroidalGrossArea(id, od, ht);
      return {
        heading: 'Geometry',
        rows: [
          ['Gross section  Ag', mm2(ag)],
          ['Stacking factor', `${(sf * 100).toFixed(2)} %`],
          ['Weight factor  F', `${fx}`],
          ['Net core area  Ae', cm2(netArea(ag, sf))],
          ['Mean path  Lm', `${toroidalMeanPath(id, od).toFixed(2)} cm`],
          ['Window area', mm2((Math.PI / 4) * id * id)],
          ['Density', `${MATERIALS.CRGO.density} g/cm³`],
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
          ['Stacking factor  S', `${(s * 100).toFixed(2)} %`],
          ['Net core area  Ac', cm2((ag * s) / 100)],
          ['Mean path  Ml', `${(0.2 * (id1 + id2) + d13).toFixed(2)} cm`],
          ['Corner term  D13', `${d13.toFixed(3)} cm`],
          ['Window area', mm2(id1 * id2)],
          ['Density', `${MATERIALS.CRGO.density} g/cm³`],
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
          ['Stacking factor', `${(sf * 100).toFixed(2)} %`],
          ['Net core area  Ae', cm2(netArea(ag, sf))],
          ['Mean path  Lm', `${toroidalMeanPath(id, od).toFixed(2)} cm`],
          ['Density', `${MATERIALS.NANOCRYSTALLINE.density} g/cm³`],
        ],
      };
    }
    case 'COMPOSITE': {
      const fx = stackOr(meta.factor, TOROIDAL_FACTOR);
      const sfC = factorToSF(fx, MATERIALS.CRGO.density);
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
          ['Densities', `CRGO ${MATERIALS.CRGO.density} · Nano ${MATERIALS.NANOCRYSTALLINE.density} g/cm³`],
        ],
      };
    }
  }
};

/** The weight, with the formula written out using this line's own numbers. */
const weight = (shape: CoreShape, meta: SheetMeta): Section => {
  const rows: [string, string][] = [
    ['Weight / pc', kg(meta.weightPerPc)],
    ['Pieces', meta.pcs ? String(meta.pcs) : '—'],
    ['Total weight', kg(meta.totalWeight)],
  ];

  const lines: string[] = (() => {
    switch (shape.kind) {
      case 'TOROIDAL':
      case 'CUT_ROUND': {
        const { id, od, ht } = shape.dims;
        const fx = stackOr(meta.factor, TOROIDAL_FACTOR);
        return [
          'W = (OD² − ID²) × HT × F × 1e-6',
          `  = (${n1(od)}² − ${n1(id)}²) × ${n1(ht)} × ${fx} × 1e-6`,
          `F = ${fx} — π/4 × density × stacking`
            + (fx === TOROIDAL_FACTOR ? ' (house standard)' : ' (agreed for this customer)'),
          ...(shape.kind === 'CUT_ROUND'
            ? ['Cut from a wound ring, so this is the weight of the whole ring.',
              'One piece = one complete core, both halves. Cutting loss not deducted.']
            : []),
        ];
      }
      case 'RECTANGULAR':
      case 'CUT_RECT': {
        const { id1, id2, od2, ht } = shape;
        const s = stackOr(meta.factor, RECT_STACK_FACTOR);
        return [
          'Ac = ((OD2 − ID2) / 2) × HT × S / 100',
          `   = ((${n1(od2)} − ${n1(id2)}) / 2) × ${n1(ht)} × ${s} / 100`,
          'Ml = 0.2 × (ID1 + ID2) + ((OD2 − ID2) / 20) × π',
          `   = 0.2 × (${n1(id1)} + ${n1(id2)}) + …`,
          'W  = Ac × Ml × 7.65 / 1000',
          `S = ${s}`
            + (s === RECT_STACK_FACTOR ? ' (house standard)' : ' (agreed for this customer)'),
          ...(shape.kind === 'CUT_RECT'
            ? ['One piece = one complete core, both halves. Cutting loss not deducted.']
            : []),
        ];
      }
      case 'NANO':
        return [
          'Core = (OD² − ID²) × HT × 4.5559e-6',
          'Case = (caseOD + caseID) × HT × 3.4876e-5',
          '     + (ssOD² − ssID²) × 7.68e-6',
          'W    = core + case (case omitted for epoxy / plastic)',
        ];
      case 'COMPOSITE': {
        const fx = stackOr(meta.factor, TOROIDAL_FACTOR);
        return [
          'W = Nano (core + case) + CRGO',
          'Nano core = (OD² − ID²) × HT × 4.5559e-6',
          `CRGO      = (OD² − ID²) × HT × ${fx} × 1e-6`,
          `F = ${fx} — applies to the CRGO half only`,
        ];
      }
    }
  })();

  return { heading: 'Weight', rows, lines };
};

/**
 * The magnetic test, written the way a test certificate reads.
 *
 * Absent entirely when the line carries no flux figures — most lines are quoted
 * on weight alone, and an empty heading looks like something failed to print.
 */
const magnetic = (shape: CoreShape, meta: SheetMeta): Section | null => {
  const turns = meta.turns ?? 0;
  const flux = meta.flux ?? 0;
  if (!(turns > 0) || !(flux > 0)) return null;

  const gap = meta.gapAt ?? 0;
  const steel = meta.steelAt ?? 0;
  const gapMm = gapOf(shape);

  const rows: [string, string][] = [
    ['Test turns  N', String(turns)],
    ['Flux density  B', `${flux.toFixed(2)} T`],
    ['Frequency', '50 Hz'],
    ['ATe / cm', meta.ateCm ? meta.ateCm.toFixed(3) : '—'],
    ['Test voltage  V', `${(meta.testVoltage ?? 0).toFixed(3)} V`],
  ];
  if (gapMm > 0) {
    rows.push(
      ['Steel ampere-turns', `${steel.toFixed(0)} AT`],
      ['Gap ampere-turns', `${gap.toFixed(0)} AT`],
      ['Total ampere-turns', `${(steel + gap).toFixed(0)} AT`],
    );
  }
  rows.push(['Ie max', `${(meta.testCurrent ?? 0).toFixed(2)} mA`]);

  const lines = [
    'V = 4.44 × f × N × B × Ae / 10000',
    ...(gapMm > 0
      ? [
        `Gap AT = 795.7747 × B × gap = 795.7747 × ${flux.toFixed(2)} × ${n1(gapMm)}`,
        `       = ${gap.toFixed(0)} AT`,
        'Steel AT = ATe/cm × Lm',
      ]
      : ['AT = ATe/cm × Lm']),
    'Ie = AT / N × 1000  (mA)',
  ];

  return { heading: 'Magnetic test', rows, lines };
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
  const mag = magnetic(shape, meta);
  if (mag) sections.push(mag);

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
