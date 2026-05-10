// Per-company role enum. Platform-wide privileges live on User.isPlatformAdmin.
export const ROLES = Object.freeze({
  COMPANY_ADMIN: 'COMPANY_ADMIN',
  MANAGER: 'MANAGER',
  STAFF: 'STAFF',
});

export const ROLE_RANK = Object.freeze({
  STAFF: 1,
  MANAGER: 2,
  COMPANY_ADMIN: 3,
});

export const COOKIE_NAMES = Object.freeze({
  REFRESH: 'mflx_refresh',
});
