import { describe, expect, it, vi } from 'vitest';
import {
  buildCloudbaseCardSnapshot,
  buildPreparedCandidates,
  insertCard,
  mapCardInsertRecordToExport,
  processCandidateImage,
  readCloudbaseDocuments,
  reconcileCardImageReference,
  resolvePublicImageAddresses,
  withSourceFlag,
  withVersionedImageReference,
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

  describe.each([
    {
      cardType: 'MEMBER',
      field: 'hearts',
      nativeField: '基本ハート',
      ruleFields: { cost: 2, blade: 1 },
      otherRuleFields: ['cost', 'blade'],
    },
    {
      cardType: 'LIVE',
      field: 'requirements',
      nativeField: '必要ハート',
      ruleFields: { score: 2 },
      otherRuleFields: ['score'],
    },
  ] as const)('$field parsing', ({ cardType, field, nativeField, ruleFields, otherRuleFields }) => {
    const buildTransform = (fields: Record<string, unknown>) =>
      buildCloudbaseCardSnapshot([
        {
          card_code: 'PL!N-bp1-001-N',
          type: cardType,
          name_jp: 'Ordinary Heart parser fixture',
          ...ruleFields,
          ...fields,
        },
      ]).transforms[0]!;

    it.each([
      { label: 'an empty array', value: [] },
      { label: 'an empty object', value: {} },
      { label: 'a JSON empty array', value: ' [] ' },
      { label: 'a JSON empty object', value: ' { } ' },
      { label: 'an empty string', value: '' },
      { label: 'whitespace', value: ' \t\n\u3000 ' },
    ])('preserves $label as an explicit zero without a missing-field flag', ({ value }) => {
      const transform = buildTransform({ [field]: value });

      expect(transform.errors).toEqual([]);
      expect(transform.record![field]).toEqual([]);
      expect(transform.warnings).toEqual([]);
      expect(transform.record!.source_flags).not.toHaveProperty('missingRuleFields');
      expect(transform.record!.source_flags).not.toHaveProperty('parseWarnings');
      expect(mapCardInsertRecordToExport(transform.record!)[field]).toEqual([]);
    });

    it.each([
      { value: ' red ', expected: [{ color: 'RED', count: 1 }] },
      { value: { blue: 2 }, expected: [{ color: 'BLUE', count: 2 }] },
      { value: [{ color: 'PINK', count: 1 }], expected: [{ color: 'PINK', count: 1 }] },
      { value: '{"blue":2}', expected: [{ color: 'BLUE', count: 2 }] },
      {
        value: '[{"color":"PINK","count":1}]',
        expected: [{ color: 'PINK', count: 1 }],
      },
    ])('preserves valid nonempty value $value', ({ value, expected }) => {
      const transform = buildTransform({ [field]: value });

      expect(transform.errors).toEqual([]);
      expect(transform.record![field]).toEqual(expected);
      expect(transform.warnings).toEqual([]);
      expect(transform.record!.source_flags).not.toHaveProperty('missingRuleFields');
      expect(mapCardInsertRecordToExport(transform.record!)[field]).toEqual(expected);
    });

    it.each([
      { label: 'a missing field', fields: {} },
      { label: 'undefined', fields: { [field]: undefined } },
      { label: 'null', fields: { [field]: null } },
    ])('keeps $label unknown and reports it as missing', ({ fields }) => {
      const transform = buildTransform(fields);

      expect(transform.errors).toEqual([]);
      expect(transform.record![field]).toBeNull();
      expect(transform.warnings).toEqual([]);
      expect(transform.record!.source_flags!.missingRuleFields).toEqual([field]);
      expect(mapCardInsertRecordToExport(transform.record!)[field]).toBeNull();
    });

    it.each([
      { value: false, warning: 'unsupported heart value' },
      { value: 1, warning: 'unsupported heart value' },
      { value: 'unknown', warning: 'unsupported heart value' },
      { value: '[not-json]', warning: 'unsupported heart value' },
      { value: { unknown: 1 }, warning: 'invalid heart entry "unknown"' },
      { value: { red: 0 }, warning: 'invalid heart entry "red"' },
      { value: ['unknown'], warning: 'heart item #1 is not an object' },
      {
        value: [
          { color: 'RED', count: 1 },
          { color: 'unknown', count: 1 },
        ],
        warning: 'invalid heart item #2',
      },
    ])(
      'retains a warning and missing-field flag for invalid nonempty value $value',
      ({ value, warning }) => {
        const transform = buildTransform({ [field]: value });

        expect(transform.errors).toEqual([]);
        expect(transform.record![field]).toBeNull();
        expect(transform.warnings).toEqual([`PL!N-bp1-001-N row 1 ${field}: ${warning}`]);
        expect(transform.record!.source_flags!.missingRuleFields).toEqual([field]);
        expect(transform.record!.source_flags!.parseWarnings).toEqual(transform.warnings);
        expect(mapCardInsertRecordToExport(transform.record!)[field]).toBeNull();
      }
    );

    it.each([
      { value: [], expected: [] },
      { value: '', expected: [] },
      { value: null, expected: null },
      { value: undefined, expected: null },
    ])('respects the first present alias for $value', ({ value, expected }) => {
      const transform = buildTransform({ [nativeField]: value, [field]: 'red' });

      expect(transform.record![field]).toEqual(expected);
      expect(transform.warnings).toEqual([]);
      expect(transform.record!.source_flags!.missingRuleFields).toEqual(
        expected === null ? [field] : undefined
      );
    });

    it.each(['source_flags', 'sourceFlags'])(
      'recomputes resolved diagnostics from %s',
      (flagsField) => {
        const upstreamFlags = {
          missingRuleFields: [field],
          parseWarnings: ['old parser warning'],
          upstreamNote: 'keep',
        };
        const transform = buildTransform({ [field]: [], [flagsField]: upstreamFlags });

        expect(transform.warnings).toEqual([]);
        expect(transform.record!.source_flags).toMatchObject({ upstreamNote: 'keep' });
        expect(transform.record!.source_flags).not.toHaveProperty('missingRuleFields');
        expect(transform.record!.source_flags).not.toHaveProperty('parseWarnings');
        expect(mapCardInsertRecordToExport(transform.record!).sourceFlags).toEqual(
          transform.record!.source_flags
        );
        expect(upstreamFlags.missingRuleFields).toEqual([field]);
        expect(upstreamFlags.parseWarnings).toEqual(['old parser warning']);
      }
    );

    it('keeps other missing rule fields when the Heart collection is explicitly empty', () => {
      const transform = buildTransform({
        [field]: [],
        ...Object.fromEntries(otherRuleFields.map((name) => [name, undefined])),
        source_flags: { missingRuleFields: [field], parseWarnings: ['old parser warning'] },
      });

      expect(transform.record![field]).toEqual([]);
      expect(transform.warnings).toEqual([]);
      expect(transform.record!.source_flags!.missingRuleFields).toEqual(otherRuleFields);
      expect(transform.record!.source_flags).not.toHaveProperty('parseWarnings');
    });
  });

  describe.each(['blade_hearts', 'special_hearts'] as const)('%s parsing', (field) => {
    const buildTransform = (fields: Record<string, unknown>) =>
      buildCloudbaseCardSnapshot([
        {
          card_code: 'PL!N-bp1-001-N',
          type: 'ENERGY',
          name_jp: 'Blade Heart parser fixture',
          ...fields,
        },
      ]).transforms[0]!;

    it.each([
      { label: 'null', value: null },
      { label: 'undefined', value: undefined },
      { label: 'an empty array', value: [] },
      { label: 'an empty string', value: '' },
      { label: 'whitespace', value: ' \t\n\u3000 ' },
    ])('treats $label as absent without a warning', ({ value }) => {
      const transform = buildTransform({ [field]: value });

      expect(transform.errors).toEqual([]);
      expect(transform.record!.blade_hearts).toBeNull();
      expect(transform.warnings).toEqual([]);
      expect(transform.record!.source_flags).not.toHaveProperty('parseWarnings');
    });

    it.each([
      { value: ' red ', expected: [{ effect: 'HEART', heartColor: 'RED' }] },
      { value: 0, expected: [{ effect: 'HEART', heartColor: 'RAINBOW' }] },
      { value: 'draw', expected: [{ effect: 'DRAW' }] },
      { value: 'score', expected: [{ effect: 'SCORE' }] },
      {
        value: { blue: 2 },
        expected: [
          { effect: 'HEART', heartColor: 'BLUE' },
          { effect: 'HEART', heartColor: 'BLUE' },
        ],
      },
    ])('preserves valid nonempty value $value', ({ value, expected }) => {
      const transform = buildTransform({ [field]: value });

      expect(transform.errors).toEqual([]);
      expect(transform.record!.blade_hearts).toEqual(expected);
      expect(transform.warnings).toEqual([]);
    });

    it.each([
      { value: false, warning: 'unsupported blade heart value' },
      { value: 1, warning: 'unsupported blade heart value' },
      { value: 'unknown', warning: 'unsupported blade heart value' },
      { value: { unknown: 1 }, warning: 'invalid blade heart entry "unknown"' },
      { value: ['unknown'], warning: 'invalid blade heart item #1' },
    ])('retains a parse warning for invalid nonempty value $value', ({ value, warning }) => {
      const transform = buildTransform({ [field]: value });

      expect(transform.errors).toEqual([]);
      expect(transform.record!.blade_hearts).toBeNull();
      expect(transform.warnings).toEqual([`PL!N-bp1-001-N row 1 ${field}: ${warning}`]);
      expect(transform.record!.source_flags!.parseWarnings).toEqual(transform.warnings);
    });

    it('preserves the other Blade Heart source when this field is blank or missing', () => {
      const otherField = field === 'blade_hearts' ? 'special_hearts' : 'blade_hearts';

      for (const fields of [{ [field]: ' ', [otherField]: 'draw' }, { [otherField]: 'draw' }]) {
        const transform = buildTransform(fields);

        expect(transform.errors).toEqual([]);
        expect(transform.record!.blade_hearts).toEqual([{ effect: 'DRAW' }]);
        expect(transform.warnings).toEqual([]);
      }
    });
  });

  it('strips reserved image version metadata supplied by CloudBase', () => {
    const snapshot = buildCloudbaseCardSnapshot([
      {
        _id: 'reserved-source-flags',
        card_code: 'PL!N-bp1-096-N',
        type: 'ENERGY',
        name_jp: 'Reserved flags',
        source_flags: {
          imageObjectVersioned: true,
          imageOriginalBaseName: 'spoofed-name',
          upstreamNote: 'keep',
        },
      },
    ]);

    expect(snapshot.transforms[0]!.record!.source_flags).toMatchObject({
      upstreamNote: 'keep',
      cloudbaseOnly: true,
    });
    expect(snapshot.transforms[0]!.record!.source_flags).not.toHaveProperty('imageObjectVersioned');
    expect(snapshot.transforms[0]!.record!.source_flags).not.toHaveProperty(
      'imageOriginalBaseName'
    );
    expect(snapshot.transforms[0]!.warnings).toContain(
      'PL!N-bp1-096-N row 1: reserved image version source_flags were ignored'
    );
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

  it('compares an existing versioned image by its original basename', () => {
    const snapshot = buildCloudbaseCardSnapshot([
      {
        _id: 'source-image-conflict',
        card_code: 'PL!N-bp1-008-N',
        type: 'ENERGY',
        name_jp: 'Conflicting image',
        image_source_uri: 'cloud://example/shared-image.png',
        image_filename: 'shared-image.png',
      },
    ]);

    const result = buildPreparedCandidates(snapshot.transforms, [
      {
        card_code: 'PL!N-bp1-009-N',
        image_filename: 'shared-image-0123456789abcdef01234567.webp',
        source_flags: {
          imageObjectVersioned: true,
          imageOriginalBaseName: 'shared-image',
        },
      },
    ]);

    expect(result.prepared).toEqual([]);
    expect(result.skipped).toEqual([
      {
        cardCode: 'PL!N-bp1-008-N',
        reason: 'imageBaseNameAlreadyUsed',
        detail: 'shared-image used by PL!N-bp1-009-N',
      },
    ]);
  });

  it('does not mistake a legitimate 24-hex original basename for a version suffix', () => {
    const originalBaseName = 'shared-image-0123456789abcdef01234567';
    const snapshot = buildCloudbaseCardSnapshot([
      {
        _id: 'hex-original-conflict',
        card_code: 'PL!N-bp1-098-N',
        type: 'ENERGY',
        name_jp: 'Hex original conflict',
        image_source_uri: `cloud://example/${originalBaseName}.png`,
        image_filename: `${originalBaseName}.png`,
      },
    ]);

    const result = buildPreparedCandidates(snapshot.transforms, [
      {
        card_code: 'PL!N-bp1-099-N',
        image_filename: `${originalBaseName}.png`,
      },
    ]);

    expect(result.prepared).toEqual([]);
    expect(result.skipped).toEqual([
      {
        cardCode: 'PL!N-bp1-098-N',
        reason: 'imageBaseNameAlreadyUsed',
        detail: `${originalBaseName} used by PL!N-bp1-099-N`,
      },
    ]);
  });

  it('persists explicit original basename metadata with a versioned image reference', () => {
    const snapshot = buildCloudbaseCardSnapshot([
      {
        _id: 'version-metadata',
        card_code: 'PL!N-bp1-097-N',
        type: 'ENERGY',
        name_jp: 'Version metadata',
        image_source_uri: 'cloud://example/source-name.png',
        image_filename: 'source-name.png',
      },
    ]);

    expect(
      withVersionedImageReference(
        snapshot.transforms[0]!.record!,
        'source-name-abcdefabcdefabcdefabcdef.webp',
        'source-name'
      )
    ).toMatchObject({
      image_filename: 'source-name-abcdefabcdefabcdefabcdef.webp',
      source_flags: {
        imageObjectVersioned: true,
        imageOriginalBaseName: 'source-name',
      },
    });

    expect(() =>
      withVersionedImageReference(
        snapshot.transforms[0]!.record!,
        'different-name-abcdefabcdefabcdefabcdef.webp',
        'source-name'
      )
    ).toThrow('image_filename 必须与原始 basename 及 24 位版本摘要完全对应');
  });

  it('clears version metadata when images are skipped or allowed to remain missing', () => {
    const snapshot = buildCloudbaseCardSnapshot([
      {
        _id: 'missing-versioned-image',
        card_code: 'PL!N-bp1-095-N',
        type: 'ENERGY',
        name_jp: 'Missing image',
      },
    ]);
    const versioned = withVersionedImageReference(
      snapshot.transforms[0]!.record!,
      'missing-image-abcdefabcdefabcdefabcdef.webp',
      'missing-image'
    );

    for (const record of [
      withSourceFlag(versioned, 'imageSkipped'),
      withSourceFlag(versioned, 'imageUploadFailed'),
    ]) {
      expect(record.image_filename).toBeNull();
      expect(record.source_flags).not.toHaveProperty('imageObjectVersioned');
      expect(record.source_flags).not.toHaveProperty('imageOriginalBaseName');
    }
  });

  it('blocks all candidates when existing image version metadata is incomplete or stale', () => {
    const snapshot = buildCloudbaseCardSnapshot([
      {
        _id: 'metadata-blocked-candidate',
        card_code: 'PL!N-bp1-094-N',
        type: 'ENERGY',
        name_jp: 'Blocked candidate',
        image_source_uri: 'cloud://example/replacement.png',
        image_filename: 'replacement.png',
      },
    ]);

    const result = buildPreparedCandidates(snapshot.transforms, [
      {
        card_code: 'EMPTY-IMAGE',
        image_filename: null,
        source_flags: {
          imageObjectVersioned: true,
          imageOriginalBaseName: 'old-base',
        },
      },
      {
        card_code: 'REPLACED-IMAGE',
        image_filename: 'replacement.webp',
        source_flags: {
          imageObjectVersioned: true,
          imageOriginalBaseName: 'old-base',
        },
      },
      {
        card_code: 'PARTIAL-METADATA',
        image_filename: 'partial-abcdefabcdefabcdefabcdef.webp',
        source_flags: { imageObjectVersioned: true },
      },
    ]);

    expect(result.prepared).toEqual([]);
    expect(result.existingImageMetadataIssues.map((issue) => issue.cardCode)).toEqual([
      'EMPTY-IMAGE',
      'REPLACED-IMAGE',
      'PARTIAL-METADATA',
    ]);
  });

  it('reconciles an ambiguous commit by the exact stored image filename', async () => {
    const exactQuery = vi.fn().mockResolvedValue({
      rows: [{ image_filename: 'card-version.webp' }],
    });
    await expect(
      reconcileCardImageReference(
        { query: exactQuery } as never,
        'PL!N-bp1-010-N',
        'card-version.webp',
        true
      )
    ).resolves.toEqual({ status: 'REFERENCED' });

    const differentQuery = vi.fn().mockResolvedValue({
      rows: [{ image_filename: 'another-version.webp' }],
    });
    await expect(
      reconcileCardImageReference(
        { query: differentQuery } as never,
        'PL!N-bp1-010-N',
        'card-version.webp',
        true
      )
    ).resolves.toEqual({ status: 'NOT_REFERENCED' });

    const emptyQueryBeforeTransactionEnds = vi.fn().mockResolvedValue({ rows: [] });
    await expect(
      reconcileCardImageReference(
        { query: emptyQueryBeforeTransactionEnds } as never,
        'PL!N-bp1-010-N',
        'card-version.webp',
        false
      )
    ).resolves.toEqual({ status: 'UNKNOWN' });

    const failedQuery = vi.fn().mockRejectedValue(new Error('database unavailable'));
    await expect(
      reconcileCardImageReference(
        { query: failedQuery } as never,
        'PL!N-bp1-010-N',
        'card-version.webp',
        true
      )
    ).resolves.toEqual({ status: 'UNKNOWN', error: 'database unavailable' });
  });

  it('preserves a CLI upload when a failed COMMIT is confirmed to have inserted the card', async () => {
    const snapshot = buildCloudbaseCardSnapshot([
      {
        _id: 'ambiguous-commit',
        card_code: 'PL!N-bp1-011-N',
        type: 'ENERGY',
        name_jp: 'Ambiguous commit',
        image_source_uri: 'cloud://example/ambiguous.png',
        image_filename: 'ambiguous.png',
      },
    ]);
    const record = {
      ...snapshot.transforms[0]!.record!,
      image_filename: 'ambiguous-0123456789abcdef01234567.webp',
    };
    const client = {
      query: vi.fn((text: string) => {
        if (text.includes('INSERT INTO cards')) {
          return Promise.resolve({ rows: [{ card_code: record.card_code }], rowCount: 1 });
        }
        if (text === 'COMMIT') {
          return Promise.reject(new Error('connection lost after commit'));
        }
        return Promise.resolve({ rows: [], rowCount: null });
      }),
      release: vi.fn(),
    };
    const pool = {
      connect: vi.fn().mockResolvedValue(client),
      query: vi.fn().mockResolvedValue({ rows: [{ image_filename: record.image_filename }] }),
    };

    await expect(insertCard(pool as never, record)).resolves.toEqual({
      cardCode: record.card_code,
      inserted: true,
      preserveUploadedImages: true,
    });
    expect(pool.query).toHaveBeenCalledWith(
      'SELECT image_filename FROM cards WHERE card_code = $1',
      [record.card_code]
    );
    expect(client.release).toHaveBeenCalledOnce();
  });

  it('preserves a CLI upload when COMMIT and ROLLBACK fail before an empty reconciliation read', async () => {
    const snapshot = buildCloudbaseCardSnapshot([
      {
        _id: 'delayed-commit',
        card_code: 'PL!N-bp1-013-N',
        type: 'ENERGY',
        name_jp: 'Delayed commit',
        image_source_uri: 'cloud://example/delayed.png',
        image_filename: 'delayed.png',
      },
    ]);
    const record = withVersionedImageReference(
      snapshot.transforms[0]!.record!,
      'delayed-0123456789abcdef01234567.webp',
      'delayed'
    );
    const client = {
      query: vi.fn((text: string) => {
        if (text.includes('INSERT INTO cards')) {
          return Promise.resolve({ rows: [{ card_code: record.card_code }], rowCount: 1 });
        }
        if (text === 'COMMIT' || text === 'ROLLBACK') {
          return Promise.reject(new Error('connection lost'));
        }
        return Promise.resolve({ rows: [], rowCount: null });
      }),
      release: vi.fn(),
    };
    const pool = {
      connect: vi.fn().mockResolvedValue(client),
      query: vi.fn().mockResolvedValue({ rows: [] }),
    };
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(insertCard(pool as never, record)).resolves.toEqual({
      cardCode: record.card_code,
      inserted: false,
      preserveUploadedImages: true,
      error: 'card insert commit outcome is unknown; uploaded images were preserved',
    });
    expect(client.release).toHaveBeenCalledWith(true);
    consoleError.mockRestore();
  });

  it('preserves a CLI upload when reconciliation after a failed COMMIT is unavailable', async () => {
    const snapshot = buildCloudbaseCardSnapshot([
      {
        _id: 'unknown-commit',
        card_code: 'PL!N-bp1-012-N',
        type: 'ENERGY',
        name_jp: 'Unknown commit',
        image_source_uri: 'cloud://example/unknown.png',
        image_filename: 'unknown.png',
      },
    ]);
    const record = {
      ...snapshot.transforms[0]!.record!,
      image_filename: 'unknown-0123456789abcdef01234567.webp',
    };
    const client = {
      query: vi.fn((text: string) => {
        if (text.includes('INSERT INTO cards')) {
          return Promise.resolve({ rows: [{ card_code: record.card_code }], rowCount: 1 });
        }
        if (text === 'COMMIT') {
          return Promise.reject(new Error('connection lost after commit'));
        }
        return Promise.resolve({ rows: [], rowCount: null });
      }),
      release: vi.fn(),
    };
    const pool = {
      connect: vi.fn().mockResolvedValue(client),
      query: vi.fn().mockRejectedValue(new Error('database unavailable')),
    };
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(insertCard(pool as never, record)).resolves.toEqual({
      cardCode: record.card_code,
      inserted: false,
      preserveUploadedImages: true,
      error: 'card insert commit outcome is unknown; uploaded images were preserved',
    });
    consoleError.mockRestore();
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
