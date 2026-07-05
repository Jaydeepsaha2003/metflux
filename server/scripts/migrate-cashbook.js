// Cashbook account-head classification + stored cashbook entries for the
// Receipts & Payments summary. Idempotent.
//
// Run with:  npm --workspace server run migrate:cashbook
import 'dotenv/config';
import { pool } from '../lib/db.js';

const main = async () => {
  // Classification of a bank-book account head → CUSTOMER / SUPPLIER / OTHER.
  // Customer/Supplier heads become real records (their own tables); this table
  // remembers OTHER heads (with a free-text category) so re-uploads recognise them.
  await pool.query(
    `CREATE TABLE IF NOT EXISTS \`AccountHead\` (
      \`id\` VARCHAR(191) NOT NULL,
      \`companyId\` VARCHAR(191) NOT NULL,
      \`name\` VARCHAR(200) NOT NULL,
      \`normKey\` VARCHAR(200) NOT NULL,
      \`type\` ENUM('CUSTOMER','SUPPLIER','OTHER') NOT NULL DEFAULT 'OTHER',
      \`category\` VARCHAR(120) NULL,
      \`createdAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      \`updatedAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      UNIQUE INDEX \`AccountHead_company_norm_key\`(\`companyId\`, \`normKey\`),
      PRIMARY KEY (\`id\`)
    ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
  );
  console.log('[migrate] AccountHead table ready.');

  // Every parsed bank-book row, stored for the persistent Cashbook Summary.
  // Classification is resolved live at query time (so re-tagging updates the
  // summary without a re-import).
  await pool.query(
    `CREATE TABLE IF NOT EXISTS \`CashbookEntry\` (
      \`id\` VARCHAR(191) NOT NULL,
      \`companyId\` VARCHAR(191) NOT NULL,
      \`entryDate\` DATETIME(3) NULL,
      \`side\` ENUM('RECEIPT','PAYMENT') NOT NULL,
      \`account\` VARCHAR(200) NOT NULL,
      \`normKey\` VARCHAR(200) NOT NULL,
      \`amount\` DOUBLE NOT NULL DEFAULT 0,
      \`vch\` VARCHAR(80) NULL,
      \`createdAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      INDEX \`CashbookEntry_company_date_idx\`(\`companyId\`, \`entryDate\`),
      INDEX \`CashbookEntry_company_norm_idx\`(\`companyId\`, \`normKey\`),
      PRIMARY KEY (\`id\`)
    ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
  );
  console.log('[migrate] CashbookEntry table ready.');
};

main()
  .catch((err) => { console.error('[migrate] failed:', err); process.exitCode = 1; })
  .finally(() => pool.end());
