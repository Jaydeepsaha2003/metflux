// Customer-wise rate card — what a given customer pays for a given grade, so
// booking a Sales Order can fill the rate in rather than relying on memory.
//
// A row is keyed on customer + grade, with core type as an optional
// refinement: '' means "any core type of this grade". Lookup prefers the
// specific row and falls back to the blank one, so a customer can have one
// rate for CRGO 27M4 generally and a different one for the rectangular cores.
import { Router } from 'express';
import { z } from 'zod';
import { q, qOne, insert, update, del } from '../lib/db.js';
import { AppError, asyncHandler } from '../lib/errors.js';
import { requireAuth, requirePermission } from '../lib/auth.js';
import { resolveTenant } from '../lib/tenant.js';

const router = Router();
router.use(requireAuth, resolveTenant);

const CORE_TYPES = ['TOROIDAL', 'RECTANGULAR', 'NANO', 'COMPOSITE', 'CUT_ROUND', 'CUT_RECT'];

const bodySchema = z.object({
  customerId: z.string().min(1),
  grade:      z.string().trim().min(1).max(120),
  // '' (or omitted) = applies to every core type of this grade.
  coreType:   z.enum(['', ...CORE_TYPES]).optional().default(''),
  rateBasis:  z.enum(['PER_KG', 'PER_PCS']).default('PER_KG'),
  rateValue:  z.coerce.number().positive(),
  notes:      z.string().trim().max(255).optional().nullable(),
});

/* GET /api/customer-rates?customerId=&search=
   The whole card, newest-priced first within a customer. */
router.get('/', requirePermission('view_po'), asyncHandler(async (req, res) => {
  const { customerId, search } = z.object({
    customerId: z.string().min(1).optional(),
    search:     z.string().trim().max(120).optional(),
  }).parse(req.query);

  let where = 'r.`companyId` = ?';
  const params = [req.tenant.companyId];
  if (customerId) { where += ' AND r.`customerId` = ?'; params.push(customerId); }
  if (search) {
    const like = `%${search}%`;
    where += ' AND (c.`name` LIKE ? OR c.`customerCode` LIKE ? OR r.`grade` LIKE ?)';
    params.push(like, like, like);
  }

  const rows = await q(
    `SELECT r.*, c.\`name\` AS customerName, c.\`customerCode\` AS customerCode
       FROM \`CustomerRate\` r
       INNER JOIN \`Customer\` c ON c.\`id\` = r.\`customerId\`
      WHERE ${where}
      ORDER BY c.\`name\` ASC, r.\`grade\` ASC, r.\`coreType\` ASC`,
    params
  );
  res.json({ items: rows });
}));

/* GET /api/customer-rates/lookup?customerId=&grade=&coreType=
   The one rate the booking form should fill in. Specific core type wins over
   the blanket row; nothing found is a normal answer, not an error — plenty of
   customer/grade pairs simply have no agreed rate yet. */
router.get('/lookup', requirePermission('view_po'), asyncHandler(async (req, res) => {
  const { customerId, grade, coreType } = z.object({
    customerId: z.string().min(1),
    grade:      z.string().trim().min(1),
    coreType:   z.enum(['', ...CORE_TYPES]).optional().default(''),
  }).parse(req.query);

  // ORDER BY puts the exact core-type match first ('' sorts after any real
  // value here because the CASE ranks it), so one row comes back either way.
  const row = await qOne(
    `SELECT * FROM \`CustomerRate\`
      WHERE \`companyId\` = ? AND \`customerId\` = ? AND \`grade\` = ?
        AND \`coreType\` IN (?, '')
      ORDER BY CASE WHEN \`coreType\` = '' THEN 1 ELSE 0 END
      LIMIT 1`,
    [req.tenant.companyId, customerId, grade, coreType]
  );
  res.json({
    rate: row
      ? { id: row.id, rateBasis: row.rateBasis, rateValue: Number(row.rateValue), coreType: row.coreType, grade: row.grade }
      : null,
  });
}));

