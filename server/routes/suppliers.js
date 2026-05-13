// Suppliers CRUD — scoped to active company.
import { Router } from 'express';
import { z } from 'zod';
import { q, qOne, insert, update, del } from '../lib/db.js';
import { AppError, asyncHandler } from '../lib/errors.js';
import { requireAuth, requirePermission } from '../lib/auth.js';
import { resolveTenant } from '../lib/tenant.js';

const router = Router();
router.use(requireAuth, resolveTenant);

const idParam = z.object({ id: z.string().min(1) });
const paginationQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(20),
  search: z.string().trim().max(120).optional(),
});

// Split base from transform so `.partial()` is callable on the base for PATCH.
const supplierInputBase = z.object({
  name:      z.string().trim().min(1).max(160),
  email:     z.string().email().optional().nullable().or(z.literal('')),
  phone:     z.string().trim().max(40).optional().nullable(),
  address:   z.string().trim().max(400).optional().nullable(),
  gstNumber: z.string().trim().max(40).optional().nullable(),
  state:     z.string().trim().max(80).optional().nullable(),
  gstRate:   z.coerce.number().min(0).max(100).default(0),
  notes:     z.string().trim().max(2000).optional().nullable(),
});

const normalizeEmail = (v) => ({ ...v, email: v.email === '' ? null : v.email });

const supplierInput        = supplierInputBase.transform(normalizeEmail);
const supplierInputPartial = supplierInputBase.partial().transform(normalizeEmail);

const findOwned = async (req, id) => {
  const item = await qOne(
    'SELECT * FROM `Supplier` WHERE `id` = ? AND `companyId` = ?',
    [id, req.tenant.companyId]
  );
  if (!item) throw new AppError('Supplier not found', 404, 'NOT_FOUND');
  return item;
};

router.get('/', requirePermission('add_supplier'), asyncHandler(async (req, res) => {
  const { page, pageSize, search } = paginationQuery.parse(req.query);
  const skip = (page - 1) * pageSize;

  let where = '`companyId` = ?';
  const params = [req.tenant.companyId];
  if (search) {
    where += ' AND (`name` LIKE ? OR `email` LIKE ? OR `phone` LIKE ? OR `gstNumber` LIKE ?)';
    const like = `%${search}%`;
    params.push(like, like, like, like);
  }

  const [items, totalRow] = await Promise.all([
    q(
      `SELECT * FROM \`Supplier\` WHERE ${where} ORDER BY \`createdAt\` DESC LIMIT ? OFFSET ?`,
      [...params, pageSize, skip]
    ),
    qOne(`SELECT COUNT(*) AS n FROM \`Supplier\` WHERE ${where}`, params),
  ]);
  res.json({ items, total: Number(totalRow?.n ?? 0), page, pageSize });
}));

router.get('/:id', requirePermission('add_supplier'), asyncHandler(async (req, res) => {
  const { id } = idParam.parse(req.params);
  res.json(await findOwned(req, id));
}));

router.post('/', requirePermission('add_supplier'), asyncHandler(async (req, res) => {
  const data = supplierInput.parse(req.body);
  const created = await insert('Supplier', {
    ...data,
    companyId: req.tenant.companyId,
    createdById: req.auth.userId,
  });
  res.status(201).json(created);
}));

router.patch('/:id', requirePermission('add_supplier'), asyncHandler(async (req, res) => {
  const { id } = idParam.parse(req.params);
  const data = supplierInputPartial.parse(req.body);
  await findOwned(req, id);
  res.json(await update('Supplier', id, data));
}));

router.delete('/:id', requirePermission('add_supplier'), asyncHandler(async (req, res) => {
  const { id } = idParam.parse(req.params);
  await findOwned(req, id);
  await del('Supplier', id);
  res.status(204).end();
}));

export default router;
