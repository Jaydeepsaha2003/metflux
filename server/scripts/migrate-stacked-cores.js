// EI core, wound core and step core.
//
// Three shapes the coreType enum did not have. The first two are stacked or
// wound cores the works already makes and had nowhere to book; the third is a
// limb section rather than a whole core, quoted by its step table.
//
// Widening an ENUM is additive — MySQL leaves every existing row alone — so
// this is safe to run against live data and safe to run twice.
//
// Run with:  npm --workspace server run migrate:stacked-cores
import 'dotenv/config';
import { pool } from '../lib/db.js';

/** Tables whose coreType is a real ENUM and therefore needs widening. */
const ENUM_TABLES = ['PoOrderItem', 'QuotationItem', 'FluxGrade'];

/** The full set after this migration, in the order the UI presents them. */
const CORE_TYPES = [
  'TOROIDAL', 'RECTANGULAR', 'NANO', 'COMPOSITE', 'CUT_ROUND', 'CUT_RECT',
  'EI_CORE', 'WOUND_CORE', 'STEP_CORE',
];

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
    if (CORE_TYPES.every((v) => current.includes(v))) {
      console.log(`[migrate] ${table}.coreType already has every core type — skipping`);
      continue;
    }
    // Preserve the column's own nullability; FluxGrade and the item tables do
    // not agree on it, and forcing NOT NULL would reject existing rows.
    const nullable = await isNullable(table, 'coreType');
    await pool.query(
      `ALTER TABLE \`${table}\` MODIFY COLUMN \`coreType\` ENUM(${list}) ${nullable ? 'NULL' : 'NOT NULL'}`
    );
    console.log(`[migrate] ${table}.coreType widened`);
  }

  /* A step core's section is a list of (plate width x stack), which has no
     natural home among id1/od1/ht. Stored as JSON text rather than as a set of
     numbered columns, because the number of steps is part of the
     specification — a 5-step limb and a 9-step limb are both ordinary. TEXT
     rather than the JSON type: the live server is not the same MySQL as the
     development one, and TEXT is understood by every version of both. */
  for (const table of ['PoOrderItem', 'QuotationItem']) {
    const [has] = await pool.query(
      `SELECT 1 FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = 'steps' LIMIT 1`,
      [table]
    );
    if (has.length) {
      console.log(`[migrate] ${table}.steps already present — skipping`);
      continue;
    }
    await pool.query(`ALTER TABLE \`${table}\` ADD COLUMN \`steps\` TEXT NULL AFTER \`ht\``);
    console.log(`[migrate] ${table}.steps added`);
  }

  // As with the cut cores: which grades suit a stacked lamination is a decision
  // for Settings → Materials, not one for a migration to make on your behalf.
  console.log('[migrate] Stacked cores ready.');
};

main()
  .catch((err) => { console.error('[migrate] failed:', err); process.exitCode = 1; })
  .finally(() => pool.end());
