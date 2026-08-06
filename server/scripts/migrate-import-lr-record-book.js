// Auto-run version of the LR Record-Book importer, wired into the `migrate`
// chain so it fires automatically on every deploy (`npm run migrate`) — no
// separate command to remember. Imports the bundled reference workbook
// (scripts/seed-data/LR-Record-Book-Balaji.xlsx, committed to the repo so
// `git pull` brings it along) into the METFLUX company.
//
// Idempotent — an LR whose (company, lrNo) already exists is skipped, so this
// running on every deploy just reports "skipped" after the first successful
// run; it never duplicates data. Safe to leave in the chain indefinitely.
//
// To point this at a different file/company, edit FILE / COMPANY_MATCH below
// (or add more entries to RUNS[] to import multiple books).
import 'dotenv/config';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import { pool, q } from '../lib/db.js';
import { resolveCompany, importRecordBookFile, backfillDefaultTransporter } from '../lib/lrRecordBookImport.js';

const here = path.dirname(fileURLToPath(import.meta.url));

const RUNS = [
  { file: path.join(here, 'seed-data', 'LR-Record-Book-Balaji.xlsx'), companyMatch: 'METFLUX' },
];

const main = async () => {
  for (const run of RUNS) {
    if (!existsSync(run.file)) {
      console.log(`[migrate] LR record-book file absent (${path.basename(run.file)}) — skipping`);
      continue;
    }
    const { company } = await resolveCompany(run.companyMatch);
    if (!company) {
      console.log(`[migrate] no company matching "${run.companyMatch}" — skipping LR import for ${path.basename(run.file)}`);
      continue;
    }
    const r = await importRecordBookFile(run.file, company.id, { dry: false });
    console.log(`[migrate] LR record-book (${company.name}): imported ${r.imported}, skipped ${r.skipped} duplicate(s)${r.errors ? `, ${r.errors} error(s)` : ''}.`);
    r.errorMessages.forEach((m) => console.log(`  ERROR ${m}`));
  }

  // Attach each company's current default transporter to any of its LRs that
  // don't have one yet — covers rows imported before a default transporter
  // existed (like the 75 above), or any manually-created LR left unset.
  for (const co of await q('SELECT `id`,`name` FROM `Company`')) {
    const n = await backfillDefaultTransporter(co.id);
    if (n > 0) console.log(`[migrate] attached the default transporter to ${n} Lorry Receipt(s) for ${co.name}.`);
  }
};

main().catch((e) => { console.error('[migrate] LR import failed:', e.message); process.exitCode = 1; }).finally(() => pool.end());
