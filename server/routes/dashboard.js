// Dashboard analytics — KPIs and employee performance.
// Read-only, all queries scoped to the active company via resolveTenant.
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/db.js';
import { asyncHandler } from '../lib/errors.js';
import { requireAuth } from '../lib/auth.js';
import { resolveTenant } from '../lib/tenant.js';

const router = Router();
router.use(requireAuth, resolveTenant);

const startOfMonth = (now = new Date()) => new Date(now.getFullYear(), now.getMonth(), 1);
const startOfYear  = (now = new Date()) => new Date(now.getFullYear(), 0, 1);

/* GET /api/dashboard/stats — KPI snapshot. */
router.get('/stats', asyncHandler(async (req, res) => {
  const companyId = req.tenant.companyId;
  const now = new Date();
  const monthStart = startOfMonth(now);
  const yearStart  = startOfYear(now);

  // Active PO items used by several KPIs below.
  const activeItems = await prisma.poOrderItem.findMany({
    where: { status: 'ACTIVE', poOrder: { companyId } },
    select: {
      pcs: true,
      totalAmount: true,
      productions: { select: { pcs: true } },
      dispatches:  { select: { pcs: true } },
      poOrder: { select: { orderDate: true, customerId: true } },
    },
  });

  let pendingProductionAmount = 0;
  let readyDispatchAmount = 0;
  let pendingProductionPcs = 0;
  let readyDispatchPcs = 0;

  for (const it of activeItems) {
    const produced   = it.productions.reduce((s, p) => s + p.pcs, 0);
    const dispatched = it.dispatches.reduce((s, d) => s + d.pcs, 0);
    const remaining  = Math.max(it.pcs - produced, 0);
    const readyPcs   = Math.max(produced - dispatched, 0);
    pendingProductionPcs += remaining;
    readyDispatchPcs     += readyPcs;
    if (it.totalAmount != null && it.pcs > 0) {
      pendingProductionAmount += it.totalAmount * (remaining / it.pcs);
      readyDispatchAmount     += it.totalAmount * (readyPcs / it.pcs);
    }
  }

  // SO counts + values, current month + ytd.
  const [soThisMonth, soThisYear] = await Promise.all([
    prisma.poOrder.findMany({
      where: { companyId, orderDate: { gte: monthStart } },
      select: { id: true, items: { select: { totalAmount: true } } },
    }),
    prisma.poOrder.findMany({
      where: { companyId, orderDate: { gte: yearStart } },
      select: { id: true, items: { select: { totalAmount: true } } },
    }),
  ]);
  const sumSoAmount = (orders) =>
    orders.reduce((s, o) => s + o.items.reduce((x, i) => x + (i.totalAmount ?? 0), 0), 0);

  // Dispatches this month (count + total weight + total amount).
  const dispatchesThisMonth = await prisma.dispatch.findMany({
    where: { companyId, dispatchDate: { gte: monthStart } },
    select: {
      pcs: true,
      totalWeight: true,
      poOrderItem: { select: { pcs: true, totalAmount: true } },
    },
  });
  const dispatchAmountThisMonth = dispatchesThisMonth.reduce((s, d) => {
    const it = d.poOrderItem;
    if (it && it.totalAmount != null && it.pcs > 0) {
      return s + (it.totalAmount * (d.pcs / it.pcs));
    }
    return s;
  }, 0);
  const dispatchWeightThisMonth = dispatchesThisMonth.reduce((s, d) => s + (d.totalWeight ?? 0), 0);

  // Top 5 customers by year-to-date SO amount.
  const customerTotals = new Map();
  for (const it of activeItems) {
    const cid = it.poOrder.customerId;
    if (!customerTotals.has(cid)) customerTotals.set(cid, 0);
    if (it.poOrder.orderDate >= yearStart) {
      customerTotals.set(cid, customerTotals.get(cid) + (it.totalAmount ?? 0));
    }
  }
  const topCustomerIds = [...customerTotals.entries()]
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  const customerLookup = await prisma.customer.findMany({
    where: { id: { in: topCustomerIds.map(([id]) => id) }, companyId },
    select: { id: true, name: true },
  });
  const customerNameById = Object.fromEntries(customerLookup.map((c) => [c.id, c.name]));
  const topCustomers = topCustomerIds.map(([id, amount]) => ({
    id,
    name: customerNameById[id] ?? '—',
    amount: +amount.toFixed(2),
  }));

  // Open returns — anything not CLOSED/CANCELLED.
  const openReturns = await prisma.return.count({
    where: { companyId, status: { notIn: ['CLOSED', 'CANCELLED'] } },
  });

  res.json({
    soThisMonth: {
      count:  soThisMonth.length,
      amount: +sumSoAmount(soThisMonth).toFixed(2),
    },
    soThisYear: {
      count:  soThisYear.length,
      amount: +sumSoAmount(soThisYear).toFixed(2),
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
    openReturns,
    topCustomers,
  });
}));

/* GET /api/dashboard/employees?from=YYYY-MM-DD&to=YYYY-MM-DD
   Aggregates production records by labour name. Returns ranking by pcs. */
router.get('/employees', asyncHandler(async (req, res) => {
  const { from, to } = z.object({
    from: z.coerce.date().optional(),
    to:   z.coerce.date().optional(),
  }).parse(req.query);

  // Default window: this month-to-date.
  const fromDate = from ?? startOfMonth();
  const toDate   = to   ?? new Date();
  // Make `to` inclusive — bump to end-of-day.
  toDate.setHours(23, 59, 59, 999);

  const records = await prisma.production.findMany({
    where: {
      companyId: req.tenant.companyId,
      prodDate:  { gte: fromDate, lte: toDate },
    },
    select: {
      pcs: true,
      totalWeight: true,
      labourName: true,
      poOrderItem: { select: { measure: true, grade: true } },
    },
  });

  // Group by labour name. Track per-size pcs to produce a top size + size list.
  const byLabour = new Map();
  for (const r of records) {
    const key = r.labourName || '—';
    if (!byLabour.has(key)) {
      byLabour.set(key, {
        labourName: key,
        pcs: 0,
        totalWeight: 0,
        entries: 0,
        bySize: new Map(),
      });
    }
    const row = byLabour.get(key);
    row.pcs += r.pcs;
    row.totalWeight += r.totalWeight;
    row.entries += 1;
    const size = r.poOrderItem?.measure ?? '—';
    row.bySize.set(size, (row.bySize.get(size) ?? 0) + r.pcs);
  }

  const list = [...byLabour.values()].map((row) => {
    const sizes = [...row.bySize.entries()].sort((a, b) => b[1] - a[1]);
    const topSize = sizes[0]?.[0] ?? null;
    const topSizePcs = sizes[0]?.[1] ?? 0;
    return {
      labourName:    row.labourName,
      pcs:           row.pcs,
      totalWeight:   +row.totalWeight.toFixed(3),
      entries:       row.entries,
      distinctSizes: sizes.length,
      topSize,
      topSizePcs,
      // Truncate to top 5 sizes per worker — front-end can render chips.
      sizes: sizes.slice(0, 5).map(([measure, pcs]) => ({ measure, pcs })),
    };
  })
  .sort((a, b) => b.pcs - a.pcs)
  .map((row, idx) => ({ ...row, rank: idx + 1 }));

  res.json({
    from: fromDate.toISOString(),
    to:   toDate.toISOString(),
    items: list,
    totalPcs:    list.reduce((s, x) => s + x.pcs, 0),
    totalWeight: +list.reduce((s, x) => s + x.totalWeight, 0).toFixed(3),
  });
}));

export default router;
