// Bootstraps the platform admin user + a demo company on first install.
import 'dotenv/config';
import { prisma } from '../lib/db.js';
import { hashPassword } from '../lib/auth.js';
import { ROLES } from '../lib/constants.js';
import { ALL_PERMISSIONS } from '../lib/permissions.js';

const slugify = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);

const main = async () => {
  const email = (process.env.SEED_SUPERADMIN_EMAIL || 'admin@metflux.com').toLowerCase();
  const username = (process.env.SEED_SUPERADMIN_USERNAME || 'admin').toLowerCase();
  const password = process.env.SEED_SUPERADMIN_PASSWORD || 'ChangeMe!123';
  const companyName = process.env.SEED_DEFAULT_COMPANY_NAME || 'Metflux Demo Co';
  const companySlug = slugify(companyName);

  const company = await prisma.company.upsert({
    where: { slug: companySlug },
    update: {},
    create: { name: companyName, slug: companySlug },
  });

  const existing = await prisma.user.findFirst({
    where: { OR: [{ email }, { username }] },
  });
  if (existing) {
    console.log(`[seed] platform admin already exists: ${existing.email} (${existing.username})`);
    return;
  }

  await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        email,
        username,
        passwordHash: await hashPassword(password),
        name: 'Platform Admin',
        isPlatformAdmin: true,
      },
    });
    await tx.membership.create({
      data: {
        userId: user.id,
        companyId: company.id,
        role: ROLES.COMPANY_ADMIN,
        permissions: ALL_PERMISSIONS(),
        isPrimary: true,
      },
    });
  });

  // Sample grades + materials so the PO form has something to pick from.
  const sampleGrades = [
    ['CRGO 27M3',  'M3 - 0.27mm'],
    ['CRGO 27M4',  'M4 - 0.27mm'],
    ['CRGO 30M5',  'M5 - 0.30mm'],
    ['CRGO 35M6',  'M6 - 0.35mm'],
    ['CRNGO 50',   '0.50mm'],
    ['CRNGO 65',   '0.65mm'],
  ];
  for (const [grade, material] of sampleGrades) {
    await prisma.materialGrade.upsert({
      where: { companyId_grade_material: { companyId: company.id, grade, material } },
      create: { grade, material, companyId: company.id },
      update: {},
    });
  }

  console.log(`[seed] created platform admin email=${email} userId=${username} on "${companyName}"`);
  console.log(`[seed] inserted ${sampleGrades.length} sample grade/material pairs`);
};

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
