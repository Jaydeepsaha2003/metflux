// Cashbook — account-head classification + a persistent Receipts & Payments
// summary. Bank-book rows are stored on import (via /store); classification
// (customer / supplier / other-with-category) is resolved live at query time so
// re-tagging a head instantly updates the summary.
import { Router } from 'express';
import { z } from 'zod';
import { q, qOne, insert, del, newId } from '../lib/db.js';
import { AppError, asyncHandler } from '../lib/errors.js';
import { requireAuth, requireAnyPermission } from '../lib/auth.js';
import { resolveTenant } from '../lib/tenant.js';
import { round2, normName } from '../lib/invoicing.js';
import { parseBankBook } from '../lib/receiptsPayments.js';

const router = Router();
router.use(requireAuth, resolveTenant);
const PERM = ['receive_payments', 'manage_invoices'];

/* Build a live classifier: normKey → { type, category }. Customers & suppliers
   win over stored AccountHead rows (they're the source of truth once created). */
const buildClassifier = async (companyId) => {
  const [customers, suppliers, heads] = await Promise.all([
    q('SELECT `name` FROM `Customer` WHERE `companyId` = ?', [companyId]),
    q(`SELECT s.\`name\` FROM \`Supplier\` s
         INNER JOIN \`SupplierMembership\` sm ON sm.\`supplierId\` = s.\`id\`
        WHERE sm.\`companyId\` = ?`, [companyId]),
    q('SELECT `normKey`, `type`, `category` FROM `AccountHead` WHERE `companyId` = ?', [companyId]),
  ]);
  const cust = new Set(customers.map((c) => normName(c.name)).filter(Boolean));
  const supp = new Set(suppliers.map((s) => normName(s.name)).filter(Boolean));
  const headMap = new Map(heads.map((h) => [h.normKey, h]));
  return (account) => {
    const k = normName(account);
    if (cust.has(k)) return { type: 'CUSTOMER', category: 'Customer receipts' };
    if (supp.has(k)) return { type: 'SUPPLIER', category: 'Supplier payments' };
    const h = headMap.get(k);
    if (h) {
      if (h.type === 'CUSTOMER') return { type: 'CUSTOMER', category: 'Customer receipts' };
      if (h.type === 'SUPPLIER') return { type: 'SUPPLIER', category: 'Supplier payments' };
      return { type: 'OTHER', category: h.category || 'Other' };
    }
    return { type: 'UNCLASSIFIED', category: 'Unclassified' };
  };
};

/* ---------- Account heads ---------- */

// List defined OTHER heads + the distinct categories used (for the dropdown).
router.get('/account-heads', requireAnyPermission(...PERM), asyncHandler(async (req, res) => {
  const heads = await q(
    'SELECT `id`, `name`, `type`, `category` FROM `AccountHead` WHERE `companyId` = ? ORDER BY `name` ASC',
    [req.tenant.companyId]
  );
  const categories = [...new Set(heads.map((h) => h.category).filter(Boolean))].sort();
  res.json({ heads, categories });
}));

// Define / update an OTHER head (customer & supplier heads are created via their
// own endpoints so they land in those lists).
router.post('/account-heads', requireAnyPermission(...PERM), asyncHandler(async (req, res) => {
  const { name, category } = z.object({
    name: z.string().trim().min(1).max(200),
    category: z.string().trim().min(1).max(120),
  }).parse(req.body);
  const normKey = normName(name);
  if (!normKey) throw new AppError('Invalid account name', 400, 'BAD_NAME');

  const existing = await qOne(
    'SELECT `id` FROM `AccountHead` WHERE `companyId` = ? AND `normKey` = ?',
    [req.tenant.companyId, normKey]
  );
  if (existing) {
    await q('UPDATE `AccountHead` SET `name` = ?, `type` = \'OTHER\', `category` = ?, `updatedAt` = CURRENT_TIMESTAMP(3) WHERE `id` = ?',
      [name, category, existing.id]);
    return res.json({ id: existing.id, name, type: 'OTHER', category });
  }
  const row = await insert('AccountHead', {
    companyId: req.tenant.companyId, name, normKey, type: 'OTHER', category,
  });
  res.status(201).json({ id: row.id, name, type: 'OTHER', category });
}));

