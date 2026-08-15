// Everything that can point at a Customer. Used to decide whether a customer is
// safe to delete — PoOrder and Return carry ON DELETE RESTRICT, so deleting a
// referenced row fails at the database with an opaque error; the rest would be
// silently orphaned. Both cases are worth refusing with a readable reason.
import { qOne } from './db.js';

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
    const row = await qOne(`SELECT COUNT(*) n FROM \`${r.table}\` WHERE \`customerId\` = ?`, [customerId]).catch(() => ({ n: 0 }));
    counts[r.table] = Number(row?.n ?? 0);
  }
  return counts;
};

/** ["2 sales invoices", "1 return"] — empty when the customer is safe to delete. */
export const customerBlockers = (counts) =>
  CUSTOMER_REFS
    .filter((r) => counts[r.table] > 0)
    .map((r) => `${counts[r.table]} ${counts[r.table] === 1 ? r.label : r.plural}`);
