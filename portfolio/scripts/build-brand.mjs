// Runs `next build` with NEXT_PUBLIC_BRAND baked in, then renames out/ to
// out-<brand>/ so the two brand builds don't overwrite each other.
//
// Usage:  node scripts/build-brand.mjs <metflux|toroflux>
import { execSync } from 'node:child_process';
import { copyFileSync, existsSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const VALID = ['metflux', 'toroflux'];
const brand = process.argv[2];
if (!VALID.includes(brand)) {
  console.error(`Usage: node scripts/build-brand.mjs <${VALID.join('|')}>`);
  process.exit(1);
}

const portfolioRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir    = resolve(portfolioRoot, 'out');
const targetDir = resolve(portfolioRoot, `out-${brand}`);

console.log(`[build-brand] building ${brand} → out-${brand}/`);

// Wipe any previous next-build output (next sometimes refuses to overwrite).
if (existsSync(outDir)) rmSync(outDir, { recursive: true, force: true });

execSync('next build', {
  stdio: 'inherit',
  cwd: portfolioRoot,
  env: { ...process.env, NEXT_PUBLIC_BRAND: brand },
});

// Move out/ → out-<brand>/ so both brand builds can coexist.
if (existsSync(targetDir)) rmSync(targetDir, { recursive: true, force: true });
if (existsSync(outDir))    renameSync(outDir, targetDir);

// Icons are per-brand. next copies all of public/ verbatim, so without this
// step every build ships the same root /favicon.ico — which is exactly how
// torofluxindustries.com ended up showing the Metflux mark in Google. Clear
// the shared root icons, drop in this brand's set, and delete the other
// brands' icon folders so nothing cross-brand is reachable on the domain.
const ROOT_ICONS = ['favicon.svg', 'favicon.ico', 'favicon-32.png', 'favicon-192.png', 'apple-touch-icon.png'];
for (const f of ROOT_ICONS) rmSync(resolve(targetDir, f), { force: true });

const iconSrc = resolve(portfolioRoot, 'public', 'icons', brand);
if (!existsSync(iconSrc)) {
  console.error(`[build-brand] ✗ missing icon set: public/icons/${brand}/`);
  process.exit(1);
}
const copied = readdirSync(iconSrc).filter((f) => ROOT_ICONS.includes(f));
if (!copied.includes('favicon.ico')) {
  console.error(`[build-brand] ✗ public/icons/${brand}/favicon.ico is required`);
  process.exit(1);
}
for (const f of copied) copyFileSync(resolve(iconSrc, f), resolve(targetDir, f));

// The sets are only build inputs — everything needed is now at the root, so
// don't publish the folder (or its internal README) on the live site.
rmSync(resolve(targetDir, 'icons'), { recursive: true, force: true });

console.log(`[build-brand] icons: ${copied.join(', ')}`);
console.log(`[build-brand] ✓ ${brand} ready in out-${brand}/`);
