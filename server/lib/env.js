// Validates and exports environment variables on boot. Fails fast with a
// readable message if anything required is missing.
import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),

  PUBLIC_BASE_URL: z.string().url().default('http://localhost:3000'),
  CORS_ORIGINS: z
    .string()
    .default('http://localhost:5173,http://localhost:3000')
    .transform((v) => v.split(',').map((s) => s.trim()).filter(Boolean)),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  JWT_ACCESS_SECRET: z.string().min(16, 'JWT_ACCESS_SECRET must be ≥16 chars'),
  JWT_REFRESH_SECRET: z.string().min(16, 'JWT_REFRESH_SECRET must be ≥16 chars'),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL: z.string().default('15d'),

  ALLOW_PUBLIC_SIGNUP: z
    .string()
    .default('false')
    .transform((v) => v.toLowerCase() === 'true'),

  VAPID_PUBLIC_KEY: z.string().optional().default(''),
  VAPID_PRIVATE_KEY: z.string().optional().default(''),
  VAPID_SUBJECT: z.string().default('mailto:info@metfluxelectricals.com'),

  // Brevo (transactional email) — optional; email reminders are disabled until set.
  BREVO_API_KEY: z.string().optional().default(''),
  BREVO_SENDER_EMAIL: z.string().optional().default(''),
  BREVO_SENDER_NAME: z.string().optional().default(''),

  // Daily reminders (production-summary + invoice due). Times are in REMINDER_TZ.
  REMINDERS_ENABLED: z.string().default('true').transform((v) => v.toLowerCase() !== 'false'),
  REMINDER_TZ: z.string().default('Asia/Kolkata'),
  REMINDER_PROD_HOUR: z.coerce.number().int().min(0).max(23).default(18), // 6 PM
  REMINDER_DUE_HOUR: z.coerce.number().int().min(0).max(23).default(9),   // 9 AM

  SEED_SUPERADMIN_EMAIL: z.string().email().optional(),
  SEED_SUPERADMIN_USERNAME: z.string().optional(),
  SEED_SUPERADMIN_PASSWORD: z.string().optional(),
  SEED_DEFAULT_COMPANY_NAME: z.string().optional(),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('[metflux] invalid environment variables:');
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
