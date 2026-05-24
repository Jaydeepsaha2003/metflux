// Static asset routing:
//   /s/admin/*  → React admin SPA (with SPA fallback)
//   /*          → static portfolio
import path from 'node:path';
import express from 'express';
import fs from 'node:fs';

const ADMIN_MOUNT = '/s/admin';

export const hostRouter = ({ adminDir, publicDir }) => {
  const portfolioDir = path.join(publicDir, 'portfolio');
  const hasAdmin = fs.existsSync(path.join(adminDir, 'index.html'));
  const hasPortfolio = fs.existsSync(path.join(portfolioDir, 'index.html'));

  // Hashed bundles (anything under /_next/static/, /assets/, /static/) get
  // a year of cache — their filenames change on every build. HTML files get
  // no-cache so the browser always asks the server, which is essential when
  // the build is replaced (otherwise stale HTML keeps pointing at JS chunks
  // that no longer exist).
  const staticOpts = {
    index: false,
    // `extensions: ['html']` makes /products resolve to products.html, so
    // the Next.js static export's per-page HTML files are reachable by
    // their clean URLs (without this, /products fell through to the home
    // page, and a hard refresh on a product page would show the home).
    extensions: ['html'],
    setHeaders: (res, filePath) => {
      const isHashed = /[\\/](_next[\\/]static|assets|static)[\\/]/i.test(filePath);
      if (filePath.endsWith('.html')) {
        // HTML: never cache, so a redeploy is picked up immediately.
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      } else if (isHashed) {
        // Hashed Next bundles: filename changes on every build, cache forever.
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      } else {
        // Unhashed assets (images under /images/, /maps/, /logo/, etc.):
        // 60-second cache + must-revalidate. Browsers may keep the bytes but
        // they'll always check the server for freshness — so when you swap
        // a PNG with the same filename, a plain reload picks it up.
        res.setHeader('Cache-Control', 'public, max-age=60, must-revalidate');
      }
    },
  };

  const adminStatic     = hasAdmin     ? express.static(adminDir,     staticOpts) : null;
  const portfolioStatic = hasPortfolio ? express.static(portfolioDir, staticOpts) : null;

  /** Try to serve a static file for a request — including trailing-slash
      variants like /products/ → products.html. Returns true if served. */
  const tryStatic = (staticMw, dir, req, res) => new Promise((resolve) => {
    if (!staticMw) return resolve(false);
    staticMw(req, res, () => {
      // express.static didn't match. Try without the trailing slash if any.
      if (req.method === 'GET' && req.path.length > 1 && req.path.endsWith('/')) {
        const trimmed = req.path.replace(/\/+$/, '');
        const candidate = path.join(dir, `${trimmed}.html`);
        if (fs.existsSync(candidate)) {
          res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
          return res.sendFile(candidate, (err) => resolve(!err));
        }
      }
      resolve(false);
    });
  });

  const router = express.Router();

  router.use(ADMIN_MOUNT, async (req, res, next) => {
    if (!adminStatic) {
      return res
        .status(503)
        .send('Admin SPA not built yet. Run `npm run build` from the repo root.');
    }
    if (await tryStatic(adminStatic, adminDir, req, res)) return;
    if (req.method !== 'GET') return next();
    res.sendFile(path.join(adminDir, 'index.html'));
  });

  router.use(async (req, res, next) => {
    if (!portfolioStatic) {
      return res
        .status(200)
        .type('html')
        .send(
          `<h1>Metflux</h1><p>Portfolio coming soon. Admin: <a href="${ADMIN_MOUNT}">${ADMIN_MOUNT}</a></p>`
        );
    }
    if (await tryStatic(portfolioStatic, portfolioDir, req, res)) return;
    if (req.method !== 'GET') return next();
    res.sendFile(path.join(portfolioDir, 'index.html'));
  });

  return router;
};
