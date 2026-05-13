// Web Push notifications via VAPID. Free, no Firebase. Supports Chrome/Edge/
// Firefox/Android out of the box; iOS Safari requires the user to "Add to
// Home Screen" before they can receive push.
import webpush from 'web-push';
import { q, qOne, insert, update } from './db.js';
import { env } from './env.js';

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

export const sendToUser = async (userId, payload) => {
  if (!ensureConfigured()) return { sent: 0 };
  const subs = await q('SELECT * FROM `PushSubscription` WHERE `userId` = ?', [userId]);
  const results = await Promise.all(subs.map((s) => sendOne(s, payload)));
  return { sent: results.filter((r) => r.ok).length };
};
