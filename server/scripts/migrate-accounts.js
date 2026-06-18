// Accounts module migration:
//  • SalesInvoice.docType (INVOICE / CREDIT_NOTE) — a negative invoice is a
//    credit note; backfill existing negatives.
//  • PurchaseInvoice table — the purchase register (supplier bills + debit
//    notes), with TDS captured from the "Other Amount" column.
// Idempotent — safe to re-run.
//
// Run with:  npm --workspace server run migrate:accounts
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
  // ── SalesInvoice.docType ──
  if (!(await columnExists('SalesInvoice', 'docType'))) {
    await pool.query("ALTER TABLE `SalesInvoice` ADD COLUMN `docType` ENUM('INVOICE','CREDIT_NOTE') NOT NULL DEFAULT 'INVOICE'");
    console.log('[migrate] added SalesInvoice.docType');
  } else {
    console.log('[migrate] SalesInvoice.docType already exists — skipping');
  }
  const [cn] = await pool.query("UPDATE `SalesInvoice` SET `docType` = 'CREDIT_NOTE' WHERE `amount` < 0 AND `docType` <> 'CREDIT_NOTE'");
  console.log(`[migrate] tagged ${cn.affectedRows} existing negative sales rows as CREDIT_NOTE`);

  // ── PurchaseInvoice ──
  await pool.query(
    `CREATE TABLE IF NOT EXISTS \`PurchaseInvoice\` (
      \`id\` VARCHAR(191) NOT NULL,
      \`companyId\` VARCHAR(191) NOT NULL,
      \`invoiceNumber\` VARCHAR(80) NOT NULL,
      \`invoiceDate\` DATETIME(3) NOT NULL,
      \`supplierName\` VARCHAR(200) NOT NULL,
      \`gstin\` VARCHAR(40) NULL,
      \`taxType\` VARCHAR(40) NULL,
      \`amount\` DOUBLE NOT NULL DEFAULT 0,
      \`purchaseAmount\` DOUBLE NOT NULL DEFAULT 0,
      \`taxableAmount\` DOUBLE NOT NULL DEFAULT 0,
      \`igst\` DOUBLE NOT NULL DEFAULT 0,
      \`cgst\` DOUBLE NOT NULL DEFAULT 0,
      \`sgst\` DOUBLE NOT NULL DEFAULT 0,
      \`tds\` DOUBLE NOT NULL DEFAULT 0,
      \`docType\` ENUM('INVOICE','DEBIT_NOTE') NOT NULL DEFAULT 'INVOICE',
      \`notes\` VARCHAR(400) NULL,
      \`createdById\` VARCHAR(191) NULL,
      \`createdAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      \`updatedAt\` DATETIME(3) NOT NULL,
      INDEX \`PurchaseInvoice_companyId_invoiceDate_idx\`(\`companyId\`, \`invoiceDate\`),
      UNIQUE INDEX \`PurchaseInvoice_companyId_invoiceNumber_key\`(\`companyId\`, \`invoiceNumber\`),
      PRIMARY KEY (\`id\`)
    ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
  );
  console.log('[migrate] PurchaseInvoice table ready.');
  console.log('[migrate] done.');
};

main()
  .catch((err) => { console.error('[migrate] failed:', err); process.exitCode = 1; })
  .finally(() => pool.end());
