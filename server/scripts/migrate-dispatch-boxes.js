// Add `boxes` (No. of Boxes) to Dispatch — how many physical boxes the shipment
// was packed in. Shown on the dispatch form and as a BOX column on the packing
// list. Idempotent.
//
// Run with:  npm --workspace server run migrate:dispatch-boxes
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
  if (await columnExists('Dispatch', 'boxes')) {
    console.log('[migrate] Dispatch.boxes already present.');
    return;
  }
  await pool.query('ALTER TABLE `Dispatch` ADD COLUMN `boxes` INTEGER NULL AFTER `totalWeight`');
  console.log('[migrate] Dispatch.boxes added.');
};

main()
  .catch((err) => { console.error('[migrate] failed:', err); process.exitCode = 1; })
  .finally(() => pool.end());
