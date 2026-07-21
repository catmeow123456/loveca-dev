import { describe, expect, it } from 'vitest';
import type { LiveCardData, MemberCardData } from '../../src/domain/entities/card';
import {
  createCardInstance,
  createHeartIcon,
  createHeartRequirement,
} from '../../src/domain/entities/card';
import { createGameState, registerCards, updatePlayer } from '../../src/domain/entities/game';
import { placeCardInSlot, removeCardFromSlot } from '../../src/domain/entities/zone';
import { isPlayerLiveProhibited } from '../../src/domain/rules/live-prohibitions';
import {
  createConfirmSubPhaseAction,
  createSetLiveCardAction,
} from '../../src/application/actions';
import { GameService } from '../../src/application/game-service';
import {
  CardType,
  GamePhase,
  HeartColor,
  SlotPosition,
  SubPhase,
  TriggerCondition,
} from '../../src/shared/types/enums';

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';

function createMember(cardCode: string): MemberCardData {
  return {
    cardCode,
    name: cardCode,
    cardType: CardType.MEMBER,
    cost: 9,
    blade: 3,
    hearts: [createHeartIcon(HeartColor.PURPLE, 3)],
  };
}

function createLive(cardCode: string): LiveCardData {
  return {
    cardCode,
    name: cardCode,
    cardType: CardType.LIVE,
    score: 2,
    requirements: createHeartRequirement({ [HeartColor.PURPLE]: 1 }),
  };
}

function setupLiveSet(options: { readonly withOtherMember?: boolean } = {}) {
  const source = createCardInstance(createMember('PL!SP-bp1-001-P'), PLAYER1, 'kanon-001');
  const other = createCardInstance(createMember('PL!SP-test-other'), PLAYER1, 'other-member');
  const live1 = createCardInstance(createLive('PL!SP-test-live-1'), PLAYER1, 'live-1');
  const live2 = createCardInstance(createLive('PL!SP-test-live-2'), PLAYER1, 'live-2');
  const opponentLive = createCardInstance(
    createLive('PL!SP-test-opponent-live'),
    PLAYER2,
    'opponent-live'
  );
  const drawCards = Array.from({ length: 6 }, (_, index) =>
    createCardInstance(createMember(`DRAW-${index}`), PLAYER1, `draw-${index}`)
  );
  const opponentDraw = createCardInstance(createMember('OPPONENT-DRAW'), PLAYER2, 'opponent-draw');
  let game = registerCards(createGameState('sp-bp1-001-live-set', PLAYER1, 'P1', PLAYER2, 'P2'), [
    source,
    other,
    live1,
    live2,
    opponentLive,
    ...drawCards,
    opponentDraw,
  ]);
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    hand: { ...player.hand, cardIds: [live1.instanceId, live2.instanceId] },
    mainDeck: { ...player.mainDeck, cardIds: drawCards.map((card) => card.instanceId) },
    memberSlots: placeCardInSlot(
      options.withOtherMember
        ? placeCardInSlot(player.memberSlots, SlotPosition.LEFT, other.instanceId)
        : player.memberSlots,
      SlotPosition.CENTER,
      source.instanceId
    ),
  }));
  game = updatePlayer(game, PLAYER2, (player) => ({
    ...player,
    hand: { ...player.hand, cardIds: [opponentLive.instanceId] },
    mainDeck: { ...player.mainDeck, cardIds: [opponentDraw.instanceId] },
  }));
  game = {
    ...game,
    currentPhase: GamePhase.LIVE_SET_PHASE,
    currentSubPhase: SubPhase.LIVE_SET_FIRST_PLAYER,
    activePlayerIndex: 0,
    liveSetCompletedPlayers: [],
  };
  return { game, source, other, live1, live2, opponentLive, drawCards };
}

