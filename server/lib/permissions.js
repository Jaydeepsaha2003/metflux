// Fine-grained permissions stored on each Membership. Mirrors the 16 flags
// from the legacy .NET User_Creation form, plus `manage_users` to gate the
// admin user-management page itself.
//
// Authorization rules (in order):
//   1. Platform admins always pass.
//   2. COMPANY_ADMIN role implies every permission in their company.
//   3. Otherwise, the permission key must be present in membership.permissions.
//
// Use `requirePermission('add_po')` as middleware to gate API routes.

export const PERMISSION_KEYS = Object.freeze([
  // Purchase orders
  'add_po',
  'view_po',
  'po_summary',
  // Work / scheduling
  'assign_work',
  'view_work',
  'emp_schedule',
  // Production
  'slitting_plan',
  'rec_production',
  'modify_prod_qty',
  // Master data
  'add_customer',
  'add_supplier',
  'add_staff',
  'add_material',
  // Supplier purchase orders
  'add_supplier_po',
  'view_supplier_po',
  // Reports
  'emp_report',
  'customer_report',
  // Dispatch
  'dispatch',
  // Returns flow (rework / re-dispatch tracking)
  'manage_returns',
  // User administration (new — gates this very module)
  'manage_users',
]);

// Friendly labels for the UI checkbox grid.
export const PERMISSION_LABELS = Object.freeze({
  add_po: 'Add PO',
  view_po: 'View PO',
  po_summary: 'PO Summary',
  assign_work: 'Assign Work',
  view_work: 'View Work',
  emp_schedule: 'Employee Schedule',
  slitting_plan: 'Slitting Plan',
  rec_production: 'Record Production',
  modify_prod_qty: 'Modify Production Qty',
  add_customer: 'Manage Customers',
  add_supplier: 'Manage Suppliers',
  add_staff: 'Manage Staff',
  add_material: 'Manage Materials',
  add_supplier_po: 'Add Supplier PO',
  view_supplier_po: 'View Supplier PO',
  emp_report: 'Employee Report',
  customer_report: 'Customer Report',
  dispatch: 'Dispatch',
  manage_returns: 'Manage Returns',
  manage_users: 'Manage Users',
});

const PERMISSION_SET = new Set(PERMISSION_KEYS);

// Strips unknown keys + duplicates. Always call before persisting to DB.
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
