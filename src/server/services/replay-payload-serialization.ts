import { createHash } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';
import { getLegacyPersistedBladeAudit } from '../../application/card-effects/legacy-persisted-blade-scopes.js';
import { getLegacyPersistedHeartAudit } from '../../application/card-effects/legacy-persisted-heart-scopes.js';
import type { GameState, LiveModifierState } from '../../domain/entities/game.js';
import { projectLiveModifierCompatibility } from '../../domain/rules/live-modifiers.js';
import { fromTransport, toTransport } from '../../online/serde.js';
import type {
  ReplayPayloadKind,
  ReplaySerializedPayloadEnvelope,
} from '../../online/replay-types.js';
import type { ManualOperationMode } from '../../shared/types/manual-operation-mode.js';
import { HeartColor } from '../../shared/types/enums.js';
import { GAME_STATE_SCHEMA_VERSION, LEGACY_GAME_STATE_SCHEMA_VERSION } from './replay-constants.js';

const SUPPORTED_PAYLOAD_SCHEMA_VERSION = 1;
const SUPPORTED_SERIALIZER = 'TRANSPORT_V1';
const SUPPORTED_COMPRESSION = 'GZIP';
const SUPPORTED_ENCODING = 'BASE64_JSON';
const LEGACY_COMPRESSION = 'NONE';
const LEGACY_ENCODING = 'JSON_VALUE';

export class ReplayPayloadSerializationError extends Error {
  readonly reason: 'UNSUPPORTED' | 'CORRUPTED';

