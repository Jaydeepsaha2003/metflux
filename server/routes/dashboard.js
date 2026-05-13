// Dashboard analytics — KPIs and employee performance.
import { Router } from 'express';
import { z } from 'zod';
import { q, qOne } from '../lib/db.js';
import { asyncHandler } from '../lib/errors.js';
import { requireAuth } from '../lib/auth.js';
import { resolveTenant } from '../lib/tenant.js';

const router = Router();
router.use(requireAuth, resolveTenant);

const startOfMonth = (now = new Date()) => new Date(now.getFullYear(), now.getMonth(), 1);
const startOfYear  = (now = new Date()) => new Date(now.getFullYear(), 0, 1);

/* GET /api/dashboard/stats */
router.get('/stats', asyncHandler(async (req, res) => {
  const companyId = req.tenant.companyId;
  const now = new Date();
  const monthStart = startOfMonth(now);
  const yearStart  = startOfYear(now);

  // Active PO items with produced + dispatched sums + order context, in one query.
  const activeItems = await q(
    `SELECT it.\`pcs\`         AS pcs,
            it.\`totalAmount\` AS totalAmount,
            po.\`orderDate\`   AS orderDate,
            po.\`customerId\`  AS customerId,
            (SELECT COALESCE(SUM(pp.\`pcs\`),0) FROM \`Production\` pp WHERE pp.\`poOrderItemId\` = it.\`id\`) AS produced,
            (SELECT COALESCE(SUM(dd.\`pcs\`),0) FROM \`Dispatch\`   dd WHERE dd.\`poOrderItemId\` = it.\`id\`) AS dispatched
       FROM \`PoOrderItem\` it
       INNER JOIN \`PoOrder\` po ON po.\`id\` = it.\`poOrderId\`
       WHERE po.\`companyId\` = ? AND it.\`status\` = ?`,
    [companyId, 'ACTIVE']
  );

  let pendingProductionAmount = 0;
  let readyDispatchAmount = 0;
  let pendingProductionPcs = 0;
  let readyDispatchPcs = 0;

  for (const it of activeItems) {
    const produced   = Number(it.produced ?? 0);
    const dispatched = Number(it.dispatched ?? 0);
    const remaining  = Math.max(it.pcs - produced, 0);
    const readyPcs   = Math.max(produced - dispatched, 0);
    pendingProductionPcs += remaining;
    readyDispatchPcs     += readyPcs;
    if (it.totalAmount != null && it.pcs > 0) {
      pendingProductionAmount += it.totalAmount * (remaining / it.pcs);
      readyDispatchAmount     += it.totalAmount * (readyPcs / it.pcs);
    }
  }

  // SO counts + sum(items.totalAmount) by month / year.
  const soMonthRow = await qOne(
    `SELECT COUNT(DISTINCT po.\`id\`) AS cnt, COALESCE(SUM(it.\`totalAmount\`),0) AS amount
       FROM \`PoOrder\` po
       LEFT JOIN \`PoOrderItem\` it ON it.\`poOrderId\` = po.\`id\`
       WHERE po.\`companyId\` = ? AND po.\`orderDate\` >= ?`,
    [companyId, monthStart]
  );
  const soYearRow = await qOne(
    `SELECT COUNT(DISTINCT po.\`id\`) AS cnt, COALESCE(SUM(it.\`totalAmount\`),0) AS amount
       FROM \`PoOrder\` po
       LEFT JOIN \`PoOrderItem\` it ON it.\`poOrderId\` = po.\`id\`
       WHERE po.\`companyId\` = ? AND po.\`orderDate\` >= ?`,
    [companyId, yearStart]
  );

  // Dispatches this month with pro-rated amount.
  const dispatchesThisMonth = await q(
    `SELECT d.\`pcs\` AS pcs, d.\`totalWeight\` AS totalWeight,
            it.\`pcs\` AS itemPcs, it.\`totalAmount\` AS itemAmount
       FROM \`Dispatch\` d
       INNER JOIN \`PoOrderItem\` it ON it.\`id\` = d.\`poOrderItemId\`
       WHERE d.\`companyId\` = ? AND d.\`dispatchDate\` >= ?`,
    [companyId, monthStart]
  );
  const dispatchAmountThisMonth = dispatchesThisMonth.reduce((s, d) => {
    if (d.itemAmount != null && d.itemPcs > 0) return s + (d.itemAmount * (d.pcs / d.itemPcs));
    return s;
  }, 0);
  const dispatchWeightThisMonth = dispatchesThisMonth.reduce((s, d) => s + (d.totalWeight ?? 0), 0);

  // Top 5 customers by YTD SO amount.
  const customerTotals = new Map();
  for (const it of activeItems) {
    if (new Date(it.orderDate) >= yearStart) {
      const cid = it.customerId;
      customerTotals.set(cid, (customerTotals.get(cid) ?? 0) + (it.totalAmount ?? 0));
    }
  }
  const topCustomerIds = [...customerTotals.entries()]
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  let customerNameById = {};
  if (topCustomerIds.length > 0) {
    const placeholders = topCustomerIds.map(() => '?').join(',');
    const rows = await q(
      `SELECT \`id\`, \`name\` FROM \`Customer\` WHERE \`id\` IN (${placeholders}) AND \`companyId\` = ?`,
      [...topCustomerIds.map(([id]) => id), companyId]
    );
    customerNameById = Object.fromEntries(rows.map((c) => [c.id, c.name]));
  }
  const topCustomers = topCustomerIds.map(([id, amount]) => ({
    id,
    name: customerNameById[id] ?? '—',
    amount: +amount.toFixed(2),
  }));

  // Open returns — anything not CLOSED/CANCELLED.
  const openReturnsRow = await qOne(
    "SELECT COUNT(*) AS n FROM `Return` WHERE `companyId` = ? AND `status` NOT IN ('CLOSED','CANCELLED')",
    [companyId]
  );

  res.json({
    soThisMonth: {
      count:  Number(soMonthRow?.cnt ?? 0),
      amount: +Number(soMonthRow?.amount ?? 0).toFixed(2),
    },
    soThisYear: {
      count:  Number(soYearRow?.cnt ?? 0),
      amount: +Number(soYearRow?.amount ?? 0).toFixed(2),
    },
    pendingProduction: {
      pcs:    pendingProductionPcs,
      amount: +pendingProductionAmount.toFixed(2),
    },
    readyDispatch: {
      pcs:    readyDispatchPcs,
      amount: +readyDispatchAmount.toFixed(2),
    },
    dispatchThisMonth: {
      count:  dispatchesThisMonth.length,
      pcs:    dispatchesThisMonth.reduce((s, d) => s + d.pcs, 0),
      weight: +dispatchWeightThisMonth.toFixed(3),
      amount: +dispatchAmountThisMonth.toFixed(2),
    },
    openReturns: Number(openReturnsRow?.n ?? 0),
    topCustomers,
  });
}));

