// Quotations — standalone sales-quote documents. Structurally identical to a
// Sales Order (same item fields, same rate derivation) but a separate document
// with its own MEI/SQ/n/FY number and PDF print. A quotation touches nothing
// downstream (no production / dispatch / accounts) until it is *converted*, at
// which point a real PoOrder (Sales Order) is created from it.
import { Router } from 'express';
import { z } from 'zod';
import { q, qOne, insert, update, txn, del } from '../lib/db.js';
import { AppError, asyncHandler } from '../lib/errors.js';
import { requireAuth, requireAnyPermission } from '../lib/auth.js';
import { resolveTenant } from '../lib/tenant.js';
import { logAudit } from '../lib/audit.js';
import { notifyCompanyAdmins } from '../lib/push.js';

const router = Router();
router.use(requireAuth, resolveTenant);

/* Reuse the exact SO item shape + rate derivation, plus quotation-only
   print fields (HSN/SAC + unit of measure). */
const itemSchema = z.object({
  coreType: z.enum(['TOROIDAL', 'RECTANGULAR', 'NANO', 'COMPOSITE']),
  // grade / measure / dimensions are optional so a MANUAL line (free-text
  // description + qty + rate, no core spec) can be quoted when an item isn't in
  // the catalogue. Calculated items still send them all.
  grade: z.string().trim().max(80).optional().default(''),
  material: z.string().trim().min(1).max(120),
  measure: z.string().trim().max(160).optional().default(''),
  hsnCode: z.string().trim().max(20).optional().nullable(),
  unit: z.string().trim().max(20).optional().nullable(),
  id1: z.coerce.number().nonnegative().optional().default(0),
  id2: z.coerce.number().nonnegative().optional().nullable(),
  od1: z.coerce.number().nonnegative().optional().default(0),
  od2: z.coerce.number().nonnegative().optional().nullable(),
  ht: z.coerce.number().nonnegative().optional().default(0),
  builtup: z.coerce.number().nonnegative().optional().nullable(),
  weightPerPc: z.coerce.number().nonnegative().optional().default(0),
  // pcs / turns are whole numbers, but the entry field allows decimals and calc
  // values can carry a rounding artifact — normalise by rounding rather than 400.
  pcs: z.coerce.number().positive().transform((v) => Math.round(v)).pipe(z.number().int().positive()),
  totalWeight: z.coerce.number().nonnegative().optional().default(0),
  coreAc: z.coerce.number().nonnegative().optional().nullable(),
  coreMl: z.coerce.number().nonnegative().optional().nullable(),
  d13: z.coerce.number().nonnegative().optional().nullable(),
  turns:       z.coerce.number().positive().transform((v) => Math.round(v)).optional().nullable(),
  flux:        z.coerce.number().positive().optional().nullable(),
  ateCm:       z.coerce.number().nonnegative().optional().nullable(),
  testVoltage: z.coerce.number().nonnegative().optional().nullable(),
  testCurrent: z.coerce.number().nonnegative().optional().nullable(),
  rateBasis: z.enum(['PER_KG', 'PER_PCS']).optional().nullable(),
  rateValue: z.coerce.number().nonnegative().optional().nullable(),
  nanoPrice:  z.coerce.number().nonnegative().optional().nullable(),
  casePrice:  z.coerce.number().nonnegative().optional().nullable(),
  caseWeight: z.coerce.number().nonnegative().optional().nullable(),
  nanoSoRate: z.coerce.number().nonnegative().optional().nullable(),
});

const deriveRate = ({ rateBasis, rateValue, weightPerPc, pcs, totalWeight }) => {
  if (!rateBasis || rateValue == null || rateValue <= 0) {
    return { ratePerKg: null, ratePerPc: null, totalAmount: null };
  }
  if (rateBasis === 'PER_KG') {
    return {
      ratePerKg:   rateValue,
      ratePerPc:   weightPerPc > 0 ? +(rateValue * weightPerPc).toFixed(4) : null,
      totalAmount: +(rateValue * (totalWeight ?? 0)).toFixed(2),
    };
  }
  return {
    ratePerPc:   rateValue,
    ratePerKg:   weightPerPc > 0 ? +(rateValue / weightPerPc).toFixed(4) : null,
    totalAmount: +(rateValue * (pcs ?? 0)).toFixed(2),
  };
};

