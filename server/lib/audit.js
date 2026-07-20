// Audit logging + snapshot-based restore/revert.
//
// Handlers call:
//   const before = await snapshotEntity('PoOrder', id);   // before update/delete
//   ... mutate ...
//   await logAudit(req, { entity:'PoOrder', entityId:id, action:'DELETE', summary, before });
//
// Restore (audit route) calls applySnapshot(before) to re-create a deleted
// record (with its children) or revert an edited one to its prior state.
import { q, qOne, txn, newId } from './db.js';

// entity -> { table, label, children:[{ table, fk }] }
export const AUDIT_ENTITIES = {
  PoOrder:       { table: 'PoOrder',       label: 'Sales Order',    children: [{ table: 'PoOrderItem', fk: 'poOrderId' }] },
  SupplierOrder: { table: 'SupplierOrder', label: 'Supplier Order', children: [{ table: 'SupplierOrderItem', fk: 'supplierOrderId' }] },
  Return:        { table: 'Return',        label: 'Return',         children: [{ table: 'ReturnItem', fk: 'returnId' }] },
  Production:    { table: 'Production',     label: 'Production',      children: [] },
  Dispatch:      { table: 'Dispatch',      label: 'Dispatch',       children: [] },
  PackingList:   { table: 'PackingList',   label: 'Packing List',   children: [{ table: 'PackingListItem', fk: 'packingListId' }] },
  Customer:      { table: 'Customer',      label: 'Customer',       children: [] },
  Supplier:      { table: 'Supplier',      label: 'Supplier',       children: [{ table: 'SupplierMembership', fk: 'supplierId' }] },
  Labour:        { table: 'Labour',        label: 'Worker',         children: [{ table: 'LabourMembership', fk: 'labourId' }] },
  MaterialGrade: { table: 'MaterialGrade', label: 'Material',       children: [] },
  FluxGrade:     { table: 'FluxGrade',     label: 'Flux Grade',     children: [] },
};

// mysql2 wants scalars/Date; JSON columns come back as objects — stringify those.
const prep = (v) => (v !== null && typeof v === 'object' && !(v instanceof Date) ? JSON.stringify(v) : v);

/** Snapshot a full aggregate (parent row + children) for restore/revert. */
export const snapshotEntity = async (entity, id) => {
  const def = AUDIT_ENTITIES[entity];
  if (!def) return null;
  const row = await qOne(`SELECT * FROM \`${def.table}\` WHERE \`id\` = ?`, [id]);
  if (!row) return null;
  const children = [];
  for (const c of def.children) {
    const rows = await q(`SELECT * FROM \`${c.table}\` WHERE \`${c.fk}\` = ?`, [id]);
    children.push({ table: c.table, fk: c.fk, rows });
  }
  return { table: def.table, id, row, children };
};

/** Raw insert of one AuditLog row. Never throws. */
const writeAuditRow = async ({ companyId, userId, userName, entity, entityId, action, summary, before, after }) => {
  try {
    await q(
      'INSERT INTO `AuditLog` (`id`,`companyId`,`userId`,`userName`,`entity`,`entityId`,`action`,`summary`,`beforeJson`,`afterJson`,`restorable`,`createdAt`) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
      [
        newId(), companyId ?? null, userId ?? null, userName ?? null,
        entity, entityId ?? null, action, summary ? String(summary).slice(0, 300) : null,
        before ? JSON.stringify(before) : null,
        after ? JSON.stringify(after) : null,
        before ? 1 : 0, new Date(),
      ]
    );
  } catch (e) { /* swallow — never block the request */ }
};

/** Insert a rich (entity-specific, restorable) audit row. Marks the request so
 *  the catch-all middleware below doesn't also log a generic entry for it. */
export const logAudit = async (req, { entity, entityId, action, summary = null, before = null, after = null }) => {
  if (req) req._audited = true;
  await writeAuditRow({
    companyId: req?.tenant?.companyId, userId: req?.auth?.userId, userName: req?.auth?.userName,
    entity, entityId, action, summary, before, after,
  });
};

