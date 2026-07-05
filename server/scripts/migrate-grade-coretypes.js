// Grade applicability by core type + Nano finish-output offsets on MaterialGrade.
// Idempotent.
//
// Run with:  npm --workspace server run migrate:grade-coretypes
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
  // Which core types a grade applies to (CSV: TOROIDAL,RECTANGULAR,NANO).
  if (!(await columnExists('MaterialGrade', 'coreTypes'))) {
    await pool.query("ALTER TABLE `MaterialGrade` ADD COLUMN `coreTypes` VARCHAR(60) NULL");
    console.log('[migrate] added MaterialGrade.coreTypes');
  }
  // Nano finish offsets — added to ID / OD / HT to get the finished size.
  for (const c of ['nanoIdOff', 'nanoOdOff', 'nanoHtOff']) {
    if (!(await columnExists('MaterialGrade', c))) {
      await pool.query(`ALTER TABLE \`MaterialGrade\` ADD COLUMN \`${c}\` DOUBLE NULL`);
      console.log(`[migrate] added MaterialGrade.${c}`);
    }
  }
  // Existing grades keep applying to all core types (backward compatible).
  const [r] = await pool.query(
    "UPDATE `MaterialGrade` SET `coreTypes` = 'TOROIDAL,RECTANGULAR,NANO' WHERE `coreTypes` IS NULL OR `coreTypes` = ''"
  );
  if (r.affectedRows) console.log(`[migrate] defaulted coreTypes on ${r.affectedRows} grade rows`);
  console.log('[migrate] MaterialGrade core-type columns ready.');
};

main()
  .catch((err) => { console.error('[migrate] failed:', err); process.exitCode = 1; })
  .finally(() => pool.end());
