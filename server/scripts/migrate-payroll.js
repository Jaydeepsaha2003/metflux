// Payroll (advances ledger) migration:
//  • Labour.monthlySalary — fixed monthly salary per worker (optional).
//  • EmployeeAdvance      — an advance paid to a worker, tagged to a payroll
//    month (YYYY-MM). The monthly payroll view = salary − Σ advances for the
//    month = net payable.
// Idempotent — safe to re-run on every deploy.
//
// Run with:  npm --workspace server run migrate:payroll
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
  // ── Labour.monthlySalary ──
  if (!(await columnExists('Labour', 'monthlySalary'))) {
    await pool.query('ALTER TABLE `Labour` ADD COLUMN `monthlySalary` DOUBLE NULL');
    console.log('[migrate] added Labour.monthlySalary');
  } else {
    console.log('[migrate] Labour.monthlySalary already present — skipping');
  }

  // ── EmployeeAdvance ──
  await pool.query(
    `CREATE TABLE IF NOT EXISTS \`EmployeeAdvance\` (
      \`id\` VARCHAR(191) NOT NULL,
      \`companyId\` VARCHAR(191) NOT NULL,
      \`labourId\` VARCHAR(191) NOT NULL,
      \`labourName\` VARCHAR(120) NULL,
      \`amount\` DOUBLE NOT NULL,
      \`advanceDate\` DATETIME(3) NOT NULL,
      \`periodMonth\` VARCHAR(7) NOT NULL,
      \`notes\` VARCHAR(400) NULL,
      \`createdById\` VARCHAR(191) NULL,
      \`createdAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      INDEX \`EmployeeAdvance_companyId_periodMonth_idx\`(\`companyId\`, \`periodMonth\`),
      INDEX \`EmployeeAdvance_companyId_labourId_idx\`(\`companyId\`, \`labourId\`),
      PRIMARY KEY (\`id\`)
    ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
  );
  console.log('[migrate] EmployeeAdvance table ready.');

  console.log('[migrate] Payroll ready.');
};

main()
  .catch((err) => { console.error('[migrate] failed:', err); process.exitCode = 1; })
  .finally(() => pool.end());
