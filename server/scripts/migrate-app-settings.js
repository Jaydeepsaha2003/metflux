// App-wide key/value settings (e.g. the global webapp logo). Idempotent.
//
// Run with:  npm --workspace server run migrate:app-settings
import 'dotenv/config';
import { pool } from '../lib/db.js';

const main = async () => {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS \`AppSetting\` (
      \`settingKey\` VARCHAR(80) NOT NULL,
      \`settingValue\` MEDIUMTEXT NULL,
      \`updatedAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`settingKey\`)
    ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
  );
  console.log('[migrate] AppSetting table ready.');
};

main()
  .catch((err) => { console.error('[migrate] failed:', err); process.exitCode = 1; })
  .finally(() => pool.end());
