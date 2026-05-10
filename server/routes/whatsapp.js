// Free WhatsApp share — generates a wa.me URL the client opens in a new tab.
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../lib/errors.js';
import { requireAuth } from '../lib/auth.js';
import { resolveTenant } from '../lib/tenant.js';
import { buildShareUrl } from '../lib/whatsapp.js';

const router = Router();
router.use(requireAuth, resolveTenant);

router.post('/share-url', asyncHandler(async (req, res) => {
  const { phone, message, documentUrl } = z.object({
    phone: z.string().min(5).max(40),
    message: z.string().min(1).max(900),
    documentUrl: z.string().url().optional(),
  }).parse(req.body);

  const url = buildShareUrl({ phone, message, documentUrl });
  if (!url) {
    return res.status(400).json({
      error: { code: 'BAD_PHONE', message: 'Invalid phone — must include country code' },
    });
  }
  res.json({ url });
}));

export default router;
