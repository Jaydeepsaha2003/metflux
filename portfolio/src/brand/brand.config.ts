// Brand configuration — selects which brand the current build/run is for.
//
// The active brand is decided at BUILD TIME via the NEXT_PUBLIC_BRAND
// environment variable (set by the build:metflux / build:toroflux scripts in
// portfolio/package.json). The value is inlined into the static export, so
// there's no runtime brand switch — each brand gets its own `out-*` folder.
//
// Default: 'metflux' (preserves existing behaviour when no env var is set,
// e.g. during local `npm run dev`).
//
// Add a new brand by:
//   1. adding its name to BRAND_NAMES
//   2. creating src/brand/<name>.theme.css with CSS variable overrides
//   3. creating src/data/siteData.<name>.json
//   4. wiring src/data/siteData.ts to import the new JSON
//   5. adding a build:<name> script in portfolio/package.json

export const BRAND_NAMES = ['metflux', 'toroflux'] as const;
export type BrandName = (typeof BRAND_NAMES)[number];

const raw = (process.env.NEXT_PUBLIC_BRAND ?? 'metflux').toLowerCase();
export const BRAND: BrandName =
  (BRAND_NAMES as readonly string[]).includes(raw) ? (raw as BrandName) : 'metflux';

// Tailwind reads this in tailwind.config.ts to switch the `pulse` palette,
// which is the only spot where colour is hardcoded outside CSS variables.
export const BRAND_PALETTES: Record<BrandName, Record<string, string>> = {
  metflux: {
    50:  '#f0fdf4',
    100: '#dcfce7',
    200: '#bbf7d0',
    300: '#86efac',
    400: '#4ade80',
    500: '#2cab4a',  // primary green
    600: '#16a34a',
    700: '#15803d',
    800: '#166534',
    900: '#14532d',
    950: '#052e16',
  },
  toroflux: {
    50:  '#eff4ff',
    100: '#dbe6fe',
    200: '#bccffd',
    300: '#8eaefa',
    400: '#5a82f5',
    500: '#0f50e5',  // primary blue (sampled from logo)
    600: '#0a40c7',
    700: '#0935a3',
    800: '#0c2f7f',
    900: '#0e2b65',
    950: '#091b45',
  },
};
