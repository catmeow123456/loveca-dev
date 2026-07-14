import { describe, expect, it } from 'vitest';
import type { CardInstance, MemberCardData } from '../../src/domain/entities/card';
import { createCardInstance, createHeartIcon } from '../../src/domain/entities/card';
import {
  createGameState,
  registerCards,
  updatePlayer,
  type GameState,
  type PendingAbilityState,
} from '../../src/domain/entities/game';
import { addCardToZone, placeCardInSlot, removeCardFromSlot } from '../../src/domain/entities/zone';
import { PL_BP3_007_LIVE_START_DISCARD_TWO_PARTITION_TOP_THREE_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
import {
  confirmActiveEffectStep,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import {
  CardType,
  FaceState,
  HeartColor,
  OrientationState,
  SlotPosition,
  TriggerCondition,
  ZoneType,
} from '../../src/shared/types/enums';

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';

function member(cardCode: string, instanceId: string): CardInstance<MemberCardData> {
  return createCardInstance(
    {
      cardCode,
      name: cardCode,
      groupNames: ["μ's"],
      cardType: CardType.MEMBER,
      cost: 1,
      blade: 1,
      hearts: [createHeartIcon(HeartColor.PURPLE, 1)],
    },
    PLAYER1,
    instanceId
  );
}

function pending(sourceCardId: string): PendingAbilityState {
  return {
    id: `pending-${sourceCardId}`,
    abilityId: PL_BP3_007_LIVE_START_DISCARD_TWO_PARTITION_TOP_THREE_ABILITY_ID,
    sourceCardId,
    controllerId: PLAYER1,
    mandatory: true,
    timingId: TriggerCondition.ON_LIVE_START,
    eventIds: ['live-start-event'],
  };
}

function setup(
  options: {
    readonly rarity?: 'P' | 'R';
    readonly handCount?: number;
    readonly deckCount?: number;
    readonly waitingCount?: number;
  } = {}
) {
  const source = member(`PL!-bp3-007-${options.rarity ?? 'R'}`, 'nozomi-source');
  const handCards = Array.from({ length: options.handCount ?? 3 }, (_, index) =>
    member(`PL!-test-hand-${index}`, `hand-${index}`)
  );
  const deckCards = Array.from({ length: options.deckCount ?? 4 }, (_, index) =>
    member(`PL!-test-deck-${index}`, `deck-${index}`)
  );
  const waitingCards = Array.from({ length: options.waitingCount ?? 0 }, (_, index) =>
    member(`PL!-test-waiting-${index}`, `waiting-${index}`)
  );
  let game = createGameState('pl-bp3-007-nozomi', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [source, ...handCards, ...deckCards, ...waitingCards]);
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    hand: handCards.reduce((zone, card) => addCardToZone(zone, card.instanceId), player.hand),
    mainDeck: {
      ...player.mainDeck,
      cardIds: deckCards.map((card) => card.instanceId),
    },
    waitingRoom: waitingCards.reduce(
      (zone, card) => addCardToZone(zone, card.instanceId),
      player.waitingRoom
    ),
    memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    }),
  }));
  game = { ...game, pendingAbilities: [pending(source.instanceId)] };
  return { game, source, handCards, deckCards, waitingCards };
}

function start(game: GameState): GameState {
  return resolvePendingCardEffects(game).gameState;
}

function chooseOne(game: GameState, cardId: string | null): GameState {
  return confirmActiveEffectStep(game, PLAYER1, game.activeEffect!.id, cardId);
}

function chooseMany(game: GameState, cardIds: readonly string[]): GameState {
  return confirmActiveEffectStep(
    game,
    PLAYER1,
    game.activeEffect!.id,
    cardIds[0] ?? null,
    null,
    false,
    null,
    cardIds
  );
}

