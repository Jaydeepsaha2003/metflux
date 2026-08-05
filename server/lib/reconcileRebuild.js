// Re-derive the whole receivable/payable position for a company from the
// de-duplicated cash book (the bank book = source of truth), instead of relying
// on drifting incremental allocations.
//
// For each party it: (1) removes prior bank-reconciliation Payments/SupplierPayments
// and their allocations (genuine manual payments are kept), (2) resets each
// invoice/bill paidAmount to the surviving manual allocations, (3) re-applies the
// party's TRUE cash-book total by FIFO across ALL their current invoices — oldest
// first — using the app's own allocators. Result: an advance/"On Account" credit
// automatically flows onto newer invoices, and a credit only ever remains when a
// party genuinely paid more than they were billed. Idempotent.
import { q, qOne, txn } from './db.js';
import { normName, round2, invoiceStatus, allocatePaymentFifo } from './invoicing.js';
import { allocateSupplierPaymentFifo } from './billsReconcile.js';

// Rows the bank-book reconciliation created. Manual payments (method NULL or a
// non-reconciliation method) are NOT matched, so they survive untouched.
const IMPORT_WHERE = "(`method` IN ('BANK','RECONCILE') OR `notes` LIKE '%Receipts & Payments%' OR `reference` LIKE '%reconciliation%' OR `reference` LIKE '%Receipts & Payments%')";

const tableExists = async (t) => {
  const r = await qOne('SELECT COUNT(*) n FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name=?', [t]);
  return Number(r?.n ?? 0) > 0;
};

export async function rebuildReceivables(companyId, reconDate, sysUser) {
  await q(`DELETE pa FROM \`PaymentAllocation\` pa JOIN \`Payment\` p ON p.\`id\`=pa.\`paymentId\` WHERE p.\`companyId\`=? AND ${IMPORT_WHERE}`, [companyId]);
  await q(`DELETE FROM \`Payment\` WHERE \`companyId\`=? AND ${IMPORT_WHERE}`, [companyId]);

  const invs = await q('SELECT `id`,`amount` FROM `SalesInvoice` WHERE `companyId`=?', [companyId]);
  for (const inv of invs) {
    const s = await qOne('SELECT COALESCE(SUM(`amount`),0) s FROM `PaymentAllocation` WHERE `salesInvoiceId`=?', [inv.id]);
    const paid = round2(Number(s?.s ?? 0));
    await q('UPDATE `SalesInvoice` SET `paidAmount`=?, `status`=? WHERE `id`=?', [paid, invoiceStatus(inv.amount, paid), inv.id]);
  }

  const rc = await q("SELECT `normKey`, SUM(`amount`) t FROM `CashbookEntry` WHERE `companyId`=? AND `side`='RECEIPT' GROUP BY `normKey`", [companyId]);
  const recvMap = new Map(rc.map((r) => [r.normKey, round2(Number(r.t))]));

  const custs = await q('SELECT `id`,`name` FROM `Customer` WHERE `companyId`=?', [companyId]);
  const used = new Set();
  let applied = 0, matched = 0;
  for (const cu of custs) {
    const key = normName(cu.name);
    if (used.has(key)) continue;
    const amount = recvMap.get(key) || 0;
    if (amount <= 0.01) continue;
    used.add(key);
    matched++;
    const a = await txn(async (tx) => {
      const pay = await tx.insert('Payment', {
        companyId, customerId: cu.id, customerName: cu.name, amount, allocatedAmount: 0,
        paymentDate: reconDate, method: 'BANK', reference: 'Bank-book reconciliation (rebuilt)',
        notes: 'Rebuilt from cash book', createdById: sysUser,
      });
      const got = await allocatePaymentFifo(tx, { companyId, customerId: cu.id, paymentId: pay.id, amount });
      if (got > 0) await tx.update('Payment', pay.id, { allocatedAmount: got });
      return got;
    });
    applied = round2(applied + a);
  }
  const onAccount = round2([...recvMap.entries()].filter(([k]) => used.has(k)).reduce((s, [, v]) => s + v, 0) - applied);
  return { matched, applied, onAccount };
}

