import type { NextFunction, Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { createUploadRateLimitMiddleware } from '../../src/server/middleware/upload-rate-limit';

const TEST_CONFIG = {
  windowMs: 10_000,
  userAttemptLimit: 2,
  addressAttemptLimit: 3,
  userByteLimit: 50,
  addressByteLimit: 100,
  attemptErrorCode: 'TEST_UPLOAD_RATE_LIMIT',
  byteErrorCode: 'TEST_UPLOAD_BYTE_LIMIT',
  attemptErrorMessage: '上传过于频繁',
  byteErrorMessage: '上传量过大',
} as const;

describe('upload rate limiter', () => {
  it('limits attempts before parsing and resets the bucket after the window', () => {
    let now = 1_000;
    const limiter = createUploadRateLimitMiddleware(TEST_CONFIG, { now: () => now });
    const request = createRequest();

    expect(invoke(limiter.enforceAttemptLimit, request).next).toHaveBeenCalledOnce();
    expect(invoke(limiter.enforceAttemptLimit, request).next).toHaveBeenCalledOnce();

    const limited = invoke(limiter.enforceAttemptLimit, request);
    expect(limited.next).not.toHaveBeenCalled();
    expect(limited.response.statusCode).toBe(429);
    expect(limited.response.getHeader('Retry-After')).toBe('10');
    expect(limited.response.body).toMatchObject({
      error: { code: 'TEST_UPLOAD_RATE_LIMIT', retryAfterMs: 10_000 },
    });

    now += 10_000;
    expect(invoke(limiter.enforceAttemptLimit, request).next).toHaveBeenCalledOnce();
  });

  it('limits cumulative uploaded bytes for the current user', () => {
    const limiter = createUploadRateLimitMiddleware(TEST_CONFIG);
    const first = createRequest(30);
    const second = createRequest(21);

    expect(invoke(limiter.enforceUploadedByteLimit, first).next).toHaveBeenCalledOnce();

    const limited = invoke(limiter.enforceUploadedByteLimit, second);
    expect(limited.next).not.toHaveBeenCalled();
    expect(limited.response.statusCode).toBe(429);
    expect(limited.response.body).toMatchObject({
      error: { code: 'TEST_UPLOAD_BYTE_LIMIT', retryAfterMs: 10_000 },
    });
  });
});

function createRequest(fileSize?: number): Partial<Request> {
  return {
    ip: '198.51.100.8',
    user: {
      id: '11111111-1111-4111-8111-111111111111',
      email: 'admin@example.com',
      emailVerified: true,
      role: 'admin',
    },
    file:
      fileSize === undefined ? undefined : ({ size: fileSize } as unknown as Express.Multer.File),
  };
}

function invoke(
  middleware: ReturnType<typeof createUploadRateLimitMiddleware>['enforceAttemptLimit'],
  request: Partial<Request>
) {
  const response = createResponse();
  const next = vi.fn() as NextFunction;
  middleware(request as Request, response, next);
  return { response, next };
}

function createResponse() {
  const headers = new Map<string, string>();
  const response = {
    statusCode: 200,
    body: null as unknown,
    setHeader(name: string, value: string | number) {
      headers.set(name.toLowerCase(), String(value));
      return this;
    },
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
    getHeader(name: string) {
      return headers.get(name.toLowerCase());
    },
  };
  return response as Response & {
    statusCode: number;
    body: unknown;
    getHeader(name: string): string | undefined;
  };
}
