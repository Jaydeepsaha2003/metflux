// Email reminders via Brevo. The client builds the HTML body + PNG/Excel
// attachments (reusing the statement it already renders) and posts them here;
// this route only holds the API key + verified sender and relays to Brevo.
import { Router } from 'express';
import { z } from 'zod';
import { qOne, update } from '../lib/db.js';
import { AppError, asyncHandler } from '../lib/errors.js';
import { requireAuth, requireAnyPermission } from '../lib/auth.js';
import { resolveTenant } from '../lib/tenant.js';
import { env } from '../lib/env.js';
import { brevoConfigured, sendTransactionalEmail } from '../lib/brevo.js';

const router = Router();
router.use(requireAuth, resolveTenant);

/* GET /email/config — is email sending available + the default sender? */
router.get('/config', requireAnyPermission('view_debtor_aging', 'manage_invoices'), asyncHandler(async (req, res) => {
  const company = await qOne('SELECT `name`, `email` FROM `Company` WHERE `id` = ?', [req.tenant.companyId]);
  const senderEmail = env.BREVO_SENDER_EMAIL || company?.email || '';
  res.json({ configured: brevoConfigured() && !!senderEmail, senderEmail });
}));

const schema = z.object({
  customerId: z.string().min(1).optional().nullable(),
  to:         z.string().email(),
  subject:    z.string().trim().min(1).max(300),
  html:       z.string().min(1).max(2_000_000),
  saveEmail:  z.boolean().optional().default(false),
  attachments: z.array(z.object({
    name:    z.string().trim().min(1).max(200),
    content: z.string().min(1).max(20_000_000), // base64, no data: prefix
  })).max(5).optional().default([]),
});

/* POST /email/reminder — send the outstanding-statement email */
router.post('/reminder', requireAnyPermission('view_debtor_aging', 'manage_invoices'), asyncHandler(async (req, res) => {
  const data = schema.parse(req.body);
  if (!brevoConfigured()) throw new AppError('Email is not configured on the server (BREVO_API_KEY).', 400, 'EMAIL_NOT_CONFIGURED');

  const company = await qOne('SELECT `name`, `email` FROM `Company` WHERE `id` = ?', [req.tenant.companyId]);
  const senderEmail = env.BREVO_SENDER_EMAIL || company?.email || '';
  if (!senderEmail) throw new AppError('No sender email set. Set BREVO_SENDER_EMAIL or the company email.', 400, 'NO_SENDER');
  const senderName = env.BREVO_SENDER_NAME || company?.name || senderEmail;

  // Persist the address on the customer if asked (so next time it's pre-filled).
  if (data.saveEmail && data.customerId) {
    const cust = await qOne('SELECT `id` FROM `Customer` WHERE `id` = ? AND `companyId` = ?', [data.customerId, req.tenant.companyId]);
    if (cust) await update('Customer', cust.id, { email: data.to });
  }

  const result = await sendTransactionalEmail({
    to: data.to,
    subject: data.subject,
    htmlContent: data.html,
    sender: { email: senderEmail, name: senderName },
    attachment: data.attachments.map((a) => ({ name: a.name, content: a.content })),
  });
  res.json({ ok: true, messageId: result.messageId });
}));

export default router;
