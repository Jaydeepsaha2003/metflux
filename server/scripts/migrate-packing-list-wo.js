// One-time fix for historical Packing List WO numbers (plNumber) that the old
// client-side counter let duplicate. Renumbers every packing list sequentially
// per company in creation order — <first 3 letters of company name>WO-NNN — then
// adds a UNIQUE index on (companyId, plNumber) so duplicates can never recur.
//
// Gated on that index: once it exists the renumber is skipped, so re-running
// `npm run migrate` on later deploys will NOT disturb numbers assigned since.
//
// Run with:
//   npm --workspace server run migrate:packing-list-wo
import 'dotenv/config';
import { pool, q } from '../lib/db.js';

const woPrefix = (name) => `${String(name ?? '').slice(0, 3).toUpperCase()}WO`;

const indexExists = async (table, index) => {
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS n FROM INFORMATION_SCHEMA.STATISTICS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?`,
    [table, index]
  );
  return Number(rows[0]?.n ?? 0) > 0;
};

const INDEX = 'PackingList_companyId_plNumber_key';

const main = async () => {
  if (await indexExists('PackingList', INDEX)) {
    console.log('[migrate] packing-list WO numbers already migrated (unique index present) — skipping');
    return;
  }

  const companies = await q('SELECT `id`, `name` FROM `Company`');
  let total = 0;
  for (const co of companies) {
    const prefix = woPrefix(co.name);
    const pls = await q(
      'SELECT `id` FROM `PackingList` WHERE `companyId` = ? ORDER BY `createdAt` ASC, `id` ASC',
      [co.id]
    );
    let i = 0;
    for (const pl of pls) {
      i += 1;
      await pool.query('UPDATE `PackingList` SET `plNumber` = ? WHERE `id` = ?',
        [`${prefix}-${String(i).padStart(3, '0')}`, pl.id]);
    }
    total += pls.length;
    if (pls.length) console.log(`[migrate] ${co.name}: renumbered ${pls.length} packing list(s) → ${prefix}-NNN`);
  }

  await pool.query(
    `ALTER TABLE \`PackingList\` ADD UNIQUE INDEX \`${INDEX}\` (\`companyId\`, \`plNumber\`)`
  );
  console.log(`[migrate] added unique index ${INDEX}`);
  console.log(`[migrate] done — ${total} packing list(s) renumbered.`);
};

main()
  .catch((err) => { console.error('[migrate] failed:', err); process.exitCode = 1; })
  .finally(() => pool.end());
