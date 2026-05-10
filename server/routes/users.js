// Admin user management — list, create, update, deactivate users; manage
// per-company memberships (role + fine-grained permissions). Mirrors the
// .NET User_Creation form, extended for multi-company.
//
// Access: requires `manage_users` permission OR platform-admin OR COMPANY_ADMIN.
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/db.js';
import { AppError, asyncHandler } from '../lib/errors.js';
import { requireAuth, requirePermission, hashPassword } from '../lib/auth.js';
import {
  PERMISSION_KEYS,
  sanitizePermissions,
  effectivePermissions,
} from '../lib/permissions.js';
import { ROLES } from '../lib/constants.js';

const router = Router();

router.use(requireAuth, requirePermission('manage_users'));

/* ---------- DTOs ---------- */
const publicUser = (u) => ({
  id: u.id,
  email: u.email,
  username: u.username,
  name: u.name,
  isPlatformAdmin: u.isPlatformAdmin,
  isActive: u.isActive,
  createdAt: u.createdAt,
  memberships: (u.memberships ?? []).map((m) => ({
    id: m.id,
    companyId: m.companyId,
    companyName: m.company?.name,
    role: m.role,
    permissions: effectivePermissions(m.role, sanitizePermissions(m.permissions)),
    isPrimary: m.isPrimary,
    isActive: m.isActive,
  })),
});

/* ---------- Schemas ---------- */
const usernameSchema = z
  .string().trim().toLowerCase()
  .min(3, 'User ID must be at least 3 characters').max(30)
  .regex(/^[a-z0-9_-]+$/, 'User ID can only contain letters, numbers, _ and -');

const membershipInputSchema = z.object({
  companyId: z.string().min(1),
  role: z.enum([ROLES.COMPANY_ADMIN, ROLES.MANAGER, ROLES.STAFF]),
  permissions: z.array(z.enum(PERMISSION_KEYS)).default([]),
  isPrimary: z.boolean().optional().default(false),
});

const createSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().email(),
  username: usernameSchema,
  password: z.string().min(8, 'Password must be at least 8 characters').max(120),
  isPlatformAdmin: z.boolean().optional().default(false),
  memberships: z.array(membershipInputSchema).default([]),
});

const updateSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  email: z.string().trim().toLowerCase().email().optional(),
  username: usernameSchema.optional(),
  password: z.string().min(8).max(120).optional(), // omit to keep existing
  isPlatformAdmin: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

/* ---------- helpers ---------- */
// Non-platform admins can only see / touch users in their own active company.
const baseFilter = (req) =>
  req.auth.isPlatformAdmin
    ? {}
    : { memberships: { some: { companyId: req.tenant?.companyId ?? req.auth.companyId } } };

/* ---------- routes ---------- */

// GET /api/users — list users (paginated). ?search= filters name/email/username.
router.get('/', asyncHandler(async (req, res) => {
  const { page, pageSize, search } = z.object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
    search: z.string().trim().max(120).optional(),
  }).parse(req.query);

  const where = {
    ...baseFilter(req),
    ...(search
      ? { OR: [
          { name:     { contains: search } },
          { email:    { contains: search } },
          { username: { contains: search } },
        ] }
      : {}),
  };

  const [items, total] = await Promise.all([
    prisma.user.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { memberships: { include: { company: true } } },
    }),
    prisma.user.count({ where }),
  ]);
  res.json({ items: items.map(publicUser), total, page, pageSize });
}));

// GET /api/users/:id
router.get('/:id', asyncHandler(async (req, res) => {
  const user = await prisma.user.findFirst({
    where: { id: req.params.id, ...baseFilter(req) },
    include: { memberships: { include: { company: true } } },
  });
  if (!user) throw new AppError('User not found', 404, 'NOT_FOUND');
  res.json(publicUser(user));
}));

