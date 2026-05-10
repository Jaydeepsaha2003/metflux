// After `next build` inside `portfolio/` (output: 'export'), copy the static
// HTML/CSS/JS from `portfolio/out/` into `server/public/portfolio/` so Express
// can serve it on metflux.com via the hostRouter.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC  = path.resolve(__dirname, '../../portfolio/out');
const DEST = path.resolve(__dirname, '../public/portfolio');

if (!fs.existsSync(SRC)) {
  console.error(`[copy-portfolio] missing ${SRC} — run \`npm run build:portfolio\` first`);
  process.exit(1);
}

fs.rmSync(DEST, { recursive: true, force: true });
fs.mkdirSync(DEST, { recursive: true });
fs.cpSync(SRC, DEST, { recursive: true });

console.log(`[copy-portfolio] copied ${SRC} → ${DEST}`);
