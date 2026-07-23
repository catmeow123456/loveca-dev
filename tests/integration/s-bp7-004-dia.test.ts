import { describe, expect, it } from 'vitest';
import type { MemberCardData } from '../../src/domain/entities/card';
import { createCardInstance, createHeartIcon } from '../../src/domain/entities/card';
import {
  createGameState,
  emitGameEvent,
  registerCards,
  updatePlayer,
  type GameState,
  type PendingAbilityState,
} from '../../src/domain/entities/game';
import { createEnterStageEvent } from '../../src/domain/events/game-events';
import { placeCardInSlot } from '../../src/domain/entities/zone';
import {
  confirmActiveEffectStep,
  enqueueTriggeredCardEffects,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import {
  S_BP7_004_LIVE_START_LOOK_BOTTOM_THREE_ARRANGE_BOTTOM_ABILITY_ID,
  S_BP7_004_ON_ENTER_AQOURS_RELAY_KEEP_THREE_HAND_BOTTOM_DRAW_THREE_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
import {
  CardType,
  FaceState,
  HeartColor,
  OrientationState,
  SlotPosition,
  TriggerCondition,
  ZoneType,
} from '../../src/shared/types/enums';

const P1 = 'player1';
const P2 = 'player2';
const SOURCE_CODE = 'PL!S-bp7-004-P';

function member(
  cardCode: string,
  name = cardCode,
  groupNames: readonly string[] = ['Aqours']
): MemberCardData {
  return {
    cardCode,
    name,
    groupNames,
    cardType: CardType.MEMBER,
    cost: cardCode === SOURCE_CODE ? 13 : 1,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.RED, 1)],
  };
}

function setupHandAdjustScenario() {
  const source = createCardInstance(member(SOURCE_CODE, '黑泽黛雅'), P1, 'dia-source');
  const aqoursReplacement = createCardInstance(
    member('PL!S-test-aqours-replacement', 'Aqours replacement'),
    P1,
    'aqours-replacement'
  );
  const nonAqoursReplacement = createCardInstance(
    member('PL!N-test-replacement', 'Nijigasaki replacement', ['虹咲']),
    P1,
    'non-aqours-replacement'
  );
  const p1Hand = Array.from({ length: 5 }, (_, index) =>
    createCardInstance(member(`P1-HAND-${index}`), P1, `p1-hand-${index}`)
  );
  const p2Hand = Array.from({ length: 4 }, (_, index) =>
    createCardInstance(member(`P2-HAND-${index}`), P2, `p2-hand-${index}`)
  );
  const p1Deck = Array.from({ length: 4 }, (_, index) =>
    createCardInstance(member(`P1-DECK-${index}`), P1, `p1-deck-${index}`)
  );
  const p2Deck = Array.from({ length: 4 }, (_, index) =>
    createCardInstance(member(`P2-DECK-${index}`), P2, `p2-deck-${index}`)
  );

  let game = registerCards(createGameState('s-bp7-004-hand-adjust', P1, 'P1', P2, 'P2'), [
    source,
    aqoursReplacement,
    nonAqoursReplacement,
    ...p1Hand,
    ...p2Hand,
    ...p1Deck,
    ...p2Deck,
  ]);
  game = updatePlayer(game, P1, (player) => ({
    ...player,
    hand: { ...player.hand, cardIds: p1Hand.map((card) => card.instanceId) },
    mainDeck: { ...player.mainDeck, cardIds: p1Deck.map((card) => card.instanceId) },
    memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    }),
  }));
  game = updatePlayer(game, P2, (player) => ({
    ...player,
    hand: { ...player.hand, cardIds: p2Hand.map((card) => card.instanceId) },
    mainDeck: { ...player.mainDeck, cardIds: p2Deck.map((card) => card.instanceId) },
  }));

  return {
    game,
    sourceId: source.instanceId,
    aqoursReplacementId: aqoursReplacement.instanceId,
    nonAqoursReplacementId: nonAqoursReplacement.instanceId,
    p1HandIds: p1Hand.map((card) => card.instanceId),
    p2HandIds: p2Hand.map((card) => card.instanceId),
    p1DeckIds: p1Deck.map((card) => card.instanceId),
    p2DeckIds: p2Deck.map((card) => card.instanceId),
  };
}

