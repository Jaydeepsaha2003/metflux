// Gap cores: store the air gap.
//
// The gap was wired through the whole client — it sets the magnetising current,
// names the product, opens the joint in the 3D view and is dimensioned on the
// spec sheet — but it had nowhere to live. Zod strips unknown keys, so every
// order saved its gap into a bit bucket: reopen the line and it came back a
// plain cut core with an Ie two orders of magnitude lower than the one printed
// on the paperwork the customer already had.
//
// Nullable, because a plain cut core has no gap and NULL says that better than
// a zero does. `double` to match every other dimension on the table.
//
// Idempotent and additive only.
//
// Run with:  npm --workspace server run migrate:gap-core
import 'dotenv/config';
import { pool } from '../lib/db.js';

/** Tables that carry a core line and therefore need the gap. */
const TABLES = ['PoOrderItem', 'QuotationItem'];

const hasColumn = async (table, column) => {
  const [rows] = await pool.query(
    `SELECT 1 FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1`,
    [table, column]
  );
  return rows.length > 0;
};

const tableExists = async (table) => {
  const [rows] = await pool.query(
    `SELECT 1 FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? LIMIT 1`,
    [table]
  );
  return rows.length > 0;
};

const main = async () => {
  for (const table of TABLES) {
    if (!(await tableExists(table))) {
      console.log(`[migrate] ${table} not present — skipping`);
      continue;
    }
    if (await hasColumn(table, 'gapMm')) {
      console.log(`[migrate] ${table}.gapMm already present — skipping`);
      continue;
    }
    // Placed next to the other dimensions rather than at the end of the table,
    // so anyone reading the schema finds it where they would look for it.
    await pool.query(
      `ALTER TABLE \`${table}\` ADD COLUMN \`gapMm\` DOUBLE NULL AFTER \`builtup\``
    );
    console.log(`[migrate] ${table}.gapMm added`);
  }
  console.log('[migrate] Gap cores ready.');
};

main()
  .catch((err) => { console.error('[migrate] failed:', err); process.exitCode = 1; })
  .finally(() => pool.end());
