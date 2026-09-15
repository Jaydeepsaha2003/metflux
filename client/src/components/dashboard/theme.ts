// Dashboard palette — the colour system behind the Dashboard reskin.
//
// The mockup this follows is painted in one fixed dark green with a lime
// accent. That would have hard-coded Metflux's colours onto Toroflux, which
// runs the same app in blue, so every surface here is derived from whatever
// --brand-* the domain resolved at runtime (see lib/brandColor.ts). Metflux
// therefore lands on the mockup's dark green, and Toroflux gets the same design
// in its own navy, without a second stylesheet.
//
// The ramp stops only reach brand-950, which is still lighter than the
// mockup's near-black ground, so the darkest surfaces mix a stop toward black
// rather than inventing a hue that would drift off-brand.
export type DashMode = 'dark' | 'light';

type RGB = { r: number; g: number; b: number };
const round = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
const mix = (c: RGB, towards: RGB, t: number): RGB => ({
  r: round(c.r + (towards.r - c.r) * t),
  g: round(c.g + (towards.g - c.g) * t),
  b: round(c.b + (towards.b - c.b) * t),
});
const BLACK: RGB = { r: 0, g: 0, b: 0 };
const WHITE: RGB = { r: 255, g: 255, b: 255 };
const css = ({ r, g, b }: RGB, alpha = 1) =>
  (alpha === 1 ? `rgb(${round(r)} ${round(g)} ${round(b)})` : `rgb(${round(r)} ${round(g)} ${round(b)} / ${alpha})`);

const STOPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950] as const;
const FALLBACK: Record<number, RGB> = {
  50: { r: 236, g: 253, b: 243 }, 100: { r: 209, g: 250, b: 223 }, 200: { r: 166, g: 244, b: 197 },
  300: { r: 108, g: 233, b: 166 }, 400: { r: 50, g: 213, b: 131 }, 500: { r: 34, g: 197, b: 94 },
  600: { r: 22, g: 163, b: 74 }, 700: { r: 21, g: 128, b: 61 }, 800: { r: 22, g: 101, b: 52 },
  900: { r: 14, g: 58, b: 34 }, 950: { r: 5, g: 46, b: 22 },
};

/**
 * The ramp the app is *actually* wearing, read straight off <html>.
 *
 * Deliberately not re-derived from a stored brand hex: the branding store, the
 * hostname default and the per-company override all write --brand-* at
 * different moments, so a hex held in state can disagree with what every other
 * page is painted in. Reading the variables means the Dashboard always matches
 * the rest of the app, whoever set them last.
 */
export const readBrandRamp = (): Record<number, RGB> => {
  if (typeof document === 'undefined') return FALLBACK;
  const cs = getComputedStyle(document.documentElement);
  const out: Record<number, RGB> = {};
  for (const stop of STOPS) {
    const parts = cs.getPropertyValue(`--brand-${stop}`).trim().split(/[\s,]+/).map(Number);
    out[stop] = parts.length >= 3 && parts.every((n) => Number.isFinite(n))
      ? { r: parts[0], g: parts[1], b: parts[2] }
      : FALLBACK[stop];
  }
  return out;
};

/** CSS custom properties for one mode, written onto the dashboard's root
 *  element. Children read them as var(--d-*) so a mode switch is one re-render
 *  of the wrapper rather than a class change on every node. */
export const dashVars = (mode: DashMode): Record<string, string> => {
  const ramp = readBrandRamp();
  const s = (stop: number) => ramp[stop] as RGB;

  if (mode === 'dark') {
    const ground = mix(s(950), BLACK, 0.55);
    return {
      '--d-bg':        css(ground),
      '--d-panel':     css(mix(s(950), BLACK, 0.34)),
      '--d-raised':    css(mix(s(900), BLACK, 0.42)),
      '--d-line':      css(mix(s(800), BLACK, 0.3)),
      '--d-line-soft': css(mix(s(800), BLACK, 0.45)),
      '--d-text':      css(mix(s(50), WHITE, 0.45)),
      '--d-muted':     css(mix(s(200), ground, 0.42)),
      '--d-faint':     css(mix(s(200), ground, 0.66)),
      '--d-accent':    css(s(400)),
      '--d-accent-ink': css(mix(s(950), BLACK, 0.4)),
      '--d-accent-dim': css(s(400), 0.13),
      '--d-accent-line': css(s(400), 0.3),
      '--d-grid':      css(s(800), 0.35),
      // Core-type tags stay a fixed blue/green pair: they label what a core IS,
      // the same way they do on the Production screens, so they must not move
      // with the domain's brand colour.
      '--d-toro':      'rgb(159 227 191)',
      '--d-toro-dim':  'rgb(159 227 191 / 0.12)',
      '--d-rect':      'rgb(169 200 234)',
      '--d-rect-dim':  'rgb(169 200 234 / 0.12)',
      '--d-warn':      'rgb(251 191 36)',
      '--d-warn-dim':  'rgb(251 191 36 / 0.13)',
      '--d-danger':    'rgb(248 150 150)',
      '--d-danger-dim': 'rgb(248 113 113 / 0.14)',
    };
  }

  return {
    '--d-bg':        css(mix(s(50), WHITE, 0.55)),
    '--d-panel':     css(WHITE),
    '--d-raised':    css(mix(s(50), WHITE, 0.3)),
    '--d-line':      'rgb(226 232 240)',
    '--d-line-soft': 'rgb(241 245 249)',
    '--d-text':      'rgb(15 23 42)',
    '--d-muted':     'rgb(71 85 105)',
    '--d-faint':     'rgb(100 116 139)',
    '--d-accent':    css(s(600)),
    '--d-accent-ink': css(WHITE),
    '--d-accent-dim': css(s(500), 0.12),
    '--d-accent-line': css(s(500), 0.3),
    '--d-grid':      css(s(200), 0.5),
    '--d-toro':      'rgb(21 128 96)',
    '--d-toro-dim':  'rgb(21 128 96 / 0.1)',
    '--d-rect':      'rgb(37 99 173)',
    '--d-rect-dim':  'rgb(37 99 173 / 0.1)',
    '--d-warn':      'rgb(180 120 8)',
    '--d-warn-dim':  'rgb(251 191 36 / 0.16)',
    '--d-danger':    'rgb(190 50 50)',
    '--d-danger-dim': 'rgb(248 113 113 / 0.14)',
  };
};

const STORAGE_KEY = 'metflux.dashboard.mode';

/** Opens light, matching every other screen in the app; a viewer's own choice
 *  wins and persists. Storage can throw in a locked-down browser, so guarded. */
export const readStoredMode = (): DashMode => {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === 'light' || v === 'dark' ? v : 'light';
  } catch {
    return 'light';
  }
};
export const storeMode = (mode: DashMode) => {
  try { localStorage.setItem(STORAGE_KEY, mode); } catch { /* private mode — the choice just won't persist */ }
};
