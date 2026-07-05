// Audit log — who did what, when, with a JSON snapshot for restore/revert.
// Idempotent — safe to re-run.
//
// Run with:  npm --workspace server run migrate:audit-log
import 'dotenv/config';
import { pool } from '../lib/db.js';

const main = async () => {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS \`AuditLog\` (
      \`id\` VARCHAR(191) NOT NULL,
      \`companyId\` VARCHAR(191) NOT NULL,
      \`userId\` VARCHAR(191) NULL,
      \`userName\` VARCHAR(200) NULL,
      \`entity\` VARCHAR(60) NOT NULL,
      \`entityId\` VARCHAR(191) NULL,
      \`action\` ENUM('CREATE','UPDATE','DELETE') NOT NULL,
      \`summary\` VARCHAR(300) NULL,
      \`beforeJson\` LONGTEXT NULL,
      \`afterJson\` LONGTEXT NULL,
      \`restorable\` TINYINT(1) NOT NULL DEFAULT 0,
      \`restoredAt\` DATETIME(3) NULL,
      \`restoredById\` VARCHAR(191) NULL,
      \`createdAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      INDEX \`AuditLog_companyId_createdAt_idx\`(\`companyId\`, \`createdAt\`),
      INDEX \`AuditLog_companyId_entity_idx\`(\`companyId\`, \`entity\`),
      PRIMARY KEY (\`id\`)
    ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
  );
  console.log('[migrate] AuditLog table ready.');
};

main()
  .catch((err) => { console.error('[migrate] failed:', err); process.exitCode = 1; })
  .finally(() => pool.end());
