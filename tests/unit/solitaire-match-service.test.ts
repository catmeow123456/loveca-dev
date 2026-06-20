import { describe, expect, it, vi } from 'vitest';
import {
  createMulliganCommand,
  createOpenInspectionCommand,
} from '../../src/application/game-commands';
import type { DeckConfig } from '../../src/application/game-service';
import type {
  AnyCardData,
  EnergyCardData,
  LiveCardData,
  MemberCardData,
} from '../../src/domain/entities/card';
import { createHeartIcon, createHeartRequirement } from '../../src/domain/entities/card';
import { GameMode, CardType, HeartColor, GamePhase, ZoneType } from '../../src/shared/types/enums';
import { OnlineMatchService } from '../../src/server/services/online-match-service';
import { SolitaireMatchService } from '../../src/server/services/solitaire-match-service';

vi.mock('../../src/server/db/pool.js', () => ({
  pool: {
    query: vi.fn(),
    connect: vi.fn(),
  },
}));

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

function createRuntimeDeck(prefix: string): DeckConfig {
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

function createHarness() {
  const matchService = new OnlineMatchService({
    recorder: null,
    idGenerator: () => 'match-solitaire-service-1',
  });
  const service = new SolitaireMatchService({
    now: () => 1_000,
    matchService,
    idGenerator: () => 'room-solitaire-service-1',
    opponentDeckPath: 'assets/decks/test-opponent.yaml',
    loadUserProfile: async (userId) => ({
      userId,
      displayName: '测试玩家',
    }),
    loadOwnedDeck: async (userId, deckId) => ({
      deckId,
      deckName: `${userId} 的卡组`,
      runtimeDeck: createRuntimeDeck('USER'),
    }),
    loadOpponentDeck: async () => createRuntimeDeck('OPP'),
  });

  return { matchService, service };
}

describe('SolitaireMatchService', () => {
  it('创建服务端权威对墙打并保留记录模式、系统对手与默认卡组来源', async () => {
    const { matchService, service } = createHarness();

    const result = await service.createMatch({
      userId: 'user-1',
      deckId: '11111111-1111-4111-8111-111111111111',
    });

    const match = matchService.getMatch(result.matchId);
    expect(match).not.toBeNull();
    expect(match).toMatchObject({
      roomCode: 'SOL-room-solitaire-service-1',
      matchMode: 'SOLITAIRE',
      automationGameMode: 'SOLITAIRE',
      originKind: 'SOLITAIRE',
      originLabel: '对墙打',
    });
    expect(match?.session.gameMode).toBe(GameMode.SOLITAIRE);
    expect(match?.participants.FIRST).toMatchObject({
      userId: 'user-1',
      participantKind: 'USER',
      ownerUserId: null,
    });
    expect(match?.participants.SECOND).toMatchObject({
      userId: 'system:solitaire-opponent',
      participantKind: 'SYSTEM',
      ownerUserId: 'user-1',
    });
    expect(match?.deckSnapshots.FIRST.source).toBe('PUBLISHED_CARDS_SNAPSHOT');
    expect(match?.deckSnapshots.SECOND.source).toBe('SOLITAIRE_DEFAULT_DECK');
    expect(result.snapshot.seat).toBe('FIRST');
    expect(result.snapshot.playerViewState.uiHints.gameMode).toBe(GameMode.SOLITAIRE);
  });

  it('运行中接口拒绝系统对手与非参与用户，避免系统 participant 被当作真实用户授权', async () => {
    const { matchService, service } = createHarness();
    const result = await service.createMatch({
      userId: 'user-1',
      deckId: '11111111-1111-4111-8111-111111111111',
    });

    await expect(
      service.getMatchSnapshot(result.matchId, 'system:solitaire-opponent')
    ).resolves.toBeNull();
    await expect(service.getMatchSnapshot(result.matchId, 'other-user')).resolves.toBeNull();
    await expect(
      service.executeCommand(
        result.matchId,
        'system:solitaire-opponent',
        createMulliganCommand('ignored-player', [])
      )
    ).resolves.toBeNull();
    await expect(
      service.advancePhase(result.matchId, 'system:solitaire-opponent')
    ).resolves.toBeNull();
    await expect(service.leaveMatch(result.matchId, 'system:solitaire-opponent')).resolves.toBeNull();
    expect(matchService.getMatch(result.matchId)).not.toBeNull();
  });

  it('服务端可记录对墙打允许 FIRST 真实用户按 revision 撤销最近一步', async () => {
    const { service } = createHarness();
    const created = await service.createMatch({
      userId: 'user-1',
      deckId: '11111111-1111-4111-8111-111111111111',
    });

    const mainPhaseResult = await service.executeCommand(
      created.matchId,
      'user-1',
      createMulliganCommand('ignored-player', [])
    );
    expect(mainPhaseResult?.success).toBe(true);
    expect(mainPhaseResult?.snapshot?.playerViewState.match.phase).toBe(GamePhase.MAIN_PHASE);

    const commandResult = await service.executeCommand(
      created.matchId,
      'user-1',
      createOpenInspectionCommand('ignored-player', ZoneType.MAIN_DECK, 1)
    );

    expect(commandResult?.success).toBe(true);
    expect(commandResult?.snapshot?.seq).toBeGreaterThan(mainPhaseResult!.snapshot!.seq);
    const undoView = commandResult?.snapshot?.playerViewState.match.undo;
    expect(undoView).toMatchObject({
      policy: 'REMOTE_IMMEDIATE',
      canUndoNow: true,
      disabledReason: null,
    });
    expect(undoView?.entry?.label).toBe('OPEN_INSPECTION');

    const undoResult = await service.undoLatest(created.matchId, 'user-1', {
      expectedRevision: commandResult!.snapshot!.seq,
      undoEntryId: undoView!.entry!.undoEntryId,
      idempotencyKey: 'undo-test-1',
    });

    expect(undoResult?.success).toBe(true);
    expect(undoResult?.snapshot?.seq).toBeGreaterThan(commandResult!.snapshot!.seq);
    expect(undoResult?.snapshot?.playerViewState.match.seq).toBe(undoResult?.snapshot?.seq);
    expect(undoResult?.snapshot?.playerViewState.match.undo?.canUndoNow).toBe(false);

    const repeated = await service.undoLatest(created.matchId, 'user-1', {
      expectedRevision: commandResult!.snapshot!.seq,
      undoEntryId: undoView!.entry!.undoEntryId,
      idempotencyKey: 'undo-test-1',
    });
    expect(repeated?.success).toBe(true);
    expect(repeated?.snapshot?.seq).toBe(undoResult?.snapshot?.seq);
  });

  it('服务端可记录对墙打撤销拒绝旧 revision 与非参与用户', async () => {
    const { service } = createHarness();
    const created = await service.createMatch({
      userId: 'user-1',
      deckId: '11111111-1111-4111-8111-111111111111',
    });
    const mainPhaseResult = await service.executeCommand(
      created.matchId,
      'user-1',
      createMulliganCommand('ignored-player', [])
    );
    expect(mainPhaseResult?.success).toBe(true);
    expect(mainPhaseResult?.snapshot?.playerViewState.match.phase).toBe(GamePhase.MAIN_PHASE);

    const commandResult = await service.executeCommand(
      created.matchId,
      'user-1',
      createOpenInspectionCommand('ignored-player', ZoneType.MAIN_DECK, 1)
    );
    const undoEntry = commandResult?.snapshot?.playerViewState.match.undo?.entry;
    expect(undoEntry).toBeTruthy();

    const stale = await service.undoLatest(created.matchId, 'user-1', {
      expectedRevision: created.snapshot.seq,
      undoEntryId: undoEntry!.undoEntryId,
    });
    expect(stale).toMatchObject({
      success: false,
      error: '对局状态已更新，请刷新后重试',
    });

    await expect(
      service.undoLatest(created.matchId, 'system:solitaire-opponent', {
        expectedRevision: commandResult!.snapshot!.seq,
        undoEntryId: undoEntry!.undoEntryId,
      })
    ).resolves.toBeNull();
  });
});
