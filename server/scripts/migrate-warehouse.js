// Store / Warehouse migration:
//  • Warehouse        — named stores (Main Store, Unit-2, …).
//  • StockMovement    — generic finished-goods stock ledger. IN = goods sent to
//    a store (overproduction), OUT = goods stocked out to a customer dispatch.
//    Stock on hand per warehouse + spec = Σ IN.pcs − Σ OUT.pcs. The physical
//    spec is snapshotted on every row (+ a `specKey`) so identical specs pool
//    together regardless of which PO line they came from.
//  • Dispatch.sourceType + Dispatch.warehouseId — a dispatch is normally sourced
//    from PRODUCTION; a stock-out is a WAREHOUSE-sourced dispatch (still tied to
//    the customer's SO line, so it flows into packing & invoices as usual).
// Idempotent — safe to re-run on every deploy.
//
// Run with:  npm --workspace server run migrate:warehouse
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

const main = async () => {
  // ── Warehouse ──
  await pool.query(
    `CREATE TABLE IF NOT EXISTS \`Warehouse\` (
      \`id\` VARCHAR(191) NOT NULL,
      \`companyId\` VARCHAR(191) NOT NULL,
      \`name\` VARCHAR(120) NOT NULL,
      \`isActive\` TINYINT(1) NOT NULL DEFAULT 1,
      \`notes\` VARCHAR(400) NULL,
      \`createdById\` VARCHAR(191) NULL,
      \`createdAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      \`updatedAt\` DATETIME(3) NOT NULL,
      INDEX \`Warehouse_companyId_idx\`(\`companyId\`),
      UNIQUE INDEX \`Warehouse_companyId_name_key\`(\`companyId\`, \`name\`),
      PRIMARY KEY (\`id\`)
    ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
  );
  console.log('[migrate] Warehouse table ready.');

  // ── StockMovement ──
  await pool.query(
    `CREATE TABLE IF NOT EXISTS \`StockMovement\` (
      \`id\` VARCHAR(191) NOT NULL,
      \`companyId\` VARCHAR(191) NOT NULL,
      \`warehouseId\` VARCHAR(191) NOT NULL,
      \`direction\` ENUM('IN','OUT') NOT NULL,
      \`poOrderItemId\` VARCHAR(191) NULL,
      \`dispatchId\` VARCHAR(191) NULL,
      \`specKey\` VARCHAR(255) NOT NULL,
      \`coreType\` VARCHAR(40) NULL,
      \`grade\` VARCHAR(80) NULL,
      \`material\` VARCHAR(120) NULL,
      \`measure\` VARCHAR(160) NULL,
      \`id1\` DOUBLE NULL, \`id2\` DOUBLE NULL,
      \`od1\` DOUBLE NULL, \`od2\` DOUBLE NULL,
      \`ht\` DOUBLE NULL,
      \`weightPerPc\` DOUBLE NOT NULL DEFAULT 0,
      \`pcs\` INTEGER NOT NULL,
      \`totalWeight\` DOUBLE NOT NULL DEFAULT 0,
      \`movementDate\` DATETIME(3) NOT NULL,
      \`vehicleNo\` VARCHAR(80) NULL,
      \`notes\` VARCHAR(400) NULL,
      \`createdById\` VARCHAR(191) NULL,
      \`createdAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      \`updatedAt\` DATETIME(3) NOT NULL,
      INDEX \`StockMovement_companyId_warehouse_idx\`(\`companyId\`, \`warehouseId\`),
      INDEX \`StockMovement_companyId_specKey_idx\`(\`companyId\`, \`specKey\`),
      INDEX \`StockMovement_poOrderItemId_idx\`(\`poOrderItemId\`),
      PRIMARY KEY (\`id\`)
    ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
  );
  console.log('[migrate] StockMovement table ready.');

  // ── Dispatch.sourceType + warehouseId ──
  if (!(await columnExists('Dispatch', 'sourceType'))) {
    await pool.query("ALTER TABLE `Dispatch` ADD COLUMN `sourceType` ENUM('PRODUCTION','WAREHOUSE') NOT NULL DEFAULT 'PRODUCTION'");
    console.log('[migrate] added Dispatch.sourceType');
  } else {
    console.log('[migrate] Dispatch.sourceType already exists — skipping');
  }
  if (!(await columnExists('Dispatch', 'warehouseId'))) {
    await pool.query('ALTER TABLE `Dispatch` ADD COLUMN `warehouseId` VARCHAR(191) NULL');
    await pool.query('ALTER TABLE `Dispatch` ADD INDEX `Dispatch_warehouseId_idx` (`warehouseId`)');
    console.log('[migrate] added Dispatch.warehouseId (+ index)');
  } else {
    console.log('[migrate] Dispatch.warehouseId already exists — skipping');
  }
  console.log('[migrate] done.');
};

main()
  .catch((err) => { console.error('[migrate] failed:', err); process.exitCode = 1; })
  .finally(() => pool.end());
