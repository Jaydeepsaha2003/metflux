// Sets Customer.shareToken = Customer.id so the portal link is stable forever
// (the customer ID never changes, so the share URL never changes either).
// Safe to re-run — idempotent.
//
// Run with:
//   npm --workspace server run migrate:share-token
import 'dotenv/config';
import { pool, qOne } from '../lib/db.js';

const columnExists = async (table, col) => {
  const row = await qOne(
    `SELECT COUNT(*) AS n FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, col]
  );
  return Number(row?.n ?? 0) > 0;
};

const main = async () => {
  if (!(await columnExists('Customer', 'shareToken'))) {
    await pool.query('ALTER TABLE `Customer` ADD COLUMN `shareToken` VARCHAR(64) NULL');
    console.log('[migrate] added Customer.shareToken column');
  } else {
    console.log('[migrate] Customer.shareToken already exists — skipping ALTER');
  }

  // Always set shareToken = id so the portal URL equals the customer ID
  // and is therefore stable across environments and deployments.
  const [result] = await pool.query(
    'UPDATE `Customer` SET `shareToken` = `id`'
  );
  console.log(`[migrate] shareToken = id applied to ${result.affectedRows} customer(s)`);
  console.log('[migrate] done.');
};

main()
  .catch((err) => { console.error('[migrate] failed:', err); process.exitCode = 1; })
  .finally(() => pool.end());
