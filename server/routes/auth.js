// Sign-in, refresh, switch-company, logout, me. The whole auth flow lives here.
import { Router } from 'express';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { prisma } from '../lib/db.js';
import { env } from '../lib/env.js';
import { COOKIE_NAMES } from '../lib/constants.js';
import { AppError, asyncHandler } from '../lib/errors.js';
import { authLimiter } from '../lib/rateLimit.js';
import {
  hashPassword,
  verifyPassword,
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  requireAuth,
} from '../lib/auth.js';
import { effectivePermissions, sanitizePermissions } from '../lib/permissions.js';

const router = Router();

const REFRESH_TTL_MS = 15 * 24 * 60 * 60 * 1000; // matches JWT_REFRESH_TTL=15d
const refreshCookieOptions = {
  httpOnly: true,
  secure: env.NODE_ENV === 'production',
  sameSite: 'lax',
  path: '/api/auth',
  maxAge: REFRESH_TTL_MS,
};
const setRefreshCookie = (res, token) => res.cookie(COOKIE_NAMES.REFRESH, token, refreshCookieOptions);

/* ---------- DTO shaping ---------- */
const publicUser = (u) => ({
  id: u.id,
  email: u.email,
  username: u.username,
  name: u.name,
  isPlatformAdmin: u.isPlatformAdmin,
  isActive: u.isActive,
});

const publicMembership = (m) => ({
  id: m.id,
  companyId: m.companyId,
  companyName: m.company?.name,
  companySlug: m.company?.slug,
  companyLogoUrl: m.company?.logoUrl ?? null,
  role: m.role,
  isPrimary: m.isPrimary,
  permissions: effectivePermissions(m.role, sanitizePermissions(m.permissions)),
});

/* ---------- helpers ---------- */
const issueTokens = async ({ user, companyId, role, permissions }) => {
  const jti = uuidv4();
  const accessToken = signAccessToken({
    userId: user.id,
    companyId: companyId ?? null,
    role: role ?? null,
    permissions: effectivePermissions(role, permissions),
    isPlatformAdmin: user.isPlatformAdmin,
  });
  const refreshToken = signRefreshToken({ userId: user.id, jti });
  await prisma.refreshToken.create({
    data: { jti, userId: user.id, expiresAt: new Date(Date.now() + REFRESH_TTL_MS) },
  });
  return { accessToken, refreshToken };
};

const findByIdentifier = (identifier) => {
  const id = identifier.trim();
  return prisma.user.findUnique({
    where: id.includes('@') ? { email: id.toLowerCase() } : { username: id.toLowerCase() },
  });
};

const loadMemberships = (userId) =>
  prisma.membership.findMany({
    where: { userId, isActive: true, company: { isActive: true } },
    include: { company: true },
    orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
  });

const buildAuthPayload = (user, memberships, active) => ({
  user: publicUser(user),
  memberships: memberships.map(publicMembership),
  activeCompanyId: active?.companyId ?? null,
  activeRole: active?.role ?? null,
  activePermissions: active
    ? effectivePermissions(active.role, sanitizePermissions(active.permissions))
    : [],
});

/* ---------- routes ---------- */

// POST /api/auth/login — body: { identifier (email or username), password }
router.post('/login', authLimiter, asyncHandler(async (req, res) => {
  const { identifier, password } = z
    .object({ identifier: z.string().trim().min(1).max(160), password: z.string().min(1) })
    .parse(req.body);

  const user = await findByIdentifier(identifier);
  if (!user || !user.isActive) throw new AppError('Invalid credentials', 401, 'BAD_CREDENTIALS');

  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) throw new AppError('Invalid credentials', 401, 'BAD_CREDENTIALS');

  const memberships = await loadMemberships(user.id);
  const active = memberships[0] ?? null;

  if (!active && !user.isPlatformAdmin) {
    throw new AppError('No active company assigned. Ask your administrator.', 403, 'NO_MEMBERSHIP');
  }

  const tokens = await issueTokens({
    user,
    companyId: active?.companyId,
    role: active?.role,
    permissions: active?.permissions,
  });
  setRefreshCookie(res, tokens.refreshToken);
  res.json({ ...buildAuthPayload(user, memberships, active), accessToken: tokens.accessToken });
}));

