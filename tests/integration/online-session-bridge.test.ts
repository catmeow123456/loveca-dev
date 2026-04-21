import { describe, expect, it } from 'vitest';
import {
  CardType,
  GamePhase,
  HeartColor,
  SubPhase,
  ZoneType,
} from '../../src/shared/types/enums';
import type {
  AnyCardData,
  EnergyCardData,
  LiveCardData,
  MemberCardData,
} from '../../src/domain/entities/card';
import {
  createHeartIcon,
  createHeartRequirement,
} from '../../src/domain/entities/card';
import type { DeckConfig } from '../../src/application/game-service';
import { createMulliganAction } from '../../src/application/actions';
import { GameCommandType, createOpenInspectionCommand } from '../../src/application/game-commands';
import { createGameSession } from '../../src/application/game-session';
import { createPublicObjectId } from '../../src/online';

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

function createTestDeck(): DeckConfig {
  const mainDeck: AnyCardData[] = [];
  const energyDeck: AnyCardData[] = [];

  for (let i = 0; i < 48; i++) {
    mainDeck.push(createTestMemberCard(`MEM-${i}`, `成员 ${i}`));
  }

  for (let i = 0; i < 12; i++) {
    mainDeck.push(createTestLiveCard(`LIVE-${i}`, `Live ${i}`));
    energyDeck.push(createTestEnergyCard(`ENE-${i}`));
  }

  return { mainDeck, energyDeck };
}

function forceMainPhaseForPlayer(session: ReturnType<typeof createGameSession>, activePlayerIndex = 0): void {
  const state = session.state as unknown as {
    currentPhase: GamePhase;
    currentSubPhase: SubPhase;
    activePlayerIndex: number;
    waitingPlayerId: string | null;
  };

  state.currentPhase = GamePhase.MAIN_PHASE;
  state.currentSubPhase = SubPhase.NONE;
  state.activePlayerIndex = activePlayerIndex;
  state.waitingPlayerId = null;
}

