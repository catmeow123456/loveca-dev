import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  documents: [] as Record<string, unknown>[],
  query: vi.fn(),
  insert:
    vi.fn<
      (sql: string, values?: readonly unknown[]) => Promise<{ rows: unknown[]; rowCount: number }>
    >(),
  image: vi.fn(),
  check: vi.fn(),
}));
vi.mock('../../src/server/db/pool.js', () => ({
  pool: {
    query: mocks.query,
    connect: () => Promise.resolve({ query: mocks.insert, release: vi.fn() }),
  },
}));
vi.mock('../../src/server/services/card-sync-lease.js', () => ({
  leaseIdentity: vi.fn(),
  lockAndRenewCardSyncLease: vi.fn(),
}));
vi.mock('../../src/server/services/card-sync-image-check.js', () => ({
  cardSyncImageChecker: { check: mocks.check },
}));
vi.mock('../../src/scripts/sync-cards-cloudbase-new.js', async (original) => ({
  ...(await original<typeof import('../../src/scripts/sync-cards-cloudbase-new.js')>()),
  createCloudbaseAppWithCredentials: () => ({ database: () => ({ collection: () => ({}) }) }),
  readCloudbaseDocuments: () => Promise.resolve(mocks.documents),
  processCandidateImage: mocks.image,
}));
import { cloudbaseCardSyncEngine as engine } from '../../src/server/services/cloudbase-card-sync-engine';
import type { CardSyncEngineApplyInput } from '../../src/server/services/card-sync-engine';

