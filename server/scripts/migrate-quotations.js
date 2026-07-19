// Quotations — a standalone sales-quote document (own number, PDF print). Mirrors
// the Sales Order item structure so the same entry form is reused; converting an
// accepted quotation creates a real PoOrder. Quotations do NOT touch production/
// dispatch/accounts until converted. Idempotent.
//
// Run with:  npm --workspace server run migrate:quotations
import 'dotenv/config';
import { pool } from '../lib/db.js';

const main = async () => {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS \`Quotation\` (
      \`id\` VARCHAR(191) NOT NULL,
      \`companyId\` VARCHAR(191) NOT NULL,
      \`quotationNo\` VARCHAR(60) NOT NULL,
      \`customerId\` VARCHAR(191) NOT NULL,
      \`quotationDate\` DATETIME(3) NOT NULL,
      \`validUntil\` DATETIME(3) NULL,
      \`notes\` TEXT NULL,
      \`terms\` TEXT NULL,
      \`status\` ENUM('OPEN','CONVERTED','CANCELLED') NOT NULL DEFAULT 'OPEN',
      \`convertedPoOrderId\` VARCHAR(191) NULL,
      \`createdById\` VARCHAR(191) NULL,
      \`createdAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      \`updatedAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      INDEX \`Quotation_company_date_idx\`(\`companyId\`, \`quotationDate\`),
      INDEX \`Quotation_customer_idx\`(\`customerId\`),
      UNIQUE INDEX \`Quotation_company_no_key\`(\`companyId\`, \`quotationNo\`),
      PRIMARY KEY (\`id\`)
    ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
  );
  console.log('[migrate] Quotation table ready.');

  await pool.query(
    `CREATE TABLE IF NOT EXISTS \`QuotationItem\` (
      \`id\` VARCHAR(191) NOT NULL,
      \`quotationId\` VARCHAR(191) NOT NULL,
      \`coreType\` ENUM('TOROIDAL','RECTANGULAR','NANO','COMPOSITE') NOT NULL,
      \`grade\` VARCHAR(80) NOT NULL,
      \`material\` VARCHAR(120) NOT NULL,
      \`measure\` VARCHAR(160) NOT NULL,
      \`hsnCode\` VARCHAR(20) NULL,
      \`unit\` VARCHAR(20) NULL DEFAULT 'Pcs',
      \`id1\` DOUBLE NOT NULL, \`id2\` DOUBLE NULL,
      \`od1\` DOUBLE NOT NULL, \`od2\` DOUBLE NULL,
      \`ht\` DOUBLE NOT NULL, \`builtup\` DOUBLE NULL,
      \`weightPerPc\` DOUBLE NOT NULL,
      \`pcs\` INTEGER NOT NULL,
      \`totalWeight\` DOUBLE NOT NULL,
      \`coreAc\` DOUBLE NULL, \`coreMl\` DOUBLE NULL, \`d13\` DOUBLE NULL,
      \`turns\` INTEGER NULL, \`flux\` DOUBLE NULL, \`ateCm\` DOUBLE NULL,
      \`testVoltage\` DOUBLE NULL, \`testCurrent\` DOUBLE NULL,
      \`rateBasis\` ENUM('PER_KG','PER_PCS') NULL,
      \`rateValue\` DOUBLE NULL, \`ratePerKg\` DOUBLE NULL, \`ratePerPc\` DOUBLE NULL,
      \`totalAmount\` DOUBLE NULL,
      \`nanoPrice\` DOUBLE NULL, \`casePrice\` DOUBLE NULL, \`caseWeight\` DOUBLE NULL, \`nanoSoRate\` DOUBLE NULL,
      \`seq\` INTEGER NOT NULL DEFAULT 0,
      \`createdAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      INDEX \`QuotationItem_quotation_idx\`(\`quotationId\`),
      PRIMARY KEY (\`id\`)
    ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
  );
  console.log('[migrate] QuotationItem table ready.');
};

main()
  .catch((err) => { console.error('[migrate] failed:', err); process.exitCode = 1; })
  .finally(() => pool.end());
