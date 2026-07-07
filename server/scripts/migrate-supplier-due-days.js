// Supplier credit terms: add Supplier.dueDays (days allowed to pay after the
// bill date). Drives the Amount Payable (Creditor Aging) buckets. Idempotent.
//
// Run with:  npm --workspace server run migrate:supplier-due-days
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
  if (!(await columnExists('Supplier', 'dueDays'))) {
    await pool.query('ALTER TABLE `Supplier` ADD COLUMN `dueDays` INTEGER NULL');
    console.log('[migrate] added Supplier.dueDays');
  } else {
    console.log('[migrate] Supplier.dueDays already present — skipping');
  }
  console.log('[migrate] Supplier credit terms ready.');
};

main()
  .catch((err) => { console.error('[migrate] failed:', err); process.exitCode = 1; })
  .finally(() => pool.end());
