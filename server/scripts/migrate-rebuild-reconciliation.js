// ONE-TIME REPAIR: rebuild receivable/payable reconciliation from the bank book.
//
// Bug being fixed: `POST /receipts-payments/post` was not idempotent — every
// upload of the Receipts & Payments (bank book) inserted fresh Payment /
// SupplierPayment rows and re-ran FIFO allocation. Re-uploading the growing
// bank book therefore applied the same money 2–6×, inflating invoice/bill
// `paidAmount` and marking documents PAID that were not (so parties like
// Manthan Electricals showed "no due" when money was still owed).
//
// Repair basis (confirmed with the owner): the de-duplicated cash book is the
// single source of truth for money received/paid. For each company we:
//   1. delete every import-generated Payment/SupplierPayment + its allocations
//      (keeping any genuinely manual payments and their allocations);
//   2. reset each invoice/bill paidAmount to the surviving (manual) allocations;
//   3. re-apply, per party, the TRUE cash-book total (RECEIPT → customers,
//      PAYMENT → suppliers) via the app's own FIFO allocator, oldest first.
//
// Uses the exact production helpers (normName / allocatePaymentFifo /
// allocateSupplierPaymentFifo) so the result equals a correct single import.
// Idempotent: re-running rebuilds to the same state.
//
// Run with:  npm --workspace server run migrate:rebuild-reconciliation
import 'dotenv/config';
import { pool, q, qOne, txn } from '../lib/db.js';
import { normName, round2, invoiceStatus, allocatePaymentFifo } from '../lib/invoicing.js';
import { allocateSupplierPaymentFifo } from '../lib/billsReconcile.js';

// Matches the rows the buggy import created. Manual entries have method NULL and
// are NOT import-tagged, so they survive.
const IMPORT_WHERE = "(`method` IN ('BANK','RECONCILE') OR `notes` LIKE '%Receipts & Payments%' OR `reference` LIKE '%reconciliation%' OR `reference` LIKE '%Receipts & Payments%')";

const tableExists = async (t) => {
  const r = await qOne('SELECT COUNT(*) n FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name=?', [t]);
  return Number(r?.n ?? 0) > 0;
};

async function rebuildReceivables(cid, reconDate, sysUser) {
  // 1. drop import payments + their allocations (keep manual)
  await q(`DELETE pa FROM \`PaymentAllocation\` pa JOIN \`Payment\` p ON p.\`id\`=pa.\`paymentId\` WHERE p.\`companyId\`=? AND ${IMPORT_WHERE}`, [cid]);
  await q(`DELETE FROM \`Payment\` WHERE \`companyId\`=? AND ${IMPORT_WHERE}`, [cid]);

  // 2. reset paidAmount to surviving (manual) allocations; recompute status
  const invs = await q('SELECT `id`,`amount` FROM `SalesInvoice` WHERE `companyId`=?', [cid]);
  for (const inv of invs) {
    const s = await qOne('SELECT COALESCE(SUM(`amount`),0) s FROM `PaymentAllocation` WHERE `salesInvoiceId`=?', [inv.id]);
    const paid = round2(Number(s?.s ?? 0));
    await q('UPDATE `SalesInvoice` SET `paidAmount`=?, `status`=? WHERE `id`=?', [paid, invoiceStatus(inv.amount, paid), inv.id]);
  }

  // 3. true receipts per normalized party (the deduped cash book)
  const rc = await q("SELECT `normKey`, SUM(`amount`) t FROM `CashbookEntry` WHERE `companyId`=? AND `side`='RECEIPT' GROUP BY `normKey`", [cid]);
  const recvMap = new Map(rc.map((r) => [r.normKey, round2(Number(r.t))]));

  const custs = await q('SELECT `id`,`name` FROM `Customer` WHERE `companyId`=?', [cid]);
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
        companyId: cid, customerId: cu.id, customerName: cu.name, amount, allocatedAmount: 0,
        paymentDate: reconDate, method: 'BANK', reference: 'Bank-book reconciliation (rebuilt)',
        notes: 'Rebuilt from cash book', createdById: sysUser,
      });
      const got = await allocatePaymentFifo(tx, { companyId: cid, customerId: cu.id, paymentId: pay.id, amount });
      if (got > 0) await tx.update('Payment', pay.id, { allocatedAmount: got });
      return got;
    });
    applied = round2(applied + a);
  }
  const unmatched = round2([...recvMap.entries()].filter(([k]) => !used.has(k)).reduce((s, [, v]) => s + v, 0));
  return { matched, applied, unmatchedReceipts: unmatched };
}

