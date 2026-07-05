// Nano core support for Sales Order items: extend the coreType enum and add the
// nano-specific pricing columns. Idempotent.
//
// Run with:  npm --workspace server run migrate:nano-core
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
  // Column type check — add NANO to the enum only if missing.
  const [[col]] = [await pool.query(
    `SELECT COLUMN_TYPE AS t FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'PoOrderItem' AND COLUMN_NAME = 'coreType' LIMIT 1`
  )];
  const type = col?.[0]?.t ?? '';
  if (type && !/NANO/i.test(type)) {
    await pool.query("ALTER TABLE `PoOrderItem` MODIFY COLUMN `coreType` ENUM('TOROIDAL','RECTANGULAR','NANO') NOT NULL");
    console.log('[migrate] PoOrderItem.coreType now allows NANO');
  } else {
    console.log('[migrate] PoOrderItem.coreType already allows NANO (or table absent) — skipping');
  }

  for (const c of ['nanoPrice', 'casePrice', 'caseWeight', 'nanoSoRate']) {
    if (!(await columnExists('PoOrderItem', c))) {
      await pool.query(`ALTER TABLE \`PoOrderItem\` ADD COLUMN \`${c}\` DOUBLE NULL`);
      console.log(`[migrate] added PoOrderItem.${c}`);
    }
  }
  console.log('[migrate] Nano core columns ready.');
};

main()
  .catch((err) => { console.error('[migrate] failed:', err); process.exitCode = 1; })
  .finally(() => pool.end());
