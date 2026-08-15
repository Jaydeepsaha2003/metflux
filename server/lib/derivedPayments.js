// Payments the SYSTEM created from the cash book, rather than ones a person
// recorded.
//
// The reconciliation rebuild wipes and recreates a Payment per party on every
// Recompute, and the bank-book import creates them too. For a party with no
// invoices to settle they end up unallocated — pure derived state that is
// regenerated on the next Recompute.
//
// They must therefore NOT block deleting a party: doing so blocks on a record
// the system made up about itself. One that IS allocated to an invoice is a
// different matter — something depends on it, so it still blocks.
export const DERIVED_PAYMENT_NOTES = [
  'Rebuilt from cash book',              // lib/reconcileRebuild.js
  'Receipts & Payments import',          // routes/receiptsPayments.js
  'Cashbook adjust (classified later)',  // routes/cashbook.js
];

/**
 * SQL predicate for "system-made AND nothing depends on it".
 * @param alias  the payment table alias in the surrounding query
 * @param allocTable  its allocation table
 * @param fk  the column in the allocation table pointing back at the payment
 */
export const derivedPaymentSql = (alias, allocTable, fk) =>
  `${alias}.\`notes\` IN (${DERIVED_PAYMENT_NOTES.map(() => '?').join(',')})
   AND ${alias}.\`allocatedAmount\` = 0
   AND NOT EXISTS (SELECT 1 FROM \`${allocTable}\` _a WHERE _a.\`${fk}\` = ${alias}.\`id\`)`;

export const CUSTOMER_DERIVED = (alias = 'p') => derivedPaymentSql(alias, 'PaymentAllocation', 'paymentId');
export const SUPPLIER_DERIVED = (alias = 'p') => derivedPaymentSql(alias, 'SupplierPaymentAllocation', 'supplierPaymentId');
