// Mirrors server/lib/permissions.js — keep these in sync.
// Each key MUST gate a real route or menu item — phantom permissions just
// confuse the admin building a user.
export const PERMISSION_KEYS = [
  'add_po', 'view_po', 'po_summary',
  'add_supplier_po', 'view_supplier_po',
  'assign_work',
  'rec_production', 'modify_prod_qty',
  'add_customer', 'add_supplier', 'add_staff', 'add_material',
  'dispatch',
  'manage_returns',
  'manage_invoices',
  'manage_users',
] as const;

export type PermissionKey = typeof PERMISSION_KEYS[number];

export const PERMISSION_LABELS: Record<PermissionKey, string> = {
  add_po:           'Add Sales Order',
  view_po:          'View Sales Orders',
  po_summary:       'View SO Summary',
  add_supplier_po:  'Create / edit Supplier PO',
  view_supplier_po: 'View Supplier POs',
  assign_work:      'Assign Work (Work Allotment)',
  rec_production:   'Record Production',
  modify_prod_qty:  'Modify Production',
  add_customer:     'Manage Customers',
  add_supplier:     'Manage Suppliers',
  add_staff:        'Manage Workers (Labours)',
  add_material:     'Manage Materials',
  dispatch:         'Dispatch & Packing List',
  manage_returns:   'Manage Returns',
  manage_invoices:  'Sales Invoices & Payments',
  manage_users:     'Manage Users',
};

// Grouped for the form UI. Each group maps to a real area of the app.
export const PERMISSION_GROUPS: { label: string; keys: PermissionKey[] }[] = [
  { label: 'Sales Orders',    keys: ['add_po', 'view_po', 'po_summary'] },
  { label: 'Supplier Orders', keys: ['add_supplier_po', 'view_supplier_po'] },
  { label: 'Work Allotment',  keys: ['assign_work'] },
  { label: 'Production',      keys: ['rec_production', 'modify_prod_qty'] },
  { label: 'Dispatch',        keys: ['dispatch'] },
  { label: 'Returns',         keys: ['manage_returns'] },
  { label: 'Sales Invoices',  keys: ['manage_invoices'] },
  { label: 'Master Data',     keys: ['add_customer', 'add_supplier', 'add_staff', 'add_material'] },
  { label: 'Administration',  keys: ['manage_users'] },
];
