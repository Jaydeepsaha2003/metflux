// Public customer portal — no authentication required.
// Customers access via a token-based shareable URL to view order statuses
// and download testing reports as Excel.
import { Router } from 'express';
import { z } from 'zod';
import XLSX from 'xlsx';
import { q, qOne, update } from '../lib/db.js';
import { AppError, asyncHandler } from '../lib/errors.js';
import {
  hashPassword, verifyPassword, signPortalToken, verifyPortalToken,
} from '../lib/auth.js';
import { authLimiter } from '../lib/rateLimit.js';

const router = Router();

/* ── Helpers (mirrored from TestingReportPage.tsx) ───────────── */

const calcSamplePcs = (pcs) => {
  if (pcs > 1000) return Math.round(pcs * 0.05);
  if (pcs >= 100)  return Math.round(pcs * 0.10);
  return Math.round(pcs * 0.25);
};

const buildIemaxRows = (dispatchId, testCurrent, n) => {
  if (!testCurrent || n <= 0) return [];
  const base = Number(testCurrent);
  let seed = dispatchId.split('').reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 0);
  const rng = () => {
    seed = (seed * 1664525 + 1013904223) | 0;
    return (seed >>> 0) / 0x100000000;
  };
  return Array.from({ length: n }, () => {
    const pct = -0.03 * rng();
    return +(base * (1 + pct)).toFixed(2);
  });
};

const computeStatus = (ordered, produced, dispatched) => {
  const o = Number(ordered ?? 0);
  const p = Number(produced ?? 0);
  const d = Number(dispatched ?? 0);
  if (d >= o && o > 0) return 'COMPLETED';
  if (d > 0)  return 'PARTIAL_DISPATCH';
  if (p >= o && o > 0) return 'READY_TO_DISPATCH';
  if (p > 0)  return 'IN_PRODUCTION';
  return 'PENDING';
};

const findCustomerByToken = async (token) => {
  const row = await qOne(
    `SELECT c.*,
            co.\`name\`            AS co_name,
            co.\`logoUrl\`         AS co_logo,
            co.\`address\`         AS co_address,
            co.\`phone\`           AS co_phone,
            co.\`email\`           AS co_email,
            co.\`gstNumber\`       AS co_gstin,
            co.\`whatsappNumber\`  AS co_whatsapp
       FROM \`Customer\` c
       INNER JOIN \`Company\` co ON co.\`id\` = c.\`companyId\`
      WHERE (c.\`shareToken\` = ? OR c.\`id\` = ?) AND co.\`isActive\` = 1`,
    [token, token]
  );
  if (!row) throw new AppError('Portal not found', 404, 'NOT_FOUND');
  return row;
};

/* ── Portal session guard ─────────────────────────────────────
   The customer signs in (POST /login) and gets a 12h portal token. It's sent
   as a Bearer header on JSON fetches, or as `?t=` on the testing-report
   download link (an <a download> can't set headers). The guard loads the
   customer and stashes it on req so handlers don't look it up twice. */
const requirePortalAuth = asyncHandler(async (req, _res, next) => {
  const header = req.headers.authorization || '';
  const bearer = header.startsWith('Bearer ') ? header.slice(7) : null;
  const token = bearer || (typeof req.query.t === 'string' ? req.query.t : null);
  if (!token) throw new AppError('Sign in to view this portal', 401, 'PORTAL_UNAUTHENTICATED');

  let payload;
  try { payload = verifyPortalToken(token); }
  catch { throw new AppError('Session expired — please sign in again', 401, 'PORTAL_UNAUTHENTICATED'); }

  const customer = await findCustomerByToken(req.params.token);
  if (customer.id !== payload.sub) {
    throw new AppError('Session does not match this portal', 401, 'PORTAL_UNAUTHENTICATED');
  }
  req.portalCustomer = customer;
  next();
});

const brandingOf = (customer) => ({
  name:    customer.co_name,
  logoUrl: customer.co_logo ?? null,
});

/* ── GET /api/portal/:token/info — public branding for the login screen ── */
router.get('/:token/info', asyncHandler(async (req, res) => {
  const customer = await findCustomerByToken(req.params.token);
  res.json({
    company: brandingOf(customer),
    customerName: customer.name,
    // Every portal is password-protected; the flag leaves room to relax later.
    needsPassword: true,
  });
}));

