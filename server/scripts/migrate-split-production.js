// Split-width production: a wide core is sometimes made as two (or more)
// narrower strips that are joined into one finished piece before dispatch —
// e.g. a 100x105x65 item produced as a 40mm run + a 25mm run. Adds the one
// column this needs. Idempotent.
//
// Run with:  npm --workspace server run migrate:split-production
import 'dotenv/config';
import { pool } from '../lib/db.js';

const columnExists = async (table, column) => {
  const [rows] = await pool.query(
    `SELECT 1 FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1`,
    [table, column]
  );
  return rows.length > 0;
};

const main = async () => {
  // NULL = an ordinary, whole-piece production entry (today's behaviour,
  // completely unaffected). Non-NULL = this entry is one physical run of a
  // split — its own height, not the item's full ordered height. See
  // lib/splitProduction.js for how these are matched into finished pieces.
  if (!(await columnExists('Production', 'splitHeight'))) {
    await pool.query('ALTER TABLE `Production` ADD COLUMN `splitHeight` DOUBLE NULL');
    console.log('[migrate] added Production.splitHeight');
  } else {
    console.log('[migrate] Production.splitHeight already present — skipping');
  }
  console.log('[migrate] Split-production column ready.');
};

main()
  .catch((err) => { console.error('[migrate] failed:', err); process.exitCode = 1; })
  .finally(() => pool.end());