router.delete('/account-heads/:id', requireAnyPermission(...PERM), asyncHandler(async (req, res) => {
  const row = await qOne('SELECT `id` FROM `AccountHead` WHERE `id` = ? AND `companyId` = ?', [req.params.id, req.tenant.companyId]);
  if (!row) throw new AppError('Not found', 404, 'NOT_FOUND');
  await del('AccountHead', row.id);
  res.status(204).end();
}));

/* ---------- Store the uploaded cashbook (for the summary) ---------- */

// Replaces any existing entries whose date falls inside the uploaded file's
// date span, then inserts every parsed row. Idempotent per period.
router.post('/store', requireAnyPermission(...PERM), asyncHandler(async (req, res) => {
  const { rows } = z.object({ rows: z.array(z.array(z.any())).max(50000) }).parse(req.body);
  const { entries } = parseBankBook(rows);
  const companyId = req.tenant.companyId;
  if (!entries.length) return res.json({ stored: 0 });

  const times = entries.map((e) => e.date).filter(Boolean).map((d) => +d);
  const max = times.length ? new Date(Math.max(...times)) : new Date();
  const min = times.length ? new Date(Math.min(...times)) : max;
  const endOfMax = new Date(+max + 86400000 - 1);

  // Wipe the covered period so a re-import doesn't double-count.
  await q('DELETE FROM `CashbookEntry` WHERE `companyId` = ? AND `entryDate` BETWEEN ? AND ?', [companyId, min, endOfMax]);

  // Bulk insert in chunks.
  let stored = 0;
  const CHUNK = 400;
  for (let i = 0; i < entries.length; i += CHUNK) {
    const slice = entries.slice(i, i + CHUNK);
    const placeholders = slice.map(() => '(?,?,?,?,?,?,?)').join(',');
    const params = [];
    for (const e of slice) {
      params.push(newId(), companyId, e.date ?? max, e.side, e.account.slice(0, 200), normName(e.account).slice(0, 200), round2(e.amount), (e.vch || '').slice(0, 80));
    }
    await q(
      'INSERT INTO `CashbookEntry` (`id`,`companyId`,`entryDate`,`side`,`account`,`normKey`,`amount`,`vch`) VALUES ' + placeholders,
      params
    );
    stored += slice.length;
  }
  res.json({ stored, from: min, to: max });
}));

/* ---------- Summary ---------- */

router.get('/summary', requireAnyPermission(...PERM), asyncHandler(async (req, res) => {
  const { from, to, groupBy } = z.object({
    from: z.string().optional(),
    to: z.string().optional(),
    groupBy: z.enum(['account', 'category']).default('category'),
  }).parse(req.query);

  const where = ['`companyId` = ?'];
  const params = [req.tenant.companyId];
  if (from) { where.push('`entryDate` >= ?'); params.push(new Date(from)); }
  if (to) { where.push('`entryDate` <= ?'); params.push(new Date(new Date(to).getTime() + 86400000 - 1)); }

  const rows = await q(
    `SELECT \`entryDate\`, \`side\`, \`account\`, \`amount\` FROM \`CashbookEntry\` WHERE ${where.join(' AND ')}`,
    params
  );

  const classify = await buildClassifier(req.tenant.companyId);
  const groups = new Map();
  let totalRcpt = 0, totalPymt = 0;
  for (const r of rows) {
    const cls = classify(r.account);
    const key = groupBy === 'account' ? r.account : cls.category;
    if (!groups.has(key)) groups.set(key, { key, category: cls.category, type: cls.type, receipts: 0, payments: 0, count: 0 });
    const g = groups.get(key);
    const amt = Number(r.amount) || 0;
    if (r.side === 'RECEIPT') { g.receipts = round2(g.receipts + amt); totalRcpt = round2(totalRcpt + amt); }
    else { g.payments = round2(g.payments + amt); totalPymt = round2(totalPymt + amt); }
    g.count++;
  }
  const items = [...groups.values()]
    .map((g) => ({ ...g, net: round2(g.receipts - g.payments) }))
    .sort((a, b) => (b.receipts + b.payments) - (a.receipts + a.payments));

  res.json({
    groupBy,
    items,
    totals: { receipts: totalRcpt, payments: totalPymt, net: round2(totalRcpt - totalPymt), count: rows.length },
  });
}));

export default router;