  constructor(message: string, reason: 'UNSUPPORTED' | 'CORRUPTED' = 'UNSUPPORTED') {
    super(message);
    this.name = 'ReplayPayloadSerializationError';
    this.reason = reason;
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
  return serializeTransportPayload(
    transportPayload,
    envelope.payloadKind,
    envelope.sourceSchemaVersion
  );
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
  const state = rehydrateReplayPayload<LegacyAuthorityGameStatePayload>(
    envelope,
    'AUTHORITY_GAME_STATE'
  );
  return normalizePersistedAuthorityGameState(state, envelope.sourceSchemaVersion);
}

export function rehydrateLegacyAuthorityGameStateForMigration(
  envelope: ReplaySerializedPayloadEnvelope
): GameState {
  if (envelope.sourceSchemaVersion !== LEGACY_GAME_STATE_SCHEMA_VERSION) {
    throw new ReplayPayloadSerializationError(
      `旧 AUTHORITY_GAME_STATE 迁移只支持 ${LEGACY_GAME_STATE_SCHEMA_VERSION}`
    );
  }
  const state = rehydrateLegacyReplayPayloadForMigration<LegacyAuthorityGameStatePayload>(
    envelope,
    'AUTHORITY_GAME_STATE'
  );
  return normalizePersistedAuthorityGameState(state, envelope.sourceSchemaVersion);
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

/**
 * 仅用于历史 AUTHORITY_GAME_STATE 持久化 payload 的窄输入类型。
 * 当前业务运行时始终使用 manualOperationMode 必填的 GameState。
 */
type LegacyAuthorityGameStatePayload = Omit<GameState, 'manualOperationMode'> & {
  readonly manualOperationMode?: ManualOperationMode;
};

function normalizePersistedAuthorityGameState(
  state: LegacyAuthorityGameStatePayload,
  sourceSchemaVersion: string
): GameState {
  if (
    sourceSchemaVersion !== LEGACY_GAME_STATE_SCHEMA_VERSION &&
    sourceSchemaVersion !== GAME_STATE_SCHEMA_VERSION
  ) {
    throw new ReplayPayloadSerializationError(
      `不支持的 AUTHORITY_GAME_STATE source schema version: ${sourceSchemaVersion}`
    );
  }

  if (
    state.manualOperationMode === undefined &&
    sourceSchemaVersion !== LEGACY_GAME_STATE_SCHEMA_VERSION
  ) {
    throw new ReplayPayloadSerializationError(
      'AUTHORITY_GAME_STATE 缺少有效的 manualOperationMode',
      'CORRUPTED'
    );
  }
  const manualOperationMode = state.manualOperationMode ?? 'FREE';
  if (manualOperationMode !== 'RULES' && manualOperationMode !== 'FREE') {
    throw new ReplayPayloadSerializationError(
      'AUTHORITY_GAME_STATE 缺少有效的 manualOperationMode',
      'CORRUPTED'
    );
  }

  const liveResolution = state.liveResolution as unknown;
  if (!isRecord(liveResolution) || !Array.isArray(liveResolution.liveModifiers)) {
    throw new ReplayPayloadSerializationError(
      'AUTHORITY_GAME_STATE 缺少有效的 liveResolution.liveModifiers',
      'CORRUPTED'
    );
  }

  const liveModifiers = liveResolution.liveModifiers.map((modifier, index) =>
    normalizePersistedLiveModifier(modifier, sourceSchemaVersion, index)
  );
  const playerHeartBonuses = projectLiveModifierCompatibility(
    liveModifiers.filter((modifier) => modifier.kind === 'HEART')
  ).playerHeartBonuses;

  return {
    ...state,
    manualOperationMode,
    liveResolution: {
      ...state.liveResolution,
      playerHeartBonuses,
      liveModifiers,
    },
  };
}

function normalizePersistedLiveModifier(
  value: unknown,
  sourceSchemaVersion: string,
  index: number
): LiveModifierState {
  if (!isRecord(value)) {
    throw new ReplayPayloadSerializationError(
      `AUTHORITY_GAME_STATE liveModifiers[${index}] 形状无效`,
      'CORRUPTED'
    );
  }
  if (value.kind === 'HEART') {
    return normalizePersistedHeartModifier(value, sourceSchemaVersion, index);
  }
  if (value.kind !== 'BLADE') {
    return value as unknown as LiveModifierState;
  }

  validateBladeModifierCommonFields(value, index);
  if (value.target !== undefined) {
    return validateExplicitBladeModifier(value, index);
  }
  if (sourceSchemaVersion !== LEGACY_GAME_STATE_SCHEMA_VERSION) {
    throw createBladeModifierError(index, 'GAME_STATE_V2 BLADE 缺少显式 target', value);
  }

  const legacyTargetMemberCardId = readOptionalNonEmptyString(
    value.targetMemberCardId,
    index,
    'targetMemberCardId',
    value
  );
  if (legacyTargetMemberCardId !== undefined) {
    return {
      ...value,
      target: 'TARGET_MEMBER',
      targetMemberCardId: legacyTargetMemberCardId,
    } as unknown as LiveModifierState;
  }

  const abilityId = readOptionalNonEmptyString(value.abilityId, index, 'abilityId', value);
  if (abilityId === undefined) {
    throw createBladeModifierError(index, '旧 BLADE 缺少可审计的 abilityId', value, 'UNSUPPORTED');
  }
  const audit = getLegacyPersistedBladeAudit(abilityId);
  if (audit === undefined) {
    throw createBladeModifierError(
      index,
      '旧 BLADE abilityId 未经作用域审计',
      value,
      'UNSUPPORTED'
    );
  }
  if (audit.scope === 'AMBIGUOUS') {
    throw createBladeModifierError(
      index,
      '旧 BLADE abilityId 曾同时写入多种作用域，无法无损迁移',
      value,
      'UNSUPPORTED'
    );
  }

  if (audit.scope === 'PLAYER') {
    return { ...value, target: 'PLAYER' } as unknown as LiveModifierState;
  }

  if (audit.scope === 'TARGET_MEMBER' && audit.targetStorage === 'TARGET_MEMBER_CARD_ID') {
    throw createBladeModifierError(
      index,
      '旧 TARGET_MEMBER BLADE 缺少历史必填的 targetMemberCardId',
      value
    );
  }

  const legacySourceCardId = readOptionalNonEmptyString(
    value.sourceCardId,
    index,
    'sourceCardId',
    value
  );
  if (legacySourceCardId === undefined) {
    throw createBladeModifierError(index, `旧 ${audit.scope} BLADE 缺少成员实例 ID`, value);
  }
  if (audit.scope === 'SOURCE_MEMBER') {
    return {
      ...value,
      target: 'SOURCE_MEMBER',
      sourceCardId: legacySourceCardId,
    } as unknown as LiveModifierState;
  }

  const legacyWithoutFakeSource = { ...value };
  delete legacyWithoutFakeSource.sourceCardId;
  return {
    ...legacyWithoutFakeSource,
    target: 'TARGET_MEMBER',
    targetMemberCardId: legacySourceCardId,
  } as unknown as LiveModifierState;
}

function normalizePersistedHeartModifier(
  modifier: Record<string, unknown>,
  sourceSchemaVersion: string,
  index: number
): LiveModifierState {
  validateHeartModifierCommonFields(modifier, index);
  const abilityId = readOptionalNonEmptyHeartString(
    modifier.abilityId,
    index,
    'abilityId',
    modifier
  );
  const audit = abilityId ? getLegacyPersistedHeartAudit(abilityId) : undefined;

  if (modifier.target === undefined) {
    if (sourceSchemaVersion !== LEGACY_GAME_STATE_SCHEMA_VERSION) {
      throw createHeartModifierError(index, 'GAME_STATE_V2 HEART 缺少显式 target', modifier);
    }
    if (modifier.targetMemberCardId !== undefined) {
      throw createHeartModifierError(
        index,
        '旧 HEART 缺少 target 却携带 targetMemberCardId',
        modifier
      );
    }
    if (abilityId === undefined) {
      throw createHeartModifierError(
        index,
        '旧 HEART 缺少可审计的 abilityId',
        modifier,
        'UNSUPPORTED'
      );
    }
    if (audit === undefined) {
      throw createHeartModifierError(
        index,
        '旧 HEART abilityId 未经作用域审计',
        modifier,
        'UNSUPPORTED'
      );
    }
    if (
      audit.scope !== 'SOURCE_MEMBER' ||
      audit.historicalEncoding !== 'TARGETLESS_SOURCE_CARD_ID_IS_SOURCE'
    ) {
      throw createHeartModifierError(
        index,
        '旧 HEART 无 target 形状与已审计历史编码冲突',
        modifier
      );
    }
    const sourceCardId = readOptionalNonEmptyHeartString(
      modifier.sourceCardId,
      index,
      'sourceCardId',
      modifier
    );
    if (sourceCardId === undefined) {
      throw createHeartModifierError(index, '旧 SOURCE_MEMBER HEART 缺少 sourceCardId', modifier);
    }
    return {
      ...modifier,
      target: 'SOURCE_MEMBER',
      sourceCardId,
    } as unknown as LiveModifierState;
  }

  if (audit?.scope === 'SOURCE_MEMBER' && modifier.target !== 'SOURCE_MEMBER') {
    throw createHeartModifierError(index, '已审计 SOURCE_MEMBER HEART 的 target 冲突', modifier);
  }

  if (
    audit?.scope === 'TARGET_MEMBER' &&
    audit.historicalEncoding === 'EXPLICIT_SOURCE_MEMBER_IS_SELF_TARGET'
  ) {
    if (modifier.target === 'PLAYER') {
      throw createHeartModifierError(
        index,
        '已审计 TARGET_MEMBER HEART 不能作用于 PLAYER',
        modifier
      );
    }
    if (modifier.target === 'SOURCE_MEMBER') {
      const sourceCardId = readOptionalNonEmptyHeartString(
        modifier.sourceCardId,
        index,
        'sourceCardId',
        modifier
      );
      if (sourceCardId === undefined || modifier.targetMemberCardId !== undefined) {
        throw createHeartModifierError(
          index,
          '历史 self-target HEART 的 SOURCE_MEMBER 绑定字段无效',
          modifier
        );
      }
      return {
        ...modifier,
        target: 'TARGET_MEMBER',
        sourceCardId,
        targetMemberCardId: sourceCardId,
      } as unknown as LiveModifierState;
    }
  }

  return validateExplicitHeartModifier(modifier, index);
}

function validateHeartModifierCommonFields(modifier: Record<string, unknown>, index: number): void {
  if (typeof modifier.playerId !== 'string' || modifier.playerId.length === 0) {
    throw createHeartModifierError(index, 'playerId 无效', modifier);
  }
  if (!Array.isArray(modifier.hearts) || modifier.hearts.length === 0) {
    throw createHeartModifierError(index, 'hearts 必须是非空数组', modifier);
  }
  const validColors = new Set<string>(Object.values(HeartColor));
  for (const heart of modifier.hearts) {
    if (
      !isRecord(heart) ||
      typeof heart.color !== 'string' ||
      !validColors.has(heart.color) ||
      typeof heart.count !== 'number' ||
      !Number.isSafeInteger(heart.count) ||
      heart.count <= 0
    ) {
      throw createHeartModifierError(index, 'hearts 内容无效', modifier);
    }
  }
  readOptionalNonEmptyHeartString(modifier.sourceCardId, index, 'sourceCardId', modifier);
  readOptionalNonEmptyHeartString(
    modifier.targetMemberCardId,
    index,
    'targetMemberCardId',
    modifier
  );
  readOptionalNonEmptyHeartString(modifier.abilityId, index, 'abilityId', modifier);
}

function validateExplicitHeartModifier(
  modifier: Record<string, unknown>,
  index: number
): LiveModifierState {
  if (modifier.target === 'SOURCE_MEMBER') {
    const sourceCardId = readOptionalNonEmptyHeartString(
      modifier.sourceCardId,
      index,
      'sourceCardId',
      modifier
    );
    if (sourceCardId === undefined || modifier.targetMemberCardId !== undefined) {
      throw createHeartModifierError(index, 'SOURCE_MEMBER HEART 绑定字段无效', modifier);
    }
    return modifier as unknown as LiveModifierState;
  }

  if (modifier.target === 'TARGET_MEMBER') {
    const sourceCardId = readOptionalNonEmptyHeartString(
      modifier.sourceCardId,
      index,
      'sourceCardId',
      modifier
    );
    const targetMemberCardId = readOptionalNonEmptyHeartString(
      modifier.targetMemberCardId,
      index,
      'targetMemberCardId',
      modifier
    );
    if (sourceCardId === undefined || targetMemberCardId === undefined) {
      throw createHeartModifierError(
        index,
        'TARGET_MEMBER HEART 必须同时记录 sourceCardId 与 targetMemberCardId',
        modifier
      );
    }
    return modifier as unknown as LiveModifierState;
  }

  if (modifier.target === 'PLAYER') {
    if (modifier.targetMemberCardId !== undefined) {
      throw createHeartModifierError(index, 'PLAYER HEART 不应绑定 targetMemberCardId', modifier);
    }
    return modifier as unknown as LiveModifierState;
  }

  throw createHeartModifierError(index, 'HEART target 无效', modifier);
}

function readOptionalNonEmptyHeartString(
  value: unknown,
  index: number,
  field: string,
  modifier: Record<string, unknown>
): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string' || value.length === 0) {
    throw createHeartModifierError(index, `${field} 无效`, modifier);
  }
  return value;
}