/* GET /api/dashboard/employees */
router.get('/employees', asyncHandler(async (req, res) => {
  const { from, to } = z.object({
    from: z.coerce.date().optional(),
    to:   z.coerce.date().optional(),
  }).parse(req.query);

  const fromDate = from ?? startOfMonth();
  const toDate   = to   ?? new Date();
  toDate.setHours(23, 59, 59, 999);

  const records = await q(
    `SELECT p.\`pcs\` AS pcs, p.\`totalWeight\` AS totalWeight, p.\`labourName\` AS labourName,
            it.\`measure\` AS measure, it.\`grade\` AS grade
       FROM \`Production\` p
       INNER JOIN \`PoOrderItem\` it ON it.\`id\` = p.\`poOrderItemId\`
       WHERE p.\`companyId\` = ? AND p.\`prodDate\` >= ? AND p.\`prodDate\` <= ?`,
    [req.tenant.companyId, fromDate, toDate]
  );

  const byLabour = new Map();
  for (const r of records) {
    const key = r.labourName || '—';
    if (!byLabour.has(key)) {
      byLabour.set(key, { labourName: key, pcs: 0, totalWeight: 0, entries: 0, bySize: new Map() });
    }
    const row = byLabour.get(key);
    row.pcs += r.pcs;
    row.totalWeight += r.totalWeight;
    row.entries += 1;
    const size = r.measure ?? '—';
    row.bySize.set(size, (row.bySize.get(size) ?? 0) + r.pcs);
  }

  const list = [...byLabour.values()].map((row) => {
    const sizes = [...row.bySize.entries()].sort((a, b) => b[1] - a[1]);
    return {
      labourName:    row.labourName,
      pcs:           row.pcs,
      totalWeight:   +row.totalWeight.toFixed(3),
      entries:       row.entries,
      distinctSizes: sizes.length,
      topSize:       sizes[0]?.[0] ?? null,
      topSizePcs:    sizes[0]?.[1] ?? 0,
      sizes:         sizes.slice(0, 5).map(([measure, pcs]) => ({ measure, pcs })),
    };
  }).sort((a, b) => b.pcs - a.pcs).map((row, idx) => ({ ...row, rank: idx + 1 }));

  res.json({
    from: fromDate.toISOString(),
    to:   toDate.toISOString(),
    items: list,
    totalPcs:    list.reduce((s, x) => s + x.pcs, 0),
    totalWeight: +list.reduce((s, x) => s + x.totalWeight, 0).toFixed(3),
  });
}));

export default router;
