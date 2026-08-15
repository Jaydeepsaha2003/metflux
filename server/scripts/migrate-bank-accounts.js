// Multi-bank support for the cash book. Adds a BankAccount master (name, bank,
// A/C no, opening balance) and stamps every CashbookEntry with the account the
// money moved through. Idempotent.
//
// Existing books are migrated onto a per-company "Main Account" so nothing is
// orphaned, and the row-fingerprint (dedupeKey) is rebuilt to include the bank
// account — otherwise the SAME transaction imported into two different banks
// would be silently rejected as a duplicate.
//
// Run with:  npm --workspace server run migrate:bank-accounts
import 'dotenv/config';
import { pool } from '../lib/db.js';
import { v4 as uuidv4 } from 'uuid';

const columnExists = async (table, column) => {
  const [rows] = await pool.query(
    `SELECT 1 FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1`,
    [table, column]
  );
  return rows.length > 0;
};
const indexExists = async (table, index) => {
  const [rows] = await pool.query(
    `SELECT 1 FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ? LIMIT 1`,
    [table, index]
  );
  return rows.length > 0;
};
const tableExists = async (table) => {
  const [rows] = await pool.query(
    `SELECT 1 FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? LIMIT 1`,
    [table]
  );
  return rows.length > 0;
};

// The fingerprint now includes bankAccountId so the same bank row can legitimately
// exist under two different accounts.
const DEDUPE_EXPR =
  "SHA1(CONCAT_WS('|', CAST(`entryDate` AS CHAR), `side`, `normKey`, " +
  "CAST(ROUND(`amount`,2) AS CHAR), IFNULL(`vch`,''), IFNULL(`bankAccountId`,'')))";

