import { describe, expect, it } from 'vitest';
import type { LiveCardData, MemberCardData } from '../../src/domain/entities/card';
import {
  createCardInstance,
  createHeartIcon,
  createHeartRequirement,
} from '../../src/domain/entities/card';
import {
  createGameState,
  emitGameEvent,
  registerCards,
  updatePlayer,
  type GameState,
  type PendingAbilityState,
} from '../../src/domain/entities/game';
import { createCheerEvent } from '../../src/domain/events/game-events';
import { addCardToZone, placeCardInSlot } from '../../src/domain/entities/zone';
import {
  confirmActiveEffectStep,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import {
  S_BP2_007_AUTO_ON_CHEER_LIVE_HAND_SEVEN_OR_LESS_DRAW_ONE_ABILITY_ID,
  S_BP2_007_LIVE_START_REVEAL_HAND_LIVE_BOTTOM_ARRANGE_TOP_TWO_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
import { createPublicObjectId, projectPlayerViewState } from '../../src/online/projector';
import {
  CardType,
  FaceState,
  HeartColor,
  OrientationState,
  SlotPosition,
  TriggerCondition,
} from '../../src/shared/types/enums';

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';
const SELECT_HAND_LIVE_STEP_ID = 'S_BP2_007_SELECT_HAND_LIVE_TO_REVEAL';
const PLACE_REVEALED_LIVE_BOTTOM_STEP_ID = 'S_BP2_007_PLACE_REVEALED_LIVE_DECK_BOTTOM';
const ARRANGE_TOP_TWO_STEP_ID = 'S_BP2_007_ARRANGE_TOP_TWO';

function member(cardCode: string): MemberCardData {
  return {
    cardCode,
    name: cardCode,
    cardType: CardType.MEMBER,
    cost: 4,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.GREEN, 1)],
  };
}

function live(cardCode: string): LiveCardData {
  return {
    cardCode,
    name: cardCode,
    cardType: CardType.LIVE,
    score: 1,
    requirements: createHeartRequirement({ [HeartColor.GREEN]: 1 }),
  };
}

function pending(
  abilityId: string,
  sourceCardId: string,
  eventIds: readonly string[] = []
): PendingAbilityState {
  return {
    id: `${abilityId}:${sourceCardId}:${eventIds.join(',') || 'live-start'}`,
    abilityId,
    sourceCardId,
    controllerId: PLAYER1,
    mandatory: true,
    timingId:
      abilityId === S_BP2_007_AUTO_ON_CHEER_LIVE_HAND_SEVEN_OR_LESS_DRAW_ONE_ABILITY_ID
        ? TriggerCondition.ON_CHEER
        : TriggerCondition.ON_LIVE_START,
    eventIds,
    sourceSlot: SlotPosition.CENTER,
  };
}

function setup(options: {
  readonly hand?: readonly ReturnType<typeof createCardInstance>[];
  readonly deck?: readonly ReturnType<typeof createCardInstance>[];
  readonly waiting?: readonly ReturnType<typeof createCardInstance>[];
  readonly sourceOnStage?: boolean;
}) {
  const source = createCardInstance(member('PL!S-bp2-007-P'), PLAYER1, 'hanamaru');
  const hand = options.hand ?? [];
  const deck = options.deck ?? [];
  const waiting = options.waiting ?? [];
  let game = registerCards(createGameState('s-bp2-007', PLAYER1, 'P1', PLAYER2, 'P2'), [
    source,
    ...hand,
    ...deck,
    ...waiting,
  ]);
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    hand: { ...player.hand, cardIds: hand.map((card) => card.instanceId) },
    mainDeck: { ...player.mainDeck, cardIds: deck.map((card) => card.instanceId) },
    waitingRoom: { ...player.waitingRoom, cardIds: waiting.map((card) => card.instanceId) },
    memberSlots:
      options.sourceOnStage === false
        ? player.memberSlots
        : placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId, {
            orientation: OrientationState.ACTIVE,
            face: FaceState.FACE_UP,
          }),
  }));
  return { game, source, hand, deck, waiting };
}

