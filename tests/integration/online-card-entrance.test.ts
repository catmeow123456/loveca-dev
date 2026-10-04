import { createCardInstance } from '../../src/domain/entities/card';
import { registerCards, updatePlayer, type GameState } from '../../src/domain/entities/game';
import {
  createPlayMemberToSlotCommand,
  GameCommandType,
} from '../../src/application/game-commands';
import { SlotPosition, FaceState, OrientationState } from '../../src/shared/types/enums';
import { ENTRANCE_WAIT_LIMIT_MS } from '../../src/shared/card-entrance';
import { describe, expect, it, vi } from 'vitest';
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

async function prepareEntrance(service: OnlineMatchService) {
  const match = await createMatch(service);
  forceMainPhase(match);
  const playerId = match.participants.FIRST.playerId;
  const ren = createCardInstance(
    { ...createMember('PL!SP-pb2-005-PP'), cost: 20, groupNames: ['Liella!'] },
    playerId,
    'ren'
  );
  const relay = createCardInstance(
    { ...createMember('filler'), groupNames: ['Liella!'] },
    playerId,
    'relay'
  );
  let state = registerCards(match.session.state!, [ren, relay]);
  state = updatePlayer(state, playerId, (p) => ({
    ...p,
    hand: { ...p.hand, cardIds: ['ren'] },
    memberSlots: {
      ...p.memberSlots,
      slots: { ...p.memberSlots.slots, [SlotPosition.CENTER]: 'relay' },
      cardStates: new Map([
        ['relay', { face: FaceState.FACE_UP, orientation: OrientationState.ACTIVE }],
      ]),
    },
  }));
  (match.session as unknown as { authorityState: GameState }).authorityState = {
    ...state,
    manualOperationMode: 'FREE',
  };
  const play = await service.executeCommand(
    match.matchId,
    FIRST_USER_ID,
    createPlayMemberToSlotCommand('ignored', 'ren', SlotPosition.CENTER, {
      relayMode: 'SINGLE',
      relayReplacementSlots: [SlotPosition.CENTER],
    })
  );
  expect(play?.success).toBe(true);
  return match;
}
describe('online entrance synchronization', () => {
  it('uses authenticated seats, snapshot revisions and resumes the ranked clock only after both acknowledgments', async () => {
    let now = 10000;
    const service = new OnlineMatchService({ now: () => now, recorder: null });
    const match = await prepareEntrance(service);
    const first = await readFullSnapshot(service, match, FIRST_USER_ID);
    const second = await readFullSnapshot(service, match, SECOND_USER_ID);
    expect(first.playerViewState.match.entrance).toEqual(second.playerViewState.match.entrance);
    expect(first.playerViewState.match.rankedStall).toBeUndefined();
    const entranceId = first.playerViewState.match.entrance!.id;
    const ack = {
      type: GameCommandType.ACK_CARD_ENTRANCE as const,
      playerId: match.participants.SECOND.playerId,
      entranceId,
      timestamp: now,
    };
    const previousRevision = match.remoteRevision;
    expect((await service.executeCommand(match.matchId, FIRST_USER_ID, ack))?.success).toBe(true);
    expect(match.remoteRevision).toBeGreaterThan(previousRevision);
    expect(match.session.state!.entranceRuntime!.pending!.waitingPlayerIds).toEqual([
      match.participants.SECOND.playerId,
    ]);
    expect(await service.executeCommand(match.matchId, 'outsider', ack)).toBeNull();
    expect(service.getRankedStallTimeoutCandidate(match.matchId, now + 1000000)).toBeNull();
    now += 3000;
    expect((await service.executeCommand(match.matchId, SECOND_USER_ID, ack))?.success).toBe(true);
    const after = await readFullSnapshot(service, match);
    expect(after.playerViewState.match.entrance).toBeUndefined();
    expect(after.playerViewState.match.rankedStall?.startedAt).toBe(now);
    expect(match.session.state!.players[0].memberSlots.memberBelow.CENTER).toEqual(['relay']);
  });
  it('snapshot polling recovers an expired barrier without a browser completion command', async () => {
    let now = 10000;
    const service = new OnlineMatchService({ now: () => now, recorder: null });
    const match = await prepareEntrance(service);
    const revision = match.remoteRevision;
    now += ENTRANCE_WAIT_LIMIT_MS;
    const snapshot = await service.getMatchSnapshot(match.matchId, SECOND_USER_ID, {
      sinceSeq: revision,
    });
    expect(snapshot).toHaveProperty('playerViewState');
    expect(match.remoteRevision).toBeGreaterThan(revision);
    expect(match.session.state!.entranceRuntime!.pending).toBeNull();
    expect(match.session.state!.players[0].memberSlots.memberBelow.CENTER).toEqual(['relay']);
  });
  it('maintenance recovers even when neither participant polls', async () => {
    let now = 10000;
    const service = new OnlineMatchService({ now: () => now, recorder: null });
    const match = await prepareEntrance(service);
    now += ENTRANCE_WAIT_LIMIT_MS;
    await service.cleanupExpiredMatches(new Set([match.matchId]), now);
    expect(match.session.state!.entranceRuntime!.pending).toBeNull();
    expect(match.session.state!.players[0].memberSlots.memberBelow.CENTER).toEqual(['relay']);
  });
  it('server timer resumes without snapshots or maintenance', async () => {
    vi.useFakeTimers();
    try {
      let now = 10000;
      const service = new OnlineMatchService({ now: () => now, recorder: null });
      const match = await prepareEntrance(service);
      now += ENTRANCE_WAIT_LIMIT_MS;
      await vi.advanceTimersByTimeAsync(ENTRANCE_WAIT_LIMIT_MS);
      expect(match.session.state!.entranceRuntime!.pending).toBeNull();
      expect(match.session.state!.players[0].memberSlots.memberBelow.CENTER).toEqual(['relay']);
    } finally {
      vi.useRealTimers();
    }
  });
});