const main = async () => {
  if (!(await tableExists('CashbookEntry'))) {
    console.log('[migrate] CashbookEntry missing — run migrate:cashbook first. Skipping.');
    return;
  }

  /* ── 1. BankAccount master ─────────────────────────────────────────────── */
  await pool.query(
    `CREATE TABLE IF NOT EXISTS \`BankAccount\` (
      \`id\` VARCHAR(191) NOT NULL,
      \`companyId\` VARCHAR(191) NOT NULL,
      \`name\` VARCHAR(120) NOT NULL,
      \`bankName\` VARCHAR(120) NULL,
      \`accountNumber\` VARCHAR(40) NULL,
      \`ifsc\` VARCHAR(20) NULL,
      \`openingBalance\` DOUBLE NOT NULL DEFAULT 0,
      \`openingAsOn\` DATETIME(3) NULL,
      \`isDefault\` TINYINT(1) NOT NULL DEFAULT 0,
      \`sortOrder\` INT NOT NULL DEFAULT 0,
      \`archivedAt\` DATETIME(3) NULL,
      \`createdAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      \`updatedAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      UNIQUE INDEX \`BankAccount_company_name_key\`(\`companyId\`, \`name\`),
      INDEX \`BankAccount_company_idx\`(\`companyId\`),
      PRIMARY KEY (\`id\`)
    ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
  );
  console.log('[migrate] BankAccount table ready.');

  /* ── 2. CashbookEntry.bankAccountId ────────────────────────────────────── */
  if (!(await columnExists('CashbookEntry', 'bankAccountId'))) {
    await pool.query('ALTER TABLE `CashbookEntry` ADD COLUMN `bankAccountId` VARCHAR(191) NULL');
    console.log('[migrate] added CashbookEntry.bankAccountId');
  }
  if (!(await indexExists('CashbookEntry', 'CashbookEntry_company_bank_idx'))) {
    await pool.query(
      'ALTER TABLE `CashbookEntry` ADD INDEX `CashbookEntry_company_bank_idx` (`companyId`, `bankAccountId`, `entryDate`)'
    );
    console.log('[migrate] added CashbookEntry (companyId, bankAccountId, entryDate) index');
  }

  /* ── 3. Give every company a default account ───────────────────────────── */
  // Companies that already own a cash book get one for sure; new companies get
  // one too so the upload flow works out of the box.
  const [companies] = await pool.query(
    'SELECT `id` FROM `Company` UNION SELECT DISTINCT `companyId` AS `id` FROM `CashbookEntry`'
  );
  let created = 0;
  for (const c of companies) {
    if (!c.id) continue;
    const [existing] = await pool.query(
      'SELECT `id` FROM `BankAccount` WHERE `companyId` = ? ORDER BY `isDefault` DESC, `createdAt` ASC LIMIT 1',
      [c.id]
    );
    if (existing.length) continue;
    await pool.query(
      'INSERT INTO `BankAccount` (`id`,`companyId`,`name`,`bankName`,`isDefault`,`sortOrder`) VALUES (?,?,?,?,1,0)',
      [uuidv4(), c.id, 'Main Account', null]
    );
    created++;
  }
  if (created) console.log(`[migrate] created ${created} default "Main Account" bank account(s)`);

  /* ── 4. Backfill existing entries onto each company's default account ──── */
  const [orphans] = await pool.query(
    'SELECT DISTINCT `companyId` FROM `CashbookEntry` WHERE `bankAccountId` IS NULL'
  );
  let moved = 0;
  for (const row of orphans) {
    const [acct] = await pool.query(
      'SELECT `id` FROM `BankAccount` WHERE `companyId` = ? ORDER BY `isDefault` DESC, `createdAt` ASC LIMIT 1',
      [row.companyId]
    );
    if (!acct.length) continue;
    const [r] = await pool.query(
      'UPDATE `CashbookEntry` SET `bankAccountId` = ? WHERE `companyId` = ? AND `bankAccountId` IS NULL',
      [acct[0].id, row.companyId]
    );
    moved += r.affectedRows ?? 0;
  }
  if (moved) console.log(`[migrate] moved ${moved} existing cashbook row(s) onto the default account`);

  /* ── 5. Rebuild dedupeKey to include the bank account ──────────────────── */
  // A STORED generated column's expression can't be altered in place, so the
  // unique index and the column are dropped and rebuilt. Guarded so re-runs are
  // a no-op once the expression already mentions bankAccountId.
  const [genRows] = await pool.query(
    `SELECT GENERATION_EXPRESSION AS expr FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'CashbookEntry' AND COLUMN_NAME = 'dedupeKey' LIMIT 1`
  );
  const currentExpr = genRows[0]?.expr ?? '';
  const needsRebuild = !currentExpr || !currentExpr.includes('bankAccountId');

  if (needsRebuild) {
    if (await indexExists('CashbookEntry', 'CashbookEntry_dedupe_key')) {
      await pool.query('ALTER TABLE `CashbookEntry` DROP INDEX `CashbookEntry_dedupe_key`');
      console.log('[migrate] dropped old dedupe index');
    }
    if (await columnExists('CashbookEntry', 'dedupeKey')) {
      await pool.query('ALTER TABLE `CashbookEntry` DROP COLUMN `dedupeKey`');
      console.log('[migrate] dropped old dedupeKey column');
    }
    await pool.query(
      'ALTER TABLE `CashbookEntry` ADD COLUMN `dedupeKey` VARCHAR(64) ' +
      `GENERATED ALWAYS AS (${DEDUPE_EXPR}) STORED`
    );
    console.log('[migrate] rebuilt CashbookEntry.dedupeKey (now bank-account aware)');

    const [del] = await pool.query(
      'DELETE c1 FROM `CashbookEntry` c1 JOIN `CashbookEntry` c2 ' +
      'ON c1.`companyId` = c2.`companyId` AND c1.`dedupeKey` = c2.`dedupeKey` AND c1.`id` > c2.`id`'
    );
    if (del.affectedRows) console.log(`[migrate] removed ${del.affectedRows} duplicate cashbook row(s)`);

    await pool.query(
      'ALTER TABLE `CashbookEntry` ADD UNIQUE INDEX `CashbookEntry_dedupe_key` (`companyId`, `dedupeKey`)'
    );
    console.log('[migrate] re-added CashbookEntry unique dedupe index');
  } else {
    console.log('[migrate] dedupeKey already bank-account aware — nothing to do.');
  }

  console.log('[migrate] bank accounts ready.');
};

main()
  .catch((err) => { console.error('[migrate] failed:', err); process.exitCode = 1; })
  .finally(() => pool.end());
