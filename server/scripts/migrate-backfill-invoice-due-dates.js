// Backfill due dates on ALREADY-LINKED sales invoices whose customer has credit
// terms but whose dueDate was never stamped (shows as "no terms" on the Sales
// Register). This happens when the terms were added/changed after the invoice
// was linked — the per-save resync only fired on a terms change, so existing
// rows kept a NULL due date.
//
// Set-based, per-tenant-safe (joins by customerId, which is unique per company),
// and idempotent — only fills rows where dueDate IS NULL. Never overwrites a due
// date that is already set. Companion to migrate:link-invoices, which handles
// the customerId-NULL (unmatched-by-name) case.
//
// Run with:  npm --workspace server run migrate:backfill-invoice-due-dates
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
  // Depends on Customer.dueDays (migrate:customer-due-days) and SalesInvoice
  // (migrate:sales-invoices). If either is absent, there's nothing to backfill.
  if (!(await columnExists('Customer', 'dueDays')) || !(await columnExists('SalesInvoice', 'dueDate'))) {
    console.log('[migrate] Customer.dueDays / SalesInvoice.dueDate not present yet — skipping');
    return;
  }

  let result;
  try {
    [result] = await pool.query(
      'UPDATE `SalesInvoice` si ' +
      'JOIN `Customer` c ON c.`id` = si.`customerId` ' +
      'SET si.`dueDate` = DATE_ADD(si.`invoiceDate`, INTERVAL c.`dueDays` DAY) ' +
      'WHERE si.`dueDate` IS NULL ' +
      '  AND si.`invoiceDate` IS NOT NULL ' +
      '  AND c.`dueDays` IS NOT NULL'
    );
  } catch (err) {
    // SalesInvoice / Customer table absent on a minimal install — nothing to do.
    if (err && (err.code === 'ER_NO_SUCH_TABLE' || /doesn'?t exist/i.test(err.message || ''))) {
      console.log('[migrate] SalesInvoice/Customer table absent — skipping');
      return;
    }
    throw err;
  }
  console.log(`[migrate] backfilled due dates on ${result?.affectedRows ?? 0} linked invoice(s) from customer credit terms.`);
};

main()
  .catch((err) => { console.error('[migrate] failed:', err); process.exitCode = 1; })
  .finally(() => pool.end());