const bankSchema = z.object({
  name:          z.string().max(160).optional().default(''),
  branch:        z.string().max(160).optional().default(''),
  accountName:   z.string().max(160).optional().default(''),
  accountNumber: z.string().max(60).optional().default(''),
  ifsc:          z.string().max(40).optional().default(''),
}).strip().optional().nullable();

const createSchema = z.object({
  quotationNo: z.string().trim().min(1).max(60).optional(),
  customerId: z.string().min(1),
  quotationDate: z.coerce.date(),
  validUntil: z.coerce.date().optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
  terms: z.string().max(8000).optional().nullable(),
  bankDetails: bankSchema,
  items: z.array(itemSchema).min(1, 'Add at least one item before submitting'),
});

// Serialise bank details for storage; null when nothing meaningful was set.
const bankJson = (b) => {
  if (!b) return null;
  const has = [b.name, b.branch, b.accountName, b.accountNumber, b.ifsc].some((v) => (v ?? '').trim());
  return has ? JSON.stringify(b) : null;
};
// Parse the stored bankDetails JSON back into an object for responses.
const parseBank = (v) => { try { return v ? JSON.parse(v) : null; } catch { return null; } };

/* ---------- number generation ---------- */

/** Party prefix for the quotation number. Uses the initials of the company's
 *  words (e.g. "Metflux Electrical Industries" → "MEI"); falls back to the
 *  first three letters for a single-word name. */
const companyPrefix = (name) => {
  const words = String(name ?? '').trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) return words.map((w) => w[0]).join('').slice(0, 4).toUpperCase();
  return String(name ?? 'CO').slice(0, 3).toUpperCase();
};

/** Indian financial year label for a date, e.g. 03-Apr-2026 → "2026-27". */
const fyLabel = (date) => {
  const d = new Date(date);
  const y = d.getFullYear();
  const startYear = d.getMonth() >= 3 ? y : y - 1; // FY starts in April (month 3)
  return `${startYear}-${String(startYear + 1).slice(2)}`;
};

/** Next quotation number for a company within the given date's FY, e.g.
 *  "MEI/SQ/3/2026-27". Sequence restarts each financial year. `db` exposes q/qOne
 *  (module helpers or a txn handle) so it can run inside the insert transaction. */
