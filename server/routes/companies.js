// Multi-tenant company management — platform-admin only. Lets the platform
// owner add new companies, edit their details and soft-delete them.
//
// When a new company is created, the creator (a platform admin) is auto-added
// as COMPANY_ADMIN with all permissions so it shows up in their company
// switcher and they can dive in immediately.
import { Router } from 'express';
import { z } from 'zod';
import multer from 'multer';
import { q, qOne, insert, update, txn } from '../lib/db.js';
import { AppError, asyncHandler } from '../lib/errors.js';
import { requireAuth } from '../lib/auth.js';
import { ROLES } from '../lib/constants.js';
import { ALL_PERMISSIONS } from '../lib/permissions.js';

// Logos are stored as base64 data URLs directly in the DB so they survive
// Hostinger deployments (the public/uploads directory is git-ignored and gets
// wiped on a fresh clone). memoryStorage keeps the buffer in RAM; we never
// write the file to disk.
const logoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = ['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml'].includes(file.mimetype);
    cb(ok ? null : new Error('Only JPEG, PNG, WebP or SVG images are allowed'), ok);
  },
});

const router = Router();
router.use(requireAuth);

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
  defaultShareTarget: c.defaultShareTarget ?? 'PROMPT',
  isActive: !!c.isActive,
  createdAt: c.createdAt,
  counts: c._counts ? {
    members:   c._counts.members,
    customers: c._counts.customers,
    poOrders:  c._counts.poOrders,
  } : undefined,
});

const loadCounts = async (companyId) => {
  const [m, c, p] = await Promise.all([
    qOne('SELECT COUNT(*) AS n FROM `Membership` WHERE `companyId` = ?', [companyId]),
    qOne('SELECT COUNT(*) AS n FROM `Customer`   WHERE `companyId` = ?', [companyId]),
    qOne('SELECT COUNT(*) AS n FROM `PoOrder`    WHERE `companyId` = ?', [companyId]),
  ]);
  return { members: Number(m?.n ?? 0), customers: Number(c?.n ?? 0), poOrders: Number(p?.n ?? 0) };
};

