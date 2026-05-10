// Authentication helpers — passwords, JWTs, route guards. Used by routes/auth.js
// for sign-in/refresh and as middleware on every protected route.
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { env } from './env.js';
import { AppError } from './errors.js';
import { ROLE_RANK } from './constants.js';

const BCRYPT_ROUNDS = 12;

/* ----- passwords ----- */
export const hashPassword = (plain) => bcrypt.hash(plain, BCRYPT_ROUNDS);
export const verifyPassword = (plain, hash) => bcrypt.compare(plain, hash);

/* ----- JWT ----- */
export const signAccessToken = ({ userId, companyId, role, permissions, isPlatformAdmin }) =>
  jwt.sign(
    {
      sub: userId,
      cid: companyId ?? null,
      role: role ?? null,
      perms: Array.isArray(permissions) ? permissions : [],
      pa: !!isPlatformAdmin,
    },
    env.JWT_ACCESS_SECRET,
    { expiresIn: env.JWT_ACCESS_TTL }
  );

export const signRefreshToken = ({ userId, jti }) =>
  jwt.sign({ sub: userId, jti }, env.JWT_REFRESH_SECRET, {
    expiresIn: env.JWT_REFRESH_TTL,
  });

export const verifyAccessToken = (token) => jwt.verify(token, env.JWT_ACCESS_SECRET);
export const verifyRefreshToken = (token) => jwt.verify(token, env.JWT_REFRESH_SECRET);

/* ----- middleware ----- */

// Attaches `req.auth = { userId, companyId, role, permissions, isPlatformAdmin }`
// if the request carries a valid Bearer access token. Throws 401 otherwise.
export const requireAuth = (req, _res, next) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) throw new AppError('Missing access token', 401, 'UNAUTHENTICATED');
  try {
    const payload = verifyAccessToken(token);
    req.auth = {
      userId: payload.sub,
      companyId: payload.cid ?? null,
      role: payload.role ?? null,
      permissions: Array.isArray(payload.perms) ? payload.perms : [],
      isPlatformAdmin: !!payload.pa,
    };
    next();
  } catch {
    throw new AppError('Invalid or expired token', 401, 'UNAUTHENTICATED');
  }
};

// Role gate within the active company. Platform admins always pass.
export const requireRole = (minRole) => (req, _res, next) => {
  if (req.auth?.isPlatformAdmin) return next();
  const have = ROLE_RANK[req.auth?.role] ?? 0;
  const need = ROLE_RANK[minRole] ?? Infinity;
  if (have < need) throw new AppError('Forbidden', 403, 'FORBIDDEN');
  next();
};

// Permission gate — usage: requirePermission('add_po').
// Platform admins + COMPANY_ADMIN always pass.
export const requirePermission = (key) => (req, _res, next) => {
  if (req.auth?.isPlatformAdmin) return next();
  if (req.auth?.role === 'COMPANY_ADMIN') return next();
  const perms = req.auth?.permissions ?? [];
  if (!perms.includes(key)) throw new AppError('Forbidden', 403, 'FORBIDDEN', { permission: key });
  next();
};

// Same as requirePermission but passes when ANY of the keys match. Use when one
// shared endpoint is reachable from multiple feature areas (e.g. the labour
// dropdown is needed by both Production and Work Allotment).
export const requireAnyPermission = (...keys) => (req, _res, next) => {
  if (req.auth?.isPlatformAdmin) return next();
  if (req.auth?.role === 'COMPANY_ADMIN') return next();
  const perms = req.auth?.permissions ?? [];
  if (!keys.some((k) => perms.includes(k))) {
    throw new AppError('Forbidden', 403, 'FORBIDDEN', { permission: keys });
  }
  next();
};
