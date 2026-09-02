import type { NextFunction, Request, RequestHandler, Response } from 'express';

export interface UploadRateLimitConfig {
  readonly windowMs: number;
  readonly userAttemptLimit: number;
  readonly addressAttemptLimit: number;
  readonly userByteLimit: number;
  readonly addressByteLimit: number;
  readonly attemptErrorCode: string;
  readonly byteErrorCode: string;
  readonly attemptErrorMessage: string;
  readonly byteErrorMessage: string;
}

export interface UploadRateLimitOptions {
  readonly now?: () => number;
}

export interface UploadRateLimitMiddleware {
  readonly enforceAttemptLimit: RequestHandler;
  readonly enforceUploadedByteLimit: RequestHandler;
}

export function createUploadRateLimitMiddleware(
  config: UploadRateLimitConfig,
  options: UploadRateLimitOptions = {}
): UploadRateLimitMiddleware {
  const attempts = new Map<string, number[]>();
  const uploadedBytes = new Map<string, Array<{ timestamp: number; bytes: number }>>();
  const now = options.now ?? Date.now;
  let lastPruneAt = 0;

  const enforceAttemptLimit = (req: Request, res: Response, next: NextFunction): void => {
    const timestamp = now();
    prune(timestamp);
    const userKey = req.user?.id ? `user:${req.user.id}` : null;
    const addressKey = `ip:${requestAddress(req)}`;
    const threshold = timestamp - config.windowMs;
    const userAllowed =
      userKey === null || canRecordAttempt(attempts, userKey, config.userAttemptLimit, threshold);
    const addressAllowed = canRecordAttempt(
      attempts,
      addressKey,
      config.addressAttemptLimit,
      threshold
    );
    if (!userAllowed || !addressAllowed) {
      respondLimited(res, config.attemptErrorCode, config.attemptErrorMessage, config.windowMs);
      return;
    }
    if (userKey) recordAttempt(attempts, userKey, timestamp);
    recordAttempt(attempts, addressKey, timestamp);
    next();
  };

  const enforceUploadedByteLimit = (req: Request, res: Response, next: NextFunction): void => {
    const bytes = collectUploadedBytes(req);
    const timestamp = now();
    prune(timestamp);
    const userKey = req.user?.id ? `user:${req.user.id}` : null;
    const addressKey = `ip:${requestAddress(req)}`;
    const threshold = timestamp - config.windowMs;
    const userAllowed =
      userKey === null ||
      canRecordBytes(uploadedBytes, userKey, config.userByteLimit, bytes, threshold);
    const addressAllowed = canRecordBytes(
      uploadedBytes,
      addressKey,
      config.addressByteLimit,
      bytes,
      threshold
    );
    if (!userAllowed || !addressAllowed) {
      respondLimited(res, config.byteErrorCode, config.byteErrorMessage, config.windowMs);
      return;
    }
    if (userKey) recordBytes(uploadedBytes, userKey, bytes, timestamp);
    recordBytes(uploadedBytes, addressKey, bytes, timestamp);
    next();
  };

  function prune(timestamp: number): void {
    if (timestamp - lastPruneAt < 60_000) return;
    lastPruneAt = timestamp;
    const threshold = timestamp - config.windowMs;
    for (const [key, entries] of attempts) {
      const recent = entries.filter((entry) => entry > threshold);
      if (recent.length > 0) attempts.set(key, recent);
      else attempts.delete(key);
    }
    for (const [key, entries] of uploadedBytes) {
      const recent = entries.filter((entry) => entry.timestamp > threshold);
      if (recent.length > 0) uploadedBytes.set(key, recent);
      else uploadedBytes.delete(key);
    }
  }

  return { enforceAttemptLimit, enforceUploadedByteLimit };
}

function requestAddress(req: Request): string {
  return req.ip || req.socket.remoteAddress || 'unknown';
}

function collectUploadedBytes(req: Request): number {
  if (req.file) return req.file.size;
  if (!req.files) return 0;
  const files = Array.isArray(req.files) ? req.files : Object.values(req.files).flat();
  return files.reduce((total, file) => total + file.size, 0);
}

function canRecordAttempt(
  attempts: Map<string, number[]>,
  key: string,
  limit: number,
  threshold: number
): boolean {
  const recent = attempts.get(key)?.filter((timestamp) => timestamp > threshold) ?? [];
  return recent.length < limit;
}

function recordAttempt(attempts: Map<string, number[]>, key: string, now: number): void {
  const recent = attempts.get(key) ?? [];
  recent.push(now);
  attempts.set(key, recent);
}

function canRecordBytes(
  uploadedBytes: Map<string, Array<{ timestamp: number; bytes: number }>>,
  key: string,
  limit: number,
  bytes: number,
  threshold: number
): boolean {
  const recent = uploadedBytes.get(key)?.filter((entry) => entry.timestamp > threshold) ?? [];
  return recent.reduce((total, entry) => total + entry.bytes, 0) + bytes <= limit;
}

function recordBytes(
  uploadedBytes: Map<string, Array<{ timestamp: number; bytes: number }>>,
  key: string,
  bytes: number,
  now: number
): void {
  const recent = uploadedBytes.get(key) ?? [];
  recent.push({ timestamp: now, bytes });
  uploadedBytes.set(key, recent);
}

function respondLimited(res: Response, code: string, message: string, retryAfterMs: number): void {
  res.setHeader('Retry-After', Math.ceil(retryAfterMs / 1000));
  res.status(429).json({
    data: null,
    error: { code, message, retryAfterMs },
  });
}
