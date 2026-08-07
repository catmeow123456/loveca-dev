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
import {
  GAME_STATE_SCHEMA_VERSION,
  LEGACY_GAME_STATE_SCHEMA_VERSION,
} from '../../src/server/services/replay-constants';
import {
  HS_BP5_001_ON_ENTER_MILL_GAIN_BLADE_ABILITY_ID,
  N_BP7_025_LIVE_START_TARGET_NIJIGASAKI_MEMBER_GAIN_ONE_BLADE_ABILITY_ID,
  N_BP7_026_LIVE_START_DISCARD_UP_TO_TWO_TARGET_NIJIGASAKI_GAIN_BLADE_ABILITY_ID,
  PL_BP4_014_LIVE_START_LIVE_WITHOUT_TIMING_TARGET_OTHER_MEMBER_GAIN_TWO_BLADE_ABILITY_ID,
  PL_BP4_024_LIVE_START_TARGET_MUSE_MEMBER_GAIN_ONE_BLADE_ABILITY_ID,
  PR_AUTO_RELAY_REPLACEMENT_COST_NINE_GAIN_TWO_BLADE_ABILITY_ID,
  S_BP2_023_LIVE_START_OTHER_AQOURS_LIVE_STAGE_MEMBERS_GAIN_BLADE_ABILITY_ID,
  S_BP2_025_LIVE_START_SUCCESS_TWO_TARGET_MEMBER_GAIN_TWO_BLADE_ABILITY_ID,
  SP_BP7_025_LIVE_START_TARGET_CHISATO_GAIN_ONE_BLADE_ABILITY_ID,
  SP_BP7_028_LIVE_START_BOTTOM_NINE_LIELLA_MEMBERS_ALL_STAGE_GAIN_BLADE_ABILITY_ID,
  SP_SD2_020_LIVE_START_ENERGY_SEVEN_SOURCE_AND_OTHER_LIELLA_GAIN_BLADE_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
import { getLegacyPersistedBladeScopeEntries } from '../../src/application/card-effects/legacy-persisted-blade-scopes';

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
  it('冻结全量已审计持久化 BLADE abilityId 作用域清单', () => {
    const entries = getLegacyPersistedBladeScopeEntries();
    const scopes = entries.map(([, scope]) => scope);
    expect(scopes).toHaveLength(106);
    expect(scopes.filter((scope) => scope === 'SOURCE_MEMBER')).toHaveLength(67);
    expect(scopes.filter((scope) => scope === 'TARGET_MEMBER')).toHaveLength(38);
    expect(scopes.filter((scope) => scope === 'PLAYER')).toHaveLength(0);
    expect(scopes.filter((scope) => scope === 'AMBIGUOUS')).toHaveLength(1);
    expect(
      entries.filter(([, , targetStorage]) => targetStorage === 'SOURCE_CARD_ID')
    ).toHaveLength(30);
    expect(
      entries.filter(([, , targetStorage]) => targetStorage === 'TARGET_MEMBER_CARD_ID')
    ).toHaveLength(8);
    expect(
      new Set(
        entries
          .filter(([, , targetStorage]) => targetStorage === 'TARGET_MEMBER_CARD_ID')
          .map(([abilityId]) => abilityId)
      )
    ).toEqual(
      new Set([
        N_BP7_025_LIVE_START_TARGET_NIJIGASAKI_MEMBER_GAIN_ONE_BLADE_ABILITY_ID,
        N_BP7_026_LIVE_START_DISCARD_UP_TO_TWO_TARGET_NIJIGASAKI_GAIN_BLADE_ABILITY_ID,
        PL_BP4_014_LIVE_START_LIVE_WITHOUT_TIMING_TARGET_OTHER_MEMBER_GAIN_TWO_BLADE_ABILITY_ID,
        PL_BP4_024_LIVE_START_TARGET_MUSE_MEMBER_GAIN_ONE_BLADE_ABILITY_ID,
        PR_AUTO_RELAY_REPLACEMENT_COST_NINE_GAIN_TWO_BLADE_ABILITY_ID,
        S_BP2_025_LIVE_START_SUCCESS_TWO_TARGET_MEMBER_GAIN_TWO_BLADE_ABILITY_ID,
        SP_BP7_025_LIVE_START_TARGET_CHISATO_GAIN_ONE_BLADE_ABILITY_ID,
        SP_BP7_028_LIVE_START_BOTTOM_NINE_LIELLA_MEMBERS_ALL_STAGE_GAIN_BLADE_ABILITY_ID,
      ])
    );
  });

  it('GAME_STATE_V1 只按已审计 abilityId 迁移无 target BLADE', () => {
    const session = createGameSession();
    session.createGame('legacy-blade-targets', PLAYER1, '玩家1', PLAYER2, '玩家2');
    session.initializeGame(createTestDeck('A'), createTestDeck('B'));
    const snapshot = session.getAuthoritySnapshotForRecord()!;
    const legacySnapshot = {
      ...snapshot,
      liveResolution: {
        ...snapshot.liveResolution,
        liveModifiers: [
          {
            kind: 'BLADE',
            playerId: PLAYER1,
            countDelta: 2,
            sourceCardId: 'source-member',
            abilityId: HS_BP5_001_ON_ENTER_MILL_GAIN_BLADE_ABILITY_ID,
          },
          {
            kind: 'BLADE',
            playerId: PLAYER1,
            countDelta: 1,
            sourceCardId: 'legacy-beneficiary',
            abilityId: S_BP2_023_LIVE_START_OTHER_AQOURS_LIVE_STAGE_MEMBERS_GAIN_BLADE_ABILITY_ID,
          },
          {
            kind: 'BLADE',
            playerId: PLAYER1,
            countDelta: 1,
            sourceCardId: 'live-source',
            targetMemberCardId: 'structural-target',
            abilityId: 'legacy-explicit-recipient',
          },
        ],
      },
    };

    const rehydrated = rehydrateAuthorityGameState(
      serializeReplayPayload(
        legacySnapshot,
        'AUTHORITY_GAME_STATE',
        LEGACY_GAME_STATE_SCHEMA_VERSION
      )
    );

    expect(rehydrated.liveResolution.liveModifiers).toEqual([
      {
        kind: 'BLADE',
        target: 'SOURCE_MEMBER',
        playerId: PLAYER1,
        countDelta: 2,
        sourceCardId: 'source-member',
        abilityId: HS_BP5_001_ON_ENTER_MILL_GAIN_BLADE_ABILITY_ID,
      },
      {
        kind: 'BLADE',
        target: 'TARGET_MEMBER',
        playerId: PLAYER1,
        countDelta: 1,
        targetMemberCardId: 'legacy-beneficiary',
        abilityId: S_BP2_023_LIVE_START_OTHER_AQOURS_LIVE_STAGE_MEMBERS_GAIN_BLADE_ABILITY_ID,
      },
      {
        kind: 'BLADE',
        target: 'TARGET_MEMBER',
        playerId: PLAYER1,
        countDelta: 1,
        sourceCardId: 'live-source',
        targetMemberCardId: 'structural-target',
        abilityId: 'legacy-explicit-recipient',
      },
    ]);
  });

  it('GAME_STATE_V1 拒绝未审计、历史结构字段缺失或混合作用域的无 target BLADE', () => {
    const session = createGameSession();
    session.createGame('unsafe-legacy-blade', PLAYER1, '玩家1', PLAYER2, '玩家2');
    session.initializeGame(createTestDeck('A'), createTestDeck('B'));
    const snapshot = session.getAuthoritySnapshotForRecord()!;
    const withLegacyBlade = (abilityId: string) => ({
      ...snapshot,
      liveResolution: {
        ...snapshot.liveResolution,
        liveModifiers: [
          {
            kind: 'BLADE',
            playerId: PLAYER1,
            countDelta: 1,
            sourceCardId: 'ambiguous-member',
            abilityId,
          },
        ],
      },
    });

    expect(() =>
      rehydrateAuthorityGameState(
        serializeReplayPayload(
          withLegacyBlade('unknown:legacy-blade'),
          'AUTHORITY_GAME_STATE',
          LEGACY_GAME_STATE_SCHEMA_VERSION
        )
      )
    ).toThrow('旧 BLADE abilityId 未经作用域审计');
    expect(() =>
      rehydrateAuthorityGameState(
        serializeReplayPayload(
          withLegacyBlade(N_BP7_025_LIVE_START_TARGET_NIJIGASAKI_MEMBER_GAIN_ONE_BLADE_ABILITY_ID),
          'AUTHORITY_GAME_STATE',
          LEGACY_GAME_STATE_SCHEMA_VERSION
        )
      )
    ).toThrow('缺少历史必填的 targetMemberCardId');
    expect(() =>
      rehydrateAuthorityGameState(
        serializeReplayPayload(
          withLegacyBlade(
            SP_SD2_020_LIVE_START_ENERGY_SEVEN_SOURCE_AND_OTHER_LIELLA_GAIN_BLADE_ABILITY_ID
          ),
          'AUTHORITY_GAME_STATE',
          LEGACY_GAME_STATE_SCHEMA_VERSION
        )
      )
    ).toThrow('曾同时写入多种作用域');
  });

  it('GAME_STATE_V2 只接受完整且互斥的 BLADE 作用域', () => {
    const session = createGameSession();
    session.createGame('strict-v2-blade', PLAYER1, '玩家1', PLAYER2, '玩家2');
    session.initializeGame(createTestDeck('A'), createTestDeck('B'));
    const snapshot = session.getAuthoritySnapshotForRecord()!;
    const withModifiers = (liveModifiers: readonly unknown[]) => ({
      ...snapshot,
      liveResolution: { ...snapshot.liveResolution, liveModifiers },
    });
    const explicitModifiers = [
      {
        kind: 'BLADE',
        target: 'SOURCE_MEMBER',
        playerId: PLAYER1,
        countDelta: 1,
        sourceCardId: 'source-member',
      },
      {
        kind: 'BLADE',
        target: 'TARGET_MEMBER',
        playerId: PLAYER1,
        countDelta: 2,
        sourceCardId: 'live-source',
        targetMemberCardId: 'target-member',
      },
      { kind: 'BLADE', target: 'PLAYER', playerId: PLAYER1, countDelta: 3 },
    ];

    expect(
      rehydrateAuthorityGameState(
        serializeReplayPayload(
          withModifiers(explicitModifiers),
          'AUTHORITY_GAME_STATE',
          GAME_STATE_SCHEMA_VERSION
        )
      ).liveResolution.liveModifiers
    ).toEqual(explicitModifiers);
    expect(() =>
      rehydrateAuthorityGameState(
        serializeReplayPayload(
          withModifiers([
            {
              kind: 'BLADE',
              playerId: PLAYER1,
              countDelta: 1,
              sourceCardId: 'source-member',
              abilityId: HS_BP5_001_ON_ENTER_MILL_GAIN_BLADE_ABILITY_ID,
            },
          ]),
          'AUTHORITY_GAME_STATE',
          GAME_STATE_SCHEMA_VERSION
        )
      )
    ).toThrow('GAME_STATE_V2 BLADE 缺少显式 target');
    expect(() =>
      rehydrateAuthorityGameState(
        serializeReplayPayload(
          withModifiers([
            {
              kind: 'BLADE',
              target: 'TARGET_MEMBER',
              playerId: PLAYER1,
              countDelta: 1,
              sourceCardId: 'source-only',
            },
          ]),
          'AUTHORITY_GAME_STATE',
          GAME_STATE_SCHEMA_VERSION
        )
      )
    ).toThrow('TARGET_MEMBER BLADE 缺少 targetMemberCardId');
    expect(() =>
      rehydrateAuthorityGameState(
        serializeReplayPayload(
          withModifiers([
            {
              kind: 'BLADE',
              target: 'SOURCE_MEMBER',
              playerId: PLAYER1,
              countDelta: 1,
            },
          ]),
          'AUTHORITY_GAME_STATE',
          GAME_STATE_SCHEMA_VERSION
        )
      )
    ).toThrow('SOURCE_MEMBER BLADE 绑定字段无效');
    expect(() =>
      rehydrateAuthorityGameState(
        serializeReplayPayload(
          withModifiers([
            {
              kind: 'BLADE',
              target: 'PLAYER',
              playerId: PLAYER1,
              countDelta: 1,
              targetMemberCardId: 'unexpected-target',
            },
          ]),
          'AUTHORITY_GAME_STATE',
          GAME_STATE_SCHEMA_VERSION
        )
      )
    ).toThrow('PLAYER BLADE 不应绑定 targetMemberCardId');
  });

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

  it('GAME_STATE_V2 拒绝缺失的 manualOperationMode', () => {
    const session = createGameSession();
    session.createGame('strict-v2-manual-operation-mode', PLAYER1, '玩家1', PLAYER2, '玩家2');
    session.initializeGame(createTestDeck('A'), createTestDeck('B'));
    const snapshot = session.getAuthoritySnapshotForRecord()!;
    const incompleteSnapshot = { ...snapshot } as Partial<typeof snapshot>;
    delete incompleteSnapshot.manualOperationMode;

    expect(() =>
      rehydrateAuthorityGameState(
        serializeReplayPayload(
          incompleteSnapshot,
          'AUTHORITY_GAME_STATE',
          GAME_STATE_SCHEMA_VERSION
        )
      )
    ).toThrow('AUTHORITY_GAME_STATE 缺少有效的 manualOperationMode');
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

    expect(() =>
      rehydrateLegacyAuthorityGameStateForMigration({
        ...legacyEnvelope,
        sourceSchemaVersion: GAME_STATE_SCHEMA_VERSION,
      })
    ).toThrow('旧 AUTHORITY_GAME_STATE 迁移只支持 GAME_STATE_V1');
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