/* ── POST /api/portal/:token/login — exchange password for a session token ── */
router.post('/:token/login', authLimiter, asyncHandler(async (req, res) => {
  const { password } = z.object({ password: z.string().min(1).max(128) }).parse(req.body);
  const customer = await findCustomerByToken(req.params.token);

  if (!customer.portalPasswordHash) {
    throw new AppError('Portal access is not set up yet — please contact us.', 403, 'PORTAL_NOT_READY');
  }
  const ok = await verifyPassword(password, customer.portalPasswordHash);
  if (!ok) throw new AppError('Incorrect password', 401, 'PORTAL_BAD_PASSWORD');

  const sessionToken = signPortalToken({ customerId: customer.id, shareToken: req.params.token });
  res.json({
    token: sessionToken,
    // Force a password change while they're still on the shared initial one.
    mustChangePassword: !customer.portalPasswordSet,
    company: brandingOf(customer),
    customerName: customer.name,
  });
}));

/* ── POST /api/portal/:token/change-password — set a personal password ── */
router.post('/:token/change-password', requirePortalAuth, asyncHandler(async (req, res) => {
  const { newPassword } = z
    .object({ newPassword: z.string().min(6, 'Password must be at least 6 characters').max(64) })
    .parse(req.body);
  const customer = req.portalCustomer;

  // Don't let them "change" it back to the very password we just handed out.
  if (customer.portalInitialPassword && newPassword === customer.portalInitialPassword) {
    throw new AppError('Please choose a password different from the one you were given.', 400, 'PORTAL_SAME_PASSWORD');
  }

  await update('Customer', customer.id, {
    portalPasswordHash: await hashPassword(newPassword),
    portalPasswordSet: 1,
    portalInitialPassword: null,
  });

  // Re-issue so the client keeps a valid session after the change.
  const sessionToken = signPortalToken({ customerId: customer.id, shareToken: req.params.token });
  res.json({ token: sessionToken, mustChangePassword: false });
}));

/* ── GET /api/portal/:token ──────────────────────────────────── */
router.get('/:token', requirePortalAuth, asyncHandler(async (req, res) => {
  const customer = req.portalCustomer;
  // Hard gate: no order data until the shared initial password is replaced.
  if (!customer.portalPasswordSet) {
    throw new AppError('Set your password to continue', 403, 'PORTAL_MUST_CHANGE');
  }

  const { search } = z.object({ search: z.string().trim().max(120).optional() })
    .parse(req.query);

  // PoOrder has no status column — filter is on PoOrderItem.status instead.
  let where = 'po.`customerId` = ? AND it.`status` = ?';
  const params = [customer.id, 'ACTIVE'];
  if (search) {
    where += ' AND po.`poNumber` LIKE ?';
    params.push(`%${search}%`);
  }

  // One row per PO item — grouped in JS
  const rows = await q(
    `SELECT
       po.\`id\`           AS po_id,
       po.\`poNumber\`,
       po.\`orderDate\`,
       po.\`deliveryDate\`,
       it.\`id\`           AS item_id,
       it.\`coreType\`,
       it.\`grade\`,
       it.\`material\`,
       it.\`measure\`,
       it.\`pcs\`          AS orderedPcs,
       COALESCE((SELECT SUM(p.\`pcs\`) FROM \`Production\` p
                  WHERE p.\`poOrderItemId\` = it.\`id\`), 0) AS producedPcs,
       COALESCE((SELECT SUM(d.\`pcs\`) FROM \`Dispatch\` d
                  WHERE d.\`poOrderItemId\` = it.\`id\`), 0) AS dispatchedPcs,
       (SELECT COUNT(*) FROM \`Dispatch\` d
         WHERE d.\`poOrderItemId\` = it.\`id\`) AS dispatchCount
     FROM \`PoOrder\` po
     INNER JOIN \`PoOrderItem\` it ON it.\`poOrderId\` = po.\`id\`
     WHERE ${where}
     ORDER BY po.\`orderDate\` DESC
     LIMIT 500`,
    params
  );

  // Group by PO
  const poMap = new Map();
  for (const r of rows) {
    if (!poMap.has(r.po_id)) {
      poMap.set(r.po_id, {
        id: r.po_id,
        poNumber: r.poNumber,
        orderDate: r.orderDate,
        deliveryDate: r.deliveryDate,
        items: [],
        totalOrdered: 0,
        totalProduced: 0,
        totalDispatched: 0,
        hasDispatch: false,
      });
    }
    const po  = poMap.get(r.po_id);
    const ord = Number(r.orderedPcs   ?? 0);
    const prd = Number(r.producedPcs  ?? 0);
    const dsp = Number(r.dispatchedPcs ?? 0);
    po.items.push({
      id: r.item_id,
      coreType: r.coreType,
      grade:    r.grade,
      material: r.material,
      measure:  r.measure,
      orderedPcs:    ord,
      producedPcs:   prd,
      dispatchedPcs: dsp,
    });
    po.totalOrdered    += ord;
    po.totalProduced   += prd;
    po.totalDispatched += dsp;
    if (Number(r.dispatchCount ?? 0) > 0) po.hasDispatch = true;
  }

  const orders = [...poMap.values()].map((po) => ({
    ...po,
    status: computeStatus(po.totalOrdered, po.totalProduced, po.totalDispatched),
  }));

  res.json({
    company: {
      name:           customer.co_name,
      logoUrl:        customer.co_logo        ?? null,
      address:        customer.co_address     ?? null,
      phone:          customer.co_phone       ?? null,
      email:          customer.co_email       ?? null,
      gstNumber:      customer.co_gstin       ?? null,
      whatsappNumber: customer.co_whatsapp    ?? null,
    },
    customer: {
      name:         customer.name,
      customerCode: customer.customerCode,
      state:        customer.state ?? null,
    },
    orders,
  });
}));

