// Backfill granular permissions when the Accounts umbrella (manage_invoices) was
// split into per-page keys, and Dashboard/Analysis became gated.
//   • Everyone gets `view_dashboard` (the dashboard used to be universal).
//   • Anyone who had `manage_invoices` gets the 7 Accounts keys + `view_analysis`,
//     and the now-legacy `manage_invoices` is removed so revocation is clean.
// Idempotent — safe to re-run.
//
// Run with:  npm --workspace server run migrate:granular-perms
import 'dotenv/config';
import { pool } from '../lib/db.js';

const ACCOUNTS = [
  'view_sales_register', 'view_debtor_aging', 'receive_payments',
  'view_bills_receivable', 'view_purchase_register', 'view_creditor_aging',
  'view_bills_payable', 'view_analysis',
];

const parse = (v) => {
  if (Array.isArray(v)) return v;
  if (typeof v === 'string') { try { const p = JSON.parse(v); return Array.isArray(p) ? p : []; } catch { return []; } }
  return [];
};

const main = async () => {
  const [rows] = await pool.query('SELECT `id`, `permissions` FROM `Membership`');
  let updated = 0;
  for (const m of rows) {
    const set = new Set(parse(m.permissions).filter((k) => typeof k === 'string'));
    const before = JSON.stringify([...set].sort());
    set.add('view_dashboard');
    if (set.has('manage_invoices')) {
      ACCOUNTS.forEach((k) => set.add(k));
      set.delete('manage_invoices');
    }
    if (JSON.stringify([...set].sort()) !== before) {
      await pool.query('UPDATE `Membership` SET `permissions` = ? WHERE `id` = ?', [JSON.stringify([...set]), m.id]);
      updated++;
    }
  }
  console.log(`[migrate] granular permissions backfilled on ${updated} membership(s).`);
};

main()
  .catch((err) => { console.error('[migrate] failed:', err); process.exitCode = 1; })
  .finally(() => pool.end());
