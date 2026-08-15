// Everything that can point at a Supplier, for deciding whether one is safe to
// remove from a company.
//
// Two wrinkles make this different from customers:
//  • Purchase bills and supplier payments link by NAME, not id, so they're
//    matched on the normalized name (catching "M/S ACME" vs "Acme").
//  • A Supplier row is SHARED across companies through SupplierMembership, so
//    "delete" means drop THIS company's membership; the row itself only goes
//    once no company still uses it.
import { q, qOne } from './db.js';
import { normName } from './invoicing.js';
import { DERIVED_PAYMENT_NOTES, SUPPLIER_DERIVED } from './derivedPayments.js';

/** Counts scoped to one company, plus how many companies share the record. */
export const countSupplierRefs = async (supplierId, companyId, supplierName) => {
  const nk = normName(supplierName);
  // Grouped so a big register doesn't come back row by row just to be counted.
  const [poRow, piRows, spRows, memberships] = await Promise.all([
    qOne('SELECT COUNT(*) n FROM `SupplierOrder` WHERE `supplierId` = ? AND `companyId` = ?', [supplierId, companyId]).catch(() => ({ n: 0 })),
    q('SELECT `supplierName` nm, COUNT(*) n FROM `PurchaseInvoice` WHERE `companyId` = ? GROUP BY `supplierName`', [companyId]).catch(() => []),
    q(`SELECT p.\`supplierName\` nm,
              SUM(CASE WHEN ${SUPPLIER_DERIVED('p')} THEN 0 ELSE 1 END) n,
              SUM(CASE WHEN ${SUPPLIER_DERIVED('p')} THEN 1 ELSE 0 END) d
         FROM \`SupplierPayment\` p WHERE p.\`companyId\` = ? GROUP BY p.\`supplierName\``,
      [...DERIVED_PAYMENT_NOTES, ...DERIVED_PAYMENT_NOTES, companyId]).catch(() => []),
    q('SELECT `companyId` FROM `SupplierMembership` WHERE `supplierId` = ?', [supplierId]).catch(() => []),
  ]);
  const sumMatching = (rows, col = 'n') => rows.reduce((s, r) => (normName(r.nm) === nk ? s + Number(r[col] ?? 0) : s), 0);
  return {
    SupplierOrder: Number(poRow?.n ?? 0),
    PurchaseInvoice: sumMatching(piRows),
    SupplierPayment: sumMatching(spRows),
    derivedPayments: sumMatching(spRows, 'd'),
    companies: memberships.length,
    otherCompanies: memberships.filter((m) => m.companyId !== companyId).length,
  };
};

/** ["2 purchase bills", "1 payment"] — empty when safe to remove. */
/** Remove the system-made supplier payments for a name — call inside the txn. */
export const deleteDerivedSupplierPayments = async (tx, companyId, supplierName) => {
  const nk = normName(supplierName);
  const rows = await tx.q(
    `SELECT p.\`id\`, p.\`supplierName\` nm FROM \`SupplierPayment\` p
      WHERE p.\`companyId\` = ? AND ${SUPPLIER_DERIVED('p')}`,
    [companyId, ...DERIVED_PAYMENT_NOTES]
  ).catch(() => []);
  const ids = rows.filter((r) => normName(r.nm) === nk).map((r) => r.id);
  if (!ids.length) return 0;
  await tx.q(`DELETE FROM \`SupplierPayment\` WHERE \`id\` IN (${ids.map(() => '?').join(',')})`, ids);
  return ids.length;
};

export const supplierBlockers = (counts) => {
  const out = [];
  const add = (n, one, many) => { if (n > 0) out.push(`${n} ${n === 1 ? one : many}`); };
  add(counts.SupplierOrder, 'supplier order', 'supplier orders');
  add(counts.PurchaseInvoice, 'purchase bill', 'purchase bills');
  add(counts.SupplierPayment, 'payment', 'payments');
  return out;
};