// POST /api/auth/refresh — uses the refresh cookie, rotates it.
router.post('/refresh', authLimiter, asyncHandler(async (req, res) => {
  const token = req.cookies?.[COOKIE_NAMES.REFRESH];
  if (!token) throw new AppError('Missing refresh token', 401, 'UNAUTHENTICATED');

  let payload;
  try { payload = verifyRefreshToken(token); }
  catch { throw new AppError('Invalid refresh token', 401, 'UNAUTHENTICATED'); }

  const stored = await prisma.refreshToken.findUnique({ where: { jti: payload.jti } });
  if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
    throw new AppError('Refresh token revoked or expired', 401, 'UNAUTHENTICATED');
  }

  const user = await prisma.user.findUnique({ where: { id: payload.sub } });
  if (!user || !user.isActive) throw new AppError('User no longer active', 401, 'UNAUTHENTICATED');

  const memberships = await loadMemberships(user.id);
  const active = memberships[0] ?? null;

  await prisma.refreshToken.update({ where: { jti: payload.jti }, data: { revokedAt: new Date() } });

  const tokens = await issueTokens({ user, companyId: active?.companyId, role: active?.role });
  setRefreshCookie(res, tokens.refreshToken);
  res.json({ ...buildAuthPayload(user, memberships, active), accessToken: tokens.accessToken });
}));

// POST /api/auth/switch-company — body: { companyId }
router.post('/switch-company', requireAuth, asyncHandler(async (req, res) => {
  const { companyId } = z.object({ companyId: z.string().min(1) }).parse(req.body);

  const user = await prisma.user.findUnique({ where: { id: req.auth.userId } });
  if (!user || !user.isActive) throw new AppError('User no longer active', 401, 'UNAUTHENTICATED');

  const memberships = await loadMemberships(user.id);
  let active = memberships.find((m) => m.companyId === companyId);

  // Platform admin can step into any company, even without a membership.
  if (!active) {
    if (!user.isPlatformAdmin) throw new AppError('Not a member of this company', 403, 'FORBIDDEN');
    const company = await prisma.company.findUnique({ where: { id: companyId } });
    if (!company) throw new AppError('Company not found', 404, 'NOT_FOUND');
    active = { companyId: company.id, role: 'COMPANY_ADMIN', company, permissions: [] };
  }

  const tokens = await issueTokens({
    user,
    companyId: active.companyId,
    role: active.role,
    permissions: active.permissions,
  });
  setRefreshCookie(res, tokens.refreshToken);
  res.json({ ...buildAuthPayload(user, memberships, active), accessToken: tokens.accessToken });
}));

// POST /api/auth/logout — revokes the current refresh token + clears cookie.
router.post('/logout', asyncHandler(async (req, res) => {
  const token = req.cookies?.[COOKIE_NAMES.REFRESH];
  if (token) {
    try {
      const payload = verifyRefreshToken(token);
      await prisma.refreshToken.update({
        where: { jti: payload.jti },
        data: { revokedAt: new Date() },
      });
    } catch { /* ignore — already invalid */ }
  }
  res.clearCookie(COOKIE_NAMES.REFRESH, { path: '/api/auth' });
  res.json({ ok: true });
}));

// GET /api/auth/me — returns the user + their memberships.
router.get('/me', requireAuth, asyncHandler(async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.auth.userId } });
  if (!user) throw new AppError('User not found', 404, 'NOT_FOUND');
  const memberships = await loadMemberships(user.id);
  res.json({ user: publicUser(user), memberships: memberships.map(publicMembership) });
}));

/* ---------- admin helper (used by seed.js, not exposed) ---------- */
export const createUserWithMembership = async ({
  email, username, password, name, isPlatformAdmin = false,
  companyId, role, permissions = [], isPrimary = true,
}) => {
  const passwordHash = await hashPassword(password);
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: { email: email.toLowerCase(), username: username.toLowerCase(), passwordHash, name, isPlatformAdmin },
    });
    if (companyId) {
      await tx.membership.create({
        data: {
          userId: user.id, companyId, role, isPrimary,
          permissions: sanitizePermissions(permissions),
        },
      });
    }
    return user;
  });
};

export default router;
