import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createGameSession } from '../../src/application/game-session';
import type { DeckConfig } from '../../src/application/game-service';
import type {
  AnyCardData,
  EnergyCardData,
  LiveCardData,
  MemberCardData,
} from '../../src/domain/entities/card';
import { createHeartIcon, createHeartRequirement } from '../../src/domain/entities/card';
import { CardType, GameMode, HeartColor } from '../../src/shared/types/enums';
import { createPublicObjectId, projectPlayerViewState } from '../../src/online/projector';
import type {
  ReplayPayloadKind,
  ReplaySerializedPayloadEnvelope,
} from '../../src/online/replay-types';
import {
  compressLegacyReplayPayloadEnvelopeForMigration,
  rehydrateAuthorityGameState,
  rehydrateLegacyReplayPayloadForMigration,
  serializeReplayPayload,
  stableJsonStringify,
  toReplayJsonValue,
} from '../../src/server/services/replay-payload-serialization';

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';

function createTestMemberCard(cardCode: string, name: string): MemberCardData {
  return {
    cardCode,
    name,
    cardType: CardType.MEMBER,
    cost: 1,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
  };
}

function createTestLiveCard(cardCode: string, name: string): LiveCardData {
  return {
    cardCode,
    name,
    cardType: CardType.LIVE,
    score: 3,
    requirements: createHeartRequirement({ [HeartColor.PINK]: 2 }),
  };
}

function createTestEnergyCard(cardCode: string): EnergyCardData {
  return {
    cardCode,
    name: `能量 ${cardCode}`,
    cardType: CardType.ENERGY,
  };
}

function createTestDeck(prefix: string): DeckConfig {
  const mainDeck: AnyCardData[] = [];
  const energyDeck: AnyCardData[] = [];

  for (let index = 0; index < 48; index += 1) {
    mainDeck.push(createTestMemberCard(`${prefix}-MEM-${index}`, `${prefix} 成员 ${index}`));
  }

  for (let index = 0; index < 12; index += 1) {
    mainDeck.push(createTestLiveCard(`${prefix}-LIVE-${index}`, `${prefix} Live ${index}`));
    energyDeck.push(createTestEnergyCard(`${prefix}-ENE-${index}`));
  }

  return { mainDeck, energyDeck };
}

