// Pure calculation helpers — ported verbatim from .NET New_PO_Order.vb so
// numbers stay identical to your existing PO records.
//
// The 5.77 and 0.95 below are DEFAULTS. Both are stacking factors and both can
// be overridden per customer — see TOROIDAL_FACTOR / RECT_STACK_FACTOR.
//
// Toroidal:
//   weightPerPc = (od² − id²) × ht × 5.77 × 1e-6
//   measure     = "{id} x {od} x {ht}"
//
// Rectangular:
//   builtup     = (od1 − id1) / 2
//   coreAc      = ((od2 − id2) / 2) × ht × 0.95 / 100
//   d13         = ((od2 − id2) / 20) × π        // .NET uses 3.14, we keep the same factor
//   coreMl      = 0.2 × (id1 + id2) + d13
//   weightPerPc = (coreAc × coreMl × 7.65) / 1000
//   measure     = "{id1} x {id2} x {od1} x {od2} x {ht} x {builtup}"

import {
  materialOf, factorToSF, sfToFactor, netArea, testVoltage,
  magnetisingCurrent, gapAmpereTurns, type MaterialKey,
} from '@/lib/coreMaterials';

export const round3 = (n: number) => Math.round(n * 1000) / 1000;
export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

// Nano core — ported from the WEIGHT CALCULATOR sheet.
//   coreWeight  = (OD² − ID²) × HT × 4.5559e-6           (nanocrystalline ribbon)
//   caseOD/ID   = OD+5 / ID−5   ;  ssCircleOD/ID = OD+3 / ID−3
//   caseWeight  = (caseOD + caseID) × HT × 3.4876e-5      (SS band around OD+ID)
//               + (ssCircleOD² − ssCircleID²) × 7.68e-6   (SS top/bottom discs)
//   pricePerPc  = coreWeight × nanoPrice + caseWeight × casePrice
export const nanoCalc = ({
  id, od, ht, pcs, nanoPrice = 0, casePrice = 0,
}: {
  id: number; od: number; ht: number; pcs: number;
  nanoPrice?: number; casePrice?: number;
}) => {
  const valid = id > 0 && od > 0 && ht > 0 && od > id;
  const coreWeight = valid ? (od * od - id * id) * ht * 4.5559e-6 : 0;
  const caseOd = od + 5, caseId = id - 5;
  const ssOd = od + 3, ssId = id - 3;
  const bandWeight = valid ? (caseOd + caseId) * ht * 3.4876e-5 : 0;
  const discWeight = valid ? (ssOd * ssOd - ssId * ssId) * 7.68e-6 : 0;
  const caseWeight = valid ? bandWeight + discWeight : 0;
  const pricePerPc = round2(coreWeight * (nanoPrice || 0) + caseWeight * (casePrice || 0));
  const totalWeight = pcs > 0 ? round3(pcs * coreWeight) : 0;
  const totalAmount = pcs > 0 ? round2(pricePerPc * pcs) : 0;
  const measure = `${id || 0} x ${od || 0} x ${ht || 0}`;
  return {
    coreWeight: round3(coreWeight), caseWeight: round3(caseWeight),
    pricePerPc, totalWeight, totalAmount, measure, caseOd, caseId,
  };
};

// ── COMPOSITE core (Nano + CRGO) ──────────────────────────────────────────
// A composite piece is built from a CRGO core and a Nano core combined. The
// grade is "COMPOSITE"; the material picks how the two are joined, which fixes
// how the final measure is derived:
//   • Continuous Loop  — Nano wound concentrically around CRGO:
//       ID = min(CRGO, Nano) · OD = max(CRGO, Nano) · HT = same
//   • Exact Split      — two equal-height pieces stacked:
//       ID = OD = same (both identical) · HT = CRGO + Nano
//   • Variable Height  — two different-height pieces stacked:
//       ID = OD = same · HT = CRGO + Nano
// Weight/pc = Nano (core + case) + CRGO (toroidal), per the chosen dimensions.
export type CompositeRule = 'CONTINUOUS_LOOP' | 'EXACT_SPLIT' | 'VARIABLE_HEIGHT';

export const isCompositeGrade = (grade: string) => (grade || '').trim().toUpperCase() === 'COMPOSITE';

