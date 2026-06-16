// Adds the GST-breakdown columns to SalesInvoice so the Sales Register import
// can keep IGST/CGST/SGST (and the taxable / sale / other amounts) separately,
// while `amount` stays the GST-inclusive invoice due. Idempotent.
//
// Run with:
//   npm --workspace server run migrate:sales-invoice-gst
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

const COLUMNS = [
  ['taxType',       '`taxType` VARCHAR(40) NULL'],
  ['saleAmount',    '`saleAmount` DOUBLE NOT NULL DEFAULT 0'],
  ['taxableAmount', '`taxableAmount` DOUBLE NOT NULL DEFAULT 0'],
  ['igst',          '`igst` DOUBLE NOT NULL DEFAULT 0'],
  ['cgst',          '`cgst` DOUBLE NOT NULL DEFAULT 0'],
  ['sgst',          '`sgst` DOUBLE NOT NULL DEFAULT 0'],
  ['otherAmount',   '`otherAmount` DOUBLE NOT NULL DEFAULT 0'],
];

const main = async () => {
  for (const [col, ddl] of COLUMNS) {
    if (await columnExists('SalesInvoice', col)) {
      console.log(`[migrate] SalesInvoice.${col} already exists — skipping`);
      continue;
    }
    await pool.query(`ALTER TABLE \`SalesInvoice\` ADD COLUMN ${ddl}`);
    console.log(`[migrate] added SalesInvoice.${col}`);
  }
  console.log('[migrate] done.');
};

main()
  .catch((err) => { console.error('[migrate] failed:', err); process.exitCode = 1; })
  .finally(() => pool.end());
