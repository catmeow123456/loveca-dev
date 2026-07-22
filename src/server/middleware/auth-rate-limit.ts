import crypto from 'node:crypto';
import type { NextFunction, Request, RequestHandler, Response } from 'express';

export interface AuthRateLimitRule {
  readonly id: string;
  readonly limit: number;
  readonly windowMs: number;
  readonly key: (req: Request) => string | null;
}

interface AuthRateLimitBucket {
  count: number;
  resetAt: number;
}

export interface AuthRateLimitOptions {
  readonly now?: () => number;
}

const MAX_BUCKETS = 20_000;

export function createAuthRateLimitMiddleware(
  rules: readonly AuthRateLimitRule[],
  options: AuthRateLimitOptions = {}
): RequestHandler {
  const buckets = new Map<string, AuthRateLimitBucket>();
  const now = options.now ?? Date.now;

  return (req: Request, res: Response, next: NextFunction): void => {
    const timestamp = now();
    const resolvedRules = rules
      .map((rule) => ({ rule, key: rule.key(req) }))
      .filter((entry): entry is { rule: AuthRateLimitRule; key: string } => entry.key !== null);

    for (const { rule, key } of resolvedRules) {
      const bucketKey = `${rule.id}:${key}`;
      const bucket = readActiveBucket(buckets, bucketKey, timestamp);
      if (bucket && bucket.count >= rule.limit) {
        const retryAfterMs = Math.max(1, bucket.resetAt - timestamp);
        res.setHeader('Retry-After', String(Math.max(1, Math.ceil(retryAfterMs / 1000))));
        res.status(429).json({
          data: null,
          error: {
            code: 'RATE_LIMIT',
            message: '请求过于频繁，请稍后再试',
            retryAfterMs,
          },
        });
        return;
      }
    }

    for (const { rule, key } of resolvedRules) {
      const bucketKey = `${rule.id}:${key}`;
      const bucket = readActiveBucket(buckets, bucketKey, timestamp);
      if (bucket) {
        bucket.count += 1;
      } else {
        buckets.set(bucketKey, {
          count: 1,
          resetAt: timestamp + rule.windowMs,
        });
      }
    }

    pruneRateLimitBuckets(buckets, timestamp);
    next();
  };
}

export function requestIpKey(req: Request): string {
  return req.ip || req.socket.remoteAddress || 'unknown';
}

export function bodyIdentityKey(field: string): (req: Request) => string | null {
  return (req: Request): string | null => {
    const value = readBodyString(req.body, field);
    if (!value) return null;
    return crypto.createHash('sha256').update(value.trim().toLowerCase()).digest('hex');
  };
}

function readBodyString(body: unknown, field: string): string | null {
  if (!body || typeof body !== 'object') return null;
  const value = (body as Record<string, unknown>)[field];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function readActiveBucket(
  buckets: Map<string, AuthRateLimitBucket>,
  key: string,
  now: number
): AuthRateLimitBucket | null {
  const bucket = buckets.get(key);
  if (!bucket) return null;
  if (bucket.resetAt <= now) {
    buckets.delete(key);
    return null;
  }
  return bucket;
}

function pruneRateLimitBuckets(buckets: Map<string, AuthRateLimitBucket>, now: number): void {
  if (buckets.size <= MAX_BUCKETS) return;

  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) {
      buckets.delete(key);
    }
  }

  while (buckets.size > MAX_BUCKETS) {
    const oldestKey = buckets.keys().next().value as string | undefined;
    if (!oldestKey) break;
    buckets.delete(oldestKey);
  }
}
