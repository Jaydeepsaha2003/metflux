// Persisted in-app notifications (the bell panel). Created alongside every web
// push so the panel has history + unread state even when the push isn't seen.
import { insert } from './db.js';

export const createNotification = async ({ companyId, userId, type = 'SYSTEM', title, body = null, url = null, tag = null }) => {
  if (!companyId || !userId || !title) return null;
  try {
    return await insert('Notification', { companyId, userId, type, title, body, url, tag });
  } catch {
    return null; // table absent on a minimal install — never block the caller
  }
};