describe('PL!-bp3-007 P/R 東條 希 LIVE-start inspection partition', () => {
  it.each(['P', 'R'] as const)(
    'pays the optional cost and atomically assigns all three inspected cards for %s',
    (rarity) => {
      const scenario = setup({ rarity });
      const costStep = start(scenario.game);
      expect(costStep.activeEffect).toMatchObject({
        abilityId: PL_BP3_007_LIVE_START_DISCARD_TWO_PARTITION_TOP_THREE_ABILITY_ID,
        canSkipSelection: true,
        minSelectableCards: 2,
        maxSelectableCards: 2,
      });
      expect(costStep.activeEffect?.effectText).toBe(
        '【LIVE开始时】可以将2张手牌放置入休息室：检视自己卡组顶的3张卡。将1张其中的卡片加入手牌，1张其中的卡片放置于卡组顶，1张其中的卡片放置入休息室。'
      );

      const handStep = chooseMany(
        costStep,
        scenario.handCards.slice(0, 2).map((card) => card.instanceId)
      );
      expect(handStep.inspectionZone.cardIds).toEqual(
        scenario.deckCards.slice(0, 3).map((card) => card.instanceId)
      );
      expect(handStep.activeEffect).toMatchObject({
        selectableCardIds: scenario.deckCards.slice(0, 3).map((card) => card.instanceId),
        canSkipSelection: false,
      });

      const handCardId = scenario.deckCards[1]!.instanceId;
      const deckTopStep = chooseOne(handStep, handCardId);
      const deckTopCardId = scenario.deckCards[2]!.instanceId;
      expect(deckTopStep.activeEffect?.selectableCardIds).toEqual([
        scenario.deckCards[0]!.instanceId,
        deckTopCardId,
      ]);
      const resolved = chooseOne(deckTopStep, deckTopCardId);
      const waitingCardId = scenario.deckCards[0]!.instanceId;

      expect(resolved.activeEffect).toBeNull();
      expect(resolved.pendingAbilities).toEqual([]);
      expect(resolved.inspectionZone.cardIds).toEqual([]);
      expect(resolved.players[0].hand.cardIds).toContain(handCardId);
      expect(resolved.players[0].mainDeck.cardIds[0]).toBe(deckTopCardId);
      expect(resolved.players[0].waitingRoom.cardIds).toContain(waitingCardId);
      const waitingEvents = resolved.eventLog
        .map((entry) => entry.event)
        .filter((event) => event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM);
      expect(waitingEvents).toHaveLength(2);
      expect(waitingEvents.map((event) => event.fromZone)).toEqual([
        ZoneType.HAND,
        ZoneType.MAIN_DECK,
      ]);
      expect(waitingEvents[1]).toMatchObject({
        cardInstanceIds: [waitingCardId],
        fromZone: ZoneType.MAIN_DECK,
        toZone: ZoneType.WAITING_ROOM,
      });
    }
  );

  it('declines cleanly and consumes the pending, while fewer than two hand cards cannot start', () => {
    const decline = setup();
    const declined = chooseMany(start(decline.game), []);
    expect(declined.activeEffect).toBeNull();
    expect(declined.pendingAbilities).toEqual([]);
    expect(declined.players[0].hand.cardIds).toEqual(
      decline.handCards.map((card) => card.instanceId)
    );
    expect(declined.inspectionZone.cardIds).toEqual([]);

    const insufficientHand = setup({ handCount: 1 });
    const noOp = start(insufficientHand.game);
    expect(noOp.activeEffect).toBeNull();
    expect(noOp.pendingAbilities).toEqual([]);
    expect(noOp.players[0].hand.cardIds).toEqual([insufficientHand.handCards[0]!.instanceId]);
  });

  it('rejects duplicate, illegal, and stale selections without partial movement', () => {
    const scenario = setup();
    const costStep = start(scenario.game);
    const duplicate = chooseMany(costStep, [
      scenario.handCards[0]!.instanceId,
      scenario.handCards[0]!.instanceId,
    ]);
    expect(duplicate).toBe(costStep);

    const handStep = chooseMany(
      costStep,
      scenario.handCards.slice(0, 2).map((card) => card.instanceId)
    );
    const illegalHand = chooseOne(handStep, scenario.handCards[2]!.instanceId);
    expect(illegalHand).toBe(handStep);

    const deckTopStep = chooseOne(handStep, scenario.deckCards[0]!.instanceId);
    const stale: GameState = {
      ...deckTopStep,
      inspectionZone: {
        ...deckTopStep.inspectionZone,
        cardIds: deckTopStep.inspectionZone.cardIds.slice(0, 2),
      },
    };
    const rejected = chooseOne(stale, scenario.deckCards[1]!.instanceId);
    expect(rejected).toBe(stale);
    expect(rejected.players[0].hand.cardIds).not.toContain(scenario.deckCards[0]!.instanceId);
  });

  it('uses refresh-aware inspection and still resolves after the source member leaves the stage', () => {
    const scenario = setup({ deckCount: 1, waitingCount: 3 });
    let game = updatePlayer(scenario.game, PLAYER1, (player) => ({
      ...player,
      memberSlots: removeCardFromSlot(player.memberSlots, SlotPosition.CENTER),
    }));
    const costStep = start(game);
    const handStep = chooseMany(
      costStep,
      scenario.handCards.slice(0, 2).map((card) => card.instanceId)
    );
    expect(handStep.inspectionZone.cardIds).toHaveLength(3);
    expect(
      handStep.actionHistory.some(
        (action) => action.type === 'RULE_ACTION' && action.payload.type === 'REFRESH'
      )
    ).toBe(true);

    const inspectedCardIds = handStep.inspectionZone.cardIds;
    const deckTopStep = chooseOne(handStep, inspectedCardIds[0]!);
    const resolved = chooseOne(deckTopStep, inspectedCardIds[1]!);
    expect(resolved.activeEffect).toBeNull();
    expect(resolved.pendingAbilities).toEqual([]);
    expect(resolved.inspectionZone.cardIds).toEqual([]);
  });

  it('keeps the paid cost, restores all actually inspected cards in order, and no-ops when fewer than three exist', () => {
    const scenario = setup({ handCount: 2, deckCount: 0, waitingCount: 0 });
    const costStep = start(scenario.game);
    const resolved = chooseMany(
      costStep,
      scenario.handCards.map((card) => card.instanceId)
    );

    expect(resolved.activeEffect).toBeNull();
    expect(resolved.pendingAbilities).toEqual([]);
    expect(resolved.players[0].hand.cardIds).toEqual([]);
    expect(resolved.players[0].waitingRoom.cardIds).toEqual([]);
    expect(resolved.players[0].mainDeck.cardIds).toHaveLength(2);
    expect(resolved.inspectionZone.cardIds).toEqual([]);
    expect(
      resolved.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.step === 'INSUFFICIENT_CARDS_TO_INSPECT_THREE'
      )
    ).toBe(true);
  });
});
