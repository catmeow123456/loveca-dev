import { describe, expect, it, vi } from 'vitest';
import {
  buildCloudbaseCardSnapshot,
  buildPreparedCandidates,
  mapCardInsertRecordToExport,
  processCandidateImage,
  readCloudbaseDocuments,
  type CloudBaseCollection,
} from '../../src/scripts/sync-cards-cloudbase-new';

describe('CloudBase card sync shared core', () => {
  it('reads every page in stable source order without mutating the collection', async () => {
    const documents = [
      { _id: '1', card_code: 'TEST-001' },
      { _id: '2', card_code: 'TEST-002' },
      { _id: '3', card_code: 'TEST-003' },
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
          card_code: ' test-001 ',
          type: 'MEMBER',
          name_jp: 'テスト',
          cost: 2,
          blade: 1,
          hearts: [{ color: 'PINK', count: 1 }],
          image_source_uri: 'cloud://example/cardlist/test-001.png',
          image_filename: 'test-001.png',
        },
      ],
      'DRAFT'
    );

    expect(snapshot.invalidRows).toHaveLength(0);
    expect(snapshot.duplicateRows.size).toBe(0);
    const transform = snapshot.transforms[0]!;
    expect(transform.errors).toEqual([]);
    expect(transform.record).toMatchObject({
      card_code: 'test-001',
      card_type: 'MEMBER',
      name_jp: 'テスト',
      status: 'DRAFT',
    });
    expect(mapCardInsertRecordToExport(transform.record!)).toMatchObject({
      cardCode: 'test-001',
      cardType: 'MEMBER',
      nameJp: 'テスト',
      status: 'DRAFT',
    });
  });

  it('excludes duplicate source card codes and never proposes an existing database card', () => {
    const snapshot = buildCloudbaseCardSnapshot([
      { _id: '1', card_code: 'DUP-001', type: 'ENERGY', name_jp: 'A' },
      { _id: '2', card_code: 'DUP-001', type: 'ENERGY', name_jp: 'B' },
      {
        _id: '3',
        card_code: 'EXISTING-001',
        type: 'ENERGY',
        name_jp: 'Existing',
        image_source_uri: 'cloud://example/existing.png',
      },
      {
        _id: '4',
        card_code: 'NEW-001',
        type: 'ENERGY',
        name_jp: 'New',
        image_source_uri: 'cloud://example/new.png',
      },
    ]);
    const result = buildPreparedCandidates(snapshot.transforms, [
      { card_code: 'EXISTING-001', image_filename: 'EXISTING-001.webp' },
    ]);

    expect([...snapshot.duplicateRows.keys()]).toEqual(['DUP-001']);
    expect(result.existingSkipped).toEqual([{ cardCode: 'EXISTING-001', reason: 'alreadyExists' }]);
    expect(result.prepared.map((candidate) => candidate.record.card_code)).toEqual(['NEW-001']);
  });

  it('rejects non-HTTPS or private image addresses before any network or storage call', async () => {
    const snapshot = buildCloudbaseCardSnapshot([
      {
        _id: 'unsafe-image',
        card_code: 'UNSAFE-001',
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
        { overwriteImages: false }
      )
    ).resolves.toMatchObject({
      cardCode: 'UNSAFE-001',
      ok: false,
      sourceFlag: 'imageDownloadFailed',
    });
  });
});
