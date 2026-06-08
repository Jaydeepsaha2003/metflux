// One-shot migration: switch Customer.shareToken from the raw UUID to a
// readable, globally-unique slug of the customer name, so the public portal
// URL reads /portal/aarti-steels instead of /portal/<uuid>.
//
// Old UUID links keep working — the portal route looks up by shareToken OR id.
// Safe to re-run — rows already on a name slug are left untouched.
// Run with:
//   npm --workspace server run migrate:customer-portal-slug
import 'dotenv/config';
import { pool, q, update } from '../lib/db.js';

const slugifyName = (name) => {
  const s = String(name ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
  return s || 'customer';
};

const main = async () => {
  const customers = await q(
    'SELECT `id`, `name`, `shareToken` FROM `Customer` ORDER BY `createdAt` ASC'
  );

  // Seed the "taken" set with tokens that are already name-based (i.e. not the
  // row's own id) so a re-run never collides with previously-assigned slugs.
  const taken = new Set();
  for (const c of customers) {
    if (c.shareToken && c.shareToken !== c.id) taken.add(c.shareToken);
  }

  let changed = 0;
  for (const c of customers) {
    if (c.shareToken && c.shareToken !== c.id) continue; // already migrated
    const base = slugifyName(c.name);
    let candidate = base;
    let n = 1;
    while (taken.has(candidate)) { n += 1; candidate = `${base}-${n}`; }
    taken.add(candidate);
    await update('Customer', c.id, { shareToken: candidate });
    changed += 1;
    console.log(`  ${candidate}  ←  ${c.name}`);
  }

  console.log(`[migrate] portal slugs: ${changed} updated, ${customers.length - changed} already slug-based.`);
  console.log('[migrate] done.');
};

main()
  .catch((err) => { console.error('[migrate] failed:', err); process.exitCode = 1; })
  .finally(() => pool.end());
