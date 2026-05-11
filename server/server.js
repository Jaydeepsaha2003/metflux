// Metflux backend entry point. Run with `node server.js`.
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import morgan from 'morgan';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

import { env } from './lib/env.js';
import { prisma } from './lib/db.js';
import { errorHandler, notFoundHandler } from './lib/errors.js';
import { hostRouter } from './lib/hostRouter.js';
import { apiRouter } from './routes/index.js';

const execFileAsync = promisify(execFile);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(__dirname, 'public');
const ADMIN_DIR  = path.join(PUBLIC_DIR, 'admin');

/* ---------- app setup ---------- */
const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');

app.use(helmet({
  contentSecurityPolicy: env.NODE_ENV === 'production' ? undefined : false,
  crossOriginEmbedderPolicy: false,
}));
app.use(cors({ origin: env.CORS_ORIGINS, credentials: true }));
app.use(compression());
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(morgan(env.NODE_ENV === 'production' ? 'combined' : 'dev'));

// Health probe
app.get('/healthz', (_req, res) => res.json({ ok: true, ts: Date.now() }));

// Public uploads (logos, customer avatars)
app.use('/uploads', express.static(path.join(PUBLIC_DIR, 'uploads'), {
  maxAge: '7d', fallthrough: true,
}));

// JSON API
app.use('/api', apiRouter);

// Admin SPA at /s/admin, portfolio at /.
app.use(hostRouter({
  adminDir: ADMIN_DIR,
  publicDir: PUBLIC_DIR,
}));

app.use(notFoundHandler);
app.use(errorHandler);

/* ---------- prisma migrate deploy on boot ----------
   Hostinger's Node.js plan auto-runs `npm install` after each git deploy but
   does NOT apply database migrations — so without this, every schema change
   would need a manual SSH step. `migrate deploy` is idempotent: it only
   applies migrations that aren't already recorded in `_prisma_migrations`,
   so the cost on a clean boot is negligible.

   Skipped when SKIP_AUTO_MIGRATE=true (handy if you want to run migrations
   manually from SSH and not have the app race against you on restart). */
const applyPendingMigrations = async () => {
  if (process.env.SKIP_AUTO_MIGRATE === 'true') {
    console.log('[metflux] SKIP_AUTO_MIGRATE=true — skipping prisma migrate deploy');
    return;
  }
  try {
    const { stdout, stderr } = await execFileAsync(
      'npx',
      ['--no', 'prisma', 'migrate', 'deploy'],
      { cwd: __dirname, env: process.env, shell: process.platform === 'win32' }
    );
    const out = (stdout + stderr).trim();
    if (out) console.log('[metflux] migrate deploy:\n' + out);
  } catch (err) {
    console.error('[metflux] migrate deploy failed:');
    console.error(err.stdout?.toString().trim() || '');
    console.error(err.stderr?.toString().trim() || err.message);
    throw err;
  }
};

/* ---------- listen ---------- */
await applyPendingMigrations();

const server = app.listen(env.PORT, () => {
  console.log(`[metflux] api listening on :${env.PORT} (${env.NODE_ENV})`);
});

const shutdown = async (signal) => {
  console.log(`[metflux] ${signal} received — shutting down`);
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));
process.on('unhandledRejection', (err) => console.error('[metflux] unhandledRejection', err));
