// Suppliers — a Supplier record can be shared across many companies via
// SupplierMembership, mirroring the Labour ⇄ LabourMembership pattern.
// Tenant scoping is done through that join table, NOT Supplier.companyId.
import { Router } from 'express';
import { z } from 'zod';
import { q, qOne, txn, update } from '../lib/db.js';
import { AppError, asyncHandler } from '../lib/errors.js';
import { requireAuth, requirePermission, requireRole } from '../lib/auth.js';
import { resolveTenant } from '../lib/tenant.js';
import { countSupplierRefs, supplierBlockers } from '../lib/supplierRefs.js';
import { importBody, cellPick, numOpt, rowIsBlank, errMessage } from '../lib/importHelpers.js';
import { normName } from '../lib/invoicing.js';

const router = Router();
router.use(requireAuth, resolveTenant);

/** First 3 alpha chars of a name, padded — mirrors the Customers module. */
const prefixFromName = (name) => (String(name ?? '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3) + 'XXX').slice(0, 3);
/** Next free "XYZ-NNN" customer code for a prefix in this company. */
const nextCustomerCode = async (companyId, prefix) => {
  const rows = await q('SELECT `customerCode` FROM `Customer` WHERE `companyId` = ? AND `customerCode` LIKE ?', [companyId, `${prefix}-%`]);
  let max = 0;
  for (const r of rows) { const m = /-(\d+)$/.exec(r.customerCode ?? ''); if (m) max = Math.max(max, parseInt(m[1], 10)); }
  return `${prefix}-${String(max + 1).padStart(3, '0')}`;
};

const idParam = z.object({ id: z.string().min(1) });
const paginationQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(20),
  search: z.string().trim().max(120).optional(),
});

// Base supplier fields (no company info — that lives in SupplierMembership).
const supplierFieldsBase = z.object({
  name:      z.string().trim().min(1).max(160),
  email:     z.string().email().optional().nullable().or(z.literal('')),
  phone:     z.string().trim().max(40).optional().nullable(),
  address:   z.string().trim().max(400).optional().nullable(),
  gstNumber: z.string().trim().max(40).optional().nullable(),
  state:     z.string().trim().max(80).optional().nullable(),
  gstRate:   z.coerce.number().min(0).max(100).default(0),
  // Credit terms — days allowed to pay after the bill date. Drives Amount Payable aging.
  dueDays:   z.coerce.number().int().min(0).max(3650).optional().nullable(),
  notes:     z.string().trim().max(2000).optional().nullable(),
});

const createSchema = supplierFieldsBase.extend({
  companyIds: z.array(z.string()).min(1, 'Assign to at least one company'),
});

const updateSchema = supplierFieldsBase.partial().extend({
  companyIds: z.array(z.string()).min(1).optional(),
});

const normalizeEmail = (v) => ({ ...v, email: v.email === '' ? null : v.email });

// Returns the membership rows for a supplier in the shape the client wants:
// { id, supplierId, companyId, createdAt, company: {id, name} }
const loadCompanies = async (supplierId) => {
  const rows = await q(
    `SELECT sm.\`id\` AS sm_id, sm.\`supplierId\`, sm.\`companyId\`, sm.\`createdAt\`,
            c.\`id\` AS c_id, c.\`name\` AS c_name
       FROM \`SupplierMembership\` sm
       INNER JOIN \`Company\` c ON c.\`id\` = sm.\`companyId\`
      WHERE sm.\`supplierId\` = ?`,
    [supplierId]
  );
  return rows.map((r) => ({
    id: r.sm_id,
    supplierId: r.supplierId,
    companyId: r.companyId,
    createdAt: r.createdAt,
    company: { id: r.c_id, name: r.c_name },
  }));
};

const withCompanies = async (supplier) => {
  if (!supplier) return supplier;
  return { ...supplier, companies: await loadCompanies(supplier.id) };
};

// True iff the supplier is a member of the active tenant.
const isSupplierInTenant = (supplierId, companyId) => qOne(
  'SELECT `id` FROM `SupplierMembership` WHERE `supplierId` = ? AND `companyId` = ?',
  [supplierId, companyId]
);

