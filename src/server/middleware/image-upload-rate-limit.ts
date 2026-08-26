import type { NextFunction, Request, Response } from 'express';

const ATTEMPT_WINDOW_MS = 10 * 60 * 1000;
const USER_ATTEMPT_LIMIT = 12;
const ADDRESS_ATTEMPT_LIMIT = 30;
const USER_BYTE_LIMIT = 48 * 1024 * 1024;
const ADDRESS_BYTE_LIMIT = 120 * 1024 * 1024;

const attempts = new Map<string, number[]>();
const uploadedBytes = new Map<string, Array<{ timestamp: number; bytes: number }>>();
let lastPruneAt = 0;

export function enforceImageUploadAttemptLimit(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const now = Date.now();
  prune(now);
  const userAllowed = recordAttempt(`user:${req.user!.id}`, USER_ATTEMPT_LIMIT, now);
  const addressAllowed = recordAttempt(`ip:${req.ip}`, ADDRESS_ATTEMPT_LIMIT, now);
  if (userAllowed && addressAllowed) {
    next();
    return;
  }
  res.setHeader('Retry-After', Math.ceil(ATTEMPT_WINDOW_MS / 1000));
  res.status(429).json({
    data: null,
    error: {
      code: 'IMAGE_UPLOAD_RATE_LIMIT',
      message: '图片上传尝试过于频繁，请稍后再试。',
      retryAfterMs: ATTEMPT_WINDOW_MS,
    },
  });
}

export function enforceImageUploadedByteLimit(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const bytes = collectUploadedBytes(req);
  const now = Date.now();
  const userAllowed = recordBytes(`user:${req.user!.id}`, USER_BYTE_LIMIT, bytes, now);
  const addressAllowed = recordBytes(`ip:${req.ip}`, ADDRESS_BYTE_LIMIT, bytes, now);
  if (userAllowed && addressAllowed) {
    next();
    return;
  }
  res.setHeader('Retry-After', Math.ceil(ATTEMPT_WINDOW_MS / 1000));
  res.status(429).json({
    data: null,
    error: {
      code: 'IMAGE_UPLOAD_BYTE_LIMIT',
      message: '短时间内上传的图片总量过大，请稍后再试。',
      retryAfterMs: ATTEMPT_WINDOW_MS,
    },
  });
}

function collectUploadedBytes(req: Request): number {
  if (req.file) return req.file.size;
  if (!req.files) return 0;
  const files = Array.isArray(req.files) ? req.files : Object.values(req.files).flat();
  return files.reduce((total, file) => total + file.size, 0);
}

function prune(now: number): void {
  if (now - lastPruneAt < 60_000) return;
  lastPruneAt = now;
  const threshold = now - ATTEMPT_WINDOW_MS;
  for (const [key, timestamps] of attempts) {
    const recent = timestamps.filter((timestamp) => timestamp > threshold);
    if (recent.length > 0) attempts.set(key, recent);
    else attempts.delete(key);
  }
  for (const [key, entries] of uploadedBytes) {
    const recent = entries.filter((entry) => entry.timestamp > threshold);
    if (recent.length > 0) uploadedBytes.set(key, recent);
    else uploadedBytes.delete(key);
  }
}

function recordAttempt(key: string, limit: number, now: number): boolean {
  const threshold = now - ATTEMPT_WINDOW_MS;
  const recent = (attempts.get(key) ?? []).filter((timestamp) => timestamp > threshold);
  if (recent.length >= limit) {
    attempts.set(key, recent);
    return false;
  }
  recent.push(now);
  attempts.set(key, recent);
  return true;
}

function recordBytes(key: string, limit: number, bytes: number, now: number): boolean {
  const threshold = now - ATTEMPT_WINDOW_MS;
  const recent = (uploadedBytes.get(key) ?? []).filter((entry) => entry.timestamp > threshold);
  const total = recent.reduce((sum, entry) => sum + entry.bytes, 0);
  if (total + bytes > limit) {
    uploadedBytes.set(key, recent);
    return false;
  }
  recent.push({ timestamp: now, bytes });
  uploadedBytes.set(key, recent);
  return true;
}
