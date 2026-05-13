// Customers CRUD — scoped to the active company.
import { Router } from 'express';
import { z } from 'zod';
import { q, qOne, insert, update, del } from '../lib/db.js';
import { AppError, asyncHandler } from '../lib/errors.js';
import { requireAuth, requireRole } from '../lib/auth.js';
import { resolveTenant } from '../lib/tenant.js';

const router = Router();

router.use(requireAuth, resolveTenant);

const idParam = z.object({ id: z.string().min(1) });
const paginationQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(20),
  search: z.string().trim().max(120).optional(),
});
// Split the base object schema from the transform: zod's `.partial()` is only
// defined on ZodObject, not on ZodEffects (what `.transform()` returns). So
// the create/patch routes each apply the transform after deciding whether to
// partial the base.
const customerInputBase = z.object({
  name: z.string().trim().min(1).max(160),
  email: z.string().email().optional().nullable().or(z.literal('')),
  phone: z.string().trim().max(40).optional().nullable(),
  address: z.string().trim().max(400).optional().nullable(),
  gstNumber: z.string().trim().max(40).optional().nullable(),
  gstRate: z.coerce.number().min(0).max(100).optional(),
  state: z.string().trim().max(80).optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
});

const normalizeEmail = (v) => ({ ...v, email: v.email === '' ? null : v.email });

const customerInput        = customerInputBase.transform(normalizeEmail);
const customerInputPartial = customerInputBase.partial().transform(normalizeEmail);

// Ensures the row belongs to the active tenant — used before update/delete.
const findOwned = async (req, id) => {
  const item = await qOne(
    'SELECT * FROM `Customer` WHERE `id` = ? AND `companyId` = ?',
    [id, req.tenant.companyId]
  );
  if (!item) throw new AppError('Customer not found', 404, 'NOT_FOUND');
  return item;
};

// GET /api/customers
router.get('/', asyncHandler(async (req, res) => {
  const { page, pageSize, search } = paginationQuery.parse(req.query);
  const skip = (page - 1) * pageSize;

  let where = '`companyId` = ?';
  const params = [req.tenant.companyId];
  if (search) {
    where += ' AND (`name` LIKE ? OR `email` LIKE ? OR `phone` LIKE ?)';
    const like = `%${search}%`;
    params.push(like, like, like);
  }

  const [items, totalRow] = await Promise.all([
    q(
      `SELECT * FROM \`Customer\` WHERE ${where} ORDER BY \`createdAt\` DESC LIMIT ? OFFSET ?`,
      [...params, pageSize, skip]
    ),
    qOne(`SELECT COUNT(*) AS n FROM \`Customer\` WHERE ${where}`, params),
  ]);

  res.json({ items, total: Number(totalRow?.n ?? 0), page, pageSize });
}));

// GET /api/customers/:id
router.get('/:id', asyncHandler(async (req, res) => {
  const { id } = idParam.parse(req.params);
  res.json(await findOwned(req, id));
}));

// POST /api/customers
router.post('/', requireRole('STAFF'), asyncHandler(async (req, res) => {
  const data = customerInput.parse(req.body);
  const created = await insert('Customer', {
    ...data,
    companyId: req.tenant.companyId,
    createdById: req.auth.userId,
  });
  res.status(201).json(created);
}));

// PATCH /api/customers/:id
router.patch('/:id', requireRole('STAFF'), asyncHandler(async (req, res) => {
  const { id } = idParam.parse(req.params);
  const data = customerInputPartial.parse(req.body);
  await findOwned(req, id);
  res.json(await update('Customer', id, data));
}));

// DELETE /api/customers/:id — managers and up
router.delete('/:id', requireRole('MANAGER'), asyncHandler(async (req, res) => {
  const { id } = idParam.parse(req.params);
  await findOwned(req, id);
  await del('Customer', id);
  res.status(204).end();
}));

export default router;
