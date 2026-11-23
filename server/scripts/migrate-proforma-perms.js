// Proforma invoices (and export test certificates) get their own permissions,
// add_proforma / view_proforma, instead of riding on the Quotation / SO ones.
// So nobody loses access on deploy, members who could reach them before are
// granted the new keys. Runs ONCE (marker in AppSetting): re-running on every
// deploy would re-grant a key an admin had deliberately taken away.
//
// Run with:  npm --workspace server run migrate:proforma-perms
import 'dotenv/config';
import { pool } from '../lib/db.js';

const MARKER = 'migration:proforma-perms';

const parse = (v) => {
  if (Array.isArray(v)) return v;
  if (typeof v === 'string') { try { const p = JSON.parse(v); return Array.isArray(p) ? p : []; } catch { return []; } }
  return [];
};

const main = async () => {
  const [[done]] = await pool.query('SELECT `settingKey` FROM `AppSetting` WHERE `settingKey` = ?', [MARKER]);
  if (done) { console.log('[migrate] proforma permissions already backfilled.'); return; }

  const [rows] = await pool.query('SELECT `id`, `permissions` FROM `Membership`');
  let updated = 0;
  for (const m of rows) {
    const set = new Set(parse(m.permissions).filter((k) => typeof k === 'string'));
    const before = set.size;
    if (set.has('add_quotation') || set.has('add_po')) set.add('add_proforma');
    if (set.has('view_quotation') || set.has('view_po')) set.add('view_proforma');
    if (set.size !== before) {
      await pool.query('UPDATE `Membership` SET `permissions` = ? WHERE `id` = ?', [JSON.stringify([...set]), m.id]);
      updated++;
    }
  }
  await pool.query('INSERT INTO `AppSetting` (`settingKey`, `settingValue`) VALUES (?, ?)', [MARKER, new Date().toISOString()]);
  console.log(`[migrate] proforma permissions granted on ${updated} membership(s).`);
};

main()
  .catch((err) => { console.error('[migrate] failed:', err); process.exitCode = 1; })
  .finally(() => pool.end());