const nextQuotationNo = async (companyId, date, db) => {
  const company = await db.qOne('SELECT `name` FROM `Company` WHERE `id` = ?', [companyId]);
  const prefix = companyPrefix(company?.name ?? '');
  const fy = fyLabel(date);
  const like = `${prefix}/SQ/%/${fy}`;
  const rows = await db.q(
    'SELECT `quotationNo` FROM `Quotation` WHERE `companyId` = ? AND `quotationNo` LIKE ?',
    [companyId, like]
  );
  let max = 0;
  for (const r of rows) {
    const m = new RegExp(`^${prefix}/SQ/(\\d+)/${fy}$`).exec(r.quotationNo ?? '');
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  // Honour a configured starting serial (Settings → Quotation Terms), e.g.
  // Toroflux starts at 131. The next number is never below that floor.
  let start = 1;
  try {
    const s = await db.qOne("SELECT `settingValue` FROM `CompanySetting` WHERE `companyId` = ? AND `settingKey` = 'quotation_settings'", [companyId]);
    if (s?.settingValue) {
      const j = JSON.parse(s.settingValue);
      if (j?.seriesStart) start = Math.max(1, Number(j.seriesStart) || 1);
    }
  } catch { /* setting absent / unparseable → start from 1 */ }
  const next = Math.max(max + 1, start);
  return `${prefix}/SQ/${next}/${fy}`;
};

const loadItems = async (quotationId) => q(
  'SELECT * FROM `QuotationItem` WHERE `quotationId` = ? ORDER BY `seq` ASC, `createdAt` ASC',
  [quotationId]
);

/* ---------- GET /quotations/next-number ---------- */
/* Registered before /:id so "next-number" isn't captured as an id. */
router.get('/next-number', requireAnyPermission('view_quotation', 'view_po'), asyncHandler(async (req, res) => {
  const date = req.query.date ? new Date(String(req.query.date)) : new Date();
  const quotationNo = await nextQuotationNo(req.tenant.companyId, date, { q, qOne });
  res.json({ quotationNo });
}));

/* ---------- GET /quotations — list ---------- */
router.get('/', requireAnyPermission('view_quotation', 'view_po'), asyncHandler(async (req, res) => {
  const { page, pageSize, search, status } = z.object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(500).default(20),
    search: z.string().trim().max(120).optional(),
    status: z.enum(['OPEN', 'CONVERTED', 'CANCELLED', 'ALL']).default('ALL'),
  }).parse(req.query);
  const skip = (page - 1) * pageSize;

  let where = 'qt.`companyId` = ?';
  const params = [req.tenant.companyId];
  if (status !== 'ALL') { where += ' AND qt.`status` = ?'; params.push(status); }
  if (search) {
    const like = `%${search}%`;
    where += ` AND (qt.\`quotationNo\` LIKE ? OR c.\`name\` LIKE ?
      OR EXISTS (SELECT 1 FROM \`QuotationItem\` it WHERE it.\`quotationId\` = qt.\`id\`
                  AND (it.\`measure\` LIKE ? OR it.\`grade\` LIKE ? OR it.\`material\` LIKE ?)))`;
    params.push(like, like, like, like, like);
  }

  const [rows, totalRow] = await Promise.all([
    q(`
      SELECT qt.*, c.\`id\` AS c_id, c.\`name\` AS c_name,
             (SELECT COUNT(*) FROM \`QuotationItem\` ii WHERE ii.\`quotationId\` = qt.\`id\`) AS itemCount,
             (SELECT COALESCE(SUM(ii.\`totalAmount\`),0) FROM \`QuotationItem\` ii WHERE ii.\`quotationId\` = qt.\`id\`) AS itemsAmount
        FROM \`Quotation\` qt
        INNER JOIN \`Customer\` c ON c.\`id\` = qt.\`customerId\`
        WHERE ${where}
        ORDER BY qt.\`createdAt\` DESC
        LIMIT ? OFFSET ?`,
      [...params, pageSize, skip]
    ),
    qOne(`
      SELECT COUNT(*) AS n FROM \`Quotation\` qt
        INNER JOIN \`Customer\` c ON c.\`id\` = qt.\`customerId\`
        WHERE ${where}`,
      params
    ),
  ]);

  const items = rows.map((r) => ({
    id: r.id,
    quotationNo: r.quotationNo,
    quotationDate: r.quotationDate,
    validUntil: r.validUntil,
    status: r.status,
    convertedPoOrderId: r.convertedPoOrderId,
    createdAt: r.createdAt,
    customer: { id: r.c_id, name: r.c_name },
    itemsAmount: Number(r.itemsAmount ?? 0),
    _count: { items: Number(r.itemCount ?? 0) },
  }));

  res.json({ items, total: Number(totalRow?.n ?? 0), page, pageSize });
}));

