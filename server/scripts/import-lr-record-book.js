// One-time (or repeatable — it's idempotent) CLI import of a historical Lorry
// Receipt "Record-Book" spreadsheet into the LR module. See
// lib/lrRecordBookImport.js for the actual parsing/import logic — this is
// just the interactive command-line wrapper (lets you point at ANY file/company).
//
// Usage:
//   node scripts/import-lr-record-book.js --file "/path/LR FINAL.xlsx" --company "<companyId or name>"
//   ...add --dry to preview without writing.
import 'dotenv/config';
import { pool } from '../lib/db.js';
import { resolveCompany, importRecordBookFile } from '../lib/lrRecordBookImport.js';

const arg = (name, def = null) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : (i >= 0 ? true : def);
};
const FILE = arg('file');
const COMPANY = arg('company');
const DRY = !!arg('dry', false);

const main = async () => {
  if (!FILE) throw new Error('Missing --file <path to .xlsx>');
  const { company, companies } = await resolveCompany(COMPANY);
  if (!company) {
    console.log('Pass --company with one of these ids/names:');
    companies.forEach((c) => console.log(`  ${c.id}  ${c.name}`));
    throw new Error('Company not resolved');
  }
  console.log(`Target company: ${company.name} (${company.id})${DRY ? '  [DRY RUN]' : ''}`);

  const r = await importRecordBookFile(FILE, company.id, { dry: DRY });
  if (DRY) r.samples.forEach((s) => console.log(`  would import ${s}`));
  r.errorMessages.forEach((m) => console.log(`  ERROR ${m}`));
  console.log(`\nDone. imported=${r.imported} skipped(dup)=${r.skipped} errors=${r.errors}${DRY ? '  (dry run — nothing written)' : ''}`);
};

main().catch((e) => { console.error('[import] failed:', e.message); process.exitCode = 1; }).finally(() => pool.end());
