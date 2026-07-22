import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  poolQuery: vi.fn(),
  poolConnect: vi.fn(),
  clientQuery: vi.fn(),
  clientRelease: vi.fn(),
  hashPassword: vi.fn(),
  isLegacyCompatiblePasswordHash: vi.fn(),
  verifyPassword: vi.fn(),
  issueRefreshToken: vi.fn(),
  rotateRefreshToken: vi.fn(),
  revokeRefreshToken: vi.fn(),
  deleteAllRefreshTokens: vi.fn(),
  signAccessToken: vi.fn(),
  createEmailVerificationToken: vi.fn(),
  verifyEmailToken: vi.fn(),
  createPasswordResetToken: vi.fn(),
  resetPasswordWithToken: vi.fn(),
  updatePasswordAndInvalidateSessions: vi.fn(),
  sendVerificationEmail: vi.fn(),
  sendPasswordResetEmail: vi.fn(),
}));

vi.mock('../../src/server/config.js', () => ({
  config: {
    isDev: true,
    isEmailFeatureEnabled: true,
    isEmailVerificationRequired: true,
    jwtRefreshExpiresInDays: 7,
  },
}));

vi.mock('../../src/server/db/pool.js', () => ({
  pool: {
    query: mocks.poolQuery,
    connect: mocks.poolConnect,
  },
}));

vi.mock('../../src/server/services/auth-service.js', () => ({
  DUMMY_PASSWORD_HASH: 'dummy-password-hash',
  hashPassword: mocks.hashPassword,
  isLegacyCompatiblePasswordHash: mocks.isLegacyCompatiblePasswordHash,
  verifyPassword: mocks.verifyPassword,
  issueRefreshToken: mocks.issueRefreshToken,
  rotateRefreshToken: mocks.rotateRefreshToken,
  revokeRefreshToken: mocks.revokeRefreshToken,
  deleteAllRefreshTokens: mocks.deleteAllRefreshTokens,
  signAccessToken: mocks.signAccessToken,
  createEmailVerificationToken: mocks.createEmailVerificationToken,
  verifyEmailToken: mocks.verifyEmailToken,
  createPasswordResetToken: mocks.createPasswordResetToken,
  resetPasswordWithToken: mocks.resetPasswordWithToken,
  updatePasswordAndInvalidateSessions: mocks.updatePasswordAndInvalidateSessions,
}));

vi.mock('../../src/server/services/mail-service.js', () => ({
  sendVerificationEmail: mocks.sendVerificationEmail,
  sendPasswordResetEmail: mocks.sendPasswordResetEmail,
}));

import { authRouter } from '../../src/server/routes/auth';

type RouteMethod = 'post' | 'put';

interface RouterLayer {
  handle: RequestHandler;
  route?: {
    path: string;
    methods: Partial<Record<RouteMethod, boolean>>;
    stack: RouterLayer[];
  };
}

interface MockResponse extends Response {
  statusCode: number;
  body: {
    data: Record<string, unknown> | null;
    error: { code: string; message: string } | null;
  } | null;
  cookiesSet: Array<{ name: string; value: string; options: Record<string, unknown> }>;
  cookiesCleared: Array<{ name: string; options: Record<string, unknown> }>;
  getHeader(name: string): string | undefined;
}

function createMockResponse(): MockResponse {
  const headers = new Map<string, string>();
  const response = {
    statusCode: 200,
    body: null as MockResponse['body'],
    cookiesSet: [] as MockResponse['cookiesSet'],
    cookiesCleared: [] as MockResponse['cookiesCleared'],
    setHeader(name: string, value: string) {
      headers.set(name.toLowerCase(), value);
      return this;
    },
    getHeader(name: string) {
      return headers.get(name.toLowerCase());
    },
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: MockResponse['body']) {
      this.body = payload;
      return this;
    },
    cookie(name: string, value: string, options: Record<string, unknown>) {
      this.cookiesSet.push({ name, value, options });
      return this;
    },
    clearCookie(name: string, options: Record<string, unknown>) {
      this.cookiesCleared.push({ name, options });
      return this;
    },
  };
  return response as unknown as MockResponse;
}

function findRoute(path: string, method: RouteMethod) {
  const layers = authRouter.stack as unknown as RouterLayer[];
  const layer = layers.find(
    (candidate) => candidate.route?.path === path && candidate.route.methods[method]
  );
  if (!layer?.route) {
    throw new Error(`Route not found: ${method.toUpperCase()} ${path}`);
  }
  return layer.route;
}

