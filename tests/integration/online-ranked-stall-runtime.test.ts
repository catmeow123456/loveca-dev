import { describe, expect, it } from 'vitest';
import {
  createDrawCardToHandCommand,
  createEndPhaseCommand,
} from '../../src/application/game-commands';
import type { DeckConfig } from '../../src/application/game-service';
import {
  createHeartIcon,
  createHeartRequirement,
  type EnergyCardData,
  type LiveCardData,
  type MemberCardData,
} from '../../src/domain/entities/card';
import type { MatchOriginKind } from '../../src/online/replay-types';
import {
  OnlineMatchService,
  type OnlineMatchState,
} from '../../src/server/services/online-match-service';
import { CardType, GamePhase, HeartColor, SubPhase } from '../../src/shared/types/enums';

const FIRST_USER_ID = 'ranked-stall-first-user';
const SECOND_USER_ID = 'ranked-stall-second-user';
const TEST_POINT_VALIDATION = {
  pointTableVersion: 'ranked-stall-test',
  pointTotal: 0,
  pointLimit: 9,
} as const;

function createMember(cardCode: string): MemberCardData {
  return {
    cardCode,
    name: cardCode,
    cardType: CardType.MEMBER,
    cost: 1,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
  };
}

function createLive(cardCode: string): LiveCardData {
  return {
    cardCode,
    name: cardCode,
    cardType: CardType.LIVE,
    score: 1,
    requirements: createHeartRequirement({ [HeartColor.PINK]: 1 }),
  };
}

function createEnergy(cardCode: string): EnergyCardData {
  return {
    cardCode,
    name: cardCode,
    cardType: CardType.ENERGY,
  };
}

function createDeck(prefix: string): DeckConfig {
  return {
    mainDeck: [
      ...Array.from({ length: 48 }, (_, index) => createMember(`${prefix}-member-${index}`)),
      ...Array.from({ length: 12 }, (_, index) => createLive(`${prefix}-live-${index}`)),
    ],
    energyDeck: Array.from({ length: 12 }, (_, index) => createEnergy(`${prefix}-energy-${index}`)),
  };
}

async function createMatch(
  service: OnlineMatchService,
  originKind: MatchOriginKind = 'RANKED',
  battleTimeouts?: {
    readonly playerActionTimeoutSeconds: number;
    readonly reconnectGracePeriodSeconds: number;
  }
): Promise<OnlineMatchState> {
  return service.createMatch({
    roomCode: `stall-${originKind}`,
    matchMode: 'ONLINE',
    originKind,
    originLabel: originKind === 'RANKED' ? '赛季排位' : '普通联机房间',
    battleTimeouts,
    first: {
      userId: FIRST_USER_ID,
      displayName: '先攻玩家',
      deck: createDeck('first'),
      pointValidation: TEST_POINT_VALIDATION,
    },
    second: {
      userId: SECOND_USER_ID,
      displayName: '后攻玩家',
      deck: createDeck('second'),
      pointValidation: TEST_POINT_VALIDATION,
    },
  });
}

function forceMainPhase(match: OnlineMatchState, actingSeat: 'FIRST' | 'SECOND' = 'FIRST'): void {
  const state = match.session.state;
  if (!state) throw new Error('missing game state');
  const mutable = state as unknown as {
    currentPhase: GamePhase;
    currentSubPhase: SubPhase;
    activePlayerIndex: number;
    waitingForInput: boolean;
    waitingPlayerId: string | null;
    pendingAbilities: unknown[];
    pendingChoice: null;
    activeEffect: null;
    pendingCostPayment: null;
    pendingSpecialMemberPlay: null;
    inspectionContext: null;
    manualOperationMode: 'RULES' | 'FREE';
  };
  mutable.currentPhase = GamePhase.MAIN_PHASE;
  mutable.currentSubPhase = SubPhase.NONE;
  mutable.activePlayerIndex = actingSeat === 'FIRST' ? 0 : 1;
  mutable.waitingForInput = false;
  mutable.waitingPlayerId = null;
  mutable.pendingAbilities = [];
  mutable.pendingChoice = null;
  mutable.activeEffect = null;
  mutable.pendingCostPayment = null;
  mutable.pendingSpecialMemberPlay = null;
  mutable.inspectionContext = null;
  mutable.manualOperationMode = 'RULES';
}

async function readFullSnapshot(
  service: OnlineMatchService,
  match: OnlineMatchState,
  userId = FIRST_USER_ID
) {
  const snapshot = await service.getMatchSnapshot(match.matchId, userId);
  if (!snapshot || !('playerViewState' in snapshot)) {
    throw new Error('missing full snapshot');
  }
  return snapshot;
}

