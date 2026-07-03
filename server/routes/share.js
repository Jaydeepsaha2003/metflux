// Share-link endpoint for PDFs sent via wa.me. The client generates a PDF in
// the browser, posts it here, and we save it under /uploads/shared/{uuid}.pdf
// so the WhatsApp message can carry a public URL. Files older than 7 days are
// pruned opportunistically on each upload — no cron job needed.
import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { asyncHandler, AppError } from '../lib/errors.js';
import { requireAuth } from '../lib/auth.js';
import { env } from '../lib/env.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SHARED_DIR = path.resolve(__dirname, '..', 'public', 'uploads', 'shared');
fs.mkdirSync(SHARED_DIR, { recursive: true });

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

// Cheap janitor — runs at most once per hour even if many uploads land.
let lastSweep = 0;
const sweepStale = () => {
  const now = Date.now();
  if (now - lastSweep < 60 * 60 * 1000) return;
  lastSweep = now;
  fs.readdir(SHARED_DIR, (err, files) => {
    if (err) return;
    for (const name of files) {
      const fp = path.join(SHARED_DIR, name);
      fs.stat(fp, (e, st) => {
        if (e || !st) return;
        if (now - st.mtimeMs > SEVEN_DAYS_MS) fs.unlink(fp, () => {});
      });
    }
  });
};

const EXT = { 'application/pdf': 'pdf', 'image/png': 'png', 'image/jpeg': 'jpg' };

const makeUpload = (allowed) => multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, SHARED_DIR),
    filename: (_req, file, cb) => {
      const slug = (file.originalname || 'document')
        .replace(/\.[^.]+$/, '')
        .replace(/[^A-Za-z0-9_-]+/g, '-')
        .slice(0, 60) || 'document';
      cb(null, `${crypto.randomUUID()}-${slug}.${EXT[file.mimetype] ?? 'bin'}`);
    },
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = allowed.includes(file.mimetype);
    cb(ok ? null : new Error(`Only ${allowed.join(', ')} allowed`), ok);
  },
});

const uploadPdf = makeUpload(['application/pdf']);
const uploadImage = makeUpload(['image/png', 'image/jpeg']);

const router = Router();
router.use(requireAuth);

// Save the just-uploaded file and return an unguessable (UUID) public URL, good
// for 7 days. Anyone with the link can view it, but the path can't be guessed.
const respondWithFile = (req, res) => {
  if (!req.file) throw new AppError('No file uploaded', 400, 'NO_FILE');
  sweepStale();

  const relUrl = `/uploads/shared/${req.file.filename}`;
  // Derive the absolute URL from the request itself so multi-brand deploys
  // (metfluxelectrical.com vs torofluxindustries.com) each get a share link
  // matching the brand the user was browsing. Express `trust proxy` is set
  // in server.js, so req.protocol and req.get('host') already honour the
  // X-Forwarded-* headers Hostinger's LiteSpeed sets. Falls back to
  // PUBLIC_BASE_URL if the host header is somehow missing (shouldn't happen
  // for real browser traffic).
  const host = req.get('host');
  const baseUrl = host
    ? `${req.protocol}://${host}`
    : env.PUBLIC_BASE_URL.replace(/\/$/, '');
  const absUrl = `${baseUrl}${relUrl}`;
  const expiresAt = new Date(Date.now() + SEVEN_DAYS_MS).toISOString();

  res.status(201).json({ url: absUrl, path: relUrl, expiresAt });
};

/* POST /api/share/pdf   — host a PDF (used by wa.me shares) */
router.post('/pdf', uploadPdf.single('file'), asyncHandler(async (req, res) => respondWithFile(req, res)));

/* POST /api/share/image — host a PNG/JPEG (used to embed the statement in emails) */
router.post('/image', uploadImage.single('file'), asyncHandler(async (req, res) => respondWithFile(req, res)));

export default router;
