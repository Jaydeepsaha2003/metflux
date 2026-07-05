// Payments received from customers, applied to open invoices on a FIFO basis
// (oldest due first). Single payments are recorded from the Receive Payments
// form; bulk payments come from the downloadable template. Deleting a payment
// reverses its allocations.
import { Router } from 'express';
import { z } from 'zod';
import { q, qOne, txn } from '../lib/db.js';
import { AppError, asyncHandler } from '../lib/errors.js';
import { requireAuth, requireAnyPermission } from '../lib/auth.js';
import { resolveTenant } from '../lib/tenant.js';
import { round2, invoiceStatus, parseDMY, normName, allocatePaymentFifo, allocatePaymentManual } from '../lib/invoicing.js';
import { cellPick, numOpt, rowIsBlank, errMessage } from '../lib/importHelpers.js';

const router = Router();
router.use(requireAuth, resolveTenant);

const createSchema = z.object({
  customerId:  z.string().min(1),
  amount:      z.coerce.number().positive(),
  paymentDate: z.coerce.date(),
  method:      z.string().trim().max(40).optional().nullable(),
  reference:   z.string().trim().max(120).optional().nullable(),
  notes:       z.string().trim().max(400).optional().nullable(),
  // How to apply the payment:
  //   AUTO         — FIFO across open invoices, oldest due first (default)
  //   BILL_TO_BILL — only the invoices the user picked, in `allocations`
  //   ADVANCE      — apply nothing; keep the whole amount as credit
  mode:        z.enum(['AUTO', 'BILL_TO_BILL', 'ADVANCE']).default('AUTO'),
  allocations: z.array(z.object({
    salesInvoiceId: z.string().min(1),
    amount:         z.coerce.number().positive(),
  })).max(500).optional(),
});

// Insert a Payment and allocate it per `mode`. `tx` is a txn handle.
const recordPayment = async (tx, { companyId, userId, customer, amount, paymentDate, method, reference, notes, mode = 'AUTO', allocations }) => {
  const pay = await tx.insert('Payment', {
    companyId,
    customerId:   customer.id,
    customerName: customer.name,
    amount:       round2(amount),
    allocatedAmount: 0,
    paymentDate,
    method:    method ?? null,
    reference: reference ?? null,
    notes:     notes ?? null,
    createdById: userId,
  });

  let allocated = 0;
  if (mode === 'ADVANCE') {
    allocated = 0; // pure advance / credit — applied to nothing
  } else if (mode === 'BILL_TO_BILL') {
    allocated = await allocatePaymentManual(tx, { companyId, customerId: customer.id, paymentId: pay.id, amount, allocations });
  } else {
    allocated = await allocatePaymentFifo(tx, { companyId, customerId: customer.id, paymentId: pay.id, amount });
  }

  if (allocated > 0) await tx.update('Payment', pay.id, { allocatedAmount: allocated });
  return { paymentId: pay.id, allocated: round2(allocated), unallocated: round2(amount - allocated) };
};

/* ---------- POST / — record a single payment ---------- */
router.post('/', requireAnyPermission('receive_payments', 'manage_invoices'), asyncHandler(async (req, res) => {
  const data = createSchema.parse(req.body);
  const customer = await qOne('SELECT `id`, `name` FROM `Customer` WHERE `id` = ? AND `companyId` = ?', [data.customerId, req.tenant.companyId]);
  if (!customer) throw new AppError('Customer not found', 400, 'BAD_CUSTOMER');
  const result = await txn((tx) => recordPayment(tx, { companyId: req.tenant.companyId, userId: req.auth.userId, customer, ...data }));
  res.status(201).json(result);
}));

/* ---------- POST /import — bulk payments from the template ---------- */
router.post('/import', requireAnyPermission('receive_payments', 'manage_invoices'), asyncHandler(async (req, res) => {
  const { rows } = z.object({ rows: z.array(z.record(z.any())).max(5000) }).parse(req.body);

  const customers = await q('SELECT `id`, `name`, `customerCode` FROM `Customer` WHERE `companyId` = ?', [req.tenant.companyId]);
  const byCode = new Map();
  const byName = new Map();
  for (const c of customers) {
    if (c.customerCode) byCode.set(c.customerCode.toUpperCase(), c);
    const k = normName(c.name);
    if (k && !byName.has(k)) byName.set(k, c);
  }

  let recorded = 0, skipped = 0, allocatedTotal = 0;
  const errors = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNo = i + 2;
    if (rowIsBlank(row)) { skipped++; continue; }

    const code = cellPick(row, 'Customer Code', 'Code');
    const name = cellPick(row, 'Customer', 'Customer Name', 'Name', 'Particulars');
    const amount = numOpt(cellPick(row, 'Amount', 'Payment', 'Amount Received', 'Received'));
    const dateStr = cellPick(row, 'Date', 'Payment Date');
    const reference = cellPick(row, 'Reference', 'Ref', 'UTR', 'Cheque No', 'Cheque');

    if (amount == null || amount <= 0) { errors.push({ row: rowNo, name: name || code, message: 'Missing or invalid Amount' }); continue; }
    let customer = null;
    if (code) customer = byCode.get(code.toUpperCase());
    if (!customer && name) customer = byName.get(normName(name));
    if (!customer) { errors.push({ row: rowNo, name: name || code, message: 'Customer not matched' }); continue; }

    const paymentDate = parseDMY(dateStr) ?? new Date();
    try {
      const r = await txn((tx) => recordPayment(tx, {
        companyId: req.tenant.companyId, userId: req.auth.userId, customer,
        amount, paymentDate, reference,
      }));
      recorded++;
      allocatedTotal = round2(allocatedTotal + r.allocated);
    } catch (e) {
      errors.push({ row: rowNo, name: customer.name, message: errMessage(e) });
    }
  }

  res.json({ recorded, skipped, allocated: round2(allocatedTotal), errors: errors.slice(0, 100) });
}));

