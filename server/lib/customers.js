// Shared customer-creation helpers — used by importers that need to auto-create
// a customer that doesn't exist yet (e.g. the sales register). Self-contained so
// it never depends on the customers route module.
import { q, qOne, insert } from './db.js';
import { v4 as uuidv4 } from 'uuid';
import { hashPassword } from './auth.js';
import { derivePortalPassword, uniqueShortCode } from './portal.js';

/** First 3 alpha chars of name, padded with X. "AARTI STEELS" → "AAR". */
export const prefixFromName = (name) => {
  const letters = String(name ?? '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3);
  return (letters + 'XXX').slice(0, 3);
};

const slugifyName = (name) => {
  const s = String(name ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50);
  return s || 'customer';
};

/** Globally-unique shareToken from the name slug (portal lookup key). */
export const uniqueShareToken = async (name, excludeId = null) => {
  const base = slugifyName(name);
  let candidate = base;
  let n = 1;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const clash = await qOne(
      `SELECT \`id\` FROM \`Customer\` WHERE \`shareToken\` = ?${excludeId ? ' AND `id` <> ?' : ''}`,
      excludeId ? [candidate, excludeId] : [candidate]
    );
    if (!clash) return candidate;
    n += 1;
    candidate = `${base}-${n}`;
  }
};

/** Next free "XYZ-NNN" customer code for a company. */
export const nextCustomerCode = async (companyId, prefix) => {
  const rows = await q('SELECT `customerCode` FROM `Customer` WHERE `companyId` = ? AND `customerCode` LIKE ?', [companyId, `${prefix}-%`]);
  let max = 0;
  for (const r of rows) { const m = /-(\d+)$/.exec(r.customerCode ?? ''); if (m) max = Math.max(max, parseInt(m[1], 10)); }
  return `${prefix}-${String(max + 1).padStart(3, '0')}`;
};

/** Map a GSTIN's first two digits to the state name (so auto-created customers
 *  get a state for free). Returns null if unknown. */
const GST_STATES = {
  '01': 'Jammu and Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab', '04': 'Chandigarh',
  '05': 'Uttarakhand', '06': 'Haryana', '07': 'Delhi', '08': 'Rajasthan', '09': 'Uttar Pradesh',
  '10': 'Bihar', '11': 'Sikkim', '12': 'Arunachal Pradesh', '13': 'Nagaland', '14': 'Manipur',
  '15': 'Mizoram', '16': 'Tripura', '17': 'Meghalaya', '18': 'Assam', '19': 'West Bengal',
  '20': 'Jharkhand', '21': 'Odisha', '22': 'Chhattisgarh', '23': 'Madhya Pradesh', '24': 'Gujarat',
  '26': 'Dadra and Nagar Haveli and Daman and Diu', '27': 'Maharashtra', '28': 'Andhra Pradesh',
  '29': 'Karnataka', '30': 'Goa', '31': 'Lakshadweep', '32': 'Kerala', '33': 'Tamil Nadu',
  '34': 'Puducherry', '35': 'Andaman and Nicobar Islands', '36': 'Telangana', '37': 'Andhra Pradesh',
  '38': 'Ladakh',
};
export const gstStateName = (gstin) => {
  const code = String(gstin ?? '').trim().slice(0, 2);
  return GST_STATES[code] ?? null;
};

/** The portal credentials bundle for a brand-new customer. */
const provisionPortalCredentials = async (data) => {
  const initial = derivePortalPassword(data);
  return {
    portalPasswordHash: await hashPassword(initial),
    portalInitialPassword: initial,
    portalPasswordSet: 0,
    portalShortCode: await uniqueShortCode(),
  };
};

/** Create a full customer record (code, share token, portal creds). State is
 *  inferred from the GSTIN when not given. Returns the inserted row. */
export const createCustomerRecord = async ({ companyId, createdById, name, gstNumber = null, phone = null, state = null, email = null, dueDays = null }) => {
  const clean = (v, n) => (v ? String(v).trim().slice(0, n) : null);
  const customerCode = await nextCustomerCode(companyId, prefixFromName(name));
  const shareToken = await uniqueShareToken(name);
  const portal = await provisionPortalCredentials({ name, gstNumber, phone });
  return insert('Customer', {
    id: uuidv4(),
    name: String(name || '—').slice(0, 160),
    email: clean(email, 160),
    phone: clean(phone, 40),
    gstNumber: clean(gstNumber, 40),
    state: state ?? gstStateName(gstNumber),
    dueDays,
    customerCode,
    shareToken,
    ...portal,
    companyId,
    createdById,
  });
};
