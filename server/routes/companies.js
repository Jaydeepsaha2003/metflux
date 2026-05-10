// Multi-tenant company management — platform-admin only. Lets the platform
// owner add new companies, edit their details and soft-delete them.
//
// When a new company is created, the creator (a platform admin) is auto-added
// as COMPANY_ADMIN with all permissions so it shows up in their company
// switcher and they can dive in immediately.
import { Router } from 'express';
import { z } from 'zod';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { prisma } from '../lib/db.js';
import { AppError, asyncHandler } from '../lib/errors.js';
import { requireAuth } from '../lib/auth.js';
import { ROLES } from '../lib/constants.js';
import { ALL_PERMISSIONS } from '../lib/permissions.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOGOS_DIR = path.resolve(__dirname, '..', 'public', 'uploads', 'logos');
fs.mkdirSync(LOGOS_DIR, { recursive: true });

const logoUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, LOGOS_DIR),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase() || '.png';
      cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
    },
  }),
  limits: { fileSize: 2 * 1024 * 1024 }, // 2 MB
  fileFilter: (_req, file, cb) => {
    const ok = ['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml'].includes(file.mimetype);
    cb(ok ? null : new Error('Only JPEG, PNG, WebP or SVG images are allowed'), ok);
  },
});

const router = Router();
router.use(requireAuth);

/* GET /api/companies/me — active company details, available to all company members.
   Used by the packing list header to show logo, address, phone, etc. */
router.get('/me', asyncHandler(async (req, res) => {
  const companyId = req.auth?.companyId;
  if (!companyId) return res.json(null);
  const c = await prisma.company.findUnique({ where: { id: companyId } });
  if (!c) return res.json(null);
  res.json(publicCompany(c));
}));

// All routes below are restricted to platform admins.
router.use((req, _res, next) => {
  if (!req.auth?.isPlatformAdmin) throw new AppError('Platform admin only', 403, 'FORBIDDEN');
  next();
});

const slugify = (s) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'co';

const uniqueSlug = async (base, ignoreId) => {
  for (let i = 0; i < 12; i++) {
    const candidate = i === 0 ? base : `${base}-${i + 1}`;
    const exists = await prisma.company.findFirst({
      where: { slug: candidate, ...(ignoreId ? { NOT: { id: ignoreId } } : {}) },
    });
    if (!exists) return candidate;
  }
  return `${base}-${Date.now().toString(36).slice(-4)}`;
};

const createSchema = z.object({
  name: z.string().trim().min(2).max(160),
  gstNumber: z.string().trim().max(40).optional().nullable(),
  address: z.string().trim().max(400).optional().nullable(),
  phone: z.string().trim().max(40).optional().nullable(),
  whatsappNumber: z.string().trim().max(40).optional().nullable(),
  email: z.string().email().optional().nullable().or(z.literal('')),
  joinAsAdmin: z.boolean().optional().default(true),
});

const updateSchema = z.object({
  name: z.string().trim().min(2).max(160).optional(),
  gstNumber: z.string().trim().max(40).optional().nullable(),
  address: z.string().trim().max(400).optional().nullable(),
  phone: z.string().trim().max(40).optional().nullable(),
  whatsappNumber: z.string().trim().max(40).optional().nullable(),
  email: z.string().email().optional().nullable().or(z.literal('')),
});

const publicCompany = (c) => ({
  id: c.id,
  name: c.name,
  slug: c.slug,
  gstNumber: c.gstNumber,
  address: c.address,
  phone: c.phone,
  whatsappNumber: c.whatsappNumber ?? null,
  email: c.email,
  logoUrl: c.logoUrl ?? null,
  isActive: c.isActive,
  createdAt: c.createdAt,
  counts: c._count
    ? {
        members: c._count.memberships,
        customers: c._count.customers,
        poOrders: c._count.poOrders,
      }
    : undefined,
});

/* GET /api/companies — list all */
router.get('/', asyncHandler(async (req, res) => {
  const { search } = z.object({ search: z.string().trim().max(120).optional() }).parse(req.query);
  const items = await prisma.company.findMany({
    where: search
      ? { OR: [{ name: { contains: search } }, { slug: { contains: search } }] }
      : {},
    orderBy: { name: 'asc' },
    include: {
      _count: { select: { memberships: true, customers: true, poOrders: true } },
    },
  });
  res.json({ items: items.map(publicCompany) });
}));

