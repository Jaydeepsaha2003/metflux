// Web Push notifications via VAPID. Free, no Firebase. Supports Chrome/Edge/
// Firefox/Android out of the box; iOS Safari requires the user to "Add to
// Home Screen" before they can receive push.
import webpush from 'web-push';
import { q, qOne, insert, update } from './db.js';
import { env } from './env.js';
import { createNotification } from './notifications.js';

let configured = false;
const ensureConfigured = () => {
  if (configured) return true;
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) return false;
  webpush.setVapidDetails(env.VAPID_SUBJECT, env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);
  configured = true;
  return true;
};

// Upsert on `endpoint` (unique). Insert if missing, update keys + binding if present.
export const saveSubscription = async ({ userId, companyId, endpoint, keys, userAgent }) => {
  const existing = await qOne(
    'SELECT `id` FROM `PushSubscription` WHERE `endpoint` = ?',
    [endpoint]
  );
  if (existing) {
    return update('PushSubscription', existing.id, {
      p256dh: keys.p256dh,
      auth: keys.auth,
      userAgent,
      userId,
      companyId,
    });
  }
  return insert('PushSubscription', {
    endpoint,
    p256dh: keys.p256dh,
    auth: keys.auth,
    userAgent,
    userId,
    companyId,
  });
};

export const removeSubscription = ({ userId, endpoint }) =>
  q('DELETE FROM `PushSubscription` WHERE `endpoint` = ? AND `userId` = ?', [endpoint, userId]);

const sendOne = async (sub, payload) => {
  try {
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      JSON.stringify(payload)
    );
    return { ok: true };
  } catch (err) {
    if (err?.statusCode === 404 || err?.statusCode === 410) {
      await q('DELETE FROM `PushSubscription` WHERE `endpoint` = ?', [sub.endpoint]).catch(() => {});
      return { ok: false, gone: true };
    }
    return { ok: false, error: err?.message };
  }
};

export const broadcastToCompany = async (companyId, payload) => {
  if (!ensureConfigured()) return { sent: 0, failed: 0, error: 'VAPID keys not configured' };
  const subs = await q('SELECT * FROM `PushSubscription` WHERE `companyId` = ?', [companyId]);
  const results = await Promise.all(subs.map((s) => sendOne(s, payload)));
  return {
    sent: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok && !r.gone).length,
    cleaned: results.filter((r) => r.gone).length,
  };
};

// Web push only (no persisted notification). Used by the self-test.
export const sendToUser = async (userId, payload) => {
  if (!ensureConfigured()) return { sent: 0 };
  const subs = await q('SELECT * FROM `PushSubscription` WHERE `userId` = ?', [userId]);
  const results = await Promise.all(subs.map((s) => sendOne(s, payload)));
  return { sent: results.filter((r) => r.ok).length };
};

// Deliver to one user: persist an in-app notification (bell panel) AND push.
export const deliver = async (companyId, userId, payload) => {
  await createNotification({
    companyId, userId, type: payload.type ?? 'SYSTEM',
    title: payload.title, body: payload.body ?? null, url: payload.url ?? null, tag: payload.tag ?? null,
  });
  return sendToUser(userId, payload);
};

// Notify every active company admin. `push` controls whether a web push is
// also sent (critical alerts) or the notification is panel-only (business
// events like a new order/payment, so phones aren't spammed).
export const notifyCompanyAdmins = async (companyId, payload, { push = true } = {}) => {
  const admins = await q(
    `SELECT DISTINCT u.\`id\` AS id FROM \`User\` u
       INNER JOIN \`Membership\` m ON m.\`userId\` = u.\`id\`
      WHERE m.\`companyId\` = ? AND m.\`role\` = 'COMPANY_ADMIN'
        AND m.\`isActive\` = 1 AND u.\`isActive\` = 1`,
    [companyId]
  );
  let sent = 0;
  for (const a of admins) {
    await createNotification({
      companyId, userId: a.id, type: payload.type ?? 'SYSTEM',
      title: payload.title, body: payload.body ?? null, url: payload.url ?? null, tag: payload.tag ?? null,
    });
    if (push) { const r = await sendToUser(a.id, payload); sent += r.sent; }
  }
  return { sent, admins: admins.length };
};