/* ── Catch-all mutation audit ────────────────────────────────────────────────
   Records every create/update/delete across the whole API automatically, so
   sections without hand-written audit (accounts, masters, settings, …) still
   leave a "who did what, when" trail. Routes that call logAudit() themselves
   set req._audited and are skipped here (no duplicate). Read-only GETs, failed
   requests, and high-noise/auth endpoints are ignored. Generic entries carry no
   before-snapshot, so they are not restorable — only the record. */

// First path segment → human label shown in the Audit Log.
const SECTION_LABEL = {
  'sales-invoices': 'Sales Invoice', 'purchases': 'Purchase Invoice', 'payments': 'Payment',
  'cashbook': 'Cashbook', 'receipts-payments': 'Receipts & Payments', 'journal': 'Journal',
  'customers': 'Customer', 'suppliers': 'Supplier', 'material-grades': 'Material',
  'flux-grades': 'Flux Grade', 'labours': 'Worker', 'warehouses': 'Warehouse',
  'work-allotments': 'Work Allotment', 'users': 'User', 'companies': 'Company',
  'company-settings': 'Settings', 'app-settings': 'Branding', 'quotations': 'Quotation',
  'po-orders': 'Sales Order', 'supplier-orders': 'Supplier Order', 'production': 'Production',
  'dispatch': 'Dispatch', 'packing-lists': 'Packing List', 'returns': 'Return',
};
// Endpoints that are pure noise or auth flow — never audited generically.
const AUDIT_SKIP = new Set(['notifications', 'push', 'whatsapp', 'email', 'auth', 'share', 'customer-portal', 'public', 'reminders']);
const ACTION_BY_METHOD = { POST: 'CREATE', PUT: 'UPDATE', PATCH: 'UPDATE', DELETE: 'DELETE' };

export const auditMutations = (req, res, next) => {
  const action = ACTION_BY_METHOD[req.method];
  if (!action) return next();                       // GET/HEAD/OPTIONS
  const parts = (req.path || '').split('/').filter(Boolean);
  const section = parts[0];
  if (!section || AUDIT_SKIP.has(section)) return next();

  res.on('finish', () => {
    if (req._audited) return;                        // already logged in detail
    if (res.statusCode >= 400) return;               // failed request
    if (!req.auth?.userId) return;                   // unauthenticated
    const idLike = parts[1] && /^[0-9a-z-]{8,}$/i.test(parts[1]) ? parts[1] : null;
    writeAuditRow({
      companyId: req.tenant?.companyId, userId: req.auth.userId, userName: req.auth.userName,
      entity: SECTION_LABEL[section] || section,
      entityId: idLike,
      action,
      summary: `${req.method} ${req.originalUrl.split('?')[0]}`.slice(0, 200),
    });
  });
  next();
};

/** Re-create (delete-undo) or revert (edit-undo) an entity from a snapshot. */
export const applySnapshot = async (snap) => {
  if (!snap?.table || !snap.row) throw new Error('Nothing to restore');
  await txn(async (tx) => {
    const exists = await tx.qOne(`SELECT \`id\` FROM \`${snap.table}\` WHERE \`id\` = ?`, [snap.id]);
    if (exists) {
      const keys = Object.keys(snap.row).filter((k) => k !== 'id');
      if (keys.length) {
        await tx.q(
          `UPDATE \`${snap.table}\` SET ${keys.map((k) => `\`${k}\` = ?`).join(', ')} WHERE \`id\` = ?`,
          [...keys.map((k) => prep(snap.row[k])), snap.id]
        );
      }
    } else {
      const keys = Object.keys(snap.row);
      await tx.q(
        `INSERT INTO \`${snap.table}\` (${keys.map((k) => `\`${k}\``).join(',')}) VALUES (${keys.map(() => '?').join(',')})`,
        keys.map((k) => prep(snap.row[k]))
      );
    }
    // Replace children with the snapshot set.
    for (const c of (snap.children ?? [])) {
      await tx.q(`DELETE FROM \`${c.table}\` WHERE \`${c.fk}\` = ?`, [snap.id]);
      for (const cr of c.rows) {
        const keys = Object.keys(cr);
        await tx.q(
          `INSERT INTO \`${c.table}\` (${keys.map((k) => `\`${k}\``).join(',')}) VALUES (${keys.map(() => '?').join(',')})`,
          keys.map((k) => prep(cr[k]))
        );
      }
    }
  });
};
