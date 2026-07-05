// Public, unauthenticated endpoints — currently just the contact-form receiver
// for the portfolio website at metflux.com. Mounted under /api/public.
//
// Anti-abuse: a tighter rate limit (per IP) than the general api limiter, plus
// minimal field validation. Submissions go straight into ContactSubmission.
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { insert, qOne } from '../lib/db.js';
import { asyncHandler } from '../lib/errors.js';

const router = Router();

/* GET /api/public/app-branding — global webapp logo (data URL) for the login
   page + favicon. Unauthenticated; tolerates the table not existing yet. */
router.get('/app-branding', asyncHandler(async (_req, res) => {
  let logoUrl = null;
  try {
    const row = await qOne("SELECT `settingValue` FROM `AppSetting` WHERE `settingKey` = 'app_logo'");
    logoUrl = row?.settingValue ?? null;
  } catch { /* AppSetting not migrated yet */ }
  res.json({ logoUrl });
}));

const contactLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutes
  max: 5,                    // 5 submissions per IP per 10 min
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many submissions. Try again in a few minutes.' },
});

const contactSchema = z.object({
  name:    z.string().trim().min(1).max(160),
  email:   z.string().trim().email().max(160),
  phone:   z.string().trim().max(40).optional().nullable(),
  company: z.string().trim().max(200).optional().nullable(),
  subject: z.string().trim().max(200).optional().nullable(),
  message: z.string().trim().max(5000).optional().nullable(),
  formType: z.string().trim().max(40).optional().default('contact'),
});

router.post('/contact', contactLimiter, asyncHandler(async (req, res) => {
  const parsed = contactSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      success: false,
      error: 'Validation error',
      details: parsed.error.flatten().fieldErrors,
    });
  }
  const data = parsed.data;

  const ipAddress = (req.ip || req.socket?.remoteAddress || 'unknown').slice(0, 60);
  const userAgent = (req.headers['user-agent'] || 'unknown').slice(0, 400);

  const created = await insert('ContactSubmission', {
    name:     data.name,
    email:    data.email,
    phone:    data.phone   ?? null,
    company:  data.company ?? null,
    subject:  data.subject ?? null,
    message:  data.message ?? null,
    formType: data.formType ?? 'contact',
    ipAddress,
    userAgent,
  });

  res.status(201).json({
    success: true,
    message: 'Form submitted successfully',
    data: { id: created.id, createdAt: created.createdAt },
  });
}));

export default router;
