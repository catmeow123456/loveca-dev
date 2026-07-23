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
import {
  addMemberWaitProtectionUntilLiveEnd,
  clearMemberWaitProtectionsUntilLiveEnd,
  isMemberWaitProtectedFromChange,
} from '../../src/domain/rules/member-wait-protections';
import type {
  ReplayPayloadKind,
  ReplaySerializedPayloadEnvelope,
} from '../../src/online/replay-types';
import {
  compressLegacyReplayPayloadEnvelopeForMigration,
  rehydrateAuthorityGameState,
  rehydrateLegacyAuthorityGameStateForMigration,
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
  it('仅在 AUTHORITY_GAME_STATE 复水边界将旧缺失模式字段规范化为自由模式', () => {
    const session = createGameSession();
    session.createGame('legacy-manual-operation-mode', PLAYER1, '玩家1', PLAYER2, '玩家2');
    session.initializeGame(createTestDeck('A'), createTestDeck('B'));
    const snapshot = session.getAuthoritySnapshotForRecord()!;
    const legacySnapshot = { ...snapshot } as Partial<typeof snapshot>;
    delete legacySnapshot.manualOperationMode;

    const rehydrated = rehydrateAuthorityGameState(
      serializeReplayPayload(legacySnapshot, 'AUTHORITY_GAME_STATE', 'GAME_STATE_V1')
    );

    expect(rehydrated.manualOperationMode).toBe('FREE');
    const restoredSession = createGameSession();
    restoredSession.restoreRuntimeState({
      authorityState: rehydrated,
      currentPublicSeq: 0,
    });
    expect(restoredSession.manualOperationMode).toBe('FREE');
  });

  it('拒绝持久化 AUTHORITY_GAME_STATE 中的非法操作模式', () => {
    const session = createGameSession();
    session.createGame('invalid-manual-operation-mode', PLAYER1, '玩家1', PLAYER2, '玩家2');
    session.initializeGame(createTestDeck('A'), createTestDeck('B'));
    const snapshot = session.getAuthoritySnapshotForRecord()!;

    expect(() =>
      rehydrateAuthorityGameState(
        serializeReplayPayload(
          { ...snapshot, manualOperationMode: 'INVALID' },
          'AUTHORITY_GAME_STATE',
          'GAME_STATE_V1'
        )
      )
    ).toThrow('AUTHORITY_GAME_STATE 缺少有效的 manualOperationMode');
  });

  it('旧 authority payload 缺少 pendingSpecialMemberPlay 时按无窗口安全复水与投影', () => {
    const session = createGameSession();
    session.createGame('legacy-special-member-play', PLAYER1, '玩家1', PLAYER2, '玩家2');
    session.initializeGame(createTestDeck('A'), createTestDeck('B'));
    const snapshot = session.getAuthoritySnapshotForRecord()!;
    const legacySnapshot = { ...snapshot } as typeof snapshot & {
      pendingSpecialMemberPlay?: typeof snapshot.pendingSpecialMemberPlay;
    };
    delete legacySnapshot.pendingSpecialMemberPlay;

    const rehydrated = rehydrateAuthorityGameState(
      serializeReplayPayload(legacySnapshot, 'AUTHORITY_GAME_STATE', 'GAME_STATE_V1')
    );
    expect(rehydrated.pendingSpecialMemberPlay).toBeUndefined();
    expect(projectPlayerViewState(rehydrated, PLAYER1).pendingSpecialMemberPlay).toBeNull();
  });

  it('旧 authority payload 缺少 energyActivePhaseSkips 时仍可复水和投影', () => {
    const session = createGameSession();
    session.createGame('legacy-energy-marker', PLAYER1, '玩家1', PLAYER2, '玩家2');
    session.initializeGame(createTestDeck('A'), createTestDeck('B'));
    const snapshot = session.getAuthoritySnapshotForRecord()!;
    const legacySnapshot = { ...snapshot } as typeof snapshot & {
      energyActivePhaseSkips?: typeof snapshot.energyActivePhaseSkips;
    };
    delete legacySnapshot.energyActivePhaseSkips;
    const rehydrated = rehydrateAuthorityGameState(
      serializeReplayPayload(legacySnapshot, 'AUTHORITY_GAME_STATE', 'GAME_STATE_V1')
    );
    expect(rehydrated.energyActivePhaseSkips).toBeUndefined();
    expect(() => projectPlayerViewState(rehydrated, PLAYER1)).not.toThrow();
  });

  it('旧 authority payload 缺少 memberWaitProtections 时按空数组兼容查询、写入、投影与 LIVE_END 清理', () => {
    const session = createGameSession();
    session.createGame('legacy-member-wait-protection', PLAYER1, '玩家1', PLAYER2, '玩家2');
    session.initializeGame(createTestDeck('A'), createTestDeck('B'));
    const snapshot = session.getAuthoritySnapshotForRecord()!;
    const legacySnapshot = { ...snapshot } as typeof snapshot & {
      memberWaitProtections?: typeof snapshot.memberWaitProtections;
    };
    delete legacySnapshot.memberWaitProtections;

    const rehydrated = rehydrateAuthorityGameState(
      serializeReplayPayload(legacySnapshot, 'AUTHORITY_GAME_STATE', 'GAME_STATE_V1')
    );
    expect(rehydrated.memberWaitProtections).toBeUndefined();
    expect(() => projectPlayerViewState(rehydrated, PLAYER1)).not.toThrow();
    expect(
      isMemberWaitProtectedFromChange(rehydrated, PLAYER1, 'missing-member', {
        kind: 'CARD_EFFECT',
        playerId: PLAYER2,
        sourceCardId: 'opponent-effect',
      })
    ).toBe(false);
    expect(clearMemberWaitProtectionsUntilLiveEnd(rehydrated)).toBe(rehydrated);

    const protectedState = addMemberWaitProtectionUntilLiveEnd(rehydrated, {
      affectedPlayerId: PLAYER1,
      sourceCardId: 'legacy-source',
      abilityId: 'legacy-protection',
    });
    expect(protectedState.memberWaitProtections).toHaveLength(1);
    expect(clearMemberWaitProtectionsUntilLiveEnd(protectedState).memberWaitProtections).toEqual(
      []
    );
  });

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

  it('旧 NONE authority payload 只在专用迁移边界补齐自由模式', () => {
    const session = createGameSession();
    session.createGame('replay-legacy-mode', PLAYER1, '玩家1', PLAYER2, '玩家2');
    session.initializeGame(createTestDeck('A'), createTestDeck('B'));
    const snapshot = session.getAuthoritySnapshotForRecord()!;
    const legacySnapshot = { ...snapshot } as Partial<typeof snapshot>;
    delete legacySnapshot.manualOperationMode;
    const legacyEnvelope = createLegacyReplayPayloadEnvelope(
      legacySnapshot,
      'AUTHORITY_GAME_STATE',
      'GAME_STATE_V1'
    );

    expect(rehydrateLegacyAuthorityGameStateForMigration(legacyEnvelope)).toMatchObject({
      gameId: 'replay-legacy-mode',
      manualOperationMode: 'FREE',
    });
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
