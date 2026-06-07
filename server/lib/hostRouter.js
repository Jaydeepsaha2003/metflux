// Static asset routing for the marketing portfolio + admin SPA.
//
//   /s/admin/*       → React admin SPA (with SPA fallback)
//   torofluxindustries.com/* → server/public/portfolio-toroflux/
//   metfluxelectrical.com/*  → server/public/portfolio-metflux/
//   anything else            → server/public/portfolio-metflux/  (default)
//
// Brand resolution is by request Host header (case-insensitive substring).
// Adding a new brand: drop its build into server/public/portfolio-<brand>/
// and add a match in HOSTNAME_TO_BRAND below.
import path from 'node:path';
import express from 'express';
import fs from 'node:fs';

const ADMIN_MOUNT = '/s/admin';

// Substring (case-insensitive) → brand folder under server/public/.
// First match wins; default is 'metflux'.
const HOSTNAME_TO_BRAND = [
  { match: 'toroflux',   brand: 'toroflux' },
  { match: 'metflux',    brand: 'metflux'  },
];
const DEFAULT_BRAND = 'metflux';

const brandForHost = (hostHeader) => {
  const h = String(hostHeader ?? '').toLowerCase();
  for (const rule of HOSTNAME_TO_BRAND) {
    if (h.includes(rule.match)) return rule.brand;
  }
  return DEFAULT_BRAND;
};

export const hostRouter = ({ adminDir, publicDir }) => {
  const hasAdmin = fs.existsSync(path.join(adminDir, 'index.html'));

  // Build a static-server pair per brand directory we find on disk. Brands
  // without a built portfolio are simply not registered — requests for that
  // host fall through to the default brand below.
  const brandStatics = {};
  for (const brand of ['metflux', 'toroflux']) {
    const dir = path.join(publicDir, `portfolio-${brand}`);
    if (fs.existsSync(path.join(dir, 'index.html'))) {
      brandStatics[brand] = { dir, static: express.static(dir, staticOpts()) };
    }
  }
  // Back-compat fallback: server/public/portfolio/ (the pre-multi-brand path).
  const legacyDir = path.join(publicDir, 'portfolio');
  if (fs.existsSync(path.join(legacyDir, 'index.html')) && !brandStatics.metflux) {
    brandStatics.metflux = { dir: legacyDir, static: express.static(legacyDir, staticOpts()) };
  }

  const adminStatic = hasAdmin ? express.static(adminDir, staticOpts()) : null;

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

  // Admin SPA — only served when the request comes from an admin hostname
  // (host contains "admin") or from localhost / an IP (dev environment).
  // Portfolio domains like metfluxelectrical.com must not expose the admin
  // panel even if someone manually visits /s/admin on them.
  const isAdminHost = (req) => {
    const host = String(req.headers.host ?? '').toLowerCase().split(':')[0];
    return (
      host.includes('admin') ||
      host === 'localhost' ||
      /^127\.|^::1$|^0\.0\.0\.0$/.test(host)
    );
  };

  router.use(ADMIN_MOUNT, async (req, res, next) => {
    // Block admin access from non-admin hostnames.
    if (!isAdminHost(req)) return next();

    if (!adminStatic) {
      return res
        .status(503)
        .send('Admin SPA not built yet. Run `npm run build` from the repo root.');
    }
    if (await tryStatic(adminStatic, adminDir, req, res)) return;
    if (req.method !== 'GET') return next();
    res.sendFile(path.join(adminDir, 'index.html'));
  });

  // Brand-aware portfolio — pick the static folder per request hostname.
  router.use(async (req, res, next) => {
    const brand = brandForHost(req.headers.host);
    // Resolve to the requested brand, or fall back to the default brand if
    // its build is missing on disk. If neither is built, show a placeholder.
    const target = brandStatics[brand] ?? brandStatics[DEFAULT_BRAND];
    if (!target) {
      return res
        .status(200)
        .type('html')
        .send(
          `<h1>Site</h1><p>Portfolio not built. Admin: <a href="${ADMIN_MOUNT}">${ADMIN_MOUNT}</a></p>`
        );
    }
    if (await tryStatic(target.static, target.dir, req, res)) return;
    if (req.method !== 'GET') return next();
    res.sendFile(path.join(target.dir, 'index.html'));
  });

  return router;
};

// Static-file middleware options. Identical for every brand + the admin SPA:
// hashed bundles cache forever, HTML never caches (so redeploys land
// immediately), other assets re-validate every 60 s.
function staticOpts() {
  return {
    index: false,
    extensions: ['html'],
    setHeaders: (res, filePath) => {
      const isHashed = /[\\/](_next[\\/]static|assets|static)[\\/]/i.test(filePath);
      if (filePath.endsWith('.html')) {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      } else if (isHashed) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      } else {
        res.setHeader('Cache-Control', 'public, max-age=60, must-revalidate');
      }
    },
  };
}