// POST /api/users — create user (optionally with initial memberships)
router.post('/', asyncHandler(async (req, res) => {
  const body = createSchema.parse(req.body);

  // Only platform admins can create platform admins.
  if (body.isPlatformAdmin && !req.auth.isPlatformAdmin) {
    throw new AppError('Only platform admins can create platform admins', 403, 'FORBIDDEN');
  }

  // Non-platform admins can only assign memberships in their own company.
  if (!req.auth.isPlatformAdmin) {
    const myCompanyId = req.auth.companyId;
    if (body.memberships.some((m) => m.companyId !== myCompanyId)) {
      throw new AppError('You can only assign users to your active company', 403, 'FORBIDDEN');
    }
  }

  // Uniqueness checks
  const [emailTaken, usernameTaken] = await Promise.all([
    prisma.user.findUnique({ where: { email: body.email } }),
    prisma.user.findUnique({ where: { username: body.username } }),
  ]);
  if (emailTaken)    throw new AppError('Email already registered', 409, 'EMAIL_TAKEN');
  if (usernameTaken) throw new AppError('User ID already taken', 409, 'USERNAME_TAKEN');

  // Ensure at most one membership is marked primary.
  const memberships = body.memberships.map((m, i) => ({
    ...m,
    isPrimary: i === 0 ? true : !!m.isPrimary, // first one default primary
    permissions: sanitizePermissions(m.permissions),
  }));
  if (memberships.filter((m) => m.isPrimary).length > 1) {
    memberships.forEach((m, i) => { m.isPrimary = i === 0; });
  }

  const passwordHash = await hashPassword(body.password);

  const created = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        name: body.name,
        email: body.email,
        username: body.username,
        passwordHash,
        isPlatformAdmin: body.isPlatformAdmin,
      },
    });
    for (const m of memberships) {
      await tx.membership.create({
        data: {
          userId: user.id,
          companyId: m.companyId,
          role: m.role,
          permissions: m.permissions,
          isPrimary: m.isPrimary,
        },
      });
    }
    return tx.user.findUnique({
      where: { id: user.id },
      include: { memberships: { include: { company: true } } },
    });
  });

  res.status(201).json(publicUser(created));
}));

// PATCH /api/users/:id — update basic info (no membership changes)
router.patch('/:id', asyncHandler(async (req, res) => {
  const data = updateSchema.parse(req.body);

  if (data.isPlatformAdmin !== undefined && !req.auth.isPlatformAdmin) {
    throw new AppError('Only platform admins can change platform-admin status', 403, 'FORBIDDEN');
  }
  // Block self-deactivation to avoid lock-out.
  if (req.params.id === req.auth.userId && data.isActive === false) {
    throw new AppError('You cannot deactivate yourself', 400, 'SELF_DEACTIVATE');
  }

  const target = await prisma.user.findFirst({
    where: { id: req.params.id, ...baseFilter(req) },
  });
  if (!target) throw new AppError('User not found', 404, 'NOT_FOUND');

  const update = { ...data };
  if (data.password) {
    update.passwordHash = await hashPassword(data.password);
    delete update.password;
  }

  const updated = await prisma.user.update({
    where: { id: target.id },
    data: update,
    include: { memberships: { include: { company: true } } },
  });
  res.json(publicUser(updated));
}));

// DELETE /api/users/:id — soft delete (set isActive = false)
router.delete('/:id', asyncHandler(async (req, res) => {
  if (req.params.id === req.auth.userId) {
    throw new AppError('You cannot delete yourself', 400, 'SELF_DELETE');
  }
  const target = await prisma.user.findFirst({
    where: { id: req.params.id, ...baseFilter(req) },
  });
  if (!target) throw new AppError('User not found', 404, 'NOT_FOUND');
  await prisma.user.update({ where: { id: target.id }, data: { isActive: false } });
  res.status(204).end();
}));

/* ---------- memberships ---------- */

