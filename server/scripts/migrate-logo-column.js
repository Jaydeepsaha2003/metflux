// Widens Company.logoUrl from VARCHAR(400) to MEDIUMTEXT so it can hold
// base64-encoded logo images stored directly in the database.
//
// Safe to re-run — checks the column type before altering.
// Run with:
//   npm --workspace server run migrate:logo-column
import 'dotenv/config';
import { pool, qOne } from '../lib/db.js';

const main = async () => {
  const row = await qOne(
    `SELECT DATA_TYPE, CHARACTER_MAXIMUM_LENGTH
       FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME   = 'Company'
        AND COLUMN_NAME  = 'logoUrl'`
  );

  if (!row) {
    console.error('[migrate] Company.logoUrl column not found — check your schema.');
    process.exitCode = 1;
    return;
  }

  if (row.DATA_TYPE === 'mediumtext') {
    console.log('[migrate] Company.logoUrl is already MEDIUMTEXT — nothing to do.');
    return;
  }

  await pool.query('ALTER TABLE `Company` MODIFY COLUMN `logoUrl` MEDIUMTEXT NULL');
  console.log('[migrate] Company.logoUrl changed to MEDIUMTEXT.');
  console.log('[migrate] done.');
};

main()
  .catch((err) => {
    console.error('[migrate] failed:', err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
