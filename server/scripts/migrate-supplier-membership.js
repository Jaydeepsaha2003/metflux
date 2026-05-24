// One-shot migration: adds SupplierMembership and backfills it from the
// legacy Supplier.companyId column so existing suppliers stay attached to
// their current company.
//
// Safe to re-run — every step is idempotent.
// Run with:
//   npm --workspace server run migrate:supplier-membership
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { pool, q, qOne } from '../lib/db.js';

const tableExists = async (name) => {
  const row = await qOne(
    `SELECT COUNT(*) AS n FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [name]
  );
  return Number(row?.n ?? 0) > 0;
};

const main = async () => {
  /* 1. Create the join table if it isn't there yet. */
  if (await tableExists('SupplierMembership')) {
    console.log('[migrate] SupplierMembership already exists');
  } else {
    await q(`
      CREATE TABLE \`SupplierMembership\` (
        \`id\`         VARCHAR(191) NOT NULL,
        \`supplierId\` VARCHAR(191) NOT NULL,
        \`companyId\`  VARCHAR(191) NOT NULL,
        \`createdAt\`  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        INDEX        \`SupplierMembership_companyId_idx\`(\`companyId\`),
        UNIQUE INDEX \`SupplierMembership_supplierId_companyId_key\`(\`supplierId\`, \`companyId\`),
        PRIMARY KEY (\`id\`)
      ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
    `);
    console.log('[migrate] created SupplierMembership table');
  }

  /* 2. Backfill — every existing supplier becomes a member of its current
     company unless that row already exists. */
  const orphans = await q(
    `SELECT s.\`id\` AS supplierId, s.\`companyId\` AS companyId
       FROM \`Supplier\` s
       LEFT JOIN \`SupplierMembership\` sm
              ON sm.\`supplierId\` = s.\`id\` AND sm.\`companyId\` = s.\`companyId\`
      WHERE s.\`companyId\` IS NOT NULL AND sm.\`id\` IS NULL`
  );

  if (orphans.length === 0) {
    console.log('[migrate] no suppliers need backfill');
  } else {
    console.log(`[migrate] backfilling ${orphans.length} membership row(s)…`);
    for (const o of orphans) {
      await q(
        'INSERT INTO `SupplierMembership` (`id`, `supplierId`, `companyId`) VALUES (?, ?, ?)',
        [randomUUID(), o.supplierId, o.companyId]
      );
    }
    console.log('[migrate] backfill done');
  }

  console.log('[migrate] supplier-membership migration complete.');
};

main()
  .catch((err) => {
    console.error('[migrate] failed:', err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
