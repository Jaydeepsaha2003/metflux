// Adds Customer.shareToken (VARCHAR 64) and backfills existing rows with a
// fresh UUID v4. Safe to re-run — skips the ALTER if column already exists and
// skips individual rows that already have a token.
//
// Run with:
//   npm --workspace server run migrate:share-token
import 'dotenv/config';
import { pool, q, qOne } from '../lib/db.js';
import { v4 as uuidv4 } from 'uuid';

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

  const blanks = await q('SELECT `id` FROM `Customer` WHERE `shareToken` IS NULL');
  if (blanks.length === 0) {
    console.log('[migrate] all customers already have a share token');
  } else {
    console.log(`[migrate] generating tokens for ${blanks.length} customer(s)…`);
    for (const c of blanks) {
      await pool.query(
        'UPDATE `Customer` SET `shareToken` = ? WHERE `id` = ?',
        [uuidv4(), c.id]
      );
    }
    console.log('[migrate] tokens generated');
  }

  console.log('[migrate] done.');
};

main()
  .catch((err) => { console.error('[migrate] failed:', err); process.exitCode = 1; })
  .finally(() => pool.end());
