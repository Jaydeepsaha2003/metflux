// In-app notifications — a persisted copy of every alert (login, reminders,
// tests, …) so the bell panel has history and unread state, independent of
// whether the web-push was delivered. One row per recipient user. Idempotent.
//
// Run with:  npm --workspace server run migrate:notifications
import 'dotenv/config';
import { pool } from '../lib/db.js';

const main = async () => {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS \`Notification\` (
      \`id\` VARCHAR(191) NOT NULL,
      \`companyId\` VARCHAR(191) NOT NULL,
      \`userId\` VARCHAR(191) NOT NULL,
      \`type\` VARCHAR(40) NOT NULL DEFAULT 'SYSTEM',
      \`title\` VARCHAR(200) NOT NULL,
      \`body\` VARCHAR(500) NULL,
      \`url\` VARCHAR(300) NULL,
      \`tag\` VARCHAR(60) NULL,
      \`isRead\` TINYINT(1) NOT NULL DEFAULT 0,
      \`readAt\` DATETIME(3) NULL,
      \`createdAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      INDEX \`Notification_user_idx\`(\`companyId\`, \`userId\`, \`isRead\`, \`createdAt\`),
      PRIMARY KEY (\`id\`)
    ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
  );
  console.log('[migrate] Notification table ready.');
};

main()
  .catch((err) => { console.error('[migrate] failed:', err); process.exitCode = 1; })
  .finally(() => pool.end());
