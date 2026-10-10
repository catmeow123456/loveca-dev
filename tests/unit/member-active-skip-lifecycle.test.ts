import { afterEach, describe, expect, it, vi } from 'vitest';
import { GameService } from '../../src/application/game-service';
import { createGameSession } from '../../src/application/game-session';
import { GameActionType, createPlayMemberAction } from '../../src/application/actions';
import { createMoveTableCardCommand } from '../../src/application/game-commands';
import * as actionHandlers from '../../src/application/action-handlers';
import { enqueueTriggeredCardEffects } from '../../src/application/card-effect-runner';
import { sendStageMemberToWaitingRoomAndEnqueueLeaveStageTriggers } from '../../src/application/card-effects/runtime/leave-stage-triggers';
import { removeTargetMemberBoundLiveModifiersForLeaveStageEvents } from '../../src/application/card-effects/runtime/target-member-bound-live-modifiers';
import {
  clearPreviousStageMemberInstanceState,
  playMembersFromWaitingRoomToEmptySlots,
  setMemberOrientation,
} from '../../src/application/effects/member-state';
import { createCardInstance, type MemberCardData } from '../../src/domain/entities/card';
import {
  createGameState,
  emitGameEvent,
  registerCards,
  updatePlayer,
  type GameState,
} from '../../src/domain/entities/game';
import { addCardToStatefulZone, placeCardInSlot } from '../../src/domain/entities/zone';
import { createEnterStageEvent, createLeaveStageEvent } from '../../src/domain/events/game-events';
import {
  addMemberActivePhaseSkip,
  removeMemberActivePhaseSkipsForMembers,
} from '../../src/domain/rules/member-active-skips';
import {
  CardType,
  GamePhase,
  OrientationState,
  SlotPosition,
  SubPhase,
  TriggerCondition,
  ZoneType,
} from '../../src/shared/types/enums';

const P1 = 'p1',
  P2 = 'p2';
function setup() {
  const data = (code: string): MemberCardData => ({
    cardCode: code,
    name: code,
    cardType: CardType.MEMBER,
    cost: 1,
    blade: 0,
    hearts: [],
  });
  const old = createCardInstance(data('OLD'), P1, 'old');
  const next = createCardInstance(data('NEXT'), P1, 'next');
  const deck = createCardInstance(data('DECK'), P1, 'deck');
  const energy = createCardInstance(
    { cardCode: 'ENERGY', name: 'E', cardType: CardType.ENERGY },
    P1,
    'energy'
  );
  let game = registerCards(createGameState('skip-lifecycle', P1, 'P1', P2, 'P2'), [
    old,
    next,
    deck,
    energy,
  ]);
  game = updatePlayer(game, P1, (p) => ({
    ...p,
    memberSlots: placeCardInSlot(p.memberSlots, SlotPosition.CENTER, old.instanceId),
    hand: { ...p.hand, cardIds: [next.instanceId] },
    mainDeck: { ...p.mainDeck, cardIds: [deck.instanceId] },
    energyZone: addCardToStatefulZone(p.energyZone, energy.instanceId),
  }));
  game = { ...game, currentPhase: GamePhase.MAIN_PHASE, currentSubPhase: SubPhase.NONE };
  game = addMemberActivePhaseSkip(game, {
    playerId: P1,
    memberCardId: old.instanceId,
    sourceCardId: 'icy',
    abilityId: 'wait-two',
  });
  game = addMemberActivePhaseSkip(game, {
    playerId: P2,
    memberCardId: 'opponent',
    sourceCardId: 'icy',
    abilityId: 'wait-two',
  });
  return { game, old, next };
}

afterEach(() => vi.restoreAllMocks());

