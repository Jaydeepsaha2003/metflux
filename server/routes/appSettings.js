// App-wide branding (global webapp logo). Platform-admin only. The logo is
// stored as a base64 data URL in AppSetting so it survives deployments (the
// same approach as company logos).
import { Router } from 'express';
import multer from 'multer';
import { q, qOne } from '../lib/db.js';
import { AppError, asyncHandler } from '../lib/errors.js';
import { requireAuth } from '../lib/auth.js';

const router = Router();
router.use(requireAuth);

// Platform-admin gate — the global logo is not per-company.
router.use((req, _res, next) => {
  if (!req.auth?.isPlatformAdmin) return next(new AppError('Platform admin only', 403, 'FORBIDDEN'));
  next();
});

const logoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 }, // 2 MB
});

const LOGO_KEY = 'app_logo';
const COLOR_KEY = 'brand_color';
// Accept #rgb / #rrggbb only — this value is injected into the page as a colour,
// so validate strictly to avoid any CSS/style injection.
const HEX_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

const getSetting = async (key) => {
  const row = await qOne('SELECT `settingValue` FROM `AppSetting` WHERE `settingKey` = ?', [key]);
  return row?.settingValue ?? null;
};
const setSetting = (key, value) => q(
  'INSERT INTO `AppSetting` (`settingKey`, `settingValue`) VALUES (?, ?) ' +
  'ON DUPLICATE KEY UPDATE `settingValue` = VALUES(`settingValue`), `updatedAt` = CURRENT_TIMESTAMP(3)',
  [key, value]
);

/* GET /api/app-settings — current branding */
router.get('/', asyncHandler(async (_req, res) => {
  res.json({ logoUrl: await getSetting(LOGO_KEY), brandColor: await getSetting(COLOR_KEY) });
}));

/* PUT /api/app-settings/color — set (or clear) the global brand colour.
   Body: { brandColor: "#1d4ed8" } or { brandColor: null } to reset to default. */
router.put('/color', asyncHandler(async (req, res) => {
  const raw = req.body?.brandColor;
  if (raw === null || raw === '' || raw === undefined) {
    await q('DELETE FROM `AppSetting` WHERE `settingKey` = ?', [COLOR_KEY]);
    return res.json({ brandColor: null });
  }
  const value = String(raw).trim();
  if (!HEX_RE.test(value)) throw new AppError('brandColor must be a hex colour like #1d4ed8', 400, 'BAD_COLOR');
  await setSetting(COLOR_KEY, value.toLowerCase());
  res.json({ brandColor: value.toLowerCase() });
}));

/* POST /api/app-settings/logo — upload the global logo */
router.post('/logo', logoUpload.single('logo'), asyncHandler(async (req, res) => {
  if (!req.file) throw new AppError('No file uploaded', 400, 'NO_FILE');
  if (!req.file.mimetype.startsWith('image/')) throw new AppError('File must be an image', 400, 'BAD_FILE');
  const logoUrl = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;
  await setSetting(LOGO_KEY, logoUrl);
  res.json({ logoUrl });
}));

/* DELETE /api/app-settings/logo — clear the global logo */
router.delete('/logo', asyncHandler(async (_req, res) => {
  await q('DELETE FROM `AppSetting` WHERE `settingKey` = ?', [LOGO_KEY]);
  res.json({ logoUrl: null });
}));

export default router;
