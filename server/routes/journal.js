// Journal — a Busy/Tally-style double-entry Journal Register, populated by
// uploading the exported register. Each voucher's balanced Dr/Cr lines are
// stored as JournalVoucher rows (source='JOURNAL', grouped by batchId), so they
// flow into the account ledger and Amount Receivable/Payable by account name —
// exactly like the single-legged Suspense Entry, but multi-line.
import { Router } from 'express';
import { z } from 'zod';
import { q, txn, newId } from '../lib/db.js';
import { AppError, asyncHandler } from '../lib/errors.js';
import { requireAuth, requireAnyPermission } from '../lib/auth.js';
import { resolveTenant } from '../lib/tenant.js';
import { round2, normName } from '../lib/invoicing.js';
import { parseJournalRegister } from '../lib/journalRegister.js';

const router = Router();
router.use(requireAuth, resolveTenant);
const PERM = ['receive_payments', 'manage_invoices'];

/* POST /import — parse an uploaded Journal Register and REPLACE the current one. */
router.post('/import', requireAnyPermission(...PERM), asyncHandler(async (req, res) => {
  const { rows } = z.object({ rows: z.array(z.array(z.any())).max(100000) }).parse(req.body);
  const { vouchers, error } = parseJournalRegister(rows);
  if (error) throw new AppError(error, 400, 'PARSE_FAILED');
  if (!vouchers.length) throw new AppError('No journal vouchers were found in that file.', 400, 'EMPTY');
  const companyId = req.tenant.companyId;

  const summary = await txn(async (tx) => {
    await tx.q("DELETE FROM `JournalVoucher` WHERE `companyId` = ? AND `source` = 'JOURNAL'", [companyId]);
    const params = [];
    const ph = [];
    let lines = 0, unbalanced = 0;
    for (const v of vouchers) {
      if (!v.balanced) unbalanced++;
      const batchId = newId();
      v.lines.forEach((l, seq) => {
        ph.push('(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
        params.push(
          newId(), companyId, 'JOURNAL', batchId, seq, (v.refNo || '').slice(0, 40), v.refNo,
          v.date, l.account.slice(0, 200), normName(l.account).slice(0, 200), l.side, round2(l.amount),
          seq === 0 ? v.taxable : null, seq === 0 ? v.igst : null, seq === 0 ? v.cgst : null, seq === 0 ? v.sgst : null,
          req.auth.userId,
        );
        lines++;
      });
    }
    const COLS = '(`id`,`companyId`,`source`,`batchId`,`seq`,`voucherNo`,`refNo`,`entryDate`,`account`,`normKey`,`side`,`amount`,`taxable`,`igst`,`cgst`,`sgst`,`createdById`)';
    const PER = 17;                        // columns per row
    const CHUNK = 300;                     // rows per INSERT
    for (let i = 0; i < ph.length; i += CHUNK) {
      const slicePh = ph.slice(i, i + CHUNK);
      const sliceParams = params.slice(i * PER, (i + CHUNK) * PER);
      await tx.q(`INSERT INTO \`JournalVoucher\` ${COLS} VALUES ${slicePh.join(',')}`, sliceParams);
    }
    return { vouchers: vouchers.length, lines, unbalanced };
  });
  res.status(201).json(summary);
}));

/* GET / — the register, grouped into vouchers, with period + search filters. */
router.get('/', requireAnyPermission(...PERM), asyncHandler(async (req, res) => {
  const { from, to, search } = z.object({
    from: z.string().optional(), to: z.string().optional(), search: z.string().trim().max(120).optional(),
  }).parse(req.query);
  const where = ['`companyId` = ?', "`source` = 'JOURNAL'"];
  const params = [req.tenant.companyId];
  if (from) { where.push('`entryDate` >= ?'); params.push(new Date(from)); }
  if (to) { where.push('`entryDate` <= ?'); params.push(new Date(new Date(to).getTime() + 86400000 - 1)); }

  const rows = await q(
    `SELECT \`batchId\`, \`seq\`, \`entryDate\`, \`refNo\`, \`account\`, \`side\`, \`amount\`, \`taxable\`, \`igst\`, \`cgst\`, \`sgst\`
       FROM \`JournalVoucher\` WHERE ${where.join(' AND ')}
      ORDER BY \`entryDate\` ASC, \`batchId\` ASC, \`seq\` ASC`,
    params
  );
  const map = new Map();
  for (const r of rows) {
    if (!map.has(r.batchId)) {
      map.set(r.batchId, {
        batchId: r.batchId, date: r.entryDate, refNo: r.refNo,
        taxable: r.taxable, igst: r.igst, cgst: r.cgst, sgst: r.sgst,
        lines: [], debit: 0, credit: 0,
      });
    }
    const v = map.get(r.batchId);
    const amt = Number(r.amount) || 0;
    v.lines.push({ account: r.account, side: r.side, amount: amt });
    if (r.side === 'DEBIT') v.debit = round2(v.debit + amt); else v.credit = round2(v.credit + amt);
  }
  let items = [...map.values()];
  if (search) {
    const s = search.toLowerCase();
    items = items.filter((v) => (v.refNo || '').toLowerCase().includes(s) || v.lines.some((l) => l.account.toLowerCase().includes(s)));
  }
  const totals = items.reduce((t, v) => ({
    debit: round2(t.debit + v.debit), credit: round2(t.credit + v.credit),
    taxable: round2(t.taxable + (v.taxable || 0)), igst: round2(t.igst + (v.igst || 0)),
    cgst: round2(t.cgst + (v.cgst || 0)), sgst: round2(t.sgst + (v.sgst || 0)), count: t.count + 1,
  }), { debit: 0, credit: 0, taxable: 0, igst: 0, cgst: 0, sgst: 0, count: 0 });
  res.json({ items, totals });
}));

/* POST /clear — remove all imported journal vouchers for this company. */
router.post('/clear', requireAnyPermission(...PERM), asyncHandler(async (req, res) => {
  const r = await q("DELETE FROM `JournalVoucher` WHERE `companyId` = ? AND `source` = 'JOURNAL'", [req.tenant.companyId]);
  res.json({ deleted: r?.affectedRows ?? 0 });
}));

export default router;
