// Export test certificates. One row per certificate (one core size); the sample
// readings and the specification live in `data` as JSON — only the document reads
// them — while the register's columns (number, date, customer, PI, size, result)
// are real columns. Idempotent.
//
// Run with:  npm --workspace server run migrate:test-certificates
import 'dotenv/config';
import { pool } from '../lib/db.js';

const main = async () => {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS \`TestCertificate\` (
      \`id\` VARCHAR(191) NOT NULL,
      \`companyId\` VARCHAR(191) NOT NULL,
      \`certNo\` VARCHAR(60) NOT NULL,
      \`certDate\` DATE NOT NULL,
      \`customer\` VARCHAR(200) NOT NULL DEFAULT '',
      \`piRef\` VARCHAR(60) NOT NULL DEFAULT '',
      \`sizeLabel\` VARCHAR(80) NOT NULL DEFAULT '',
      \`result\` VARCHAR(10) NOT NULL DEFAULT '',
      \`data\` MEDIUMTEXT NOT NULL,
      \`createdById\` VARCHAR(191) NULL,
      \`createdAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      \`updatedAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      UNIQUE INDEX \`TestCertificate_company_no\`(\`companyId\`, \`certNo\`),
      INDEX \`TestCertificate_company_date\`(\`companyId\`, \`certDate\`),
      PRIMARY KEY (\`id\`)
    ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
  );
  console.log('[migrate] TestCertificate table ready.');
};

main()
  .catch((err) => { console.error('[migrate] failed:', err); process.exitCode = 1; })
  .finally(() => pool.end());
