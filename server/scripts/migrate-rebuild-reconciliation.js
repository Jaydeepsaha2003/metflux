// ONE-TIME REPAIR: rebuild receivable/payable reconciliation from the bank book.
//
// Bug being fixed: POST /receipts-payments/post was not idempotent — every
// upload of the Receipts & Payments (bank book) inserted fresh Payment /
// SupplierPayment rows and re-ran FIFO, applying the same money 2-6x and leaving
// spurious "On Account" advances that never flowed onto newer invoices.
//
// This rebuilds paidAmount/status on every sales + purchase invoice from the
// de-duplicated cash book (the confirmed source of truth), FIFO across ALL
// current invoices, for every company. Idempotent — re-running gives the same
// state. Shares the exact logic used by the live "Recompute from bank book"
// action (server/lib/reconcileRebuild.js).
//
// Run with:  npm --workspace server run migrate:rebuild-reconciliation
import 'dotenv/config';
import { pool, q } from '../lib/db.js';
import { rebuildCompanyReconciliation } from '../lib/reconcileRebuild.js';

const main = async () => {
  const companies = await q('SELECT `id`,`name` FROM `Company`');
  for (const co of companies) {
    const { receivables: r, payables: p } = await rebuildCompanyReconciliation(co.id);
    console.log(`[${co.name}] receivables: matched ${r.matched} parties, applied ${r.applied}, on-account ${r.onAccount}`);
    console.log(`[${co.name}] payables:    matched ${p.matched} parties, applied ${p.applied}, on-account ${p.onAccount}`);
  }
  console.log('[migrate] reconciliation rebuild complete.');
};

main().catch((e) => { console.error('[migrate] failed:', e); process.exitCode = 1; }).finally(() => pool.end());
