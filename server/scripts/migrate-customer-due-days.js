// Adds Customer.dueDays — credit terms in days (payment due = invoice date +
// dueDays). NULL means "not set"; the Sales Invoices importer flags invoices
// whose customer has no dueDays so they can't silently miss a due date.
// Safe to re-run — idempotent.
//
// Run with:
//   npm --workspace server run migrate:customer-due-days
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
  if (!(await columnExists('Customer', 'dueDays'))) {
    await pool.query('ALTER TABLE `Customer` ADD COLUMN `dueDays` INTEGER NULL');
    console.log('[migrate] added Customer.dueDays column');
  } else {
    console.log('[migrate] Customer.dueDays already exists — skipping ALTER');
  }
  console.log('[migrate] done.');
};

main()
  .catch((err) => { console.error('[migrate] failed:', err); process.exitCode = 1; })
  .finally(() => pool.end());