/* ---------- GET /outstanding/:customerId — open invoices for the FIFO preview ---------- */
router.get('/outstanding/:customerId', requireAnyPermission('receive_payments', 'manage_invoices'), asyncHandler(async (req, res) => {
  const rows = await q(
    `SELECT * FROM \`SalesInvoice\`
       WHERE \`companyId\` = ? AND \`customerId\` = ? AND \`status\` <> 'PAID'
       ORDER BY (\`dueDate\` IS NULL), \`dueDate\` ASC, \`invoiceDate\` ASC`,
    [req.tenant.companyId, req.params.customerId]
  );
  const open = rows
    .map((r) => ({ id: r.id, invoiceNumber: r.invoiceNumber, invoiceDate: r.invoiceDate, dueDate: r.dueDate, balance: round2(Number(r.amount) - Number(r.paidAmount)) }))
    .filter((x) => x.balance > 0.01);
  res.json({ open, totalOutstanding: round2(open.reduce((s, x) => s + x.balance, 0)) });
}));

/* ---------- GET / — payment history with allocations ---------- */
router.get('/', requireAnyPermission('receive_payments', 'manage_invoices'), asyncHandler(async (req, res) => {
  const { search } = z.object({ search: z.string().trim().max(120).optional() }).parse(req.query);
  let where = 'p.`companyId` = ?';
  const params = [req.tenant.companyId];
  if (search) { const like = `%${search}%`; where += ' AND (p.`customerName` LIKE ? OR p.`reference` LIKE ?)'; params.push(like, like); }

  const payments = await q(
    `SELECT p.* FROM \`Payment\` p WHERE ${where} ORDER BY p.\`paymentDate\` DESC, p.\`createdAt\` DESC LIMIT 1000`,
    params
  );

  const allocsByPayment = new Map();
  if (payments.length) {
    const ids = payments.map((p) => p.id);
    const ph = ids.map(() => '?').join(',');
    const allocs = await q(
      `SELECT pa.*, si.\`invoiceNumber\` AS invoiceNumber
         FROM \`PaymentAllocation\` pa
         INNER JOIN \`SalesInvoice\` si ON si.\`id\` = pa.\`salesInvoiceId\`
        WHERE pa.\`paymentId\` IN (${ph})`,
      ids
    );
    for (const a of allocs) {
      if (!allocsByPayment.has(a.paymentId)) allocsByPayment.set(a.paymentId, []);
      allocsByPayment.get(a.paymentId).push({ invoiceNumber: a.invoiceNumber, amount: Number(a.amount) });
    }
  }

  res.json({
    items: payments.map((p) => ({
      id: p.id,
      customerId: p.customerId,
      customerName: p.customerName,
      amount: Number(p.amount),
      allocatedAmount: Number(p.allocatedAmount),
      unallocated: round2(Number(p.amount) - Number(p.allocatedAmount)),
      paymentDate: p.paymentDate,
      reference: p.reference,
      method: p.method,
      createdAt: p.createdAt,
      allocations: allocsByPayment.get(p.id) ?? [],
    })),
  });
}));

/* ---------- DELETE /:id — reverse allocations, then remove the payment ---------- */
router.delete('/:id', requireAnyPermission('receive_payments', 'manage_invoices'), asyncHandler(async (req, res) => {
  const pay = await qOne('SELECT * FROM `Payment` WHERE `id` = ? AND `companyId` = ?', [req.params.id, req.tenant.companyId]);
  if (!pay) throw new AppError('Payment not found', 404, 'NOT_FOUND');
  await txn(async (tx) => {
    const allocs = await tx.q('SELECT * FROM `PaymentAllocation` WHERE `paymentId` = ?', [pay.id]);
    for (const a of allocs) {
      const inv = await tx.qOne('SELECT * FROM `SalesInvoice` WHERE `id` = ?', [a.salesInvoiceId]);
      if (inv) {
        const newPaid = Math.max(0, round2(Number(inv.paidAmount) - Number(a.amount)));
        await tx.update('SalesInvoice', inv.id, { paidAmount: newPaid, status: invoiceStatus(inv.amount, newPaid) });
      }
    }
    await tx.q('DELETE FROM `PaymentAllocation` WHERE `paymentId` = ?', [pay.id]);
    await tx.q('DELETE FROM `Payment` WHERE `id` = ?', [pay.id]);
  });
  res.status(204).end();
}));

export default router;
