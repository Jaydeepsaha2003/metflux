// Company.watermarkUrl — an optional background image for the downloaded core
// drawing sheets. Stored as a base64 data URL in the database like the logo, so
// it survives a fresh clone on the host. Idempotent.
//
// Run with:  npm --workspace server run migrate:company-watermark
import 'dotenv/config';
import { pool } from '../lib/db.js';

const main = async () => {
  const [rows] = await pool.query(
    `SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Company' AND COLUMN_NAME = 'watermarkUrl'`
  );
  if (rows.length) { console.log('[migrate] Company.watermarkUrl already present.'); return; }
  await pool.query('ALTER TABLE `Company` ADD COLUMN `watermarkUrl` MEDIUMTEXT NULL');
  console.log('[migrate] Company.watermarkUrl added.');
};

main()
  .catch((err) => { console.error('[migrate] failed:', err); process.exitCode = 1; })
  .finally(() => pool.end());
