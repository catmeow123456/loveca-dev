import { describe, expect, it } from 'vitest';
import type { CardInstance, LiveCardData, MemberCardData } from '../../src/domain/entities/card';
import { createCardInstance, createHeartIcon, createHeartRequirement } from '../../src/domain/entities/card';
import {
  createGameState,
  registerCards,
  updatePlayer,
  type GameState,
  type PendingAbilityState,
} from '../../src/domain/entities/game';
import { placeCardInSlot } from '../../src/domain/entities/zone';
import { PL_BP3_022_LIVE_START_REVEAL_PER_STAGE_MEMBER_GAIN_LIVE_SCORE_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
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

function live(cardCode: string, instanceId: string): CardInstance<LiveCardData> {
  return createCardInstance(
    {
      cardCode,
      name: cardCode,
      cardType: CardType.LIVE,
      score: 5,
      requirements: createHeartRequirement({ [HeartColor.PINK]: 1 }),
    },
    PLAYER1,
    instanceId
  );
}

function member(ownerId: string, instanceId: string): CardInstance<MemberCardData> {
  return createCardInstance(
    {
      cardCode: `PL!-test-member-${instanceId}`,
      name: instanceId,
      cardType: CardType.MEMBER,
      cost: 1,
      blade: 1,
      hearts: [createHeartIcon(HeartColor.YELLOW, 1)],
    },
    ownerId,
    instanceId
  );
}

function pending(sourceCardId: string): PendingAbilityState {
  return {
    id: `pending-${sourceCardId}`,
    abilityId: PL_BP3_022_LIVE_START_REVEAL_PER_STAGE_MEMBER_GAIN_LIVE_SCORE_ABILITY_ID,
    sourceCardId,
    controllerId: PLAYER1,
    mandatory: true,
    timingId: TriggerCondition.ON_LIVE_START,
    eventIds: ['live-start-event'],
  };
}

function setup(options: {
  readonly deckTypes?: readonly CardType[];
  readonly waitingTypes?: readonly CardType[];
  readonly ownStageCount?: number;
  readonly opponentStageCount?: number;
} = {}) {
  const source = live('PL!-bp3-022-L', 'yume-no-tobira');
  const deckCards = (options.deckTypes ?? [CardType.LIVE, CardType.MEMBER, CardType.LIVE]).map(
    (type, index) =>
      type === CardType.LIVE
        ? live(`PL!-test-live-${index}`, `deck-${index}`)
        : member(PLAYER1, `deck-${index}`)
  );
  const waitingCards = (options.waitingTypes ?? []).map((type, index) =>
    type === CardType.LIVE
      ? live(`PL!-test-waiting-live-${index}`, `waiting-${index}`)
      : member(PLAYER1, `waiting-${index}`)
  );
  const ownMembers = Array.from({ length: 3 }, (_, index) => member(PLAYER1, `own-stage-${index}`));
  const opponentMembers = Array.from({ length: 3 }, (_, index) =>
    member(PLAYER2, `opponent-stage-${index}`)
  );
  let game = createGameState('pl-bp3-022-yume-no-tobira', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [source, ...deckCards, ...waitingCards, ...ownMembers, ...opponentMembers]);
  game = updatePlayer(game, PLAYER1, (player) => {
    const slotOrder = [SlotPosition.CENTER, SlotPosition.LEFT, SlotPosition.RIGHT];
    const ownStageCount = options.ownStageCount ?? 2;
    return {
      ...player,
      liveZone: { ...player.liveZone, cardIds: [source.instanceId] },
      mainDeck: { ...player.mainDeck, cardIds: deckCards.map((card) => card.instanceId) },
      waitingRoom: { ...player.waitingRoom, cardIds: waitingCards.map((card) => card.instanceId) },
      memberSlots: ownMembers.slice(0, ownStageCount).reduce(
        (slots, card, index) =>
          placeCardInSlot(slots, slotOrder[index]!, card.instanceId, {
            orientation: OrientationState.ACTIVE,
            face: FaceState.FACE_UP,
          }),
        player.memberSlots
      ),
    };
  });
  game = updatePlayer(game, PLAYER2, (player) => {
    const slotOrder = [SlotPosition.CENTER, SlotPosition.LEFT, SlotPosition.RIGHT];
    const opponentStageCount = options.opponentStageCount ?? 1;
    return {
      ...player,
      memberSlots: opponentMembers.slice(0, opponentStageCount).reduce(
        (slots, card, index) =>
          placeCardInSlot(slots, slotOrder[index]!, card.instanceId, {
            orientation: OrientationState.ACTIVE,
            face: FaceState.FACE_UP,
          }),
        player.memberSlots
      ),
    };
  });
  return {
    game: { ...game, pendingAbilities: [pending(source.instanceId)] },
    source,
    deckCards,
    waitingCards,
    ownMembers,
    opponentMembers,
  };
}

function getPlayer(game: GameState, playerId: string) {
  const player = game.players.find((candidate) => candidate.id === playerId);
  if (!player) {
    throw new Error(`missing player ${playerId}`);
  }
  return player;
}

function start(game: GameState): GameState {
  return resolvePendingCardEffects(game).gameState;
}

function confirm(game: GameState, playerId = PLAYER1): GameState {
  return confirmActiveEffectStep(game, playerId, game.activeEffect!.id);
}

function inspectionWaitingRoomEvents(game: GameState) {
  return game.eventLog
    .map((entry) => entry.event)
    .filter(
      (event) =>
        event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM &&
        event.fromZone === ZoneType.MAIN_DECK &&
        event.toZone === ZoneType.WAITING_ROOM
    );
}

describe('PL!-bp3-022-L ユメノトビラ live-start reveal workflow', () => {
  it.each([
    { deckTypes: [CardType.MEMBER, CardType.MEMBER, CardType.MEMBER], scoreBonus: 0 },
    { deckTypes: [CardType.LIVE, CardType.MEMBER, CardType.MEMBER], scoreBonus: 1 },
    { deckTypes: [CardType.LIVE, CardType.LIVE, CardType.MEMBER], scoreBonus: 2 },
  ] as const)(
    'counts LIVE cards among the three cards revealed from both players’ stage members',
    ({ deckTypes, scoreBonus }) => {
      const scenario = setup({ deckTypes });
      const started = start(scenario.game);

      expect(started.activeEffect).toMatchObject({
        abilityId: PL_BP3_022_LIVE_START_REVEAL_PER_STAGE_MEMBER_GAIN_LIVE_SCORE_ABILITY_ID,
        revealedCardIds: scenario.deckCards.map((card) => card.instanceId),
        selectableCardVisibility: 'PUBLIC',
        confirmSelectionLabel: '确认公开结果',
      });
      expect(started.activeEffect?.metadata?.stageMemberCount).toBe(3);
      expect(started.inspectionZone.revealedCardIds).toEqual(
        scenario.deckCards.map((card) => card.instanceId)
      );
      expect(getPlayer(started, PLAYER2).mainDeck.cardIds).toEqual([]);

      const resolved = confirm(started);
      expect(resolved.activeEffect).toBeNull();
      expect(resolved.pendingAbilities).toEqual([]);
      expect(getPlayer(resolved, PLAYER1).waitingRoom.cardIds).toEqual(
        scenario.deckCards.map((card) => card.instanceId)
      );
      expect(resolved.liveResolution.playerScores.get(PLAYER1) ?? 0).toBe(scoreBonus);
      const modifiers = resolved.liveResolution.liveModifiers.filter(
        (modifier) => modifier.kind === 'SCORE' && modifier.abilityId ===
          PL_BP3_022_LIVE_START_REVEAL_PER_STAGE_MEMBER_GAIN_LIVE_SCORE_ABILITY_ID
      );
      expect(modifiers).toHaveLength(scoreBonus === 0 ? 0 : 1);
      if (scoreBonus > 0) {
        expect(modifiers[0]).toMatchObject({
          liveCardId: scenario.source.instanceId,
          countDelta: scoreBonus,
        });
      }
    }
  );

  it('recounts both stages at real resolution time and reveals no hidden cards before the effect starts', () => {
    const scenario = setup({ ownStageCount: 1, opponentStageCount: 0 });
    expect(scenario.game.inspectionZone.revealedCardIds).toEqual([]);
    const changed = updatePlayer(scenario.game, PLAYER2, (player) => ({
      ...player,
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.RIGHT, scenario.opponentMembers[0]!.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      }),
    }));

    const started = start(changed);
    expect(started.activeEffect?.inspectionCardIds).toEqual(
      scenario.deckCards.slice(0, 2).map((card) => card.instanceId)
    );
    expect(started.activeEffect?.metadata?.stageMemberCount).toBe(2);
  });

  it('keeps the reveal-to-waiting movement atomic, with one MAIN_DECK event and no duplicate resolution', () => {
    const scenario = setup();
    const resolved = confirm(start(scenario.game));
    const events = inspectionWaitingRoomEvents(resolved);
    expect(events).toHaveLength(1);
    expect(events[0]?.cardInstanceIds).toEqual(scenario.deckCards.map((card) => card.instanceId));
    expect(resolved.inspectionZone.cardIds).toEqual([]);

    const repeated = resolvePendingCardEffects(resolved).gameState;
    expect(inspectionWaitingRoomEvents(repeated)).toHaveLength(1);
    expect(repeated.liveResolution.liveModifiers).toHaveLength(1);
  });

  it('does not add score when the source LIVE leaves after the cards were revealed, but still resolves their movement', () => {
    const scenario = setup();
    const started = start(scenario.game);
    const sourceLeft = updatePlayer(started, PLAYER1, (player) => ({
      ...player,
      liveZone: { ...player.liveZone, cardIds: [] },
    }));

    const resolved = confirm(sourceLeft);
    expect(getPlayer(resolved, PLAYER1).waitingRoom.cardIds).toEqual(
      scenario.deckCards.map((card) => card.instanceId)
    );
    expect(resolved.liveResolution.liveModifiers).toEqual([]);
    expect(resolved.liveResolution.playerScores.get(PLAYER1) ?? 0).toBe(0);
  });

  it('reveals across a refresh boundary and reveals all remaining cards when the refreshed deck is still short', () => {
    const refreshed = setup({
      deckTypes: [CardType.LIVE],
      waitingTypes: [CardType.MEMBER, CardType.LIVE],
    });
    const refreshedStarted = start(refreshed.game);
    expect(refreshedStarted.activeEffect?.inspectionCardIds).toHaveLength(3);
    expect(
      refreshedStarted.actionHistory.some(
        (action) => action.type === 'RULE_ACTION' && action.payload.type === 'REFRESH'
      )
    ).toBe(true);
    expect(confirm(refreshedStarted).liveResolution.playerScores.get(PLAYER1)).toBe(2);

    const short = setup({
      deckTypes: [CardType.LIVE],
      waitingTypes: [CardType.MEMBER],
    });
    const shortStarted = start(short.game);
    expect(shortStarted.activeEffect?.inspectionCardIds).toHaveLength(2);
    const resolvedShort = confirm(shortStarted);
    expect(resolvedShort.liveResolution.playerScores.get(PLAYER1)).toBe(1);
    expect(inspectionWaitingRoomEvents(resolvedShort)[0]?.cardInstanceIds).toHaveLength(2);
  });

  it('rejects a non-controller confirmation and a stale inspection without partial movement', () => {
    const scenario = setup();
    const started = start(scenario.game);
    expect(confirm(started, PLAYER2)).toBe(started);

    const stale: GameState = {
      ...started,
      inspectionZone: { ...started.inspectionZone, cardIds: [] },
    };
    const staleAttempt = confirm(stale);
    expect(staleAttempt).toBe(stale);
    expect(getPlayer(staleAttempt, PLAYER1).waitingRoom.cardIds).toEqual([]);
  });

  it('supports manual source selection among multiple pending reveals, then continues the remaining reveal without duplicate events', () => {
    const scenario = setup();
    const secondSource = live('PL!-bp3-022-L', 'yume-no-tobira-second');
    const extraDeckCards = [member(PLAYER1, 'deck-extra-0'), member(PLAYER1, 'deck-extra-1'), member(PLAYER1, 'deck-extra-2')];
    let game = registerCards(scenario.game, [secondSource, ...extraDeckCards]);
    game = updatePlayer(game, PLAYER1, (current) => ({
      ...current,
      liveZone: { ...current.liveZone, cardIds: [...current.liveZone.cardIds, secondSource.instanceId] },
      mainDeck: { ...current.mainDeck, cardIds: [...current.mainDeck.cardIds, ...extraDeckCards.map((card) => card.instanceId)] },
    }));
    game = {
      ...game,
      pendingAbilities: [
        pending(scenario.source.instanceId),
        { ...pending(secondSource.instanceId), id: 'pending-yume-no-tobira-second' },
      ],
    };

    const orderSelection = start(game);
    const selectedSecond = confirmActiveEffectStep(
      orderSelection,
      PLAYER1,
      orderSelection.activeEffect!.id,
      secondSource.instanceId
    );
    expect(selectedSecond.activeEffect).toMatchObject({ sourceCardId: secondSource.instanceId, revealedCardIds: scenario.deckCards.map((card) => card.instanceId) });
    const afterSecond = confirm(selectedSecond);
    expect(afterSecond.activeEffect).toMatchObject({ sourceCardId: scenario.source.instanceId, revealedCardIds: extraDeckCards.map((card) => card.instanceId) });
    const resolved = confirm(afterSecond);
    expect(resolved.pendingAbilities).toEqual([]);
    const events = inspectionWaitingRoomEvents(resolved);
    expect(events).toHaveLength(2);
    expect(events.map((event) => event.cardInstanceIds)).toEqual([
      scenario.deckCards.map((card) => card.instanceId),
      extraDeckCards.map((card) => card.instanceId),
    ]);
  });

  it('keeps each actual reveal result visible while ordered resolution continues multiple pending abilities', () => {
    const scenario = setup();
    const secondSource = live('PL!-bp3-022-L', 'yume-no-tobira-second');
    const extraDeckCards = [member(PLAYER1, 'deck-extra-0'), member(PLAYER1, 'deck-extra-1'), member(PLAYER1, 'deck-extra-2')];
    let game = registerCards(scenario.game, [secondSource, ...extraDeckCards]);
    game = updatePlayer(game, PLAYER1, (current) => ({
      ...current,
      liveZone: { ...current.liveZone, cardIds: [...current.liveZone.cardIds, secondSource.instanceId] },
      mainDeck: { ...current.mainDeck, cardIds: [...current.mainDeck.cardIds, ...extraDeckCards.map((card) => card.instanceId)] },
    }));
    game = {
      ...game,
      pendingAbilities: [
        pending(scenario.source.instanceId),
        { ...pending(secondSource.instanceId), id: 'pending-yume-no-tobira-second' },
      ],
    };

    const orderSelection = start(game);
    const firstReveal = confirmActiveEffectStep(
      orderSelection,
      PLAYER1,
      orderSelection.activeEffect!.id,
      undefined,
      undefined,
      true
    );
    expect(firstReveal.activeEffect?.revealedCardIds).toEqual(
      scenario.deckCards.map((card) => card.instanceId)
    );
    const secondReveal = confirm(firstReveal);
    expect(secondReveal.activeEffect?.revealedCardIds).toEqual(
      extraDeckCards.map((card) => card.instanceId)
    );
    const resolved = confirm(secondReveal);
    expect(resolved.pendingAbilities).toEqual([]);
    expect(inspectionWaitingRoomEvents(resolved)).toHaveLength(2);
  });
});
