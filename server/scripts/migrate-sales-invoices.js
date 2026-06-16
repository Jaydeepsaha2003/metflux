// Creates the Sales Invoices tables: SalesInvoice, Payment, PaymentAllocation.
// Idempotent (CREATE TABLE IF NOT EXISTS) — safe to re-run on every deploy.
//
// Run with:
//   npm --workspace server run migrate:sales-invoices
import 'dotenv/config';
import { pool } from '../lib/db.js';

const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS \`SalesInvoice\` (
    \`id\` VARCHAR(191) NOT NULL,
    \`companyId\` VARCHAR(191) NOT NULL,
    \`invoiceNumber\` VARCHAR(80) NOT NULL,
    \`invoiceDate\` DATETIME(3) NOT NULL,
    \`customerId\` VARCHAR(191) NULL,
    \`customerName\` VARCHAR(200) NOT NULL,
    \`itemDetails\` VARCHAR(400) NULL,
    \`amount\` DOUBLE NOT NULL DEFAULT 0,
    \`taxType\` VARCHAR(40) NULL,
    \`saleAmount\` DOUBLE NOT NULL DEFAULT 0,
    \`taxableAmount\` DOUBLE NOT NULL DEFAULT 0,
    \`igst\` DOUBLE NOT NULL DEFAULT 0,
    \`cgst\` DOUBLE NOT NULL DEFAULT 0,
    \`sgst\` DOUBLE NOT NULL DEFAULT 0,
    \`otherAmount\` DOUBLE NOT NULL DEFAULT 0,
    \`dueDate\` DATETIME(3) NULL,
    \`paidAmount\` DOUBLE NOT NULL DEFAULT 0,
    \`status\` ENUM('UNPAID', 'PARTIAL', 'PAID') NOT NULL DEFAULT 'UNPAID',
    \`notes\` VARCHAR(400) NULL,
    \`createdById\` VARCHAR(191) NULL,
    \`createdAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    \`updatedAt\` DATETIME(3) NOT NULL,
    INDEX \`SalesInvoice_companyId_dueDate_idx\`(\`companyId\`, \`dueDate\`),
    INDEX \`SalesInvoice_companyId_status_idx\`(\`companyId\`, \`status\`),
    INDEX \`SalesInvoice_customerId_idx\`(\`customerId\`),
    UNIQUE INDEX \`SalesInvoice_companyId_invoiceNumber_key\`(\`companyId\`, \`invoiceNumber\`),
    PRIMARY KEY (\`id\`)
  ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS \`Payment\` (
    \`id\` VARCHAR(191) NOT NULL,
    \`companyId\` VARCHAR(191) NOT NULL,
    \`customerId\` VARCHAR(191) NULL,
    \`customerName\` VARCHAR(200) NOT NULL,
    \`amount\` DOUBLE NOT NULL,
    \`allocatedAmount\` DOUBLE NOT NULL DEFAULT 0,
    \`paymentDate\` DATETIME(3) NOT NULL,
    \`method\` VARCHAR(40) NULL,
    \`reference\` VARCHAR(120) NULL,
    \`notes\` VARCHAR(400) NULL,
    \`createdById\` VARCHAR(191) NULL,
    \`createdAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    \`updatedAt\` DATETIME(3) NOT NULL,
    INDEX \`Payment_companyId_paymentDate_idx\`(\`companyId\`, \`paymentDate\`),
    INDEX \`Payment_customerId_idx\`(\`customerId\`),
    PRIMARY KEY (\`id\`)
  ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS \`PaymentAllocation\` (
    \`id\` VARCHAR(191) NOT NULL,
    \`companyId\` VARCHAR(191) NOT NULL,
    \`paymentId\` VARCHAR(191) NOT NULL,
    \`salesInvoiceId\` VARCHAR(191) NOT NULL,
    \`amount\` DOUBLE NOT NULL,
    \`createdAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    INDEX \`PaymentAllocation_paymentId_idx\`(\`paymentId\`),
    INDEX \`PaymentAllocation_salesInvoiceId_idx\`(\`salesInvoiceId\`),
    PRIMARY KEY (\`id\`)
  ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
];

const main = async () => {
  for (const sql of STATEMENTS) {
    await pool.query(sql);
  }
  console.log('[migrate] sales-invoices tables ready (SalesInvoice, Payment, PaymentAllocation).');
};

main()
  .catch((err) => { console.error('[migrate] failed:', err); process.exitCode = 1; })
  .finally(() => pool.end());
