// Web Push — subscribe/unsubscribe and broadcast. The browser's PushManager
// hands the server an endpoint + keys; we send notifications to it from here.
import { Router } from 'express';
import { z } from 'zod';
import { env } from '../lib/env.js';
import { asyncHandler } from '../lib/errors.js';
import { requireAuth, requireRole } from '../lib/auth.js';
import { resolveTenant } from '../lib/tenant.js';
import { saveSubscription, removeSubscription, broadcastToCompany, notifyCompanyAdmins } from '../lib/push.js';

const router = Router();

// Public — clients fetch the VAPID public key in order to subscribe.
router.get('/public-key', (_req, res) => {
  res.json({ publicKey: env.VAPID_PUBLIC_KEY || null });
});

router.use(requireAuth, resolveTenant);

router.post('/subscribe', asyncHandler(async (req, res) => {
  const sub = z.object({
    endpoint: z.string().url(),
    keys: z.object({ p256dh: z.string(), auth: z.string() }),
    userAgent: z.string().optional(),
  }).parse(req.body);

  const saved = await saveSubscription({
    userId: req.auth.userId,
    companyId: req.tenant.companyId,
    ...sub,
  });
  res.status(201).json({ id: saved.id });
}));

router.post('/unsubscribe', asyncHandler(async (req, res) => {
  const { endpoint } = z.object({ endpoint: z.string().url() }).parse(req.body);
  await removeSubscription({ userId: req.auth.userId, endpoint });
  res.status(204).end();
}));

// Admin-only — send a test notification to the company admins (and the tester,
// so the person clicking always sees it). Manual button in the notifications bell.
router.post('/test', requireRole('COMPANY_ADMIN'), asyncHandler(async (req, res) => {
  const payload = {
    type: 'TEST',
    title: 'Metflux — test notification',
    body: 'This is a manual test. If you can see this, push notifications are working. ✅',
    url: '/',
  };
  // notifyCompanyAdmins persists + pushes to every admin (incl. the tester).
  const admins = await notifyCompanyAdmins(req.tenant.companyId, payload);
  res.json({ sent: admins.sent, admins: admins.admins });
}));

// Admin-only — send a notification to every subscription in the active company.
router.post('/broadcast', requireRole('COMPANY_ADMIN'), asyncHandler(async (req, res) => {
  const payload = z.object({
    title: z.string().min(1).max(80),
    body: z.string().min(1).max(240),
    url: z.string().url().optional(),
  }).parse(req.body);
  res.json(await broadcastToCompany(req.tenant.companyId, payload));
}));

export default router;