// POST /api/users/:id/memberships — assign user to a company
router.post('/:id/memberships', asyncHandler(async (req, res) => {
  const data = membershipInputSchema.parse(req.body);

  if (!req.auth.isPlatformAdmin && data.companyId !== req.auth.companyId) {
    throw new AppError('You can only assign users to your active company', 403, 'FORBIDDEN');
  }
  const target = await prisma.user.findFirst({
    where: { id: req.params.id, ...baseFilter(req) },
  });
  if (!target) throw new AppError('User not found', 404, 'NOT_FOUND');

  await prisma.$transaction(async (tx) => {
    if (data.isPrimary) {
      await tx.membership.updateMany({
        where: { userId: target.id }, data: { isPrimary: false },
      });
    }
    await tx.membership.upsert({
      where: { userId_companyId: { userId: target.id, companyId: data.companyId } },
      create: {
        userId: target.id,
        companyId: data.companyId,
        role: data.role,
        permissions: sanitizePermissions(data.permissions),
        isPrimary: data.isPrimary,
        isActive: true,
      },
      update: {
        role: data.role,
        permissions: sanitizePermissions(data.permissions),
        isPrimary: data.isPrimary,
        isActive: true,
      },
    });
  });

  const fresh = await prisma.user.findUnique({
    where: { id: target.id },
    include: { memberships: { include: { company: true } } },
  });
  res.status(201).json(publicUser(fresh));
}));

// PATCH /api/users/:id/memberships/:mid — change role / permissions / primary
router.patch('/:id/memberships/:mid', asyncHandler(async (req, res) => {
  const data = membershipInputSchema.partial().parse(req.body);

  const m = await prisma.membership.findUnique({ where: { id: req.params.mid } });
  if (!m || m.userId !== req.params.id) throw new AppError('Membership not found', 404, 'NOT_FOUND');
  if (!req.auth.isPlatformAdmin && m.companyId !== req.auth.companyId) {
    throw new AppError('Forbidden', 403, 'FORBIDDEN');
  }

  await prisma.$transaction(async (tx) => {
    if (data.isPrimary) {
      await tx.membership.updateMany({
        where: { userId: m.userId, NOT: { id: m.id } }, data: { isPrimary: false },
      });
    }
    await tx.membership.update({
      where: { id: m.id },
      data: {
        ...(data.role !== undefined ? { role: data.role } : {}),
        ...(data.permissions !== undefined ? { permissions: sanitizePermissions(data.permissions) } : {}),
        ...(data.isPrimary !== undefined ? { isPrimary: data.isPrimary } : {}),
      },
    });
  });

  const fresh = await prisma.user.findUnique({
    where: { id: m.userId },
    include: { memberships: { include: { company: true } } },
  });
  res.json(publicUser(fresh));
}));

// DELETE /api/users/:id/memberships/:mid
router.delete('/:id/memberships/:mid', asyncHandler(async (req, res) => {
  const m = await prisma.membership.findUnique({ where: { id: req.params.mid } });
  if (!m || m.userId !== req.params.id) throw new AppError('Membership not found', 404, 'NOT_FOUND');
  if (!req.auth.isPlatformAdmin && m.companyId !== req.auth.companyId) {
    throw new AppError('Forbidden', 403, 'FORBIDDEN');
  }
  await prisma.membership.delete({ where: { id: m.id } });
  res.status(204).end();
}));

/* ---------- helpers for the form ---------- */

// GET /api/users/_meta/permissions — list of valid permission keys (for form)
router.get('/_meta/permissions', (_req, res) => {
  res.json({ permissions: PERMISSION_KEYS });
});

// GET /api/users/_meta/companies — list of companies the caller can assign to
router.get('/_meta/companies', asyncHandler(async (req, res) => {
  const where = req.auth.isPlatformAdmin ? {} : { id: req.auth.companyId };
  const companies = await prisma.company.findMany({
    where, orderBy: { name: 'asc' },
    select: { id: true, name: true, slug: true },
  });
  res.json({ companies });
}));

export default router;
