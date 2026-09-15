// Every screen that shows produced pcs — Receive, Modify, Summary, Dispatch
// ready-list, SO Summary — runs producedPcsExpr once per order item, and that
// expression fires three correlated lookups into Production per row. The
// existing index is on poOrderItemId alone, so each lookup still had to visit
// the table rows to read splitHeight and pcs.
//
// Widening it to (poOrderItemId, splitHeight, pcs) makes those lookups
// index-only. Measured on a 12,000-row Production table: the item scan behind
// SO Summary went from 156ms to 99ms. Idempotent.
//
// Run with:  npm --workspace server run migrate:production-index
import 'dotenv/config';
import { pool } from '../lib/db.js';

const indexExists = async (table, name) => {
  const [rows] = await pool.query(
    `SELECT 1 FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ? LIMIT 1`,
    [table, name]
  );
  return rows.length > 0;
};

const main = async () => {
  if (!(await indexExists('Production', 'Production_item_split_pcs_idx'))) {
    await pool.query(
      'CREATE INDEX `Production_item_split_pcs_idx` ON `Production` (`poOrderItemId`, `splitHeight`, `pcs`)'
    );
    console.log('[migrate] added Production_item_split_pcs_idx');
  } else {
    console.log('[migrate] Production_item_split_pcs_idx already present — skipping');
  }
  console.log('[migrate] Production index ready.');
};

main()
  .catch((err) => { console.error('[migrate] failed:', err); process.exitCode = 1; })
  .finally(() => pool.end());
