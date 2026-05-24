// One-shot migration: adds Membership.hideCustomerNames (default false).
// Used by the per-user privacy toggle in the User form — when enabled, the
// UI replaces customer names with their codes for that membership.
//
// Safe to re-run — idempotent.
// Run with:
//   npm --workspace server run migrate:hide-customer-names
import 'dotenv/config';
import { pool, q, qOne } from '../lib/db.js';

const columnExists = async (table, column) => {
  const row = await qOne(
    `SELECT COUNT(*) AS n FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column]
  );
  return Number(row?.n ?? 0) > 0;
};

const main = async () => {
  if (await columnExists('Membership', 'hideCustomerNames')) {
    console.log('[migrate] Membership.hideCustomerNames already exists');
  } else {
    await q(
      'ALTER TABLE `Membership` ADD COLUMN `hideCustomerNames` BOOLEAN NOT NULL DEFAULT false AFTER `isActive`'
    );
    console.log('[migrate] added Membership.hideCustomerNames (default false)');
  }
  console.log('[migrate] hide-customer-names migration complete.');
};

main()
  .catch((err) => {
    console.error('[migrate] failed:', err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
