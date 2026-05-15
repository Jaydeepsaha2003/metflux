// Centralised error handling. Use AppError to throw 4xx errors with a code.
// asyncHandler wraps async route handlers so thrown errors flow into Express.
import { ZodError } from 'zod';
import { env } from './env.js';

export class AppError extends Error {
  constructor(message, status = 400, code = 'APP_ERROR', details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

export const notFoundHandler = (req, res, next) => {
  if (req.path.startsWith('/api')) {
    return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found' } });
  }
  next();
};

// eslint-disable-next-line no-unused-vars
export const errorHandler = (err, req, res, _next) => {
  if (err instanceof ZodError) {
    // Surface the first field-level error message (e.g. "Password must be at
    // least 8 characters", "Invalid email") so the UI can show something
    // actionable. Falls back to a generic message if zod gives us a blob with
    // no leaf errors. Full structure is still in `details` for debugging.
    const flat = err.flatten();
    const firstFieldKey = Object.keys(flat.fieldErrors ?? {})[0];
    const firstFieldMsg = firstFieldKey ? flat.fieldErrors[firstFieldKey]?.[0] : null;
    const firstFormErr = flat.formErrors?.[0];
    const message = firstFieldKey && firstFieldMsg
      ? `${firstFieldKey}: ${firstFieldMsg}`
      : firstFormErr || 'Invalid request';
    return res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message, details: flat },
    });
  }
  if (err instanceof AppError) {
    return res.status(err.status).json({
      error: { code: err.code, message: err.message, details: err.details },
    });
  }
  // Common MySQL errors get a friendly translation.
  if (err?.code === 'ER_DUP_ENTRY') {
    return res.status(409).json({
      error: { code: 'CONFLICT', message: 'Unique constraint violation', details: { sqlMessage: err.sqlMessage } },
    });
  }
  if (err?.code === 'ER_NO_REFERENCED_ROW_2' || err?.code === 'ER_ROW_IS_REFERENCED_2') {
    return res.status(400).json({
      error: { code: 'FK_VIOLATION', message: 'Referenced record not found or still in use', details: { sqlMessage: err.sqlMessage } },
    });
  }
  // Routes that still use the deprecated `prisma` stub from lib/db.js.
  if (err?.code === 'PRISMA_NOT_MIGRATED') {
    return res.status(501).json({
      error: { code: 'NOT_MIGRATED', message: err.message },
    });
  }
  console.error('[metflux] unhandled error:', err);
  res.status(500).json({
    error: {
      code: 'INTERNAL',
      message: 'Internal server error',
      ...(env.NODE_ENV !== 'production' ? { stack: err?.stack } : {}),
    },
  });
};
