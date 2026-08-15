// Customers CRUD — scoped to the active company.
import { Router } from 'express';
import { z } from 'zod';
import { q, qOne, insert, update, del, txn } from '../lib/db.js';
import { AppError, asyncHandler } from '../lib/errors.js';
import { requireAuth, requireRole, hashPassword } from '../lib/auth.js';
import { resolveTenant } from '../lib/tenant.js';
import { countCustomerRefs, customerBlockers, deleteDerivedCustomerPayments } from '../lib/customerRefs.js';
import { importBody, cellPick, numOpt, rowIsBlank, errMessage } from '../lib/importHelpers.js';
import { derivePortalPassword, uniqueShortCode } from '../lib/portal.js';
import { normName } from '../lib/invoicing.js';
import { v4 as uuidv4 } from 'uuid';

// Link this customer to any of their sales invoices that were imported without a
// match (customerId NULL) by comparing normalized names, and set the due date
// from the credit terms. Fixes "credit terms missing" on the Sales Register when
// the customer/terms are added after the invoices were imported.
const linkUnmatchedInvoices = async (companyId, customerId, name, dueDays) => {
  try {
    const rows = await q(
      'SELECT `id`, `customerName` FROM `SalesInvoice` WHERE `companyId` = ? AND `customerId` IS NULL AND `customerName` IS NOT NULL',
      [companyId]
    );
    const target = normName(name);
    const ids = rows.filter((r) => normName(r.customerName) === target).map((r) => r.id);
    for (const invId of ids) {
      if (dueDays != null) {
        await q('UPDATE `SalesInvoice` SET `customerId` = ?, `dueDate` = DATE_ADD(`invoiceDate`, INTERVAL ? DAY) WHERE `id` = ?', [customerId, dueDays, invId]);
      } else {
        await q('UPDATE `SalesInvoice` SET `customerId` = ? WHERE `id` = ?', [customerId, invId]);
      }
    }
    return ids.length;
  } catch { return 0; }
};

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

// portalPasswordHash is an internal secret — never ship it to the client. The
// short code, plaintext initial password and "set" flag are fine for the admin
// UI (it needs them to build the shareable message).
const publicCustomer = (row) => {
  if (!row) return row;
  // eslint-disable-next-line no-unused-vars
  const { portalPasswordHash, ...rest } = row;
  return rest;
};

// Rejects a customer that would duplicate an existing one in this company by
// name (case-insensitive) or GST number. `excludeId` skips the row being edited.
const assertNoDuplicate = async (req, { name, gstNumber }, excludeId = null) => {
  const companyId = req.tenant.companyId;
  if (name) {
    const clash = await qOne(
      `SELECT \`name\` FROM \`Customer\`
        WHERE \`companyId\` = ? AND LOWER(\`name\`) = LOWER(?)${excludeId ? ' AND `id` <> ?' : ''}
        LIMIT 1`,
      excludeId ? [companyId, name, excludeId] : [companyId, name]
    );
    if (clash) {
      throw new AppError(
        `A customer named "${clash.name}" already exists.`,
        409, 'NAME_DUPLICATE'
      );
    }
  }
  const gst = typeof gstNumber === 'string' ? gstNumber.trim() : gstNumber;
  if (gst) {
    const clash = await qOne(
      `SELECT \`name\`, \`gstNumber\` FROM \`Customer\`
        WHERE \`companyId\` = ? AND UPPER(\`gstNumber\`) = UPPER(?)${excludeId ? ' AND `id` <> ?' : ''}
        LIMIT 1`,
      excludeId ? [companyId, gst, excludeId] : [companyId, gst]
    );
    if (clash) {
      throw new AppError(
        `GST number ${clash.gstNumber} is already registered to "${clash.name}".`,
        409, 'GST_DUPLICATE'
      );
    }
  }
};

