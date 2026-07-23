import { describe, expect, it } from 'vitest';
import {
  createEndPhaseCommand,
  createPlayMemberToSlotCommand,
} from '../../src/application/game-commands';
import type { DeckConfig } from '../../src/application/game-service';
import type { EnergyCardData, LiveCardData, MemberCardData } from '../../src/domain/entities/card';
import { createHeartIcon, createHeartRequirement } from '../../src/domain/entities/card';
import type { ActiveEffectState } from '../../src/domain/entities/game';
import {
  OnlineMatchService,
  type OnlineMatchState,
} from '../../src/server/services/online-match-service';
import {
  CardType,
  GamePhase,
  HeartColor,
  SlotPosition,
  SubPhase,
} from '../../src/shared/types/enums';

describe('联机自由模式协商', () => {
  it('新对局默认规则模式，双方同意后开启，任意一方可直接恢复规则模式', async () => {
    const service = new OnlineMatchService({ recorder: null });
    const match = await createOnlineMatch(service, 'MODE01');
    forceMainPhase(match);

    const initial = await service.getMatchSnapshot(match.matchId, 'u1');
    expect(initial?.playerViewState.match.manualOperation).toMatchObject({
      mode: 'RULES',
      canSwitchNow: true,
      pendingRequest: null,
    });

    const requested = await service.changeManualOperationMode(match.matchId, 'u1', {
      targetMode: 'FREE',
      expectedRevision: initial!.seq,
      idempotencyKey: 'request-free',
    });
    expect(requested?.success).toBe(true);
    expect(requested?.snapshot?.playerViewState.match.manualOperation).toMatchObject({
      mode: 'RULES',
      pendingRequest: { requesterSeat: 'FIRST', targetMode: 'FREE' },
    });
    const request = requested!.snapshot!.playerViewState.match.manualOperation!.pendingRequest!;

    const repeatedRequest = await service.changeManualOperationMode(match.matchId, 'u1', {
      targetMode: 'FREE',
      expectedRevision: initial!.seq,
      idempotencyKey: 'request-free',
    });
    expect(repeatedRequest?.success).toBe(true);
    expect(repeatedRequest?.snapshot?.seq).toBe(requested?.snapshot?.seq);

    const opponent = await service.getMatchSnapshot(match.matchId, 'u2');
    expect(opponent?.playerViewState.match.manualOperation?.pendingRequest?.requestId).toBe(
      request.requestId
    );
    const accepted = await service.acceptManualOperationModeRequest(
      match.matchId,
      'u2',
      request.requestId,
      {
        expectedRevision: requested!.snapshot!.seq,
        idempotencyKey: 'accept-free',
      }
    );
    expect(accepted?.snapshot?.playerViewState.match.manualOperation).toMatchObject({
      mode: 'FREE',
      pendingRequest: null,
    });

    const repeatedAccept = await service.acceptManualOperationModeRequest(
      match.matchId,
      'u2',
      request.requestId,
      {
        expectedRevision: requested!.snapshot!.seq,
        idempotencyKey: 'accept-free',
      }
    );
    expect(repeatedAccept?.success).toBe(true);
    expect(repeatedAccept?.snapshot?.seq).toBe(accepted?.snapshot?.seq);

    const restored = await service.changeManualOperationMode(match.matchId, 'u1', {
      targetMode: 'RULES',
      expectedRevision: accepted!.snapshot!.seq,
      idempotencyKey: 'return-rules',
    });
    expect(restored?.snapshot?.playerViewState.match.manualOperation?.mode).toBe('RULES');
    expect(match.session.manualOperationMode).toBe('RULES');
  });

  it('对方可拒绝，发起方可取消，迟到响应明确失效', async () => {
    const service = new OnlineMatchService({ recorder: null });
    const match = await createOnlineMatch(service, 'MODE02');
    forceMainPhase(match);
    const initial = await service.getMatchSnapshot(match.matchId, 'u1');

    const first = await service.changeManualOperationMode(match.matchId, 'u1', {
      targetMode: 'FREE',
      expectedRevision: initial!.seq,
      idempotencyKey: 'reject-request',
    });
    const firstRequest = first!.snapshot!.playerViewState.match.manualOperation!.pendingRequest!;
    const rejected = await service.rejectManualOperationModeRequest(
      match.matchId,
      'u2',
      firstRequest.requestId,
      { expectedRevision: first!.snapshot!.seq, idempotencyKey: 'reject-response' }
    );
    expect(rejected?.snapshot?.playerViewState.match.manualOperation).toMatchObject({
      mode: 'RULES',
      pendingRequest: null,
    });
    const lateAccept = await service.acceptManualOperationModeRequest(
      match.matchId,
      'u2',
      firstRequest.requestId,
      { expectedRevision: rejected!.snapshot!.seq, idempotencyKey: 'late-accept' }
    );
    expect(lateAccept?.success).toBe(false);
    expect(lateAccept?.error).toContain('已失效');

    const second = await service.changeManualOperationMode(match.matchId, 'u2', {
      targetMode: 'FREE',
      expectedRevision: rejected!.snapshot!.seq,
      idempotencyKey: 'cancel-request',
    });
    const secondRequest = second!.snapshot!.playerViewState.match.manualOperation!.pendingRequest!;
    const cancelled = await service.cancelManualOperationModeRequest(
      match.matchId,
      'u2',
      secondRequest.requestId,
      { expectedRevision: second!.snapshot!.seq, idempotencyKey: 'cancel-response' }
    );
    expect(cancelled?.snapshot?.playerViewState.match.manualOperation).toMatchObject({
      mode: 'RULES',
      pendingRequest: null,
    });
  });

  it('请求超时或有新操作后失效，且不与撤销请求并行', async () => {
    let now = 10_000;
    const service = new OnlineMatchService({ now: () => now, recorder: null });
    const match = await createOnlineMatch(service, 'MODE03');
    forceMainPhase(match);
    let snapshot = await service.getMatchSnapshot(match.matchId, 'u1');

    const timed = await service.changeManualOperationMode(match.matchId, 'u1', {
      targetMode: 'FREE',
      expectedRevision: snapshot!.seq,
      idempotencyKey: 'timeout-request',
    });
    const timedRequest = timed!.snapshot!.playerViewState.match.manualOperation!.pendingRequest!;
    now += 60_001;
    snapshot = await service.getMatchSnapshot(match.matchId, 'u1');
    expect(snapshot?.playerViewState.match.manualOperation).toMatchObject({
      mode: 'RULES',
      pendingRequest: null,
    });
    const expiredAccept = await service.acceptManualOperationModeRequest(
      match.matchId,
      'u2',
      timedRequest.requestId,
      { expectedRevision: snapshot!.seq, idempotencyKey: 'expired-accept' }
    );
    expect(expiredAccept?.success).toBe(false);

    const memberObjectId = snapshot?.playerViewState.table.zones.FIRST_HAND.objectIds?.find(
      (objectId) => snapshot?.playerViewState.objects[objectId]?.cardType === CardType.MEMBER
    );
    expect(memberObjectId).toBeTruthy();
    const memberId = memberObjectId!.replace(/^obj_/, '');
    const draw = await service.executeCommand(
      match.matchId,
      'u1',
      createPlayMemberToSlotCommand('ignored', memberId, SlotPosition.CENTER)
    );
    expect(draw?.success).toBe(true);
    const undoEntry = draw!.snapshot!.playerViewState.match.undo!.entry!;
    const pending = await service.changeManualOperationMode(match.matchId, 'u1', {
      targetMode: 'FREE',
      expectedRevision: draw!.snapshot!.seq,
      idempotencyKey: 'command-invalidates',
    });
    const pendingRequest =
      pending!.snapshot!.playerViewState.match.manualOperation!.pendingRequest!;
    expect(pending?.snapshot?.playerViewState.match.undo).toMatchObject({
      canUndoNow: false,
      disabledReason: '请先处理当前自由模式请求',
    });
    const undoWhilePending = await service.createUndoRequest(match.matchId, 'u1', {
      expectedRevision: pending!.snapshot!.seq,
      undoEntryId: undoEntry.undoEntryId,
      idempotencyKey: 'undo-while-mode',
    });
    expect(undoWhilePending?.success).toBe(false);
    expect(undoWhilePending?.error).toContain('自由模式请求');

    const command = await service.executeCommand(
      match.matchId,
      'u1',
      createEndPhaseCommand('ignored')
    );
    expect(command?.success).toBe(true);
    expect(command?.snapshot?.playerViewState.match.manualOperation?.pendingRequest).toBeNull();
    const stale = await service.acceptManualOperationModeRequest(
      match.matchId,
      'u2',
      pendingRequest.requestId,
      { expectedRevision: command!.snapshot!.seq, idempotencyKey: 'stale-after-command' }
    );
    expect(stale?.success).toBe(false);
    expect(stale?.error).toContain('已失效');
  });

  it('有卡效 pending 时服务端拒绝开启或退出自由模式', async () => {
    const service = new OnlineMatchService({ recorder: null });
    const match = await createOnlineMatch(service, 'MODE04');
    forceMainPhase(match);
    const state = match.session.state! as unknown as {
      activeEffect: ActiveEffectState | null;
    };
    state.activeEffect = {
      id: 'effect',
      abilityId: 'ability',
      sourceCardId: 'source',
      controllerId: match.participants.FIRST.playerId,
      effectText: '测试效果',
      stepId: 'STEP',
      stepText: '请处理效果。',
      awaitingPlayerId: match.participants.FIRST.playerId,
    };
    const snapshot = await service.getMatchSnapshot(match.matchId, 'u1');
    expect(snapshot?.playerViewState.match.manualOperation?.canSwitchNow).toBe(false);
    const result = await service.changeManualOperationMode(match.matchId, 'u1', {
      targetMode: 'FREE',
      expectedRevision: snapshot!.seq,
    });
    expect(result?.success).toBe(false);
    expect(result?.error).toContain('卡牌效果');

    state.activeEffect = null;
    expect(match.session.setManualOperationMode('FREE').success).toBe(true);
    const freeState = match.session.state! as unknown as {
      activeEffect: ActiveEffectState | null;
    };
    freeState.activeEffect = {
      id: 'effect-exit',
      abilityId: 'ability-exit',
      sourceCardId: 'source-exit',
      controllerId: match.participants.FIRST.playerId,
      effectText: '测试退出时的效果',
      stepId: 'STEP',
      stepText: '请处理效果。',
      awaitingPlayerId: match.participants.FIRST.playerId,
    };
    const freeSnapshot = await service.getMatchSnapshot(match.matchId, 'u1');
    expect(freeSnapshot?.playerViewState.match.manualOperation).toMatchObject({
      mode: 'FREE',
      canSwitchNow: false,
    });
    const blockedExit = await service.changeManualOperationMode(match.matchId, 'u1', {
      targetMode: 'RULES',
      expectedRevision: freeSnapshot!.seq,
    });
    expect(blockedExit?.success).toBe(false);
    expect(blockedExit?.error).toContain('卡牌效果');
    expect(match.session.manualOperationMode).toBe('FREE');
  });

  it('正式联机不信任客户端 freePlay，只按双方同意后的权威模式放行', async () => {
    const service = new OnlineMatchService({ recorder: null });
    const match = await service.createMatch({
      roomCode: 'MODE05',
      first: { userId: 'u1', displayName: 'Alpha', deck: createDeck('A', 99) },
      second: { userId: 'u2', displayName: 'Beta', deck: createDeck('B', 99) },
    });
    forceMainPhase(match);
    const memberId = match.session.state!.players[0].hand.cardIds.find(
      (cardId) => match.session.state!.cardRegistry.get(cardId)?.data.cardType === CardType.MEMBER
    );
    expect(memberId).toBeTruthy();

    const forged = await service.executeCommand(
      match.matchId,
      'u1',
      createPlayMemberToSlotCommand('ignored', memberId!, SlotPosition.CENTER, {
        freePlay: true,
      })
    );
    expect(forged?.success).toBe(false);
    expect(forged?.error).toContain('能量');

    const snapshot = await service.getMatchSnapshot(match.matchId, 'u1');
    const requested = await service.changeManualOperationMode(match.matchId, 'u1', {
      targetMode: 'FREE',
      expectedRevision: snapshot!.seq,
    });
    const request = requested!.snapshot!.playerViewState.match.manualOperation!.pendingRequest!;
    const acceptedMode = await service.acceptManualOperationModeRequest(
      match.matchId,
      'u2',
      request.requestId,
      { expectedRevision: requested!.snapshot!.seq }
    );
    const played = await service.executeCommand(
      match.matchId,
      'u1',
      createPlayMemberToSlotCommand('ignored', memberId!, SlotPosition.CENTER, {
        freePlay: false,
      })
    );
    expect(acceptedMode?.snapshot?.playerViewState.match.manualOperation?.mode).toBe('FREE');
    expect(played?.success).toBe(true);
  });

  it('联机规则模式拒绝非主要阶段伪造的 END_PHASE', async () => {
    const service = new OnlineMatchService({ recorder: null });
    const match = await createOnlineMatch(service, 'MODE06');
    forceMainPhase(match);
    const state = match.session.state as {
      currentPhase: GamePhase;
      currentSubPhase: SubPhase;
    };
    state.currentPhase = GamePhase.PERFORMANCE_PHASE;
    state.currentSubPhase = SubPhase.PERFORMANCE_JUDGMENT;

    const result = await service.executeCommand(
      match.matchId,
      'u1',
      createEndPhaseCommand('ignored')
    );
    expect(result?.success).toBe(false);
    expect(result?.error).toContain('主要阶段');
  });
});

