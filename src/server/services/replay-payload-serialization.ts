import { createHash } from 'node:crypto';
import type { GameState } from '../../domain/entities/game.js';
import { fromTransport, toTransport } from '../../online/serde.js';
import type {
  ReplayPayloadKind,
  ReplaySerializedPayloadEnvelope,
} from '../../online/replay-types.js';

const SUPPORTED_PAYLOAD_SCHEMA_VERSION = 1;
const SUPPORTED_SERIALIZER = 'TRANSPORT_V1';
const SUPPORTED_COMPRESSION = 'NONE';
const SUPPORTED_ENCODING = 'JSON_VALUE';

export class ReplayPayloadSerializationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReplayPayloadSerializationError';
  }
}

export function serializeReplayPayload(
  payload: unknown,
  payloadKind: ReplayPayloadKind,
  sourceSchemaVersion: string
): ReplaySerializedPayloadEnvelope {
  const transportPayload = toTransport(payload);
  const stablePayloadJson = stableJsonStringify(transportPayload);
  const uncompressedByteLength = Buffer.byteLength(stablePayloadJson, 'utf8');

  return {
    payloadSchemaVersion: SUPPORTED_PAYLOAD_SCHEMA_VERSION,
    serializer: SUPPORTED_SERIALIZER,
    payloadKind,
    sourceSchemaVersion,
    compressed: false,
    compression: SUPPORTED_COMPRESSION,
    encoding: SUPPORTED_ENCODING,
    payloadHash: hashStablePayloadJson(stablePayloadJson),
    uncompressedByteLength,
    compressedByteLength: uncompressedByteLength,
    payload: transportPayload,
  };
}

export function rehydrateReplayPayload<T>(
  envelope: ReplaySerializedPayloadEnvelope,
  expectedPayloadKind?: ReplayPayloadKind
): T {
  validateReplayPayloadEnvelope(envelope, expectedPayloadKind);
  return fromTransport<T>(envelope.payload);
}

export function rehydrateAuthorityGameState(envelope: ReplaySerializedPayloadEnvelope): GameState {
  return rehydrateReplayPayload<GameState>(envelope, 'AUTHORITY_GAME_STATE');
}

export function validateReplayPayloadEnvelope(
  envelope: ReplaySerializedPayloadEnvelope,
  expectedPayloadKind?: ReplayPayloadKind
): void {
  if (envelope.payloadSchemaVersion !== SUPPORTED_PAYLOAD_SCHEMA_VERSION) {
    throw new ReplayPayloadSerializationError(
      `不支持的 replay payload schema version: ${envelope.payloadSchemaVersion}`
    );
  }
  if (envelope.serializer !== SUPPORTED_SERIALIZER) {
    throw new ReplayPayloadSerializationError(`不支持的 replay serializer: ${envelope.serializer}`);
  }
  if (expectedPayloadKind && envelope.payloadKind !== expectedPayloadKind) {
    throw new ReplayPayloadSerializationError(
      `replay payload 类型不匹配: expected ${expectedPayloadKind}, got ${envelope.payloadKind}`
    );
  }
  if (
    envelope.compressed ||
    envelope.compression !== SUPPORTED_COMPRESSION ||
    envelope.encoding !== SUPPORTED_ENCODING
  ) {
    throw new ReplayPayloadSerializationError('当前版本只支持未压缩 JSON_VALUE replay payload');
  }

  const stablePayloadJson = stableJsonStringify(envelope.payload);
  const expectedHash = hashStablePayloadJson(stablePayloadJson);
  if (envelope.payloadHash !== expectedHash) {
    throw new ReplayPayloadSerializationError('replay payload hash 校验失败');
  }

  const uncompressedByteLength = Buffer.byteLength(stablePayloadJson, 'utf8');
  if (envelope.uncompressedByteLength !== uncompressedByteLength) {
    throw new ReplayPayloadSerializationError('replay payload byte length 校验失败');
  }
}

export function toReplayJsonValue<T>(value: T): T {
  return toTransport(value) as T;
}

export function stableJsonStringify(value: unknown): string {
  return JSON.stringify(toStableJsonValue(value)) ?? 'null';
}

function hashStablePayloadJson(stablePayloadJson: string): string {
  return `sha256:${createHash('sha256').update(stablePayloadJson).digest('hex')}`;
}

function toStableJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => toStableJsonValue(entry) ?? null);
  }

  if (value && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const sortedEntries = Object.keys(source)
      .sort()
      .flatMap((key): readonly [string, unknown][] => {
        const normalizedValue = toStableJsonValue(source[key]);
        return normalizedValue === undefined ? [] : [[key, normalizedValue]];
      });
    return Object.fromEntries(sortedEntries);
  }

  if (typeof value === 'bigint') {
    return value.toString();
  }

  if (typeof value === 'function' || typeof value === 'symbol' || value === undefined) {
    return undefined;
  }

  return value;
}
