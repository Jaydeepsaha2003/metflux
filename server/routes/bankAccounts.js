// Bank accounts — the cash-side master for the Receipts & Payments book. Every
// CashbookEntry belongs to one account, so a company can keep several banks
// (and a cash box) side by side and upload each one's statement separately.
//
// Deliberately cash-side only: a party's receivable/payable never depends on
// WHICH bank the money moved through, so aging, the party ledger and the
// reconciliation engine stay global across all accounts.
import { Router } from 'express';
import { z } from 'zod';
import { q, qOne, insert, update, del } from '../lib/db.js';
import { AppError, asyncHandler } from '../lib/errors.js';
import { requireAuth, requireAnyPermission } from '../lib/auth.js';
import { resolveTenant } from '../lib/tenant.js';
import { round2 } from '../lib/invoicing.js';

const router = Router();
router.use(requireAuth, resolveTenant);
const PERM = ['receive_payments', 'manage_invoices'];

const inputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  bankName: z.string().trim().max(120).nullish(),
  accountNumber: z.string().trim().max(40).nullish(),
  ifsc: z.string().trim().max(20).nullish(),
  openingBalance: z.coerce.number().finite().default(0),
  openingAsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  sortOrder: z.coerce.number().int().min(0).max(9999).optional(),
});

const shape = (b, bal) => ({
  id: b.id,
  name: b.name,
  bankName: b.bankName ?? null,
  accountNumber: b.accountNumber ?? null,
  ifsc: b.ifsc ?? null,
  openingBalance: round2(Number(b.openingBalance) || 0),
  openingAsOn: b.openingAsOn ?? null,
  isDefault: !!b.isDefault,
  sortOrder: Number(b.sortOrder) || 0,
  receipts: round2(bal?.receipts ?? 0),
  payments: round2(bal?.payments ?? 0),
  entryCount: Number(bal?.entryCount ?? 0),
  // Entries dated BEFORE the opening cut-off. They're excluded from the balance
  // (the opening figure is already meant to embody them), so the count is
  // surfaced rather than silently swallowed.
  preOpeningCount: Number(bal?.preOpening ?? 0),
  // Closing balance the way a passbook reads it: what you started with, plus
  // everything received since, less everything paid out since.
  balance: round2((Number(b.openingBalance) || 0) + (bal?.receipts ?? 0) - (bal?.payments ?? 0)),
});

/* ---------- GET / — every account with its live balance ---------- */
router.get('/', requireAnyPermission(...PERM), asyncHandler(async (req, res) => {
  const rows = await q(
    'SELECT * FROM `BankAccount` WHERE `companyId` = ? AND `archivedAt` IS NULL ORDER BY `sortOrder` ASC, `createdAt` ASC',
    [req.tenant.companyId]
  );
  // One grouped pass over the book rather than a query per account. Only entries
  // on/after each account's opening date feed its balance — the opening figure
  // already accounts for everything before it, so counting both would double up.
  // (An undated row is treated as current, and a NULL opening date means
  // "no cut-off — count the whole book".)
  const SINCE_OPENING = '(b.`openingAsOn` IS NULL OR e.`entryDate` IS NULL OR e.`entryDate` >= b.`openingAsOn`)';
  const totals = await q(
    `SELECT e.\`bankAccountId\` AS id,
            COALESCE(SUM(CASE WHEN e.\`side\` = 'RECEIPT' AND ${SINCE_OPENING} THEN e.\`amount\` ELSE 0 END), 0) AS receipts,
            COALESCE(SUM(CASE WHEN e.\`side\` = 'PAYMENT' AND ${SINCE_OPENING} THEN e.\`amount\` ELSE 0 END), 0) AS payments,
            COUNT(*) AS entryCount,
            COALESCE(SUM(CASE WHEN b.\`openingAsOn\` IS NOT NULL AND e.\`entryDate\` IS NOT NULL
                              AND e.\`entryDate\` < b.\`openingAsOn\` THEN 1 ELSE 0 END), 0) AS preOpening
       FROM \`CashbookEntry\` e
       JOIN \`BankAccount\` b ON b.\`id\` = e.\`bankAccountId\`
      WHERE e.\`companyId\` = ? GROUP BY e.\`bankAccountId\``,
    [req.tenant.companyId]
  ).catch(() => []);
  const byId = new Map(totals.map((t) => [t.id, {
    receipts: Number(t.receipts) || 0, payments: Number(t.payments) || 0,
    entryCount: Number(t.entryCount) || 0, preOpening: Number(t.preOpening) || 0,
  }]));

  const items = rows.map((b) => shape(b, byId.get(b.id)));
  res.json({
    items,
    totals: {
      openingBalance: round2(items.reduce((s, b) => s + b.openingBalance, 0)),
      receipts: round2(items.reduce((s, b) => s + b.receipts, 0)),
      payments: round2(items.reduce((s, b) => s + b.payments, 0)),
      balance: round2(items.reduce((s, b) => s + b.balance, 0)),
      entryCount: items.reduce((s, b) => s + b.entryCount, 0),
    },
  });
}));