function createHeartModifierError(
  index: number,
  reason: string,
  modifier: Record<string, unknown>,
  serializationReason: 'UNSUPPORTED' | 'CORRUPTED' = 'CORRUPTED'
): ReplayPayloadSerializationError {
  const abilityId =
    typeof modifier.abilityId === 'string' ? ` (abilityId: ${modifier.abilityId})` : '';
  return new ReplayPayloadSerializationError(
    `AUTHORITY_GAME_STATE liveModifiers[${index}] ${reason}${abilityId}`,
    serializationReason
  );
}

function validateBladeModifierCommonFields(modifier: Record<string, unknown>, index: number): void {
  if (typeof modifier.playerId !== 'string' || modifier.playerId.length === 0) {
    throw createBladeModifierError(index, 'playerId 无效', modifier);
  }
  if (typeof modifier.countDelta !== 'number' || !Number.isFinite(modifier.countDelta)) {
    throw createBladeModifierError(index, 'countDelta 无效', modifier);
  }
  readOptionalNonEmptyString(modifier.sourceCardId, index, 'sourceCardId', modifier);
  readOptionalNonEmptyString(modifier.targetMemberCardId, index, 'targetMemberCardId', modifier);
  readOptionalNonEmptyString(modifier.abilityId, index, 'abilityId', modifier);
}

