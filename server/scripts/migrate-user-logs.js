// User Logs / session security migration. Each RefreshToken row is a login
// session; we enrich it with where/what/when so admins can audit active logins
// and so a password reset can revoke them all.
// Idempotent — safe to re-run on every deploy.
//
// Run with:  npm --workspace server run migrate:user-logs
import 'dotenv/config';
import { pool, qOne } from '../lib/db.js';

const columnExists = async (table, col) => {
  const row = await qOne(
    `SELECT COUNT(*) AS n FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, col]
  );
  return Number(row?.n ?? 0) > 0;
};

const addCol = async (col, ddl) => {
  if (await columnExists('RefreshToken', col)) { console.log(`[migrate] RefreshToken.${col} exists — skipping`); return; }
  await pool.query(`ALTER TABLE \`RefreshToken\` ADD COLUMN ${ddl}`);
  console.log(`[migrate] added RefreshToken.${col}`);
};

const main = async () => {
  // Ensure the table exists (it predates the repo migrations on live DBs).
  await pool.query(
    `CREATE TABLE IF NOT EXISTS \`RefreshToken\` (
      \`jti\` VARCHAR(191) NOT NULL,
      \`userId\` VARCHAR(191) NOT NULL,
      \`expiresAt\` DATETIME(3) NOT NULL,
      \`revokedAt\` DATETIME(3) NULL,
      \`createdAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      INDEX \`RefreshToken_userId_idx\`(\`userId\`),
      PRIMARY KEY (\`jti\`)
    ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
  );

  await addCol('ip',         '`ip` VARCHAR(64) NULL');
  await addCol('userAgent',  '`userAgent` VARCHAR(400) NULL');
  await addCol('device',     '`device` VARCHAR(160) NULL');
  await addCol('location',   '`location` VARCHAR(160) NULL');
  await addCol('loginAt',    '`loginAt` DATETIME(3) NULL');
  await addCol('lastUsedAt', '`lastUsedAt` DATETIME(3) NULL');

  console.log('[migrate] done.');
};

main()
  .catch((err) => { console.error('[migrate] failed:', err); process.exitCode = 1; })
  .finally(() => pool.end());
