import { Readable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import {
  AiEffectExtractionService,
  type SaveAiEffectExtractionConfigInput,
} from '../../src/server/services/ai-effect-extraction-service';
import { isValidAiEffectExtractionEncryptionKey } from '../../src/server/config';

const ADMIN_ID = '11111111-1111-4111-8111-111111111111';

describe('AiEffectExtractionService', () => {
  it('只接受规范的 32 字节 hex 或 base64 主密钥', () => {
    expect(isValidAiEffectExtractionEncryptionKey('11'.repeat(32))).toBe(true);
    expect(isValidAiEffectExtractionEncryptionKey(Buffer.alloc(32, 1).toString('base64'))).toBe(
      true
    );
    expect(isValidAiEffectExtractionEncryptionKey(`${'A'.repeat(43)}!`)).toBe(false);
    expect(isValidAiEffectExtractionEncryptionKey('A'.repeat(43))).toBe(false);
  });

  it('encrypts replacement keys, records only the key action, and never returns the secret', async () => {
    const database = new FakeDatabase();
    const service = createService(database);

    const view = await service.saveConfig(enabledCandidate(), ADMIN_ID);

    expect(view).toMatchObject({
      revision: 2,
      enabled: true,
      baseUrl: 'https://api.example.com/v1',
      modelId: 'vision-model',
      apiKeyConfigured: true,
      runtimeReady: true,
    });
    expect(view).not.toHaveProperty('apiKey');
    expect(database.config.encrypted_api_key).toMatch(/^v1\./u);
    expect(database.config.encrypted_api_key).not.toContain('candidate-secret');
    expect(database.audit).toEqual([
      expect.objectContaining({
        apiKeyAction: 'REPLACE',
        baseUrl: 'https://api.example.com/v1',
      }),
    ]);
    expect(JSON.stringify(database.audit)).not.toContain('candidate-secret');
    expect(await service.getAdminConfig()).not.toHaveProperty('encryptedApiKey');
  });

  it('tests a candidate without saving it and uses the candidate Authorization only upstream', async () => {
    const database = new FakeDatabase();
    const fetchImpl = vi.fn((_input: string | URL | Request, init?: RequestInit) => {
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer temporary-secret');
      expect(typeof init?.body === 'string' ? init.body : '').toContain('data:image/png;base64,');
      return Promise.resolve(completionResponse('OK'));
    });
    const service = createService(database, fetchImpl);

    const result = await service.testCandidate(
      {
        baseUrl: 'https://api.example.com/v1',
        modelId: 'candidate-model',
        apiKey: { action: 'REPLACE', value: 'temporary-secret' },
      },
      ADMIN_ID
    );

    expect(result.ok).toBe(true);
    expect(database.config).toMatchObject({ revision: 1, base_url: '', model_id: '' });
    expect(database.audit).toEqual([]);
  });

  it('loads the trusted card image by card code and returns text without changing card data', async () => {
    const database = new FakeDatabase();
    const fetchImpl = vi.fn((_input: string | URL | Request, init?: RequestInit) => {
      const body = typeof init?.body === 'string' ? init.body : '';
      const request = JSON.parse(body) as {
        messages: { content: unknown }[];
      };
      expect(JSON.stringify(request.messages)).toContain('data:image/webp;base64,Y2FyZC1pbWFnZQ==');
      return Promise.resolve(completionResponse('【登场】抽1张牌。'));
    });
    const loadObject = vi.fn((key: string) => {
      expect(key).toBe('large/PL!-test-001.webp');
      return Promise.resolve(Readable.from([Buffer.from('card-image')]));
    });
    const service = createService(database, fetchImpl, loadObject);
    await service.saveConfig(enabledCandidate(), ADMIN_ID);

    await expect(service.extractCardEffect('PL!-test-001', ADMIN_ID)).resolves.toBe(
      '【登场】抽1张牌。'
    );

    expect(loadObject).toHaveBeenCalledOnce();
    expect(database.cardWrites).toBe(0);
  });

  it('rejects non-allowlisted and private-address targets before calling the upstream', async () => {
    const database = new FakeDatabase();
    const fetchImpl = vi.fn();
    const nonAllowedService = createService(database, fetchImpl);

    await expect(
      nonAllowedService.testCandidate(
        {
          baseUrl: 'https://untrusted.example/v1',
          modelId: 'model',
          apiKey: { action: 'REPLACE', value: 'secret' },
        },
        ADMIN_ID
      )
    ).rejects.toMatchObject({ code: 'AI_EFFECT_HOST_NOT_ALLOWED', statusCode: 422 });

    const privateService = createService(database, fetchImpl, undefined, () =>
      Promise.resolve([{ address: '127.0.0.1', family: 4 as const }])
    );
    await expect(
      privateService.testCandidate(
        {
          baseUrl: 'https://api.example.com/v1',
          modelId: 'model',
          apiKey: { action: 'REPLACE', value: 'secret' },
        },
        ADMIN_ID
      )
    ).rejects.toMatchObject({ code: 'AI_EFFECT_PRIVATE_ADDRESS_REJECTED', statusCode: 422 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects stale revisions without changing the active configuration', async () => {
    const database = new FakeDatabase();
    database.config.revision = 3;
    const service = createService(database);

    await expect(service.saveConfig(enabledCandidate(), ADMIN_ID)).rejects.toMatchObject({
      code: 'AI_EFFECT_CONFIG_REVISION_CONFLICT',
      statusCode: 409,
    });
    expect(database.config).toMatchObject({ revision: 3, enabled: false, base_url: '' });
    expect(database.audit).toEqual([]);
  });

  it('rejects redirects and oversized upstream responses without exposing their bodies', async () => {
    const database = new FakeDatabase();
    const redirectService = createService(
      database,
      vi.fn(() =>
        Promise.resolve(
          new Response('secret redirect body', {
            status: 302,
            headers: { Location: 'https://api.example.com/elsewhere' },
          })
        )
      )
    );

    await expect(redirectService.testCandidate(testCandidate(), ADMIN_ID)).rejects.toMatchObject({
      code: 'AI_EFFECT_REDIRECT_REJECTED',
      statusCode: 502,
    });

    const oversizedService = createService(
      database,
      vi.fn(() => Promise.resolve(new Response(Buffer.alloc(256 * 1024 + 1, 'x'), { status: 200 })))
    );
    await expect(oversizedService.testCandidate(testCandidate(), ADMIN_ID)).rejects.toMatchObject({
      code: 'AI_EFFECT_RESPONSE_TOO_LARGE',
      statusCode: 502,
    });
  });
});

function enabledCandidate(): SaveAiEffectExtractionConfigInput {
  return {
    expectedRevision: 1,
    enabled: true,
    baseUrl: 'https://api.example.com/v1/',
    modelId: 'vision-model',
    apiKey: { action: 'REPLACE', value: 'candidate-secret' },
  };
}

function testCandidate() {
  return {
    baseUrl: 'https://api.example.com/v1',
    modelId: 'candidate-model',
    apiKey: { action: 'REPLACE' as const, value: 'temporary-secret' },
  };
}

function createService(
  database: FakeDatabase,
  fetchImpl: typeof globalThis.fetch = vi.fn(() => Promise.resolve(completionResponse('OK'))),
  loadObject: ((key: string) => Promise<Readable>) | undefined = undefined,
  resolveHost: (hostname: string) => Promise<readonly { address: string; family: 4 | 6 }[]> = () =>
    Promise.resolve([{ address: '93.184.216.34', family: 4 }])
): AiEffectExtractionService {
  return new AiEffectExtractionService({
    database: database as never,
    fetchImpl,
    loadObject: (loadObject ??
      (() => Promise.resolve(Readable.from([Buffer.from('image')])))) as never,
    resolveHost,
    now: () => 1_000,
  });
}

function completionResponse(content: string): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

class FakeDatabase {
  config = {
    revision: 1,
    enabled: false,
    base_url: '',
    model_id: '',
    encrypted_api_key: null as string | null,
    updated_at: new Date('2026-08-13T00:00:00.000Z'),
  };
  audit: Record<string, unknown>[] = [];
  cardWrites = 0;

  connect() {
    const snapshot = { ...this.config };
    return Promise.resolve({
      query: (sql: string, values?: readonly unknown[]) => {
        if (sql === 'ROLLBACK') this.config = snapshot;
        return this.query(sql, values);
      },
      release: vi.fn(),
    });
  }

  query(sql: string, values: readonly unknown[] = []) {
    if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
      return Promise.resolve({ rows: [] });
    }
    if (sql.includes('FROM ai_effect_extraction_config')) {
      return Promise.resolve({ rows: [{ ...this.config }] });
    }
    if (sql.includes('UPDATE ai_effect_extraction_config')) {
      this.config = {
        revision: Number(values[0]),
        enabled: Boolean(values[1]),
        base_url: String(values[2]),
        model_id: String(values[3]),
        encrypted_api_key: typeof values[4] === 'string' ? values[4] : null,
        updated_at: new Date('2026-08-13T00:01:00.000Z'),
      };
      return Promise.resolve({ rows: [{ ...this.config }] });
    }
    if (sql.includes('INSERT INTO ai_effect_extraction_audit_logs')) {
      const detail = typeof values[3] === 'string' ? values[3] : '{}';
      this.audit.push(JSON.parse(detail) as Record<string, unknown>);
      return Promise.resolve({ rows: [] });
    }
    if (sql.includes('FROM cards')) {
      return Promise.resolve({
        rows: [
          {
            card_code: values[0],
            image_filename: 'trusted.webp',
          },
        ],
      });
    }
    if (/\b(INSERT|UPDATE|DELETE)\b/u.test(sql)) this.cardWrites += 1;
    throw new Error(`Unexpected query: ${sql}`);
  }
}
