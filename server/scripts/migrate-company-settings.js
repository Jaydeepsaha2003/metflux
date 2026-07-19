// Per-company key/value settings (distinct from the global AppSetting table).
// First use: quotation Terms & Conditions + bank details, configured once per
// company and reused on every quotation. Idempotent.
//
// Run with:  npm --workspace server run migrate:company-settings
import 'dotenv/config';
import { pool } from '../lib/db.js';

const main = async () => {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS \`CompanySetting\` (
      \`id\` VARCHAR(191) NOT NULL,
      \`companyId\` VARCHAR(191) NOT NULL,
      \`settingKey\` VARCHAR(80) NOT NULL,
      \`settingValue\` MEDIUMTEXT NULL,
      \`createdAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      \`updatedAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      UNIQUE INDEX \`CompanySetting_company_key\`(\`companyId\`, \`settingKey\`),
      PRIMARY KEY (\`id\`)
    ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
  );
  console.log('[migrate] CompanySetting table ready.');
};

main()
  .catch((err) => { console.error('[migrate] failed:', err); process.exitCode = 1; })
  .finally(() => pool.end());