describe('GameSession 联机桥接层', () => {
  it('初始化后可读取 PlayerViewState 与基础公共事件时间轴', () => {
    const session = createGameSession();
    const deck = createTestDeck();

    session.createGame('online-bridge', PLAYER1, '玩家1', PLAYER2, '玩家2');
    const initResult = session.initializeGame(deck, deck);

    expect(initResult.success).toBe(true);

    const view = session.getPlayerViewState(PLAYER1);
    expect(view).not.toBeNull();
    expect(view?.match.viewerSeat).toBe('FIRST');
    expect(view?.match.subPhase).toBe(SubPhase.MULLIGAN_FIRST_PLAYER);
    expect(view?.match.seq).toBe(session.getCurrentPublicEventSeq());
    expect(
      view?.permissions.availableCommands.some(
        (hint) => hint.command === GameCommandType.MULLIGAN && hint.enabled
      )
    ).toBe(true);

    const events = session.getPublicEventsSince(0);
    expect(events.some((event) => event.type === 'PhaseStarted' && event.phase === 'MULLIGAN_PHASE')).toBe(true);
    expect(
      events.some(
        (event) =>
          event.type === 'SubPhaseStarted' &&
          event.subPhase === SubPhase.MULLIGAN_FIRST_PLAYER
      )
    ).toBe(true);
    expect(
      events.some(
        (event) =>
          event.type === 'WindowStatusChanged' &&
          event.windowType === 'SIMULTANEOUS_COMMIT' &&
          event.status === 'OPENED' &&
          Array.isArray(event.waitingSeats)
      )
    ).toBe(true);
  });

  it('PlayerViewState 会保留对手隐藏区数量，但不会暴露真实卡牌 ID 和实例', () => {
    const session = createGameSession();
    const deck = createTestDeck();

    session.createGame('online-bridge-redacted', PLAYER1, '玩家1', PLAYER2, '玩家2');
    session.initializeGame(deck, deck);

    const authorityState = session.state!;
    const playerViewState = session.getPlayerViewState(PLAYER1)!;
    const opponentHiddenCardId = authorityState.players[1].hand.cardIds[0];
    const ownHandCardIds = authorityState.players[0].hand.cardIds;
    const opponentHandZone = playerViewState.table.zones.SECOND_HAND;
    const ownHandZone = playerViewState.table.zones.FIRST_HAND;

    expect(opponentHandZone.count).toBe(authorityState.players[1].hand.cardIds.length);
    expect(opponentHandZone.objectIds).toBeUndefined();
    expect(playerViewState.objects[createPublicObjectId(opponentHiddenCardId)]).toBeUndefined();
    expect(ownHandZone.objectIds).toEqual(ownHandCardIds.map((cardId) => createPublicObjectId(cardId)));
  });

  it('PlayerViewState 不会向对手暴露检视区中的真实实例 ID', () => {
    const session = createGameSession();
    const deck = createTestDeck();

    session.createGame('online-bridge-inspection-redacted', PLAYER1, '玩家1', PLAYER2, '玩家2');
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const openResult = session.executeCommand(createOpenInspectionCommand(PLAYER1, ZoneType.MAIN_DECK, 2));
    expect(openResult.success).toBe(true);

    const authorityInspectionCardIds = [...(session.state?.inspectionZone.cardIds ?? [])];
    expect(authorityInspectionCardIds).toHaveLength(2);

    const opponentViewState = session.getPlayerViewState(PLAYER2)!;
    const inspectionZone = opponentViewState.table.zones.FIRST_INSPECTION_ZONE;

    expect(inspectionZone.objectIds).toEqual(
      authorityInspectionCardIds.map((cardId) => createPublicObjectId(cardId))
    );
    expect(
      authorityInspectionCardIds.every((cardId) => !inspectionZone.objectIds?.includes(cardId))
    ).toBe(true);
    expect(
      authorityInspectionCardIds.every((cardId) => {
        const object = opponentViewState.objects[createPublicObjectId(cardId)];
        return object?.surface === 'BACK' && object.frontInfo === undefined;
      })
    ).toBe(true);
  });

  it('玩家动作会进入公共事件流，并推动视图 seq 递增', () => {
    const session = createGameSession();
    const deck = createTestDeck();

    session.createGame('online-bridge-2', PLAYER1, '玩家1', PLAYER2, '玩家2');
    session.initializeGame(deck, deck);

    const beforeSeq = session.getCurrentPublicEventSeq();
    const result = session.dispatch(createMulliganAction(PLAYER1, []));

    expect(result.success).toBe(true);

    const nextSeq = session.getCurrentPublicEventSeq();
    expect(nextSeq).toBeGreaterThan(beforeSeq);

    const events = session.getPublicEventsSince(beforeSeq);
    expect(
      events.some(
        (event) =>
          event.type === 'PlayerDeclared' &&
          event.actorSeat === 'FIRST' &&
          event.declarationType === 'MULLIGAN'
      )
    ).toBe(true);

    const view = session.getPlayerViewState(PLAYER1);
    expect(view?.match.seq).toBe(nextSeq);
  });

  it('会话层会按座位记录私密事件、密封审计、命令日志和快照历史', () => {
    const session = createGameSession();
    const deck = createTestDeck();

    session.createGame('online-bridge-private', PLAYER1, '玩家1', PLAYER2, '玩家2');
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const result = session.executeCommand(createOpenInspectionCommand(PLAYER1, ZoneType.MAIN_DECK, 2));
    expect(result.success).toBe(true);

    const player1PrivateEvents = session.getPrivateEventsSince(PLAYER1, 0);
    const player2PrivateEvents = session.getPrivateEventsSince(PLAYER2, 0);
    const sealedAudit = session.getSealedAuditSince(0);
    const commandLog = session.getCommandLogSince(0);
    const snapshots = session.getSnapshotHistory();
    const recoverySnapshot = session.getAuthoritySnapshotAtOrBefore(session.getCurrentPublicEventSeq());

    expect(
      player1PrivateEvents.some(
        (event) =>
          event.type === 'INSPECTION_CANDIDATES' &&
          Array.isArray((event.payload as { cardIds?: unknown[] }).cardIds) &&
          ((event.payload as { cardIds?: unknown[] }).cardIds?.length ?? 0) === 2
      )
    ).toBe(true);
    expect(player2PrivateEvents.some((event) => event.type === 'INSPECTION_CANDIDATES')).toBe(false);
    expect(
      sealedAudit.some(
        (record) =>
          record.type === 'INSPECTION_OPENED' &&
          Array.isArray((record.payload as { cardIds?: unknown[] }).cardIds) &&
          ((record.payload as { cardIds?: unknown[] }).cardIds?.length ?? 0) === 2
      )
    ).toBe(true);
    expect(
      commandLog.some(
        (record) => record.commandType === 'OPEN_INSPECTION' && record.status === 'ACCEPTED'
      )
    ).toBe(true);
    expect(snapshots.length).toBeGreaterThan(0);
    expect(recoverySnapshot).not.toBeNull();
  });

  it('恢复帧会返回快照与其后的增量事件，且旧快照不会被后续状态修改污染', () => {
    const session = createGameSession();
    const deck = createTestDeck();

    session.createGame('online-bridge-recovery', PLAYER1, '玩家1', PLAYER2, '玩家2');
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const beforeSeq = session.getCurrentPublicEventSeq();
    const openResult = session.executeCommand(createOpenInspectionCommand(PLAYER1, ZoneType.MAIN_DECK, 1));
    expect(openResult.success).toBe(true);

    const recovery = session.getPlayerRecoveryFrame(PLAYER1, beforeSeq);
    const authorityRecovery = session.getAuthoritativeRecoveryFrame(beforeSeq);
    expect(recovery).not.toBeNull();
    expect(authorityRecovery).not.toBeNull();
    expect(recovery?.snapshotPublicSeq).toBeLessThanOrEqual(beforeSeq);
    expect(
      recovery?.publicEvents.some((event) => event.type === 'CardsInspectedSummary')
    ).toBe(true);
    expect(
      recovery?.privateEvents.some((event) => event.type === 'INSPECTION_CANDIDATES')
    ).toBe(true);
    expect(
      authorityRecovery?.sealedAudit.some((record) => record.type === 'INSPECTION_OPENED')
    ).toBe(true);

    const snapshotBeforeMutation = session.getAuthoritySnapshotAtOrBefore(beforeSeq);
    expect(snapshotBeforeMutation).not.toBeNull();

    const liveCardId = session.state?.players[0].liveZone.cardIds[0] ?? null;
    if (liveCardId) {
      session.state!.players[0].liveZone.cardIds = [];
    }

    const snapshotAfterMutation = session.getAuthoritySnapshotAtOrBefore(beforeSeq);
    expect(snapshotAfterMutation).toEqual(snapshotBeforeMutation);
  });

  it('相同幂等键的命令重试不会重复改状态，而同键异载荷会被拒绝', () => {
    const session = createGameSession();
    const deck = createTestDeck();

    session.createGame('online-bridge-idempotency', PLAYER1, '玩家1', PLAYER2, '玩家2');
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const baseCommand = {
      ...createOpenInspectionCommand(PLAYER1, ZoneType.MAIN_DECK, 1),
      idempotencyKey: 'open-main-deck-1',
    };

    const firstResult = session.executeCommand(baseCommand);
    expect(firstResult.success).toBe(true);

    const seqAfterFirst = session.getCurrentPublicEventSeq();
    const resolutionCountAfterFirst = session.state?.resolutionZone.cardIds.length ?? 0;
    const commandLogCountAfterFirst = session.getCommandLogSince(0).length;

    const secondResult = session.executeCommand({
      ...baseCommand,
      timestamp: baseCommand.timestamp + 1,
    });
    expect(secondResult.success).toBe(true);
    expect(session.getCurrentPublicEventSeq()).toBe(seqAfterFirst);
    expect(session.state?.resolutionZone.cardIds.length).toBe(resolutionCountAfterFirst);
    expect(session.getCommandLogSince(0)).toHaveLength(commandLogCountAfterFirst);

    const conflictResult = session.executeCommand({
      ...baseCommand,
      count: 2,
      timestamp: baseCommand.timestamp,
    });
    expect(conflictResult.success).toBe(false);
    expect(conflictResult.error).toContain('同一幂等键对应的命令载荷不一致');
  });
});
