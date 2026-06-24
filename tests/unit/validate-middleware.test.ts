import { describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { validate } from '../../src/server/middleware/validate';

function createMockResponse() {
  const response = {
    statusCode: 200,
    body: null as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };

  return response as Response & {
    statusCode: number;
    body: {
      data: unknown;
      error: { code: string; message: string } | null;
    } | null;
  };
}

describe('validate middleware', () => {
  it('把空请求体按空对象校验，允许全可选 object schema', () => {
    const request = { body: undefined } as Request;
    const response = createMockResponse();
    const next = vi.fn();
    const middleware = validate(
      z.object({
        name: z.string().optional(),
      })
    );

    middleware(request, response, next);

    expect(next).toHaveBeenCalledOnce();
    expect(request.body).toEqual({});
    expect(response.statusCode).toBe(200);
    expect(response.body).toBeNull();
  });

  it('空请求体仍会拒绝缺少必填字段的 object schema', () => {
    const request = { body: undefined } as Request;
    const response = createMockResponse();
    const next = vi.fn();
    const middleware = validate(
      z.object({
        name: z.string().min(1),
      })
    );

    middleware(request, response, next);

    expect(next).not.toHaveBeenCalled();
    expect(response.statusCode).toBe(400);
    expect(response.body).toEqual({
      data: null,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'name: Invalid input: expected string, received undefined',
      },
    });
  });

  it('不会把显式 null 请求体改写为空对象', () => {
    const request = { body: null } as Request;
    const response = createMockResponse();
    const next = vi.fn();
    const middleware = validate(z.null());

    middleware(request, response, next);

    expect(next).toHaveBeenCalledOnce();
    expect(request.body).toBeNull();
    expect(response.statusCode).toBe(200);
    expect(response.body).toBeNull();
  });
});
