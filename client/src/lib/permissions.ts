// Mirrors server/lib/permissions.js — keep these in sync.
export const PERMISSION_KEYS = [
  'add_po', 'view_po', 'po_summary',
  'assign_work', 'view_work', 'emp_schedule',
  'slitting_plan', 'rec_production', 'modify_prod_qty',
  'add_customer', 'add_supplier', 'add_staff', 'add_material',
  'add_supplier_po', 'view_supplier_po',
  'emp_report', 'customer_report',
  'dispatch',
  'manage_returns',
  'manage_users',
] as const;

export type PermissionKey = typeof PERMISSION_KEYS[number];

export const PERMISSION_LABELS: Record<PermissionKey, string> = {
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
};

// Grouped for the form UI.
export const PERMISSION_GROUPS: { label: string; keys: PermissionKey[] }[] = [
  { label: 'Sales Orders',     keys: ['add_po', 'view_po', 'po_summary'] },
  { label: 'Supplier Orders',  keys: ['add_supplier_po', 'view_supplier_po'] },
  { label: 'Work & Schedule',  keys: ['assign_work', 'view_work', 'emp_schedule'] },
  { label: 'Production',       keys: ['slitting_plan', 'rec_production', 'modify_prod_qty'] },
  { label: 'Master Data',      keys: ['add_customer', 'add_supplier', 'add_staff', 'add_material'] },
  { label: 'Reports',          keys: ['emp_report', 'customer_report'] },
  { label: 'Dispatch',         keys: ['dispatch'] },
  { label: 'Returns',           keys: ['manage_returns'] },
  { label: 'Administration',   keys: ['manage_users'] },
];
