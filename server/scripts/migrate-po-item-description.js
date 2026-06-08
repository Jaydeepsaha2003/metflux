// One-shot migration that adds PoOrderItem.description — an optional free-text
// note the user can attach to each sales-order line item.
//
// Safe to re-run — idempotent.
// Run with:
//   npm --workspace server run migrate:po-item-description
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
  if (await columnExists('PoOrderItem', 'description')) {
    console.log('[migrate] PoOrderItem.description already exists — nothing to do.');
  } else {
    await q('ALTER TABLE `PoOrderItem` ADD COLUMN `description` TEXT NULL AFTER `measure`');
    console.log('[migrate] added PoOrderItem.description (nullable TEXT)');
  }
  console.log('[migrate] done.');
};

main()
  .catch((err) => {
    console.error('[migrate] failed:', err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