describe('confirmed force import reaches draft storage', () => {
  afterEach(() => vi.unstubAllEnvs());
  beforeEach(() => {
    vi.clearAllMocks();
    for (const key of ['CLOUDBASE_ENV_ID', 'CLOUDBASE_SECRET_ID', 'CLOUDBASE_SECRET_KEY'])
      vi.stubEnv(key, 'test');
    mocks.query.mockResolvedValue({ rows: [] });
    mocks.insert.mockResolvedValue({ rows: [], rowCount: 1 });
    mocks.check.mockResolvedValue({ state: 'OK', message: '' });
    mocks.image.mockResolvedValue({
      ok: false,
      imageFilename: null,
      uploadedKeys: [],
      reusedKeys: [],
      cleanupFailures: [],
      sourceFlag: 'imageDownloadFailed',
      error: 'HTTP 404',
    });
  });
  function input(sourceHash: string): CardSyncEngineApplyInput {
    return {
      runId: 'run',
      actorUserId: 'admin',
      requestId: 'request',
      expectedSourceHash: sourceHash,
      expectedCandidateCardCodes: [],
      selectedCardCodes: ['FUTURE-ad2-001-NEW'],
      forceImport: true,
      forceImports: [
        {
          sourceKey: 'row:1',
          cardCode: 'FUTURE-ad2-001-NEW',
          name: '错误卡仍可导入',
          cardType: 'MEMBER',
        },
      ],
      execution: {
        token: 'token',
        generation: 1,
        signal: new AbortController().signal,
        assertCurrent: vi.fn(),
      },
    };
  }
  it('imports an unknown code, invalid numeric field and missing image as an explicit incomplete draft', async () => {
    mocks.documents = [
      { card_code: 'FUTURE-ad2-001-NEW', name_cn: '错误卡仍可导入', type: 'MEMBER', cost: -1 },
    ];
    const preview = await engine.preview();
    expect(preview.blocked[0]).toMatchObject({
      cardCode: 'FUTURE-ad2-001-NEW',
      name: '错误卡仍可导入',
      sourceKey: 'row:1',
    });
    const result = await engine.apply(input(preview.sourceHash));
    expect(result.items[0].result).toBe('SUCCEEDED');
    expect(result.items[0].message).toContain('无图草稿');
    const values = mocks.insert.mock.calls.find(([sql]) => sql.includes('INSERT INTO cards'))![1]!;
    expect(values[0]).toBe('FUTURE-ad2-001-NEW');
    expect(values[3]).toBe('错误卡仍可导入');
    expect(values[8]).toBeNull();
    expect(values[16]).toBeNull();
    expect(values[23]).toBe('DRAFT');
    expect(JSON.parse(String(values[22]))).toMatchObject({
      forceImported: true,
      missingImage: true,
    });
  });
  it('requires explicit force confirmation and preserves source revision checking', async () => {
    mocks.documents = [{ card_code: 'FUTURE-ad2-001-NEW', name_cn: '测试', type: 'MEMBER' }];
    const preview = await engine.preview();
    await expect(
      engine.apply({ ...input(preview.sourceHash), forceImport: false })
    ).rejects.toMatchObject({ code: 'PREVIEW_STALE' });
    mocks.documents[0].name_cn = '上游已变化';
    await expect(engine.apply(input(preview.sourceHash))).rejects.toMatchObject({
      code: 'PREVIEW_STALE',
    });
    expect(mocks.insert).not.toHaveBeenCalled();
  });
  it('moves unavailable images out of default candidates, while keeping their full identities selectable', async () => {
    mocks.documents = [
      {
        card_code: 'PL!HS-ad2-001-AD',
        name_cn: '测试卡',
        type: 'MEMBER',
        image_source_uri: 'https://example.com/missing.png',
      },
    ];
    mocks.check.mockResolvedValue({ state: 'UNAVAILABLE', message: '卡图缺失' });
    const progress = vi.fn();
    const preview = await engine.preview(progress);
    expect(preview.candidates).toEqual([]);
    expect(preview.blocked[0]).toMatchObject({
      cardCode: 'PL!HS-ad2-001-AD',
      name: '测试卡',
      imageIssue: true,
    });
    expect(progress).toHaveBeenLastCalledWith({ checked: 1, total: 1 });
    expect(mocks.image).not.toHaveBeenCalled();
  });
  it('skips all image probes in NONE mode while retaining importable card data', async () => {
    mocks.documents = [
      {
        card_code: 'PL!HS-ad2-001-AD',
        name_cn: '测试卡',
        type: 'MEMBER',
        image_source_uri: 'https://example.com/slow.png',
      },
    ];
    const preview = await engine.preview(undefined, 'NONE');
    expect(preview.candidates.map((item) => item.cardCode)).toEqual(['PL!HS-ad2-001-AD']);
    expect(mocks.check).not.toHaveBeenCalled();
    expect(mocks.image).not.toHaveBeenCalled();
  });
  it('lets regular candidates use the explicit no-image fallback too, without uploading in preview', async () => {
    mocks.documents = [
      {
        card_code: 'PL!HS-ad2-001-AD',
        name_cn: '测试卡',
        type: 'MEMBER',
        image_source_uri: 'https://example.com/card.png',
      },
    ];
    const preview = await engine.preview();
    const request = {
      ...input(preview.sourceHash),
      forceImports: [],
      selectedCardCodes: ['PL!HS-ad2-001-AD'],
      expectedCandidateCardCodes: ['PL!HS-ad2-001-AD'],
    };
    expect((await engine.apply({ ...request, forceImport: false })).items[0].result).toBe('FAILED');
    expect(mocks.insert).not.toHaveBeenCalled();
    expect((await engine.apply(request)).items[0].result).toBe('SUCCEEDED');
  });
  it('can skip image work entirely for confirmed image-less imports', async () => {
    mocks.documents = [{ card_code: 'FUTURE-ad2-001-NEW', name_cn: '测试', type: 'MEMBER' }];
    const preview = await engine.preview();
    const request = input(preview.sourceHash);
    const result = await engine.apply({
      ...request,
      forceImports: request.forceImports!.map((choice) => ({ ...choice, skipImage: true })),
    });
    expect(result.items[0].result).toBe('SUCCEEDED');
    expect(result.items[0].message).toContain('跳过卡图');
    expect(mocks.image).not.toHaveBeenCalled();
    expect(mocks.insert).toHaveBeenCalled();
  });
});
