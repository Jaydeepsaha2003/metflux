// Read-only health probe for the database behind whichever .env is loaded.
// Exists because the live databases are only reachable from the server, so
// when a screen goes blank this is the quickest way to tell a schema problem
// (a migration that never ran) apart from an engine problem (SQL that MySQL
// accepts and MariaDB does not). Writes nothing.
//
// Run with:  npm --workspace server run db:info
import 'dotenv/config';
import { pool, q } from '../lib/db.js';
import { producedPcsExpr } from '../lib/splitProduction.js';

const check = async (label, fn) => {
  try {
    console.log(`  OK    ${label}: ${await fn()}`);
  } catch (err) {
    console.log(`  FAIL  ${label}: [${err.code}] ${err.sqlMessage || err.message}`);
  }
};

const main = async () => {
  const [ver] = await q('SELECT VERSION() AS v, DATABASE() AS db');
  console.log(`\nengine   : ${ver.v} (${/maria/i.test(ver.v) ? 'MariaDB' : 'MySQL'})`);
  console.log(`database : ${ver.db}`);
  const [mode] = await q('SELECT @@sql_mode AS m');
  console.log(`sql_mode : ${mode.m || '(empty)'}\n`);

  const cols = await q(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Production' AND COLUMN_NAME = 'splitHeight'`
  );
  console.log(`  ${cols.length ? 'OK    ' : 'FAIL  '}Production.splitHeight column ${cols.length ? 'present' : 'MISSING — run: npm --workspace server run migrate'}`);

  // The real expression from lib/splitProduction.js, not a copy — this is the
  // query shape every production/dispatch/SO-summary screen depends on.
  await check('producedPcsExpr runs', async () => {
    const rows = await q(`SELECT ${producedPcsExpr('it')} AS produced FROM \`PoOrderItem\` it LIMIT 5`);
    return `${rows.length} row(s) sampled`;
  });

  await check('pending-items query runs', async () => {
    const rows = await q(
      `SELECT COUNT(*) AS n FROM (
         SELECT it.\`id\`, ${producedPcsExpr('it')} AS produced
           FROM \`PoOrderItem\` it
           INNER JOIN \`PoOrder\` po ON po.\`id\` = it.\`poOrderId\`
          WHERE it.\`status\` = 'ACTIVE'
       ) t WHERE t.produced < 1000000`
    );
    return `${rows[0].n} active item(s) visible`;
  });

  console.log('');
};

main()
  .catch((err) => { console.error('[db-info] failed:', err); process.exitCode = 1; })
  .finally(() => pool.end());