describe('member Active Phase skip target lifecycle', () => {
  it('clears a normally relayed member while preserving other players markers', () => {
    const scenario = setup();
    const result = new GameService().processAction(
      scenario.game,
      createPlayMemberAction(P1, scenario.next.instanceId, SlotPosition.CENTER)
    );
    expect(result.success, result.error).toBe(true);
    expect(result.gameState.players[0]!.memberSlots.slots[SlotPosition.CENTER]).toBe(
      scenario.next.instanceId
    );
    expect(result.gameState.memberActivePhaseSkips.map((s) => s.memberCardId)).toEqual([
      'opponent',
    ]);
  });

  it('clears a FREE zone departure and does not restore it on same-ID entry, while slot movement keeps it', () => {
    const scenario = setup();
    const session = createGameSession();
    session.createGame(scenario.game.id, P1, 'P1', P2, 'P2');
    (session as unknown as { authorityState: GameState }).authorityState = scenario.game;
    expect(session.setManualOperationMode('FREE').success).toBe(true);
    const slot = session.executeCommand(
      createMoveTableCardCommand(
        P1,
        scenario.old.instanceId,
        ZoneType.MEMBER_SLOT,
        ZoneType.MEMBER_SLOT,
        { sourceSlot: SlotPosition.CENTER, targetSlot: SlotPosition.LEFT }
      )
    );
    expect(slot.success, slot.error).toBe(true);
    expect(session.state!.memberActivePhaseSkips.map((s) => s.memberCardId)).toContain(
      scenario.old.instanceId
    );
    const leave = session.executeCommand(
      createMoveTableCardCommand(
        P1,
        scenario.old.instanceId,
        ZoneType.MEMBER_SLOT,
        ZoneType.WAITING_ROOM,
        { sourceSlot: SlotPosition.LEFT }
      )
    );
    expect(leave.success, leave.error).toBe(true);
    expect(session.state!.memberActivePhaseSkips.map((s) => s.memberCardId)).not.toContain(
      scenario.old.instanceId
    );
    expect(session.state!.players[0]!.waitingRoom.cardIds).toContain(scenario.old.instanceId);
    const enter = session.executeCommand(
      createMoveTableCardCommand(
        P1,
        scenario.old.instanceId,
        ZoneType.WAITING_ROOM,
        ZoneType.MEMBER_SLOT,
        { targetSlot: SlotPosition.CENTER }
      )
    );
    expect(enter.success, enter.error).toBe(true);
    expect(session.state!.memberActivePhaseSkips.map((s) => s.memberCardId)).not.toContain(
      scenario.old.instanceId
    );
  });

  it('clears an immediate card-effect departure without requiring a Live modifier', () => {
    const scenario = setup();
    const left = sendStageMemberToWaitingRoomAndEnqueueLeaveStageTriggers(
      scenario.game,
      P1,
      scenario.old.instanceId,
      enqueueTriggeredCardEffects
    )!;
    expect(left).not.toBeNull();
    expect(left.gameState.players[0]!.waitingRoom.cardIds).toContain(scenario.old.instanceId);
    expect(left.gameState.memberActivePhaseSkips.map((s) => s.memberCardId)).toEqual(['opponent']);
    const entered = playMembersFromWaitingRoomToEmptySlots(left.gameState, P1, [
      { cardId: scenario.old.instanceId, toSlot: SlotPosition.CENTER },
    ])!;
    expect(entered.gameState.memberActivePhaseSkips.map((s) => s.memberCardId)).toEqual([
      'opponent',
    ]);
  });

  it('clears a previous instance before the narrow self-send/re-entry continuation', () => {
    const scenario = setup();
    const cleared = clearPreviousStageMemberInstanceState(
      scenario.game,
      P1,
      scenario.old.instanceId
    );
    expect(cleared.memberActivePhaseSkips.map((s) => s.memberCardId)).toEqual(['opponent']);
    expect(removeMemberActivePhaseSkipsForMembers(cleared, [])).toBe(cleared);
  });

  it('does not reapply historical leave events to a reentered object with a fresh marker', () => {
    const scenario = setup();
    const event = createLeaveStageEvent(
      scenario.old.instanceId,
      SlotPosition.CENTER,
      ZoneType.WAITING_ROOM,
      P1,
      P1
    );
    let game = emitGameEvent(scenario.game, event);
    game = clearPreviousStageMemberInstanceState(game, P1, scenario.old.instanceId);
    game = emitGameEvent(
      game,
      createEnterStageEvent(
        scenario.old.instanceId,
        ZoneType.WAITING_ROOM,
        SlotPosition.CENTER,
        P1,
        P1
      )
    );
    game = addMemberActivePhaseSkip(game, {
      playerId: P1,
      memberCardId: scenario.old.instanceId,
      sourceCardId: 'icy',
      abilityId: 'wait-two',
    });
    const before = game.memberActivePhaseSkips;
    const repeated = removeTargetMemberBoundLiveModifiersForLeaveStageEvents(game, [event]);
    expect(repeated.memberActivePhaseSkips).toEqual(before);
    expect(
      removeMemberActivePhaseSkipsForMembers(
        repeated,
        [scenario.old.instanceId],
        scenario.game.memberActivePhaseSkips
      ).memberActivePhaseSkips
    ).toEqual(before);
  });

  it('preserves a new marker produced after same-action departure and reentry through late service and runner cleanup', () => {
    const scenario = setup();
    vi.spyOn(actionHandlers, 'getActionHandler').mockReturnValueOnce((game) => {
      const leave = sendStageMemberToWaitingRoomAndEnqueueLeaveStageTriggers(
        game,
        P1,
        scenario.old.instanceId,
        enqueueTriggeredCardEffects
      )!;
      const cleared = clearPreviousStageMemberInstanceState(
        leave.gameState,
        P1,
        scenario.old.instanceId
      );
      const entered = playMembersFromWaitingRoomToEmptySlots(cleared, P1, [
        { cardId: scenario.old.instanceId, toSlot: SlotPosition.CENTER },
      ])!;
      const waited = setMemberOrientation(
        entered.gameState,
        P1,
        scenario.old.instanceId,
        OrientationState.WAITING
      )!;
      const marked = addMemberActivePhaseSkip(waited.gameState, {
        playerId: P1,
        memberCardId: scenario.old.instanceId,
        sourceCardId: 'icy',
        abilityId: 'wait-two',
      });
      return {
        success: true,
        gameState: marked,
        triggeredEvents: [TriggerCondition.ON_LEAVE_STAGE],
      };
    });
    const result = new GameService().processAction(scenario.game, {
      type: GameActionType.TAP_MEMBER,
      playerId: P1,
      cardId: scenario.old.instanceId,
      timestamp: Date.now(),
    });
    expect(result.success, result.error).toBe(true);
    expect(result.gameState.memberActivePhaseSkips.map((s) => s.memberCardId)).toEqual([
      'opponent',
      scenario.old.instanceId,
    ]);
    expect(
      result.gameState.memberActivePhaseSkips.find(
        (s) => s.memberCardId === scenario.old.instanceId
      )
    ).not.toBe(scenario.game.memberActivePhaseSkips[0]);
  });
});
