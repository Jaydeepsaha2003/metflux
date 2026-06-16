// Adds customer-portal login columns and backfills every existing customer with
// a derived initial password (hashed) + a unique short-link code. Idempotent —
// safe to re-run; it only touches rows that are still missing credentials.
//
// Run with:
//   npm --workspace server run migrate:customer-portal-auth
import 'dotenv/config';
import { pool, qOne, q } from '../lib/db.js';
import { hashPassword } from '../lib/auth.js';
import { derivePortalPassword, uniqueShortCode } from '../lib/portal.js';

const columnExists = async (table, col) => {
  const row = await qOne(
    `SELECT COUNT(*) AS n FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, col]
  );
  return Number(row?.n ?? 0) > 0;
};

const indexExists = async (table, index) => {
  const row = await qOne(
    `SELECT COUNT(*) AS n FROM INFORMATION_SCHEMA.STATISTICS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?`,
    [table, index]
  );
  return Number(row?.n ?? 0) > 0;
};

const addColumn = async (col, ddl) => {
  if (await columnExists('Customer', col)) {
    console.log(`[migrate] Customer.${col} already exists — skipping`);
    return;
  }
  await pool.query(`ALTER TABLE \`Customer\` ADD COLUMN ${ddl}`);
  console.log(`[migrate] added Customer.${col}`);
};

const main = async () => {
  await addColumn('portalPasswordHash',    '`portalPasswordHash` VARCHAR(191) NULL');
  await addColumn('portalPasswordSet',     '`portalPasswordSet` TINYINT(1) NOT NULL DEFAULT 0');
  await addColumn('portalInitialPassword', '`portalInitialPassword` VARCHAR(64) NULL');
  await addColumn('portalShortCode',       '`portalShortCode` VARCHAR(16) NULL');

  if (!(await indexExists('Customer', 'Customer_portalShortCode_key'))) {
    await pool.query(
      'ALTER TABLE `Customer` ADD UNIQUE INDEX `Customer_portalShortCode_key` (`portalShortCode`)'
    );
    console.log('[migrate] added unique index on Customer.portalShortCode');
  } else {
    console.log('[migrate] Customer.portalShortCode index already exists — skipping');
  }

  // Backfill: any customer without a password hash gets a derived initial
  // password (stored hashed + plaintext for re-share) and a short code.
  const rows = await q(
    'SELECT `id`, `name`, `gstNumber`, `phone`, `portalPasswordHash`, `portalShortCode` FROM `Customer`'
  );
  let provisioned = 0;
  for (const c of rows) {
    const patch = {};
    if (!c.portalPasswordHash) {
      const initial = derivePortalPassword(c);
      patch.portalPasswordHash = await hashPassword(initial);
      patch.portalInitialPassword = initial;
      patch.portalPasswordSet = 0;
    }
    if (!c.portalShortCode) {
      patch.portalShortCode = await uniqueShortCode();
    }
    const keys = Object.keys(patch);
    if (!keys.length) continue;
    await pool.query(
      `UPDATE \`Customer\` SET ${keys.map((k) => `\`${k}\` = ?`).join(', ')} WHERE \`id\` = ?`,
      [...keys.map((k) => patch[k]), c.id]
    );
    provisioned += 1;
  }
  console.log(`[migrate] provisioned portal credentials for ${provisioned} customer(s)`);
  console.log('[migrate] done.');
};

main()
  .catch((err) => { console.error('[migrate] failed:', err); process.exitCode = 1; })
  .finally(() => pool.end());
