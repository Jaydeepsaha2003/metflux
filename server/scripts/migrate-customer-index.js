// Speed up the paginated customer register and its total-count query.
// The leading companyId keeps tenant scans narrow; createdAt matches the
// register's newest-first ordering. Idempotent for existing installations.
import 'dotenv/config';
import { pool } from '../lib/db.js';

const main = async () => {
  const [rows] = await pool.query(`SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Customer'
      AND INDEX_NAME = 'Customer_company_created_idx' LIMIT 1`);
  if (!rows.length) {
    await pool.query('CREATE INDEX `Customer_company_created_idx` ON `Customer` (`companyId`, `createdAt`)');
    console.log('[migrate] added Customer_company_created_idx');
  } else console.log('[migrate] Customer company index already present — skipping');
};

main().catch((err) => { console.error('[migrate] failed:', err); process.exitCode = 1; }).finally(() => pool.end());
