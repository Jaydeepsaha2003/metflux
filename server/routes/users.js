// Admin user management — list, create, update, deactivate users; manage
// per-company memberships (role + fine-grained permissions). Mirrors the
// .NET User_Creation form, extended for multi-company.
import { Router } from 'express';
import { z } from 'zod';
import { q, qOne, insert, update, del, txn } from '../lib/db.js';
import { AppError, asyncHandler } from '../lib/errors.js';
import { requireAuth, requirePermission, hashPassword } from '../lib/auth.js';
import {
  PERMISSION_KEYS,
  sanitizePermissions,
  effectivePermissions,
} from '../lib/permissions.js';
import { ROLES } from '../lib/constants.js';
import { countUserRefs, userBlockers, USER_OWNED_TABLES } from '../lib/userRefs.js';

const router = Router();
router.use(requireAuth, requirePermission('manage_users'));

const parseJson = (v) => {
  if (v == null) return null;
  if (typeof v === 'string') { try { return JSON.parse(v); } catch { return null; } }
  return v;
};

/* ---------- DTO ---------- */
const publicUser = (u) => ({
  id: u.id,
  email: u.email,
  username: u.username,
  name: u.name,
  isPlatformAdmin: !!u.isPlatformAdmin,
  isActive: !!u.isActive,
  createdAt: u.createdAt,
  memberships: (u.memberships ?? []).map((m) => ({
    id: m.id,
    companyId: m.companyId,
    companyName: m.company?.name,
    role: m.role,
    permissions: effectivePermissions(m.role, sanitizePermissions(parseJson(m.permissions))),
    isPrimary: !!m.isPrimary,
    isActive: !!m.isActive,
    hideCustomerNames: !!m.hideCustomerNames,
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
  hideCustomerNames: z.boolean().optional().default(false),
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
  password: z.string().min(8).max(120).optional(),
  isPlatformAdmin: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

/* ---------- helpers ---------- */
// Loads a user with their company-membership rows + the joined company name.
const loadUserWithMemberships = async (userId, baseFilterSql = '', baseFilterParams = []) => {
  const user = await qOne(
    `SELECT * FROM \`User\` WHERE \`id\` = ? ${baseFilterSql}`,
    [userId, ...baseFilterParams]
  );
  if (!user) return null;
  user.memberships = await q(
    `SELECT m.*, c.\`id\` AS c_id, c.\`name\` AS c_name
       FROM \`Membership\` m
       LEFT JOIN \`Company\` c ON c.\`id\` = m.\`companyId\`
      WHERE m.\`userId\` = ?
      ORDER BY m.\`createdAt\` ASC`,
    [userId]
  );
  user.memberships = user.memberships.map((m) => ({ ...m, company: { id: m.c_id, name: m.c_name } }));
  return user;
};

// Non-platform admins only see / touch users who share their active company.
const userIsVisible = async (req, userId) => {
  if (req.auth.isPlatformAdmin) return true;
  const cid = req.tenant?.companyId ?? req.auth.companyId;
  const row = await qOne(
    'SELECT `id` FROM `Membership` WHERE `userId` = ? AND `companyId` = ?',
    [userId, cid]
  );
  return !!row;
};

/* ---------- routes ---------- */

// GET /api/users
router.get('/', asyncHandler(async (req, res) => {
  const { page, pageSize, search } = z.object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
    search: z.string().trim().max(120).optional(),
  }).parse(req.query);

  let sql, countSql;
  const params = [];
  if (req.auth.isPlatformAdmin) {
    sql      = 'SELECT * FROM `User`';
    countSql = 'SELECT COUNT(*) AS n FROM `User`';
  } else {
    const cid = req.auth.companyId;
    sql      = `SELECT DISTINCT u.* FROM \`User\` u
                INNER JOIN \`Membership\` m ON m.\`userId\` = u.\`id\`
                WHERE m.\`companyId\` = ?`;
    countSql = `SELECT COUNT(DISTINCT u.\`id\`) AS n FROM \`User\` u
                INNER JOIN \`Membership\` m ON m.\`userId\` = u.\`id\`
                WHERE m.\`companyId\` = ?`;
    params.push(cid);
  }

  let countParams = [...params];
  if (search) {
    const like = `%${search}%`;
    const cond = req.auth.isPlatformAdmin
      ? ' WHERE (`name` LIKE ? OR `email` LIKE ? OR `username` LIKE ?)'
      : ' AND (u.`name` LIKE ? OR u.`email` LIKE ? OR u.`username` LIKE ?)';
    sql      += cond;
    countSql += cond;
    params.push(like, like, like);
    countParams.push(like, like, like);
  }

  const skip = (page - 1) * pageSize;
  sql += ' ORDER BY `createdAt` DESC LIMIT ? OFFSET ?';
  params.push(pageSize, skip);

  const [rows, totalRow] = await Promise.all([
    q(sql, params),
    qOne(countSql, countParams),
  ]);
  const items = await Promise.all(rows.map((u) => loadUserWithMemberships(u.id)));
  res.json({ items: items.map(publicUser), total: Number(totalRow?.n ?? 0), page, pageSize });
}));

// GET /api/users/_meta/permissions — list of valid permission keys (route order: meta before :id)
router.get('/_meta/permissions', (_req, res) => {
  res.json({ permissions: PERMISSION_KEYS });
});

// GET /api/users/_meta/companies — companies the caller can assign to
router.get('/_meta/companies', asyncHandler(async (req, res) => {
  if (req.auth.isPlatformAdmin) {
    const companies = await q(
      'SELECT `id`, `name`, `slug` FROM `Company` ORDER BY `name` ASC'
    );
    return res.json({ companies });
  }
  const co = await qOne('SELECT `id`, `name`, `slug` FROM `Company` WHERE `id` = ?', [req.auth.companyId]);
  res.json({ companies: co ? [co] : [] });
}));

// GET /api/users/:id
router.get('/:id', asyncHandler(async (req, res) => {
  if (!(await userIsVisible(req, req.params.id))) {
    throw new AppError('User not found', 404, 'NOT_FOUND');
  }
  const user = await loadUserWithMemberships(req.params.id);
  if (!user) throw new AppError('User not found', 404, 'NOT_FOUND');
  res.json(publicUser(user));
}));

// POST /api/users
router.post('/', asyncHandler(async (req, res) => {
  const body = createSchema.parse(req.body);

  if (body.isPlatformAdmin && !req.auth.isPlatformAdmin) {
    throw new AppError('Only platform admins can create platform admins', 403, 'FORBIDDEN');
  }

  if (!req.auth.isPlatformAdmin) {
    const myCompanyId = req.auth.companyId;
    if (body.memberships.some((m) => m.companyId !== myCompanyId)) {
      throw new AppError('You can only assign users to your active company', 403, 'FORBIDDEN');
    }
  }

  const [emailTaken, usernameTaken] = await Promise.all([
    qOne('SELECT `id` FROM `User` WHERE `email` = ?', [body.email]),
    qOne('SELECT `id` FROM `User` WHERE `username` = ?', [body.username]),
  ]);
  if (emailTaken)    throw new AppError('Email already registered', 409, 'EMAIL_TAKEN');
  if (usernameTaken) throw new AppError('User ID already taken', 409, 'USERNAME_TAKEN');

  const memberships = body.memberships.map((m, i) => ({
    ...m,
    isPrimary: i === 0 ? true : !!m.isPrimary,
    permissions: sanitizePermissions(m.permissions),
  }));
  if (memberships.filter((m) => m.isPrimary).length > 1) {
    memberships.forEach((m, i) => { m.isPrimary = i === 0; });
  }

  const passwordHash = await hashPassword(body.password);

  const userId = await txn(async (tx) => {
    const u = await tx.insert('User', {
      name: body.name,
      email: body.email,
      username: body.username,
      passwordHash,
      isPlatformAdmin: !!body.isPlatformAdmin,
    });
    for (const m of memberships) {
      await tx.insert('Membership', {
        userId: u.id,
        companyId: m.companyId,
        role: m.role,
        permissions: m.permissions,
        isPrimary: !!m.isPrimary,
        hideCustomerNames: !!m.hideCustomerNames,
      });
    }
    return u.id;
  });

  const fresh = await loadUserWithMemberships(userId);
  res.status(201).json(publicUser(fresh));
}));

// PATCH /api/users/:id
router.patch('/:id', asyncHandler(async (req, res) => {
  const data = updateSchema.parse(req.body);

  if (data.isPlatformAdmin !== undefined && !req.auth.isPlatformAdmin) {
    throw new AppError('Only platform admins can change platform-admin status', 403, 'FORBIDDEN');
  }
  if (req.params.id === req.auth.userId && data.isActive === false) {
    throw new AppError('You cannot deactivate yourself', 400, 'SELF_DEACTIVATE');
  }
  if (!(await userIsVisible(req, req.params.id))) {
    throw new AppError('User not found', 404, 'NOT_FOUND');
  }

  const patch = {};
  if (data.name             !== undefined) patch.name = data.name;
  if (data.email            !== undefined) patch.email = data.email;
  if (data.username         !== undefined) patch.username = data.username;
  if (data.isPlatformAdmin  !== undefined) patch.isPlatformAdmin = data.isPlatformAdmin;
  if (data.isActive         !== undefined) patch.isActive = data.isActive;
  if (data.password) patch.passwordHash = await hashPassword(data.password);

  if (Object.keys(patch).length > 0) await update('User', req.params.id, patch);

  // Security: a password reset (or deactivation) logs the user out of every
  // device by revoking all their active refresh tokens.
  if (data.password || data.isActive === false) {
    await q('UPDATE `RefreshToken` SET `revokedAt` = ? WHERE `userId` = ? AND `revokedAt` IS NULL', [new Date(), req.params.id]);
  }

  const fresh = await loadUserWithMemberships(req.params.id);
  res.json(publicUser(fresh));
}));

// DELETE /api/users/:id — soft delete
router.delete('/:id', asyncHandler(async (req, res) => {
  if (req.params.id === req.auth.userId) {
    throw new AppError('You cannot delete yourself', 400, 'SELF_DELETE');
  }
  if (!(await userIsVisible(req, req.params.id))) {
    throw new AppError('User not found', 404, 'NOT_FOUND');
  }
  await update('User', req.params.id, { isActive: false });
  await q('UPDATE `RefreshToken` SET `revokedAt` = ? WHERE `userId` = ? AND `revokedAt` IS NULL', [new Date(), req.params.id]);
  res.status(204).end();
}));

/* GET /:id/deletable — can this account be removed outright, or only disabled? */
router.get('/:id/deletable', asyncHandler(async (req, res) => {
  if (!(await userIsVisible(req, req.params.id))) throw new AppError('User not found', 404, 'NOT_FOUND');
  const counts = await countUserRefs(req.params.id);
  const blockers = userBlockers(counts);
  res.json({ deletable: blockers.length === 0 && req.params.id !== req.auth.userId, blockers, counts });
}));

/* DELETE /:id/permanent — remove the account for good.
   Only when they've created nothing: `createdById` has no cascade, so deleting
   an active user would orphan every record they made. Anyone who has done work
   should be deactivated (DELETE /:id) instead, which keeps the trail intact. */
router.delete('/:id/permanent', asyncHandler(async (req, res) => {
  if (req.params.id === req.auth.userId) throw new AppError('You cannot delete yourself', 400, 'SELF_DELETE');
  if (!(await userIsVisible(req, req.params.id))) throw new AppError('User not found', 404, 'NOT_FOUND');

  const target = await qOne('SELECT `id`, `username`, `isPlatformAdmin` FROM `User` WHERE `id` = ?', [req.params.id]);
  if (target?.isPlatformAdmin && !req.auth.isPlatformAdmin) {
    throw new AppError('Only a platform admin can remove another platform admin.', 403, 'FORBIDDEN');
  }

  const counts = await countUserRefs(req.params.id);
  const blockers = userBlockers(counts);
  if (blockers.length) {
    throw new AppError(
      `${target?.username ?? 'This user'} has created ${blockers.join(', ')}. Disable the account instead so those records keep their author.`,
      409, 'USER_IN_USE', { blockers, counts }
    );
  }

  await txn(async (tx) => {
    // Rows belonging to the account itself — sessions, memberships, their own
    // notifications and audit trail — go with it.
    for (const t of USER_OWNED_TABLES) {
      await tx.q(`DELETE FROM \`${t}\` WHERE \`userId\` = ?`, [req.params.id]).catch(() => {});
    }
    await tx.q('DELETE FROM `User` WHERE `id` = ?', [req.params.id]);
  });
  res.status(204).end();
}));

/* ---------- memberships ---------- */

// POST /api/users/:id/memberships
router.post('/:id/memberships', asyncHandler(async (req, res) => {
  const data = membershipInputSchema.parse(req.body);

  if (!req.auth.isPlatformAdmin && data.companyId !== req.auth.companyId) {
    throw new AppError('You can only assign users to your active company', 403, 'FORBIDDEN');
  }
  if (!(await userIsVisible(req, req.params.id))) {
    throw new AppError('User not found', 404, 'NOT_FOUND');
  }

  await txn(async (tx) => {
    if (data.isPrimary) {
      await tx.q(
        'UPDATE `Membership` SET `isPrimary` = 0, `updatedAt` = ? WHERE `userId` = ?',
        [new Date(), req.params.id]
      );
    }
    // Upsert by (userId, companyId).
    const existing = await tx.qOne(
      'SELECT `id` FROM `Membership` WHERE `userId` = ? AND `companyId` = ?',
      [req.params.id, data.companyId]
    );
    if (existing) {
      await tx.update('Membership', existing.id, {
        role: data.role,
        permissions: sanitizePermissions(data.permissions),
        isPrimary: !!data.isPrimary,
        isActive: true,
        hideCustomerNames: !!data.hideCustomerNames,
      });
    } else {
      await tx.insert('Membership', {
        userId: req.params.id,
        companyId: data.companyId,
        role: data.role,
        permissions: sanitizePermissions(data.permissions),
        isPrimary: !!data.isPrimary,
        isActive: true,
        hideCustomerNames: !!data.hideCustomerNames,
      });
    }
  });

  const fresh = await loadUserWithMemberships(req.params.id);
  res.status(201).json(publicUser(fresh));
}));

// PATCH /api/users/:id/memberships/:mid
router.patch('/:id/memberships/:mid', asyncHandler(async (req, res) => {
  const data = membershipInputSchema.partial().parse(req.body);

  const m = await qOne('SELECT * FROM `Membership` WHERE `id` = ?', [req.params.mid]);
  if (!m || m.userId !== req.params.id) throw new AppError('Membership not found', 404, 'NOT_FOUND');
  if (!req.auth.isPlatformAdmin && m.companyId !== req.auth.companyId) {
    throw new AppError('Forbidden', 403, 'FORBIDDEN');
  }

  await txn(async (tx) => {
    if (data.isPrimary) {
      await tx.q(
        'UPDATE `Membership` SET `isPrimary` = 0, `updatedAt` = ? WHERE `userId` = ? AND `id` <> ?',
        [new Date(), m.userId, m.id]
      );
    }
    const patch = {};
    if (data.role              !== undefined) patch.role = data.role;
    if (data.permissions       !== undefined) patch.permissions = sanitizePermissions(data.permissions);
    if (data.isPrimary         !== undefined) patch.isPrimary = !!data.isPrimary;
    if (data.hideCustomerNames !== undefined) patch.hideCustomerNames = !!data.hideCustomerNames;
    if (Object.keys(patch).length > 0) await tx.update('Membership', m.id, patch);
  });

  const fresh = await loadUserWithMemberships(m.userId);
  res.json(publicUser(fresh));
}));

// DELETE /api/users/:id/memberships/:mid
router.delete('/:id/memberships/:mid', asyncHandler(async (req, res) => {
  const m = await qOne('SELECT * FROM `Membership` WHERE `id` = ?', [req.params.mid]);
  if (!m || m.userId !== req.params.id) throw new AppError('Membership not found', 404, 'NOT_FOUND');
  if (!req.auth.isPlatformAdmin && m.companyId !== req.auth.companyId) {
    throw new AppError('Forbidden', 403, 'FORBIDDEN');
  }
  await del('Membership', m.id);
  res.status(204).end();
}));

export default router;
