// The six core families, named and coloured in one place.
//
// Every list in the app used to decide this for itself, and every one of them
// decided it the same wrong way:
//
//     coreType === 'TOROIDAL' ? 'Toro' : 'Rect'
//
// which was true when there were two families and has been quietly lying ever
// since. Nano, Composite and both cut families all rendered as "Rect" on the
// dispatch list, the packing screen, the SO edit page, the customer portal and
// the PO manage screen — so a customer looking at their own portal saw a round
// gap core described as a rectangular one.
//
// A lookup keyed by the type cannot fall through, which is the point: adding a
// seventh family to CoreType makes TypeScript name every map that has not been
// told about it, rather than silently labelling it a rectangle.
export type CoreType =
  | 'TOROIDAL' | 'RECTANGULAR' | 'NANO' | 'COMPOSITE' | 'CUT_ROUND' | 'CUT_RECT'
  | 'EI_CORE' | 'WOUND_CORE' | 'STEP_CORE';

/** Full name, for headings and anywhere there is room. */
export const CORE_LABEL: Record<CoreType, string> = {
  TOROIDAL: 'Toroidal',
  RECTANGULAR: 'Rectangular',
  NANO: 'Nano',
  COMPOSITE: 'Composite',
  CUT_ROUND: 'Round cut',
  CUT_RECT: 'Rectangular cut',
  EI_CORE: 'EI core',
  WOUND_CORE: 'Wound core',
  STEP_CORE: 'Step core',
};

/** Badge text, for a table cell that has room for one word. */
export const CORE_SHORT: Record<CoreType, string> = {
  TOROIDAL: 'Toro',
  RECTANGULAR: 'Rect',
  NANO: 'Nano',
  COMPOSITE: 'Comp',
  CUT_ROUND: 'Cut R',
  CUT_RECT: 'Cut X',
  EI_CORE: 'EI core',
  WOUND_CORE: 'Wound',
  STEP_CORE: 'Step',
};

/** Two-and-three letter product codes, as the packing list writes them. */
export const CORE_CODE: Record<CoreType, string> = {
  TOROIDAL: 'TC',
  RECTANGULAR: 'RC',
  NANO: 'NC',
  COMPOSITE: 'CC',
  CUT_ROUND: 'RCC',
  CUT_RECT: 'XCC',
  EI_CORE: 'EI',
  WOUND_CORE: 'WC',
  STEP_CORE: 'SC',
};

/** Tint for a plain badge. */
export const CORE_BADGE: Record<CoreType, string> = {
  TOROIDAL: 'bg-amber-50 text-amber-700',
  RECTANGULAR: 'bg-rose-50 text-rose-700',
  NANO: 'bg-violet-50 text-violet-700',
  COMPOSITE: 'bg-teal-50 text-teal-700',
  CUT_ROUND: 'bg-sky-50 text-sky-700',
  CUT_RECT: 'bg-cyan-50 text-cyan-700',
  EI_CORE: 'bg-indigo-50 text-indigo-700',
  WOUND_CORE: 'bg-orange-50 text-orange-700',
  STEP_CORE: 'bg-emerald-50 text-emerald-700',
};

/** Same, for the screens that outline their badges. */
export const CORE_BADGE_RING: Record<CoreType, string> = {
  TOROIDAL: 'bg-amber-100 text-amber-700 ring-amber-200',
  RECTANGULAR: 'bg-rose-100 text-rose-700 ring-rose-200',
  NANO: 'bg-violet-100 text-violet-700 ring-violet-200',
  COMPOSITE: 'bg-teal-100 text-teal-700 ring-teal-200',
  CUT_ROUND: 'bg-sky-100 text-sky-700 ring-sky-200',
  CUT_RECT: 'bg-cyan-100 text-cyan-700 ring-cyan-200',
  EI_CORE: 'bg-indigo-100 text-indigo-700 ring-indigo-200',
  WOUND_CORE: 'bg-orange-100 text-orange-700 ring-orange-200',
  STEP_CORE: 'bg-emerald-100 text-emerald-700 ring-emerald-200',
};

/* The accessors tolerate a string the server has widened ahead of the client —
   an unknown type shows as itself in grey rather than as a wrong family. */
const pick = <T,>(map: Record<CoreType, T>, ct: string | null | undefined, fallback: T): T =>
  (ct && ct in map ? map[ct as CoreType] : fallback);

export const coreLabel = (ct: string | null | undefined) => pick(CORE_LABEL, ct, ct || '—');
export const coreShort = (ct: string | null | undefined) => pick(CORE_SHORT, ct, ct || '—');
export const coreCode = (ct: string | null | undefined) => pick(CORE_CODE, ct, 'RC');
export const coreBadge = (ct: string | null | undefined) =>
  pick(CORE_BADGE, ct, 'bg-slate-100 text-slate-700');
export const coreBadgeRing = (ct: string | null | undefined) =>
  pick(CORE_BADGE_RING, ct, 'bg-slate-100 text-slate-700 ring-slate-200');
