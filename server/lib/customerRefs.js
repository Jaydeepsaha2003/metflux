// Everything that can point at a Customer. Used to decide whether a customer is
// safe to delete — PoOrder and Return carry ON DELETE RESTRICT, so deleting a
// referenced row fails at the database with an opaque error; the rest would be
// silently orphaned. Both cases are worth refusing with a readable reason.
import { qOne } from './db.js';
import { DERIVED_PAYMENT_NOTES, CUSTOMER_DERIVED } from './derivedPayments.js';

export const CUSTOMER_REFS = [
  { table: 'SalesInvoice', label: 'sales invoice',  plural: 'sales invoices' },
  { table: 'PoOrder',      label: 'sales order',    plural: 'sales orders' },
  { table: 'Quotation',    label: 'quotation',      plural: 'quotations' },
  { table: 'Return',       label: 'return',         plural: 'returns' },
  { table: 'Payment',      label: 'payment',        plural: 'payments' },
];

/** { SalesInvoice: 0, PoOrder: 2, ... } — a missing table counts as 0. */
export const countCustomerRefs = async (customerId) => {
  const counts = {};
  for (const r of CUSTOMER_REFS) {
    if (r.table === 'Payment') continue;
    const row = await qOne(`SELECT COUNT(*) n FROM \`${r.table}\` WHERE \`customerId\` = ?`, [customerId]).catch(() => ({ n: 0 }));
    counts[r.table] = Number(row?.n ?? 0);
  }
  // Payments split two ways: ones a person recorded (or that settle an invoice)
  // genuinely block; ones the cash-book rebuild invented for this party do not —
  // they're derived state, regenerated on the next Recompute, and are removed
  // along with the party.
  const pay = await qOne(
    `SELECT
       SUM(CASE WHEN ${CUSTOMER_DERIVED('p')} THEN 0 ELSE 1 END) real_,
       SUM(CASE WHEN ${CUSTOMER_DERIVED('p')} THEN 1 ELSE 0 END) derived
     FROM \`Payment\` p WHERE p.\`customerId\` = ?`,
    [...DERIVED_PAYMENT_NOTES, ...DERIVED_PAYMENT_NOTES, customerId]
  ).catch(() => ({ real_: 0, derived: 0 }));
  counts.Payment = Number(pay?.real_ ?? 0);
  counts.derivedPayments = Number(pay?.derived ?? 0);
  return counts;
};

/** Remove the system-made payments for a party — call inside the delete txn. */
export const deleteDerivedCustomerPayments = async (tx, customerId) =>
  tx.q(`DELETE p FROM \`Payment\` p WHERE p.\`customerId\` = ? AND ${CUSTOMER_DERIVED('p')}`,
       [customerId, ...DERIVED_PAYMENT_NOTES]).catch(() => {});

/** ["2 sales invoices", "1 return"] — empty when the customer is safe to delete. */
export const customerBlockers = (counts) =>
  CUSTOMER_REFS
    .filter((r) => counts[r.table] > 0)
    .map((r) => `${counts[r.table]} ${counts[r.table] === 1 ? r.label : r.plural}`);
