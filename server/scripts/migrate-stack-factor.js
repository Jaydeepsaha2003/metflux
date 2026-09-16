// Customer-wise stacking factor for the weight calculation.
//
// The weight of a wound core is geometry x steel density x how much of that
// volume is actually steel rather than the air between laminations. That last
// part is the stacking factor, and it is a property of the customer's agreed
// specification rather than a universal constant — so it belongs beside the
// customer, not hard-coded in the formula.
//
// Two columns because the two shapes express it differently, exactly as the
// legacy .NET form did:
// Table names are spelled exactly as the schema has them (PoOrderItem, not
// POOrderItem): Windows MySQL folds case, the Linux server does not, so a
// mis-cased ALTER passes here and fails in production.
//
//   Customer.toroidalFactor   default 5.77  — the whole multiplier in
//                                             (OD^2 - ID^2) x HT x F x 1e-6,
//                                             i.e. pi/4 x 7.65 x ~0.9604
//   Customer.rectStackFactor  default 0.95  — the bare stacking fraction in
//                                             coreAc = ((OD2-ID2)/2) x HT x S/100
//
// NULL means "use the house default", so every existing customer keeps today's
// numbers and nothing moves until someone deliberately sets a value.
//
// The factor is ALSO stored on each order/quotation line. Without that, editing
// a two-year-old order after the customer's factor changed would silently
// re-weigh it against the new figure. The line remembers what it was booked
// with; the customer record only seeds new lines.
//
// Run with:  npm --workspace server run migrate:stack-factor
import 'dotenv/config';
import { pool } from '../lib/db.js';

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

const addColumn = async (table, column, ddl) => {
  if (!(await tableExists(table))) {
    console.log(`[migrate] ${table} not present — skipping ${column}`);
    return;
  }
  if (await hasColumn(table, column)) {
    console.log(`[migrate] ${table}.${column} already present — skipping`);
    return;
  }
  await pool.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${ddl}`);
  console.log(`[migrate] added ${table}.${column}`);
};

const main = async () => {
  await addColumn('Customer', 'toroidalFactor',  'DOUBLE NULL');
  await addColumn('Customer', 'rectStackFactor', 'DOUBLE NULL');
  await addColumn('PoOrderItem',  'stackFactor', 'DOUBLE NULL');
  await addColumn('QuotationItem', 'stackFactor', 'DOUBLE NULL');
  console.log('[migrate] Stacking factor ready.');
};

main()
  .catch((err) => { console.error('[migrate] failed:', err); process.exitCode = 1; })
  .finally(() => pool.end());
