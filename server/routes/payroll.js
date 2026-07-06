// Payroll — fixed monthly salary per worker (Labour) plus an advances ledger.
// Every advance is tagged to a payroll month (YYYY-MM); the monthly summary is
// salary − Σ advances that month = net payable. Advances are linked to the
// worker so they flow straight into that month's payroll.
import { Router } from 'express';
import { z } from 'zod';
import { q, qOne, insert, update, del } from '../lib/db.js';
import { AppError, asyncHandler } from '../lib/errors.js';
import { requireAuth, requirePermission } from '../lib/auth.js';
import { resolveTenant } from '../lib/tenant.js';

const router = Router();
router.use(requireAuth, resolveTenant);

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const MONTH = z.string().regex(/^\d{4}-\d{2}$/, 'month must be YYYY-MM');

// A worker must belong to the active company (via LabourMembership).
const labourInTenant = (labourId, companyId) => qOne(
  `SELECT l.\`id\`, l.\`name\`, l.\`monthlySalary\`
     FROM \`Labour\` l
     INNER JOIN \`LabourMembership\` lm ON lm.\`labourId\` = l.\`id\`
    WHERE l.\`id\` = ? AND lm.\`companyId\` = ? LIMIT 1`,
  [labourId, companyId]
);

/* ---------- GET /summary?month=YYYY-MM — payroll per worker ---------- */
router.get('/summary', requirePermission('manage_payroll'), asyncHandler(async (req, res) => {
  const { month } = z.object({ month: MONTH }).parse(req.query);

  const workers = await q(
    `SELECT l.\`id\`, l.\`name\`, l.\`phone\`, l.\`isActive\`, l.\`monthlySalary\`
       FROM \`Labour\` l
       INNER JOIN \`LabourMembership\` lm ON lm.\`labourId\` = l.\`id\`
      WHERE lm.\`companyId\` = ?
      ORDER BY l.\`name\` ASC`,
    [req.tenant.companyId]
  );

  const advRows = await q(
    `SELECT \`labourId\`, COALESCE(SUM(\`amount\`),0) AS adv, COUNT(*) AS n
       FROM \`EmployeeAdvance\`
      WHERE \`companyId\` = ? AND \`periodMonth\` = ?
      GROUP BY \`labourId\``,
    [req.tenant.companyId, month]
  );
  const advByLabour = new Map(advRows.map((r) => [r.labourId, { adv: Number(r.adv) || 0, n: Number(r.n) || 0 }]));

  const items = workers.map((w) => {
    const salary = round2(w.monthlySalary);
    const a = advByLabour.get(w.id) ?? { adv: 0, n: 0 };
    const advances = round2(a.adv);
    return {
      labourId: w.id,
      name: w.name,
      phone: w.phone ?? null,
      isActive: !!w.isActive,
      monthlySalary: salary,
      advances,
      advanceCount: a.n,
      net: round2(salary - advances),
    };
  });

  const totals = items.reduce((t, it) => ({
    monthlySalary: round2(t.monthlySalary + it.monthlySalary),
    advances: round2(t.advances + it.advances),
    net: round2(t.net + it.net),
  }), { monthlySalary: 0, advances: 0, net: 0 });

  res.json({ month, items, totals });
}));

/* ---------- GET /advances?month=&labourId= — advance line items ---------- */
router.get('/advances', requirePermission('manage_payroll'), asyncHandler(async (req, res) => {
  const { month, labourId } = z.object({
    month: MONTH.optional(),
    labourId: z.string().optional(),
  }).parse(req.query);

  let where = '`companyId` = ?';
  const params = [req.tenant.companyId];
  if (month) { where += ' AND `periodMonth` = ?'; params.push(month); }
  if (labourId) { where += ' AND `labourId` = ?'; params.push(labourId); }

  const rows = await q(
    `SELECT * FROM \`EmployeeAdvance\` WHERE ${where} ORDER BY \`advanceDate\` DESC, \`createdAt\` DESC`,
    params
  );
  res.json({
    items: rows.map((r) => ({
      id: r.id, labourId: r.labourId, labourName: r.labourName,
      amount: Number(r.amount) || 0, advanceDate: r.advanceDate,
      periodMonth: r.periodMonth, notes: r.notes ?? null,
    })),
  });
}));

/* ---------- POST /advances — pay an advance, linked to a worker + month ---------- */
router.post('/advances', requirePermission('manage_payroll'), asyncHandler(async (req, res) => {
  const data = z.object({
    labourId:    z.string().min(1),
    amount:      z.coerce.number().positive(),
    advanceDate: z.coerce.date(),
    periodMonth: MONTH,
    notes:       z.string().trim().max(400).optional().nullable(),
  }).parse(req.body);

  const worker = await labourInTenant(data.labourId, req.tenant.companyId);
  if (!worker) throw new AppError('Worker not found in this company', 404, 'NOT_FOUND');

  const created = await insert('EmployeeAdvance', {
    companyId: req.tenant.companyId,
    labourId: data.labourId,
    labourName: worker.name,
    amount: round2(data.amount),
    advanceDate: data.advanceDate,
    periodMonth: data.periodMonth,
    notes: data.notes ?? null,
    createdById: req.auth.userId,
  });
  res.status(201).json({ id: created.id });
}));

/* ---------- DELETE /advances/:id ---------- */
router.delete('/advances/:id', requirePermission('manage_payroll'), asyncHandler(async (req, res) => {
  const row = await qOne('SELECT `id` FROM `EmployeeAdvance` WHERE `id` = ? AND `companyId` = ?', [req.params.id, req.tenant.companyId]);
  if (!row) throw new AppError('Advance not found', 404, 'NOT_FOUND');
  await del('EmployeeAdvance', row.id);
  res.status(204).end();
}));

/* ---------- PATCH /salary/:labourId — set the fixed monthly salary ---------- */
router.patch('/salary/:labourId', requirePermission('manage_payroll'), asyncHandler(async (req, res) => {
  const { monthlySalary } = z.object({
    monthlySalary: z.coerce.number().nonnegative().nullable(),
  }).parse(req.body);

  const worker = await labourInTenant(req.params.labourId, req.tenant.companyId);
  if (!worker) throw new AppError('Worker not found in this company', 404, 'NOT_FOUND');

  await update('Labour', req.params.labourId, { monthlySalary: monthlySalary == null ? null : round2(monthlySalary) });
  res.json({ ok: true, labourId: req.params.labourId, monthlySalary });
}));

export default router;
