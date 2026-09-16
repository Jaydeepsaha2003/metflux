// Customer-wise rate card: the rate a given customer pays for a given grade,
// so booking a Sales Order can fill the rate in instead of someone remembering
// it. Idempotent.
//
// Keyed on customer + grade, with core type as an OPTIONAL refinement: a row
// may name one core type, or leave it blank to cover every core type of that
// grade. Lookup prefers the specific row and falls back to the blank one.
//
// coreType is NOT NULL with '' as the "any core type" value rather than
// nullable, because MySQL treats NULLs as distinct in a UNIQUE index — with a
// nullable column the database would happily accept ten "any core type" rows
// for the same customer and grade, and the card would quietly stop having one
// answer per question.
//
// Run with:  npm --workspace server run migrate:customer-rates
import 'dotenv/config';
import { pool } from '../lib/db.js';

const tableExists = async (table) => {
  const [rows] = await pool.query(
    `SELECT 1 FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? LIMIT 1`,
    [table]
  );
  return rows.length > 0;
};

const collationOf = async (table) => {
  const [rows] = await pool.query(
    `SELECT TABLE_COLLATION AS c FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? LIMIT 1`,
    [table]
  );
  return rows[0]?.c ?? null;
};

const main = async () => {
  // Inherit Customer's collation rather than taking the server default. This
  // table joins to Customer on a VARCHAR id, and MySQL refuses to compare two
  // strings of different collations — "Illegal mix of collations". A fresh
  // MySQL 8 defaults to utf8mb4_0900_ai_ci while these tables are
  // utf8mb4_unicode_ci, and MariaDB defaults differently again, so the only
  // safe answer is whatever the rest of the schema is already using.
  const target = (await collationOf('Customer')) || 'utf8mb4_unicode_ci';
  const charset = target.split('_')[0];

  if (!(await tableExists('CustomerRate'))) {
    await pool.query(`
      CREATE TABLE \`CustomerRate\` (
        \`id\`         VARCHAR(191) NOT NULL,
        \`companyId\`  VARCHAR(191) NOT NULL,
        \`customerId\` VARCHAR(191) NOT NULL,
        \`grade\`      VARCHAR(120) NOT NULL,
        \`coreType\`   VARCHAR(20)  NOT NULL DEFAULT '',
        \`rateBasis\`  ENUM('PER_KG','PER_PCS') NOT NULL DEFAULT 'PER_KG',
        \`rateValue\`  DOUBLE NOT NULL,
        \`notes\`      VARCHAR(255) NULL,
        \`createdAt\`  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        \`updatedAt\`  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`CustomerRate_scope_key\` (\`companyId\`,\`customerId\`,\`grade\`,\`coreType\`),
        KEY \`CustomerRate_company_customer_idx\` (\`companyId\`,\`customerId\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=${charset} COLLATE=${target}
    `);
    console.log(`[migrate] created CustomerRate (${target})`);
  } else {
    const current = await collationOf('CustomerRate');
    if (current && current !== target) {
      // An earlier run of this script created the table on the server default.
      // Convert rather than leave every join to Customer throwing.
      await pool.query(`ALTER TABLE \`CustomerRate\` CONVERT TO CHARACTER SET ${charset} COLLATE ${target}`);
      console.log(`[migrate] CustomerRate collation ${current} -> ${target}`);
    } else {
      console.log('[migrate] CustomerRate already present — skipping');
    }
  }
  console.log('[migrate] Customer rate card ready.');
};

main()
  .catch((err) => { console.error('[migrate] failed:', err); process.exitCode = 1; })
  .finally(() => pool.end());