/* GET /api/companies/:id */
router.get('/:id', asyncHandler(async (req, res) => {
  const c = await prisma.company.findUnique({
    where: { id: req.params.id },
    include: { _count: { select: { memberships: true, customers: true, poOrders: true } } },
  });
  if (!c) throw new AppError('Company not found', 404, 'NOT_FOUND');
  res.json(publicCompany(c));
}));

/* POST /api/companies — create + (optionally) auto-add the creator as admin */
router.post('/', asyncHandler(async (req, res) => {
  const data = createSchema.parse(req.body);
  const slug = await uniqueSlug(slugify(data.name));

  const created = await prisma.$transaction(async (tx) => {
    const co = await tx.company.create({
      data: {
        name: data.name,
        slug,
        gstNumber: data.gstNumber || null,
        address: data.address || null,
        phone: data.phone || null,
        whatsappNumber: data.whatsappNumber || null,
        email: data.email || null,
      },
    });
    if (data.joinAsAdmin) {
      await tx.membership.create({
        data: {
          userId: req.auth.userId,
          companyId: co.id,
          role: ROLES.COMPANY_ADMIN,
          permissions: ALL_PERMISSIONS(),
          isPrimary: false,
        },
      });
    }
    return co;
  });

  res.status(201).json(publicCompany(created));
}));

/* PATCH /api/companies/:id — update fields */
router.patch('/:id', asyncHandler(async (req, res) => {
  const data = updateSchema.parse(req.body);
  const c = await prisma.company.findUnique({ where: { id: req.params.id } });
  if (!c) throw new AppError('Company not found', 404, 'NOT_FOUND');

  const updated = await prisma.company.update({
    where: { id: c.id },
    data: {
      ...(data.name !== undefined ? { name: data.name } : {}),
      ...(data.gstNumber !== undefined ? { gstNumber: data.gstNumber || null } : {}),
      ...(data.address !== undefined ? { address: data.address || null } : {}),
      ...(data.phone !== undefined ? { phone: data.phone || null } : {}),
      ...(data.whatsappNumber !== undefined ? { whatsappNumber: data.whatsappNumber || null } : {}),
      ...(data.email !== undefined ? { email: data.email || null } : {}),
    },
  });
  res.json(publicCompany(updated));
}));

/* DELETE /api/companies/:id — soft-delete (isActive = false) */
router.delete('/:id', asyncHandler(async (req, res) => {
  const c = await prisma.company.findUnique({ where: { id: req.params.id } });
  if (!c) throw new AppError('Company not found', 404, 'NOT_FOUND');
  await prisma.company.update({ where: { id: c.id }, data: { isActive: false } });
  res.status(204).end();
}));

/* POST /api/companies/:id/logo — upload a logo image */
router.post('/:id/logo', logoUpload.single('logo'), asyncHandler(async (req, res) => {
  const c = await prisma.company.findUnique({ where: { id: req.params.id } });
  if (!c) throw new AppError('Company not found', 404, 'NOT_FOUND');
  if (!req.file) throw new AppError('No file uploaded', 400, 'NO_FILE');

  // Delete old logo file if it exists on disk.
  if (c.logoUrl) {
    const oldFile = path.join(LOGOS_DIR, path.basename(c.logoUrl));
    fs.unlink(oldFile, () => {});
  }

  const logoUrl = `/uploads/logos/${req.file.filename}`;
  const updated = await prisma.company.update({
    where: { id: c.id },
    data: { logoUrl },
  });
  res.json(publicCompany(updated));
}));

/* DELETE /api/companies/:id/logo — remove logo */
router.delete('/:id/logo', asyncHandler(async (req, res) => {
  const c = await prisma.company.findUnique({ where: { id: req.params.id } });
  if (!c) throw new AppError('Company not found', 404, 'NOT_FOUND');
  if (c.logoUrl) {
    const oldFile = path.join(LOGOS_DIR, path.basename(c.logoUrl));
    fs.unlink(oldFile, () => {});
  }
  await prisma.company.update({ where: { id: c.id }, data: { logoUrl: null } });
  res.status(204).end();
}));

export default router;
