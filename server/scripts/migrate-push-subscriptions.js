// Web Push subscriptions — one row per browser/device that opted in. Used by
// lib/push.js to deliver notifications (login alerts, reminders, tests) even
// when the app is closed. Idempotent: CREATE IF NOT EXISTS leaves an existing
// table (e.g. from database.sql) untouched.
//
// The endpoint is an ASCII URL and needs a UNIQUE index (upsert key). utf8mb4
// VARCHAR(500) would blow past MySQL's 767-byte index limit, so the column is
// declared CHARACTER SET ascii — push endpoints are always ASCII.
//
// Run with:  npm --workspace server run migrate:push-subscriptions
import 'dotenv/config';
import { pool } from '../lib/db.js';

const main = async () => {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS \`PushSubscription\` (
      \`id\` VARCHAR(191) NOT NULL,
      \`endpoint\` VARCHAR(500) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      \`p256dh\` VARCHAR(200) NOT NULL,
      \`auth\` VARCHAR(60) NOT NULL,
      \`userAgent\` VARCHAR(300) NULL,
      \`createdAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      \`userId\` VARCHAR(191) NOT NULL,
      \`companyId\` VARCHAR(191) NOT NULL,
      UNIQUE INDEX \`PushSubscription_endpoint_key\`(\`endpoint\`),
      INDEX \`PushSubscription_companyId_idx\`(\`companyId\`),
      INDEX \`PushSubscription_userId_idx\`(\`userId\`),
      PRIMARY KEY (\`id\`)
    ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
  );
  console.log('[migrate] PushSubscription table ready.');
};

main()
  .catch((err) => { console.error('[migrate] failed:', err); process.exitCode = 1; })
  .finally(() => pool.end());