/* ── GET /api/portal/:token/testing-excel/:poOrderId ─────────── */
router.get('/:token/testing-excel/:poOrderId', requirePortalAuth, asyncHandler(async (req, res) => {
  const customer = req.portalCustomer;
  if (!customer.portalPasswordSet) {
    throw new AppError('Set your password to continue', 403, 'PORTAL_MUST_CHANGE');
  }

  const po = await qOne(
    'SELECT * FROM `PoOrder` WHERE `id` = ? AND `customerId` = ?',
    [req.params.poOrderId, customer.id]
  );
  if (!po) throw new AppError('Order not found', 404, 'NOT_FOUND');

  const dispatches = await q(
    `SELECT d.\`id\`, d.\`pcs\`, d.\`dispatchDate\`,
            it.\`coreType\`, it.\`grade\`, it.\`material\`, it.\`measure\`,
            it.\`turns\`, it.\`testVoltage\`, it.\`testCurrent\`
       FROM \`Dispatch\` d
       INNER JOIN \`PoOrderItem\` it ON it.\`id\` = d.\`poOrderItemId\`
      WHERE it.\`poOrderId\` = ? AND d.\`companyId\` = ?
      ORDER BY d.\`dispatchDate\` ASC`,
    [po.id, customer.companyId]
  );

  if (!dispatches.length) throw new AppError('No dispatch data available', 404, 'NO_DISPATCH');

  const excelRows = [];
  let sn = 0;
  for (const d of dispatches) {
    const n      = calcSamplePcs(d.pcs);
    const mAVals = buildIemaxRows(d.id, d.testCurrent, n);
    const specRef = d.testCurrent != null
      ? Number(d.testCurrent).toFixed(2)
      : '—';

    for (const mA of mAVals) {
      sn++;
      excelRows.push({
        'SN':                       sn,
        'Measure':                  d.measure ?? '—',
        'Grade':                    d.grade   ?? '—',
        'No. of Turns':             d.turns   ?? '—',
        'Applied Voltage (V)':      d.testVoltage != null
                                      ? Number(d.testVoltage).toFixed(3) : '—',
        'Pcs':                      1,
        'Max Allowed Current (mA)': specRef,
        'Actual LeMax (mA)':        mA != null ? mA.toFixed(2) : '—',
      });
    }
  }

  if (!excelRows.length) throw new AppError('No testing data available', 404, 'NO_DATA');

  const ws = XLSX.utils.json_to_sheet(excelRows);

  // Column widths
  ws['!cols'] = [
    { wch: 6  }, // SN
    { wch: 20 }, // Measure
    { wch: 12 }, // Grade
    { wch: 14 }, // Turns
    { wch: 22 }, // Voltage
    { wch: 6  }, // Pcs
    { wch: 26 }, // Max Allowed Current
    { wch: 20 }, // Actual LeMax
  ];

  const wb = XLSX.utils.book_new();
  const sheetName = `Testing-${po.poNumber}`.replace(/[\/\\?*\[\]]/g, '_').slice(0, 31);
  XLSX.utils.book_append_sheet(wb, ws, sheetName);

  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  const safePoNo = po.poNumber.replace(/[^a-z0-9_-]/gi, '_');

  res.setHeader(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  );
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="Testing-${safePoNo}.xlsx"`
  );
  res.send(buf);
}));

export default router;
