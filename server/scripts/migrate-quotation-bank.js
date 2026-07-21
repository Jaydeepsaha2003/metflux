// Per-quotation bank details (JSON). Terms already live on Quotation.terms;
// this adds a bankDetails column so each quotation can carry its own bank +
// terms, pre-filled from the company defaults but editable per quote. Idempotent.
//
// Run with:  npm --workspace server run migrate:quotation-bank
import 'dotenv/config';
import { pool } from '../lib/db.js';

const columnExists = async (table, column) => {
  const [rows] = await pool.query(
    `SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column]
  );
  return rows.length > 0;
};

const main = async () => {
  if (await columnExists('Quotation', 'bankDetails')) {
    console.log('[migrate] Quotation.bankDetails already present.');
    return;
  }
  await pool.query('ALTER TABLE `Quotation` ADD COLUMN `bankDetails` TEXT NULL AFTER `terms`');
  console.log('[migrate] Quotation.bankDetails added.');
};

main()
  .catch((err) => { console.error('[migrate] failed:', err); process.exitCode = 1; })
  .finally(() => pool.end());
