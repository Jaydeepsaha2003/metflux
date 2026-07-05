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

/** Insert an audit row. Never throws — auditing must not break the operation. */
export const logAudit = async (req, { entity, entityId, action, summary = null, before = null, after = null }) => {
  try {
    await q(
      'INSERT INTO `AuditLog` (`id`,`companyId`,`userId`,`userName`,`entity`,`entityId`,`action`,`summary`,`beforeJson`,`afterJson`,`restorable`,`createdAt`) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
      [
        newId(), req.tenant?.companyId ?? null, req.auth?.userId ?? null, req.auth?.userName ?? null,
        entity, entityId ?? null, action, summary ? String(summary).slice(0, 300) : null,
        before ? JSON.stringify(before) : null,
        after ? JSON.stringify(after) : null,
        before ? 1 : 0, new Date(),
      ]
    );
  } catch (e) { /* swallow — never block the request */ }
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