/* GET /api/companies/me — active company details */
router.get('/me', asyncHandler(async (req, res) => {
  const companyId = req.auth?.companyId;
  if (!companyId) return res.json(null);
  const c = await qOne('SELECT * FROM `Company` WHERE `id` = ?', [companyId]);
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
    const exists = await qOne(
      'SELECT `id` FROM `Company` WHERE `slug` = ?' + (ignoreId ? ' AND `id` <> ?' : ''),
      ignoreId ? [candidate, ignoreId] : [candidate]
    );
    if (!exists) return candidate;
  }
  return `${base}-${Date.now().toString(36).slice(-4)}`;
};

const SHARE_TARGETS = ['PROMPT', 'CUSTOMER', 'COMPANY'];

const createSchema = z.object({
  name: z.string().trim().min(2).max(160),
  gstNumber: z.string().trim().max(40).optional().nullable(),
  address: z.string().trim().max(400).optional().nullable(),
  phone: z.string().trim().max(40).optional().nullable(),
  whatsappNumber: z.string().trim().max(40).optional().nullable(),
  email: z.string().email().optional().nullable().or(z.literal('')),
  defaultShareTarget: z.enum(SHARE_TARGETS).optional(),
  joinAsAdmin: z.boolean().optional().default(true),
});

const updateSchema = z.object({
  name: z.string().trim().min(2).max(160).optional(),
  gstNumber: z.string().trim().max(40).optional().nullable(),
  address: z.string().trim().max(400).optional().nullable(),
  phone: z.string().trim().max(40).optional().nullable(),
  whatsappNumber: z.string().trim().max(40).optional().nullable(),
  email: z.string().email().optional().nullable().or(z.literal('')),
  defaultShareTarget: z.enum(SHARE_TARGETS).optional(),
});

/* GET /api/companies — list all */
router.get('/', asyncHandler(async (req, res) => {
  const { search } = z.object({ search: z.string().trim().max(120).optional() }).parse(req.query);
  let sql = 'SELECT * FROM `Company`';
  const params = [];
  if (search) {
    sql += ' WHERE `name` LIKE ? OR `slug` LIKE ?';
    const like = `%${search}%`;
    params.push(like, like);
  }
  sql += ' ORDER BY `name` ASC';
  const rows = await q(sql, params);
  const items = await Promise.all(rows.map(async (c) => ({
    ...c, _counts: await loadCounts(c.id),
  })));
  res.json({ items: items.map(publicCompany) });
}));

/* GET /api/companies/:id */
router.get('/:id', asyncHandler(async (req, res) => {
  const c = await qOne('SELECT * FROM `Company` WHERE `id` = ?', [req.params.id]);
  if (!c) throw new AppError('Company not found', 404, 'NOT_FOUND');
  c._counts = await loadCounts(c.id);
  res.json(publicCompany(c));
}));

/* POST /api/companies — create + auto-add the creator as admin */
router.post('/', asyncHandler(async (req, res) => {
  const data = createSchema.parse(req.body);
  const slug = await uniqueSlug(slugify(data.name));

  const created = await txn(async (tx) => {
    const co = await tx.insert('Company', {
      name: data.name,
      slug,
      gstNumber: data.gstNumber || null,
      address:   data.address   || null,
      phone:     data.phone     || null,
      whatsappNumber: data.whatsappNumber || null,
      email:     data.email     || null,
      ...(data.defaultShareTarget ? { defaultShareTarget: data.defaultShareTarget } : {}),
    });
    if (data.joinAsAdmin) {
      await tx.insert('Membership', {
        userId: req.auth.userId,
        companyId: co.id,
        role: ROLES.COMPANY_ADMIN,
        permissions: ALL_PERMISSIONS(),
        isPrimary: false,
      });
    }
    return co;
  });

  res.status(201).json(publicCompany(created));
}));

/* PATCH /api/companies/:id — update fields */
router.patch('/:id', asyncHandler(async (req, res) => {
  const data = updateSchema.parse(req.body);
  const c = await qOne('SELECT * FROM `Company` WHERE `id` = ?', [req.params.id]);
  if (!c) throw new AppError('Company not found', 404, 'NOT_FOUND');

  const patch = {};
  if (data.name !== undefined) patch.name = data.name;
  if (data.gstNumber !== undefined) patch.gstNumber = data.gstNumber || null;
  if (data.address !== undefined) patch.address = data.address || null;
  if (data.phone !== undefined) patch.phone = data.phone || null;
  if (data.whatsappNumber !== undefined) patch.whatsappNumber = data.whatsappNumber || null;
  if (data.email !== undefined) patch.email = data.email || null;
  if (data.defaultShareTarget !== undefined) patch.defaultShareTarget = data.defaultShareTarget;

  const updated = await update('Company', c.id, patch);
  res.json(publicCompany(updated));
}));

/* DELETE /api/companies/:id — soft-delete */
router.delete('/:id', asyncHandler(async (req, res) => {
  const c = await qOne('SELECT `id` FROM `Company` WHERE `id` = ?', [req.params.id]);
  if (!c) throw new AppError('Company not found', 404, 'NOT_FOUND');
  await update('Company', c.id, { isActive: false });
  res.status(204).end();
}));

/* POST /api/companies/:id/logo */
router.post('/:id/logo', logoUpload.single('logo'), asyncHandler(async (req, res) => {
  const c = await qOne('SELECT * FROM `Company` WHERE `id` = ?', [req.params.id]);
  if (!c) throw new AppError('Company not found', 404, 'NOT_FOUND');
  if (!req.file) throw new AppError('No file uploaded', 400, 'NO_FILE');

  const logoUrl = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;
  const updated = await update('Company', c.id, { logoUrl });
  res.json(publicCompany(updated));
}));

/* DELETE /api/companies/:id/logo */
router.delete('/:id/logo', asyncHandler(async (req, res) => {
  const c = await qOne('SELECT * FROM `Company` WHERE `id` = ?', [req.params.id]);
  if (!c) throw new AppError('Company not found', 404, 'NOT_FOUND');
  await update('Company', c.id, { logoUrl: null });
  res.status(204).end();
}));

export default router;
