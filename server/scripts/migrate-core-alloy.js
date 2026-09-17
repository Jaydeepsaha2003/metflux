// The alloy a core line is wound from.
//
// Until now the material family was implied by the shape: everything was CRGO
// except the NANO core type, which was nanocrystalline by definition. That
// stopped working the moment a toroid could be ordered in nanocrystalline or
// amorphous ribbon, because the density and the stacking factor — the two
// numbers behind the weight, the net area, the test voltage and the
// magnetising current — belong to the material, not to the shape.
//
// NULL means CRGO. Deliberately, rather than defaulting the column: an existing
// row was never asked the question, and writing CRGO into it would claim it was.
// Every reader treats absent as CRGO, so nothing changes for a line already
// booked.
//
// Idempotent and additive only.
//
// Run with:  npm --workspace server run migrate:core-alloy
import 'dotenv/config';
import { pool } from '../lib/db.js';

const TABLES = ['PoOrderItem', 'QuotationItem'];
const ALLOYS = ['CRGO', 'NANOCRYSTALLINE', 'AMORPHOUS'];

const tableExists = async (table) => {
  const [rows] = await pool.query(
    `SELECT 1 FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? LIMIT 1`,
    [table]
  );
  return rows.length > 0;
};

const columnType = async (table, column) => {
  const [rows] = await pool.query(
    `SELECT COLUMN_TYPE AS t FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1`,
    [table, column]
  );
  return rows[0]?.t ?? null;
};

const main = async () => {
  const list = ALLOYS.map((v) => `'${v}'`).join(',');

  for (const table of TABLES) {
    if (!(await tableExists(table))) {
      console.log(`[migrate] ${table} not present — skipping`);
      continue;
    }
    const current = await columnType(table, 'alloy');
    if (current && ALLOYS.every((v) => current.includes(v))) {
      console.log(`[migrate] ${table}.alloy already has every alloy — skipping`);
      continue;
    }
    if (current) {
      await pool.query(`ALTER TABLE \`${table}\` MODIFY COLUMN \`alloy\` ENUM(${list}) NULL`);
      console.log(`[migrate] ${table}.alloy widened`);
    } else {
      await pool.query(
        `ALTER TABLE \`${table}\` ADD COLUMN \`alloy\` ENUM(${list}) NULL AFTER \`material\``
      );
      console.log(`[migrate] ${table}.alloy added`);
    }
  }
  console.log('[migrate] Core alloys ready.');
};

main()
  .catch((err) => { console.error('[migrate] failed:', err); process.exitCode = 1; })
  .finally(() => pool.end());
