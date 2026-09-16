// Material families and the two physical constants that separate them.
//
// Every core calculation in this app reduces to the same three quantities:
//
//     Ae = Ag × SF                  net cross-section (steel only)
//     W  = Ae × Lm × ρ              weight
//     V  = 4.44 × f × N × B × Ae    test voltage
//
// where Ag and Lm come from the shape, ρ from the material, and SF — the
// stacking factor, the fraction of the gross section that is actually steel
// rather than the air between laminations — from the agreement with the
// customer.
//
// Naming the two constants is what lets one factor drive weight, area, voltage
// and magnetising current together. Until now they were multiplied into single
// opaque numbers (5.77, 4.5559e-6, 0.48), which is why changing a customer's
// factor moved the weight but left the test voltage untouched.

/** Density in g/cm³. */
export type MaterialKey = 'CRGO' | 'NANOCRYSTALLINE' | 'AMORPHOUS';

export type MaterialSpec = {
  key: MaterialKey;
  label: string;
  /** g/cm³ */
  density: number;
  /** Default stacking factor — the fraction of the gross section that is steel. */
  stackingFactor: number;
};

/* The CRGO and nanocrystalline factors are derived from the constants this app
   has always used, rather than rounded to the tidy figures they were probably
   meant to be. That is deliberate: it guarantees every existing order
   recalculates to exactly the weight already stored against it.

       5.77    = π/4 × 7.65 × SF   →  SF = 0.96034…
       4.5559  = π/4 × 7.30 × SF   →  SF = 0.79461…

   Written as the division rather than as a decimal literal so the equality is
   exact in floating point and visible to the next reader. */
const QUARTER_PI = Math.PI / 4;

export const MATERIALS: Record<MaterialKey, MaterialSpec> = {
  CRGO: {
    key: 'CRGO',
    label: 'CRGO',
    density: 7.65,
    stackingFactor: 5.77 / (QUARTER_PI * 7.65),
  },
  NANOCRYSTALLINE: {
    key: 'NANOCRYSTALLINE',
    label: 'Nanocrystalline',
    density: 7.30,
    stackingFactor: 4.5559 / (QUARTER_PI * 7.30),
  },
  AMORPHOUS: {
    key: 'AMORPHOUS',
    label: 'Amorphous metal',
    density: 7.25,
    // No legacy constant to match — this is the agreed starting figure, and
    // like the others it is overridable per customer.
    stackingFactor: 0.86,
  },
};

export const materialOf = (key: MaterialKey | null | undefined): MaterialSpec =>
  MATERIALS[key ?? 'CRGO'] ?? MATERIALS.CRGO;

/* ── Converting between the two ways of writing the same thing ──────────────
   The entry form has always held a toroidal "factor" of 5.77 — the whole
   multiplier, geometry and density folded in — while the rectangular field
   holds 0.95, a bare fraction. They are the same physical quantity written two
   ways, and these two functions are the bridge until the stored values are
   migrated to one representation. */

/** 5.77 → 0.96034 : the bare stacking factor inside a toroidal multiplier. */
export const factorToSF = (multiplier: number, density: number) =>
  multiplier / (QUARTER_PI * density);

/** 0.96034 → 5.77 : the toroidal multiplier for a bare stacking factor. */
export const sfToFactor = (sf: number, density: number) =>
  sf * QUARTER_PI * density;

/* ── The unified quantities ─────────────────────────────────────────────── */

/** Net cross-section, cm². `grossMm2` is the gross section in mm². */
export const netArea = (grossMm2: number, sf: number) => (grossMm2 * sf) / 100;

/** Weight of one piece, kg. Area in cm², mean path in cm, density in g/cm³. */
export const coreWeight = (areaCm2: number, meanPathCm: number, density: number) =>
  (areaCm2 * meanPathCm * density) / 1000;

/** Test voltage, volts. Area in cm², flux density in tesla. */
export const testVoltage = (areaCm2: number, turns: number, fluxT: number, freqHz = 50) =>
  (4.44 * freqHz * turns * fluxT * areaCm2) / 10_000;

/**
 * Ampere-turns needed to push `fluxT` across an air gap of `gapMm`.
 *
 * 1 / μ₀ = 795 774.7 A/m per tesla, so 795.7747 per millimetre. This is the
 * term that makes a gap core a different product rather than a cut core with a
 * note: a single 1 mm gap at 1.5 T asks for about 1 194 ampere-turns on its
 * own, typically far more than the steel around it.
 */
export const gapAmpereTurns = (fluxT: number, gapMm: number) =>
  fluxT * gapMm * 795.7747;

/**
 * Magnetising current, mA. Steel path in cm, AT/cm from the grade at this flux.
 *
 * Written in this exact operation order — multiply by 1000 before dividing by
 * the turns — because that is the order the legacy line used, and a different
 * order lands on the other side of a rounding boundary often enough to shift
 * the last displayed digit on reports that have already been issued.
 */
export const magnetisingCurrent = (
  ateCm: number, meanPathCm: number, turns: number, gapAt = 0,
) => (turns > 0 ? (ateCm * 1000 * meanPathCm + gapAt * 1000) / turns : 0);
