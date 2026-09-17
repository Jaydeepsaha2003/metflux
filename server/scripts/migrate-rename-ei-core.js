// Rename the legacy E_CORE product code to EI_CORE.
// Existing orders remain intact; only their stored type identifier changes.
import 'dotenv/config';
import { pool } from '../lib/db.js';

const tables = ['PoOrderItem', 'QuotationItem', 'FluxGrade', 'MaterialGrade'];
const types = ['TOROIDAL', 'RECTANGULAR', 'NANO', 'COMPOSITE', 'CUT_ROUND', 'CUT_RECT', 'E_CORE', 'EI_CORE', 'WOUND_CORE', 'STEP_CORE'];

const main = async () => {
  const list = types.map((v) => `'${v}'`).join(',');
  for (const table of tables) {
    const [columns] = await pool.query(
      `SELECT COLUMN_TYPE AS t FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = 'coreType' LIMIT 1`,
      [table],
    );
    if (!columns.length) continue;
    const nullable = (await pool.query(
      `SELECT IS_NULLABLE AS n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = 'coreType' LIMIT 1`,
      [table],
    ))[0][0]?.n === 'YES';
    if (columns[0].t.includes('E_CORE')) {
      await pool.query(`ALTER TABLE \`${table}\` MODIFY COLUMN \`coreType\` ENUM(${list},'E_CORE') ${nullable ? 'NULL' : 'NOT NULL'}`);
    }
    await pool.query(`UPDATE \`${table}\` SET \`coreType\` = 'EI_CORE' WHERE \`coreType\` = 'E_CORE'`);
    await pool.query(`ALTER TABLE \`${table}\` MODIFY COLUMN \`coreType\` ENUM(${list}) ${nullable ? 'NULL' : 'NOT NULL'}`);
  }
  const [materialGrade] = await pool.query(
    `SELECT id, coreTypes FROM \`MaterialGrade\` WHERE coreTypes LIKE '%E_CORE%'`,
  );
  for (const row of materialGrade) {
    await pool.query('UPDATE `MaterialGrade` SET `coreTypes` = ? WHERE `id` = ?', [
      String(row.coreTypes).replace(/(^|,)E_CORE(?=,|$)/g, '$1EI_CORE'), row.id,
    ]);
  }
  console.log('[migrate] E_CORE renamed to EI_CORE.');
};

main().catch((err) => { console.error('[migrate] failed:', err); process.exitCode = 1; }).finally(() => pool.end());