async function runHandler(
  handler: RequestHandler,
  request: Request,
  response: MockResponse
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let completed = false;
    const complete = (error?: unknown) => {
      if (completed) return;
      completed = true;
      if (error) {
        reject(error instanceof Error ? error : new Error('Route middleware rejected'));
      } else resolve();
    };
    const next: NextFunction = (error?: unknown) => complete(error);

    try {
      const result = handler(request, response, next);
      if (result && typeof (result as Promise<unknown>).then === 'function') {
        void (result as Promise<unknown>).then(() => complete(), complete);
      } else if (response.body !== null) {
        complete();
      }
    } catch (error) {
      complete(error);
    }
  });
}

async function invokeRoute(
  path: string,
  method: RouteMethod,
  options: Partial<Request> = {}
): Promise<MockResponse> {
  const route = findRoute(path, method);
  const response = createMockResponse();
  const request = {
    params: {},
    query: {},
    body: undefined,
    cookies: {},
    headers: {},
    ip: '198.51.100.20',
    socket: { remoteAddress: '198.51.100.20' },
    ...options,
  } as Request;

  const layers = authRouter.stack as unknown as RouterLayer[];
  const commonHandlers = layers.filter((layer) => !layer.route).map((layer) => layer.handle);
  const handlers = [...commonHandlers, ...route.stack.map((layer) => layer.handle)];

  for (const handler of handlers) {
    if (response.body !== null) break;
    await runHandler(handler, request, response);
  }
  return response;
}

function authUser(overrides: Record<string, unknown> = {}) {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    email: 'user@example.com',
    password_hash: 'stored-password-hash',
    email_verified: true,
    username: 'user_name',
    display_name: 'User',
    avatar_url: null,
    role: 'user',
    deck_count: 0,
    ...overrides,
  };
}

