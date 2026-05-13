// Bootstraps the platform admin user + a demo company + sample materials.
// Idempotent — safe to re-run; existing rows are left alone.
//
// Run once after importing database.sql:
//   npm --workspace server run seed
//
// All values are overridable via env (see server/.env.example).
import 'dotenv/config';
import { pool, q, qOne, insert, txn } from '../lib/db.js';
import { hashPassword } from '../lib/auth.js';
import { ROLES } from '../lib/constants.js';
import { ALL_PERMISSIONS } from '../lib/permissions.js';

const slugify = (s) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);

const main = async () => {
  const email = (process.env.SEED_SUPERADMIN_EMAIL || 'admin@metflux.com').toLowerCase();
  const username = (process.env.SEED_SUPERADMIN_USERNAME || 'admin').toLowerCase();
  const password = process.env.SEED_SUPERADMIN_PASSWORD || 'ChangeMe!123';
  const companyName = process.env.SEED_DEFAULT_COMPANY_NAME || 'Metflux Demo Co';
  const companySlug = slugify(companyName);

  // Company — find by slug or create.
  let company = await qOne('SELECT * FROM `Company` WHERE `slug` = ?', [companySlug]);
  if (!company) {
    company = await insert('Company', { name: companyName, slug: companySlug });
    console.log(`[seed] created company "${company.name}" (${company.id})`);
  } else {
    console.log(`[seed] company "${company.name}" already exists (${company.id})`);
  }

  // Platform admin — short-circuit if already there.
  const existing = await qOne(
    'SELECT `id`, `email`, `username` FROM `User` WHERE `email` = ? OR `username` = ? LIMIT 1',
    [email, username]
  );
  if (existing) {
    console.log(`[seed] platform admin already exists: ${existing.email} (${existing.username})`);
  } else {
    const passwordHash = await hashPassword(password);
    await txn(async (tx) => {
      const user = await tx.insert('User', {
        email,
        username,
        passwordHash,
        name: 'Platform Admin',
        isPlatformAdmin: true,
      });
      await tx.insert('Membership', {
        userId: user.id,
        companyId: company.id,
        role: ROLES.COMPANY_ADMIN,
        permissions: ALL_PERMISSIONS(),
        isPrimary: true,
      });
    });
    console.log(`[seed] created platform admin email=${email} userId=${username} on "${companyName}"`);
  }

  // Sample grade/material pairs so the PO form has something to pick from.
  // Skipped row-by-row if already present.
  const sampleGrades = [
    ['CRGO 27M3', 'M3 - 0.27mm'],
    ['CRGO 27M4', 'M4 - 0.27mm'],
    ['CRGO 30M5', 'M5 - 0.30mm'],
    ['CRGO 35M6', 'M6 - 0.35mm'],
    ['CRNGO 50',  '0.50mm'],
    ['CRNGO 65',  '0.65mm'],
  ];
  let added = 0;
  for (const [grade, material] of sampleGrades) {
    const dup = await qOne(
      'SELECT `id` FROM `MaterialGrade` WHERE `companyId` = ? AND `grade` = ? AND `material` = ?',
      [company.id, grade, material]
    );
    if (!dup) {
      await insert('MaterialGrade', { grade, material, companyId: company.id });
      added++;
    }
  }
  console.log(`[seed] sample grade/material pairs — ${added} added, ${sampleGrades.length - added} already present`);
};

main()
  .catch((e) => { console.error('[seed] failed:', e); process.exitCode = 1; })
  .finally(() => pool.end());