/* ---------- POST /quotations — create ---------- */
router.post('/', requireAnyPermission('add_quotation', 'add_po'), asyncHandler(async (req, res) => {
  const data = createSchema.parse(req.body);

  const customer = await qOne(
    'SELECT * FROM `Customer` WHERE `id` = ? AND `companyId` = ?',
    [data.customerId, req.tenant.companyId]
  );
  if (!customer) throw new AppError('Customer not found', 400, 'BAD_CUSTOMER');

  const result = await txn(async (tx) => {
    const quotationNo = data.quotationNo?.trim()
      || await nextQuotationNo(req.tenant.companyId, data.quotationDate, tx);

    // Guard against a manually-entered duplicate.
    const dup = await tx.qOne(
      'SELECT `id` FROM `Quotation` WHERE `companyId` = ? AND `quotationNo` = ?',
      [req.tenant.companyId, quotationNo]
    );
    if (dup) throw new AppError('Quotation number already exists', 409, 'QUOTE_DUPLICATE');

    const quotation = await tx.insert('Quotation', {
      companyId: req.tenant.companyId,
      quotationNo,
      customerId: customer.id,
      quotationDate: data.quotationDate,
      validUntil: data.validUntil ?? null,
      notes: data.notes ?? null,
      terms: data.terms ?? null,
      bankDetails: bankJson(data.bankDetails),
      status: 'OPEN',
      createdById: req.auth.userId,
    });

    const items = [];
    let seq = 0;
    for (const it of data.items) {
      const derived = deriveRate(it);
      const inserted = await tx.insert('QuotationItem', {
        quotationId: quotation.id,
        coreType: it.coreType,
        grade: it.grade,
        material: it.material,
        measure: it.measure,
        hsnCode: it.hsnCode ?? null,
        unit: it.unit ?? 'Pcs',
        id1: it.id1, id2: it.id2 ?? null,
        od1: it.od1, od2: it.od2 ?? null,
        ht: it.ht, builtup: it.builtup ?? null,
        weightPerPc: it.weightPerPc, pcs: it.pcs, totalWeight: it.totalWeight,
        coreAc: it.coreAc ?? null, coreMl: it.coreMl ?? null, d13: it.d13 ?? null,
        turns:       it.turns       ?? null,
        flux:        it.flux        ?? null,
        ateCm:       it.ateCm       ?? null,
        testVoltage: it.testVoltage ?? null,
        testCurrent: it.testCurrent ?? null,
        rateBasis:   it.rateBasis   ?? null,
        rateValue:   it.rateValue   ?? null,
        ratePerKg:   derived.ratePerKg,
        ratePerPc:   derived.ratePerPc,
        totalAmount: derived.totalAmount,
        nanoPrice:   it.nanoPrice   ?? null,
        casePrice:   it.casePrice   ?? null,
        caseWeight:  it.caseWeight  ?? null,
        nanoSoRate:  it.nanoSoRate  ?? null,
        seq: seq++,
      });
      items.push(inserted);
    }
    return { ...quotation, items, customer };
  });

  await logAudit(req, { entity: 'Quotation', entityId: result.id, action: 'CREATE', summary: `Quotation ${result.quotationNo} · ${customer.name} · ${data.items.length} item(s)` });
  res.status(201).json({ ...result, bankDetails: parseBank(result.bankDetails) });
}));

/* ---------- GET /quotations/:id — detail (for edit + print) ---------- */
router.get('/:id', requireAnyPermission('view_quotation', 'view_po'), asyncHandler(async (req, res) => {
  const quotation = await qOne(
    'SELECT * FROM `Quotation` WHERE `id` = ? AND `companyId` = ?',
    [req.params.id, req.tenant.companyId]
  );
  if (!quotation) throw new AppError('Quotation not found', 404, 'NOT_FOUND');
  const customer = await qOne('SELECT * FROM `Customer` WHERE `id` = ?', [quotation.customerId]);
  const items = await loadItems(quotation.id);
  res.json({ ...quotation, bankDetails: parseBank(quotation.bankDetails), customer, items });
}));

/* ---------- PUT /quotations/:id — full edit (header + items) ---------- */
/* Only OPEN quotations can be edited; a CONVERTED one is locked. Items are
   replaced wholesale (delete + re-insert) since a quotation is a standalone
   draft with no downstream references until converted. */
