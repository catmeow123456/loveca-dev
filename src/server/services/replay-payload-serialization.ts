import { createHash } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';
import type { GameState } from '../../domain/entities/game.js';
import { fromTransport, toTransport } from '../../online/serde.js';
import type {
  ReplayPayloadKind,
  ReplaySerializedPayloadEnvelope,
} from '../../online/replay-types.js';

const SUPPORTED_PAYLOAD_SCHEMA_VERSION = 1;
const SUPPORTED_SERIALIZER = 'TRANSPORT_V1';
const SUPPORTED_COMPRESSION = 'GZIP';
const SUPPORTED_ENCODING = 'BASE64_JSON';
const LEGACY_COMPRESSION = 'NONE';
const LEGACY_ENCODING = 'JSON_VALUE';

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
  return serializeTransportPayload(transportPayload, payloadKind, sourceSchemaVersion);
}

export function compressLegacyReplayPayloadEnvelopeForMigration(
  envelope: ReplaySerializedPayloadEnvelope,
  expectedPayloadKind?: ReplayPayloadKind
): ReplaySerializedPayloadEnvelope {
  const transportPayload = readValidatedTransportPayload(envelope, expectedPayloadKind, 'legacy');
  return serializeTransportPayload(transportPayload, envelope.payloadKind, envelope.sourceSchemaVersion);
}

export function rehydrateLegacyReplayPayloadForMigration<T>(
  envelope: ReplaySerializedPayloadEnvelope,
  expectedPayloadKind?: ReplayPayloadKind
): T {
  const transportPayload = readValidatedTransportPayload(envelope, expectedPayloadKind, 'legacy');
  return fromTransport<T>(transportPayload);
}

function serializeTransportPayload(
  transportPayload: unknown,
  payloadKind: ReplayPayloadKind,
  sourceSchemaVersion: string
): ReplaySerializedPayloadEnvelope {
  const stablePayloadJson = stableJsonStringify(transportPayload);
  const uncompressedByteLength = Buffer.byteLength(stablePayloadJson, 'utf8');
  const compressedPayload = gzipSync(Buffer.from(stablePayloadJson, 'utf8'));

  return {
    payloadSchemaVersion: SUPPORTED_PAYLOAD_SCHEMA_VERSION,
    serializer: SUPPORTED_SERIALIZER,
    payloadKind,
    sourceSchemaVersion,
    compressed: true,
    compression: SUPPORTED_COMPRESSION,
    encoding: SUPPORTED_ENCODING,
    payloadHash: hashStablePayloadJson(stablePayloadJson),
    uncompressedByteLength,
    compressedByteLength: compressedPayload.byteLength,
    payload: compressedPayload.toString('base64'),
  };
}

export function rehydrateReplayPayload<T>(
  envelope: ReplaySerializedPayloadEnvelope,
  expectedPayloadKind?: ReplayPayloadKind
): T {
  const transportPayload = readValidatedTransportPayload(envelope, expectedPayloadKind, 'current');
  return fromTransport<T>(transportPayload);
}

export function rehydrateAuthorityGameState(envelope: ReplaySerializedPayloadEnvelope): GameState {
  return rehydrateReplayPayload<GameState>(envelope, 'AUTHORITY_GAME_STATE');
}

export function validateReplayPayloadEnvelope(
  envelope: ReplaySerializedPayloadEnvelope,
  expectedPayloadKind?: ReplayPayloadKind
): void {
  readValidatedTransportPayload(envelope, expectedPayloadKind, 'current');
}

export function toReplayJsonValue<T>(value: T): T {
  return toTransport(value) as T;
}

export function stableJsonStringify(value: unknown): string {
  return JSON.stringify(toStableJsonValue(value)) ?? 'null';
}

type ReplayPayloadReadMode = 'current' | 'legacy';

