// Thin wrapper over Brevo's transactional email API (https://api.brevo.com/v3/smtp/email).
// The API key + verified sender live in env; nothing here is company-specific.
import { env } from './env.js';

export const brevoConfigured = () => !!env.BREVO_API_KEY;

/**
 * Send one transactional email with optional attachments.
 *   to          — recipient email
 *   toName      — recipient display name
 *   subject     — subject line
 *   htmlContent — HTML body
 *   sender      — { email, name } (must be a Brevo-verified sender)
 *   attachments — [{ name, content }] where content is base64 (no data: prefix)
 * Throws on non-2xx with the Brevo error message.
 */
export const sendTransactionalEmail = async ({ to, toName, subject, htmlContent, sender, attachment }) => {
  if (!env.BREVO_API_KEY) throw new Error('Email is not configured (BREVO_API_KEY missing).');
  const body = {
    sender: { email: sender.email, name: sender.name || sender.email },
    to: [{ email: to, name: toName || to }],
    subject,
    htmlContent,
    ...(attachment && attachment.length ? { attachment } : {}),
  };
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'api-key': env.BREVO_API_KEY,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json = {};
  try { json = text ? JSON.parse(text) : {}; } catch { /* non-json error body */ }
  if (!res.ok) {
    const msg = json?.message || text || `Brevo error ${res.status}`;
    throw new Error(msg);
  }
  return { messageId: json.messageId ?? null };
};