router.put('/:id', requireAnyPermission('add_quotation', 'add_po'), asyncHandler(async (req, res) => {
  const data = createSchema.parse(req.body);
  const quotation = await qOne(
    'SELECT * FROM `Quotation` WHERE `id` = ? AND `companyId` = ?',
    [req.params.id, req.tenant.companyId]
  );
  if (!quotation) throw new AppError('Quotation not found', 404, 'NOT_FOUND');
  if (quotation.status !== 'OPEN') throw new AppError('Only open quotations can be edited', 400, 'QUOTE_LOCKED');

  const customer = await qOne('SELECT * FROM `Customer` WHERE `id` = ? AND `companyId` = ?', [data.customerId, req.tenant.companyId]);
  if (!customer) throw new AppError('Customer not found', 400, 'BAD_CUSTOMER');

  // Allow renaming the quotation number, but keep it unique within the company.
  const quotationNo = (data.quotationNo ?? '').trim() || quotation.quotationNo;
  if (quotationNo !== quotation.quotationNo) {
    const clash = await qOne(
      'SELECT `id` FROM `Quotation` WHERE `companyId` = ? AND `quotationNo` = ? AND `id` <> ?',
      [req.tenant.companyId, quotationNo, quotation.id]
    );
    if (clash) throw new AppError('That quotation number is already in use', 400, 'DUPLICATE_NO');
  }

  const result = await txn(async (tx) => {
    await tx.update('Quotation', quotation.id, {
      quotationNo,
      customerId: customer.id,
      quotationDate: data.quotationDate,
      validUntil: data.validUntil ?? null,
      notes: data.notes ?? null,
      terms: data.terms ?? null,
      bankDetails: bankJson(data.bankDetails),
    });
    await tx.q('DELETE FROM `QuotationItem` WHERE `quotationId` = ?', [quotation.id]);
    let seq = 0;
    for (const it of data.items) {
      const derived = deriveRate(it);
      await tx.insert('QuotationItem', {
        quotationId: quotation.id,
        coreType: it.coreType, grade: it.grade, material: it.material, measure: it.measure,
        hsnCode: it.hsnCode ?? null, unit: it.unit ?? 'Pcs',
        id1: it.id1, id2: it.id2 ?? null, od1: it.od1, od2: it.od2 ?? null,
        ht: it.ht, builtup: it.builtup ?? null,
        weightPerPc: it.weightPerPc, pcs: it.pcs, totalWeight: it.totalWeight,
        coreAc: it.coreAc ?? null, coreMl: it.coreMl ?? null, d13: it.d13 ?? null,
        turns: it.turns ?? null, flux: it.flux ?? null, ateCm: it.ateCm ?? null,
        testVoltage: it.testVoltage ?? null, testCurrent: it.testCurrent ?? null,
        rateBasis: it.rateBasis ?? null, rateValue: it.rateValue ?? null,
        ratePerKg: derived.ratePerKg, ratePerPc: derived.ratePerPc, totalAmount: derived.totalAmount,
        nanoPrice: it.nanoPrice ?? null, casePrice: it.casePrice ?? null,
        caseWeight: it.caseWeight ?? null, nanoSoRate: it.nanoSoRate ?? null,
        seq: seq++,
      });
    }
    const fresh = await tx.qOne('SELECT * FROM `Quotation` WHERE `id` = ?', [quotation.id]);
    return fresh;
  });

  await logAudit(req, { entity: 'Quotation', entityId: quotation.id, action: 'UPDATE', summary: `Edited quotation ${quotationNo} · ${customer.name} · ${data.items.length} item(s)` });
  const items = await loadItems(quotation.id);
  res.json({ ...result, bankDetails: parseBank(result.bankDetails), customer, items });
}));

/* ---------- PATCH /quotations/:id — edit header (dates / notes / terms) ---------- */
const headerUpdateSchema = z.object({
  customerId:    z.string().min(1).optional(),
  quotationDate: z.coerce.date().optional(),
  validUntil:    z.coerce.date().optional().nullable(),
  notes:         z.string().max(2000).optional().nullable(),
  terms:         z.string().max(4000).optional().nullable(),
});