function readValidatedTransportPayload(
  envelope: ReplaySerializedPayloadEnvelope,
  expectedPayloadKind: ReplayPayloadKind | undefined,
  mode: ReplayPayloadReadMode
): unknown {
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

  if (mode === 'legacy') {
    return readLegacyTransportPayload(envelope);
  }

  return readCurrentTransportPayload(envelope);
}

function readCurrentTransportPayload(envelope: ReplaySerializedPayloadEnvelope): unknown {
  if (
    !envelope.compressed ||
    envelope.compression !== SUPPORTED_COMPRESSION ||
    envelope.encoding !== SUPPORTED_ENCODING
  ) {
    throw new ReplayPayloadSerializationError('当前版本只支持 GZIP/BASE64_JSON replay payload');
  }
  if (typeof envelope.payload !== 'string') {
    throw new ReplayPayloadSerializationError('压缩 replay payload 必须是 base64 字符串');
  }

  const compressedPayload = decodeBase64Payload(envelope.payload);
  if (envelope.compressedByteLength !== compressedPayload.byteLength) {
    throw new ReplayPayloadSerializationError('replay payload compressed byte length 校验失败');
  }

  let stablePayloadJson: string;
  try {
    stablePayloadJson = gunzipSync(compressedPayload).toString('utf8');
  } catch (error) {
    throw new ReplayPayloadSerializationError('压缩 replay payload 解压失败');
  }

  return validateStablePayloadJson(stablePayloadJson, envelope);
}

function readLegacyTransportPayload(envelope: ReplaySerializedPayloadEnvelope): unknown {
  if (
    envelope.compressed ||
    envelope.compression !== LEGACY_COMPRESSION ||
    envelope.encoding !== LEGACY_ENCODING
  ) {
    throw new ReplayPayloadSerializationError(
      '迁移读取只支持旧 NONE/JSON_VALUE replay payload'
    );
  }

  const stablePayloadJson = stableJsonStringify(envelope.payload);
  if (envelope.compressedByteLength !== envelope.uncompressedByteLength) {
    throw new ReplayPayloadSerializationError('旧 replay payload compressed byte length 校验失败');
  }
  validatePayloadIntegrity(stablePayloadJson, envelope);
  return envelope.payload;
}

function validateStablePayloadJson(
  stablePayloadJson: string,
  envelope: ReplaySerializedPayloadEnvelope
): unknown {
  validatePayloadIntegrity(stablePayloadJson, envelope);

  let transportPayload: unknown;
  try {
    transportPayload = JSON.parse(stablePayloadJson);
  } catch (error) {
    throw new ReplayPayloadSerializationError('replay payload JSON parse 失败');
  }

  if (stableJsonStringify(transportPayload) !== stablePayloadJson) {
    throw new ReplayPayloadSerializationError('replay payload stable JSON 校验失败');
  }

  return transportPayload;
}

function validatePayloadIntegrity(
  stablePayloadJson: string,
  envelope: ReplaySerializedPayloadEnvelope
): void {
  const expectedHash = hashStablePayloadJson(stablePayloadJson);
  if (envelope.payloadHash !== expectedHash) {
    throw new ReplayPayloadSerializationError('replay payload hash 校验失败');
  }

  const uncompressedByteLength = Buffer.byteLength(stablePayloadJson, 'utf8');
  if (envelope.uncompressedByteLength !== uncompressedByteLength) {
    throw new ReplayPayloadSerializationError('replay payload byte length 校验失败');
  }
}

function hashStablePayloadJson(stablePayloadJson: string): string {
  return `sha256:${createHash('sha256').update(stablePayloadJson).digest('hex')}`;
}

function decodeBase64Payload(payload: string): Buffer {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(payload) || payload.length % 4 === 1) {
    throw new ReplayPayloadSerializationError('压缩 replay payload base64 编码无效');
  }

  const buffer = Buffer.from(payload, 'base64');
  if (buffer.toString('base64') !== payload) {
    throw new ReplayPayloadSerializationError('压缩 replay payload base64 编码无效');
  }

  return buffer;
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
