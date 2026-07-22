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
import {
  OnlineMatchService,
  type OnlineMatchState,
} from '../../src/server/services/online-match-service';
import { SolitaireMatchService } from '../../src/server/services/solitaire-match-service';
import type { SolitaireRecoveredMatch } from '../../src/server/services/solitaire-runtime-recovery-service';

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

function createHarness(
  options: {
    readonly recoveryService?: {
      recoverMatch: (matchId: string, userId: string) => Promise<SolitaireRecoveredMatch | null>;
    } | null;
  } = {}
) {
  const matchService = new OnlineMatchService({
    recorder: null,
    idGenerator: () => 'match-solitaire-service-1',
  });
  const service = new SolitaireMatchService({
    now: () => 1_000,
    matchService,
    recoveryService: options.recoveryService,
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

async function prepareRecoveredMatch(matchService: OnlineMatchService, matchId: string) {
  const match = matchService.getMatch(matchId);
  expect(match).not.toBeNull();
  const liveMatch = match as OnlineMatchState;
  const authorityState = liveMatch.session.getAuthoritySnapshotForRecord();
  const captureCursor = liveMatch.session.getRuntimeCaptureCursor();
  expect(authorityState).not.toBeNull();
  const publicEvents = liveMatch.session.getPublicEventsSince(0);
  const currentPublicSeq = liveMatch.session.getCurrentPublicEventSeq();

  liveMatch.session.restoreRuntimeState({
    authorityState: authorityState!,
    currentPublicSeq,
    publicEvents,
    retainedPublicEventFloorSeq: 0,
    currentPrivateSeq: Math.max(
      captureCursor.privateSeqBySeat.FIRST,
      captureCursor.privateSeqBySeat.SECOND
    ),
    currentPrivateSeqBySeat: captureCursor.privateSeqBySeat,
    currentAuditSeq: captureCursor.auditSeq,
    currentCommandSeq: captureCursor.commandSeq,
  });

  liveMatch.recordCaptureCursor = liveMatch.session.getRuntimeCaptureCursor();
  liveMatch.remoteRevision += 50;
  liveMatch.updatedAt = 2_000;
  liveMatch.lastActivityAt = 2_000;

  return {
    match: liveMatch,
    currentPublicSeq,
    publicEvents,
  };
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
    await expect(
      service.leaveMatch(result.matchId, 'system:solitaire-opponent')
    ).resolves.toBeNull();
    expect(matchService.getMatch(result.matchId)).not.toBeNull();
  });

  it('共用 match cleanup 会释放过期的对墙打运行态', async () => {
    const { matchService, service } = createHarness();
    const result = await service.createMatch({
      userId: 'user-1',
      deckId: '11111111-1111-4111-8111-111111111111',
    });
    const match = matchService.getMatch(result.matchId);
    expect(match).not.toBeNull();
    match!.lastActivityAt = 1_000;

    const beforeStats = matchService.getRuntimeStats(31 * 60 * 1000 + 1_000);
    expect(beforeStats.matchCountByMode.SOLITAIRE).toBe(1);
    expect(beforeStats.staleMatchCount).toBe(1);

    const summary = await matchService.cleanupExpiredMatches(new Set(), 31 * 60 * 1000 + 1_000);

    expect(summary).toMatchObject({
      checkedMatchCount: 1,
      staleMatchCount: 1,
      deletedMatchCount: 1,
      failedDeleteCount: 0,
    });
    expect(matchService.getMatch(result.matchId)).toBeNull();
    expect(matchService.getRuntimeStats(31 * 60 * 1000 + 1_000).matchCount).toBe(0);
  });

  it('服务端可记录对墙打允许 FIRST 真实用户按 revision 撤销最近一步', async () => {
    const { matchService, service } = createHarness();
    const created = await service.createMatch({
      userId: 'user-1',
      deckId: '11111111-1111-4111-8111-111111111111',
    });
    matchService.getMatch(created.matchId)!.session.localFreePlay = true;

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
    const { matchService, service } = createHarness();
    const created = await service.createMatch({
      userId: 'user-1',
      deckId: '11111111-1111-4111-8111-111111111111',
    });
    matchService.getMatch(created.matchId)!.session.localFreePlay = true;
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

  it('运行态缺失时会从最近保存点恢复对墙打并重新注册运行态', async () => {
    const recoveryService = {
      recoverMatch:
        vi.fn<(matchId: string, userId: string) => Promise<SolitaireRecoveredMatch | null>>(),
    };
    const { matchService, service } = createHarness({ recoveryService });
    const created = await service.createMatch({
      userId: 'user-1',
      deckId: '11111111-1111-4111-8111-111111111111',
    });
    const recovered = await prepareRecoveredMatch(matchService, created.matchId);
    recovered.match.recoveryNotice = {
      restoredAt: 2_000,
      checkpointSeq: 3,
      checkpointTimelineSeq: 7,
      currentPublicSeq: recovered.currentPublicSeq,
      rolledBackFromPublicSeq: null,
      rolledBackFromTimelineSeq: null,
      publicEvents: recovered.publicEvents,
      truncated: false,
      droppedEventCount: 0,
    };
    await matchService.deleteMatch(created.matchId, { reason: 'TEST_RUNTIME_EVICTED' });
    recoveryService.recoverMatch.mockResolvedValueOnce({
      match: recovered.match,
      recovery: {
        restoredAt: 2_000,
        checkpointSeq: 3,
        checkpointTimelineSeq: 7,
        currentPublicSeq: recovered.currentPublicSeq,
        rolledBackFromPublicSeq: null,
        rolledBackFromTimelineSeq: null,
      },
    });

    const snapshot = await service.getMatchSnapshot(created.matchId, 'user-1');

    expect(recoveryService.recoverMatch).toHaveBeenCalledWith(created.matchId, 'user-1');
    expect(snapshot).not.toBeNull();
    expect(snapshot && 'modified' in snapshot).toBe(false);
    if (!snapshot || 'modified' in snapshot) {
      throw new Error('expected recovered snapshot');
    }
    expect(snapshot.recovery).toMatchObject({
      checkpointSeq: 3,
      checkpointTimelineSeq: 7,
    });
    expect(matchService.getMatch(created.matchId)).not.toBeNull();

    const nextSnapshot = await service.getMatchSnapshot(created.matchId, 'user-1');
    expect(nextSnapshot && 'modified' in nextSnapshot).toBe(false);
    if (!nextSnapshot || 'modified' in nextSnapshot) {
      throw new Error('expected restored runtime snapshot');
    }
    expect(nextSnapshot.recovery).toBeUndefined();
  });

  it('恢复通知待发送时即使 sinceSeq 未落后也返回完整快照', async () => {
    const recoveryService = {
      recoverMatch:
        vi.fn<(matchId: string, userId: string) => Promise<SolitaireRecoveredMatch | null>>(),
    };
    const { matchService, service } = createHarness({ recoveryService });
    const created = await service.createMatch({
      userId: 'user-1',
      deckId: '11111111-1111-4111-8111-111111111111',
    });
    const recovered = await prepareRecoveredMatch(matchService, created.matchId);
    recovered.match.remoteRevision = created.snapshot.seq;
    recovered.match.recoveryNotice = {
      restoredAt: 2_000,
      checkpointSeq: 6,
      checkpointTimelineSeq: 10,
      currentPublicSeq: recovered.currentPublicSeq,
      rolledBackFromPublicSeq: null,
      rolledBackFromTimelineSeq: null,
      publicEvents: recovered.publicEvents,
      truncated: false,
      droppedEventCount: 0,
    };
    await matchService.deleteMatch(created.matchId, { reason: 'TEST_RUNTIME_EVICTED' });
    recoveryService.recoverMatch.mockResolvedValueOnce({
      match: recovered.match,
      recovery: {
        restoredAt: 2_000,
        checkpointSeq: 6,
        checkpointTimelineSeq: 10,
        currentPublicSeq: recovered.currentPublicSeq,
        rolledBackFromPublicSeq: null,
        rolledBackFromTimelineSeq: null,
      },
    });

    const snapshot = await service.getMatchSnapshot(created.matchId, 'user-1', {
      sinceSeq: created.snapshot.seq,
    });

    expect(snapshot).not.toBeNull();
    expect(snapshot && 'modified' in snapshot).toBe(false);
    if (!snapshot || 'modified' in snapshot) {
      throw new Error('expected recovery snapshot despite matching sinceSeq');
    }
    expect(snapshot.seq).toBe(created.snapshot.seq);
    expect(snapshot.recovery).toMatchObject({
      checkpointSeq: 6,
      checkpointTimelineSeq: 10,
    });
  });

  it('恢复后若已回退到更早保存点，会拒绝旧写操作并返回恢复快照', async () => {
    const recoveryService = {
      recoverMatch:
        vi.fn<(matchId: string, userId: string) => Promise<SolitaireRecoveredMatch | null>>(),
    };
    const { matchService, service } = createHarness({ recoveryService });
    const created = await service.createMatch({
      userId: 'user-1',
      deckId: '11111111-1111-4111-8111-111111111111',
    });
    const recovered = await prepareRecoveredMatch(matchService, created.matchId);
    recovered.match.recoveryNotice = {
      restoredAt: 2_000,
      checkpointSeq: 4,
      checkpointTimelineSeq: 8,
      currentPublicSeq: recovered.currentPublicSeq,
      rolledBackFromPublicSeq: recovered.currentPublicSeq + 3,
      rolledBackFromTimelineSeq: 12,
      publicEvents: recovered.publicEvents,
      truncated: false,
      droppedEventCount: 0,
    };
    await matchService.deleteMatch(created.matchId, { reason: 'TEST_RUNTIME_EVICTED' });
    recoveryService.recoverMatch.mockResolvedValueOnce({
      match: recovered.match,
      recovery: {
        restoredAt: 2_000,
        checkpointSeq: 4,
        checkpointTimelineSeq: 8,
        currentPublicSeq: recovered.currentPublicSeq,
        rolledBackFromPublicSeq: recovered.currentPublicSeq + 3,
        rolledBackFromTimelineSeq: 12,
      },
    });
    const executeSpy = vi.spyOn(matchService, 'executeCommand');

    const result = await service.executeCommand(
      created.matchId,
      'user-1',
      createMulliganCommand('ignored-player', [])
    );

    expect(result).toMatchObject({
      success: false,
      error: '对局已恢复到最近保存点，请刷新后重试',
    });
    expect(result?.snapshot?.recovery).toMatchObject({
      checkpointSeq: 4,
      rolledBackFromTimelineSeq: 12,
    });
    expect(executeSpy).not.toHaveBeenCalled();
    expect(matchService.getMatch(created.matchId)).not.toBeNull();
  });

  it('公共事件读取先触发回退恢复时，后续写操作仍会被拒绝并返回恢复快照', async () => {
    const recoveryService = {
      recoverMatch:
        vi.fn<(matchId: string, userId: string) => Promise<SolitaireRecoveredMatch | null>>(),
    };
    const { matchService, service } = createHarness({ recoveryService });
    const created = await service.createMatch({
      userId: 'user-1',
      deckId: '11111111-1111-4111-8111-111111111111',
    });
    const recovered = await prepareRecoveredMatch(matchService, created.matchId);
    recovered.match.recoveryNotice = {
      restoredAt: 2_000,
      checkpointSeq: 7,
      checkpointTimelineSeq: 11,
      currentPublicSeq: recovered.currentPublicSeq,
      rolledBackFromPublicSeq: recovered.currentPublicSeq + 4,
      rolledBackFromTimelineSeq: 16,
      publicEvents: recovered.publicEvents,
      truncated: false,
      droppedEventCount: 0,
    };
    await matchService.deleteMatch(created.matchId, { reason: 'TEST_RUNTIME_EVICTED' });
    recoveryService.recoverMatch.mockResolvedValueOnce({
      match: recovered.match,
      recovery: {
        restoredAt: 2_000,
        checkpointSeq: 7,
        checkpointTimelineSeq: 11,
        currentPublicSeq: recovered.currentPublicSeq,
        rolledBackFromPublicSeq: recovered.currentPublicSeq + 4,
        rolledBackFromTimelineSeq: 16,
      },
    });
    const executeSpy = vi.spyOn(matchService, 'executeCommand');

    const publicEvents = await service.getMatchPublicEvents(created.matchId, 'user-1', {
      afterSeq: 0,
    });
    expect(publicEvents).not.toBeNull();
    expect(matchService.getMatch(created.matchId)?.recoveryNotice).not.toBeNull();

    const result = await service.executeCommand(
      created.matchId,
      'user-1',
      createMulliganCommand('ignored-player', [])
    );

    expect(result).toMatchObject({
      success: false,
      error: '对局已恢复到最近保存点，请刷新后重试',
    });
    expect(result?.snapshot?.recovery).toMatchObject({
      checkpointSeq: 7,
      rolledBackFromTimelineSeq: 16,
    });
    expect(executeSpy).not.toHaveBeenCalled();
    expect(matchService.getMatch(created.matchId)?.recoveryNotice).toBeNull();
  });

  it('恢复后会拒绝旧撤销请求，并提示撤销历史已重置', async () => {
    const recoveryService = {
      recoverMatch:
        vi.fn<(matchId: string, userId: string) => Promise<SolitaireRecoveredMatch | null>>(),
    };
    const { matchService, service } = createHarness({ recoveryService });
    const created = await service.createMatch({
      userId: 'user-1',
      deckId: '11111111-1111-4111-8111-111111111111',
    });
    matchService.getMatch(created.matchId)!.session.localFreePlay = true;
    const mainPhaseResult = await service.executeCommand(
      created.matchId,
      'user-1',
      createMulliganCommand('ignored-player', [])
    );
    expect(mainPhaseResult?.success).toBe(true);
    const commandResult = await service.executeCommand(
      created.matchId,
      'user-1',
      createOpenInspectionCommand('ignored-player', ZoneType.MAIN_DECK, 1)
    );
    const undoEntry = commandResult?.snapshot?.playerViewState.match.undo?.entry;
    expect(undoEntry).toBeTruthy();

    const recovered = await prepareRecoveredMatch(matchService, created.matchId);
    recovered.match.recoveryNotice = {
      restoredAt: 2_000,
      checkpointSeq: 5,
      checkpointTimelineSeq: 9,
      currentPublicSeq: recovered.currentPublicSeq,
      rolledBackFromPublicSeq: null,
      rolledBackFromTimelineSeq: null,
      publicEvents: recovered.publicEvents,
      truncated: false,
      droppedEventCount: 0,
    };
    await matchService.deleteMatch(created.matchId, { reason: 'TEST_RUNTIME_EVICTED' });
    recoveryService.recoverMatch.mockResolvedValueOnce({
      match: recovered.match,
      recovery: {
        restoredAt: 2_000,
        checkpointSeq: 5,
        checkpointTimelineSeq: 9,
        currentPublicSeq: recovered.currentPublicSeq,
        rolledBackFromPublicSeq: null,
        rolledBackFromTimelineSeq: null,
      },
    });

    const result = await service.undoLatest(created.matchId, 'user-1', {
      expectedRevision: commandResult!.snapshot!.seq,
      undoEntryId: undoEntry!.undoEntryId,
      idempotencyKey: 'undo-after-recovery',
    });

    expect(result).toMatchObject({
      success: false,
      error: '对局运行态已恢复，撤销历史已重置，请刷新后重试',
    });
    expect(result?.snapshot?.recovery).toMatchObject({
      checkpointSeq: 5,
      rolledBackFromTimelineSeq: null,
    });
  });
});