/* GET / — suppliers visible to the active company */
router.get('/', requirePermission('add_supplier'), asyncHandler(async (req, res) => {
  const { page, pageSize, search } = paginationQuery.parse(req.query);
  const skip = (page - 1) * pageSize;

  let where = 'sm.`companyId` = ?';
  const params = [req.tenant.companyId];
  if (search) {
    where += ' AND (s.`name` LIKE ? OR s.`email` LIKE ? OR s.`phone` LIKE ? OR s.`gstNumber` LIKE ?)';
    const like = `%${search}%`;
    params.push(like, like, like, like);
  }

  const [rows, totalRow] = await Promise.all([
    q(
      `SELECT DISTINCT s.* FROM \`Supplier\` s
         INNER JOIN \`SupplierMembership\` sm ON sm.\`supplierId\` = s.\`id\`
        WHERE ${where} ORDER BY s.\`createdAt\` DESC LIMIT ? OFFSET ?`,
      [...params, pageSize, skip]
    ),
    qOne(
      `SELECT COUNT(DISTINCT s.\`id\`) AS n FROM \`Supplier\` s
         INNER JOIN \`SupplierMembership\` sm ON sm.\`supplierId\` = s.\`id\`
        WHERE ${where}`,
      params
    ),
  ]);

  const items = await Promise.all(rows.map(withCompanies));
  res.json({ items, total: Number(totalRow?.n ?? 0), page, pageSize });
}));

/* GET /:id */
router.get('/:id', requirePermission('add_supplier'), asyncHandler(async (req, res) => {
  const { id } = idParam.parse(req.params);
  const sm = await isSupplierInTenant(id, req.tenant.companyId);
  if (!sm) throw new AppError('Supplier not found', 404, 'NOT_FOUND');
  const supplier = await qOne('SELECT * FROM `Supplier` WHERE `id` = ?', [id]);
  if (!supplier) throw new AppError('Supplier not found', 404, 'NOT_FOUND');
  res.json(await withCompanies(supplier));
}));

/* POST / — create + assign to companies */
router.post('/', requirePermission('add_supplier'), asyncHandler(async (req, res) => {
  const data = normalizeEmail(createSchema.parse(req.body));
  const { companyIds, ...fields } = data;

  // Must include the active company so the creator can see the new supplier.
  const ids = [...new Set([...companyIds, req.tenant.companyId])];

  const supplier = await txn(async (tx) => {
    const created = await tx.insert('Supplier', {
      ...fields,
      // companyId column is legacy — set to the active tenant for backfill
      // safety, but the application no longer reads it.
      companyId:    req.tenant.companyId,
      createdById:  req.auth.userId,
    });
    for (const cid of ids) {
      await tx.insert('SupplierMembership', { supplierId: created.id, companyId: cid });
    }
    return created;
  });

  res.status(201).json(await withCompanies(supplier));
}));

/* PATCH /:id */
router.patch('/:id', requirePermission('add_supplier'), asyncHandler(async (req, res) => {
  const { id } = idParam.parse(req.params);
  const sm = await isSupplierInTenant(id, req.tenant.companyId);
  if (!sm) throw new AppError('Supplier not found', 404, 'NOT_FOUND');

  const data = normalizeEmail(updateSchema.parse(req.body));
  const { companyIds, ...fields } = data;

  const supplier = await txn(async (tx) => {
    if (companyIds !== undefined) {
      // Always include the active tenant in the new list so the user can't
      // accidentally lock themselves out of the supplier they just edited.
      const ids = [...new Set([...companyIds, req.tenant.companyId])];
      await tx.q('DELETE FROM `SupplierMembership` WHERE `supplierId` = ?', [id]);
      for (const cid of ids) {
        await tx.insert('SupplierMembership', { supplierId: id, companyId: cid });
      }
    }
    if (Object.keys(fields).length) await tx.update('Supplier', id, fields);
    return tx.qOne('SELECT * FROM `Supplier` WHERE `id` = ?', [id]);
  });

  res.json(await withCompanies(supplier));
}));