async function createOnlineMatch(service: OnlineMatchService, roomCode: string) {
  return service.createMatch({
    roomCode,
    first: { userId: 'u1', displayName: 'Alpha', deck: createDeck('A') },
    second: { userId: 'u2', displayName: 'Beta', deck: createDeck('B') },
  });
}

function forceMainPhase(match: OnlineMatchState): void {
  const state = match.session.state as {
    currentPhase: GamePhase;
    currentSubPhase: SubPhase;
    activePlayerIndex: number;
    waitingPlayerId: string | null;
  };
  state.currentPhase = GamePhase.MAIN_PHASE;
  state.currentSubPhase = SubPhase.NONE;
  state.activePlayerIndex = 0;
  state.waitingPlayerId = null;
}

function createDeck(prefix: string, memberCost = 1): DeckConfig {
  const mainDeck: Array<MemberCardData | LiveCardData> = [];
  const energyDeck: EnergyCardData[] = [];
  for (let index = 0; index < 48; index += 1) {
    mainDeck.push({
      cardCode: `${prefix}-MEM-${index}`,
      name: `${prefix} 成员 ${index}`,
      cardType: CardType.MEMBER,
      cost: memberCost,
      blade: 1,
      hearts: [createHeartIcon(HeartColor.PINK, 1)],
    });
  }
  for (let index = 0; index < 12; index += 1) {
    mainDeck.push({
      cardCode: `${prefix}-LIVE-${index}`,
      name: `${prefix} LIVE ${index}`,
      cardType: CardType.LIVE,
      score: 1,
      requirements: createHeartRequirement({ [HeartColor.PINK]: 1 }),
    });
    energyDeck.push({
      cardCode: `${prefix}-ENERGY-${index}`,
      name: `${prefix} 能量 ${index}`,
      cardType: CardType.ENERGY,
    });
  }
  return { mainDeck, energyDeck };
}
