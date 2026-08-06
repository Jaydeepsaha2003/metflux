// Fine-grained permissions stored on each Membership.
//
// Authorization rules (in order):
//   1. Platform admins always pass.
//   2. COMPANY_ADMIN role implies every permission in their company.
//   3. Otherwise, the permission key must be present in membership.permissions.
//
// Use `requirePermission('add_po')` as middleware to gate API routes.
//
// Every key in this list MUST gate a real route or sidebar item somewhere —
// keys that gate nothing only confuse admins building a user.

export const PERMISSION_KEYS = Object.freeze([
  // Overview
  'view_dashboard',
  'view_analysis',
  // Sales (PO) orders
  'add_po',
  'view_po',
  'po_summary',
  // Supplier purchase orders
  'add_supplier_po',
  'view_supplier_po',
  // Work allotment
  'assign_work',
  // Production
  'rec_production',
  'modify_prod_qty',
  // Testing calculator & report
  'view_testing',
  // Master data
  'add_customer',
  'add_supplier',
  'add_staff',
  'add_material',
  // Dispatch
  'dispatch',
  // Lorry Receipts (transport consignment)
  'view_lr',
  'add_lr',
  // Returns
  'manage_returns',
  // Accounts — granular per page (manage_invoices kept as a legacy umbrella).
  'view_sales_register',
  'view_debtor_aging',
  'receive_payments',
  'view_purchase_register',
  'view_creditor_aging',
  'manage_invoices',
  // User administration (gates the User-management page)
  'manage_users',
  'view_audit_log',
]);

// Friendly labels for the UI checkbox grid.
export const PERMISSION_LABELS = Object.freeze({
  view_dashboard:   'View Dashboard',
  view_analysis:    'View Analysis',
  add_po:           'Add Sales Order',
  view_po:          'View Sales Orders',
  po_summary:       'View SO Summary',
  add_supplier_po:  'Create / edit Supplier PO',
  view_supplier_po: 'View Supplier POs',
  assign_work:      'Assign Work (Work Allotment)',
  rec_production:   'Record Production',
  modify_prod_qty:  'Modify Production',
  view_testing:     'Testing Calculator & Report',
  add_customer:     'Manage Customers',
  add_supplier:     'Manage Suppliers',
  add_staff:        'Manage Workers (Labours)',
  add_material:     'Manage Materials',
  dispatch:         'Dispatch & Packing List',
  view_lr:          'View Lorry Receipts (LR)',
  add_lr:           'Create / edit Lorry Receipts',
  manage_returns:   'Manage Returns',
  view_sales_register:   'Sales Register',
  view_debtor_aging:     'Amount Receivable + Reminders',
  receive_payments:      'Receive Payments / Receipts & Payments',
  view_purchase_register:'Purchase Register',
  view_creditor_aging:   'Amount Payable',
  manage_invoices:  'Accounts (all — legacy)',
  view_audit_log:   'View Audit Log + Restore',
  manage_users:     'Manage Users',
});

const PERMISSION_SET = new Set(PERMISSION_KEYS);

// Strips unknown keys + duplicates. Always call before persisting to DB.
// This also silently drops the old phantom keys (view_work, emp_schedule,
// slitting_plan, emp_report, customer_report) from any pre-existing
// memberships the next time they're saved.
export const sanitizePermissions = (input) => {
  if (!Array.isArray(input)) return [];
  const seen = new Set();
  const out = [];
  for (const k of input) {
    if (typeof k === 'string' && PERMISSION_SET.has(k) && !seen.has(k)) {
      seen.add(k);
      out.push(k);
    }
  }
  return out;
};

// All permissions — used when a COMPANY_ADMIN is created.
export const ALL_PERMISSIONS = () => [...PERMISSION_KEYS];

// Computes the *effective* permission list for a membership.
// COMPANY_ADMIN gets everything implicitly.
export const effectivePermissions = (role, stored) =>
  role === 'COMPANY_ADMIN' ? ALL_PERMISSIONS() : sanitizePermissions(stored);
