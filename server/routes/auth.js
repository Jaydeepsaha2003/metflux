// Sign-in, refresh, switch-company, logout, me. The whole auth flow lives here.
//
// Migrated off Prisma — uses raw mysql2 via lib/db.js helpers.
import { Router } from 'express';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { q, qOne, insert, txn } from '../lib/db.js';
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
import { clientIp, parseDevice, geoLookup } from '../lib/session.js';
import { sendToUser } from '../lib/push.js';

// Push a "new sign-in" alert to every company admin when a non-admin staff
// member logs in. Fire-and-forget — never blocks or fails the login.
const notifyAdminsOfLogin = async (companyId, user, meta) => {
  try {
    const admins = await q(
      `SELECT DISTINCT u.\`id\` AS id FROM \`User\` u
         INNER JOIN \`Membership\` m ON m.\`userId\` = u.\`id\`
        WHERE m.\`companyId\` = ? AND m.\`role\` = 'COMPANY_ADMIN'
          AND m.\`isActive\` = 1 AND u.\`isActive\` = 1 AND u.\`id\` <> ?`,
      [companyId, user.id]
    );
    if (!admins.length) return;
    const detail = [meta.device, meta.ip].filter(Boolean).join(' · ');
    const payload = {
      title: 'New sign-in',
      body: `${user.name} signed in${detail ? ` — ${detail}` : ''}`,
      url: '/s/admin/settings/user-logs',
      tag: 'login',
    };
    await Promise.all(admins.map((a) => sendToUser(a.id, payload)));
  } catch { /* ignore */ }
};

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

/* ---------- helpers — JSON column handling ----------
   mysql2 returns JSON columns already parsed when the column type is JSON,
   but only when the driver knows it. To be safe we coerce strings here. */
const parseJson = (v) => {
  if (v == null) return null;
  if (typeof v === 'string') {
    try { return JSON.parse(v); } catch { return null; }
  }
  return v;
};

/* ---------- DTO shaping ---------- */
const publicUser = (u) => ({
  id: u.id,
  email: u.email,
  username: u.username,
  name: u.name,
  isPlatformAdmin: !!u.isPlatformAdmin,
  isActive: !!u.isActive,
});

const publicMembership = (m) => ({
  id: m.id,
  companyId: m.companyId,
  companyName: m.company?.name,
  companySlug: m.company?.slug,
  // Send a URL pointer, NOT the base64 data URL — embedding logos here bloated
  // every auth response (login/refresh/switch) to hundreds of KB. The browser
  // fetches + caches the image once via this endpoint instead.
  companyLogoUrl: m.company?.logoUrl ? `/api/public/company-logo/${m.companyId}` : null,
  role: m.role,
  isPrimary: !!m.isPrimary,
  hideCustomerNames: !!m.hideCustomerNames,
  permissions: effectivePermissions(m.role, sanitizePermissions(parseJson(m.permissions))),
});

/* ---------- DB helpers ---------- */

// Finds a user row by email OR username (case-insensitive comparison handled
// at the application layer since the columns are stored already-lowercased
// by the create flow). Returns the raw row or null.
const findByIdentifier = (identifier) => {
  const id = identifier.trim();
  if (id.includes('@')) {
    return qOne('SELECT * FROM `User` WHERE `email` = ?', [id.toLowerCase()]);
  }
  return qOne('SELECT * FROM `User` WHERE `username` = ?', [id.toLowerCase()]);
};

// Returns memberships for the user joined with their company, sorted with
// the primary one first then by creation date. Each row has a nested
// `company: { id, name, slug, logoUrl, isActive }` for the DTO shaper.
const loadMemberships = async (userId) => {
  const rows = await q(
    `SELECT
       m.\`id\`           AS id,
       m.\`userId\`       AS userId,
       m.\`companyId\`    AS companyId,
       m.\`role\`         AS role,
       m.\`permissions\`  AS permissions,
       m.\`isPrimary\`    AS isPrimary,
       m.\`isActive\`     AS isActive,
       m.\`hideCustomerNames\` AS hideCustomerNames,
       m.\`createdAt\`    AS createdAt,
       m.\`updatedAt\`    AS updatedAt,
       c.\`id\`           AS c_id,
       c.\`name\`         AS c_name,
       c.\`slug\`         AS c_slug,
       c.\`logoUrl\`      AS c_logoUrl,
       c.\`isActive\`     AS c_isActive
     FROM \`Membership\` m
     INNER JOIN \`Company\` c ON c.\`id\` = m.\`companyId\`
     WHERE m.\`userId\` = ? AND m.\`isActive\` = 1 AND c.\`isActive\` = 1
     ORDER BY m.\`isPrimary\` DESC, m.\`createdAt\` ASC`,
    [userId]
  );
  return rows.map((r) => ({
    id: r.id,
    userId: r.userId,
    companyId: r.companyId,
    role: r.role,
    permissions: parseJson(r.permissions),
    isPrimary: !!r.isPrimary,
    isActive: !!r.isActive,
    hideCustomerNames: !!r.hideCustomerNames,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    company: {
      id: r.c_id,
      name: r.c_name,
      slug: r.c_slug,
      logoUrl: r.c_logoUrl,
      isActive: !!r.c_isActive,
    },
  }));
};