const ensureCustomer = async (companyId, customerId) => {
  const cust = await qOne(
    'SELECT `id` FROM `Customer` WHERE `id` = ? AND `companyId` = ?',
    [customerId, companyId]
  );
  if (!cust) throw new AppError('Customer not found', 404, 'NOT_FOUND');
};

/* POST /api/customer-rates — create or overwrite the rate for this scope.
   Upsert rather than insert: the booking screen offers to save a changed rate,
   and that should update the customer's rate instead of failing on the unique
   key the second time the same grade is priced. */
router.post('/', requirePermission('add_po'), asyncHandler(async (req, res) => {
  const data = bodySchema.parse(req.body);
  await ensureCustomer(req.tenant.companyId, data.customerId);

  const existing = await qOne(
    'SELECT `id` FROM `CustomerRate` WHERE `companyId` = ? AND `customerId` = ? AND `grade` = ? AND `coreType` = ?',
    [req.tenant.companyId, data.customerId, data.grade, data.coreType]
  );
  if (existing) {
    await update('CustomerRate', existing.id, {
      rateBasis: data.rateBasis, rateValue: data.rateValue, notes: data.notes ?? null, updatedAt: new Date(),
    });
    const row = await qOne('SELECT * FROM `CustomerRate` WHERE `id` = ?', [existing.id]);
    return res.json(row);
  }
  const created = await insert('CustomerRate', {
    companyId:  req.tenant.companyId,
    customerId: data.customerId,
    grade:      data.grade,
    coreType:   data.coreType,
    rateBasis:  data.rateBasis,
    rateValue:  data.rateValue,
    notes:      data.notes ?? null,
  });
  res.status(201).json(created);
}));

/* PATCH /api/customer-rates/:id */
router.patch('/:id', requirePermission('add_po'), asyncHandler(async (req, res) => {
  const row = await qOne(
    'SELECT * FROM `CustomerRate` WHERE `id` = ? AND `companyId` = ?',
    [req.params.id, req.tenant.companyId]
  );
  if (!row) throw new AppError('Rate not found', 404, 'NOT_FOUND');

  const data = bodySchema.partial().parse(req.body);
  if (data.customerId) await ensureCustomer(req.tenant.companyId, data.customerId);

  const next = {
    customerId: data.customerId ?? row.customerId,
    grade:      data.grade      ?? row.grade,
    coreType:   data.coreType   ?? row.coreType,
  };
  // Moving a row onto a scope that already has a rate would break the unique
  // key with a 500; catch it here and say what actually happened.
  const clash = await qOne(
    'SELECT `id` FROM `CustomerRate` WHERE `companyId` = ? AND `customerId` = ? AND `grade` = ? AND `coreType` = ? AND `id` <> ?',
    [req.tenant.companyId, next.customerId, next.grade, next.coreType, row.id]
  );
  if (clash) throw new AppError('This customer already has a rate for that grade and core type.', 409, 'RATE_EXISTS');

  await update('CustomerRate', row.id, {
    ...next,
    rateBasis: data.rateBasis ?? row.rateBasis,
    rateValue: data.rateValue ?? row.rateValue,
    notes:     data.notes !== undefined ? data.notes : row.notes,
    updatedAt: new Date(),
  });
  res.json(await qOne('SELECT * FROM `CustomerRate` WHERE `id` = ?', [row.id]));
}));

/* DELETE /api/customer-rates/:id */
router.delete('/:id', requirePermission('add_po'), asyncHandler(async (req, res) => {
  const row = await qOne(
    'SELECT `id` FROM `CustomerRate` WHERE `id` = ? AND `companyId` = ?',
    [req.params.id, req.tenant.companyId]
  );
  if (!row) throw new AppError('Rate not found', 404, 'NOT_FOUND');
  await del('CustomerRate', row.id);
  res.status(204).end();
}));

export default router;
