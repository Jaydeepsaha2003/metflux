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

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, SHARED_DIR),
    filename: (_req, file, cb) => {
      const slug = (file.originalname || 'document')
        .replace(/\.[^.]+$/, '')
        .replace(/[^A-Za-z0-9_-]+/g, '-')
        .slice(0, 60) || 'document';
      cb(null, `${crypto.randomUUID()}-${slug}.pdf`);
    },
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = file.mimetype === 'application/pdf';
    cb(ok ? null : new Error('Only PDF files are allowed'), ok);
  },
});

const router = Router();
router.use(requireAuth);

/* POST /api/share/pdf — accepts a single PDF and returns a public URL good
   for 7 days. The URL is unguessable (UUID) but otherwise unauthenticated —
   anyone with the link can view the file. */
router.post('/pdf', upload.single('file'), asyncHandler(async (req, res) => {
  if (!req.file) throw new AppError('No file uploaded', 400, 'NO_FILE');
  sweepStale();

  const relUrl = `/uploads/shared/${req.file.filename}`;
  const absUrl = `${env.PUBLIC_BASE_URL.replace(/\/$/, '')}${relUrl}`;
  const expiresAt = new Date(Date.now() + SEVEN_DAYS_MS).toISOString();

  res.status(201).json({ url: absUrl, path: relUrl, expiresAt });
}));

export default router;
