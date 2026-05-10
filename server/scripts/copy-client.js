// After `npm run build:client`, copy the Vite output into server/public/admin
// so the same Node process serves the SPA on admin.metflux.com.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(__dirname, '../../client/dist');
const DEST = path.resolve(__dirname, '../public/admin');

if (!fs.existsSync(SRC)) {
  console.error(`[copy-client] missing ${SRC} — run \`npm run build:client\` first`);
  process.exit(1);
}

fs.rmSync(DEST, { recursive: true, force: true });
fs.mkdirSync(DEST, { recursive: true });
fs.cpSync(SRC, DEST, { recursive: true });

console.log(`[copy-client] copied ${SRC} → ${DEST}`);