function enqueueDiaOnEnter(
  game: GameState,
  sourceCardId: string,
  replacementCardId?: string
): GameState {
  const event = createEnterStageEvent(
    sourceCardId,
    ZoneType.HAND,
    SlotPosition.CENTER,
    P1,
    P1,
    replacementCardId
      ? {
          relayReplacements: [
            {
              cardId: replacementCardId,
              slot: SlotPosition.CENTER,
              effectiveCost: 1,
            },
          ],
        }
      : undefined
  );
  return enqueueTriggeredCardEffects(
    emitGameEvent(game, event),
    [TriggerCondition.ON_ENTER_STAGE],
    { enterStageEvents: [event] }
  );
}

function confirmCards(game: GameState, cardIds: readonly string[]): GameState {
  return confirmActiveEffectStep(
    game,
    game.activeEffect!.awaitingPlayerId!,
    game.activeEffect!.id,
    undefined,
    undefined,
    undefined,
    undefined,
    cardIds
  );
}

function liveStartPending(sourceCardId: string): PendingAbilityState {
  return {
    id: 's-bp7-004-live-start',
    abilityId: S_BP7_004_LIVE_START_LOOK_BOTTOM_THREE_ARRANGE_BOTTOM_ABILITY_ID,
    sourceCardId,
    controllerId: P1,
    mandatory: true,
    timingId: TriggerCondition.ON_LIVE_START,
    eventIds: ['live-start'],
    sourceSlot: SlotPosition.CENTER,
  };
}