function addOwnCheer(
  game: GameState,
  cardIds: readonly string[],
  options: { readonly additional?: boolean; readonly keepInResolution?: boolean } = {}
) {
  const event = createCheerEvent(PLAYER1, cardIds, cardIds.length, { additional: options.additional });
  const withEvent = emitGameEvent(game, event);
  return {
    game: {
      ...withEvent,
      liveResolution: {
        ...withEvent.liveResolution,
        isInLive: true,
        performingPlayerId: PLAYER1,
        firstPlayerCheerCardIds: cardIds,
      },
      resolutionZone: {
        ...withEvent.resolutionZone,
        cardIds: options.keepInResolution === false ? [] : cardIds,
        revealedCardIds: options.keepInResolution === false ? [] : cardIds,
      },
    },
    event,
  };
}

function resolveAuto(game: GameState, sourceCardId: string, eventIds: readonly string[]) {
  return resolvePendingCardEffects({
    ...game,
    pendingAbilities: [
      pending(S_BP2_007_AUTO_ON_CHEER_LIVE_HAND_SEVEN_OR_LESS_DRAW_ONE_ABILITY_ID, sourceCardId, eventIds),
    ],
  }).gameState;
}

function startLiveStart(game: GameState, sourceCardId: string) {
  return resolvePendingCardEffects({
    ...game,
    pendingAbilities: [
      pending(S_BP2_007_LIVE_START_REVEAL_HAND_LIVE_BOTTOM_ARRANGE_TOP_TWO_ABILITY_ID, sourceCardId),
    ],
  }).gameState;
}

function didUseAuto(game: GameState) {
  return game.actionHistory.some(
    (action) =>
      action.type === 'RESOLVE_ABILITY' &&
      action.payload.abilityId === S_BP2_007_AUTO_ON_CHEER_LIVE_HAND_SEVEN_OR_LESS_DRAW_ONE_ABILITY_ID &&
      action.payload.step === 'ABILITY_USE'
  );
}

