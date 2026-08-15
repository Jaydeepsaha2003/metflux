// What a user has actually created, for deciding whether the account can be
// removed outright rather than just deactivated.
//
// `createdById` is stamped on ~18 business tables with no cascade, so hard-
// deleting an active user would orphan every record they ever made. A permanent
// delete is therefore only offered when they have created nothing at all —
// otherwise deactivating is the correct action and keeps the trail intact.
import { qOne } from './db.js';

/** Business records that must never be orphaned. */
export const USER_CREATED_TABLES = [
  { table: 'PoOrder',          one: 'sales order',     many: 'sales orders' },
  { table: 'Quotation',        one: 'quotation',       many: 'quotations' },
  { table: 'Production',       one: 'production entry', many: 'production entries' },
  { table: 'Dispatch',         one: 'dispatch',        many: 'dispatches' },
  { table: 'PackingList',      one: 'packing list',    many: 'packing lists' },
  { table: 'WorkAllotment',    one: 'work allotment',  many: 'work allotments' },
  { table: 'Return',           one: 'return',          many: 'returns' },
  { table: 'SalesInvoice',     one: 'sales invoice',   many: 'sales invoices' },
  { table: 'PurchaseInvoice',  one: 'purchase bill',   many: 'purchase bills' },
  { table: 'Payment',          one: 'payment',         many: 'payments' },
  { table: 'SupplierPayment',  one: 'supplier payment', many: 'supplier payments' },
  { table: 'SupplierOrder',    one: 'supplier order',  many: 'supplier orders' },
  { table: 'JournalVoucher',   one: 'journal voucher', many: 'journal vouchers' },
  { table: 'StockMovement',    one: 'stock movement',  many: 'stock movements' },
  { table: 'Warehouse',        one: 'warehouse',       many: 'warehouses' },
  { table: 'Customer',         one: 'customer',        many: 'customers' },
  { table: 'Supplier',         one: 'supplier',        many: 'suppliers' },
];

/** Rows owned BY the user rather than created by them — safe to remove with it. */
export const USER_OWNED_TABLES = ['Membership', 'RefreshToken', 'PushSubscription', 'Notification', 'AuditLog'];

export const countUserRefs = async (userId) => {
  const counts = {};
  for (const t of USER_CREATED_TABLES) {
    const row = await qOne(`SELECT COUNT(*) n FROM \`${t.table}\` WHERE \`createdById\` = ?`, [userId]).catch(() => ({ n: 0 }));
    counts[t.table] = Number(row?.n ?? 0);
  }
  return counts;
};

/** ["3 sales orders", "1 dispatch"] — empty when the account can be removed. */
export const userBlockers = (counts) =>
  USER_CREATED_TABLES
    .filter((t) => counts[t.table] > 0)
    .map((t) => `${counts[t.table]} ${counts[t.table] === 1 ? t.one : t.many}`);