describe('排位单一责任玩家停滞运行态', () => {
  it('投影双方可见的责任席位与截止时间，轮询和被拒命令不复位', async () => {
    let now = 10_000;
    const service = new OnlineMatchService({ now: () => now, recorder: null });
    const match = await createMatch(service);
    forceMainPhase(match, 'FIRST');

    const firstSnapshot = await readFullSnapshot(service, match, FIRST_USER_ID);
    const secondSnapshot = await readFullSnapshot(service, match, SECOND_USER_ID);
    expect(firstSnapshot.playerViewState.match.rankedStall).toEqual({
      responsibleSeat: 'FIRST',
      startedAt: 10_000,
      deadlineAt: 190_000,
    });
    expect(secondSnapshot.playerViewState.match.rankedStall).toEqual(
      firstSnapshot.playerViewState.match.rankedStall
    );

    now += 30_000;
    const unchanged = await service.getMatchSnapshot(match.matchId, FIRST_USER_ID, {
      sinceSeq: match.remoteRevision,
    });
    expect(unchanged).toMatchObject({ modified: false });

    const rejected = await service.executeCommand(
      match.matchId,
      SECOND_USER_ID,
      createEndPhaseCommand('ignored')
    );
    expect(rejected?.success).toBe(false);
    expect(
      (await readFullSnapshot(service, match)).playerViewState.match.rankedStall?.deadlineAt
    ).toBe(190_000);
  });

  it('按对局创建时快照的全局配置计算操作截止时间', async () => {
    const service = new OnlineMatchService({ now: () => 15_000, recorder: null });
    const match = await createMatch(service, 'RANKED', {
      playerActionTimeoutSeconds: 90,
      reconnectGracePeriodSeconds: 30,
    });
    forceMainPhase(match, 'FIRST');

    const snapshot = await readFullSnapshot(service, match);

    expect(match.battleTimeouts).toEqual({
      playerActionTimeoutSeconds: 90,
      reconnectGracePeriodSeconds: 30,
    });
    expect(snapshot.playerViewState.match.rankedStall).toEqual({
      responsibleSeat: 'FIRST',
      startedAt: 15_000,
      deadlineAt: 105_000,
    });
  });

  it('责任玩家每次被接受的命令都会取得完整新期限并提升代际', async () => {
    let now = 20_000;
    const service = new OnlineMatchService({ now: () => now, recorder: null });
    const match = await createMatch(service);
    forceMainPhase(match, 'FIRST');
    (match.session.state as unknown as { manualOperationMode: 'FREE' }).manualOperationMode =
      'FREE';
    await readFullSnapshot(service, match);
    const firstGeneration = match.rankedStallRuntime?.generation;

    now += 45_000;
    const accepted = await service.executeCommand(
      match.matchId,
      FIRST_USER_ID,
      createDrawCardToHandCommand('ignored')
    );
    expect(accepted?.success).toBe(true);
    expect(match.rankedStallRuntime).toMatchObject({
      playerId: match.participants.FIRST.playerId,
      startedAt: now,
      deadlineAt: now + 180_000,
    });
    expect(match.rankedStallRuntime!.generation).toBeGreaterThan(firstGeneration ?? 0);
  });

  it('等待窗口切换玩家后旧代际失效，只有当前到期窗口可成为裁定候选', async () => {
    let now = 30_000;
    const service = new OnlineMatchService({ now: () => now, recorder: null });
    const match = await createMatch(service);
    forceMainPhase(match, 'FIRST');
    await readFullSnapshot(service, match);
    const oldCandidateShape = { ...match.rankedStallRuntime! };

    now += 60_000;
    forceMainPhase(match, 'SECOND');
    await readFullSnapshot(service, match, SECOND_USER_ID);
    expect(match.rankedStallRuntime).toMatchObject({
      playerId: match.participants.SECOND.playerId,
      deadlineAt: now + 180_000,
    });
    expect(match.rankedStallRuntime?.generation).toBeGreaterThan(oldCandidateShape.generation);

    now = match.rankedStallRuntime!.deadlineAt - 1;
    expect(service.getRankedStallTimeoutCandidate(match.matchId, now)).toBeNull();
    now += 1;
    expect(service.getRankedStallTimeoutCandidate(match.matchId, now)).toMatchObject({
      playerId: match.participants.SECOND.playerId,
      generation: match.rankedStallRuntime?.generation,
    });
  });

  it('恢复时缺少非持久化运行态会从恢复时刻给予完整新期限', async () => {
    let now = 40_000;
    const originalService = new OnlineMatchService({ now: () => now, recorder: null });
    const match = await createMatch(originalService);
    forceMainPhase(match, 'FIRST');
    await readFullSnapshot(originalService, match);
    const oldDeadline = match.rankedStallRuntime?.deadlineAt;

    now += 80_000;
    delete match.rankedStallRuntime;
    delete match.rankedStallGeneration;
    const restoredService = new OnlineMatchService({ now: () => now, recorder: null });
    await restoredService.restoreMatch(match);
    const restored = await readFullSnapshot(restoredService, match);
    expect(restored.playerViewState.match.rankedStall?.deadlineAt).toBe(now + 180_000);
    expect(restored.playerViewState.match.rankedStall?.deadlineAt).not.toBe(oldDeadline);
  });

  it('非排位联机不创建停滞运行态或投影', async () => {
    const service = new OnlineMatchService({ now: () => 50_000, recorder: null });
    const match = await createMatch(service, 'ONLINE_ROOM');
    forceMainPhase(match, 'FIRST');
    const snapshot = await readFullSnapshot(service, match);
    expect(match.rankedStallRuntime).toBeNull();
    expect(snapshot.playerViewState.match.rankedStall).toBeUndefined();
    expect(service.getRankedStallTimeoutCandidate(match.matchId, 999_999)).toBeNull();
  });
});
