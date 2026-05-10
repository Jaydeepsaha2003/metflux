// Browser-side helper to subscribe the user to Web Push notifications.
// Call enablePush() from a button in Settings — never on page load (browsers
// only allow Notification.requestPermission() in response to a user gesture).
import { api } from './api';

const urlBase64ToUint8Array = (base64: string) => {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
};

export const enablePush = async (): Promise<{ ok: true } | { ok: false; reason: string }> => {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    return { ok: false, reason: 'Push not supported in this browser' };
  }

  const reg = await navigator.serviceWorker.ready;
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return { ok: false, reason: 'Permission denied' };

  const { publicKey } = await api<{ publicKey: string | null }>('/push/public-key');
  if (!publicKey) return { ok: false, reason: 'Server has no VAPID key configured' };

  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey),
  });

  await api('/push/subscribe', {
    method: 'POST',
    json: {
      endpoint: sub.endpoint,
      keys: sub.toJSON().keys,
      userAgent: navigator.userAgent,
    },
  });

  return { ok: true };
};

export const disablePush = async () => {
  if (!('serviceWorker' in navigator)) return;
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return;
  await api('/push/unsubscribe', { method: 'POST', json: { endpoint: sub.endpoint } }).catch(() => {});
  await sub.unsubscribe();
};
