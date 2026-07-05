// Daily reminders — dedup guard + a due date on purchase invoices.
// Idempotent — safe to re-run.
//
// Run with:  npm --workspace server run migrate:reminders
import 'dotenv/config';
import { pool } from '../lib/db.js';

const columnExists = async (table, column) => {
  const [rows] = await pool.query(
    `SELECT 1 FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1`,
    [table, column]
  );
  return rows.length > 0;
};
const tableExists = async (table) => {
  const [rows] = await pool.query(
    `SELECT 1 FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? LIMIT 1`,
    [table]
  );
  return rows.length > 0;
};

const main = async () => {
  // Guard table: one row per (job, day) so a reminder fires exactly once, even
  // across process restarts and two domain clones sharing one database.
  await pool.query(
    `CREATE TABLE IF NOT EXISTS \`ReminderRun\` (
      \`id\` VARCHAR(191) NOT NULL,
      \`runKey\` VARCHAR(191) NOT NULL,
      \`createdAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      UNIQUE INDEX \`ReminderRun_runKey_key\`(\`runKey\`),
      PRIMARY KEY (\`id\`)
    ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
  );
  console.log('[migrate] ReminderRun table ready.');

  // Optional due date on purchase invoices (they are imported; the due date is
  // read from the sheet when present) so the due-today sweep can flag payables.
  if (await tableExists('PurchaseInvoice')) {
    if (!(await columnExists('PurchaseInvoice', 'dueDate'))) {
      await pool.query('ALTER TABLE `PurchaseInvoice` ADD COLUMN `dueDate` DATETIME(3) NULL');
      await pool.query('ALTER TABLE `PurchaseInvoice` ADD INDEX `PurchaseInvoice_companyId_dueDate_idx` (`companyId`, `dueDate`)');
      console.log('[migrate] added PurchaseInvoice.dueDate (+ index)');
    } else {
      console.log('[migrate] PurchaseInvoice.dueDate already exists — skipping');
    }
  } else {
    console.log('[migrate] PurchaseInvoice table absent — skipping dueDate');
  }
};

main()
  .catch((err) => { console.error('[migrate] failed:', err); process.exitCode = 1; })
  .finally(() => pool.end());