/* POST /import — bulk create/update suppliers from an Excel upload. Matches an
   existing supplier (in this company) by name; new ones are created and joined
   to the active company. Only provided columns are written. */
router.post('/import', requirePermission('add_supplier'), asyncHandler(async (req, res) => {
  const { rows } = importBody.parse(req.body);
  let created = 0, updated = 0, skipped = 0;
  const errors = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNo = i + 2;
    if (rowIsBlank(row)) { skipped++; continue; }

    const name = cellPick(row, 'Name', 'Supplier Name');
    if (!name) { errors.push({ row: rowNo, message: 'Missing Name' }); continue; }

    const raw = {
      name,
      phone:     cellPick(row, 'Phone', 'Mobile', 'Contact'),
      email:     cellPick(row, 'Email', 'E-mail'),
      state:     cellPick(row, 'State'),
      gstNumber: cellPick(row, 'GSTIN', 'GST Number', 'GST No', 'GST'),
      gstRate:   numOpt(cellPick(row, 'GST Rate', 'GST Rate (%)', 'GST %')),
      address:   cellPick(row, 'Address'),
      notes:     cellPick(row, 'Notes', 'Remarks'),
    };
    const fields = Object.fromEntries(Object.entries(raw).filter(([, v]) => v !== undefined));

    try {
      const data = supplierFieldsBase.partial().parse(fields);
      if (data.email === '') data.email = null;

      const existing = await qOne(
        `SELECT s.* FROM \`Supplier\` s
           INNER JOIN \`SupplierMembership\` sm ON sm.\`supplierId\` = s.\`id\`
          WHERE sm.\`companyId\` = ? AND LOWER(s.\`name\`) = LOWER(?) LIMIT 1`,
        [req.tenant.companyId, name]
      );

      if (existing) {
        if (Object.keys(data).length) await update('Supplier', existing.id, data);
        updated += 1;
      } else {
        await txn(async (tx) => {
          const s = await tx.insert('Supplier', {
            ...data,
            companyId: req.tenant.companyId,
            createdById: req.auth.userId,
          });
          await tx.insert('SupplierMembership', { supplierId: s.id, companyId: req.tenant.companyId });
        });
        created += 1;
      }
    } catch (e) {
      errors.push({ row: rowNo, name, message: errMessage(e) });
    }
  }

  res.json({ created, updated, skipped, errors });
}));

/* DELETE /:id — removes the supplier and all its memberships */
// Refuses while any purchase transaction still points at the supplier, naming
// exactly what. A Supplier row is shared between companies, so this drops only
// THIS company's membership; the row itself goes only once nobody else uses it.
router.delete('/:id', requirePermission('add_supplier'), asyncHandler(async (req, res) => {
  const { id } = idParam.parse(req.params);
  const companyId = req.tenant.companyId;
  const sm = await isSupplierInTenant(id, companyId);
  if (!sm) throw new AppError('Supplier not found', 404, 'NOT_FOUND');
  const sup = await qOne('SELECT `id`, `name` FROM `Supplier` WHERE `id` = ?', [id]);

  const counts = await countSupplierRefs(id, companyId, sup?.name ?? '');
  const blockers = supplierBlockers(counts);
  if (blockers.length) {
    throw new AppError(
      `${sup?.name ?? 'This supplier'} still has ${blockers.join(', ')}. Delete or reassign those first.`,
      409, 'SUPPLIER_IN_USE', { blockers, counts }
    );
  }

  await txn(async (tx) => {
    await tx.q('DELETE FROM `SupplierMembership` WHERE `supplierId` = ? AND `companyId` = ?', [id, companyId]);
    const left = await tx.q('SELECT `companyId` FROM `SupplierMembership` WHERE `supplierId` = ?', [id]);
    if (!left.length) await tx.q('DELETE FROM `Supplier` WHERE `id` = ?', [id]);
  });
  res.json({ removedFromCompany: true, stillUsedByOtherCompanies: counts.otherCompanies });
}));

