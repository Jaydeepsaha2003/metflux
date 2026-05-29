// After `npm run build:portfolio` inside the root, the portfolio build script
// emits one folder per brand: portfolio/out-metflux/ and portfolio/out-toroflux/.
// This script copies each one into server/public/portfolio-<brand>/, where
// the hostRouter picks the right folder based on the request's Host header.
//
// The legacy server/public/portfolio/ directory is also kept as a symlink/copy
// of the Metflux build so any old asset URL that omits the brand suffix still
// resolves (back-compat for cached HTML referencing the old path).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORTFOLIO_ROOT = path.resolve(__dirname, '../../portfolio');
const PUBLIC_ROOT    = path.resolve(__dirname, '../public');

const BRANDS = ['metflux', 'toroflux'];

let copiedAny = false;
for (const brand of BRANDS) {
  const src  = path.join(PORTFOLIO_ROOT, `out-${brand}`);
  const dest = path.join(PUBLIC_ROOT,    `portfolio-${brand}`);
  if (!fs.existsSync(src)) {
    console.warn(`[copy-portfolio] skipping ${brand} — ${src} not found`);
    continue;
  }
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });
  fs.cpSync(src, dest, { recursive: true });
  console.log(`[copy-portfolio] copied ${src} → ${dest}`);
  copiedAny = true;
}

// Back-compat: server/public/portfolio/ mirrors the Metflux build so older
// hostRouter behaviour (and any cached HTML) still finds assets there.
const metfluxDest = path.join(PUBLIC_ROOT, 'portfolio-metflux');
const legacyDest  = path.join(PUBLIC_ROOT, 'portfolio');
if (fs.existsSync(metfluxDest)) {
  fs.rmSync(legacyDest, { recursive: true, force: true });
  fs.mkdirSync(legacyDest, { recursive: true });
  fs.cpSync(metfluxDest, legacyDest, { recursive: true });
  console.log(`[copy-portfolio] mirrored portfolio-metflux → portfolio (back-compat)`);
}

if (!copiedAny) {
  console.error('[copy-portfolio] no brand outputs found — did `npm run build:portfolio` run?');
  process.exit(1);
}
