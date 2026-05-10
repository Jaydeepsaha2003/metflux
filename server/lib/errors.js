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
    return res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: 'Invalid request', details: err.flatten() },
    });
  }
  if (err instanceof AppError) {
    return res.status(err.status).json({
      error: { code: err.code, message: err.message, details: err.details },
    });
  }
  // Common Prisma errors get a friendly translation.
  if (err?.code === 'P2002') {
    return res.status(409).json({
      error: { code: 'CONFLICT', message: 'Unique constraint violation', details: err.meta },
    });
  }
  if (err?.code === 'P2025') {
    return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Record not found' } });
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
