// Runtime brand theming. The Tailwind `brand-*` palette resolves to CSS
// variables (--brand-50 … --brand-950); this module generates a full tint/shade
// ramp from a single base hex and writes those variables onto <html>, so a
// per-deployment colour re-themes the whole admin UI with no rebuild. Also used
// to hand specific shades (as hex) to the pdfmake documents.

type RGB = { r: number; g: number; b: number };

const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));

export const hexToRgb = (hex: string): RGB | null => {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const int = parseInt(h, 16);
  return { r: (int >> 16) & 255, g: (int >> 8) & 255, b: int & 255 };
};

const rgbToHex = ({ r, g, b }: RGB) =>
  '#' + [r, g, b].map((n) => clamp(n).toString(16).padStart(2, '0')).join('');

// Mix `base` toward white (t>0) or black (t<0) by fraction |t|.
const mix = (base: RGB, t: number): RGB => {
  const target = t >= 0 ? 255 : 0;
  const f = Math.abs(t);
  return {
    r: base.r + (target - base.r) * f,
    g: base.g + (target - base.g) * f,
    b: base.b + (target - base.b) * f,
  };
};

// White-mix (positive) for light stops, black-mix (negative) for dark stops.
// Tuned to resemble a Tailwind-style ramp for any hue. 500 = the base colour.
const STOPS: { key: number; t: number }[] = [
  { key: 50, t: 0.92 }, { key: 100, t: 0.82 }, { key: 200, t: 0.65 },
  { key: 300, t: 0.45 }, { key: 400, t: 0.22 }, { key: 500, t: 0 },
  { key: 600, t: -0.15 }, { key: 700, t: -0.32 }, { key: 800, t: -0.45 },
  { key: 900, t: -0.65 }, { key: 950, t: -0.78 },
];

/** Full ramp as { 50: {r,g,b}, … } from a base hex. */
export const brandRamp = (hex: string): Record<number, RGB> => {
  const base = hexToRgb(hex) ?? { r: 34, g: 197, b: 94 };
  const out: Record<number, RGB> = {};
  for (const { key, t } of STOPS) out[key] = mix(base, t);
  return out;
};

/** Specific shade as hex — handy for pdfmake (which wants hex strings). */
export const brandShadeHex = (hex: string | null | undefined, stop = 500): string => {
  const ramp = brandRamp(hex || '#22c55e');
  return rgbToHex(ramp[stop] ?? ramp[500]);
};

/** Write --brand-* onto <html>. Pass null to clear overrides (revert to the
    green :root defaults in index.css). */
export const applyBrandColor = (hex: string | null | undefined) => {
  const root = document.documentElement;
  if (!hex || !hexToRgb(hex)) {
    for (const { key } of STOPS) root.style.removeProperty(`--brand-${key}`);
    return;
  }
  const ramp = brandRamp(hex);
  for (const { key } of STOPS) {
    const { r, g, b } = ramp[key];
    root.style.setProperty(`--brand-${key}`, `${clamp(r)} ${clamp(g)} ${clamp(b)}`);
  }
};
