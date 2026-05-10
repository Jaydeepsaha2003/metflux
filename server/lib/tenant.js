// Resolves the active company (tenant) from the JWT and attaches it to req.
// Every tenant-scoped query should filter via tenantWhere(req, …).
import { AppError } from './errors.js';

export const resolveTenant = (req, _res, next) => {
  if (!req.auth) throw new AppError('Auth required before tenant', 500, 'INTERNAL');
  let companyId = req.auth.companyId;

  // Platform admins may inspect any company by sending X-Company-Id.
  if (req.auth.isPlatformAdmin) {
    const override = req.header('x-company-id') || req.query.companyId;
    if (override) companyId = String(override);
  }
  if (!companyId) {
    throw new AppError(
      'No active company. Switch to a company first via POST /api/auth/switch-company.',
      400,
      'NO_TENANT'
    );
  }
  req.tenant = { companyId };
  next();
};

export const tenantWhere = (req, extra = {}) => ({
  companyId: req.tenant.companyId,
  ...extra,
});
