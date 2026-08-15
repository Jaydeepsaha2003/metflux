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

/** Counts scoped to one company, plus how many companies share the record. */
export const countSupplierRefs = async (supplierId, companyId, supplierName) => {
  const nk = normName(supplierName);
  // Grouped so a big register doesn't come back row by row just to be counted.
  const [poRow, piRows, spRows, memberships] = await Promise.all([
    qOne('SELECT COUNT(*) n FROM `SupplierOrder` WHERE `supplierId` = ? AND `companyId` = ?', [supplierId, companyId]).catch(() => ({ n: 0 })),
    q('SELECT `supplierName` nm, COUNT(*) n FROM `PurchaseInvoice` WHERE `companyId` = ? GROUP BY `supplierName`', [companyId]).catch(() => []),
    q('SELECT `supplierName` nm, COUNT(*) n FROM `SupplierPayment` WHERE `companyId` = ? GROUP BY `supplierName`', [companyId]).catch(() => []),
    q('SELECT `companyId` FROM `SupplierMembership` WHERE `supplierId` = ?', [supplierId]).catch(() => []),
  ]);
  const sumMatching = (rows) => rows.reduce((s, r) => (normName(r.nm) === nk ? s + Number(r.n) : s), 0);
  return {
    SupplierOrder: Number(poRow?.n ?? 0),
    PurchaseInvoice: sumMatching(piRows),
    SupplierPayment: sumMatching(spRows),
    companies: memberships.length,
    otherCompanies: memberships.filter((m) => m.companyId !== companyId).length,
  };
};

/** ["2 purchase bills", "1 payment"] — empty when safe to remove. */
export const supplierBlockers = (counts) => {
  const out = [];
  const add = (n, one, many) => { if (n > 0) out.push(`${n} ${n === 1 ? one : many}`); };
  add(counts.SupplierOrder, 'supplier order', 'supplier orders');
  add(counts.PurchaseInvoice, 'purchase bill', 'purchase bills');
  add(counts.SupplierPayment, 'payment', 'payments');
  return out;
};