// Map a material name to its join rule (robust to wording/casing).
export const compositeRuleFromMaterial = (material: string): CompositeRule | null => {
  const m = (material || '').toLowerCase();
  if (m.includes('loop')) return 'CONTINUOUS_LOOP';
  if (m.includes('exact') || m.includes('split')) return 'EXACT_SPLIT';
  if (m.includes('variable') || m.includes('height')) return 'VARIABLE_HEIGHT';
  return null;
};

type Tri = { id: number; od: number; ht: number };
export const compositeCalc = ({
  rule, crgo, nano, pcs = 0, factor,
}: { rule: CompositeRule; crgo: Tri; nano: Tri; pcs?: number;
  /** Applies to the CRGO half only — the nano ribbon and its case have their
   *  own constants and are not a laminated stack. */
  factor?: number | null }) => {
  const nanoC = nanoCalc({ id: nano.id, od: nano.od, ht: nano.ht, pcs: 0 });
  const crgoC = toroidalCalc({ id: crgo.id, od: crgo.od, ht: crgo.ht, pcs: 0, factor });
  const nanoWeight = round3(nanoC.coreWeight + nanoC.caseWeight);
  const crgoWeight = crgoC.weightPerPc;
  const weightPerPc = round3(nanoWeight + crgoWeight);

  let id = 0, od = 0, ht = 0;
  if (rule === 'CONTINUOUS_LOOP') {
    id = Math.min(crgo.id, nano.id);      // inner-most bore
    od = Math.max(crgo.od, nano.od);      // outer-most edge
    ht = Math.max(crgo.ht, nano.ht);      // concentric → same height
  } else {
    // EXACT_SPLIT & VARIABLE_HEIGHT — stacked: same footprint, heights add up.
    id = Math.min(crgo.id, nano.id);
    od = Math.max(crgo.od, nano.od);
    ht = round3(crgo.ht + nano.ht);
  }
  const measure = `${id || 0} x ${od || 0} x ${ht || 0}`;
  const totalWeight = pcs > 0 ? round3(pcs * weightPerPc) : 0;
  return {
    id, od, ht, measure, weightPerPc, totalWeight,
    nanoWeight, crgoWeight,
    coreWeight: nanoC.coreWeight, caseWeight: nanoC.caseWeight,
  };
};

// ── Stacking factor ───────────────────────────────────────────────────────
// A wound core is steel plus the air between its laminations, so its weight is
// geometry x density x the fraction that is actually steel. The two shapes
// express that fraction differently, inherited verbatim from the .NET form:
//
//   TOROIDAL_FACTOR 5.77 is the whole multiplier, not a bare fraction —
//     pi/4 (0.7854) x 7.65 (density) x 0.9604 (stacking) = 5.77
//   RECT_STACK_FACTOR 0.95 is the bare fraction, applied to the area, with
//     the 7.65 density kept separate in the weight line below.
//
// So the two already run at slightly different stacking (~96% vs 95%). Both
// are defaults: a customer whose specification differs carries their own
// figure, and every line records the one it was priced with.
export const TOROIDAL_FACTOR = 5.77;
export const RECT_STACK_FACTOR = 0.95;

/** A stored/entered factor, falling back to the house default when absent.
 *  Zero and NaN fall back too — an empty input must not weigh a core at nil. */
export const stackOr = (factor: number | null | undefined, fallback: number) =>
  (typeof factor === 'number' && Number.isFinite(factor) && factor > 0 ? factor : fallback);

/* ── Toroidal geometry ─────────────────────────────────────────────────────
   Split out because the same two numbers drive the weight, the test area, the
   voltage and the magnetising current. Keeping them in one place is what makes
   a change to the stacking factor move all four together. */

/** Gross cross-section, mm²: radial build × height. */
export const toroidalGrossArea = (id: number, od: number, ht: number) =>
  ((od - id) / 2) * ht;

/**
 * Mean magnetic path, cm: π × mean diameter, i.e. π(OD+ID)/20.
 *
 * The 0.157 is that constant as the .NET form rounded it — π/20 is 0.15708.
 * Kept rounded on purpose: the exact value shifts Ie max by about 0.05%, and
 * test reports already issued to customers should still reprint with the
 * figures they were signed off with. The mean path has nothing to do with the
 * stacking factor, so there is no reason for this change to ride along with it.
 */
