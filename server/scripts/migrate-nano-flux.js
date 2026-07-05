// Allow NANO flux grades (Bmax → AT/cm calibration for nano-core testing).
// Idempotent.
//
// Run with:  npm --workspace server run migrate:nano-flux
import 'dotenv/config';
import { pool } from '../lib/db.js';

const main = async () => {
  const [rows] = await pool.query(
    `SELECT COLUMN_TYPE AS t FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'FluxGrade' AND COLUMN_NAME = 'coreType' LIMIT 1`
  );
  const type = rows[0]?.t ?? '';
  if (type && !/NANO/i.test(type)) {
    await pool.query("ALTER TABLE `FluxGrade` MODIFY COLUMN `coreType` ENUM('TOROIDAL','RECTANGULAR','NANO') NOT NULL DEFAULT 'TOROIDAL'");
    console.log('[migrate] FluxGrade.coreType now allows NANO');
  } else {
    console.log('[migrate] FluxGrade.coreType already allows NANO (or table absent) — skipping');
  }
};

main()
  .catch((err) => { console.error('[migrate] failed:', err); process.exitCode = 1; })
  .finally(() => pool.end());