// Session metadata off the request (login / refresh / switch all pass this so
// the RefreshToken row doubles as the User-Logs session record).
const reqMeta = (req) => ({
  ip: clientIp(req),
  userAgent: (req.headers['user-agent'] || '').slice(0, 400) || null,
  device: parseDevice(req.headers['user-agent']),
});

const issueTokens = async ({ user, companyId, role, permissions, meta = {} }) => {
  const jti = uuidv4();
  const accessToken = signAccessToken({
    userId: user.id,
    companyId: companyId ?? null,
    role: role ?? null,
    permissions: effectivePermissions(role, permissions),
    isPlatformAdmin: user.isPlatformAdmin,
  });
  const refreshToken = signRefreshToken({ userId: user.id, jti, companyId: companyId ?? null });
  const now = new Date();
  // RefreshToken uses jti as PK, not id — bypass the insert() helper.
  await q(
    'INSERT INTO `RefreshToken` (`jti`, `userId`, `expiresAt`, `ip`, `userAgent`, `device`, `location`, `loginAt`, `lastUsedAt`) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [jti, user.id, new Date(Date.now() + REFRESH_TTL_MS),
      meta.ip ?? null, meta.userAgent ?? null, meta.device ?? null, meta.location ?? null,
      meta.loginAt ?? now, now],
  );
  return { accessToken, refreshToken, jti };
};

const buildAuthPayload = (user, memberships, active) => ({
  user: publicUser(user),
  memberships: memberships.map(publicMembership),
  activeCompanyId: active?.companyId ?? null,
  activeRole: active?.role ?? null,
  activePermissions: active
    ? effectivePermissions(active.role, sanitizePermissions(parseJson(active.permissions)))
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

  const meta = { ...reqMeta(req), loginAt: new Date() };
  const tokens = await issueTokens({
    user,
    companyId: active?.companyId,
    role: active?.role,
    permissions: active?.permissions,
    meta,
  });
  setRefreshCookie(res, tokens.refreshToken);
  res.json({ ...buildAuthPayload(user, memberships, active), accessToken: tokens.accessToken });

  // Best-effort location — never blocks the login response.
  if (meta.ip) {
    geoLookup(meta.ip)
      .then((loc) => { if (loc) return q('UPDATE `RefreshToken` SET `location` = ? WHERE `jti` = ?', [loc, tokens.jti]); })
      .catch(() => {});
  }

  // Alert company admins on staff (non-admin) sign-ins.
  const isAdminLogin = !!user.isPlatformAdmin || active?.role === 'COMPANY_ADMIN';
  if (active?.companyId && !isAdminLogin) notifyAdminsOfLogin(active.companyId, user, meta);
}));