describe('authRouter security behavior', () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset();
    mocks.poolConnect.mockResolvedValue({
      query: mocks.clientQuery,
      release: mocks.clientRelease,
    });
    mocks.hashPassword.mockResolvedValue('new-password-hash');
    mocks.signAccessToken.mockReturnValue('access-token');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('requires an email when this deployment enforces email verification', async () => {
    const response = await invokeRoute('/register', 'post', {
      body: { username: 'new_user', password: 'password-123' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.body?.error?.code).toBe('EMAIL_REQUIRED');
    expect(mocks.hashPassword).not.toHaveBeenCalled();
    expect(mocks.poolConnect).not.toHaveBeenCalled();
  });

  it('commits registration before sending email and reports delivery failure honestly', async () => {
    mocks.clientQuery
      .mockResolvedValueOnce({ rows: [], rowCount: null })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({
        rows: [{ id: '22222222-2222-4222-8222-222222222222' }],
        rowCount: 1,
      })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: null });
    mocks.createEmailVerificationToken.mockResolvedValue('a'.repeat(64));
    mocks.sendVerificationEmail.mockResolvedValue(false);

    const response = await invokeRoute('/register', 'post', {
      ip: '198.51.100.21',
      body: {
        username: 'new_user_2',
        email: 'USER@Example.COM',
        password: 'abc123',
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.body?.data).toMatchObject({
      verificationRequired: true,
      verificationEmailSent: false,
      message: '账号已创建，但验证邮件发送失败，请稍后重新发送',
    });
    expect(mocks.hashPassword).toHaveBeenCalledWith('abc123');
    expect(mocks.clientQuery.mock.calls.at(-1)?.[0]).toBe('COMMIT');
    expect(mocks.sendVerificationEmail).toHaveBeenCalledWith('user@example.com', 'a'.repeat(64));
    expect(mocks.clientRelease).toHaveBeenCalledOnce();
    expect(response.getHeader('Cache-Control')).toBe('no-store, max-age=0');
  });

  it('keeps the production-compatible six-character minimum and rejects five characters', async () => {
    const response = await invokeRoute('/register', 'post', {
      ip: '198.51.100.29',
      body: {
        username: 'short_password_user',
        email: 'short-password@example.com',
        password: 'abc12',
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.body?.error?.code).toBe('VALIDATION_ERROR');
    expect(mocks.hashPassword).not.toHaveBeenCalled();
  });

  it('runs a dummy password comparison when the login identity does not exist', async () => {
    mocks.poolQuery.mockResolvedValue({ rows: [], rowCount: 0 });
    mocks.verifyPassword.mockResolvedValue(false);

    const response = await invokeRoute('/login', 'post', {
      ip: '198.51.100.22',
      body: { usernameOrEmail: 'missing_user', password: 'password-123' },
    });

    expect(response.statusCode).toBe(401);
    expect(response.body?.error?.code).toBe('INVALID_CREDENTIALS');
    expect(mocks.verifyPassword).toHaveBeenCalledWith('password-123', 'dummy-password-hash');
  });

  it('does not issue a session to a user whose required email is unverified', async () => {
    mocks.poolQuery.mockResolvedValue({
      rows: [authUser({ email_verified: false })],
      rowCount: 1,
    });
    mocks.verifyPassword.mockResolvedValue(true);

    const response = await invokeRoute('/login', 'post', {
      ip: '198.51.100.23',
      body: { usernameOrEmail: 'user_name', password: 'password-123' },
    });

    expect(response.statusCode).toBe(403);
    expect(response.body?.error?.code).toBe('EMAIL_NOT_VERIFIED');
    expect(mocks.issueRefreshToken).not.toHaveBeenCalled();
  });

  it('upgrades a compatible legacy password after a successful login before issuing a session', async () => {
    mocks.poolQuery.mockResolvedValue({ rows: [authUser()], rowCount: 1 });
    mocks.verifyPassword.mockResolvedValue(true);
    mocks.isLegacyCompatiblePasswordHash.mockReturnValue(true);
    mocks.updatePasswordAndInvalidateSessions.mockResolvedValue(true);
    mocks.issueRefreshToken.mockResolvedValue({
      tokenId: '33333333-3333-4333-8333-333333333333',
      rawToken: 'b'.repeat(80),
    });

    const response = await invokeRoute('/login', 'post', {
      ip: '198.51.100.32',
      body: { usernameOrEmail: 'user_name', password: 'password-123' },
    });

    expect(response.statusCode).toBe(200);
    expect(mocks.hashPassword).toHaveBeenCalledWith('password-123');
    expect(mocks.updatePasswordAndInvalidateSessions).toHaveBeenCalledWith(
      '11111111-1111-4111-8111-111111111111',
      'stored-password-hash',
      'new-password-hash'
    );
    expect(mocks.issueRefreshToken).toHaveBeenCalledWith('11111111-1111-4111-8111-111111111111');
    expect(mocks.updatePasswordAndInvalidateSessions.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.issueRefreshToken.mock.invocationCallOrder[0]!
    );
  });

  it('rotates a v2 refresh token by token id and returns a new cookie', async () => {
    const tokenId = '33333333-3333-4333-8333-333333333333';
    const rawToken = 'b'.repeat(80);
    mocks.rotateRefreshToken.mockResolvedValue({
      userId: '11111111-1111-4111-8111-111111111111',
      tokenId: '44444444-4444-4444-8444-444444444444',
      rawToken: 'c'.repeat(80),
    });
    mocks.poolQuery.mockResolvedValue({ rows: [authUser()], rowCount: 1 });

    const response = await invokeRoute('/refresh', 'post', {
      ip: '198.51.100.24',
      cookies: { refresh_token: `v2:${tokenId}:${rawToken}` },
    });

    expect(response.statusCode).toBe(200);
    expect(mocks.rotateRefreshToken).toHaveBeenCalledWith(tokenId, rawToken);
    expect(response.cookiesSet[0]).toMatchObject({
      name: 'refresh_token',
      value: `v2:44444444-4444-4444-8444-444444444444:${'c'.repeat(80)}`,
      options: { httpOnly: true, sameSite: 'lax', path: '/api/auth' },
    });
  });

  it('does not clear a well-formed cookie when another concurrent refresh may have rotated it', async () => {
    const tokenId = '66666666-6666-4666-8666-666666666666';
    const rawToken = 'f'.repeat(80);
    mocks.rotateRefreshToken.mockResolvedValue(null);

    const response = await invokeRoute('/refresh', 'post', {
      ip: '198.51.100.27',
      cookies: { refresh_token: `v2:${tokenId}:${rawToken}` },
    });

    expect(response.statusCode).toBe(401);
    expect(response.body?.error?.code).toBe('INVALID_REFRESH_TOKEN');
    expect(response.cookiesCleared).toHaveLength(0);
  });

  it('rejects a legacy refresh cookie without entering token lookup', async () => {
    const userId = '77777777-7777-4777-8777-777777777777';
    const rawToken = '1'.repeat(80);

    const response = await invokeRoute('/refresh', 'post', {
      ip: '198.51.100.28',
      cookies: { refresh_token: `${userId}:${rawToken}` },
    });

    expect(response.statusCode).toBe(401);
    expect(response.body?.error?.code).toBe('NO_REFRESH_TOKEN');
    expect(response.cookiesCleared[0]).toMatchObject({ name: 'refresh_token' });
    expect(mocks.rotateRefreshToken).not.toHaveBeenCalled();
  });

  it('revokes only the exact v2 refresh token presented at logout', async () => {
    const tokenId = '55555555-5555-4555-8555-555555555555';
    const rawToken = 'd'.repeat(80);
    mocks.revokeRefreshToken.mockResolvedValue(false);

    const response = await invokeRoute('/logout', 'post', {
      cookies: { refresh_token: `v2:${tokenId}:${rawToken}` },
    });

    expect(response.statusCode).toBe(200);
    expect(mocks.revokeRefreshToken).toHaveBeenCalledWith(tokenId, rawToken);
    expect(mocks.deleteAllRefreshTokens).not.toHaveBeenCalled();
    expect(response.cookiesCleared[0]).toMatchObject({ name: 'refresh_token' });
  });

  it('clears the refresh cookie even when the IP limiter rejects logout revocation', async () => {
    const tokenId = '88888888-8888-4888-8888-888888888888';
    const rawToken = '2'.repeat(80);
    const cookie = `v2:${tokenId}:${rawToken}`;
    mocks.rotateRefreshToken.mockResolvedValue(null);

    for (let attempt = 0; attempt < 120; attempt += 1) {
      await invokeRoute('/refresh', 'post', {
        ip: '198.51.100.30',
        cookies: { refresh_token: cookie },
      });
    }

    const response = await invokeRoute('/logout', 'post', {
      ip: '198.51.100.30',
      cookies: { refresh_token: cookie },
    });

    expect(response.statusCode).toBe(429);
    expect(response.cookiesCleared[0]).toMatchObject({ name: 'refresh_token' });
    expect(mocks.revokeRefreshToken).not.toHaveBeenCalled();
  });

  it('uses the atomic email-token service and rejects a consumed or expired token', async () => {
    mocks.verifyEmailToken.mockResolvedValue(null);

    const response = await invokeRoute('/verify-email', 'post', {
      ip: '198.51.100.25',
      body: { token: 'e'.repeat(64) },
    });

    expect(response.statusCode).toBe(400);
    expect(response.body?.error?.code).toBe('INVALID_TOKEN');
    expect(mocks.verifyEmailToken).toHaveBeenCalledWith('e'.repeat(64));
    expect(mocks.poolQuery).not.toHaveBeenCalled();
  });

  it('rejects unauthenticated current-password changes before hashing the replacement', async () => {
    const response = await invokeRoute('/password', 'put', {
      ip: '198.51.100.26',
      body: { currentPassword: 'current-password', newPassword: 'replacement-password' },
    });

    expect(response.statusCode).toBe(401);
    expect(response.body?.error?.code).toBe('UNAUTHORIZED');
    expect(mocks.hashPassword).not.toHaveBeenCalled();
  });

  it('passes the verified credential into the transactional password update', async () => {
    mocks.poolQuery.mockResolvedValue({
      rows: [{ password_hash: 'stored-password-hash' }],
      rowCount: 1,
    });
    mocks.verifyPassword.mockResolvedValue(true);
    mocks.updatePasswordAndInvalidateSessions.mockResolvedValue(true);

    const response = await invokeRoute('/password', 'put', {
      ip: '198.51.100.31',
      user: { id: '11111111-1111-4111-8111-111111111111', role: 'user' },
      body: { currentPassword: 'current-password', newPassword: 'replacement-password' },
    });

    expect(response.statusCode).toBe(200);
    expect(mocks.updatePasswordAndInvalidateSessions).toHaveBeenCalledWith(
      '11111111-1111-4111-8111-111111111111',
      'stored-password-hash',
      'new-password-hash'
    );
    expect(response.cookiesCleared[0]).toMatchObject({ name: 'refresh_token' });
  });

  it('rejects a password update if the verified credential changed concurrently', async () => {
    mocks.poolQuery.mockResolvedValue({
      rows: [{ password_hash: 'stored-password-hash' }],
      rowCount: 1,
    });
    mocks.verifyPassword.mockResolvedValue(true);
    mocks.updatePasswordAndInvalidateSessions.mockResolvedValue(false);

    const response = await invokeRoute('/password', 'put', {
      ip: '198.51.100.32',
      user: { id: '11111111-1111-4111-8111-111111111111', role: 'user' },
      body: { currentPassword: 'current-password', newPassword: 'replacement-password' },
    });

    expect(response.statusCode).toBe(401);
    expect(response.body?.error?.code).toBe('INVALID_PASSWORD');
    expect(response.cookiesCleared).toHaveLength(0);
  });
});
