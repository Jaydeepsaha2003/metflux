// Link sales invoices that were imported without a customer match (customerId
// NULL) to an existing customer by normalized name, and stamp their due date
// from the customer's credit terms. Clears "credit terms missing / needs
// attention" for invoices whose customer (and terms) were added after import.
// Idempotent — only touches rows with customerId NULL.
//
// Run with:  npm --workspace server run migrate:link-invoices
import 'dotenv/config';
import { pool } from '../lib/db.js';
import { normName } from '../lib/invoicing.js';

const main = async () => {
  let customers;
  try {
    [customers] = await pool.query('SELECT `id`, `companyId`, `name`, `dueDays` FROM `Customer`');
  } catch { console.log('[migrate] Customer table absent — skipping'); return; }

  // companyId -> Map(normName -> {id, dueDays})
  const byCompany = new Map();
  for (const c of customers) {
    const k = normName(c.name);
    if (!k) continue;
    if (!byCompany.has(c.companyId)) byCompany.set(c.companyId, new Map());
    const m = byCompany.get(c.companyId);
    if (!m.has(k)) m.set(k, { id: c.id, dueDays: c.dueDays });
  }

  let rows;
  try {
    [rows] = await pool.query('SELECT `id`, `companyId`, `customerName` FROM `SalesInvoice` WHERE `customerId` IS NULL AND `customerName` IS NOT NULL');
  } catch { console.log('[migrate] SalesInvoice table absent — skipping'); return; }

  let linked = 0, dated = 0;
  for (const inv of rows) {
    const m = byCompany.get(inv.companyId);
    const hit = m && m.get(normName(inv.customerName));
    if (!hit) continue;
    if (hit.dueDays != null) {
      await pool.query('UPDATE `SalesInvoice` SET `customerId` = ?, `dueDate` = DATE_ADD(`invoiceDate`, INTERVAL ? DAY) WHERE `id` = ?', [hit.id, hit.dueDays, inv.id]);
      dated++;
    } else {
      await pool.query('UPDATE `SalesInvoice` SET `customerId` = ? WHERE `id` = ?', [hit.id, inv.id]);
    }
    linked++;
  }
  console.log(`[migrate] linked ${linked} invoice(s) to customers (${dated} got due dates from credit terms).`);
};

main()
  .catch((err) => { console.error('[migrate] failed:', err); process.exitCode = 1; })
  .finally(() => pool.end());