export const toroidalMeanPath = (id: number, od: number) => 0.157 * (od + id);

/**
 * The toroidal multiplier a line should default to for its alloy.
 *
 * 5.77 for CRGO, 4.5559 for nanocrystalline, and the amorphous equivalent —
 * each being π/4 × that alloy's density × that alloy's stacking factor, so the
 * two legacy constants come out of the formula rather than being special-cased.
 * The operator can still override it per line; what this fixes is the default
 * moving when the alloy does, instead of quietly weighing ribbon as if it were
 * grain-oriented steel.
 */
export const defaultToroidalFactor = (alloy?: MaterialKey | null) => {
  const m = materialOf(alloy);
  return round3(sfToFactor(m.stackingFactor, m.density));
};

/** The bare stacking fraction a rectangular line should default to. CRGO keeps
 *  the house 0.95 it has always used; the others take their own figure. */
export const defaultRectStack = (alloy?: MaterialKey | null) =>
  (!alloy || alloy === 'CRGO') ? RECT_STACK_FACTOR : round3(materialOf(alloy).stackingFactor);

export const toroidalCalc = ({ id, od, ht, pcs, factor, alloy }: {
  id: number; od: number; ht: number; pcs: number;
  /** Customer's toroidal factor; omitted means this alloy's house default. */
  factor?: number | null;
  /** Material family. Omitted means CRGO, so every existing line is unchanged. */
  alloy?: MaterialKey | null;
}) => {
  const valid = id > 0 && od > 0 && ht > 0;
  const f = stackOr(factor, defaultToroidalFactor(alloy));
  // Identical arithmetic to the legacy line, deliberately: this is the number
  // already stored against thousands of order lines.
  //   (OD² − ID²) × HT × F × 1e-6  ≡  Ae × Lm × ρ / 1000
  // with F = π/4 × SF × ρ. See coreMaterials.ts for the decomposition.
  const weightPerPc = valid ? round3((od * od - id * id) * ht * f * 1e-6) : 0;
  const totalWeight = pcs > 0 ? round3(pcs * weightPerPc) : 0;
  const measure = `${id || 0} x ${od || 0} x ${ht || 0}`;
  return { weightPerPc, totalWeight, measure };
};

export const rectangularCalc = ({
  id1, id2, od1, od2, ht, pcs, factor, alloy,
}: {
  id1: number; id2: number; od1: number; od2: number; ht: number; pcs: number;
  /** Customer's rectangular stacking factor; omitted means the house default. */
  factor?: number | null;
  /** Material family. Omitted means CRGO, so every existing line is unchanged. */
  alloy?: MaterialKey | null;
}) => {
  const s = stackOr(factor, defaultRectStack(alloy));
  const builtup = od1 > 0 && id1 > 0 ? round3((od1 - id1) / 2) : 0;
  const coreAc  = od2 > 0 && id2 > 0 && ht > 0 ? round3(((od2 - id2) / 2) * ht * s / 100) : 0;
  // Match the legacy 3.14 multiplier used by the .NET form.
  const d13     = od2 > 0 && id2 > 0 ? round3(((od2 - id2) / 20) * 3.14) : 0;
  const coreMl  = id1 > 0 && id2 > 0 ? round3(0.2 * (id1 + id2) + d13) : 0;
  // The density is the alloy's, not a literal 7.65 — that constant was the
  // only thing tying this formula to grain-oriented steel.
  const weightPerPc = coreAc > 0 && coreMl > 0
    ? round3((coreAc * coreMl * materialOf(alloy).density) / 1000) : 0;
  const totalWeight = pcs > 0 ? round3(pcs * weightPerPc) : 0;
  const measure = `${id1 || 0} x ${id2 || 0} x ${od1 || 0} x ${od2 || 0} x ${ht || 0} x ${builtup}`;
  return { builtup, coreAc, d13, coreMl, weightPerPc, totalWeight, measure };
};

