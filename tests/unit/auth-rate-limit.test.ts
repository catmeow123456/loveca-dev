import type { NextFunction, Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import {
  bodyIdentityKey,
  createAuthRateLimitMiddleware,
  requestIpKey,
} from '../../src/server/middleware/auth-rate-limit';

function createResponse() {
  const headers = new Map<string, string>();
  const response = {
    statusCode: 200,
    body: null as unknown,
    setHeader(name: string, value: string) {
      headers.set(name.toLowerCase(), value);
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

function invoke(
  middleware: ReturnType<typeof createAuthRateLimitMiddleware>,
  request: Partial<Request>
) {
  const response = createResponse();
  const next = vi.fn() as NextFunction;
  middleware(request as Request, response, next);
  return { response, next };
}

describe('auth rate limiter', () => {
  it('rejects requests beyond a bucket limit and allows them after the window resets', () => {
    let now = 1_000;
    const middleware = createAuthRateLimitMiddleware(
      [{ id: 'login-ip', limit: 2, windowMs: 10_000, key: requestIpKey }],
      { now: () => now }
    );
    const request = { ip: '198.51.100.8' };

    expect(invoke(middleware, request).next).toHaveBeenCalledOnce();
    expect(invoke(middleware, request).next).toHaveBeenCalledOnce();

    const limited = invoke(middleware, request);
    expect(limited.next).not.toHaveBeenCalled();
    expect(limited.response.statusCode).toBe(429);
    expect(limited.response.getHeader('Retry-After')).toBe('10');
    expect(limited.response.body).toMatchObject({
      error: { code: 'RATE_LIMIT', retryAfterMs: 10_000 },
    });

    now += 10_000;
    expect(invoke(middleware, request).next).toHaveBeenCalledOnce();
  });

  it('normalizes and hashes identities so casing and whitespace cannot evade the limit', () => {
    const middleware = createAuthRateLimitMiddleware([
      { id: 'reset-email', limit: 1, windowMs: 60_000, key: bodyIdentityKey('email') },
    ]);

    expect(invoke(middleware, { body: { email: 'User@Example.COM' } }).next).toHaveBeenCalledOnce();

    const limited = invoke(middleware, { body: { email: '  user@example.com  ' } });
    expect(limited.next).not.toHaveBeenCalled();
    expect(limited.response.statusCode).toBe(429);
  });
});