export async function rebuildPayables(companyId, reconDate, sysUser) {
  if (!(await tableExists('SupplierPayment'))) return { matched: 0, applied: 0, onAccount: 0 };
  await q(`DELETE spa FROM \`SupplierPaymentAllocation\` spa JOIN \`SupplierPayment\` sp ON sp.\`id\`=spa.\`supplierPaymentId\` WHERE sp.\`companyId\`=? AND ${IMPORT_WHERE}`, [companyId]);
  await q(`DELETE FROM \`SupplierPayment\` WHERE \`companyId\`=? AND ${IMPORT_WHERE}`, [companyId]);

  const bills = await q('SELECT `id`,`amount` FROM `PurchaseInvoice` WHERE `companyId`=?', [companyId]);
  for (const b of bills) {
    const s = await qOne('SELECT COALESCE(SUM(`amount`),0) s FROM `SupplierPaymentAllocation` WHERE `purchaseInvoiceId`=?', [b.id]);
    const paid = round2(Number(s?.s ?? 0));
    await q('UPDATE `PurchaseInvoice` SET `paidAmount`=?, `status`=? WHERE `id`=?', [paid, invoiceStatus(b.amount, paid), b.id]);
  }

  const pc = await q("SELECT `normKey`, SUM(`amount`) t FROM `CashbookEntry` WHERE `companyId`=? AND `side`='PAYMENT' GROUP BY `normKey`", [companyId]);
  const payMap = new Map(pc.map((r) => [r.normKey, round2(Number(r.t))]));

  const allPI = await q('SELECT * FROM `PurchaseInvoice` WHERE `companyId`=? ORDER BY `invoiceDate` ASC, `createdAt` ASC', [companyId]);
  const groups = new Map();
  for (const pi of allPI) {
    const key = normName(pi.supplierName);
    if (!groups.has(key)) groups.set(key, { key, displayName: pi.supplierName, ids: [] });
    groups.get(key).ids.push(pi.id);
  }
  let applied = 0, matched = 0;
  const usedKeys = new Set();
  for (const g of groups.values()) {
    const amount = payMap.get(g.key) || 0;
    if (amount <= 0.01) continue;
    usedKeys.add(g.key);
    matched++;
    const a = await txn(async (tx) => {
      const fresh = await tx.q(`SELECT * FROM \`PurchaseInvoice\` WHERE \`companyId\`=? AND \`id\` IN (${g.ids.map(() => '?').join(',')}) ORDER BY \`invoiceDate\` ASC, \`createdAt\` ASC`, [companyId, ...g.ids]);
      const sp = await tx.insert('SupplierPayment', {
        companyId, supplierName: g.displayName, amount, allocatedAmount: 0,
        paymentDate: reconDate, method: 'BANK', reference: 'Bank-book reconciliation (rebuilt)',
        notes: 'Rebuilt from cash book', createdById: sysUser,
      });
      const got = await allocateSupplierPaymentFifo(tx, { companyId, paymentId: sp.id, amount, invoices: fresh });
      if (got > 0) await tx.update('SupplierPayment', sp.id, { allocatedAmount: got });
      return got;
    });
    applied = round2(applied + a);
  }
  const onAccount = round2([...payMap.entries()].filter(([k]) => usedKeys.has(k)).reduce((s, [, v]) => s + v, 0) - applied);
  return { matched, applied, onAccount };
}

/** Rebuild both sides for one company. Returns a summary. */
export async function rebuildCompanyReconciliation(companyId) {
  const dateRow = await qOne('SELECT MAX(`entryDate`) d FROM `CashbookEntry` WHERE `companyId`=?', [companyId]);
  const reconDate = dateRow?.d ? new Date(dateRow.d) : new Date();
  const userRow = await qOne('SELECT `createdById` u FROM `SalesInvoice` WHERE `companyId`=? AND `createdById` IS NOT NULL LIMIT 1', [companyId])
               || await qOne('SELECT `id` u FROM `User` LIMIT 1');
  const sysUser = userRow?.u ?? null;
  const receivables = await rebuildReceivables(companyId, reconDate, sysUser);
  const payables = await rebuildPayables(companyId, reconDate, sysUser);
  return { receivables, payables };
}