// POST /api/auth/refresh — uses the refresh cookie, rotates it.
router.post('/refresh', authLimiter, asyncHandler(async (req, res) => {
  const token = req.cookies?.[COOKIE_NAMES.REFRESH];
  if (!token) throw new AppError('Missing refresh token', 401, 'UNAUTHENTICATED');

  let payload;
  try { payload = verifyRefreshToken(token); }
  catch { throw new AppError('Invalid refresh token', 401, 'UNAUTHENTICATED'); }

  const stored = await qOne('SELECT * FROM `RefreshToken` WHERE `jti` = ?', [payload.jti]);
  if (!stored || stored.revokedAt || new Date(stored.expiresAt) < new Date()) {
    throw new AppError('Refresh token revoked or expired', 401, 'UNAUTHENTICATED');
  }

  const user = await qOne('SELECT * FROM `User` WHERE `id` = ?', [payload.sub]);
  if (!user || !user.isActive) throw new AppError('User no longer active', 401, 'UNAUTHENTICATED');

  const memberships = await loadMemberships(user.id);
  // Restore the company the token was issued for (set on login / switch), so a
  // reload keeps the selected company instead of reverting to the primary one.
  let active = payload.cid ? memberships.find((m) => m.companyId === payload.cid) : null;
  if (!active && payload.cid && user.isPlatformAdmin) {
    // Platform admin who had stepped into a non-member company — restore it.
    const company = await qOne('SELECT * FROM `Company` WHERE `id` = ?', [payload.cid]);
    if (company) active = { companyId: company.id, role: 'COMPANY_ADMIN', company, permissions: [] };
  }
  if (!active) active = memberships[0] ?? null;

  await q(
    'UPDATE `RefreshToken` SET `revokedAt` = ? WHERE `jti` = ?',
    [new Date(), payload.jti]
  );

  // Carry the session identity (device / ip / location / original login time)
  // forward across the rotation so the User-Logs entry stays stable.
  const meta = {
    ip: stored.ip ?? clientIp(req),
    userAgent: stored.userAgent ?? ((req.headers['user-agent'] || '').slice(0, 400) || null),
    device: stored.device ?? parseDevice(req.headers['user-agent']),
    location: stored.location ?? null,
    loginAt: stored.loginAt ?? stored.createdAt ?? new Date(),
  };
  const tokens = await issueTokens({
    user,
    companyId: active?.companyId,
    role: active?.role,
    permissions: active?.permissions,
    meta,
  });
  setRefreshCookie(res, tokens.refreshToken);
  res.json({ ...buildAuthPayload(user, memberships, active), accessToken: tokens.accessToken });
}));

// POST /api/auth/switch-company — body: { companyId }
router.post('/switch-company', requireAuth, asyncHandler(async (req, res) => {
  const { companyId } = z.object({ companyId: z.string().min(1) }).parse(req.body);

  const user = await qOne('SELECT * FROM `User` WHERE `id` = ?', [req.auth.userId]);
  if (!user || !user.isActive) throw new AppError('User no longer active', 401, 'UNAUTHENTICATED');

  const memberships = await loadMemberships(user.id);
  let active = memberships.find((m) => m.companyId === companyId);

  // Platform admin can step into any company, even without a membership.
  if (!active) {
    if (!user.isPlatformAdmin) throw new AppError('Not a member of this company', 403, 'FORBIDDEN');
    const company = await qOne('SELECT * FROM `Company` WHERE `id` = ?', [companyId]);
    if (!company) throw new AppError('Company not found', 404, 'NOT_FOUND');
    active = { companyId: company.id, role: 'COMPANY_ADMIN', company, permissions: [] };
  }

  // Same device continuing — carry the session forward and revoke the old
  // refresh token so switching companies doesn't leave a stale active session.
  let carried = {};
  const oldToken = req.cookies?.[COOKIE_NAMES.REFRESH];
  if (oldToken) {
    try {
      const p = verifyRefreshToken(oldToken);
      const st = await qOne('SELECT * FROM `RefreshToken` WHERE `jti` = ?', [p.jti]);
      if (st) {
        carried = { ip: st.ip, userAgent: st.userAgent, device: st.device, location: st.location, loginAt: st.loginAt ?? st.createdAt };
        await q('UPDATE `RefreshToken` SET `revokedAt` = ? WHERE `jti` = ?', [new Date(), p.jti]);
      }
    } catch { /* ignore */ }
  }
  const meta = {
    ip: carried.ip ?? clientIp(req),
    userAgent: carried.userAgent ?? ((req.headers['user-agent'] || '').slice(0, 400) || null),
    device: carried.device ?? parseDevice(req.headers['user-agent']),
    location: carried.location ?? null,
    loginAt: carried.loginAt ?? new Date(),
  };
  const tokens = await issueTokens({
    user,
    companyId: active.companyId,
    role: active.role,
    permissions: active.permissions,
    meta,
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
      await q(
        'UPDATE `RefreshToken` SET `revokedAt` = ? WHERE `jti` = ?',
        [new Date(), payload.jti]
      );
    } catch { /* ignore — already invalid */ }
  }
  res.clearCookie(COOKIE_NAMES.REFRESH, { path: '/api/auth' });
  res.json({ ok: true });
}));

