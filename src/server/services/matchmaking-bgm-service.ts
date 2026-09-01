import { createHash } from 'node:crypto';
import type { QueryResultRow } from 'pg';
import { pool } from '../db/pool.js';
import { deleteObject, objectExists, uploadPublicImmutableObject } from './minio-service.js';

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

interface MatchmakingBgmRow extends QueryResultRow {
  readonly id: string;
  readonly title: string;
  readonly storage_key: string;
  readonly byte_size: number;
  readonly is_default: boolean;
  readonly created_at: Date | string;
}

export interface MatchmakingBgmTrack {
  readonly id: string;
  readonly title: string;
  readonly audioUrl: string;
  readonly byteSize: number;
  readonly source: 'BUNDLED' | 'UPLOADED';
  readonly defaultSelected: boolean;
  readonly createdAt: string;
}

export class MatchmakingBgmServiceError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number
  ) {
    super(message);
    this.name = 'MatchmakingBgmServiceError';
  }
}

interface MatchmakingBgmServiceDependencies {
  readonly uploadObject?: typeof uploadPublicImmutableObject;
  readonly deleteObject?: typeof deleteObject;
  readonly objectExists?: typeof objectExists;
}

export class MatchmakingBgmService {
  private readonly uploadObject: typeof uploadPublicImmutableObject;
  private readonly removeObject: typeof deleteObject;
  private readonly objectExists: typeof objectExists;

  constructor(dependencies: MatchmakingBgmServiceDependencies = {}) {
    this.uploadObject = dependencies.uploadObject ?? uploadPublicImmutableObject;
    this.removeObject = dependencies.deleteObject ?? deleteObject;
    this.objectExists = dependencies.objectExists ?? objectExists;
  }

  async listTracks(): Promise<readonly MatchmakingBgmTrack[]> {
    const result = await pool.query<MatchmakingBgmRow>(
      `SELECT id, title, storage_key, byte_size, is_default, created_at
       FROM matchmaking_bgm_tracks
       ORDER BY created_at ASC, id ASC`
    );
    return result.rows.map(mapTrack);
  }

  async uploadTrack(input: {
    readonly file: Buffer;
    readonly title: string;
    readonly adminUserId: string;
  }): Promise<MatchmakingBgmTrack> {
    const title = normalizeTitle(input.title);
    if (input.file.length === 0 || input.file.length > MAX_UPLOAD_BYTES) {
      throw serviceError('MATCHMAKING_BGM_TOO_LARGE', 'BGM 文件必须小于 20 MB', 413);
    }
    if (!isMp3(input.file)) {
      throw serviceError('MATCHMAKING_BGM_FORMAT_INVALID', 'BGM 只接受有效的 MP3 文件', 422);
    }

    const hash = createHash('sha256').update(input.file).digest('hex');
    const objectKey = `matchmaking-bgm/${hash}.mp3`;
    const existing = await pool.query<MatchmakingBgmRow>(
      `SELECT id, title, storage_key, byte_size, is_default, created_at
       FROM matchmaking_bgm_tracks
       WHERE storage_key = $1`,
      [objectKey]
    );
    if (existing.rows[0]) {
      throw serviceError('MATCHMAKING_BGM_DUPLICATE', '这首 BGM 已存在于曲库中', 409);
    }

    const uploaded = !(await this.objectExists(objectKey));
    if (uploaded) {
      await this.uploadObject(objectKey, input.file, 'audio/mpeg');
    }

    try {
      const result = await pool.query<MatchmakingBgmRow>(
        `INSERT INTO matchmaking_bgm_tracks
           (title, storage_key, byte_size, created_by)
         VALUES ($1, $2, $3, $4)
         RETURNING id, title, storage_key, byte_size, is_default, created_at`,
        [title, objectKey, input.file.length, input.adminUserId]
      );
      const row = result.rows[0];
      if (!row) {
        throw serviceError('MATCHMAKING_BGM_SAVE_FAILED', 'BGM 保存失败', 500);
      }
      return mapTrack(row);
    } catch (error) {
      if (isUniqueViolation(error)) {
        // A concurrent identical upload may already reference this content-addressed object.
        throw serviceError('MATCHMAKING_BGM_DUPLICATE', '这首 BGM 已存在于曲库中', 409);
      }
      if (uploaded) {
        await this.removeObject(objectKey).catch((cleanupError: unknown) => {
          console.error('[MatchmakingBgm] Failed to clean up upload:', cleanupError);
        });
      }
      throw error;
    }
  }

