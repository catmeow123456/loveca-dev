import { describe, expect, it, vi } from 'vitest';
import {
  buildCloudbaseCardSnapshot,
  buildPreparedCandidates,
  mapCardInsertRecordToExport,
  processCandidateImage,
  readCloudbaseDocuments,
  resolvePublicImageAddresses,
  type CloudBaseCollection,
} from '../../src/scripts/sync-cards-cloudbase-new';

describe('CloudBase card sync shared core', () => {
  it('reads every page in stable source order without mutating the collection', async () => {
    const documents = [
      { _id: '1', card_code: 'PL!N-bp1-001-N' },
      { _id: '2', card_code: 'PL!N-bp1-002-N' },
      { _id: '3', card_code: 'PL!N-bp1-003-N' },
    ];
    const offsets: number[] = [];
    let collection: CloudBaseCollection;
    const orderBy = vi.fn((field: string, direction: 'asc' | 'desc'): CloudBaseCollection => {
      expect({ field, direction }).toEqual({ field: '_id', direction: 'asc' });
      return collection;
    });
    collection = {
      orderBy,
      skip: vi.fn((offset: number) => {
        offsets.push(offset);
        return {
          limit: (limit: number) => ({
            get: () => Promise.resolve({ data: documents.slice(offset, offset + limit) }),
          }),
        };
      }),
    };

    await expect(readCloudbaseDocuments(collection, null, 2)).resolves.toEqual(documents);
    expect(orderBy).toHaveBeenCalledWith('_id', 'asc');
    expect(offsets).toEqual([0, 2]);
  });

  it('normalizes a valid card once for both admin sync and personal JSON export', () => {
    const snapshot = buildCloudbaseCardSnapshot(
      [
        {
          _id: 'source-1',
          card_code: ' PL!N-bp1-001-N ',
          type: 'MEMBER',
          name_jp: 'テスト',
          cost: 2,
          blade: 1,
          hearts: [{ color: 'PINK', count: 1 }],
          image_source_uri: 'cloud://example/cardlist/PL!N-bp1-001-N.png',
          image_filename: 'PL!N-bp1-001-N.png',
        },
      ],
      'DRAFT'
    );

    expect(snapshot.invalidRows).toHaveLength(0);
    expect(snapshot.duplicateRows.size).toBe(0);
    const transform = snapshot.transforms[0]!;
    expect(transform.errors).toEqual([]);
    expect(transform.record).toMatchObject({
      card_code: 'PL!N-bp1-001-N',
      card_type: 'MEMBER',
      name_jp: 'テスト',
      status: 'DRAFT',
    });
    expect(mapCardInsertRecordToExport(transform.record!)).toMatchObject({
      cardCode: 'PL!N-bp1-001-N',
      cardType: 'MEMBER',
      nameJp: 'テスト',
      status: 'DRAFT',
    });
  });

  it('excludes duplicate source card codes and never proposes an existing database card', () => {
    const snapshot = buildCloudbaseCardSnapshot([
      { _id: '1', card_code: 'PL!N-bp1-001-N', type: 'ENERGY', name_jp: 'A' },
      { _id: '2', card_code: 'PL!N-bp1-001-N', type: 'ENERGY', name_jp: 'B' },
      {
        _id: '3',
        card_code: 'PL!N-bp1-002-N',
        type: 'ENERGY',
        name_jp: 'Existing',
        image_source_uri: 'cloud://example/existing.png',
      },
      {
        _id: '4',
        card_code: 'PL!N-bp1-003-N',
        type: 'ENERGY',
        name_jp: 'New',
        image_source_uri: 'cloud://example/new.png',
      },
    ]);
    const result = buildPreparedCandidates(snapshot.transforms, [
      { card_code: 'PL!N-bp1-002-N', image_filename: 'PL!N-bp1-002-N.webp' },
    ]);

    expect([...snapshot.duplicateRows.keys()]).toEqual(['PL!N-bp1-001-N']);
    expect(result.existingSkipped).toEqual([
      { cardCode: 'PL!N-bp1-002-N', reason: 'alreadyExists' },
    ]);
    expect(result.prepared.map((candidate) => candidate.record.card_code)).toEqual([
      'PL!N-bp1-003-N',
    ]);
  });

  it('rejects non-HTTPS or private image addresses before any network or storage call', async () => {
    const snapshot = buildCloudbaseCardSnapshot([
      {
        _id: 'unsafe-image',
        card_code: 'PL!N-bp1-004-N',
        type: 'ENERGY',
        name_jp: 'Unsafe',
        image_source_uri: 'http://127.0.0.1/internal.png',
      },
    ]);
    const candidate = buildPreparedCandidates(snapshot.transforms, []).prepared[0]!;

    await expect(
      processCandidateImage(
        candidate,
        {} as never,
        { client: {} as never, bucket: 'unused' },
        { overwriteImages: false, imageObjectVersion: 'unsafe-image-test' }
      )
    ).resolves.toMatchObject({
      cardCode: 'PL!N-bp1-004-N',
      ok: false,
      sourceFlag: 'imageDownloadFailed',
    });
  });

  it('blocks malformed card codes and negative rule integers before candidate planning', () => {
    const snapshot = buildCloudbaseCardSnapshot([
      { _id: 'bad-code', card_code: 'test-001', type: 'ENERGY', name_jp: 'Bad code' },
      {
        _id: 'bad-member',
        card_code: 'PL!N-bp8-001-P',
        type: 'MEMBER',
        name_jp: 'Bad member',
        cost: -1,
        blade: '-2',
      },
      {
        _id: 'bad-live',
        card_code: 'PL!-bp8-001-L',
        type: 'LIVE',
        name_jp: 'Bad live',
        score: -3,
      },
    ]);

    expect(snapshot.invalidRows).toHaveLength(1);
    expect(snapshot.invalidRows[0]?.reason).toContain('invalid card_code');
    expect(snapshot.transforms).toHaveLength(2);
    expect(snapshot.transforms[0]?.record).toBeNull();
    expect(snapshot.transforms[0]?.errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining('cost: expected a non-negative integer'),
        expect.stringContaining('blade: expected a non-negative integer'),
      ])
    );
    expect(snapshot.transforms[1]?.record).toBeNull();
    expect(snapshot.transforms[1]?.errors).toEqual([
      expect.stringContaining('score: expected a non-negative integer'),
    ]);
  });

  it('rejects DNS answers containing private, reserved, or mapped-private addresses', async () => {
    await expect(
      resolvePublicImageAddresses('images.example.test', () =>
        Promise.resolve([
          { address: '93.184.216.34', family: 4 },
          { address: '127.0.0.1', family: 4 },
        ])
      )
    ).rejects.toThrow('private or reserved');
    await expect(
      resolvePublicImageAddresses('images.example.test', () =>
        Promise.resolve([{ address: '::ffff:c0a8:101', family: 6 }])
      )
    ).rejects.toThrow('private or reserved');
    await expect(
      resolvePublicImageAddresses('images.example.test', () =>
        Promise.resolve([{ address: '2002:c0a8:101::1', family: 6 }])
      )
    ).rejects.toThrow('private or reserved');
    await expect(
      resolvePublicImageAddresses('images.example.test', () =>
        Promise.resolve([
          { address: '93.184.216.34', family: 4 },
          { address: '2606:2800:220:1:248:1893:25c8:1946', family: 6 },
        ])
      )
    ).resolves.toHaveLength(2);
  });

  it('reuses image objects only when every generated object digest matches', async () => {
    const snapshot = buildCloudbaseCardSnapshot([
      {
        _id: 'image-card',
        card_code: 'PL!N-bp1-005-N',
        type: 'ENERGY',
        name_jp: 'Image',
        image_source_uri: 'cloud://example/image.png',
        image_filename: 'PL!N-bp1-005-N.png',
      },
    ]);
    const candidate = buildPreparedCandidates(snapshot.transforms, []).prepared[0]!;
    const metadata = new Map<string, Record<string, string>>();
    const missing = () =>
      Promise.reject(Object.assign(new Error('missing'), { code: 'NoSuchKey' }));
    const firstClient = {
      statObject: vi.fn(missing),
      putObject: vi.fn(
        (
          _bucket: string,
          objectKey: string,
          _buffer: Buffer,
          _length: number,
          meta: Record<string, string>
        ) => {
          metadata.set(objectKey, meta);
          return Promise.resolve();
        }
      ),
      removeObject: vi.fn(),
    };
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8" fill="red"/></svg>'
    );
    const first = await processCandidateImage(
      candidate,
      {} as never,
      { client: firstClient as never, bucket: 'cards' },
      {
        overwriteImages: false,
        imageObjectVersion: 'digest-reuse-test',
        imageLoader: () => Promise.resolve(svg),
      }
    );
    expect(first).toMatchObject({ ok: true, reusedKeys: [] });
    expect(first.uploadedKeys).toHaveLength(3);
    expect(first.imageFilename).toMatch(/^PL!N-bp1-005-N-[0-9a-f]{24}\.webp$/u);
    const versionedBaseName = first.imageFilename!.replace(/\.webp$/u, '');
    expect(first.uploadedKeys).toEqual([
      `thumb/${versionedBaseName}.webp`,
      `medium/${versionedBaseName}.webp`,
      `large/${versionedBaseName}.webp`,
    ]);

    const secondClient = {
      statObject: vi.fn((_bucket: string, objectKey: string) =>
        Promise.resolve({ metaData: metadata.get(objectKey) })
      ),
      putObject: vi.fn(),
      removeObject: vi.fn(),
    };
    const second = await processCandidateImage(
      candidate,
      {} as never,
      { client: secondClient as never, bucket: 'cards' },
      {
        overwriteImages: false,
        imageObjectVersion: 'digest-reuse-test',
        imageLoader: () => Promise.resolve(svg),
      }
    );
    expect(second).toMatchObject({ ok: true, uploadedKeys: [] });
    expect(second.reusedKeys).toHaveLength(3);
    expect(secondClient.putObject).not.toHaveBeenCalled();

    const changedSvg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8" fill="blue"/></svg>'
    );
    const changed = await processCandidateImage(
      candidate,
      {} as never,
      { client: secondClient as never, bucket: 'cards' },
      {
        overwriteImages: false,
        imageObjectVersion: 'digest-reuse-test',
        imageLoader: () => Promise.resolve(changedSvg),
      }
    );
    expect(changed).toMatchObject({
      ok: false,
      uploadedKeys: [],
      sourceFlag: 'imageUploadFailed',
    });
    expect(changed.error).toContain('image object conflict');
  });

  it('returns structured object keys when rollback cleanup is incomplete', async () => {
    const snapshot = buildCloudbaseCardSnapshot([
      {
        _id: 'cleanup-card',
        card_code: 'PL!N-bp1-006-N',
        type: 'ENERGY',
        name_jp: 'Cleanup',
        image_source_uri: 'cloud://example/cleanup.png',
        image_filename: 'PL!N-bp1-006-N.png',
      },
    ]);
    const candidate = buildPreparedCandidates(snapshot.transforms, []).prepared[0]!;
    const client = {
      statObject: vi.fn(() =>
        Promise.reject(Object.assign(new Error('missing'), { code: 'NoSuchKey' }))
      ),
      putObject: vi.fn((_bucket: string, objectKey: string) => {
        return objectKey.startsWith('large/')
          ? Promise.reject(new Error('upload failed'))
          : Promise.resolve();
      }),
      removeObject: vi.fn((_bucket: string, objectKey: string) => {
        return objectKey.startsWith('medium/')
          ? Promise.reject(new Error('cleanup failed'))
          : Promise.resolve();
      }),
    };
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"/>');

    const result = await processCandidateImage(
      candidate,
      {} as never,
      { client: client as never, bucket: 'cards' },
      {
        overwriteImages: false,
        imageObjectVersion: 'cleanup-test',
        imageLoader: () => Promise.resolve(svg),
      }
    );

    expect(result).toMatchObject({ ok: false, sourceFlag: 'imageUploadFailed' });
    expect(result.uploadedKeys).toHaveLength(2);
    expect(result.uploadedKeys[0]).toMatch(/^thumb\/PL!N-bp1-006-N-[0-9a-f]{24}\.webp$/u);
    expect(result.uploadedKeys[1]).toMatch(/^medium\/PL!N-bp1-006-N-[0-9a-f]{24}\.webp$/u);
    expect(result.cleanupFailures).toEqual([result.uploadedKeys[1]]);
  });

  it('isolates a successor image from an older upload that completes after lease loss', async () => {
    const snapshot = buildCloudbaseCardSnapshot([
      {
        _id: 'fenced-card',
        card_code: 'PL!N-bp1-007-N',
        type: 'ENERGY',
        name_jp: 'Fenced',
        image_source_uri: 'cloud://example/fenced.png',
        image_filename: 'PL!N-bp1-007-N.png',
      },
    ]);
    const candidate = buildPreparedCandidates(snapshot.transforms, []).prepared[0]!;
    const leaseLost = new Error('lease lost');
    const objects = new Map<string, { buffer: Buffer; metadata: Record<string, string> }>();
    const statObject = vi.fn((_bucket: string, objectKey: string) => {
      const stored = objects.get(objectKey);
      return stored
        ? Promise.resolve({ metaData: stored.metadata })
        : Promise.reject(Object.assign(new Error('missing'), { code: 'NoSuchKey' }));
    });
    let releaseOldUpload!: () => void;
    const oldUploadGate = new Promise<void>((resolve) => {
      releaseOldUpload = resolve;
    });
    let markOldUploadStarted!: () => void;
    const oldUploadStarted = new Promise<void>((resolve) => {
      markOldUploadStarted = resolve;
    });
    let oldLeaseCurrent = true;
    let oldUploadCount = 0;
    const oldClient = {
      statObject,
      putObject: vi.fn(
        async (
          _bucket: string,
          objectKey: string,
          buffer: Buffer,
          _length: number,
          metadata: Record<string, string>
        ) => {
          oldUploadCount += 1;
          if (oldUploadCount === 1) {
            markOldUploadStarted();
            await oldUploadGate;
          }
          objects.set(objectKey, { buffer, metadata });
        }
      ),
      removeObject: vi.fn((_bucket: string, objectKey: string) => {
        objects.delete(objectKey);
        return Promise.resolve();
      }),
    };
    const successorClient = {
      statObject,
      putObject: vi.fn(
        (
          _bucket: string,
          objectKey: string,
          buffer: Buffer,
          _length: number,
          metadata: Record<string, string>
        ) => {
          objects.set(objectKey, { buffer, metadata });
          return Promise.resolve();
        }
      ),
      removeObject: vi.fn((_bucket: string, objectKey: string) => {
        objects.delete(objectKey);
        return Promise.resolve();
      }),
    };
    const oldSvg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8" fill="red"/></svg>'
    );
    const successorSvg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8" fill="blue"/></svg>'
    );

    const oldResultPromise = processCandidateImage(
      candidate,
      {} as never,
      { client: oldClient as never, bucket: 'cards' },
      {
        overwriteImages: false,
        imageObjectVersion: 'old-run:token-1:1',
        imageLoader: () => Promise.resolve(oldSvg),
        assertCurrent: () => (oldLeaseCurrent ? Promise.resolve() : Promise.reject(leaseLost)),
      }
    );
    await oldUploadStarted;

    const successorResult = await processCandidateImage(
      candidate,
      {} as never,
      { client: successorClient as never, bucket: 'cards' },
      {
        overwriteImages: false,
        imageObjectVersion: 'successor-run:token-2:1',
        imageLoader: () => Promise.resolve(successorSvg),
      }
    );
    expect(successorResult.ok).toBe(true);
    expect(successorResult.imageFilename).toMatch(/^PL!N-bp1-007-N-[0-9a-f]{24}\.webp$/u);
    const successorKeys = [...successorResult.uploadedKeys];
    expect(successorKeys).toHaveLength(3);
    const successorObjectsBeforeOldCompletion = successorKeys.map(
      (key) => objects.get(key)?.buffer
    );

    oldLeaseCurrent = false;
    releaseOldUpload();
    const oldResult = await oldResultPromise;

    expect(oldResult).toMatchObject({
      ok: false,
      imageFilename: null,
      sourceFlag: 'imageUploadFailed',
    });
    expect(oldResult.uploadedKeys).toHaveLength(1);
    expect(oldClient.removeObject).toHaveBeenCalledWith('cards', oldResult.uploadedKeys[0]);
    expect(oldResult.uploadedKeys.some((key) => successorKeys.includes(key))).toBe(false);
    expect(successorKeys.map((key) => objects.get(key)?.buffer)).toEqual(
      successorObjectsBeforeOldCompletion
    );
  });
});