function setLiveCards(game: ReturnType<typeof setupLiveSet>['game'], cardIds: readonly string[]) {
  const service = new GameService();
  let state = game;
  for (const cardId of cardIds) {
    const result = service.processAction(state, createSetLiveCardAction(PLAYER1, cardId, true));
    expect(result.success).toBe(true);
    state = result.gameState;
  }
  return state;
}

describe('PL!SP-bp1-001 Kanon continuous Live prohibition', () => {
  it('keeps the first player cards hidden until both players finish Live Set, then moves them', () => {
    const scenario = setupLiveSet();
    const service = new GameService();
    const setState = setLiveCards(scenario.game, [
      scenario.live1.instanceId,
      scenario.live2.instanceId,
    ]);

    const confirmed = service.processAction(
      setState,
      createConfirmSubPhaseAction(PLAYER1, SubPhase.LIVE_SET_FIRST_PLAYER)
    );

    expect(confirmed.success).toBe(true);
    expect(confirmed.gameState.players[0].hand.cardIds).toEqual([
      scenario.drawCards[0].instanceId,
      scenario.drawCards[1].instanceId,
    ]);
    expect(confirmed.gameState.players[0].liveZone.cardIds).toEqual([
      scenario.live1.instanceId,
      scenario.live2.instanceId,
    ]);
    expect(confirmed.gameState.players[0].liveZone.cardStates.size).toBe(2);
    expect(confirmed.gameState.players[0].waitingRoom.cardIds).toEqual([]);
    expect(isPlayerLiveProhibited(confirmed.gameState, PLAYER1)).toBe(true);

    const opponentConfirmed = service.processAction(
      confirmed.gameState,
      createConfirmSubPhaseAction(PLAYER2, SubPhase.LIVE_SET_SECOND_PLAYER)
    );
    expect(opponentConfirmed.success).toBe(true);
    expect(opponentConfirmed.gameState.players[0].liveZone.cardIds).toEqual([]);
    expect(opponentConfirmed.gameState.players[0].liveZone.cardStates.size).toBe(0);
    expect(opponentConfirmed.gameState.players[0].waitingRoom.cardIds).toEqual([
      scenario.live1.instanceId,
      scenario.live2.instanceId,
    ]);
  });

  it('keeps the Live card when another own top-level member exists', () => {
    const scenario = setupLiveSet({ withOtherMember: true });
    const service = new GameService();
    const setState = setLiveCards(scenario.game, [scenario.live1.instanceId]);

    const confirmed = service.processAction(
      setState,
      createConfirmSubPhaseAction(PLAYER1, SubPhase.LIVE_SET_FIRST_PLAYER)
    );

    expect(confirmed.success).toBe(true);
    expect(confirmed.gameState.players[0].liveZone.cardIds).toEqual([scenario.live1.instanceId]);
    expect(confirmed.gameState.players[0].waitingRoom.cardIds).not.toContain(
      scenario.live1.instanceId
    );
    expect(isPlayerLiveProhibited(confirmed.gameState, PLAYER1)).toBe(false);

    const opponentConfirmed = service.processAction(
      confirmed.gameState,
      createConfirmSubPhaseAction(PLAYER2, SubPhase.LIVE_SET_SECOND_PLAYER)
    );
    expect(opponentConfirmed.success).toBe(true);
    expect(
      opponentConfirmed.gameState.eventLog.some(
        (entry) =>
          entry.event.eventType === TriggerCondition.ON_LIVE_START &&
          entry.event.performerId === PLAYER1
      )
    ).toBe(true);
  });

  it('re-reads the latest stage when another member is added before the prohibition check', () => {
    const scenario = setupLiveSet();
    const service = new GameService();
    let setState = setLiveCards(scenario.game, [scenario.live1.instanceId]);
    setState = updatePlayer(setState, PLAYER1, (player) => ({
      ...player,
      memberSlots: placeCardInSlot(
        player.memberSlots,
        SlotPosition.LEFT,
        scenario.other.instanceId
      ),
    }));

    const confirmed = service.processAction(
      setState,
      createConfirmSubPhaseAction(PLAYER1, SubPhase.LIVE_SET_FIRST_PLAYER)
    );

    expect(confirmed.success).toBe(true);
    expect(confirmed.gameState.players[0].liveZone.cardIds).toEqual([scenario.live1.instanceId]);
  });

  it('re-reads the latest stage when the other member leaves before the prohibition check', () => {
    const scenario = setupLiveSet({ withOtherMember: true });
    const service = new GameService();
    let setState = setLiveCards(scenario.game, [scenario.live1.instanceId]);
    setState = updatePlayer(setState, PLAYER1, (player) => ({
      ...player,
      memberSlots: removeCardFromSlot(player.memberSlots, SlotPosition.LEFT),
    }));

    const confirmed = service.processAction(
      setState,
      createConfirmSubPhaseAction(PLAYER1, SubPhase.LIVE_SET_FIRST_PLAYER)
    );

    expect(confirmed.success).toBe(true);
    expect(confirmed.gameState.players[0].liveZone.cardIds).toEqual([scenario.live1.instanceId]);
    expect(confirmed.gameState.players[0].waitingRoom.cardIds).not.toContain(
      scenario.live1.instanceId
    );

    const opponentConfirmed = service.processAction(
      confirmed.gameState,
      createConfirmSubPhaseAction(PLAYER2, SubPhase.LIVE_SET_SECOND_PLAYER)
    );
    expect(opponentConfirmed.success).toBe(true);
    expect(opponentConfirmed.gameState.players[0].liveZone.cardIds).toEqual([]);
    expect(opponentConfirmed.gameState.players[0].waitingRoom.cardIds).toContain(
      scenario.live1.instanceId
    );
  });

  it('does not affect the opponent or create a Live-start event for the prohibited player', () => {
    const scenario = setupLiveSet();
    const service = new GameService();
    const p1Set = setLiveCards(scenario.game, [scenario.live1.instanceId]);
    const p1Confirmed = service.processAction(
      p1Set,
      createConfirmSubPhaseAction(PLAYER1, SubPhase.LIVE_SET_FIRST_PLAYER)
    );
    expect(p1Confirmed.success).toBe(true);

    const p2Set = service.processAction(
      p1Confirmed.gameState,
      createSetLiveCardAction(PLAYER2, scenario.opponentLive.instanceId, true)
    );
    expect(p2Set.success).toBe(true);
    const p2Confirmed = service.processAction(
      p2Set.gameState,
      createConfirmSubPhaseAction(PLAYER2, SubPhase.LIVE_SET_SECOND_PLAYER)
    );
    expect(p2Confirmed.success).toBe(true);

    expect(p2Confirmed.gameState.players[1].liveZone.cardIds).toEqual([
      scenario.opponentLive.instanceId,
    ]);
    expect(
      p2Confirmed.gameState.eventLog.some(
        (entry) =>
          entry.event.eventType === TriggerCondition.ON_LIVE_START &&
          entry.event.performerId === PLAYER1
      )
    ).toBe(false);
    expect(
      p2Confirmed.gameState.eventLog.some(
        (entry) =>
          entry.event.eventType === TriggerCondition.ON_LIVE_START &&
          entry.event.performerId === PLAYER2
      )
    ).toBe(true);
  });

  it('remains active after the Live-end cleanup point while the stage condition still holds', () => {
    const scenario = setupLiveSet();
    const service = new GameService();
    const advanced = service.advancePhase({
      ...scenario.game,
      currentPhase: GamePhase.LIVE_RESULT_PHASE,
      currentSubPhase: SubPhase.NONE,
    });

    expect(advanced.success).toBe(true);
    expect(advanced.gameState.liveProhibitions).toEqual([]);
    expect(isPlayerLiveProhibited(advanced.gameState, PLAYER1)).toBe(true);
  });
});