  async setDefaultTracks(trackIds: readonly string[]): Promise<readonly MatchmakingBgmTrack[]> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const current = await client.query<{ id: string }>(
        `SELECT id FROM matchmaking_bgm_tracks ORDER BY id FOR UPDATE`
      );
      const currentIds = new Set(current.rows.map((row) => row.id));
      const unknownId = trackIds.find((id) => !currentIds.has(id));
      if (unknownId) {
        throw serviceError(
          'MATCHMAKING_BGM_DEFAULT_TRACK_NOT_FOUND',
          '默认子集包含已删除的曲目，请重新载入后再保存',
          422
        );
      }
      await client.query(
        `UPDATE matchmaking_bgm_tracks
         SET is_default = (id = ANY($1::uuid[]))`,
        [[...trackIds]]
      );
      const result = await client.query<MatchmakingBgmRow>(
        `SELECT id, title, storage_key, byte_size, is_default, created_at
         FROM matchmaking_bgm_tracks
         ORDER BY created_at ASC, id ASC`
      );
      await client.query('COMMIT');
      return result.rows.map(mapTrack);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async deleteTrack(trackId: string): Promise<void> {
    const result = await pool.query<MatchmakingBgmRow>(
      `DELETE FROM matchmaking_bgm_tracks
       WHERE id = $1
       RETURNING id, title, storage_key, byte_size, is_default, created_at`,
      [trackId]
    );
    const deleted = result.rows[0];
    if (!deleted) {
      throw serviceError('MATCHMAKING_BGM_NOT_FOUND', 'BGM 不存在或已被删除', 404);
    }
    if (!isBundledStorageKey(deleted.storage_key)) {
      await this.removeObject(deleted.storage_key).catch((error: unknown) => {
        console.error('[MatchmakingBgm] Failed to delete retired object:', error);
      });
    }
  }
}

function mapTrack(row: MatchmakingBgmRow): MatchmakingBgmTrack {
  return {
    id: row.id,
    title: row.title,
    audioUrl: isBundledStorageKey(row.storage_key)
      ? `/${row.storage_key}`
      : `/images/${row.storage_key}`,
    byteSize: row.byte_size,
    source: isBundledStorageKey(row.storage_key) ? 'BUNDLED' : 'UPLOADED',
    defaultSelected: row.is_default,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

function isBundledStorageKey(value: string): boolean {
  return value.startsWith('music/');
}

function normalizeTitle(value: string): string {
  const title = value.trim();
  if (!title || [...title].length > 100 || containsControlCharacter(title)) {
    throw serviceError('MATCHMAKING_BGM_TITLE_INVALID', '曲名须为 1 至 100 个字符', 422);
  }
  return title;
}

function containsControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0);
    return (
      codePoint !== undefined && (codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f))
    );
  });
}

function isMp3(value: Buffer): boolean {
  if (value.length < 3) return false;
  if (value.subarray(0, 3).toString('ascii') === 'ID3') return true;
  return value[0] === 0xff && (value[1]! & 0xe0) === 0xe0;
}

function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: unknown }).code === '23505';
}

function serviceError(code: string, message: string, statusCode: number) {
  return new MatchmakingBgmServiceError(code, message, statusCode);
}

export const matchmakingBgmService = new MatchmakingBgmService();
