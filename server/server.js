// Metflux backend entry point. Run with `node server.js`.
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import morgan from 'morgan';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { env } from './lib/env.js';
import { pool } from './lib/db.js';
import { errorHandler, notFoundHandler } from './lib/errors.js';
import { hostRouter } from './lib/hostRouter.js';
import { apiRouter } from './routes/index.js';

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

/* ---------- listen ----------
   Hostinger's LiteSpeed `lsnode.js` wrapper loads this file via `require()`,
   which refuses any ESM graph with top-level await. So the startup sequence
   has to be wrapped in an IIFE — no `await` may appear at the module's top
   level.

   Database schema is managed manually via phpMyAdmin (see /database.sql at
   repo root). DB access goes through a mysql2 connection pool — no Prisma,
   no Rust engine, no migrate-on-boot. */
let server;

const shutdown = async (signal) => {
  console.log(`[metflux] ${signal} received — shutting down`);
  if (server) {
    server.close(async () => {
      await pool.end();
      process.exit(0);
    });
  } else {
    await pool.end();
    process.exit(0);
  }
  setTimeout(() => process.exit(1), 10_000).unref();
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));
process.on('unhandledRejection', (err) => console.error('[metflux] unhandledRejection', err));

(async () => {
  try {
    server = app.listen(env.PORT, () => {
      console.log(`[metflux] api listening on :${env.PORT} (${env.NODE_ENV})`);
    });
  } catch (err) {
    console.error('[metflux] startup failed:', err);
    process.exit(1);
  }
})();