/* GET /:id/deletable — what (if anything) is blocking removal. */
router.get('/:id/deletable', asyncHandler(async (req, res) => {
  const { id } = idParam.parse(req.params);
  const companyId = req.tenant.companyId;
  if (!(await isSupplierInTenant(id, companyId))) throw new AppError('Supplier not found', 404, 'NOT_FOUND');
  const sup = await qOne('SELECT `name` FROM `Supplier` WHERE `id` = ?', [id]);
  const counts = await countSupplierRefs(id, companyId, sup?.name ?? '');
  const blockers = supplierBlockers(counts);
  res.json({ deletable: blockers.length === 0, blockers, counts, otherCompanies: counts.otherCompanies });
}));

/* POST /:id/convert-to-customer — reclassify a mistakenly-created supplier as a
   customer. Carries over all details + assigns a customer code; BLOCKS if the
   supplier has any purchase transactions, or is shared with other companies. */
router.post('/:id/convert-to-customer', requireRole('COMPANY_ADMIN'), asyncHandler(async (req, res) => {
  const { id } = idParam.parse(req.params);
  const companyId = req.tenant.companyId;
  const sup = await qOne('SELECT * FROM `Supplier` WHERE `id` = ?', [id]);
  const inTenant = await isSupplierInTenant(id, companyId);
  if (!sup || !inTenant) throw new AppError('Supplier not found', 404, 'NOT_FOUND');
  const nk = normName(sup.name);

  // A Supplier record is shared across companies — only convert one that lives
  // in this company alone, so other companies aren't affected by the delete.
  const memberships = await q('SELECT `companyId` FROM `SupplierMembership` WHERE `supplierId` = ?', [id]);
  if (memberships.length > 1) {
    throw new AppError("Can't convert — this supplier is shared with other companies. Remove it from those companies first.", 400, 'SHARED');
  }

  // Block on any purchase-side transaction (name-based, plus PO by id).
  const [poN, piRows, spRows] = await Promise.all([
    qOne('SELECT COUNT(*) n FROM `SupplierOrder` WHERE `supplierId` = ? AND `companyId` = ?', [id, companyId]).catch(() => ({ n: 0 })),
    q('SELECT `supplierName` FROM `PurchaseInvoice` WHERE `companyId` = ?', [companyId]).catch(() => []),
    q('SELECT `supplierName` FROM `SupplierPayment` WHERE `companyId` = ?', [companyId]).catch(() => []),
  ]);
  const piN = piRows.filter((r) => normName(r.supplierName) === nk).length;
  const spN = spRows.filter((r) => normName(r.supplierName) === nk).length;
  const blockers = [];
  if (Number(poN?.n) > 0) blockers.push(`${poN.n} purchase order(s)`);
  if (piN > 0) blockers.push(`${piN} purchase bill(s)`);
  if (spN > 0) blockers.push(`${spN} payment(s)`);
  if (blockers.length) {
    throw new AppError(`Can't convert — this supplier has ${blockers.join(', ')}. A purchase can't become a sale, so clear or reassign these first.`, 400, 'HAS_TRANSACTIONS');
  }

  const dupe = await qOne('SELECT `id` FROM `Customer` WHERE `companyId` = ? AND `name` = ?', [companyId, sup.name]);
  if (dupe) throw new AppError('A customer with this exact name already exists in this company.', 409, 'DUPLICATE');

  const customer = await txn(async (tx) => {
    const created = await tx.insert('Customer', {
      customerCode: await nextCustomerCode(companyId, prefixFromName(sup.name)),
      name: sup.name, email: sup.email ?? null, phone: sup.phone ?? null, address: sup.address ?? null,
      gstNumber: sup.gstNumber ?? null, gstRate: sup.gstRate ?? 0, state: sup.state ?? null,
      dueDays: sup.dueDays ?? null, notes: sup.notes ?? null,
      companyId, createdById: req.auth.userId,
    });
    await tx.q('DELETE FROM `SupplierMembership` WHERE `supplierId` = ?', [id]);
    await tx.q('DELETE FROM `Supplier` WHERE `id` = ?', [id]);
    return created;
  });
  res.json({ ok: true, customerId: customer.id, name: sup.name });
}));

export default router;