// The portal credentials bundle for a brand-new customer: a derived initial
// password (stored hashed + plaintext for re-share) and a unique short code.
const provisionPortalCredentials = async (data) => {
  const initial = derivePortalPassword(data);
  return {
    portalPasswordHash: await hashPassword(initial),
    portalInitialPassword: initial,
    portalPasswordSet: 0,
    portalShortCode: await uniqueShortCode(),
  };
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

  res.json({ items: items.map(publicCustomer), total: Number(totalRow?.n ?? 0), page, pageSize });
}));

// GET /api/customers/:id
router.get('/:id', asyncHandler(async (req, res) => {
  const { id } = idParam.parse(req.params);
  res.json(publicCustomer(await findOwned(req, id)));
}));

// POST /api/customers
router.post('/', requireRole('STAFF'), asyncHandler(async (req, res) => {
  const data = customerInput.parse(req.body);

  // No two customers in a company may share a name or GST number.
  await assertNoDuplicate(req, data);

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
  const portal = await provisionPortalCredentials(data);
  const created = await insert('Customer', {
    id: customerId,
    ...data,
    customerCode,
    shareToken,
    ...portal,
    companyId: req.tenant.companyId,
    createdById: req.auth.userId,
  });
  // Adopt any invoices imported for this name before the customer existed.
  await linkUnmatchedInvoices(req.tenant.companyId, customerId, data.name, data.dueDays ?? null);
  res.status(201).json(publicCustomer(created));
}));