async function rebuildPayables(cid, reconDate, sysUser) {
  if (!(await tableExists('SupplierPayment'))) return { matched: 0, applied: 0, unmatchedPayments: 0 };
  await q(`DELETE spa FROM \`SupplierPaymentAllocation\` spa JOIN \`SupplierPayment\` sp ON sp.\`id\`=spa.\`supplierPaymentId\` WHERE sp.\`companyId\`=? AND ${IMPORT_WHERE}`, [cid]);
  await q(`DELETE FROM \`SupplierPayment\` WHERE \`companyId\`=? AND ${IMPORT_WHERE}`, [cid]);

  const bills = await q('SELECT `id`,`amount` FROM `PurchaseInvoice` WHERE `companyId`=?', [cid]);
  for (const b of bills) {
    const s = await qOne('SELECT COALESCE(SUM(`amount`),0) s FROM `SupplierPaymentAllocation` WHERE `purchaseInvoiceId`=?', [b.id]);
    const paid = round2(Number(s?.s ?? 0));
    await q('UPDATE `PurchaseInvoice` SET `paidAmount`=?, `status`=? WHERE `id`=?', [paid, invoiceStatus(b.amount, paid), b.id]);
  }

  const pc = await q("SELECT `normKey`, SUM(`amount`) t FROM `CashbookEntry` WHERE `companyId`=? AND `side`='PAYMENT' GROUP BY `normKey`", [cid]);
  const payMap = new Map(pc.map((r) => [r.normKey, round2(Number(r.t))]));

  // Group open purchase bills by normalized supplier name (no supplier FK).
  const allPI = await q('SELECT * FROM `PurchaseInvoice` WHERE `companyId`=? ORDER BY `invoiceDate` ASC, `createdAt` ASC', [cid]);
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
      const fresh = await tx.q(`SELECT * FROM \`PurchaseInvoice\` WHERE \`companyId\`=? AND \`id\` IN (${g.ids.map(() => '?').join(',')}) ORDER BY \`invoiceDate\` ASC, \`createdAt\` ASC`, [cid, ...g.ids]);
      const sp = await tx.insert('SupplierPayment', {
        companyId: cid, supplierName: g.displayName, amount, allocatedAmount: 0,
        paymentDate: reconDate, method: 'BANK', reference: 'Bank-book reconciliation (rebuilt)',
        notes: 'Rebuilt from cash book', createdById: sysUser,
      });
      const got = await allocateSupplierPaymentFifo(tx, { companyId: cid, paymentId: sp.id, amount, invoices: fresh });
      if (got > 0) await tx.update('SupplierPayment', sp.id, { allocatedAmount: got });
      return got;
    });
    applied = round2(applied + a);
  }
  const unmatched = round2([...payMap.entries()].filter(([k]) => !usedKeys.has(k)).reduce((s, [, v]) => s + v, 0));
  return { matched, applied, unmatchedPayments: unmatched };
}

const main = async () => {
  const companies = await q('SELECT `id`,`name` FROM `Company`');
  for (const co of companies) {
    const cid = co.id;
    const dateRow = await qOne('SELECT MAX(`entryDate`) d FROM `CashbookEntry` WHERE `companyId`=?', [cid]);
    const reconDate = dateRow?.d ? new Date(dateRow.d) : new Date();
    const userRow = await qOne('SELECT `createdById` u FROM `SalesInvoice` WHERE `companyId`=? AND `createdById` IS NOT NULL LIMIT 1', [cid])
                 || await qOne('SELECT `id` u FROM `User` LIMIT 1');
    const sysUser = userRow?.u ?? null;

    const r = await rebuildReceivables(cid, reconDate, sysUser);
    const p = await rebuildPayables(cid, reconDate, sysUser);
    console.log(`[${co.name}] receivables: matched ${r.matched} parties, applied ${r.applied}, unmatched receipts ${r.unmatchedReceipts}`);
    console.log(`[${co.name}] payables:    matched ${p.matched} parties, applied ${p.applied}, unmatched payments ${p.unmatchedPayments}`);
  }
  console.log('[migrate] reconciliation rebuild complete.');
};

main().catch((e) => { console.error('[migrate] failed:', e); process.exitCode = 1; }).finally(() => pool.end());