function validateExplicitBladeModifier(
  modifier: Record<string, unknown>,
  index: number
): LiveModifierState {
  if (modifier.target === 'SOURCE_MEMBER') {
    const sourceCardId = readOptionalNonEmptyString(
      modifier.sourceCardId,
      index,
      'sourceCardId',
      modifier
    );
    if (sourceCardId === undefined || modifier.targetMemberCardId !== undefined) {
      throw createBladeModifierError(index, 'SOURCE_MEMBER BLADE 绑定字段无效', modifier);
    }
    return modifier as unknown as LiveModifierState;
  }

  if (modifier.target === 'TARGET_MEMBER') {
    const targetMemberCardId = readOptionalNonEmptyString(
      modifier.targetMemberCardId,
      index,
      'targetMemberCardId',
      modifier
    );
    if (targetMemberCardId === undefined) {
      throw createBladeModifierError(
        index,
        'TARGET_MEMBER BLADE 缺少 targetMemberCardId',
        modifier
      );
    }
    return modifier as unknown as LiveModifierState;
  }

  if (modifier.target === 'PLAYER') {
    if (modifier.targetMemberCardId !== undefined) {
      throw createBladeModifierError(index, 'PLAYER BLADE 不应绑定 targetMemberCardId', modifier);
    }
    return modifier as unknown as LiveModifierState;
  }

  throw createBladeModifierError(index, 'BLADE target 无效', modifier);
}

