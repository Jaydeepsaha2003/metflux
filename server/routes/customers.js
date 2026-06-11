// Customers CRUD — scoped to the active company.
import { Router } from 'express';
import { z } from 'zod';
import { q, qOne, insert, update, del } from '../lib/db.js';
import { AppError, asyncHandler } from '../lib/errors.js';
import { requireAuth, requireRole } from '../lib/auth.js';
import { resolveTenant } from '../lib/tenant.js';
import { importBody, cellPick, numOpt, rowIsBlank, errMessage } from '../lib/importHelpers.js';
import { v4 as uuidv4 } from 'uuid';

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
  customerCode: z.string().trim().max(40).optional().nullable(),
  name: z.string().trim().min(1).max(160),
  email: z.string().email().optional().nullable().or(z.literal('')),
  phone: z.string().trim().max(40).optional().nullable(),
  address: z.string().trim().max(400).optional().nullable(),
  gstNumber: z.string().trim().max(40).optional().nullable(),
  gstRate: z.coerce.number().min(0).max(100).optional(),
  state: z.string().trim().max(80).optional().nullable(),
  // Credit terms — payment due `dueDays` days after the invoice date. NULL =
  // not set (Sales Invoices flags those). Coerced from the form's string input.
  dueDays: z.coerce.number().int().min(0).max(3650).optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
});

const normalizeEmail = (v) => ({ ...v, email: v.email === '' ? null : v.email });
const cleanCode = (v) => (typeof v === 'string' ? v.trim().toUpperCase() : v);

const customerInput        = customerInputBase.transform(normalizeEmail);
const customerInputPartial = customerInputBase.partial().transform(normalizeEmail);

/** First 3 alpha chars of name, padded with X. "AARTI STEELS" → "AAR". */
const prefixFromName = (name) => {
  const letters = String(name ?? '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3);
  return (letters + 'XXX').slice(0, 3);
};

/** URL-safe slug from a customer name. "M/S LAN Engineering & Tech." → "m-s-lan-engineering-tech". */
const slugifyName = (name) => {
  const s = String(name ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
  return s || 'customer';
};

/** A globally-unique shareToken from the name slug. shareToken is the public
    portal lookup key, so it must be unique across ALL customers. On a clash we
    append -2, -3, … */
const uniqueShareToken = async (name, excludeId = null) => {
  const base = slugifyName(name);
  let candidate = base;
  let n = 1;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const clash = await qOne(
      `SELECT \`id\` FROM \`Customer\` WHERE \`shareToken\` = ?${excludeId ? ' AND `id` <> ?' : ''}`,
      excludeId ? [candidate, excludeId] : [candidate]
    );
    if (!clash) return candidate;
    n += 1;
    candidate = `${base}-${n}`;
  }
};

/** Next free "XYZ-NNN" code for the given prefix in this company. */
const nextCustomerCode = async (companyId, prefix) => {
  const rows = await q(
    'SELECT `customerCode` FROM `Customer` WHERE `companyId` = ? AND `customerCode` LIKE ?',
    [companyId, `${prefix}-%`]
  );
  let max = 0;
  for (const r of rows) {
    const m = /-(\d+)$/.exec(r.customerCode ?? '');
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `${prefix}-${String(max + 1).padStart(3, '0')}`;
};

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

  // Resolve the customer code: prefer client-supplied; auto-generate otherwise.
  let customerCode = cleanCode(data.customerCode);
  if (!customerCode) {
    customerCode = await nextCustomerCode(req.tenant.companyId, prefixFromName(data.name));
  } else {
    const dup = await qOne(
      'SELECT `id` FROM `Customer` WHERE `companyId` = ? AND `customerCode` = ?',
      [req.tenant.companyId, customerCode]
    );
    if (dup) throw new AppError('Customer code already in use', 409, 'CODE_DUPLICATE');
  }

  // The public portal URL uses a readable slug of the customer name
  // (e.g. /portal/aarti-steels) rather than the raw UUID. Kept globally unique.
  const customerId = uuidv4();
  const shareToken = await uniqueShareToken(data.name);
  const created = await insert('Customer', {
    id: customerId,
    ...data,
    customerCode,
    shareToken,
    companyId: req.tenant.companyId,
    createdById: req.auth.userId,
  });
  res.status(201).json(created);
}));

