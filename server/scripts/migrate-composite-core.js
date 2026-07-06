// Composite core support: add COMPOSITE to the coreType enums (PoOrderItem +
// FluxGrade). A composite item is Nano + CRGO combined; the final measure is
// derived from the grade (join type). Idempotent.
//
// Run with:  npm --workspace server run migrate:composite-core
import 'dotenv/config';
import { pool } from '../lib/db.js';

const enumType = async (table, column) => {
  const [rows] = await pool.query(
    `SELECT COLUMN_TYPE AS t FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1`,
    [table, column]
  );
  return rows?.[0]?.t ?? '';
};

const main = async () => {
  // PoOrderItem.coreType — add COMPOSITE (keep NANO which a prior migration added).
  const poType = await enumType('PoOrderItem', 'coreType');
  if (poType && !/COMPOSITE/i.test(poType)) {
    await pool.query("ALTER TABLE `PoOrderItem` MODIFY COLUMN `coreType` ENUM('TOROIDAL','RECTANGULAR','NANO','COMPOSITE') NOT NULL");
    console.log('[migrate] PoOrderItem.coreType now allows COMPOSITE');
  } else {
    console.log('[migrate] PoOrderItem.coreType already allows COMPOSITE (or table absent) — skipping');
  }

  // FluxGrade.coreType — extend too so composite flux grades can be stored later.
  const fgType = await enumType('FluxGrade', 'coreType');
  if (fgType && !/COMPOSITE/i.test(fgType)) {
    await pool.query("ALTER TABLE `FluxGrade` MODIFY COLUMN `coreType` ENUM('TOROIDAL','RECTANGULAR','NANO','COMPOSITE') NOT NULL DEFAULT 'TOROIDAL'");
    console.log('[migrate] FluxGrade.coreType now allows COMPOSITE');
  } else {
    console.log('[migrate] FluxGrade.coreType already allows COMPOSITE (or table absent) — skipping');
  }

  console.log('[migrate] Composite core ready.');
};

main()
  .catch((err) => { console.error('[migrate] failed:', err); process.exitCode = 1; })
  .finally(() => pool.end());
