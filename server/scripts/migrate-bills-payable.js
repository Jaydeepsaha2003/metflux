// Bills Payable migration:
//  • PurchaseInvoice.paidAmount + status — so a supplier bill can be partly or
//    fully settled, mirroring SalesInvoice.
//  • SupplierPayment + SupplierPaymentAllocation — the payable twin of
//    Payment / PaymentAllocation. Keyed by supplierName (the Purchase Register
//    stores supplier as a name string, with no Supplier FK), so payments match
//    bills by normalized name, the same way the import already groups them.
// Idempotent — safe to re-run on every deploy.
//
// Run with:  npm --workspace server run migrate:bills-payable
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
  // ── PurchaseInvoice.paidAmount + status ──
  if (!(await columnExists('PurchaseInvoice', 'paidAmount'))) {
    await pool.query('ALTER TABLE `PurchaseInvoice` ADD COLUMN `paidAmount` DOUBLE NOT NULL DEFAULT 0');
    console.log('[migrate] added PurchaseInvoice.paidAmount');
  } else {
    console.log('[migrate] PurchaseInvoice.paidAmount already exists — skipping');
  }
  if (!(await columnExists('PurchaseInvoice', 'status'))) {
    await pool.query("ALTER TABLE `PurchaseInvoice` ADD COLUMN `status` ENUM('UNPAID','PARTIAL','PAID') NOT NULL DEFAULT 'UNPAID'");
    await pool.query('ALTER TABLE `PurchaseInvoice` ADD INDEX `PurchaseInvoice_companyId_status_idx` (`companyId`, `status`)');
    console.log('[migrate] added PurchaseInvoice.status (+ index)');
  } else {
    console.log('[migrate] PurchaseInvoice.status already exists — skipping');
  }

  // ── SupplierPayment ──
  await pool.query(
    `CREATE TABLE IF NOT EXISTS \`SupplierPayment\` (
      \`id\` VARCHAR(191) NOT NULL,
      \`companyId\` VARCHAR(191) NOT NULL,
      \`supplierName\` VARCHAR(200) NOT NULL,
      \`amount\` DOUBLE NOT NULL,
      \`allocatedAmount\` DOUBLE NOT NULL DEFAULT 0,
      \`paymentDate\` DATETIME(3) NOT NULL,
      \`method\` VARCHAR(40) NULL,
      \`reference\` VARCHAR(120) NULL,
      \`notes\` VARCHAR(400) NULL,
      \`createdById\` VARCHAR(191) NULL,
      \`createdAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      \`updatedAt\` DATETIME(3) NOT NULL,
      INDEX \`SupplierPayment_companyId_paymentDate_idx\`(\`companyId\`, \`paymentDate\`),
      PRIMARY KEY (\`id\`)
    ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
  );
  console.log('[migrate] SupplierPayment table ready.');

  // ── SupplierPaymentAllocation ──
  await pool.query(
    `CREATE TABLE IF NOT EXISTS \`SupplierPaymentAllocation\` (
      \`id\` VARCHAR(191) NOT NULL,
      \`companyId\` VARCHAR(191) NOT NULL,
      \`supplierPaymentId\` VARCHAR(191) NOT NULL,
      \`purchaseInvoiceId\` VARCHAR(191) NOT NULL,
      \`amount\` DOUBLE NOT NULL,
      \`createdAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      INDEX \`SupplierPaymentAllocation_supplierPaymentId_idx\`(\`supplierPaymentId\`),
      INDEX \`SupplierPaymentAllocation_purchaseInvoiceId_idx\`(\`purchaseInvoiceId\`),
      PRIMARY KEY (\`id\`)
    ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
  );
  console.log('[migrate] SupplierPaymentAllocation table ready.');
  console.log('[migrate] done.');
};

main()
  .catch((err) => { console.error('[migrate] failed:', err); process.exitCode = 1; })
  .finally(() => pool.end());