function readOptionalNonEmptyString(
  value: unknown,
  index: number,
  field: string,
  modifier: Record<string, unknown>
): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string' || value.length === 0) {
    throw createBladeModifierError(index, `${field} 无效`, modifier);
  }
  return value;
}

function createBladeModifierError(
  index: number,
  reason: string,
  modifier: Record<string, unknown>,
  serializationReason: 'UNSUPPORTED' | 'CORRUPTED' = 'CORRUPTED'
): ReplayPayloadSerializationError {
  const abilityId =
    typeof modifier.abilityId === 'string' ? ` (abilityId: ${modifier.abilityId})` : '';
  return new ReplayPayloadSerializationError(
    `AUTHORITY_GAME_STATE liveModifiers[${index}] ${reason}${abilityId}`,
    serializationReason
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

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
    throw new ReplayPayloadSerializationError(
      '压缩 replay payload 必须是 base64 字符串',
      'CORRUPTED'
    );
  }

  const compressedPayload = decodeBase64Payload(envelope.payload);
  if (envelope.compressedByteLength !== compressedPayload.byteLength) {
    throw new ReplayPayloadSerializationError(
      'replay payload compressed byte length 校验失败',
      'CORRUPTED'
    );
  }

  let stablePayloadJson: string;
  try {
    stablePayloadJson = gunzipSync(compressedPayload).toString('utf8');
  } catch {
    throw new ReplayPayloadSerializationError('压缩 replay payload 解压失败', 'CORRUPTED');
  }

  return validateStablePayloadJson(stablePayloadJson, envelope);
}

function readLegacyTransportPayload(envelope: ReplaySerializedPayloadEnvelope): unknown {
  if (
    envelope.compressed ||
    envelope.compression !== LEGACY_COMPRESSION ||
    envelope.encoding !== LEGACY_ENCODING
  ) {
    throw new ReplayPayloadSerializationError('迁移读取只支持旧 NONE/JSON_VALUE replay payload');
  }

  const stablePayloadJson = stableJsonStringify(envelope.payload);
  if (envelope.compressedByteLength !== envelope.uncompressedByteLength) {
    throw new ReplayPayloadSerializationError(
      '旧 replay payload compressed byte length 校验失败',
      'CORRUPTED'
    );
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
  } catch {
    throw new ReplayPayloadSerializationError('replay payload JSON parse 失败', 'CORRUPTED');
  }

  if (stableJsonStringify(transportPayload) !== stablePayloadJson) {
    throw new ReplayPayloadSerializationError('replay payload stable JSON 校验失败', 'CORRUPTED');
  }

  return transportPayload;
}

function validatePayloadIntegrity(
  stablePayloadJson: string,
  envelope: ReplaySerializedPayloadEnvelope
): void {
  const expectedHash = hashStablePayloadJson(stablePayloadJson);
  if (envelope.payloadHash !== expectedHash) {
    throw new ReplayPayloadSerializationError('replay payload hash 校验失败', 'CORRUPTED');
  }

  const uncompressedByteLength = Buffer.byteLength(stablePayloadJson, 'utf8');
  if (envelope.uncompressedByteLength !== uncompressedByteLength) {
    throw new ReplayPayloadSerializationError('replay payload byte length 校验失败', 'CORRUPTED');
  }
}

function hashStablePayloadJson(stablePayloadJson: string): string {
  return `sha256:${createHash('sha256').update(stablePayloadJson).digest('hex')}`;
}

function decodeBase64Payload(payload: string): Buffer {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(payload) || payload.length % 4 === 1) {
    throw new ReplayPayloadSerializationError('压缩 replay payload base64 编码无效', 'CORRUPTED');
  }

  const buffer = Buffer.from(payload, 'base64');
  if (buffer.toString('base64') !== payload) {
    throw new ReplayPayloadSerializationError('压缩 replay payload base64 编码无效', 'CORRUPTED');
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
