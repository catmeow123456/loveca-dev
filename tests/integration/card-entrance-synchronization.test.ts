import {
  withPublicRevealDwell,
  getPublicRevealAutoAdvanceMetadata,
} from '../../src/application/card-effects/runtime/public-reveal-dwell';
import { describe, expect, it } from 'vitest';
import { createGameSession } from '../../src/application/game-session';
import {
  createPlayMemberToSlotCommand,
  createEndPhaseCommand,
  GameCommandType,
} from '../../src/application/game-commands';
import { createCardInstance, type MemberCardData } from '../../src/domain/entities/card';
import { registerCards, updatePlayer, type GameState } from '../../src/domain/entities/game';
import {
  CardType,
  FaceState,
  OrientationState,
  GamePhase,
  SlotPosition,
  SubPhase,
} from '../../src/shared/types/enums';
import { describeRankedSinglePlayerWait } from '../../src/online/ranked-stall';
import { ENTRANCE_WAIT_LIMIT_MS } from '../../src/shared/card-entrance';

function fixture(mode: 'LOCAL' | 'REMOTE' = 'REMOTE', replacementCost = 6) {
  let now = 1000;
  const session = createGameSession({ cardEntrance: mode, now: () => now });
  session.createGame('entrance-sync', 'p1', 'First', 'p2', 'Second');
  const member = (code: string, cost = 6): MemberCardData => ({
    cardCode: code,
    name: code,
    cardType: CardType.MEMBER,
    cost,
    blade: 1,
    hearts: [],
    groupNames: ['Liella!'],
  });
  const deck = {
    mainDeck: Array.from({ length: 60 }, (_, i) => member(`filler-${i}`)),
    energyDeck: Array.from({ length: 12 }, (_, i) => ({
      cardCode: `energy-${i}`,
      name: 'Energy',
      cardType: CardType.ENERGY as const,
    })),
  };
  session.initializeGame(deck, deck);
  const ren = createCardInstance(member('PL!SP-pb2-005-PP', 20), 'p1', 'ren');
  const replacement = createCardInstance(
    member('replacement', replacementCost),
    'p1',
    'replacement'
  );
  let state = registerCards(session.state!, [ren, replacement]);
  state = updatePlayer(state, 'p1', (p) => ({
    ...p,
    hand: { ...p.hand, cardIds: ['ren'] },
    memberSlots: {
      ...p.memberSlots,
      slots: { ...p.memberSlots.slots, [SlotPosition.CENTER]: 'replacement' },
      cardStates: new Map([
        ['replacement', { face: FaceState.FACE_UP, orientation: OrientationState.ACTIVE }],
      ]),
    },
  }));
  state = {
    ...state,
    currentPhase: GamePhase.MAIN_PHASE,
    currentSubPhase: SubPhase.NONE,
    waitingForInput: false,
    waitingPlayerId: null,
    activePlayerIndex: 0,
    manualOperationMode: 'FREE',
  };
  (session as unknown as { authorityState: GameState }).authorityState = state;
  const play = () =>
    session.executeCommand(
      createPlayMemberToSlotCommand('p1', 'ren', SlotPosition.CENTER, {
        relayMode: 'SINGLE',
        relayReplacementSlots: [SlotPosition.CENTER],
      })
    );
  const ack = (playerId: string, entranceId = session.state!.entranceRuntime!.pending!.id) =>
    session.executeCommand({
      type: GameCommandType.ACK_CARD_ENTRANCE,
      playerId,
      entranceId,
      timestamp: now,
    });
  return {
    session,
    play,
    ack,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe('authority entrance barrier with real Ren relay ability', () => {
  it('defers automatic ability and exposes the same public barrier to both players', () => {
    const { session, play, ack } = fixture();
    expect(play().success).toBe(true);
    expect(session.state!.players[0].memberSlots.slots.CENTER).toBe('ren');
    expect(session.state!.players[0].waitingRoom.cardIds).toContain('replacement');
    expect(session.state!.players[0].memberSlots.memberBelow.CENTER).toEqual([]);
    expect(session.state!.pendingAbilities.length).toBeGreaterThan(0);
    expect(session.state!.activeEffect).toBeNull();
    const first = session.getPlayerViewState('p1')!;
    const second = session.getPlayerViewState('p2')!;
    expect(first.match.entrance).toEqual(second.match.entrance);
    expect(first.match.entrance?.objectIds).toEqual(['obj_ren']);
    expect(describeRankedSinglePlayerWait(session.state!)).toBeNull();
    expect(session.executeCommand(createEndPhaseCommand('p1')).success).toBe(false);
    expect(session.undoLastStep().success).toBe(false);
    expect(ack('p1').success).toBe(true); // disabled / skipped / completed all use same acknowledgment
    expect(session.state!.entranceRuntime!.pending!.waitingPlayerIds).toEqual(['p2']);
    expect(session.state!.players[0].waitingRoom.cardIds).toContain('replacement');
    expect(ack('p1').success).toBe(true); // duplicate cannot acknowledge the other seat
    expect(session.state!.entranceRuntime!.pending!.waitingPlayerIds).toEqual(['p2']);
    expect(ack('p2').success).toBe(true);
    expect(session.state!.entranceRuntime!.pending).toBeNull();
    expect(session.state!.players[0].memberSlots.memberBelow.CENTER).toContain('replacement');
    expect(session.state!.players[0].waitingRoom.cardIds).not.toContain('replacement');
  });
  it('rejects unknown participants/stale tokens without releasing the barrier', () => {
    const { session, play, ack } = fixture();
    play();
    expect(ack('p1', 'stale').success).toBe(false);
    expect(ack('outsider').success).toBe(false);
    expect(session.state!.entranceRuntime!.pending!.waitingPlayerIds).toEqual(['p1', 'p2']);
  });
  it('expires using the authority clock even if neither browser reports completion', () => {
    const { session, play, advance } = fixture();
    play();
    advance(ENTRANCE_WAIT_LIMIT_MS - 1);
    expect(session.expireCardEntrance()).toBe(false);
    advance(1);
    expect(session.expireCardEntrance()).toBe(true);
    expect(session.state!.players[0].memberSlots.memberBelow.CENTER).toContain('replacement');
    expect(session.expireCardEntrance()).toBe(false);
  });
  it('local/solitaire needs only one viewer completion', () => {
    const { session, play, ack } = fixture('LOCAL');
    play();
    ack('p1');
    expect(session.state!.entranceRuntime!.pending).toBeNull();
    expect(session.state!.players[0].memberSlots.memberBelow.CENTER).toContain('replacement');
  });
  it('does not create an entrance for a failed play', () => {
    const { session, play } = fixture();
    session.setManualOperationMode('RULES');
    expect(play().success).toBe(false);
    expect(session.state!.entranceRuntime!.pending).toBeNull();
  });
  it('recovery keeps the bounded current barrier and cannot replay settled history', () => {
    const { session, play, ack, advance } = fixture();
    play();
    const pending = session.state!.entranceRuntime!.pending!;
    session.restoreRuntimeState({
      authorityState: session.state!,
      currentPublicSeq: session.getCurrentPublicEventSeq(),
    });
    expect(session.state!.entranceRuntime!.pending).toEqual(pending);
    advance(ENTRANCE_WAIT_LIMIT_MS);
    session.expireCardEntrance();
    expect(ack('p1', pending.id).success).toBe(false);
    expect(session.state!.entranceRuntime!.pending).toBeNull();
  });
  it('undo then replay creates a new barrier and rejects completion from the previous play', () => {
    const { session, play, ack } = fixture('LOCAL');
    play();
    const old = session.state!.entranceRuntime!.pending!.id;
    ack('p1');
    expect(session.undoLastStep().success).toBe(true);
    expect(play().success).toBe(true);
    expect(session.state!.entranceRuntime!.pending!.id).not.toBe(old);
    expect(ack('p1', old).success).toBe(false);
  });
  it('pays the full legal energy cost before waiting and never pays it again on completion', () => {
    const { session, play, ack } = fixture('REMOTE', 17);
    expect(session.setManualOperationMode('RULES').success).toBe(true);
    expect(play().success).toBe(true);
    const energy = session.state!.players[0].energyZone;
    expect(energy.cardIds).toHaveLength(3);
    expect(
      energy.cardIds.every(
        (id) => energy.cardStates.get(id)?.orientation === OrientationState.WAITING
      )
    ).toBe(true);
    expect(session.state!.entranceRuntime!.pending).not.toBeNull();
    ack('p1');
    ack('p2');
    expect(session.state!.players[0].energyZone).toEqual(energy);
    expect(session.state!.players[0].memberSlots.memberBelow.CENTER).toContain('replacement');
  });

  it('starts the following public reveal reading deadline after the barrier, not during it', () => {
    const { session, play, ack, advance } = fixture();
    play();
    const state = session.state!;
    const effect = withPublicRevealDwell(
      {
        id: 'following-reveal',
        abilityId: state.pendingAbilities[0]!.abilityId,
        sourceCardId: 'ren',
        controllerId: 'p1',
        effectText: '公开结果',
        stepText: '公开结果',
        stepId: 'next-step',
        awaitingPlayerId: 'p1',
      },
      ['ren']
    );
    (session as unknown as { authorityState: GameState }).authorityState = {
      ...state,
      activeEffect: effect,
    };
    ack('p1');
    expect(getPublicRevealAutoAdvanceMetadata(session.state!.activeEffect)).toBeNull();
    advance(4000);
    ack('p2');
    expect(getPublicRevealAutoAdvanceMetadata(session.state!.activeEffect)?.autoAdvanceAt).toBe(
      7000
    );
  });
  it('surrender cancels the pending presentation instead of resuming its ability', () => {
    const { session, play } = fixture();
    play();
    expect(
      session.executeCommand({ type: GameCommandType.SURRENDER, playerId: 'p1', timestamp: 1000 })
        .success
    ).toBe(true);
    expect(session.state!.isEnded).toBe(true);
    expect(session.state!.entranceRuntime!.pending).toBeNull();
    expect(session.getPlayerViewState('p2')!.match.entrance).toBeUndefined();
  });
});

it('platform disable resumes the real pending effect once, rejects old ACK and reenable does not replay', () => {
  const { session, play, ack } = fixture();
  play();
  const pending = session.state!.entranceRuntime!.pending!;
  expect(session.setCardEntranceEnabled(false)).toBe(true);
  expect(session.state!.entranceRuntime!.pending).toBeNull();
  expect(session.state!.entranceRuntime!.disabled).toBe(true);
  expect(session.state!.players[0].memberSlots.memberBelow.CENTER).toEqual(['replacement']);
  const after = session.state;
  expect(session.setCardEntranceEnabled(false)).toBe(false);
  expect(session.state).toBe(after);
  expect(ack('p1', pending.id).success).toBe(false);
  expect(session.setCardEntranceEnabled(true)).toBe(true);
  expect(session.state!.entranceRuntime!.pending).toBeNull();
});
it('disabled entrances still pay and resolve effects without a wait', () => {
  const { session, play } = fixture();
  session.setCardEntranceEnabled(false);
  play();
  expect(session.state!.entranceRuntime!.pending).toBeNull();
  expect(session.getPlayerViewState('p1')!.match.cardEntranceEnabled).toBe(false);
  expect(session.state!.players[0].memberSlots.memberBelow.CENTER).toEqual(['replacement']);
});

it('undo does not undo platform policy and replay stays disabled', () => {
  const { session, play } = fixture();
  play();
  session.setCardEntranceEnabled(false);
  expect(session.undoLastStep().success).toBe(true);
  expect(session.state!.entranceRuntime!.disabled).toBe(true);
  play();
  expect(session.state!.entranceRuntime!.pending).toBeNull();
});
