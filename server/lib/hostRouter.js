// Routes by Host header so admin.metflux.com serves the React admin SPA and
// metflux.com serves the static portfolio. The /api router is mounted before
// this so it works for both hosts.
import path from 'node:path';
import express from 'express';
import fs from 'node:fs';

export const hostRouter = ({ adminHosts, adminDir, publicDir }) => {
  const portfolioDir = path.join(publicDir, 'portfolio');
  const hasAdmin = fs.existsSync(path.join(adminDir, 'index.html'));
  const hasPortfolio = fs.existsSync(path.join(portfolioDir, 'index.html'));

  const adminStatic = hasAdmin
    ? express.static(adminDir, { index: false, maxAge: '1h' })
    : null;
  const portfolioStatic = hasPortfolio
    ? express.static(portfolioDir, { index: false, maxAge: '1h' })
    : null;

  return (req, res, next) => {
    const host = (req.headers.host || '').toLowerCase().split(':')[0];
    const isAdmin = adminHosts.some((h) => host === h || host.startsWith(`${h}.`));

    if (isAdmin) {
      if (!adminStatic) {
        return res
          .status(503)
          .send('Admin SPA not built yet. Run `npm run build` from the repo root.');
      }
      return adminStatic(req, res, () => {
        if (req.method !== 'GET') return next();
        res.sendFile(path.join(adminDir, 'index.html'));
      });
    }

    if (portfolioStatic) {
      return portfolioStatic(req, res, () => {
        if (req.method !== 'GET') return next();
        res.sendFile(path.join(portfolioDir, 'index.html'));
      });
    }
    return res
      .status(200)
      .type('html')
      .send('<h1>Metflux</h1><p>Portfolio coming soon. Admin: <a href="//admin.metflux.com">admin.metflux.com</a></p>');
  };
};
