// Journal Vouchers — manual single-legged ledger adjustments entered from the
// Receipts & Payments page. Each voucher posts a Debit or Credit against one
// account; it flows into the account ledger and the Amount Receivable / Payable
// aging (Debit = party owes us more, Credit = we owe the party more), but NOT
// into the Cashbook Summary (a journal is not a cash movement). Idempotent.
//
// Run with:  npm --workspace server run migrate:journal-voucher
import 'dotenv/config';
import { pool } from '../lib/db.js';

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
  console.log('[migrate] JournalVoucher table ready.');
};

main()
  .catch((err) => { console.error('[migrate] failed:', err); process.exitCode = 1; })
  .finally(() => pool.end());