// GET /api/auth/me — returns the user + their memberships.
router.get('/me', requireAuth, asyncHandler(async (req, res) => {
  const user = await qOne('SELECT * FROM `User` WHERE `id` = ?', [req.auth.userId]);
  if (!user) throw new AppError('User not found', 404, 'NOT_FOUND');
  const memberships = await loadMemberships(user.id);
  res.json({ user: publicUser(user), memberships: memberships.map(publicMembership) });
}));

/* ---------- User Logs — active login sessions (company admin only) ---------- */
const requireAdmin = (req) => {
  if (!(req.auth?.isPlatformAdmin || req.auth?.role === 'COMPANY_ADMIN')) {
    throw new AppError('Forbidden', 403, 'FORBIDDEN');
  }
};

// GET /api/auth/sessions — active sessions for users in the active company.
router.get('/sessions', requireAuth, asyncHandler(async (req, res) => {
  requireAdmin(req);
  let currentJti = null;
  const ck = req.cookies?.[COOKIE_NAMES.REFRESH];
  if (ck) { try { currentJti = verifyRefreshToken(ck).jti; } catch { /* ignore */ } }

  const now = new Date();
  const companyId = req.auth.companyId;
  const rows = (req.auth.isPlatformAdmin && !companyId)
    ? await q(
        `SELECT r.*, u.\`username\` AS username, u.\`name\` AS name, u.\`email\` AS email
           FROM \`RefreshToken\` r INNER JOIN \`User\` u ON u.\`id\` = r.\`userId\`
          WHERE r.\`revokedAt\` IS NULL AND r.\`expiresAt\` > ?
          ORDER BY r.\`lastUsedAt\` DESC`, [now])
    : await q(
        `SELECT r.*, u.\`username\` AS username, u.\`name\` AS name, u.\`email\` AS email
           FROM \`RefreshToken\` r
           INNER JOIN \`User\` u ON u.\`id\` = r.\`userId\`
           INNER JOIN \`Membership\` m ON m.\`userId\` = r.\`userId\` AND m.\`companyId\` = ?
          WHERE r.\`revokedAt\` IS NULL AND r.\`expiresAt\` > ?
          GROUP BY r.\`jti\`
          ORDER BY r.\`lastUsedAt\` DESC`, [companyId, now]);

  res.json({
    items: rows.map((r) => ({
      jti: r.jti, userId: r.userId, username: r.username, name: r.name,
      ip: r.ip ?? null, device: r.device ?? null, location: r.location ?? null,
      loginAt: r.loginAt ?? r.createdAt, lastUsedAt: r.lastUsedAt ?? null, expiresAt: r.expiresAt,
      current: r.jti === currentJti,
    })),
  });
}));

// POST /api/auth/sessions/:jti/revoke — force-logout a device.
router.post('/sessions/:jti/revoke', requireAuth, asyncHandler(async (req, res) => {
  requireAdmin(req);
  const st = await qOne('SELECT `jti`, `userId` FROM `RefreshToken` WHERE `jti` = ?', [req.params.jti]);
  if (!st) throw new AppError('Session not found', 404, 'NOT_FOUND');
  if (!req.auth.isPlatformAdmin) {
    const m = await qOne('SELECT `id` FROM `Membership` WHERE `userId` = ? AND `companyId` = ?', [st.userId, req.auth.companyId]);
    if (!m) throw new AppError('Forbidden', 403, 'FORBIDDEN');
  }
  await q('UPDATE `RefreshToken` SET `revokedAt` = ? WHERE `jti` = ?', [new Date(), req.params.jti]);
  res.json({ ok: true });
}));

/* ---------- admin helper (used by seed.js, not exposed) ---------- */
export const createUserWithMembership = async ({
  email, username, password, name, isPlatformAdmin = false,
  companyId, role, permissions = [], isPrimary = true,
}) => {
  const passwordHash = await hashPassword(password);
  return txn(async (tx) => {
    const user = await tx.insert('User', {
      email: email.toLowerCase(),
      username: username.toLowerCase(),
      passwordHash,
      name,
      isPlatformAdmin: !!isPlatformAdmin,
    });
    if (companyId) {
      await tx.insert('Membership', {
        userId: user.id,
        companyId,
        role,
        isPrimary: !!isPrimary,
        permissions: sanitizePermissions(permissions),
      });
    }
    return user;
  });
};

export default router;
