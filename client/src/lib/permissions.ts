// Mirrors server/lib/permissions.js — keep these in sync.
// Each key MUST gate a real route or menu item — phantom permissions just
// confuse the admin building a user.
export const PERMISSION_KEYS = [
  'view_dashboard', 'view_analysis',
  'add_po', 'view_po', 'po_summary',
  'add_supplier_po', 'view_supplier_po',
  'assign_work',
  'rec_production', 'modify_prod_qty',
  'view_testing',
  'add_customer', 'add_supplier', 'add_staff', 'add_material',
  'dispatch',
  'manage_returns',
  // Accounts — granular per page (manage_invoices kept as a legacy umbrella
  // that still passes server-side, but is no longer shown as a checkbox).
  'view_sales_register', 'view_debtor_aging', 'receive_payments',
  'view_bills_receivable', 'view_purchase_register', 'view_creditor_aging',
  'view_bills_payable',
  'manage_invoices',
  'manage_users',
] as const;

export type PermissionKey = typeof PERMISSION_KEYS[number];

export const PERMISSION_LABELS: Record<PermissionKey, string> = {
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
  manage_returns:   'Manage Returns',
  view_sales_register:   'Sales Register',
  view_debtor_aging:     'Debtor Aging + Reminders',
  receive_payments:      'Receive Payments',
  view_bills_receivable: 'Bills Receivable',
  view_purchase_register:'Purchase Register',
  view_creditor_aging:   'Creditor Aging',
  view_bills_payable:    'Bills Payable',
  manage_invoices:  'Accounts (all — legacy)',
  manage_users:     'Manage Users',
};

// Grouped for the form UI. Each group maps to a real area of the app.
// (manage_invoices is intentionally omitted — it stays valid but hidden.)
export const PERMISSION_GROUPS: { label: string; keys: PermissionKey[] }[] = [
  { label: 'Overview',        keys: ['view_dashboard', 'view_analysis'] },
  { label: 'Sales Orders',    keys: ['add_po', 'view_po', 'po_summary'] },
  { label: 'Supplier Orders', keys: ['add_supplier_po', 'view_supplier_po'] },
  { label: 'Work Allotment',  keys: ['assign_work'] },
  { label: 'Production',      keys: ['rec_production', 'modify_prod_qty'] },
  { label: 'Testing',         keys: ['view_testing'] },
  { label: 'Dispatch',        keys: ['dispatch'] },
  { label: 'Returns',         keys: ['manage_returns'] },
  { label: 'Accounts', keys: ['view_sales_register', 'view_debtor_aging', 'receive_payments', 'view_bills_receivable', 'view_purchase_register', 'view_creditor_aging', 'view_bills_payable'] },
  { label: 'Master Data',     keys: ['add_customer', 'add_supplier', 'add_staff', 'add_material'] },
  { label: 'Administration',  keys: ['manage_users'] },
];