router.patch('/:id', requireAnyPermission('add_quotation', 'add_po'), asyncHandler(async (req, res) => {
  const data = headerUpdateSchema.parse(req.body);
  const quotation = await qOne(
    'SELECT * FROM `Quotation` WHERE `id` = ? AND `companyId` = ?',
    [req.params.id, req.tenant.companyId]
  );
  if (!quotation) throw new AppError('Quotation not found', 404, 'NOT_FOUND');
  if (quotation.status === 'CONVERTED') throw new AppError('A converted quotation cannot be edited', 400, 'QUOTE_CONVERTED');

  if (data.customerId && data.customerId !== quotation.customerId) {
    const c = await qOne('SELECT `id` FROM `Customer` WHERE `id` = ? AND `companyId` = ?', [data.customerId, req.tenant.companyId]);
    if (!c) throw new AppError('Customer not found', 400, 'BAD_CUSTOMER');
  }

  const patch = {};
  if (data.customerId    !== undefined) patch.customerId    = data.customerId;
  if (data.quotationDate !== undefined) patch.quotationDate = data.quotationDate;
  if (data.validUntil    !== undefined) patch.validUntil    = data.validUntil ?? null;
  if (data.notes         !== undefined) patch.notes         = data.notes ?? null;
  if (data.terms         !== undefined) patch.terms         = data.terms ?? null;
  if (Object.keys(patch).length > 0) await update('Quotation', quotation.id, patch);

  const fresh = await qOne('SELECT * FROM `Quotation` WHERE `id` = ?', [quotation.id]);
  const customer = await qOne('SELECT * FROM `Customer` WHERE `id` = ?', [fresh.customerId]);
  const items = await loadItems(fresh.id);
  res.json({ ...fresh, customer, items });
}));

/* ---------- POST /quotations/:id/convert — create a Sales Order from it ---------- */
const convertSchema = z.object({
  poNumber: z.string().trim().min(1).max(60).optional(),
  orderDate: z.coerce.date().optional(),
  deliveryDays: z.coerce.number().int().min(0).optional(),
  deliveryDate: z.coerce.date().optional(),
});

/** Ensure a PO number is free in this company, appending -A, -B… if taken. */
const freePoNumber = async (tx, companyId, wanted) => {
  const suffixes = ['', '-A', '-B', '-C', '-D', '-E'];
  for (const sfx of suffixes) {
    const candidate = `${wanted}${sfx}`.slice(0, 60);
    const dup = await tx.qOne(
      'SELECT `id` FROM `PoOrder` WHERE `companyId` = ? AND `poNumber` = ?',
      [companyId, candidate]
    );
    if (!dup) return candidate;
  }
  throw new AppError('Could not find a free Sales Order number — pass one explicitly', 409, 'PO_DUPLICATE');
};

