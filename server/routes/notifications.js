// In-app notification centre — the bell panel reads/updates these. Scoped to the
// signed-in user in the active company.
import { Router } from 'express';
import { z } from 'zod';
import { q, qOne } from '../lib/db.js';
import { AppError, asyncHandler } from '../lib/errors.js';
import { requireAuth } from '../lib/auth.js';
import { resolveTenant } from '../lib/tenant.js';

const router = Router();
router.use(requireAuth, resolveTenant);

const scope = (req) => [req.tenant.companyId, req.auth.userId];

/* GET / — recent notifications (optionally unread only). */
router.get('/', asyncHandler(async (req, res) => {
  const { filter, limit } = z.object({
    filter: z.enum(['all', 'unread']).default('all'),
    limit: z.coerce.number().int().min(1).max(200).default(50),
  }).parse(req.query);
  const where = ['`companyId` = ?', '`userId` = ?'];
  const params = scope(req);
  if (filter === 'unread') where.push('`isRead` = 0');
  const items = await q(
    `SELECT \`id\`, \`type\`, \`title\`, \`body\`, \`url\`, \`isRead\`, \`createdAt\`
       FROM \`Notification\` WHERE ${where.join(' AND ')}
      ORDER BY \`createdAt\` DESC LIMIT ${limit}`,
    params
  );
  const unread = await qOne('SELECT COUNT(*) n FROM `Notification` WHERE `companyId` = ? AND `userId` = ? AND `isRead` = 0', scope(req));
  res.json({ items: items.map((r) => ({ ...r, isRead: !!r.isRead })), unread: Number(unread?.n ?? 0) });
}));

/* GET /unread-count — badge only (cheap poll). */
router.get('/unread-count', asyncHandler(async (req, res) => {
  const r = await qOne('SELECT COUNT(*) n FROM `Notification` WHERE `companyId` = ? AND `userId` = ? AND `isRead` = 0', scope(req));
  res.json({ unread: Number(r?.n ?? 0) });
}));

/* POST /:id/read — mark one read. */
router.post('/:id/read', asyncHandler(async (req, res) => {
  const r = await q('UPDATE `Notification` SET `isRead` = 1, `readAt` = CURRENT_TIMESTAMP(3) WHERE `id` = ? AND `companyId` = ? AND `userId` = ?', [req.params.id, ...scope(req)]);
  if (!r?.affectedRows) throw new AppError('Not found', 404, 'NOT_FOUND');
  res.json({ ok: true });
}));

/* POST /read-all — mark every notification read. */
router.post('/read-all', asyncHandler(async (req, res) => {
  const r = await q('UPDATE `Notification` SET `isRead` = 1, `readAt` = CURRENT_TIMESTAMP(3) WHERE `companyId` = ? AND `userId` = ? AND `isRead` = 0', scope(req));
  res.json({ updated: r?.affectedRows ?? 0 });
}));

/* DELETE /:id — remove one. */
router.delete('/:id', asyncHandler(async (req, res) => {
  const r = await q('DELETE FROM `Notification` WHERE `id` = ? AND `companyId` = ? AND `userId` = ?', [req.params.id, ...scope(req)]);
  if (!r?.affectedRows) throw new AppError('Not found', 404, 'NOT_FOUND');
  res.status(204).end();
}));

/* POST /clear — remove all for this user. */
router.post('/clear', asyncHandler(async (req, res) => {
  const r = await q('DELETE FROM `Notification` WHERE `companyId` = ? AND `userId` = ?', scope(req));
  res.json({ deleted: r?.affectedRows ?? 0 });
}));

export default router;
