// Per-quotation currency. Every existing quotation was written in rupees, so the
// default is INR and nothing already stored changes meaning.
//
// exchangeRate is rupees per one unit of the quotation's currency. It is not
// used to print anything; it exists so a foreign-currency quotation can be
// converted into a Sales Order, which is kept in rupees, without the dollar
// figures landing in the ledger as if they were rupee figures.
//
// Run with:  npm --workspace server run migrate:quotation-currency
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
  if (!(await columnExists('Quotation', 'currency'))) {
    await pool.query("ALTER TABLE `Quotation` ADD COLUMN `currency` VARCHAR(3) NOT NULL DEFAULT 'INR'");
    console.log('[migrate] Quotation.currency added.');
  } else console.log('[migrate] Quotation.currency already present.');
  if (!(await columnExists('Quotation', 'exchangeRate'))) {
    await pool.query('ALTER TABLE `Quotation` ADD COLUMN `exchangeRate` DECIMAL(14,6) NULL');
    console.log('[migrate] Quotation.exchangeRate added.');
  } else console.log('[migrate] Quotation.exchangeRate already present.');
};

main()
  .catch((err) => { console.error('[migrate] failed:', err); process.exitCode = 1; })
  .finally(() => pool.end());