router.post('/:id/convert', requireAnyPermission('add_quotation', 'add_po'), asyncHandler(async (req, res) => {
  const data = convertSchema.parse(req.body ?? {});
  const quotation = await qOne(
    'SELECT * FROM `Quotation` WHERE `id` = ? AND `companyId` = ?',
    [req.params.id, req.tenant.companyId]
  );
  if (!quotation) throw new AppError('Quotation not found', 404, 'NOT_FOUND');
  if (quotation.status === 'CONVERTED') throw new AppError('This quotation has already been converted', 400, 'QUOTE_CONVERTED');
  if (quotation.status === 'CANCELLED') throw new AppError('A cancelled quotation cannot be converted', 400, 'QUOTE_CANCELLED');

  const customer = await qOne('SELECT * FROM `Customer` WHERE `id` = ? AND `companyId` = ?', [quotation.customerId, req.tenant.companyId]);
  if (!customer) throw new AppError('Customer no longer exists', 400, 'BAD_CUSTOMER');

  const qItems = await loadItems(quotation.id);
  if (qItems.length === 0) throw new AppError('Quotation has no items to convert', 400, 'NO_ITEMS');

  const orderDate = data.orderDate ?? new Date();
  const deliveryDays = data.deliveryDays ?? 0;
  const deliveryDate = data.deliveryDate
    ?? new Date(orderDate.getTime() + deliveryDays * 86400000);
  // Suggested SO number from the quotation number (…/SQ/… → …/SO/…).
  const suggested = data.poNumber?.trim() || quotation.quotationNo.replace('/SQ/', '/SO/');

  const created = await txn(async (tx) => {
    const poNumber = await freePoNumber(tx, req.tenant.companyId, suggested);
    const po = await tx.insert('PoOrder', {
      poNumber,
      orderDate,
      deliveryDays,
      deliveryDate,
      notes: quotation.notes ?? null,
      companyId: req.tenant.companyId,
      customerId: customer.id,
      createdById: req.auth.userId,
    });
    for (const it of qItems) {
      const derived = deriveRate({
        rateBasis: it.rateBasis, rateValue: it.rateValue,
        weightPerPc: it.weightPerPc, pcs: it.pcs, totalWeight: it.totalWeight,
      });
      await tx.insert('PoOrderItem', {
        poOrderId: po.id,
        coreType: it.coreType, grade: it.grade, material: it.material, measure: it.measure,
        id1: it.id1, id2: it.id2, od1: it.od1, od2: it.od2, ht: it.ht, builtup: it.builtup,
        weightPerPc: it.weightPerPc, pcs: it.pcs, totalWeight: it.totalWeight,
        coreAc: it.coreAc, coreMl: it.coreMl, d13: it.d13,
        turns: it.turns, flux: it.flux, ateCm: it.ateCm,
        testVoltage: it.testVoltage, testCurrent: it.testCurrent,
        rateBasis: it.rateBasis, rateValue: it.rateValue,
        ratePerKg: derived.ratePerKg, ratePerPc: derived.ratePerPc, totalAmount: derived.totalAmount,
        nanoPrice: it.nanoPrice, casePrice: it.casePrice, caseWeight: it.caseWeight, nanoSoRate: it.nanoSoRate,
      });
    }
    await tx.update('Quotation', quotation.id, { status: 'CONVERTED', convertedPoOrderId: po.id });
    return po;
  });

  await logAudit(req, { entity: 'Quotation', entityId: quotation.id, action: 'UPDATE', summary: `Converted ${quotation.quotationNo} → SO ${created.poNumber}` });
  notifyCompanyAdmins(req.tenant.companyId, {
    type: 'SALES_ORDER', title: 'Quotation converted to sales order',
    body: `${customer.name} — ${quotation.quotationNo} → SO ${created.poNumber}`,
    url: '/s/admin/po/manage', tag: 'so-new',
  }, { push: false }).catch(() => {});

  res.status(201).json({ poOrderId: created.id, poNumber: created.poNumber });
}));

/* ---------- DELETE /quotations/:id ---------- */
router.delete('/:id', requireAnyPermission('add_quotation', 'add_po'), asyncHandler(async (req, res) => {
  const quotation = await qOne(
    'SELECT * FROM `Quotation` WHERE `id` = ? AND `companyId` = ?',
    [req.params.id, req.tenant.companyId]
  );
  if (!quotation) throw new AppError('Quotation not found', 404, 'NOT_FOUND');

  await txn(async (tx) => {
    await tx.q('DELETE FROM `QuotationItem` WHERE `quotationId` = ?', [quotation.id]);
    await tx.q('DELETE FROM `Quotation` WHERE `id` = ?', [quotation.id]);
  });
  await logAudit(req, { entity: 'Quotation', entityId: quotation.id, action: 'DELETE', summary: `Quotation ${quotation.quotationNo}` });
  res.status(204).end();
}));

export default router;
