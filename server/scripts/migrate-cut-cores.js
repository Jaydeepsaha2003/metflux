// Cut cores: a wound core sliced into two C halves.
//
// Adds CUT_ROUND to the coreType enums. The round cut core is dimensioned by
// the toroid it was cut from — ID, OD, HT — so its weight and area formulas are
// the ones already in use; what makes it a different product is that it ships
// as two mating halves, and later that it can carry a controlled air gap.
//
// One piece means one COMPLETE core, both halves, as agreed: a customer orders
// fifty cores, not a hundred halves.
//
// Idempotent, and additive only — MySQL keeps existing rows untouched when an
// ENUM gains a value, so nothing already stored can be affected.
//
// Run with:  npm --workspace server run migrate:cut-cores
import 'dotenv/config';
import { pool } from '../lib/db.js';

/** Tables whose coreType is a real ENUM and therefore needs widening. */
const ENUM_TABLES = ['PoOrderItem', 'QuotationItem', 'FluxGrade'];

/** The full set after this migration, in the order the UI presents them. */
const CORE_TYPES = ['TOROIDAL', 'RECTANGULAR', 'NANO', 'COMPOSITE', 'CUT_ROUND'];

const columnType = async (table, column) => {
  const [rows] = await pool.query(
    `SELECT COLUMN_TYPE AS t FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1`,
    [table, column]
  );
  return rows[0]?.t ?? null;
};

const isNullable = async (table, column) => {
  const [rows] = await pool.query(
    `SELECT IS_NULLABLE AS n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1`,
    [table, column]
  );
  return rows[0]?.n === 'YES';
};

const main = async () => {
  const list = CORE_TYPES.map((v) => `'${v}'`).join(',');

  for (const table of ENUM_TABLES) {
    const current = await columnType(table, 'coreType');
    if (!current) {
      console.log(`[migrate] ${table}.coreType not present — skipping`);
      continue;
    }
    if (current.includes('CUT_ROUND')) {
      console.log(`[migrate] ${table}.coreType already allows CUT_ROUND — skipping`);
      continue;
    }
    // Preserve the column's own nullability; FluxGrade and the item tables do
    // not agree on it, and forcing NOT NULL would reject existing rows.
    const nullable = await isNullable(table, 'coreType');
    await pool.query(
      `ALTER TABLE \`${table}\` MODIFY COLUMN \`coreType\` ENUM(${list}) ${nullable ? 'NULL' : 'NOT NULL'}`
    );
    console.log(`[migrate] ${table}.coreType now allows CUT_ROUND`);
  }

  // MaterialGrade.coreTypes is a comma-separated VARCHAR of the types a grade
  // may be used for, so it needs no schema change — but widening it here would
  // be wrong anyway: which grades are suitable for a cut core is a decision for
  // Settings → Materials, not for a migration to assume.
  console.log('[migrate] Cut cores ready.');
};

main()
  .catch((err) => { console.error('[migrate] failed:', err); process.exitCode = 1; })
  .finally(() => pool.end());