describe('PL!S-bp7-004-P 费用13「黑泽黛雅」', () => {
  it('only queues the ON_ENTER ability when relaying from an Aqours member', () => {
    const scenario = setupHandAdjustScenario();
    const noRelay = enqueueDiaOnEnter(scenario.game, scenario.sourceId);
    const nonAqoursRelay = enqueueDiaOnEnter(
      scenario.game,
      scenario.sourceId,
      scenario.nonAqoursReplacementId
    );
    const aqoursRelay = enqueueDiaOnEnter(
      scenario.game,
      scenario.sourceId,
      scenario.aqoursReplacementId
    );

    expect(noRelay.pendingAbilities).toEqual([]);
    expect(nonAqoursRelay.pendingAbilities).toEqual([]);
    expect(aqoursRelay.pendingAbilities).toHaveLength(1);
    expect(aqoursRelay.pendingAbilities[0]).toMatchObject({
      abilityId: S_BP7_004_ON_ENTER_AQOURS_RELAY_KEEP_THREE_HAND_BOTTOM_DRAW_THREE_ABILITY_ID,
      sourceCardId: scenario.sourceId,
      metadata: {
        relayReplacements: [expect.objectContaining({ cardId: scenario.aqoursReplacementId })],
      },
    });
  });

  it('lets each player keep up to three, shuffles the rest to their own deck bottom, then draws three', () => {
    const scenario = setupHandAdjustScenario();
    const started = resolvePendingCardEffects(
      enqueueDiaOnEnter(scenario.game, scenario.sourceId, scenario.aqoursReplacementId)
    ).gameState;

    expect(started.activeEffect).toMatchObject({
      abilityId: S_BP7_004_ON_ENTER_AQOURS_RELAY_KEEP_THREE_HAND_BOTTOM_DRAW_THREE_ABILITY_ID,
      awaitingPlayerId: P1,
      selectableCardIds: scenario.p1HandIds,
      selectableCardVisibility: 'AWAITING_PLAYER_ONLY',
      selectableCardMode: 'ORDERED_MULTI',
      minSelectableCards: 0,
      maxSelectableCards: 3,
      selectionLabel: '选择要保留的手牌',
      confirmSelectionLabel: '将其余手牌放置于卡组底',
    });

    const p1Kept = [scenario.p1HandIds[1]!, scenario.p1HandIds[4]!];
    const opponentSelection = confirmCards(started, p1Kept);
    expect(opponentSelection.activeEffect).toMatchObject({
      awaitingPlayerId: P2,
      selectableCardIds: scenario.p2HandIds,
      maxSelectableCards: 3,
    });
    expect(new Set(opponentSelection.players[0].mainDeck.cardIds.slice(4))).toEqual(
      new Set(scenario.p1HandIds.filter((cardId) => !p1Kept.includes(cardId)))
    );

    const p2Kept = scenario.p2HandIds.slice(0, 3);
    const finished = confirmCards(opponentSelection, p2Kept);
    expect(finished.activeEffect).toBeNull();
    expect(finished.pendingAbilities).toEqual([]);
    expect(finished.players[0].hand.cardIds).toEqual([
      ...p1Kept,
      ...scenario.p1DeckIds.slice(0, 3),
    ]);
    expect(finished.players[1].hand.cardIds).toEqual([
      ...p2Kept,
      ...scenario.p2DeckIds.slice(0, 3),
    ]);
    expect(finished.players[0].mainDeck.cardIds[0]).toBe(scenario.p1DeckIds[3]);
    expect(finished.players[1].mainDeck.cardIds[0]).toBe(scenario.p2DeckIds[3]);
    expect(finished.players[1].mainDeck.cardIds.at(-1)).toBe(scenario.p2HandIds[3]);
  });

  it('rejects duplicate and stale hand selections without moving cards', () => {
    const scenario = setupHandAdjustScenario();
    const started = resolvePendingCardEffects(
      enqueueDiaOnEnter(scenario.game, scenario.sourceId, scenario.aqoursReplacementId)
    ).gameState;

    const duplicate = confirmCards(started, [scenario.p1HandIds[0]!, scenario.p1HandIds[0]!]);
    expect(duplicate).toBe(started);

    const stale: GameState = updatePlayer(started, P1, (player) => ({
      ...player,
      hand: { ...player.hand, cardIds: player.hand.cardIds.slice(1) },
    }));
    expect(confirmCards(stale, [scenario.p1HandIds[1]!])).toBe(stale);
  });

  it('inspects the bottom three bottommost-first, returns the chosen order to bottom, and mills the rest once', () => {
    const scenario = setupHandAdjustScenario();
    const started = resolvePendingCardEffects({
      ...scenario.game,
      pendingAbilities: [liveStartPending(scenario.sourceId)],
    }).gameState;

    expect(started.activeEffect).toMatchObject({
      abilityId: S_BP7_004_LIVE_START_LOOK_BOTTOM_THREE_ARRANGE_BOTTOM_ABILITY_ID,
      awaitingPlayerId: P1,
      selectableCardIds: [scenario.p1DeckIds[3], scenario.p1DeckIds[2], scenario.p1DeckIds[1]],
      selectableCardVisibility: 'AWAITING_PLAYER_ONLY',
      selectableCardMode: 'ORDERED_MULTI',
      minSelectableCards: 0,
      maxSelectableCards: 3,
      selectionLabel: '按卡组底从下到上的顺序选择卡牌',
      confirmSelectionLabel: '按此顺序放置于卡组底',
    });
    expect(started.players[0].mainDeck.cardIds).toEqual([scenario.p1DeckIds[0]]);

    const finished = confirmCards(started, [scenario.p1DeckIds[3]!, scenario.p1DeckIds[1]!]);
    expect(finished.activeEffect).toBeNull();
    expect(finished.players[0].mainDeck.cardIds).toEqual([
      scenario.p1DeckIds[0],
      scenario.p1DeckIds[1],
      scenario.p1DeckIds[3],
    ]);
    expect(finished.players[0].waitingRoom.cardIds).toEqual([scenario.p1DeckIds[2]]);
    const waitingEvents = finished.eventLog.filter(
      ({ event }) =>
        event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM &&
        event.fromZone === ZoneType.MAIN_DECK
    );
    expect(waitingEvents).toHaveLength(1);
    expect(waitingEvents[0]?.event.cardInstanceIds).toEqual([scenario.p1DeckIds[2]]);
  });
});
