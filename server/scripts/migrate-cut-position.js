// Where the line of cut falls on a cut core.
//
// A rectangular cut core does not have to be halved down the middle. Cut
// nearer one yoke and you get a deep C and a shallow one, which is a different
// part to make, to stack and to assemble — so it belongs on the order line
// rather than in a note somebody has to remember.
//
// NULL means centre, the way it has always been done. Deliberately not
// defaulted in the column: a line booked before today was never asked, and
// writing CENTRE into it would claim it was.
//
// Idempotent and additive only.
//
// Run with:  npm --workspace server run migrate:cut-position
import 'dotenv/config';
import { pool } from '../lib/db.js';

const TABLES = ['PoOrderItem', 'QuotationItem'];
const POSITIONS = ['TOP', 'CENTRE', 'BOTTOM'];

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
  const list = POSITIONS.map((v) => `'${v}'`).join(',');

  for (const table of TABLES) {
    if (!(await tableExists(table))) {
      console.log(`[migrate] ${table} not present — skipping`);
      continue;
    }
    const current = await columnType(table, 'cutAt');
    if (current && POSITIONS.every((v) => current.includes(v))) {
      console.log(`[migrate] ${table}.cutAt already present — skipping`);
      continue;
    }
    if (current) {
      await pool.query(`ALTER TABLE \`${table}\` MODIFY COLUMN \`cutAt\` ENUM(${list}) NULL`);
      console.log(`[migrate] ${table}.cutAt widened`);
    } else {
      await pool.query(
        `ALTER TABLE \`${table}\` ADD COLUMN \`cutAt\` ENUM(${list}) NULL AFTER \`gapMm\``
      );
      console.log(`[migrate] ${table}.cutAt added`);
    }
  }
  console.log('[migrate] Cut position ready.');
};

main()
  .catch((err) => { console.error('[migrate] failed:', err); process.exitCode = 1; })
  .finally(() => pool.end());