/* ── EI core ───────────────────────────────────────────────────────────────
   A stacked lamination rather than a wound ring, so there is no toroidal
   multiplier: the section is simply the tongue by the stack, and the stacking
   factor is the bare fraction the rectangular form already uses. */

/**
 * Mean magnetic path of an E+I core.
 *
 * 2H + 2W + 3T, the published approximation for EI laminations: up and down
 * the window twice, across it twice, and three limb widths for the turns at
 * the corners. It is a convention, not a measurement — if your works sizes
 * these on a different figure this is the single line to change, and the
 * weight, the test voltage and the magnetising current all follow it.
 */
export const eCoreMeanPath = (tongue: number, windowW: number, windowH: number) =>
  (2 * windowH + 2 * windowW + 3 * tongue) / 10;

export const eCoreCalc = ({
  tongue, windowW, windowH, stack, pcs, factor, alloy,
}: {
  tongue: number; windowW: number; windowH: number; stack: number; pcs: number;
  factor?: number | null; alloy?: MaterialKey | null;
}) => {
  const valid = tongue > 0 && windowW > 0 && windowH > 0 && stack > 0;
  const sf = stackOr(factor, defaultRectStack(alloy));
  // Section is the centre limb: the outer limbs are half of it each and carry
  // half the flux, so the tongue is what the whole flux passes through.
  const coreAc = valid ? round3((tongue * stack * sf) / 100) : 0;
  const coreMl = valid ? round3(eCoreMeanPath(tongue, windowW, windowH)) : 0;
  const weightPerPc = coreAc > 0 && coreMl > 0
    ? round3((coreAc * coreMl * materialOf(alloy).density) / 1000) : 0;
  const totalWeight = pcs > 0 ? round3(pcs * weightPerPc) : 0;
  const measure = `T${tongue || 0} x ${windowW || 0} x ${windowH || 0} x ${stack || 0}`;
  return { coreAc, coreMl, weightPerPc, totalWeight, measure };
};

/* ── Wound core (obround) ─────────────────────────────────────────────────
   The same five dimensions as the rectangular window core, but the ends are
   true semicircles — which is what strip can actually be wound round, and
   what makes the magnetic path shorter than a square-cornered window of the
   same size rather than longer. */

/**
 * Mean path, cm: two straight runs plus one full circle at the mean build.
 *
 * The straights lie along the LONG inner axis and the semicircular ends have
 * the SHORT one for their diameter — which way round the two are entered does
 * not change the part, so it must not change the answer. Taking ID1 as the
 * straight regardless put the whole path in the ends whenever the window was
 * entered narrow-side-first, and lost 25% of the weight with it.
 */
export const woundMeanPath = (id1: number, id2: number, build: number) => {
  const short = Math.min(id1, id2);
  const long = Math.max(id1, id2);
  return (2 * (long - short) + Math.PI * (short + build)) / 10;
};

export const woundCoreCalc = ({
  id1, id2, od1, od2, ht, pcs, factor, alloy,
}: {
  id1: number; id2: number; od1: number; od2: number; ht: number; pcs: number;
  factor?: number | null; alloy?: MaterialKey | null;
}) => {
  const sf = stackOr(factor, defaultRectStack(alloy));
  const builtup = od1 > 0 && id1 > 0 ? round3((od1 - id1) / 2) : 0;
  const coreAc = od2 > 0 && id2 > 0 && ht > 0 ? round3(((od2 - id2) / 2) * ht * sf / 100) : 0;
  const coreMl = id1 > 0 && id2 > 0 ? round3(woundMeanPath(id1, id2, builtup)) : 0;
  const weightPerPc = coreAc > 0 && coreMl > 0
    ? round3((coreAc * coreMl * materialOf(alloy).density) / 1000) : 0;
  const totalWeight = pcs > 0 ? round3(pcs * weightPerPc) : 0;
  const measure = `${id1 || 0} x ${id2 || 0} x ${od1 || 0} x ${od2 || 0} x ${ht || 0} R`;
  return { builtup, coreAc, coreMl, weightPerPc, totalWeight, measure };
};

/* ── Step core ────────────────────────────────────────────────────────────
   A limb whose section is built from plates of decreasing width, stacked to
   fill a bore. The steps give the area; the window gives the path. */

