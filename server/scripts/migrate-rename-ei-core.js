// Make sure both E core and EI core exist as stored types.
//
// This started life as a rename — E_CORE was to become EI_CORE — and it does
// not do that any more, for three reasons found when the deploy chain stopped
// on it:
//
//   1. It crashed. The transitional widen appended 'E_CORE' to a list that
//      already contained it, and MySQL refuses a duplicated value in an ENUM.
//      Every deploy died here, because `npm run build` runs the chain.
//
//   2. It ran BEFORE migrate:stacked-cores, which is what adds EI_CORE to the
//      enum in the first place — so the UPDATE was writing a value the column
//      could not hold yet.
//
//   3. The application no longer agrees with it. E core and EI core are now two
//      products, not one under two names: the entry form offers both, and the
//      E core carries its own description, "E-shaped lamination without the
//      closing I bar". Rewriting stored E_CORE rows to EI_CORE would silently
//      change what an existing order says it is, with nothing recording which
//      rows had been changed.
//
// So this now does the one thing that is both useful and safe: it guarantees
// the enum holds every core type, including both E_CORE and EI_CORE, whatever
// order the chain runs in. Additive, idempotent, and it touches no row.
//
// IF E AND EI REALLY ARE ONE PRODUCT, the rename is two statements — an UPDATE
// setting E_CORE rows to EI_CORE and a final ALTER dropping E_CORE from the
// list — but the entry form has to stop offering E core in the same change, or
// the UI will keep sending a value the column rejects.
//
// Run with:  npm --workspace server run migrate:rename-ei-core
import 'dotenv/config';
import { pool } from '../lib/db.js';

const TABLES = ['PoOrderItem', 'QuotationItem', 'FluxGrade'];

const CORE_TYPES = [
  'TOROIDAL', 'RECTANGULAR', 'NANO', 'COMPOSITE', 'CUT_ROUND', 'CUT_RECT',
  'E_CORE', 'EI_CORE', 'WOUND_CORE', 'STEP_CORE',
];

const column = async (table, name) => {
  const [rows] = await pool.query(
    `SELECT COLUMN_TYPE AS t, IS_NULLABLE AS n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1`,
    [table, name],
  );
  return rows[0] ?? null;
};

const main = async () => {
  const list = CORE_TYPES.map((v) => `'${v}'`).join(',');

  for (const table of TABLES) {
    const col = await column(table, 'coreType');
    if (!col) {
      console.log(`[migrate] ${table}.coreType not present — skipping`);
      continue;
    }
    if (CORE_TYPES.every((v) => col.t.includes(`'${v}'`))) {
      console.log(`[migrate] ${table}.coreType already has E_CORE and EI_CORE — skipping`);
      continue;
    }
    // Preserve the column's own nullability; FluxGrade and the item tables do
    // not agree on it, and forcing NOT NULL would reject existing rows.
    await pool.query(
      `ALTER TABLE \`${table}\` MODIFY COLUMN \`coreType\` ENUM(${list}) ${col.n === 'YES' ? 'NULL' : 'NOT NULL'}`,
    );
    console.log(`[migrate] ${table}.coreType widened to hold both E_CORE and EI_CORE`);
  }

  console.log('[migrate] E core and EI core both available. No rows changed.');
};

main()
  .catch((err) => { console.error('[migrate] failed:', err); process.exitCode = 1; })
  .finally(() => pool.end());
