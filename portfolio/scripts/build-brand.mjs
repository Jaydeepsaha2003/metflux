// Runs `next build` with NEXT_PUBLIC_BRAND baked in, then renames out/ to
// out-<brand>/ so the two brand builds don't overwrite each other.
//
// Usage:  node scripts/build-brand.mjs <metflux|toroflux>
import { execSync } from 'node:child_process';
import { existsSync, renameSync, rmSync } from 'node:fs';
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

console.log(`[build-brand] ✓ ${brand} ready in out-${brand}/`);