/** One stepped lamination record: two window dimensions, height and build-up. */
export type CoreStep = { id1: number; id2: number; ht: number; builtup: number };

/** Gross section of the stepped limb, mm². */
export const stepGrossArea = (steps: CoreStep[]) =>
  steps.reduce((t, s) => t + (s.id1 > 0 && s.id2 > 0 && s.builtup > 0 ? s.id1 * s.id2 * s.builtup : 0), 0);

export const stepCoreCalc = ({
  steps, pcs, factor, alloy,
}: {
  steps: CoreStep[]; pcs: number;
  factor?: number | null; alloy?: MaterialKey | null;
}) => {
  const sf = stackOr(factor, defaultRectStack(alloy));
  const id1 = steps.length ? Math.min(...steps.map((x) => x.id1).filter(Boolean)) : 0;
  const id2 = steps.length ? Math.min(...steps.map((x) => x.id2).filter(Boolean)) : 0;
  const od1 = steps.length ? Math.max(...steps.map((x) => x.id1)) : 0;
  const od2 = steps.length ? Math.max(...steps.map((x) => x.id2)) : 0;
  const heights = [...new Set(steps.map((x) => x.ht).filter(Boolean))].sort((a, b) => a - b);
  const builtup = steps.length ? Math.max(...steps.map((x) => x.builtup)) : 0;
  const coreAc = od1 > id1 && od2 > id2 && builtup > 0 ? round3(((od1 * od2) - (id1 * id2)) * sf / 100) : 0;
  const coreMl = id1 > 0 && id2 > 0 ? round3(0.2 * (id1 + id2) + builtup * 0.314) : 0;
  const weightPerPc = coreAc > 0 && coreMl > 0
    ? round3((coreAc * coreMl * materialOf(alloy).density) / 1000) : 0;
  const totalWeight = pcs > 0 ? round3(pcs * weightPerPc) : 0;
  const measure = `${id1 || 0} x ${id2 || 0} → ${od1 || 0} x ${od2 || 0} · HT ${heights.join('/')} · BU ${builtup || 0}`;
  return { coreAc, coreMl, weightPerPc, totalWeight, measure, id1, id2, od1, od2, heights, builtup };
};

export const numFromInput = (s: string) => {
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
};

// Voltage / Ie-max computation — same math regardless of core shape, given A
// (sq.cm) and meanPath (cm) already in hand.
//   V       = 222 × Flux × A × Turns / 10000   # volts (4.44 × 50 Hz)
//   Ie max  = ATe/cm × 1000 × meanPath / Turns # mA
// Voltage is grade-independent; only Ie max needs the grade-specific ATe/cm.
const fluxTestVI = ({
  area, meanPath, turns, flux, ateCm, gapAt = 0,
}: {
  area: number; meanPath: number;
  turns: number; flux: number; ateCm: number;
  /** Ampere-turns absorbed by an air gap, for gapped cores. */
  gapAt?: number;
}) => {
  // 222 in the old line was 4.44 × 50 Hz with the frequency frozen in.
  const volts = area > 0 && flux > 0 && turns > 0
    ? testVoltage(area, turns, flux, 50)
    : 0;
  const milliamps = meanPath > 0 && (ateCm > 0 || gapAt > 0) && turns > 0
    ? magnetisingCurrent(ateCm, meanPath, turns, gapAt)
    : 0;
  return {
    testVoltage: Math.round(volts * 1000) / 1000,       // 3 dp
    testCurrent: Math.round(milliamps * 100) / 100,     // 2 dp, mA
    // Reported separately because on a gapped core it is usually most of the
    // answer, and a figure that jumps tenfold needs to say why.
    steelAt: Math.round(ateCm * meanPath * 100) / 100,
    gapAt: Math.round(gapAt * 100) / 100,
  };
};

/**
 * Toroidal flux-test calculation.
 *
 *   A        = (OD − ID)/2 × HT × SF / 100   sq.cm   (net section)
 *   meanPath = π × (OD + ID) / 20            cm
 *
 * The old constants were 0.48 for the area — which is SF/2 with SF = 0.96 —
 * and 0.157, which is π/20. Both are now written as what they are, and the
 * stacking factor comes from the line rather than being frozen at 0.96.
 *
 * That last part is the change of behaviour: a customer whose agreed factor
 * makes the core heavier also has more steel in the section, so the test
 * voltage for a given flux rises with it. Previously the weight moved and the
 * voltage did not, which meant the two could disagree about the same core.
 */