describe('replay payload serialization', () => {
  it('authority checkpoint 经 TRANSPORT_V1 GZIP envelope 往返后仍可复水并投影玩家视角', () => {
    const session = createGameSession();
    session.createGame('replay-serialize', PLAYER1, '玩家1', PLAYER2, '玩家2');
    session.initializeGame(createTestDeck('A'), createTestDeck('B'));

    const authoritySnapshot = session.getAuthoritySnapshotForRecord();
    expect(authoritySnapshot).not.toBeNull();
    const authoritySnapshotWithRemainingHearts = {
      ...authoritySnapshot!,
      liveResolution: {
        ...authoritySnapshot!.liveResolution,
        playerRemainingHearts: new Map([[PLAYER1, [{ color: HeartColor.GREEN, count: 1 }]]]),
        playerLiveJudgmentHearts: new Map([
          [
            PLAYER1,
            [
              { color: HeartColor.GREEN, count: 2 },
              { color: HeartColor.RAINBOW, count: 1 },
            ],
          ],
        ]),
      },
    };

    const envelope = serializeReplayPayload(
      authoritySnapshotWithRemainingHearts,
      'AUTHORITY_GAME_STATE',
      'GAME_STATE_V1'
    );

    expect(envelope.serializer).toBe('TRANSPORT_V1');
    expect(envelope.payloadKind).toBe('AUTHORITY_GAME_STATE');
    expect(envelope.compressed).toBe(true);
    expect(envelope.compression).toBe('GZIP');
    expect(envelope.encoding).toBe('BASE64_JSON');
    expect(typeof envelope.payload).toBe('string');
    expect(envelope.compressedByteLength).toBeGreaterThan(0);
    expect(envelope.compressedByteLength).toBeLessThan(envelope.uncompressedByteLength);
    expect(JSON.stringify(envelope.payload)).not.toContain('__transportType');
    expectContainsNoNativeMap(envelope.payload);

    const parsedEnvelope = JSON.parse(JSON.stringify(envelope)) as typeof envelope;
    const rehydrated = rehydrateAuthorityGameState(parsedEnvelope);

    expect(rehydrated.cardRegistry).toBeInstanceOf(Map);
    expect(rehydrated.liveResolution.liveResults).toBeInstanceOf(Map);
    expect(rehydrated.liveResolution.playerScores).toBeInstanceOf(Map);
    expect(rehydrated.liveResolution.playerRemainingHearts).toBeInstanceOf(Map);
    expect(rehydrated.liveResolution.playerRemainingHearts.get(PLAYER1)).toEqual([
      { color: HeartColor.GREEN, count: 1 },
    ]);
    expect(rehydrated.liveResolution.playerLiveJudgmentHearts).toBeInstanceOf(Map);
    expect(rehydrated.liveResolution.playerLiveJudgmentHearts.get(PLAYER1)).toEqual([
      { color: HeartColor.GREEN, count: 2 },
      { color: HeartColor.RAINBOW, count: 1 },
    ]);

    const playerView = projectPlayerViewState(rehydrated, PLAYER1, {
      seq: session.getCurrentPublicEventSeq(),
      gameMode: GameMode.DEBUG,
    });
    const opponentHiddenCardId = rehydrated.players[1].hand.cardIds[0];

    expect(playerView.match.viewerSeat).toBe('FIRST');
    expect(playerView.objects[createPublicObjectId(opponentHiddenCardId)]).toBeUndefined();
  });

  it('payload hash 被篡改时拒绝复水', () => {
    const session = createGameSession();
    session.createGame('replay-hash', PLAYER1, '玩家1', PLAYER2, '玩家2');
    session.initializeGame(createTestDeck('A'), createTestDeck('B'));

    const envelope = serializeReplayPayload(
      session.getAuthoritySnapshotForRecord(),
      'AUTHORITY_GAME_STATE',
      'GAME_STATE_V1'
    );

    expect(() =>
      rehydrateAuthorityGameState({
        ...envelope,
        payloadHash: 'sha256:bad',
      })
    ).toThrow('replay payload hash 校验失败');
  });

  it('压缩 payload 类型或内容被篡改时拒绝复水', () => {
    const session = createGameSession();
    session.createGame('replay-tamper', PLAYER1, '玩家1', PLAYER2, '玩家2');
    session.initializeGame(createTestDeck('A'), createTestDeck('B'));

    const envelope = serializeReplayPayload(
      session.getAuthoritySnapshotForRecord(),
      'AUTHORITY_GAME_STATE',
      'GAME_STATE_V1'
    );

    expect(() =>
      rehydrateAuthorityGameState({
        ...envelope,
        payload: { not: 'base64' },
      })
    ).toThrow('压缩 replay payload 必须是 base64 字符串');

    expect(() =>
      rehydrateAuthorityGameState({
        ...envelope,
        compressedByteLength: 3,
        payload: Buffer.from('bad').toString('base64'),
      })
    ).toThrow('压缩 replay payload 解压失败');
  });

  it('正式复水拒绝旧 NONE payload，迁移 helper 可转换为 GZIP payload', () => {
    const session = createGameSession();
    session.createGame('replay-legacy', PLAYER1, '玩家1', PLAYER2, '玩家2');
    session.initializeGame(createTestDeck('A'), createTestDeck('B'));
    const authorityState = session.getAuthoritySnapshotForRecord();
    expect(authorityState).not.toBeNull();

    const legacyEnvelope = createLegacyReplayPayloadEnvelope(
      authorityState!,
      'AUTHORITY_GAME_STATE',
      'GAME_STATE_V1'
    );

    expect(() => rehydrateAuthorityGameState(legacyEnvelope)).toThrow(
      '当前版本只支持 GZIP/BASE64_JSON replay payload'
    );
    expect(
      rehydrateLegacyReplayPayloadForMigration<typeof authorityState>(
        legacyEnvelope,
        'AUTHORITY_GAME_STATE'
      )?.gameId
    ).toBe('replay-legacy');

    const migratedEnvelope = compressLegacyReplayPayloadEnvelopeForMigration(
      legacyEnvelope,
      'AUTHORITY_GAME_STATE'
    );

    expect(migratedEnvelope).toMatchObject({
      compressed: true,
      compression: 'GZIP',
      encoding: 'BASE64_JSON',
      payloadHash: legacyEnvelope.payloadHash,
      uncompressedByteLength: legacyEnvelope.uncompressedByteLength,
    });
    expect(typeof migratedEnvelope.payload).toBe('string');
    expect(rehydrateAuthorityGameState(migratedEnvelope).gameId).toBe('replay-legacy');
  });
});

function createLegacyReplayPayloadEnvelope(
  payload: unknown,
  payloadKind: ReplayPayloadKind,
  sourceSchemaVersion: string
): ReplaySerializedPayloadEnvelope {
  const transportPayload = toReplayJsonValue(payload);
  const stablePayloadJson = stableJsonStringify(transportPayload);
  const byteLength = Buffer.byteLength(stablePayloadJson, 'utf8');

  return {
    payloadSchemaVersion: 1,
    serializer: 'TRANSPORT_V1',
    payloadKind,
    sourceSchemaVersion,
    compressed: false,
    compression: 'NONE',
    encoding: 'JSON_VALUE',
    payloadHash: `sha256:${createHash('sha256').update(stablePayloadJson).digest('hex')}`,
    uncompressedByteLength: byteLength,
    compressedByteLength: byteLength,
    payload: transportPayload,
  };
}

function expectContainsNoNativeMap(value: unknown, path = 'value'): void {
  if (value instanceof Map) {
    throw new Error(`payload contains native Map at ${path}`);
  }

  if (!value || typeof value !== 'object') {
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((entry, index) => expectContainsNoNativeMap(entry, `${path}[${index}]`));
    return;
  }

  for (const [key, entry] of Object.entries(value)) {
    expectContainsNoNativeMap(entry, `${path}.${key}`);
  }
}
