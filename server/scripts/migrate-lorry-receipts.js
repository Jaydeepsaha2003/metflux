// Lorry Receipt (LR / transport consignment) module — tables for the LR record
// book plus a consignor/consignee party master. Idempotent.
//
// Run with:  npm --workspace server run migrate:lorry-receipts
import 'dotenv/config';
import { pool, qOne } from '../lib/db.js';

const tableExists = async (t) => {
  const r = await qOne('SELECT COUNT(*) n FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?', [t]);
  return Number(r?.n ?? 0) > 0;
};
const columnExists = async (t, c) => {
  const r = await qOne('SELECT COUNT(*) n FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?', [t, c]);
  return Number(r?.n ?? 0) > 0;
};

const main = async () => {
  if (!(await tableExists('LrParty'))) {
    await pool.query(`
      CREATE TABLE \`LrParty\` (
        \`id\`        VARCHAR(191) NOT NULL,
        \`companyId\` VARCHAR(191) NOT NULL,
        \`name\`      VARCHAR(255) NOT NULL,
        \`address\`   VARCHAR(500) NULL,
        \`mobile\`    VARCHAR(60)  NULL,
        \`gstin\`     VARCHAR(40)  NULL,
        \`createdAt\` DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        \`updatedAt\` DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        PRIMARY KEY (\`id\`),
        INDEX \`LrParty_companyId_idx\` (\`companyId\`),
        INDEX \`LrParty_companyId_name_idx\` (\`companyId\`, \`name\`)
      ) DEFAULT CHARSET=utf8mb4`);
    console.log('[migrate] created LrParty');
  } else console.log('[migrate] LrParty exists — skipping');

  if (!(await tableExists('LorryReceipt'))) {
    await pool.query(`
      CREATE TABLE \`LorryReceipt\` (
        \`id\`               VARCHAR(191) NOT NULL,
        \`companyId\`        VARCHAR(191) NOT NULL,
        \`lrNo\`             VARCHAR(60)  NOT NULL,
        \`lrDate\`           DATETIME(3)  NOT NULL,
        \`consignorName\`    VARCHAR(255) NOT NULL,
        \`consignorAddress\` VARCHAR(500) NULL,
        \`consignorGstin\`   VARCHAR(40)  NULL,
        \`consignorMobile\`  VARCHAR(60)  NULL,
        \`consigneeName\`    VARCHAR(255) NOT NULL,
        \`consigneeAddress\` VARCHAR(500) NULL,
        \`consigneeGstin\`   VARCHAR(40)  NULL,
        \`consigneeMobile\`  VARCHAR(60)  NULL,
        \`fromLoc\`          VARCHAR(120) NULL,
        \`toLoc\`            VARCHAR(120) NULL,
        \`packages\`         INT          NOT NULL DEFAULT 0,
        \`packMethod\`       VARCHAR(80)  NULL,
        \`particular\`       VARCHAR(300) NULL,
        \`actualWt\`         DOUBLE       NOT NULL DEFAULT 0,
        \`chargedWt\`        DOUBLE       NOT NULL DEFAULT 0,
        \`rate\`             DOUBLE       NOT NULL DEFAULT 0,
        \`stCh\`             DOUBLE       NOT NULL DEFAULT 0,
        \`riskFovPct\`       DOUBLE       NOT NULL DEFAULT 0,
        \`riskFovAmount\`    DOUBLE       NOT NULL DEFAULT 0,
        \`hamali\`           DOUBLE       NOT NULL DEFAULT 0,
        \`otherCh\`          DOUBLE       NOT NULL DEFAULT 0,
        \`ddCh\`             DOUBLE       NOT NULL DEFAULT 0,
        \`totalValue\`       DOUBLE       NOT NULL DEFAULT 0,
        \`invNo\`            VARCHAR(80)  NULL,
        \`invDate\`          DATETIME(3)  NULL,
        \`ewayBillNo\`       VARCHAR(60)  NULL,
        \`modeOfDispatch\`   VARCHAR(60)  NULL,
        \`paymentMode\`      VARCHAR(20)  NOT NULL DEFAULT 'TO-PAY',
        \`valueDeclare\`     DOUBLE       NOT NULL DEFAULT 0,
        \`vehNo\`            VARCHAR(40)  NULL,
        \`dispatchDate\`     DATETIME(3)  NULL,
        \`amountRec\`        DOUBLE       NOT NULL DEFAULT 0,
        \`remark\`           VARCHAR(500) NULL,
        \`createdById\`      VARCHAR(191) NULL,
        \`createdAt\`        DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        \`updatedAt\`        DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        PRIMARY KEY (\`id\`),
        INDEX \`LorryReceipt_companyId_idx\` (\`companyId\`),
        INDEX \`LorryReceipt_companyId_lrDate_idx\` (\`companyId\`, \`lrDate\`),
        UNIQUE INDEX \`LorryReceipt_companyId_lrNo_uq\` (\`companyId\`, \`lrNo\`)
      ) DEFAULT CHARSET=utf8mb4`);
    console.log('[migrate] created LorryReceipt');
  } else console.log('[migrate] LorryReceipt exists — skipping');

  if (!(await tableExists('LrTransporter'))) {
    await pool.query(`
      CREATE TABLE \`LrTransporter\` (
        \`id\`        VARCHAR(191) NOT NULL,
        \`companyId\` VARCHAR(191) NOT NULL,
        \`name\`      VARCHAR(255) NOT NULL,
        \`tagline\`   VARCHAR(255) NULL,
        \`address\`   VARCHAR(500) NULL,
        \`phone\`     VARCHAR(120) NULL,
        \`email\`     VARCHAR(160) NULL,
        \`gstin\`     VARCHAR(40)  NULL,
        \`pan\`       VARCHAR(20)  NULL,
        \`logo\`      LONGTEXT     NULL,
        \`isDefault\` TINYINT(1)   NOT NULL DEFAULT 0,
        \`createdAt\` DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        \`updatedAt\` DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        PRIMARY KEY (\`id\`),
        INDEX \`LrTransporter_companyId_idx\` (\`companyId\`)
      ) DEFAULT CHARSET=utf8mb4`);
    console.log('[migrate] created LrTransporter');
  } else console.log('[migrate] LrTransporter exists — skipping');

  if (await tableExists('LorryReceipt') && !(await columnExists('LorryReceipt', 'transporterId'))) {
    await pool.query('ALTER TABLE `LorryReceipt` ADD COLUMN `transporterId` VARCHAR(191) NULL');
    console.log('[migrate] added LorryReceipt.transporterId');
  }

  // Public share token for the QR e-copy (scannable, no login). Backfill existing.
  if (await tableExists('LorryReceipt') && !(await columnExists('LorryReceipt', 'publicToken'))) {
    await pool.query('ALTER TABLE `LorryReceipt` ADD COLUMN `publicToken` VARCHAR(64) NULL');
    await pool.query('CREATE UNIQUE INDEX `LorryReceipt_publicToken_uq` ON `LorryReceipt` (`publicToken`)');
    console.log('[migrate] added LorryReceipt.publicToken');
  }
  const missing = await pool.query("SELECT `id` FROM `LorryReceipt` WHERE `publicToken` IS NULL OR `publicToken` = ''").then(([r]) => r).catch(() => []);
  for (const row of missing) {
    const tok = (await import('crypto')).randomUUID().replace(/-/g, '');
    await pool.query('UPDATE `LorryReceipt` SET `publicToken` = ? WHERE `id` = ?', [tok, row.id]);
  }
  if (missing.length) console.log(`[migrate] backfilled ${missing.length} public token(s)`);

  console.log('[migrate] done.');
};

main().catch((e) => { console.error('[migrate] failed:', e); process.exitCode = 1; }).finally(() => pool.end());
