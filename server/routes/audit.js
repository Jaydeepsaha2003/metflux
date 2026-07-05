// Audit log viewing + restore. Gated by the `view_audit_log` permission
// (company/platform admins pass automatically).
import { Router } from 'express';
import { z } from 'zod';
import { q, qOne } from '../lib/db.js';
import { AppError, asyncHandler } from '../lib/errors.js';
import { requireAuth, requirePermission } from '../lib/auth.js';
import { resolveTenant } from '../lib/tenant.js';
import { AUDIT_ENTITIES, applySnapshot } from '../lib/audit.js';

const router = Router();
router.use(requireAuth, resolveTenant);

const labelFor = (entity) => AUDIT_ENTITIES[entity]?.label ?? entity;

/* GET /audit — recent activity, filterable. */
router.get('/', requirePermission('view_audit_log'), asyncHandler(async (req, res) => {
  const { entity, action, userId, from, to, search } = z.object({
    entity: z.string().trim().max(60).optional(),
    action: z.enum(['CREATE', 'UPDATE', 'DELETE']).optional(),
    userId: z.string().trim().max(191).optional(),
    from:   z.coerce.date().optional(),
    to:     z.coerce.date().optional(),
    search: z.string().trim().max(120).optional(),
  }).parse(req.query);

  let where = 'a.`companyId` = ?';
  const params = [req.tenant.companyId];
  if (entity) { where += ' AND a.`entity` = ?'; params.push(entity); }
  if (action) { where += ' AND a.`action` = ?'; params.push(action); }
  if (userId) { where += ' AND a.`userId` = ?'; params.push(userId); }
  if (from)   { where += ' AND a.`createdAt` >= ?'; params.push(from); }
  if (to)     { const e = new Date(to); e.setHours(23, 59, 59, 999); where += ' AND a.`createdAt` <= ?'; params.push(e); }
  if (search) { const like = `%${search}%`; where += ' AND (a.`summary` LIKE ? OR u.`name` LIKE ?)'; params.push(like, like); }

  const rows = await q(
    `SELECT a.*, u.\`name\` AS actorName, u.\`username\` AS actorUsername
       FROM \`AuditLog\` a LEFT JOIN \`User\` u ON u.\`id\` = a.\`userId\`
      WHERE ${where}
      ORDER BY a.\`createdAt\` DESC LIMIT 500`,
    params
  );

  // Distinct actors for the filter dropdown.
  const actors = await q(
    `SELECT DISTINCT a.\`userId\` AS id, u.\`name\` AS name
       FROM \`AuditLog\` a LEFT JOIN \`User\` u ON u.\`id\` = a.\`userId\`
      WHERE a.\`companyId\` = ? AND a.\`userId\` IS NOT NULL ORDER BY u.\`name\` ASC`,
    [req.tenant.companyId]
  );

  res.json({
    items: rows.map((r) => ({
      id: r.id,
      createdAt: r.createdAt,
      user: r.actorName || r.actorUsername || '—',
      entity: r.entity,
      entityLabel: labelFor(r.entity),
      entityId: r.entityId,
      action: r.action,
      summary: r.summary,
      restorable: !!r.restorable,
      restoredAt: r.restoredAt,
    })),
    entities: Object.keys(AUDIT_ENTITIES).map((k) => ({ value: k, label: labelFor(k) })),
    actors: actors.map((a) => ({ value: a.id, label: a.name || a.id })),
  });
}));

/* POST /audit/:id/restore — undo a delete (re-create) or revert an edit. */
router.post('/:id/restore', requirePermission('view_audit_log'), asyncHandler(async (req, res) => {
  const row = await qOne('SELECT * FROM `AuditLog` WHERE `id` = ? AND `companyId` = ?', [req.params.id, req.tenant.companyId]);
  if (!row) throw new AppError('Audit entry not found', 404, 'NOT_FOUND');
  if (!row.restorable || !row.beforeJson) throw new AppError('This entry cannot be restored', 400, 'NOT_RESTORABLE');
  if (row.restoredAt) throw new AppError('Already restored', 400, 'ALREADY_RESTORED');

  let snapshot;
  try { snapshot = JSON.parse(row.beforeJson); } catch { throw new AppError('Corrupt snapshot', 400, 'BAD_SNAPSHOT'); }
  if (snapshot?.row?.companyId && snapshot.row.companyId !== req.tenant.companyId) {
    throw new AppError('Snapshot belongs to another company', 403, 'FORBIDDEN');
  }

  await applySnapshot(snapshot);
  await q('UPDATE `AuditLog` SET `restoredAt` = ?, `restoredById` = ? WHERE `id` = ?', [new Date(), req.auth.userId, row.id]);
  res.json({ ok: true, action: row.action });
}));

export default router;
