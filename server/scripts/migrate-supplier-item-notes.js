// One-shot migration that adds SupplierOrderItem.notes — an optional free-text
// note the user can attach to each Supplier PO line item (special instruction,
// remark, etc.), shown on the printed PO sent to the supplier.
//
// Safe to re-run — idempotent.
// Run with:
//   npm --workspace server run migrate:supplier-item-notes
import 'dotenv/config';
import { pool, q, qOne } from '../lib/db.js';

const columnExists = async (table, column) => {
  const row = await qOne(
    `SELECT COUNT(*) AS n FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column]
  );
  return Number(row?.n ?? 0) > 0;
};

const main = async () => {
  if (await columnExists('SupplierOrderItem', 'notes')) {
    console.log('[migrate] SupplierOrderItem.notes already exists — nothing to do.');
  } else {
    await q('ALTER TABLE `SupplierOrderItem` ADD COLUMN `notes` TEXT NULL AFTER `amount`');
    console.log('[migrate] added SupplierOrderItem.notes (nullable TEXT)');
  }
  console.log('[migrate] done.');
};

main()
  .catch((err) => {
    console.error('[migrate] failed:', err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
