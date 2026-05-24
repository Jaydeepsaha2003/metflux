// One-shot migration that adds Customer.customerCode + a unique index, then
// backfills existing rows with a sensible default code.
//
// Safe to re-run — every step is idempotent.
// Run with:
//   npm --workspace server run migrate:customer-code
import 'dotenv/config';
import { pool, q, qOne, update } from '../lib/db.js';

/** Strip non-alpha chars, uppercase, pad to 3 with X. "AARTI STEELS" → "AAR". */
const prefixFromName = (name) => {
  const letters = String(name ?? '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3);
  return (letters + 'XXX').slice(0, 3);
};

const columnExists = async (table, column) => {
  const row = await qOne(
    `SELECT COUNT(*) AS n FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column]
  );
  return Number(row?.n ?? 0) > 0;
};

const indexExists = async (table, indexName) => {
  const row = await qOne(
    `SELECT COUNT(*) AS n FROM INFORMATION_SCHEMA.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?`,
    [table, indexName]
  );
  return Number(row?.n ?? 0) > 0;
};

const main = async () => {
  /* 1. Add the column if missing — nullable for now so the backfill can run. */
  if (await columnExists('Customer', 'customerCode')) {
    console.log('[migrate] Customer.customerCode already exists');
  } else {
    await q('ALTER TABLE `Customer` ADD COLUMN `customerCode` VARCHAR(40) NULL AFTER `id`');
    console.log('[migrate] added Customer.customerCode (nullable)');
  }

  /* 2. Backfill any rows that still have a null/blank code. */
  const blanks = await q(
    "SELECT `id`, `name`, `companyId` FROM `Customer` WHERE `customerCode` IS NULL OR `customerCode` = '' ORDER BY `createdAt` ASC"
  );

  if (blanks.length === 0) {
    console.log('[migrate] no customers need backfill');
  } else {
    console.log(`[migrate] backfilling ${blanks.length} customer code(s)…`);
    // Per-company prefix counter so codes are tidy and sequential within a tenant.
    const counters = new Map(); // key: `${companyId}::${prefix}` → next int

    for (const c of blanks) {
      const prefix = prefixFromName(c.name);
      const key = `${c.companyId}::${prefix}`;

      // Seed the counter from the highest existing serial for that prefix
      // (so a partial re-run doesn't collide with codes assigned earlier).
      if (!counters.has(key)) {
        const existing = await q(
          'SELECT `customerCode` FROM `Customer` WHERE `companyId` = ? AND `customerCode` LIKE ?',
          [c.companyId, `${prefix}-%`]
        );
        let maxSerial = 0;
        for (const r of existing) {
          const m = /-(\d+)$/.exec(r.customerCode ?? '');
          if (m) maxSerial = Math.max(maxSerial, parseInt(m[1], 10));
        }
        counters.set(key, maxSerial + 1);
      }

      // Find the next free serial (skip any taken by other rows).
      let serial = counters.get(key);
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const code = `${prefix}-${String(serial).padStart(3, '0')}`;
        const clash = await qOne(
          'SELECT `id` FROM `Customer` WHERE `companyId` = ? AND `customerCode` = ?',
          [c.companyId, code]
        );
        if (!clash) {
          await update('Customer', c.id, { customerCode: code });
          counters.set(key, serial + 1);
          console.log(`  ${code}  ←  ${c.name}`);
          break;
        }
        serial += 1;
      }
    }
  }

  /* 3. Make the column NOT NULL once everything has a value. */
  await q('ALTER TABLE `Customer` MODIFY COLUMN `customerCode` VARCHAR(40) NOT NULL');
  console.log('[migrate] set Customer.customerCode NOT NULL');

  /* 4. Add the unique index if missing. */
  if (await indexExists('Customer', 'Customer_companyId_customerCode_key')) {
    console.log('[migrate] unique index already exists');
  } else {
    await q(
      'ALTER TABLE `Customer` ADD UNIQUE INDEX `Customer_companyId_customerCode_key` (`companyId`, `customerCode`)'
    );
    console.log('[migrate] added unique index on (companyId, customerCode)');
  }

  console.log('[migrate] done.');
};

main()
  .catch((err) => {
    console.error('[migrate] failed:', err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