describe('PL!S-bp2-007 国木田花丸', () => {
  it('draws at seven hand cards, records turn1, and still records use if no card can be drawn', () => {
    const hand = Array.from({ length: 7 }, (_, index) =>
      createCardInstance(member(`HAND-${index}`), PLAYER1, `hand-${index}`)
    );
    const drawn = createCardInstance(member('DRAWN'), PLAYER1, 'drawn');
    const revealed = createCardInstance(live('CHEER-LIVE'), PLAYER1, 'cheer-live');
    const scenario = setup({ hand, deck: [drawn] });
    const withCheer = addOwnCheer(
      registerCards(scenario.game, [revealed]),
      [revealed.instanceId]
    );
    const resolved = resolveAuto(withCheer.game, scenario.source.instanceId, [withCheer.event.eventId]);
    expect(resolved.players[0].hand.cardIds).toContain(drawn.instanceId);
    expect(didUseAuto(resolved)).toBe(true);

    const emptyScenario = setup({ hand: [], deck: [], waiting: [] });
    const emptyLive = createCardInstance(live('EMPTY-CHEER'), PLAYER1, 'empty-cheer');
    const emptyCheer = addOwnCheer(registerCards(emptyScenario.game, [emptyLive]), [emptyLive.instanceId]);
    const emptyResolved = resolveAuto(emptyCheer.game, emptyScenario.source.instanceId, [emptyCheer.event.eventId]);
    expect(didUseAuto(emptyResolved)).toBe(true);
    expect(
      emptyResolved.actionHistory.find(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.step === 'DRAW_ONE_FOR_OWN_CHEER_LIVE_HAND_SEVEN_OR_LESS'
      )?.payload.drawnCardIds
    ).toEqual([]);
  });

  it('does not draw or consume turn1 at eight cards or without an own current normal LIVE fact', () => {
    const eightHand = Array.from({ length: 8 }, (_, index) =>
      createCardInstance(member(`EIGHT-${index}`), PLAYER1, `eight-${index}`)
    );
    const deck = createCardInstance(member('DECK'), PLAYER1, 'deck');
    const revealed = createCardInstance(live('CHEER-LIVE'), PLAYER1, 'cheer-live');
    const scenario = setup({ hand: eightHand, deck: [deck] });
    const cheer = addOwnCheer(registerCards(scenario.game, [revealed]), [revealed.instanceId]);
    const tooMany = resolveAuto(cheer.game, scenario.source.instanceId, [cheer.event.eventId]);
    expect(tooMany.players[0].hand.cardIds).toEqual(eightHand.map((card) => card.instanceId));
    expect(didUseAuto(tooMany)).toBe(false);

    const noLive = createCardInstance(member('CHEER-MEMBER'), PLAYER1, 'cheer-member');
    const noLiveCheer = addOwnCheer(registerCards(scenario.game, [noLive]), [noLive.instanceId]);
    const noLiveResolved = resolveAuto(noLiveCheer.game, scenario.source.instanceId, [noLiveCheer.event.eventId]);
    expect(didUseAuto(noLiveResolved)).toBe(false);
  });

  it('can trigger on a later normal cheer after a failed condition, but ignores opponent cheer facts', () => {
    const deck = createCardInstance(member('DRAW'), PLAYER1, 'draw');
    const scenario = setup({ deck: [deck] });
    const first = createCardInstance(member('FIRST-MEMBER'), PLAYER1, 'first-member');
    const failedCheer = addOwnCheer(registerCards(scenario.game, [first]), [first.instanceId]);
    const afterFailure = resolveAuto(
      failedCheer.game,
      scenario.source.instanceId,
      [failedCheer.event.eventId]
    );
    expect(didUseAuto(afterFailure)).toBe(false);

    const laterLive = createCardInstance(live('LATER-LIVE'), PLAYER1, 'later-live');
    const laterCheer = addOwnCheer(registerCards(afterFailure, [laterLive]), [laterLive.instanceId]);
    const afterLaterCheer = resolveAuto(
      laterCheer.game,
      scenario.source.instanceId,
      [laterCheer.event.eventId]
    );
    expect(afterLaterCheer.players[0].hand.cardIds).toContain(deck.instanceId);
    expect(didUseAuto(afterLaterCheer)).toBe(true);

    const opponentLive = createCardInstance(live('OPPONENT-LIVE'), PLAYER2, 'opponent-live');
    const opponentEvent = createCheerEvent(PLAYER2, [opponentLive.instanceId], 1);
    const opponentState = emitGameEvent(registerCards(scenario.game, [opponentLive]), opponentEvent);
    const opponentResolved = resolveAuto(
      {
        ...opponentState,
        liveResolution: {
          ...opponentState.liveResolution,
          firstPlayerCheerCardIds: [opponentLive.instanceId],
        },
      },
      scenario.source.instanceId,
      [opponentEvent.eventId]
    );
    expect(didUseAuto(opponentResolved)).toBe(false);
  });

  it('uses only the pending normal own cheer event facts, including a LIVE already removed from resolution', () => {
    const deck = createCardInstance(member('DRAW'), PLAYER1, 'draw');
    const current = createCardInstance(live('CURRENT'), PLAYER1, 'current');
    const old = createCardInstance(live('OLD'), PLAYER1, 'old');
    const scenario = setup({ deck: [deck] });
    const oldCheer = addOwnCheer(registerCards(scenario.game, [old, current]), [old.instanceId]);
    const currentCheer = addOwnCheer(oldCheer.game, [current.instanceId], { keepInResolution: false });
    const resolved = resolveAuto(currentCheer.game, scenario.source.instanceId, [currentCheer.event.eventId]);
    expect(resolved.players[0].hand.cardIds).toEqual([deck.instanceId]);
    expect(didUseAuto(resolved)).toBe(true);

    const additional = addOwnCheer(
      registerCards(scenario.game, [current]),
      [current.instanceId],
      { additional: true }
    );
    const additionalResolved = resolveAuto(additional.game, scenario.source.instanceId, [additional.event.eventId]);
    expect(didUseAuto(additionalResolved)).toBe(false);
  });

  it('safely no-ops without recording use when the source left the stage', () => {
    const revealed = createCardInstance(live('CHEER-LIVE'), PLAYER1, 'cheer-live');
    const scenario = setup({ sourceOnStage: false });
    const cheer = addOwnCheer(registerCards(scenario.game, [revealed]), [revealed.instanceId]);
    const resolved = resolveAuto(cheer.game, scenario.source.instanceId, [cheer.event.eventId]);
    expect(resolved.pendingAbilities).toEqual([]);
    expect(didUseAuto(resolved)).toBe(false);
  });

  it('skips without opening a window when no hand LIVE exists, and decline keeps all zones unchanged', () => {
    const nonLive = createCardInstance(member('HAND-MEMBER'), PLAYER1, 'hand-member');
    const noLive = setup({ hand: [nonLive] });
    expect(startLiveStart(noLive.game, noLive.source.instanceId).activeEffect).toBeNull();

    const handLive = createCardInstance(live('HAND-LIVE'), PLAYER1, 'hand-live');
    const deck = createCardInstance(member('TOP'), PLAYER1, 'top');
    const scenario = setup({ hand: [handLive], deck: [deck] });
    const started = startLiveStart(scenario.game, scenario.source.instanceId);
    const declined = confirmActiveEffectStep(started, PLAYER1, started.activeEffect!.id, null);
    expect(declined.activeEffect).toBeNull();
    expect(declined.players[0].hand.cardIds).toEqual([handLive.instanceId]);
    expect(declined.players[0].mainDeck.cardIds).toEqual([deck.instanceId]);
  });

  it('reveals the selected LIVE publicly, then puts it on bottom before inspecting and ordering top two', () => {
    const handLive = createCardInstance(live('HAND-LIVE'), PLAYER1, 'hand-live');
    const hiddenHand = createCardInstance(member('HIDDEN'), PLAYER1, 'hidden');
    const topOne = createCardInstance(member('TOP-1'), PLAYER1, 'top-1');
    const topTwo = createCardInstance(member('TOP-2'), PLAYER1, 'top-2');
    const scenario = setup({ hand: [handLive, hiddenHand], deck: [topOne, topTwo] });
    const started = startLiveStart(scenario.game, scenario.source.instanceId);
    expect(started.activeEffect).toMatchObject({
      stepId: SELECT_HAND_LIVE_STEP_ID,
      selectableCardIds: [handLive.instanceId],
      canSkipSelection: true,
      skipSelectionLabel: '不发动',
    });
    const revealed = confirmActiveEffectStep(started, PLAYER1, started.activeEffect!.id, handLive.instanceId);
    expect(revealed.activeEffect).toMatchObject({
      stepId: PLACE_REVEALED_LIVE_BOTTOM_STEP_ID,
      revealedCardIds: [handLive.instanceId],
      confirmSelectionLabel: '放置到卡组底并继续',
      selectableCardIds: undefined,
    });
    expect(revealed.activeEffect?.metadata?.confirmOnlyPendingAbility).toBeUndefined();
    const opponentView = projectPlayerViewState(revealed, PLAYER2);
    expect(opponentView.activeEffect?.revealedObjectIds).toEqual([createPublicObjectId(handLive.instanceId)]);
    expect(opponentView.activeEffect?.selectableObjectIds).toBeUndefined();

    const inspected = confirmActiveEffectStep(revealed, PLAYER1, revealed.activeEffect!.id);
    expect(inspected.activeEffect).toMatchObject({
      stepId: ARRANGE_TOP_TWO_STEP_ID,
      inspectionCardIds: [topOne.instanceId, topTwo.instanceId],
      minSelectableCards: 0,
      maxSelectableCards: 2,
    });
    expect(inspected.players[0].mainDeck.cardIds).toEqual([handLive.instanceId]);
    const finished = confirmActiveEffectStep(
      inspected,
      PLAYER1,
      inspected.activeEffect!.id,
      undefined,
      undefined,
      false,
      undefined,
      [topTwo.instanceId, topOne.instanceId]
    );
    expect(finished.players[0].mainDeck.cardIds).toEqual([
      topTwo.instanceId,
      topOne.instanceId,
      handLive.instanceId,
    ]);
    expect(finished.players[0].waitingRoom.cardIds).toEqual([]);
  });

  it('keeps invalid selection open, clears stale original candidates, and sends unselected inspected cards through waiting-room triggers', () => {
    const handLive = createCardInstance(live('HAND-LIVE'), PLAYER1, 'hand-live');
    const topOne = createCardInstance(member('TOP-1'), PLAYER1, 'top-1');
    const topTwo = createCardInstance(member('TOP-2'), PLAYER1, 'top-2');
    const scenario = setup({ hand: [handLive], deck: [topOne, topTwo] });
    const started = startLiveStart(scenario.game, scenario.source.instanceId);
    const invalid = confirmActiveEffectStep(started, PLAYER1, started.activeEffect!.id, 'not-a-hand-live');
    expect(invalid.activeEffect).toBe(started.activeEffect);

    const stale = updatePlayer(started, PLAYER1, (player) => ({
      ...player,
      hand: { ...player.hand, cardIds: [] },
    }));
    const staleResolved = confirmActiveEffectStep(stale, PLAYER1, stale.activeEffect!.id, handLive.instanceId);
    expect(staleResolved.activeEffect).toBeNull();

    const reveal = confirmActiveEffectStep(started, PLAYER1, started.activeEffect!.id, handLive.instanceId);
    const inspect = confirmActiveEffectStep(reveal, PLAYER1, reveal.activeEffect!.id);
    const arranged = confirmActiveEffectStep(
      inspect,
      PLAYER1,
      inspect.activeEffect!.id,
      undefined,
      undefined,
      false,
      undefined,
      [topTwo.instanceId]
    );
    expect(arranged.players[0].mainDeck.cardIds.slice(0, 2)).toEqual([topTwo.instanceId, handLive.instanceId]);
    expect(arranged.players[0].waitingRoom.cardIds).toEqual([topOne.instanceId]);
    expect(
      arranged.eventLog.some(
        (entry) =>
          entry.event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM &&
          'fromZone' in entry.event &&
          entry.event.fromZone === 'MAIN_DECK' &&
          'cardInstanceIds' in entry.event &&
          entry.event.cardInstanceIds.includes(topOne.instanceId)
      )
    ).toBe(true);
  });

  it('allows zero selected inspected cards and refreshes only after the revealed LIVE has been placed on bottom', () => {
    const handLive = createCardInstance(live('HAND-LIVE'), PLAYER1, 'hand-live');
    const waitingTopOne = createCardInstance(member('WAITING-1'), PLAYER1, 'waiting-1');
    const waitingTopTwo = createCardInstance(member('WAITING-2'), PLAYER1, 'waiting-2');
    const scenario = setup({ hand: [handLive], deck: [], waiting: [waitingTopOne, waitingTopTwo] });
    const started = startLiveStart(scenario.game, scenario.source.instanceId);
    const revealed = confirmActiveEffectStep(started, PLAYER1, started.activeEffect!.id, handLive.instanceId);
    const inspected = confirmActiveEffectStep(revealed, PLAYER1, revealed.activeEffect!.id);
    expect(inspected.activeEffect?.inspectionCardIds).toHaveLength(2);
    expect(inspected.players[0].mainDeck.cardIds).not.toContain(handLive.instanceId);
    const completed = confirmActiveEffectStep(
      inspected,
      PLAYER1,
      inspected.activeEffect!.id,
      undefined,
      undefined,
      false,
      undefined,
      []
    );
    expect(completed.players[0].waitingRoom.cardIds).toHaveLength(2);
    expect(completed.players[0].waitingRoom.cardIds).toContain(handLive.instanceId);
    const placementIndex = completed.actionHistory.findIndex(
      (action) =>
        action.type === 'RESOLVE_ABILITY' &&
        action.payload.step === 'PLACE_REVEALED_HAND_LIVE_TO_DECK_BOTTOM'
    );
    const inspectionIndex = completed.actionHistory.findIndex(
      (action) => action.type === 'RESOLVE_ABILITY' && action.payload.step === 'START_INSPECTION'
    );
    expect(placementIndex).toBeLessThan(inspectionIndex);
  });
});