// PATCH /api/customers/:id
router.patch('/:id', requireRole('STAFF'), asyncHandler(async (req, res) => {
  const { id } = idParam.parse(req.params);
  const data = customerInputPartial.parse(req.body);
  const existing = await findOwned(req, id);

  if (data.customerCode !== undefined) {
    const cleaned = cleanCode(data.customerCode);
    if (!cleaned) throw new AppError('Customer code is required', 400, 'CODE_BLANK');
    if (cleaned !== existing.customerCode) {
      const dup = await qOne(
        'SELECT `id` FROM `Customer` WHERE `companyId` = ? AND `customerCode` = ? AND `id` <> ?',
        [req.tenant.companyId, cleaned, id]
      );
      if (dup) throw new AppError('Customer code already in use', 409, 'CODE_DUPLICATE');
    }
    data.customerCode = cleaned;
  }

  // Keep the portal slug in sync when the name changes (regenerate, unique).
  // Old UUID-based links still resolve — the portal looks up by token OR id.
  if (data.name && data.name !== existing.name) {
    data.shareToken = await uniqueShareToken(data.name, id);
  }

  res.json(await update('Customer', id, data));
}));

// POST /api/customers/import — bulk create/update from an Excel upload.
// Matches an existing customer by Customer Code (if given) else by name. Only
// columns present (non-blank) in a row are written, so a sparse sheet won't
// wipe existing fields. Per-row errors are collected; the rest still import.
router.post('/import', requireRole('STAFF'), asyncHandler(async (req, res) => {
  const { rows } = importBody.parse(req.body);
  let created = 0, updated = 0, skipped = 0;
  const errors = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNo = i + 2; // sheet row (header is row 1)
    if (rowIsBlank(row)) { skipped++; continue; }

    const name = cellPick(row, 'Name', 'Customer Name', 'Particulars');
    if (!name) { errors.push({ row: rowNo, message: 'Missing Name' }); continue; }

    // Build a patch of only the columns the sheet actually provides.
    const raw = {
      name,
      phone:     cellPick(row, 'Phone', 'Mobile', 'Contact'),
      email:     cellPick(row, 'Email', 'E-mail'),
      state:     cellPick(row, 'State'),
      gstNumber: cellPick(row, 'GSTIN', 'GST Number', 'GST No', 'GST'),
      gstRate:   numOpt(cellPick(row, 'GST Rate', 'GST Rate (%)', 'GST %')),
      dueDays:   numOpt(cellPick(row, 'Credit Terms (Days)', 'Credit Terms', 'Due Days', 'Credit Days')),
      address:   cellPick(row, 'Address'),
      notes:     cellPick(row, 'Notes', 'Remarks'),
    };
    const code = cellPick(row, 'Customer Code', 'Code');
    const fields = Object.fromEntries(Object.entries(raw).filter(([, v]) => v !== undefined));
    if (fields.dueDays !== undefined) fields.dueDays = Math.max(0, Math.round(fields.dueDays));

    try {
      const data = customerInputBase.partial().parse(fields);
      if (data.email === '') data.email = null;

      let existing = null;
      if (code) {
        existing = await qOne(
          'SELECT * FROM `Customer` WHERE `companyId` = ? AND `customerCode` = ?',
          [req.tenant.companyId, cleanCode(code)]
        );
      }
      if (!existing) {
        existing = await qOne(
          'SELECT * FROM `Customer` WHERE `companyId` = ? AND LOWER(`name`) = LOWER(?)',
          [req.tenant.companyId, name]
        );
      }

      if (existing) {
        const patch = { ...data };
        if (name !== existing.name) patch.shareToken = await uniqueShareToken(name, existing.id);
        await update('Customer', existing.id, patch);
        updated += 1;
      } else {
        const customerCode = code
          ? cleanCode(code)
          : await nextCustomerCode(req.tenant.companyId, prefixFromName(name));
        await insert('Customer', {
          id: uuidv4(),
          ...data,
          customerCode,
          shareToken: await uniqueShareToken(name),
          companyId: req.tenant.companyId,
          createdById: req.auth.userId,
        });
        created += 1;
      }
    } catch (e) {
      errors.push({ row: rowNo, name, message: errMessage(e) });
    }
  }

  res.json({ created, updated, skipped, errors });
}));

// DELETE /api/customers/:id — managers and up
router.delete('/:id', requireRole('MANAGER'), asyncHandler(async (req, res) => {
  const { id } = idParam.parse(req.params);
  await findOwned(req, id);
  await del('Customer', id);
  res.status(204).end();
}));

export default router;
