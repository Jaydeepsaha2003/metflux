// Public short-link resolver. Mounted at /p (outside /api) so a customer can be
// handed a tidy link like https://metfluxelectrical.com/p/Xa7Bk2 that simply
// 302-redirects into their portal SPA at /s/admin/portal/<shareToken>.
import { Router } from 'express';
import { qOne } from '../lib/db.js';

const router = Router();

// Codes are minted from a fixed alphabet (see lib/portal.js) — reject anything
// that can't be one before touching the DB.
const CODE_RE = /^[0-9A-Za-z]{1,16}$/;

router.get('/:code', async (req, res, next) => {
  try {
    const { code } = req.params;
    if (!CODE_RE.test(code)) return next(); // fall through to portfolio/404

    const customer = await qOne(
      'SELECT `shareToken`, `id` FROM `Customer` WHERE `portalShortCode` = ?',
      [code]
    );
    if (!customer) return next();

    const target = `/s/admin/portal/${customer.shareToken || customer.id}`;
    res.redirect(302, target);
  } catch (err) {
    next(err);
  }
});

export default router;
