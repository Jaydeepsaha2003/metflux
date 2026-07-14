// Journal Vouchers — manual single-legged ledger adjustments entered from the
// Receipts & Payments page. Each voucher posts a Debit or Credit against one
// account; it flows into the account ledger and the Amount Receivable / Payable
// aging (Debit = party owes us more, Credit = we owe the party more), but NOT
// into the Cashbook Summary (a journal is not a cash movement). Idempotent.
//
// Run with:  npm --workspace server run migrate:journal-voucher
import 'dotenv/config';
import { pool } from '../lib/db.js';

const columnExists = async (table, col) => {
  const [rows] = await pool.query(
    `SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1`, [table, col]);
  return rows.length > 0;
};
const indexExists = async (table, idx) => {
  const [rows] = await pool.query(
    `SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ? LIMIT 1`, [table, idx]);
  return rows.length > 0;
};

const main = async () => {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS \`JournalVoucher\` (
      \`id\` VARCHAR(191) NOT NULL,
      \`companyId\` VARCHAR(191) NOT NULL,
      \`voucherNo\` VARCHAR(40) NOT NULL,
      \`entryDate\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      \`account\` VARCHAR(200) NOT NULL,
      \`normKey\` VARCHAR(200) NOT NULL,
      \`side\` ENUM('DEBIT','CREDIT') NOT NULL,
      \`amount\` DOUBLE NOT NULL DEFAULT 0,
      \`narration\` VARCHAR(400) NULL,
      \`createdById\` VARCHAR(191) NULL,
      \`createdAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      INDEX \`JournalVoucher_company_date_idx\`(\`companyId\`, \`entryDate\`),
      INDEX \`JournalVoucher_company_norm_idx\`(\`companyId\`, \`normKey\`),
      UNIQUE INDEX \`JournalVoucher_company_vno\`(\`companyId\`, \`voucherNo\`),
      PRIMARY KEY (\`id\`)
    ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
  );

  // ── Multi-line JOURNAL support (uploaded Journal Register) ──
  // The single-legged Suspense Entry keeps source='SUSPENSE'; an imported
  // journal voucher is many balanced lines that share a batchId (source=
  // 'JOURNAL'). Both feed the ledger + aging by account name.
  const addCol = async (col, ddl) => { if (!(await columnExists('JournalVoucher', col))) { await pool.query(`ALTER TABLE \`JournalVoucher\` ADD COLUMN ${ddl}`); console.log('[migrate] added JournalVoucher.' + col); } };
  await addCol('source',  "`source` VARCHAR(16) NOT NULL DEFAULT 'SUSPENSE'");
  await addCol('batchId', '`batchId` VARCHAR(191) NULL');
  await addCol('refNo',   '`refNo` VARCHAR(80) NULL');
  await addCol('seq',     '`seq` INTEGER NOT NULL DEFAULT 0');
  await addCol('taxable', '`taxable` DOUBLE NULL');
  await addCol('igst',    '`igst` DOUBLE NULL');
  await addCol('cgst',    '`cgst` DOUBLE NULL');
  await addCol('sgst',    '`sgst` DOUBLE NULL');
  if (!(await indexExists('JournalVoucher', 'JournalVoucher_company_batch_idx'))) {
    await pool.query('ALTER TABLE `JournalVoucher` ADD INDEX `JournalVoucher_company_batch_idx` (`companyId`, `batchId`)');
    console.log('[migrate] added JournalVoucher batch index');
  }
  // Multi-line vouchers share a voucher number, and imported refs repeat — so the
  // per-company UNIQUE(voucherNo) can't hold. Replace it with a plain index.
  if (await indexExists('JournalVoucher', 'JournalVoucher_company_vno')) {
    await pool.query('ALTER TABLE `JournalVoucher` DROP INDEX `JournalVoucher_company_vno`');
    await pool.query('ALTER TABLE `JournalVoucher` ADD INDEX `JournalVoucher_company_vno` (`companyId`, `voucherNo`)');
    console.log('[migrate] relaxed JournalVoucher voucherNo unique → index');
  }
  console.log('[migrate] JournalVoucher table ready.');
};

main()
  .catch((err) => { console.error('[migrate] failed:', err); process.exitCode = 1; })
  .finally(() => pool.end());
