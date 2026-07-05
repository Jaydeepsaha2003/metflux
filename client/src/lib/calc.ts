// Pure calculation helpers — ported verbatim from .NET New_PO_Order.vb so
// numbers stay identical to your existing PO records.
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

export const toroidalCalc = ({ id, od, ht, pcs }: { id: number; od: number; ht: number; pcs: number }) => {
  const valid = id > 0 && od > 0 && ht > 0;
  const weightPerPc = valid ? round3((od * od - id * id) * ht * 5.77 * 1e-6) : 0;
  const totalWeight = pcs > 0 ? round3(pcs * weightPerPc) : 0;
  const measure = `${id || 0} x ${od || 0} x ${ht || 0}`;
  return { weightPerPc, totalWeight, measure };
};

export const rectangularCalc = ({
  id1, id2, od1, od2, ht, pcs,
}: { id1: number; id2: number; od1: number; od2: number; ht: number; pcs: number }) => {
  const builtup = od1 > 0 && id1 > 0 ? round3((od1 - id1) / 2) : 0;
  const coreAc  = od2 > 0 && id2 > 0 && ht > 0 ? round3(((od2 - id2) / 2) * ht * 0.95 / 100) : 0;
  // Match the legacy 3.14 multiplier used by the .NET form.
  const d13     = od2 > 0 && id2 > 0 ? round3(((od2 - id2) / 20) * 3.14) : 0;
  const coreMl  = id1 > 0 && id2 > 0 ? round3(0.2 * (id1 + id2) + d13) : 0;
  const weightPerPc = coreAc > 0 && coreMl > 0 ? round3((coreAc * coreMl * 7.65) / 1000) : 0;
  const totalWeight = pcs > 0 ? round3(pcs * weightPerPc) : 0;
  const measure = `${id1 || 0} x ${id2 || 0} x ${od1 || 0} x ${od2 || 0} x ${ht || 0} x ${builtup}`;
  return { builtup, coreAc, d13, coreMl, weightPerPc, totalWeight, measure };
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
  area, meanPath, turns, flux, ateCm,
}: {
  area: number; meanPath: number;
  turns: number; flux: number; ateCm: number;
}) => {
  const testVoltage = area > 0 && flux > 0 && turns > 0
    ? Math.round((222 * flux * area * turns) / 10000 * 1000) / 1000        // 3 dp
    : 0;
  const testCurrent = meanPath > 0 && ateCm > 0 && turns > 0
    ? Math.round((ateCm * 1000 * meanPath / turns) * 100) / 100             // 2 dp, mA
    : 0;
  return { testVoltage, testCurrent };
};

// Toroidal flux-test calculation per the calibration spec.
//   A          = 0.48  × (OD − ID) × HT / 100   # sq.cm  (stacking factor 0.48)
//   meanPath   = 0.157 × (OD + ID)              # cm     (π / 20)
export const fluxTestCalc = ({
  id, od, ht, turns, flux, ateCm,
}: {
  id: number; od: number; ht: number;
  turns: number; flux: number; ateCm: number;
}) => {
  const geomOk   = id > 0 && od > 0 && ht > 0 && od > id;
  const area     = geomOk ? round3((0.48 * (od - id) * ht) / 100) : 0;
  const meanPath = geomOk ? round3(0.157 * (od + id)) : 0;
  const { testVoltage, testCurrent } = fluxTestVI({ area, meanPath, turns, flux, ateCm });
  return { area, meanPath, testVoltage, testCurrent };
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
  const testVoltage = geomOk && flux > 0
    ? Math.round(4.44 * flux * turns * area * sfac * freq * 1000) / 1000  // Volts, 3 dp
    : 0;
  const testCurrent = geomOk && ateCm > 0
    ? Math.round((ateCm * meanPath / turns) * 1000 * 100) / 100           // mA, 2 dp
    : 0;
  return { area, meanPath, testVoltage, testCurrent };
};

// Rectangular flux-test calculation. The geometry helper rectangularCalc()
// already computes the area (coreAc) and mean magnetic path (coreMl); we only
// need to feed those plus turns/flux/ATe-cm into the shared V & Ie-max math.
export const rectangularFluxTestCalc = ({
  area, meanPath, turns, flux, ateCm,
}: {
  area: number; meanPath: number;
  turns: number; flux: number; ateCm: number;
}) => fluxTestVI({ area, meanPath, turns, flux, ateCm });
