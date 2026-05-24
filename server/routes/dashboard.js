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

const filterQuery = z.object({
  from:       z.coerce.date().optional(),
  to:         z.coerce.date().optional(),
  customerId: z.string().trim().min(1).optional(),
});

/* GET /api/dashboard/stats?from=YYYY-MM-DD&to=YYYY-MM-DD&customerId=...
   `from`/`to` window the time-bounded cards (Sales orders, Dispatched, Top
   customers). Stock-state cards (Pending production, Ready to dispatch, Open
   returns) ignore the range — they're point-in-time. `customerId` scopes
   every card. */
router.get('/stats', asyncHandler(async (req, res) => {
  const companyId = req.tenant.companyId;
  const now = new Date();
  const { from, to, customerId } = filterQuery.parse(req.query);

  const rangeStart = from ?? startOfMonth(now);
  const rangeEnd   = to   ?? new Date();
  rangeEnd.setHours(23, 59, 59, 999);

  /* Active PO items with produced + dispatched sums + order context. */
  const activeItems = await q(
    `SELECT it.\`id\`          AS itemId,
            it.\`pcs\`         AS pcs,
            it.\`totalWeight\` AS totalWeight,
            it.\`totalAmount\` AS totalAmount,
            it.\`coreType\`    AS coreType,
            po.\`orderDate\`   AS orderDate,
            po.\`customerId\`  AS customerId,
            (SELECT COALESCE(SUM(pp.\`pcs\`),0) FROM \`Production\` pp WHERE pp.\`poOrderItemId\` = it.\`id\`) AS produced,
            (SELECT COALESCE(SUM(dd.\`pcs\`),0) FROM \`Dispatch\`   dd WHERE dd.\`poOrderItemId\` = it.\`id\`) AS dispatched
       FROM \`PoOrderItem\` it
       INNER JOIN \`PoOrder\` po ON po.\`id\` = it.\`poOrderId\`
       WHERE po.\`companyId\` = ? AND it.\`status\` = ?
         ${customerId ? 'AND po.`customerId` = ?' : ''}`,
    customerId ? [companyId, 'ACTIVE', customerId] : [companyId, 'ACTIVE']
  );

  /* Sales orders in range — pcs, kg, amount, unique customers. */
  let salesPcs = 0, salesKg = 0, salesAmount = 0;
  const salesCustomers = new Set();
  const salesOrderIds  = new Set();
  for (const it of activeItems) {
    const od = new Date(it.orderDate);
    if (od >= rangeStart && od <= rangeEnd) {
      salesPcs    += it.pcs;
      salesKg     += Number(it.totalWeight ?? 0);
      salesAmount += Number(it.totalAmount ?? 0);
      salesCustomers.add(it.customerId);
      // count distinct PO orders too — re-query? Easier: collect from items.
    }
  }

  /* Count of distinct PoOrders in range — small extra query keeps it accurate
     even when an order has no items in the active set. */
  const soCountRow = await qOne(
    `SELECT COUNT(*) AS n FROM \`PoOrder\`
      WHERE \`companyId\` = ? AND \`orderDate\` >= ? AND \`orderDate\` <= ?
        ${customerId ? 'AND `customerId` = ?' : ''}`,
    customerId
      ? [companyId, rangeStart, rangeEnd, customerId]
      : [companyId, rangeStart, rangeEnd]
  );

  /* Pending production + ready to dispatch — derived from active items.
     We pro-rate kg & amount by the pcs share. */
  let pendingPcs = 0, pendingKg = 0, pendingAmount = 0;
  let readyPcs   = 0, readyKg   = 0, readyAmount   = 0;
  for (const it of activeItems) {
    const produced   = Number(it.produced ?? 0);
    const dispatched = Number(it.dispatched ?? 0);
    const remaining  = Math.max(it.pcs - produced, 0);
    const ready      = Math.max(produced - dispatched, 0);
    pendingPcs += remaining;
    readyPcs   += ready;
    if (it.pcs > 0) {
      const kg = Number(it.totalWeight ?? 0);
      const am = Number(it.totalAmount ?? 0);
      pendingKg     += kg * (remaining / it.pcs);
      pendingAmount += am * (remaining / it.pcs);
      readyKg       += kg * (ready / it.pcs);
      readyAmount   += am * (ready / it.pcs);
    }
  }

  /* Dispatched in range — pcs, kg, amount (pro-rated). */
  const dispatchRows = await q(
    `SELECT d.\`pcs\` AS pcs, d.\`totalWeight\` AS totalWeight,
            it.\`pcs\` AS itemPcs, it.\`totalAmount\` AS itemAmount
       FROM \`Dispatch\` d
       INNER JOIN \`PoOrderItem\` it ON it.\`id\` = d.\`poOrderItemId\`
       INNER JOIN \`PoOrder\` po    ON po.\`id\` = it.\`poOrderId\`
      WHERE d.\`companyId\` = ?
        AND d.\`dispatchDate\` >= ? AND d.\`dispatchDate\` <= ?
        ${customerId ? 'AND po.`customerId` = ?' : ''}`,
    customerId
      ? [companyId, rangeStart, rangeEnd, customerId]
      : [companyId, rangeStart, rangeEnd]
  );
  let dispatchedPcs = 0, dispatchedKg = 0, dispatchedAmount = 0;
  for (const d of dispatchRows) {
    dispatchedPcs += d.pcs;
    dispatchedKg  += Number(d.totalWeight ?? 0);
    if (d.itemAmount != null && d.itemPcs > 0) {
      dispatchedAmount += d.itemAmount * (d.pcs / d.itemPcs);
    }
  }

  /* Top 5 customers in range — pcs, kg, toroidal/rectangular split, amount.
     Only meaningful when no customer filter is applied. */
  let topCustomers = [];
  if (!customerId) {
    const byCust = new Map();
    for (const it of activeItems) {
      const od = new Date(it.orderDate);
      if (od < rangeStart || od > rangeEnd) continue;
      const cid = it.customerId;
      if (!byCust.has(cid)) {
        byCust.set(cid, { amount: 0, pcs: 0, kg: 0, toroidalPcs: 0, rectangularPcs: 0 });
      }
      const row = byCust.get(cid);
      row.amount += Number(it.totalAmount ?? 0);
      row.pcs    += it.pcs;
      row.kg     += Number(it.totalWeight ?? 0);
      if (it.coreType === 'TOROIDAL')          row.toroidalPcs    += it.pcs;
      else if (it.coreType === 'RECTANGULAR')  row.rectangularPcs += it.pcs;
    }
    const topIds = [...byCust.entries()]
      .filter(([, v]) => v.amount > 0)
      .sort((a, b) => b[1].amount - a[1].amount)
      .slice(0, 5);
    if (topIds.length > 0) {
      const placeholders = topIds.map(() => '?').join(',');
      const rows = await q(
        `SELECT \`id\`, \`name\`, \`customerCode\` FROM \`Customer\` WHERE \`id\` IN (${placeholders}) AND \`companyId\` = ?`,
        [...topIds.map(([id]) => id), companyId]
      );
      const byId = Object.fromEntries(rows.map((c) => [c.id, c]));
      topCustomers = topIds.map(([id, v]) => ({
        id,
        name:           byId[id]?.name ?? '—',
        customerCode:   byId[id]?.customerCode ?? null,
        amount:         +v.amount.toFixed(2),
        pcs:            v.pcs,
        kg:             +v.kg.toFixed(3),
        toroidalPcs:    v.toroidalPcs,
        rectangularPcs: v.rectangularPcs,
      }));
    }
  }

  /* Open returns. */
  const openReturnsRow = await qOne(
    `SELECT COUNT(*) AS n FROM \`Return\`
      WHERE \`companyId\` = ? AND \`status\` NOT IN ('CLOSED','CANCELLED')
        ${customerId ? 'AND `customerId` = ?' : ''}`,
    customerId ? [companyId, customerId] : [companyId]
  );

  res.json({
    range: { from: rangeStart.toISOString(), to: rangeEnd.toISOString() },
    salesOrders: {
      count:     Number(soCountRow?.n ?? 0),
      pcs:       salesPcs,
      kg:        +salesKg.toFixed(3),
      customers: salesCustomers.size,
      amount:    +salesAmount.toFixed(2),
    },
    pendingProduction: {
      pcs:    pendingPcs,
      kg:     +pendingKg.toFixed(3),
      amount: +pendingAmount.toFixed(2),
    },
    readyDispatch: {
      pcs:    readyPcs,
      kg:     +readyKg.toFixed(3),
      amount: +readyAmount.toFixed(2),
    },
    dispatched: {
      count:  dispatchRows.length,
      pcs:    dispatchedPcs,
      kg:     +dispatchedKg.toFixed(3),
      amount: +dispatchedAmount.toFixed(2),
    },
    openReturns: Number(openReturnsRow?.n ?? 0),
    topCustomers,
  });
}));

/* GET /api/dashboard/employees?from=&to=&customerId= */
router.get('/employees', asyncHandler(async (req, res) => {
  const { from, to, customerId } = filterQuery.parse(req.query);

  const fromDate = from ?? startOfMonth();
  const toDate   = to   ?? new Date();
  toDate.setHours(23, 59, 59, 999);

  const records = await q(
    `SELECT p.\`pcs\` AS pcs, p.\`totalWeight\` AS totalWeight, p.\`labourName\` AS labourName,
            it.\`measure\` AS measure, it.\`grade\` AS grade
       FROM \`Production\` p
       INNER JOIN \`PoOrderItem\` it ON it.\`id\` = p.\`poOrderItemId\`
       INNER JOIN \`PoOrder\` po    ON po.\`id\` = it.\`poOrderId\`
      WHERE p.\`companyId\` = ? AND p.\`prodDate\` >= ? AND p.\`prodDate\` <= ?
        ${customerId ? 'AND po.`customerId` = ?' : ''}`,
    customerId
      ? [req.tenant.companyId, fromDate, toDate, customerId]
      : [req.tenant.companyId, fromDate, toDate]
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
