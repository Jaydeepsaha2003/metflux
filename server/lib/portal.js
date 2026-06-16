// Customer-portal helpers: deriving the initial password from customer details
// and minting the shareable short-link code. Kept separate from auth.js so the
// derivation rules live in one obvious place (the customers route + the backfill
// migration both import from here, so they can never drift apart).
import crypto from 'node:crypto';
import { qOne } from './db.js';

/**
 * Build the initial portal password from the customer's own details so it's
 * easy to communicate: first letters of the name + the last 4 of the GSTIN
 * (e.g. "Aarti Steels" + GST …A1Z5 → "AartA1Z5"). Falls back to the phone's
 * last 4 digits, then to a random 4-digit tail, so every customer always gets
 * a usable password. Customers are forced to change it on first login, so this
 * only ever serves as a one-time hand-off credential.
 */
export const derivePortalPassword = ({ name, gstNumber, phone } = {}) => {
  const alpha = String(name ?? '').replace(/[^a-zA-Z]/g, '');
  const head = (alpha.slice(0, 4) || 'Cust');
  const prefix = head.charAt(0).toUpperCase() + head.slice(1).toLowerCase();

  let tail = '';
  const gst = String(gstNumber ?? '').replace(/[^a-zA-Z0-9]/g, '');
  if (gst.length >= 4) {
    tail = gst.slice(-4).toUpperCase();
  } else {
    const digits = String(phone ?? '').replace(/\D/g, '');
    if (digits.length >= 4) tail = digits.slice(-4);
  }
  while (tail.length < 4) tail += String(crypto.randomInt(0, 10));

  return `${prefix}${tail}`;
};

// URL-safe alphabet without lookalikes (no 0/O/1/l/I) — short codes get typed.
const SHORT_ALPHABET = '23456789abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ';

const randomShortCode = (len = 6) => {
  let out = '';
  for (let i = 0; i < len; i++) {
    out += SHORT_ALPHABET[crypto.randomInt(0, SHORT_ALPHABET.length)];
  }
  return out;
};

/** A short code that's globally unique across all customers (it's the public
    /p/<code> lookup key). Retries on the astronomically rare collision. */
export const uniqueShortCode = async (excludeId = null) => {
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const candidate = randomShortCode();
    const clash = await qOne(
      `SELECT \`id\` FROM \`Customer\` WHERE \`portalShortCode\` = ?${excludeId ? ' AND `id` <> ?' : ''}`,
      excludeId ? [candidate, excludeId] : [candidate]
    );
    if (!clash) return candidate;
  }
};
