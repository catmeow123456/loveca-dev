import { describe, expect, it, vi } from 'vitest';
import type { ReplaySerializedPayloadEnvelope } from '../../src/online/replay-types';
import {
  SolitaireRuntimeRecoveryService,
  type SolitaireRuntimeRecoveryQueryClient,
} from '../../src/server/services/solitaire-runtime-recovery-service';
import {
  GAME_STATE_SCHEMA_VERSION,
  LEGACY_GAME_STATE_SCHEMA_VERSION,
} from '../../src/server/services/replay-constants';

vi.mock('../../src/server/db/pool.js', () => ({
  pool: { query: vi.fn() },
}));

describe('solitaire runtime recovery authority schema boundary', () => {
  it('拒绝 checkpoint 表字段与 envelope 不一致的权威状态版本', async () => {
    const service = createService({
      schemaVersion: LEGACY_GAME_STATE_SCHEMA_VERSION,
      sourceSchemaVersion: GAME_STATE_SCHEMA_VERSION,
    });

    await expect(service.recoverMatch('match-1', 'user-1')).rejects.toMatchObject({
      code: 'SOLITAIRE_MATCH_RECOVERY_CORRUPTED',
      statusCode: 409,
    });
  });

  it('拒绝表字段与 envelope 一致但未支持的权威状态版本', async () => {
    const service = createService({
      schemaVersion: 'GAME_STATE_V0',
      sourceSchemaVersion: 'GAME_STATE_V0',
    });

    await expect(service.recoverMatch('match-1', 'user-1')).rejects.toMatchObject({
      code: 'SOLITAIRE_MATCH_RECOVERY_UNSUPPORTED',
      statusCode: 409,
    });
  });

  it('拒绝 checkpoint 表字段与 envelope 不一致的 payload hash', async () => {
    const service = createService({
      schemaVersion: GAME_STATE_SCHEMA_VERSION,
      sourceSchemaVersion: GAME_STATE_SCHEMA_VERSION,
      payloadHash: 'sha256:table-hash-mismatch',
    });

    await expect(service.recoverMatch('match-1', 'user-1')).rejects.toMatchObject({
      code: 'SOLITAIRE_MATCH_RECOVERY_CORRUPTED',
      statusCode: 409,
    });
  });

  it('非法 base64 checkpoint 按内容损坏拒绝，而不是版本不支持', async () => {
    const service = createService({
      schemaVersion: GAME_STATE_SCHEMA_VERSION,
      sourceSchemaVersion: GAME_STATE_SCHEMA_VERSION,
      encodedPayload: '!',
    });

    await expect(service.recoverMatch('match-1', 'user-1')).rejects.toMatchObject({
      code: 'SOLITAIRE_MATCH_RECOVERY_CORRUPTED',
      statusCode: 409,
    });
  });
});

function createService(options: {
  readonly schemaVersion: string;
  readonly sourceSchemaVersion: string;
  readonly payloadHash?: string;
  readonly encodedPayload?: string;
}): SolitaireRuntimeRecoveryService {
  const payload = createEnvelope(options.sourceSchemaVersion, options.encodedPayload);
  const queryClient: SolitaireRuntimeRecoveryQueryClient = {
    query<T = unknown>(text: string) {
      if (text.includes('FROM match_records record')) {
        return Promise.resolve({
          rows: [
            {
              match_id: 'match-1',
              status: 'IN_PROGRESS',
            },
          ] as T[],
        });
      }
      if (text.includes('FROM match_participants')) {
        return Promise.resolve({ rows: [] as T[] });
      }
      if (text.includes('FROM match_deck_snapshots')) {
        return Promise.resolve({ rows: [] as T[] });
      }
      if (text.includes('FROM match_checkpoints')) {
        return Promise.resolve({
          rows: [
            {
              checkpoint_seq: 1,
              timeline_seq: 1,
              related_public_seq: 0,
              related_command_seq: null,
              related_game_event_seq: null,
              schema_version: options.schemaVersion,
              payload,
              payload_compression: 'GZIP',
              payload_hash: options.payloadHash ?? payload.payloadHash,
            },
          ] as T[],
        });
      }
      throw new Error(`unexpected query: ${text}`);
    },
  };
  return new SolitaireRuntimeRecoveryService({ queryClient });
}

function createEnvelope(
  sourceSchemaVersion: string,
  encodedPayload = ''
): ReplaySerializedPayloadEnvelope {
  return {
    payloadSchemaVersion: 1,
    serializer: 'TRANSPORT_V1',
    payloadKind: 'AUTHORITY_GAME_STATE',
    sourceSchemaVersion,
    compressed: true,
    compression: 'GZIP',
    encoding: 'BASE64_JSON',
    payloadHash: 'sha256:not-read-before-version-check',
    uncompressedByteLength: 0,
    compressedByteLength: 0,
    payload: encodedPayload,
  };
}