// PATCH /api/customers/:id
router.patch('/:id', requireRole('STAFF'), asyncHandler(async (req, res) => {
  const { id } = idParam.parse(req.params);
  const data = customerInputPartial.parse(req.body);
  const existing = await findOwned(req, id);

  // Block a rename / GST change that would collide with another customer.
  await assertNoDuplicate(
    req,
    {
      name: data.name && data.name !== existing.name ? data.name : null,
      gstNumber:
        data.gstNumber !== undefined && data.gstNumber !== existing.gstNumber
          ? data.gstNumber
          : null,
    },
    id
  );

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

  // While the customer is still on the auto-generated initial password (they
  // haven't picked their own yet), keep it in step with the details it's
  // derived from — so the shareable message always shows a password that works.
  if (!existing.portalPasswordSet) {
    const nameChanged = data.name && data.name !== existing.name;
    const gstChanged = data.gstNumber !== undefined && data.gstNumber !== existing.gstNumber;
    if (nameChanged || gstChanged) {
      const initial = derivePortalPassword({
        name: data.name ?? existing.name,
        gstNumber: data.gstNumber !== undefined ? data.gstNumber : existing.gstNumber,
        phone: data.phone !== undefined ? data.phone : existing.phone,
      });
      data.portalPasswordHash = await hashPassword(initial);
      data.portalInitialPassword = initial;
    }
  }

  // Backfill a short code for legacy rows that predate portal auth.
  if (!existing.portalShortCode) data.portalShortCode = await uniqueShortCode(id);

  const updated = await update('Customer', id, data);

  // Credit terms drive invoice due dates. Recompute this customer's invoice due
  // dates from the terms on EVERY save that carries a dueDays value — not only
  // when the number changed. Otherwise re-saving unchanged terms never fixes
  // invoices whose dueDate is stale/missing (e.g. imported after the terms were
  // first set, or linked before a due date existed), which showed up as "the
  // credit terms don't resync for this party". dueDate = invoiceDate + dueDays.
  if (data.dueDays != null) {
    try {
      await q(
        'UPDATE `SalesInvoice` SET `dueDate` = DATE_ADD(`invoiceDate`, INTERVAL ? DAY) WHERE `companyId` = ? AND `customerId` = ?',
        [data.dueDays, req.tenant.companyId, id]
      );
    } catch { /* SalesInvoice table absent on minimal installs — ignore */ }
  }

  // Keep the name shown on this customer's invoices in step with the rename.
  if (data.name && data.name !== existing.name) {
    try {
      await q(
        'UPDATE `SalesInvoice` SET `customerName` = ? WHERE `companyId` = ? AND `customerId` = ?',
        [data.name, req.tenant.companyId, id]
      );
    } catch { /* ignore */ }
  }

  // Adopt any still-unmatched invoices for this name and stamp their due dates.
  await linkUnmatchedInvoices(
    req.tenant.companyId, id,
    data.name ?? existing.name,
    data.dueDays !== undefined ? data.dueDays : existing.dueDays,
  );

  res.json(publicCustomer(updated));
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
        const portal = await provisionPortalCredentials(data);
        await insert('Customer', {
          id: uuidv4(),
          ...data,
          customerCode,
          shareToken: await uniqueShareToken(name),
          ...portal,
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
// Refuses while anything still points at the customer, naming exactly what, so
// nothing is orphaned and the caller gets a readable reason instead of an FK error.
router.delete('/:id', requireRole('MANAGER'), asyncHandler(async (req, res) => {
  const { id } = idParam.parse(req.params);
  const cust = await findOwned(req, id);
  const counts = await countCustomerRefs(id);
  const blockers = customerBlockers(counts);
  if (blockers.length) {
    throw new AppError(
      `${cust?.name ?? 'This customer'} still has ${blockers.join(', ')}. Delete or reassign those first.`,
      409, 'CUSTOMER_IN_USE', { blockers, counts }
    );
  }
  await txn(async (tx) => {
    // Sweep the cash-book's own unallocated payments for this party — they are
    // derived state, not records anyone entered.
    await deleteDerivedCustomerPayments(tx, id);
    await tx.q('DELETE FROM `Customer` WHERE `id` = ?', [id]);
  });
  res.status(204).end();
}));

/* GET /:id/deletable — what (if anything) is blocking deletion. */
router.get('/:id/deletable', asyncHandler(async (req, res) => {
  const { id } = idParam.parse(req.params);
  await findOwned(req, id);
  const counts = await countCustomerRefs(id);
  const blockers = customerBlockers(counts);
  res.json({ deletable: blockers.length === 0, blockers, counts });
}));

/* POST /:id/convert-to-expense — reclassify a head that was never a customer.
   Salary, rent, freight and the like get tagged "Customer" on the Unclassified
   screen during a bank-book import; with no sales invoices to net against, a
   payment to them then surfaces on Amount Receivable as "Advance / On account".
   This removes the Customer record AND remembers the head as an expense
   category, so the Cashbook Summary groups it correctly and the next import
   doesn't ask again. Blocked if anything sales-side references the customer —
   a sale can't become an expense. */
router.post('/:id/convert-to-expense', requireRole('MANAGER'), asyncHandler(async (req, res) => {
  const { id } = idParam.parse(req.params);
  const { category } = z.object({
    category: z.string().trim().min(1).max(120).default('Expense'),
  }).parse(req.body ?? {});
  const companyId = req.tenant.companyId;
  const cust = await findOwned(req, id);
  if (!cust) throw new AppError('Customer not found', 404, 'NOT_FOUND');

  const counts = await countCustomerRefs(id);
  const blockers = customerBlockers(counts);
  if (blockers.length) {
    throw new AppError(
      `${cust.name} still has ${blockers.join(', ')}. An expense head can't carry sales transactions — clear or reassign those first.`,
      409, 'CUSTOMER_IN_USE', { blockers, counts }
    );
  }

  const normKey = normName(cust.name);
  if (!normKey) throw new AppError('Invalid customer name', 400, 'BAD_NAME');

  const head = await txn(async (tx) => {
    const existing = await tx.qOne(
      'SELECT `id` FROM `AccountHead` WHERE `companyId` = ? AND `normKey` = ?', [companyId, normKey]
    );
    if (existing) {
      await tx.q(
        "UPDATE `AccountHead` SET `name` = ?, `type` = 'OTHER', `category` = ?, `updatedAt` = CURRENT_TIMESTAMP(3) WHERE `id` = ?",
        [cust.name, category, existing.id]
      );
    } else {
      await tx.insert('AccountHead', {
        companyId, name: cust.name, normKey, type: 'OTHER', category,
      });
    }
    await deleteDerivedCustomerPayments(tx, id);
    await tx.q('DELETE FROM `Customer` WHERE `id` = ?', [id]);
    return { name: cust.name, category };
  });

  res.json({ ok: true, ...head });
}));

/* POST /:id/convert-to-supplier — reclassify a mistakenly-created customer as a
   supplier. Carries over all details; BLOCKS if the customer has any sales
   transactions so nothing financial is ever silently reinterpreted. */
router.post('/:id/convert-to-supplier', requireRole('COMPANY_ADMIN'), asyncHandler(async (req, res) => {
  const { id } = idParam.parse(req.params);
  const companyId = req.tenant.companyId;
  const cust = await qOne('SELECT * FROM `Customer` WHERE `id` = ? AND `companyId` = ?', [id, companyId]);
  if (!cust) throw new AppError('Customer not found', 404, 'NOT_FOUND');
  const nk = normName(cust.name);

  // Block on any customer-side transaction (matched by id or normalized name).
  const [poN, retN, siRows, payRows] = await Promise.all([
    qOne('SELECT COUNT(*) n FROM `PoOrder` WHERE `customerId` = ? AND `companyId` = ?', [id, companyId]),
    qOne('SELECT COUNT(*) n FROM `Return` WHERE `customerId` = ? AND `companyId` = ?', [id, companyId]).catch(() => ({ n: 0 })),
    q('SELECT `customerId`, `customerName` FROM `SalesInvoice` WHERE `companyId` = ?', [companyId]).catch(() => []),
    q('SELECT `customerId`, `customerName` FROM `Payment` WHERE `companyId` = ?', [companyId]).catch(() => []),
  ]);
  const siN = siRows.filter((r) => r.customerId === id || normName(r.customerName) === nk).length;
  const payN = payRows.filter((r) => r.customerId === id || normName(r.customerName) === nk).length;
  const blockers = [];
  if (Number(poN?.n) > 0) blockers.push(`${poN.n} sales order(s)`);
  if (siN > 0) blockers.push(`${siN} sales invoice(s)`);
  if (payN > 0) blockers.push(`${payN} receipt(s)`);
  if (Number(retN?.n) > 0) blockers.push(`${retN.n} return(s)`);
  if (blockers.length) {
    throw new AppError(`Can't convert — this customer has ${blockers.join(', ')}. A sale can't become a purchase, so clear or reassign these first.`, 400, 'HAS_TRANSACTIONS');
  }

  // Don't create a duplicate of an existing supplier in this company.
  const dupe = await qOne(
    `SELECT s.\`id\` FROM \`Supplier\` s INNER JOIN \`SupplierMembership\` sm ON sm.\`supplierId\` = s.\`id\`
      WHERE sm.\`companyId\` = ? AND s.\`name\` = ?`, [companyId, cust.name]);
  if (dupe) throw new AppError('A supplier with this exact name already exists in this company.', 409, 'DUPLICATE');

  const supplier = await txn(async (tx) => {
    const created = await tx.insert('Supplier', {
      name: cust.name, email: cust.email ?? null, phone: cust.phone ?? null, address: cust.address ?? null,
      gstNumber: cust.gstNumber ?? null, gstRate: cust.gstRate ?? 0, state: cust.state ?? null,
      dueDays: cust.dueDays ?? null, notes: cust.notes ?? null,
      companyId, createdById: req.auth.userId,
    });
    await tx.insert('SupplierMembership', { supplierId: created.id, companyId });
    await tx.q('DELETE FROM `Customer` WHERE `id` = ?', [id]);
    return created;
  });
  res.json({ ok: true, supplierId: supplier.id, name: cust.name });
}));

export default router;