/* ---------- POST / — add an account ---------- */
router.post('/', requireAnyPermission(...PERM), asyncHandler(async (req, res) => {
  const data = inputSchema.parse(req.body);
  const dupe = await qOne(
    'SELECT `id` FROM `BankAccount` WHERE `companyId` = ? AND `name` = ?',
    [req.tenant.companyId, data.name]
  );
  if (dupe) throw new AppError('A bank account with that name already exists.', 409, 'DUPLICATE');

  const count = await qOne('SELECT COUNT(*) AS n FROM `BankAccount` WHERE `companyId` = ?', [req.tenant.companyId]);
  const created = await insert('BankAccount', {
    companyId: req.tenant.companyId,
    name: data.name,
    bankName: data.bankName || null,
    accountNumber: data.accountNumber || null,
    ifsc: data.ifsc || null,
    openingBalance: round2(data.openingBalance),
    openingAsOn: data.openingAsOn ? new Date(data.openingAsOn) : null,
    // The very first account a company creates becomes its default.
    isDefault: Number(count?.n ?? 0) === 0 ? 1 : 0,
    sortOrder: data.sortOrder ?? Number(count?.n ?? 0),
  });
  res.status(201).json(shape(created, null));
}));

/* ---------- PATCH /:id ---------- */
router.patch('/:id', requireAnyPermission(...PERM), asyncHandler(async (req, res) => {
  const data = inputSchema.partial().parse(req.body);
  const row = await qOne(
    'SELECT * FROM `BankAccount` WHERE `id` = ? AND `companyId` = ?',
    [req.params.id, req.tenant.companyId]
  );
  if (!row) throw new AppError('Bank account not found', 404, 'NOT_FOUND');

  if (data.name && data.name !== row.name) {
    const dupe = await qOne(
      'SELECT `id` FROM `BankAccount` WHERE `companyId` = ? AND `name` = ? AND `id` <> ?',
      [req.tenant.companyId, data.name, row.id]
    );
    if (dupe) throw new AppError('A bank account with that name already exists.', 409, 'DUPLICATE');
  }

  const patch = {};
  if (data.name !== undefined) patch.name = data.name;
  if (data.bankName !== undefined) patch.bankName = data.bankName || null;
  if (data.accountNumber !== undefined) patch.accountNumber = data.accountNumber || null;
  if (data.ifsc !== undefined) patch.ifsc = data.ifsc || null;
  if (data.openingBalance !== undefined) patch.openingBalance = round2(data.openingBalance);
  if (data.openingAsOn !== undefined) patch.openingAsOn = data.openingAsOn ? new Date(data.openingAsOn) : null;
  if (data.sortOrder !== undefined) patch.sortOrder = data.sortOrder;

  const saved = await update('BankAccount', row.id, patch);
  res.json(shape(saved, null));
}));

/* ---------- POST /:id/default — make this the landing account ---------- */
router.post('/:id/default', requireAnyPermission(...PERM), asyncHandler(async (req, res) => {
  const row = await qOne(
    'SELECT `id` FROM `BankAccount` WHERE `id` = ? AND `companyId` = ?',
    [req.params.id, req.tenant.companyId]
  );
  if (!row) throw new AppError('Bank account not found', 404, 'NOT_FOUND');
  await q('UPDATE `BankAccount` SET `isDefault` = 0 WHERE `companyId` = ?', [req.tenant.companyId]);
  await q('UPDATE `BankAccount` SET `isDefault` = 1 WHERE `id` = ?', [row.id]);
  res.json({ ok: true });
}));

/* ---------- DELETE /:id ----------
   Refused while the account still holds entries — deleting it would strand the
   cash book. The caller is told how many rows are in the way. */
router.delete('/:id', requireAnyPermission(...PERM), asyncHandler(async (req, res) => {
  const row = await qOne(
    'SELECT * FROM `BankAccount` WHERE `id` = ? AND `companyId` = ?',
    [req.params.id, req.tenant.companyId]
  );
  if (!row) throw new AppError('Bank account not found', 404, 'NOT_FOUND');

  const used = await qOne(
    'SELECT COUNT(*) AS n FROM `CashbookEntry` WHERE `companyId` = ? AND `bankAccountId` = ?',
    [req.tenant.companyId, row.id]
  ).catch(() => ({ n: 0 }));
  const n = Number(used?.n ?? 0);
  if (n > 0) {
    throw new AppError(
      `This account still has ${n} cashbook entr${n === 1 ? 'y' : 'ies'}. Delete those entries first, then remove the account.`,
      409, 'IN_USE'
    );
  }
  const total = await qOne('SELECT COUNT(*) AS n FROM `BankAccount` WHERE `companyId` = ?', [req.tenant.companyId]);
  if (Number(total?.n ?? 0) <= 1) throw new AppError('Keep at least one bank account.', 409, 'LAST_ACCOUNT');

  await del('BankAccount', row.id);
  // Never leave a company without a default.
  if (row.isDefault) {
    const next = await qOne(
      'SELECT `id` FROM `BankAccount` WHERE `companyId` = ? ORDER BY `sortOrder` ASC, `createdAt` ASC LIMIT 1',
      [req.tenant.companyId]
    );
    if (next) await q('UPDATE `BankAccount` SET `isDefault` = 1 WHERE `id` = ?', [next.id]);
  }
  res.status(204).end();
}));

export default router;