export const fluxTestCalc = ({
  id, od, ht, turns, flux, ateCm, factor, gapMm = 0, alloy,
}: {
  id: number; od: number; ht: number;
  turns: number; flux: number; ateCm: number;
  /** The line's toroidal factor (the 5.77-style multiplier); default house. */
  factor?: number | null;
  /** Total controlled air gap across all joints, mm. Cut and gap cores only. */
  gapMm?: number;
  /** Material family. Omitted means CRGO. */
  alloy?: MaterialKey | null;
}) => {
  const geomOk   = id > 0 && od > 0 && ht > 0 && od > id;
  // Recovered against the SAME density the multiplier was built from, or the
  // stacking factor comes back wrong and the test voltage drifts with it.
  const sf       = factorToSF(
    stackOr(factor, defaultToroidalFactor(alloy)), materialOf(alloy).density,
  );
  const area     = geomOk ? round3(netArea(toroidalGrossArea(id, od, ht), sf)) : 0;
  const meanPath = geomOk ? round3(toroidalMeanPath(id, od)) : 0;
  const gapAt    = gapMm > 0 && flux > 0 ? gapAmpereTurns(flux, gapMm) : 0;
  return { area, meanPath, ...fluxTestVI({ area, meanPath, turns, flux, ateCm, gapAt }) };
};

// Nano-core testing parameters — ported from the "nano core tech data" sheet.
// Same maths for SS-case and Epoxy/Plastic-case; only the AT/cm benchmark (from
// the grade) differs.
//   A (m²)     = ((OD − ID)/2 × HT) / 1e6
//   V (Volts)  = 4.44 × Bmax(T) × Ns × A × Sfac × f      (Ns = turns)
//   MML (cm)   = (OD + ID)/2 × 22/70
//   Ie max(mA) = (AT/cm × MML / Np) × 1000               (Np = turns)
export const nanoTestCalc = ({
  id, od, ht, turns, flux, ateCm, freq = 50, sfac = 0.8,
}: {
  id: number; od: number; ht: number; turns: number;
  flux: number; ateCm: number; freq?: number; sfac?: number;
}) => {
  const geomOk = id > 0 && od > 0 && ht > 0 && od > id && turns > 0;
  const area = geomOk ? ((od - id) / 2 * ht) / 1_000_000 : 0;            // sq.m
  const meanPath = geomOk ? round3(((od + id) / 2) * 22 / 70) : 0;        // cm (MML)
  const rawV = geomOk && flux > 0 ? 4.44 * flux * turns * area * sfac * freq : 0;      // Volts
  const rawIeA = geomOk && ateCm > 0 ? (ateCm * meanPath / turns) : 0;                  // Amps
  return {
    area, meanPath,
    testVoltage:   Math.round(rawV * 1000) / 1000,        // V, 3 dp
    testVoltageMv: Math.round(rawV * 1000 * 100) / 100,   // mV, 2 dp
    testCurrent:   Math.round(rawIeA * 1000 * 100) / 100, // mA, 2 dp
    testCurrentA:  Math.round(rawIeA * 100000) / 100000,  // A, 5 dp
  };
};

// Rectangular flux-test calculation. The geometry helper rectangularCalc()
// already computes the area (coreAc) and mean magnetic path (coreMl); we only
// need to feed those plus turns/flux/ATe-cm into the shared V & Ie-max math.
export const rectangularFluxTestCalc = ({
  area, meanPath, turns, flux, ateCm, gapMm = 0,
}: {
  area: number; meanPath: number;
  turns: number; flux: number; ateCm: number;
  /** Total controlled air gap across all joints, mm. */
  gapMm?: number;
}) => fluxTestVI({
  area, meanPath, turns, flux, ateCm,
  gapAt: gapMm > 0 && flux > 0 ? gapAmpereTurns(flux, gapMm) : 0,
});
