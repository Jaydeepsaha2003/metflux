// Proforma invoices (export). One row per PI; everything the sheet asks for —
// buyer, consignee, shipment, terms, charges, packing, documents, items — lives in
// `data` as JSON, because a PI form has some sixty fields that only the document
// itself ever reads, while the few the register needs (number, dates, currency,
// buyer, total) are real columns. Idempotent.
//
// Run with:  npm --workspace server run migrate:proforma
import 'dotenv/config';
import { pool } from '../lib/db.js';

const main = async () => {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS \`ProformaInvoice\` (
      \`id\` VARCHAR(191) NOT NULL,
      \`companyId\` VARCHAR(191) NOT NULL,
      \`piNumber\` VARCHAR(60) NOT NULL,
      \`piDate\` DATE NOT NULL,
      \`validUntil\` DATE NULL,
      \`currency\` VARCHAR(3) NOT NULL DEFAULT 'USD',
      \`buyerName\` VARCHAR(200) NOT NULL DEFAULT '',
      \`grandTotal\` DECIMAL(16,2) NOT NULL DEFAULT 0,
      \`data\` MEDIUMTEXT NOT NULL,
      \`createdById\` VARCHAR(191) NULL,
      \`createdAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      \`updatedAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      UNIQUE INDEX \`ProformaInvoice_company_no\`(\`companyId\`, \`piNumber\`),
      INDEX \`ProformaInvoice_company_date\`(\`companyId\`, \`piDate\`),
      PRIMARY KEY (\`id\`)
    ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
  );
  console.log('[migrate] ProformaInvoice table ready.');
};

main()
  .catch((err) => { console.error('[migrate] failed:', err); process.exitCode = 1; })
  .finally(() => pool.end());
