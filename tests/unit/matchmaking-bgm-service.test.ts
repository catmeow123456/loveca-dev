import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  poolQuery: vi.fn(),
  poolConnect: vi.fn(),
  uploadObject: vi.fn(),
  deleteObject: vi.fn(),
  objectExists: vi.fn(),
}));

vi.mock('../../src/server/db/pool.js', () => ({
  pool: { query: mocks.poolQuery, connect: mocks.poolConnect },
}));

vi.mock('../../src/server/services/minio-service.js', () => ({
  uploadPublicImmutableObject: mocks.uploadObject,
  deleteObject: mocks.deleteObject,
  objectExists: mocks.objectExists,
}));

import {
  MatchmakingBgmService,
  MatchmakingBgmServiceError,
} from '../../src/server/services/matchmaking-bgm-service';

const ADMIN_ID = '11111111-1111-4111-8111-111111111111';
const TRACK_ID = '22222222-2222-4222-8222-222222222222';

describe('MatchmakingBgmService', () => {
  afterEach(() => {
    vi.clearAllMocks();
    mocks.deleteObject.mockResolvedValue(undefined);
  });

  it('maps bundled and uploaded tracks to public audio URLs', async () => {
    mocks.poolQuery.mockResolvedValue({
      rows: [
        trackRow({ storage_key: 'music/intro-theme.mp3' }),
        trackRow({
          id: '33333333-3333-4333-8333-333333333333',
          title: '上传曲目',
          storage_key: `matchmaking-bgm/${'a'.repeat(64)}.mp3`,
        }),
      ],
    });

    await expect(new MatchmakingBgmService().listTracks()).resolves.toEqual([
      expect.objectContaining({
        title: 'Intro Theme',
        audioUrl: '/music/intro-theme.mp3',
        source: 'BUNDLED',
        defaultSelected: true,
      }),
      expect.objectContaining({
        title: '上传曲目',
        audioUrl: `/images/matchmaking-bgm/${'a'.repeat(64)}.mp3`,
        source: 'UPLOADED',
      }),
    ]);
  });

  it('validates the MP3 file before accessing object storage', async () => {
    await expect(
      new MatchmakingBgmService().uploadTrack({
        file: Buffer.from('not an mp3'),
        title: '错误文件',
        adminUserId: ADMIN_ID,
      })
    ).rejects.toEqual(
      expect.objectContaining<Partial<MatchmakingBgmServiceError>>({
        code: 'MATCHMAKING_BGM_FORMAT_INVALID',
        statusCode: 422,
      })
    );

    expect(mocks.poolQuery).not.toHaveBeenCalled();
    expect(mocks.uploadObject).not.toHaveBeenCalled();
  });

  it('uploads a content-addressed MP3 and persists its library entry', async () => {
    const file = Buffer.concat([Buffer.from('ID3'), Buffer.alloc(24, 7)]);
    const objectKey = `matchmaking-bgm/${createHash('sha256').update(file).digest('hex')}.mp3`;
    mocks.poolQuery.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({
      rows: [
        trackRow({
          title: '新的候场曲',
          storage_key: objectKey,
          byte_size: file.length,
          is_default: false,
        }),
      ],
    });
    mocks.objectExists.mockResolvedValue(false);

    const track = await new MatchmakingBgmService().uploadTrack({
      file,
      title: '  新的候场曲  ',
      adminUserId: ADMIN_ID,
    });

    expect(track.title).toBe('新的候场曲');
    expect(track.defaultSelected).toBe(false);
    expect(mocks.uploadObject).toHaveBeenCalledWith(objectKey, file, 'audio/mpeg');
    expect(mocks.poolQuery.mock.calls[1]?.[1]).toEqual([
      '新的候场曲',
      objectKey,
      file.length,
      ADMIN_ID,
    ]);
  });

  it('removes uploaded objects after deleting their active library entry', async () => {
    const objectKey = `matchmaking-bgm/${'b'.repeat(64)}.mp3`;
    mocks.poolQuery.mockResolvedValue({
      rows: [trackRow({ storage_key: objectKey })],
    });

    await new MatchmakingBgmService().deleteTrack(TRACK_ID);

    expect(mocks.deleteObject).toHaveBeenCalledWith(objectKey);
  });

  it('deletes bundled entries without trying to remove release assets', async () => {
    mocks.poolQuery.mockResolvedValue({ rows: [trackRow()] });

    await new MatchmakingBgmService().deleteTrack(TRACK_ID);

    expect(mocks.deleteObject).not.toHaveBeenCalled();
  });

  it('atomically replaces the administrator default subset', async () => {
    const transactionQuery = vi
      .fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: TRACK_ID }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [trackRow({ is_default: true })] })
      .mockResolvedValueOnce({ rows: [] });
    const release = vi.fn();
    mocks.poolConnect.mockResolvedValue({ query: transactionQuery, release });

    await expect(new MatchmakingBgmService().setDefaultTracks([TRACK_ID])).resolves.toEqual([
      expect.objectContaining({ id: TRACK_ID, defaultSelected: true }),
    ]);

    expect(transactionQuery.mock.calls[2]?.[1]).toEqual([[TRACK_ID]]);
    expect(transactionQuery).toHaveBeenNthCalledWith(5, 'COMMIT');
    expect(release).toHaveBeenCalledOnce();
  });

  it('rejects a stale default track id and rolls back', async () => {
    const transactionQuery = vi
      .fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: TRACK_ID }] })
      .mockResolvedValueOnce({ rows: [] });
    const release = vi.fn();
    mocks.poolConnect.mockResolvedValue({ query: transactionQuery, release });

    await expect(
      new MatchmakingBgmService().setDefaultTracks(['33333333-3333-4333-8333-333333333333'])
    ).rejects.toEqual(expect.objectContaining({ code: 'MATCHMAKING_BGM_DEFAULT_TRACK_NOT_FOUND' }));

    expect(transactionQuery).toHaveBeenNthCalledWith(3, 'ROLLBACK');
    expect(release).toHaveBeenCalledOnce();
  });
});

function trackRow(
  overrides: Partial<{
    id: string;
    title: string;
    storage_key: string;
    byte_size: number;
    is_default: boolean;
  }> = {}
) {
  return {
    id: TRACK_ID,
    title: 'Intro Theme',
    storage_key: 'music/intro-theme.mp3',
    byte_size: 2111155,
    is_default: true,
    created_at: new Date('2026-09-01T00:00:00.000Z'),
    ...overrides,
  };
}
