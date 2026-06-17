// Dashboard analytics — KPIs and employee performance.
import { Router } from 'express';
import { z } from 'zod';
import { q, qOne } from '../lib/db.js';
import { asyncHandler } from '../lib/errors.js';
import { requireAuth, requirePermission } from '../lib/auth.js';
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

  /* Sales orders in range — pcs, kg, amount, unique customers, core-type split. */
  let salesPcs = 0, salesKg = 0, salesAmount = 0;
  let toroidalPcs = 0, rectangularPcs = 0;
  const salesCustomers = new Set();
  for (const it of activeItems) {
    const od = new Date(it.orderDate);
    if (od >= rangeStart && od <= rangeEnd) {
      salesPcs    += it.pcs;
      salesKg     += Number(it.totalWeight ?? 0);
      salesAmount += Number(it.totalAmount ?? 0);
      salesCustomers.add(it.customerId);
      if (it.coreType === 'TOROIDAL')         toroidalPcs    += it.pcs;
      else if (it.coreType === 'RECTANGULAR') rectangularPcs += it.pcs;
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

  /* Items past delivery date with remaining production. */
  const overdueRow = await qOne(
    `SELECT COUNT(*) AS n
       FROM \`PoOrderItem\` it
       INNER JOIN \`PoOrder\` po ON po.\`id\` = it.\`poOrderId\`
       WHERE po.\`companyId\` = ?
         AND it.\`status\` = 'ACTIVE'
         AND po.\`deliveryDate\` < CURDATE()
         AND it.\`pcs\` > (
           SELECT COALESCE(SUM(pp.\`pcs\`),0)
             FROM \`Production\` pp WHERE pp.\`poOrderItemId\` = it.\`id\`
         )
         ${customerId ? 'AND po.`customerId` = ?' : ''}`,
    customerId ? [companyId, customerId] : [companyId]
  );

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
      count:          Number(soCountRow?.n ?? 0),
      pcs:            salesPcs,
      kg:             +salesKg.toFixed(3),
      customers:      salesCustomers.size,
      amount:         +salesAmount.toFixed(2),
      toroidalPcs,
      rectangularPcs,
    },
    overdueItems: Number(overdueRow?.n ?? 0),
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

/* GET /api/dashboard/monthly?customerId=
   Returns last 12 calendar months of ordered pcs + amount for the bar/line chart. */
router.get('/monthly', asyncHandler(async (req, res) => {
  const companyId = req.tenant.companyId;
  const { customerId } = filterQuery.parse(req.query);

  const rows = await q(
    `SELECT
       DATE_FORMAT(po.\`orderDate\`, '%Y-%m') AS month,
       COALESCE(SUM(it.\`pcs\`), 0)           AS totalPcs,
       COALESCE(SUM(it.\`totalAmount\`), 0)    AS totalAmount,
       COUNT(DISTINCT po.\`id\`)               AS orderCount
     FROM \`PoOrderItem\` it
     INNER JOIN \`PoOrder\` po ON po.\`id\` = it.\`poOrderId\`
     WHERE po.\`companyId\` = ?
       AND it.\`status\` = 'ACTIVE'
       AND po.\`orderDate\` >= DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL 11 MONTH), '%Y-%m-01')
       ${customerId ? 'AND po.`customerId` = ?' : ''}
     GROUP BY DATE_FORMAT(po.\`orderDate\`, '%Y-%m')
     ORDER BY month ASC`,
    customerId ? [companyId, customerId] : [companyId]
  );

  /* Fill every month in the window with 0 if no data. */
  const months = [];
  const now = new Date();
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  const byMonth = new Map(rows.map((r) => [r.month, r]));
  const data = months.map((m) => ({
    month:       m,
    totalPcs:    Number(byMonth.get(m)?.totalPcs    ?? 0),
    totalAmount: Number(byMonth.get(m)?.totalAmount ?? 0),
    orderCount:  Number(byMonth.get(m)?.orderCount  ?? 0),
  }));

  res.json({ data });
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

/* GET /api/dashboard/analysis?from=&to=
   One comprehensive business-health payload: revenue + receivables + GST from
   the invoice/payment ledger, the order→produce→dispatch fulfilment funnel,
   customer & state concentration, core-type mix, a 12-month trend, and returns.
   `from`/`to` window the money + breakdown figures (default: last 12 months);
   the trend is always the trailing 12 months, and receivables/funnel/returns
   are point-in-time. Gated on manage_invoices since it surfaces financials. */
router.get('/analysis', requirePermission('manage_invoices'), asyncHandler(async (req, res) => {
  const companyId = req.tenant.companyId;
  const now = new Date();
  const { from, to } = filterQuery.parse(req.query);

  const rangeStart = from ?? new Date(now.getFullYear(), now.getMonth() - 11, 1);
  const rangeEnd   = to   ?? new Date();
  rangeEnd.setHours(23, 59, 59, 999);
  const trendStart = new Date(now.getFullYear(), now.getMonth() - 11, 1); // always 12 mo

  const num = (v) => Number(v ?? 0);
  const r2 = (v) => Math.round((num(v) + Number.EPSILON) * 100) / 100;

  const [
    invAgg, payAgg, outAgg, agingRows,
    invByMonth, payByMonth, prodByMonth,
    fulfill, topCust, byState, coreRows, returnRows,
  ] = await Promise.all([
    qOne(`SELECT COUNT(*) cnt,
            COALESCE(SUM(\`amount\`),0) invoiced,
            COALESCE(SUM(\`taxableAmount\`),0) taxable,
            COALESCE(SUM(\`igst\`),0) igst,
            COALESCE(SUM(\`cgst\`),0) cgst,
            COALESCE(SUM(\`sgst\`),0) sgst,
            COUNT(DISTINCT \`customerId\`) customers
          FROM \`SalesInvoice\`
          WHERE \`companyId\` = ? AND \`invoiceDate\` >= ? AND \`invoiceDate\` <= ?`,
      [companyId, rangeStart, rangeEnd]),
    qOne(`SELECT COUNT(*) cnt, COALESCE(SUM(\`amount\`),0) received
          FROM \`Payment\` WHERE \`companyId\` = ? AND \`paymentDate\` >= ? AND \`paymentDate\` <= ?`,
      [companyId, rangeStart, rangeEnd]),
    qOne(`SELECT COALESCE(SUM(\`amount\` - \`paidAmount\`),0) outstanding,
            COALESCE(SUM(CASE WHEN \`status\` <> 'PAID' AND \`dueDate\` IS NOT NULL AND \`dueDate\` < NOW()
                              THEN \`amount\` - \`paidAmount\` ELSE 0 END),0) overdue,
            SUM(CASE WHEN \`status\` <> 'PAID' THEN 1 ELSE 0 END) openCount
          FROM \`SalesInvoice\` WHERE \`companyId\` = ?`, [companyId]),
    q(`SELECT CASE
            WHEN \`dueDate\` IS NULL THEN 'noTerms'
            WHEN DATEDIFF(NOW(), \`dueDate\`) <= 0 THEN 'notDue'
            WHEN DATEDIFF(NOW(), \`dueDate\`) <= 30 THEN 'd1_30'
            WHEN DATEDIFF(NOW(), \`dueDate\`) <= 60 THEN 'd31_60'
            WHEN DATEDIFF(NOW(), \`dueDate\`) <= 90 THEN 'd61_90'
            ELSE 'd90' END bucket,
          COALESCE(SUM(\`amount\` - \`paidAmount\`),0) bal
        FROM \`SalesInvoice\`
        WHERE \`companyId\` = ? AND \`status\` <> 'PAID' AND (\`amount\` - \`paidAmount\`) > 0.01
        GROUP BY bucket`, [companyId]),
    q(`SELECT DATE_FORMAT(\`invoiceDate\`,'%Y-%m') m, COALESCE(SUM(\`amount\`),0) amt
        FROM \`SalesInvoice\` WHERE \`companyId\` = ? AND \`invoiceDate\` >= ? GROUP BY m`,
      [companyId, trendStart]),
    q(`SELECT DATE_FORMAT(\`paymentDate\`,'%Y-%m') m, COALESCE(SUM(\`amount\`),0) amt
        FROM \`Payment\` WHERE \`companyId\` = ? AND \`paymentDate\` >= ? GROUP BY m`,
      [companyId, trendStart]),
    q(`SELECT DATE_FORMAT(\`prodDate\`,'%Y-%m') m, COALESCE(SUM(\`pcs\`),0) pcs
        FROM \`Production\` WHERE \`companyId\` = ? AND \`prodDate\` >= ? GROUP BY m`,
      [companyId, trendStart]),
    qOne(`SELECT COALESCE(SUM(it.\`pcs\`),0) ordered,
            COALESCE(SUM((SELECT COALESCE(SUM(pp.\`pcs\`),0) FROM \`Production\` pp WHERE pp.\`poOrderItemId\` = it.\`id\`)),0) produced,
            COALESCE(SUM((SELECT COALESCE(SUM(dd.\`pcs\`),0) FROM \`Dispatch\` dd WHERE dd.\`poOrderItemId\` = it.\`id\`)),0) dispatched
          FROM \`PoOrderItem\` it INNER JOIN \`PoOrder\` po ON po.\`id\` = it.\`poOrderId\`
          WHERE po.\`companyId\` = ? AND it.\`status\` = 'ACTIVE'`, [companyId]),
    q(`SELECT si.\`customerId\` cid, c.\`name\` name, c.\`customerCode\` code,
            COALESCE(SUM(si.\`amount\`),0) invoiced,
            COALESCE(SUM(si.\`amount\` - si.\`paidAmount\`),0) outstanding
          FROM \`SalesInvoice\` si LEFT JOIN \`Customer\` c ON c.\`id\` = si.\`customerId\`
          WHERE si.\`companyId\` = ? AND si.\`invoiceDate\` >= ? AND si.\`invoiceDate\` <= ?
          GROUP BY si.\`customerId\`, c.\`name\`, c.\`customerCode\`
          ORDER BY invoiced DESC LIMIT 1000`, [companyId, rangeStart, rangeEnd]),
    q(`SELECT COALESCE(NULLIF(TRIM(c.\`state\`),''),'—') state, COALESCE(SUM(si.\`amount\`),0) amt, COUNT(*) cnt
          FROM \`SalesInvoice\` si LEFT JOIN \`Customer\` c ON c.\`id\` = si.\`customerId\`
          WHERE si.\`companyId\` = ? AND si.\`invoiceDate\` >= ? AND si.\`invoiceDate\` <= ?
          GROUP BY state ORDER BY amt DESC LIMIT 8`, [companyId, rangeStart, rangeEnd]),
    q(`SELECT it.\`coreType\` ct, COALESCE(SUM(it.\`pcs\`),0) pcs
          FROM \`PoOrderItem\` it INNER JOIN \`PoOrder\` po ON po.\`id\` = it.\`poOrderId\`
          WHERE po.\`companyId\` = ? AND it.\`status\` = 'ACTIVE' AND po.\`orderDate\` >= ? AND po.\`orderDate\` <= ?
          GROUP BY it.\`coreType\``, [companyId, rangeStart, rangeEnd]),
    q(`SELECT \`status\`, COUNT(*) n FROM \`Return\` WHERE \`companyId\` = ? GROUP BY \`status\``, [companyId]),
  ]);

  // 12-month trend, every month filled.
  const months = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  const invM = new Map(invByMonth.map((x) => [x.m, num(x.amt)]));
  const payM = new Map(payByMonth.map((x) => [x.m, num(x.amt)]));
  const prodM = new Map(prodByMonth.map((x) => [x.m, num(x.pcs)]));
  const trend = months.map((m) => ({
    month: m,
    invoiced: r2(invM.get(m) ?? 0),
    received: r2(payM.get(m) ?? 0),
    produced: Number(prodM.get(m) ?? 0),
  }));

  const aging = { notDue: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90: 0, noTerms: 0, total: 0 };
  for (const a of agingRows) { aging[a.bucket] = r2(a.bal); aging.total = r2(aging.total + num(a.bal)); }

  const invoiced = r2(invAgg?.invoiced);
  const received = r2(payAgg?.received);
  const gstTotal = r2(num(invAgg?.igst) + num(invAgg?.cgst) + num(invAgg?.sgst));
  const totalShare = byState.reduce((s, x) => s + num(x.amt), 0) || 1;

  const coreSplit = { TOROIDAL: 0, RECTANGULAR: 0 };
  for (const c of coreRows) coreSplit[c.ct] = Number(c.pcs);

  const returnsByStatus = returnRows.map((r) => ({ status: r.status, count: Number(r.n) }));
  const openReturns = returnsByStatus.filter((r) => !['CLOSED', 'CANCELLED'].includes(r.status))
    .reduce((s, r) => s + r.count, 0);

  res.json({
    range: { from: rangeStart.toISOString(), to: rangeEnd.toISOString() },
    headline: {
      invoiced,
      received,
      outstanding: r2(outAgg?.outstanding),
      overdue: r2(outAgg?.overdue),
      gst: gstTotal,
      taxable: r2(invAgg?.taxable),
      invoiceCount: Number(invAgg?.cnt ?? 0),
      paymentCount: Number(payAgg?.cnt ?? 0),
      openInvoices: Number(outAgg?.openCount ?? 0),
      customers: Number(invAgg?.customers ?? 0),
      avgInvoice: invAgg?.cnt > 0 ? r2(invoiced / Number(invAgg.cnt)) : 0,
      collectionRate: invoiced > 0 ? Math.round((received / invoiced) * 100) : 0,
    },
    aging,
    trend,
    fulfillment: {
      ordered:    Number(fulfill?.ordered ?? 0),
      produced:   Number(fulfill?.produced ?? 0),
      dispatched: Number(fulfill?.dispatched ?? 0),
      pending:    Math.max(Number(fulfill?.ordered ?? 0) - Number(fulfill?.produced ?? 0), 0),
    },
    topCustomers: topCust.map((c) => ({
      id: c.cid,
      name: c.name ?? '—',
      code: c.code ?? null,
      invoiced: r2(c.invoiced),
      outstanding: r2(c.outstanding),
      share: invoiced > 0 ? Math.round((num(c.invoiced) / invoiced) * 100) : 0,
    })),
    byState: byState.map((s) => ({
      state: s.state, amount: r2(s.amt), count: Number(s.cnt),
      share: Math.round((num(s.amt) / totalShare) * 100),
    })),
    coreSplit: { toroidal: coreSplit.TOROIDAL, rectangular: coreSplit.RECTANGULAR },
    gst: { taxable: r2(invAgg?.taxable), igst: r2(invAgg?.igst), cgst: r2(invAgg?.cgst), sgst: r2(invAgg?.sgst), total: gstTotal },
    returns: { open: openReturns, total: returnsByStatus.reduce((s, r) => s + r.count, 0), byStatus: returnsByStatus },
  });
}));

export default router;
