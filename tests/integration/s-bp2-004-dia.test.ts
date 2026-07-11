import { describe, expect, it } from 'vitest';
import type { LiveCardData, MemberCardData } from '../../src/domain/entities/card';
import { createCardInstance, createHeartIcon, createHeartRequirement } from '../../src/domain/entities/card';
import {
  createGameState,
  emitGameEvent,
  registerCards,
  updatePlayer,
  type GameState,
  type PendingAbilityState,
} from '../../src/domain/entities/game';
import { createCheerEvent } from '../../src/domain/events/game-events';
import { placeCardInSlot } from '../../src/domain/entities/zone';
import {
  confirmActiveEffectStep,
  enqueueTriggeredCardEffects,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import { selectCurrentLiveRevealedCheerCardIds } from '../../src/application/effects/cheer-selection';
import {
  S_BP2_003_AUTO_ON_CHEER_LIVE_GAIN_GREEN_HEART_ABILITY_ID,
  S_BP2_004_AUTO_ON_CHEER_NO_LIVE_REROLL_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
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
const ABILITY_ID = S_BP2_004_AUTO_ON_CHEER_NO_LIVE_REROLL_ABILITY_ID;

function member(cardCode: string, blade = 1): MemberCardData {
  return {
    cardCode,
    name: cardCode,
    cardType: CardType.MEMBER,
    cost: 11,
    blade,
    hearts: [createHeartIcon(HeartColor.RED, 1)],
  };
}

function live(cardCode: string): LiveCardData {
  return {
    cardCode,
    name: cardCode,
    cardType: CardType.LIVE,
    score: 1,
    requirements: createHeartRequirement({ [HeartColor.RED]: 1 }),
  };
}

function setup(options: {
  readonly revealed: readonly ReturnType<typeof createCardInstance>[];
  readonly deck?: readonly ReturnType<typeof createCardInstance>[];
  readonly sourceOnStage?: boolean;
  readonly keepInResolution?: readonly string[];
  readonly additional?: boolean;
}) {
  const source = createCardInstance(member('PL!S-bp2-004-P', 2), PLAYER1, 'dia');
  const deck = options.deck ?? [];
  let game = registerCards(createGameState('s-bp2-004', PLAYER1, 'P1', PLAYER2, 'P2'), [
    source,
    ...options.revealed,
    ...deck,
  ]);
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    mainDeck: { ...player.mainDeck, cardIds: deck.map((card) => card.instanceId) },
    memberSlots:
      options.sourceOnStage === false
        ? player.memberSlots
        : placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId, {
            orientation: OrientationState.ACTIVE,
            face: FaceState.FACE_UP,
          }),
  }));
  const event = createCheerEvent(
    PLAYER1,
    options.revealed.map((card) => card.instanceId),
    2,
    { additional: options.additional === true }
  );
  game = emitGameEvent(game, event);
  const currentIds = options.keepInResolution ?? options.revealed.map((card) => card.instanceId);
  game = {
    ...game,
    liveResolution: {
      ...game.liveResolution,
      isInLive: true,
      performingPlayerId: PLAYER1,
      firstPlayerCheerCardIds: options.revealed.map((card) => card.instanceId),
    },
    resolutionZone: {
      ...game.resolutionZone,
      cardIds: currentIds,
      revealedCardIds: currentIds,
    },
  };
  return { game, source, event };
}

function queueAndStart(game: GameState, eventId: string): GameState {
  const queued = enqueueTriggeredCardEffects(game, [TriggerCondition.ON_CHEER], {
    cheerEvents: game.eventLog
      .map((entry) => entry.event)
      .filter(
        (event): event is ReturnType<typeof createCheerEvent> =>
          event.eventType === TriggerCondition.ON_CHEER && event.eventId === eventId
      ),
  });
  return resolvePendingCardEffects(queued).gameState;
}

function didUse(game: GameState): boolean {
  return game.actionHistory.some(
    (action) => action.type === 'RESOLVE_ABILITY' && action.payload.abilityId === ABILITY_ID && action.payload.step === 'ABILITY_USE'
  );
}

function bp2003UseCount(game: GameState): number {
  return game.actionHistory.filter(
    (action) =>
      action.type === 'RESOLVE_ABILITY' &&
      action.payload.abilityId === S_BP2_003_AUTO_ON_CHEER_LIVE_GAIN_GREEN_HEART_ABILITY_ID &&
      action.payload.step === 'ABILITY_USE'
  ).length;
}

function addBp2003BeforeCheer(game: GameState) {
  const kanan = createCardInstance(member('PL!S-bp2-003-P'), PLAYER1, 'kanan');
  return {
    kanan,
    game: updatePlayer(registerCards(game, [kanan]), PLAYER1, (player) => ({
      ...player,
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.LEFT, kanan.instanceId),
    })),
  };
}

describe('PL!S-bp2-004 黒澤ダイヤ', () => {
  it('opens the real optional decision for P/R base-card definitions and keeps the exact visible text', () => {
    const first = createCardInstance(member('CHEER-MEMBER-1'), PLAYER1, 'first');
    const second = createCardInstance(member('CHEER-MEMBER-2'), PLAYER1, 'second');
    const scenario = setup({ revealed: [first, second] });
    const started = queueAndStart(scenario.game, scenario.event.eventId);

    expect(started.activeEffect).toMatchObject({
      abilityId: ABILITY_ID,
      effectText:
        '【自动】【1回合1次】声援被公开的自己的卡片中不存在LIVE卡时, 可以将那些卡片全部放置入休息室。因此放置入休息室的卡片大于等于1张的场合, 失去该声援获得的BLADE HEART, 再确认一次声援。',
      stepText:
        '本次声援公开的卡片中不存在LIVE卡。可以将这些卡片全部放置入休息室；如此做时，失去本次声援获得的BLADE HEART，并重新进行声援。',
      selectableOptions: [{ id: 'reroll', label: '全部放置入休息室并重新进行声援' }],
      canSkipSelection: true,
      skipSelectionLabel: '不发动',
    });
    expect(started.activeEffect?.effectText).toContain('BLADE HEART');
  });

  it('declines without consuming turn1, while malformed option input preserves the window', () => {
    const first = createCardInstance(member('CHEER-MEMBER'), PLAYER1, 'first');
    const scenario = setup({ revealed: [first] });
    const started = queueAndStart(scenario.game, scenario.event.eventId);
    const invalid = confirmActiveEffectStep(
      started,
      PLAYER1,
      started.activeEffect!.id,
      undefined,
      undefined,
      false,
      'not-an-option'
    );
    const nullOption = confirmActiveEffectStep(
      started,
      PLAYER1,
      started.activeEffect!.id,
      undefined,
      undefined,
      false,
      null
    );
    expect(invalid).toBe(started);
    expect(nullOption).toBe(started);

    const declined = confirmActiveEffectStep(started, PLAYER1, started.activeEffect!.id, null);
    expect(declined.activeEffect).toBeNull();
    expect(declined.players[0].waitingRoom.cardIds).toEqual([]);
    expect(didUse(declined)).toBe(false);
    const laterEvent = createCheerEvent(PLAYER1, [first.instanceId], 2);
    expect(queueAndStart(emitGameEvent(declined, laterEvent), laterEvent.eventId).activeEffect).not.toBeNull();
  });

  it('uses original event facts for the LIVE condition and safely consumes opponent, additional, source-stale, and fully-stale pending', () => {
    const revealedLive = createCardInstance(live('CHEER-LIVE'), PLAYER1, 'live');
    const liveScenario = setup({ revealed: [revealedLive], keepInResolution: [] });
    const liveResult = queueAndStart(liveScenario.game, liveScenario.event.eventId);
    expect(liveResult.activeEffect).toBeNull();
    expect(didUse(liveResult)).toBe(false);

    const additional = setup({ revealed: [createCardInstance(member('ADDITIONAL'), PLAYER1, 'additional')], additional: true });
    expect(queueAndStart(additional.game, additional.event.eventId).activeEffect).toBeNull();

    const sourceStale = setup({ revealed: [createCardInstance(member('STALE'), PLAYER1, 'stale')], sourceOnStage: false });
    expect(queueAndStart(sourceStale.game, sourceStale.event.eventId).activeEffect).toBeNull();

    const fullyStale = setup({ revealed: [createCardInstance(member('GONE'), PLAYER1, 'gone')], keepInResolution: [] });
    const fullyStaleResult = queueAndStart(fullyStale.game, fullyStale.event.eventId);
    expect(fullyStaleResult.activeEffect).toBeNull();
    expect(didUse(fullyStaleResult)).toBe(false);
  });

  it('moves all still-legal original cards, records use before a normal reroll, and replaces only its current cheer facts', () => {
    const oldOne = createCardInstance(member('OLD-ONE'), PLAYER1, 'old-one');
    const oldTwo = createCardInstance(member('OLD-TWO'), PLAYER1, 'old-two');
    const newOne = createCardInstance(live('NEW-LIVE'), PLAYER1, 'new-one');
    const newTwo = createCardInstance(member('NEW-MEMBER'), PLAYER1, 'new-two');
    const deckRemainder = createCardInstance(member('DECK-REMAINDER'), PLAYER1, 'deck-remainder');
    const opponentCheer = createCardInstance(member('OPPONENT-CHEER'), PLAYER2, 'opponent-cheer');
    const kanan = createCardInstance(member('PL!S-bp2-003-P'), PLAYER1, 'kanan');
    const scenario = setup({ revealed: [oldOne, oldTwo], deck: [newOne, newTwo, deckRemainder] });
    const withOpponentFact = registerCards(scenario.game, [opponentCheer]);
    const game = {
      ...withOpponentFact,
      liveResolution: {
        ...withOpponentFact.liveResolution,
        secondPlayerCheerCardIds: [opponentCheer.instanceId],
      },
    };
    const started = queueAndStart(game, scenario.event.eventId);
    const startedWithKanan = updatePlayer(registerCards(started, [kanan]), PLAYER1, (player) => ({
      ...player,
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.LEFT, kanan.instanceId),
    }));
    const resolved = confirmActiveEffectStep(
      startedWithKanan,
      PLAYER1,
      startedWithKanan.activeEffect!.id,
      undefined,
      undefined,
      false,
      'reroll'
    );

    expect(resolved.players[0].waitingRoom.cardIds).toEqual([oldOne.instanceId, oldTwo.instanceId]);
    expect(resolved.liveResolution.firstPlayerCheerCardIds).toEqual([newOne.instanceId, newTwo.instanceId]);
    expect(resolved.liveResolution.secondPlayerCheerCardIds).toEqual([opponentCheer.instanceId]);
    expect(resolved.resolutionZone.revealedCardIds).toEqual([newOne.instanceId, newTwo.instanceId]);
    expect(selectCurrentLiveRevealedCheerCardIds(resolved, PLAYER1)).toEqual([
      newOne.instanceId,
      newTwo.instanceId,
    ]);
    expect(didUse(resolved)).toBe(true);
    const secondEvent = resolved.eventLog.map((entry) => entry.event).at(-1);
    expect(secondEvent).toMatchObject({
      eventType: TriggerCondition.ON_CHEER,
      playerId: PLAYER1,
      revealedCardIds: [newOne.instanceId, newTwo.instanceId],
      totalBlade: 2,
      automated: true,
      additional: false,
    });
    expect(
      resolved.pendingAbilities.some((ability) => ability.abilityId === ABILITY_ID)
    ).toBe(false);
    expect(
      resolved.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId === S_BP2_003_AUTO_ON_CHEER_LIVE_GAIN_GREEN_HEART_ABILITY_ID &&
          action.payload.step === 'ABILITY_USE'
      )
    ).toBe(true);
  });

  it('keeps first and rerolled CheerEvent pending abilities distinct when manually selecting 004 from a real multi-pending window', () => {
    const oldOne = createCardInstance(member('OLD-ONE'), PLAYER1, 'old-one');
    const oldTwo = createCardInstance(member('OLD-TWO'), PLAYER1, 'old-two');
    const rerolledLive = createCardInstance(live('REROLLED-LIVE'), PLAYER1, 'rerolled-live');
    const rerolledMember = createCardInstance(member('REROLLED-MEMBER'), PLAYER1, 'rerolled-member');
    const deckRemainder = createCardInstance(member('DECK-REMAINDER'), PLAYER1, 'deck-remainder');
    const scenario = setup({ revealed: [oldOne, oldTwo], deck: [rerolledLive, rerolledMember, deckRemainder] });
    const withBp2003 = addBp2003BeforeCheer(scenario.game);
    const queued = enqueueTriggeredCardEffects(withBp2003.game, [TriggerCondition.ON_CHEER], {
      cheerEvents: [scenario.event],
    });

    expect(queued.pendingAbilities.map((ability) => ability.abilityId)).toEqual([
      S_BP2_003_AUTO_ON_CHEER_LIVE_GAIN_GREEN_HEART_ABILITY_ID,
      ABILITY_ID,
    ]);
    const orderSelection = resolvePendingCardEffects(queued).gameState;
    expect(orderSelection.activeEffect?.canResolveInOrder).toBe(true);

    const rerollDecision = confirmActiveEffectStep(
      orderSelection,
      PLAYER1,
      orderSelection.activeEffect!.id,
      scenario.source.instanceId
    );
    expect(rerollDecision.activeEffect).toMatchObject({
      abilityId: ABILITY_ID,
      selectableOptions: [{ id: 'reroll', label: '全部放置入休息室并重新进行声援' }],
      canSkipSelection: true,
    });

    const afterReroll = confirmActiveEffectStep(
      rerollDecision,
      PLAYER1,
      rerollDecision.activeEffect!.id,
      undefined,
      undefined,
      false,
      'reroll'
    );
    const resolved = afterReroll;

    expect(resolved.eventLog.map((entry) => entry.event).filter((event) => event.eventType === TriggerCondition.ON_CHEER)).toHaveLength(2);
    expect(resolved.liveResolution.firstPlayerCheerCardIds).toEqual([
      rerolledLive.instanceId,
      rerolledMember.instanceId,
    ]);
    const bp2003Resolutions = resolved.actionHistory.filter(
      (action) =>
        action.type === 'RESOLVE_ABILITY' &&
        action.payload.abilityId === S_BP2_003_AUTO_ON_CHEER_LIVE_GAIN_GREEN_HEART_ABILITY_ID &&
        action.payload.step === 'OWN_CHEER_LIVE_CONDITION_GAIN_GREEN_HEART'
    );
    const rerollEventId = resolved.eventLog
      .map((entry) => entry.event)
      .filter((event) => event.eventType === TriggerCondition.ON_CHEER)
      .at(-1)?.eventId;
    expect(
      bp2003Resolutions.some(
        (action) => action.payload.cheerEventId === scenario.event.eventId && action.payload.conditionMet === false
      )
    ).toBe(true);
    expect(
      bp2003Resolutions.some(
        (action) => action.payload.cheerEventId === rerollEventId && action.payload.conditionMet === true
      )
    ).toBe(true);
    expect(bp2003UseCount(resolved)).toBe(1);
    expect(didUse(resolved)).toBe(true);
    expect(resolved.pendingAbilities).toEqual([]);
    expect(resolved.activeEffect).toBeNull();
    expect(
      resolved.pendingAbilities.some((ability) => ability.abilityId === ABILITY_ID)
    ).toBe(false);
  });

  it('keeps 004 as a real optional window after choosing ordered resolution and then finishes both CheerEvent continuations', () => {
    const oldOne = createCardInstance(member('OLD-ONE'), PLAYER1, 'old-one');
    const oldTwo = createCardInstance(member('OLD-TWO'), PLAYER1, 'old-two');
    const rerolledLive = createCardInstance(live('REROLLED-LIVE'), PLAYER1, 'rerolled-live');
    const rerolledMember = createCardInstance(member('REROLLED-MEMBER'), PLAYER1, 'rerolled-member');
    const deckRemainder = createCardInstance(member('DECK-REMAINDER'), PLAYER1, 'deck-remainder');
    const scenario = setup({ revealed: [oldOne, oldTwo], deck: [rerolledLive, rerolledMember, deckRemainder] });
    const withBp2003 = addBp2003BeforeCheer(scenario.game);
    const queued = enqueueTriggeredCardEffects(withBp2003.game, [TriggerCondition.ON_CHEER], {
      cheerEvents: [scenario.event],
    });
    const orderSelection = resolvePendingCardEffects(queued).gameState;

    const rerollDecision = confirmActiveEffectStep(
      orderSelection,
      PLAYER1,
      orderSelection.activeEffect!.id,
      undefined,
      undefined,
      true
    );
    expect(rerollDecision.activeEffect).toMatchObject({
      abilityId: ABILITY_ID,
      selectableOptions: [{ id: 'reroll', label: '全部放置入休息室并重新进行声援' }],
      canSkipSelection: true,
    });
    expect(rerollDecision.activeEffect?.metadata?.confirmOnlyPendingAbility).not.toBe(true);

    const resolved = confirmActiveEffectStep(
      rerollDecision,
      PLAYER1,
      rerollDecision.activeEffect!.id,
      undefined,
      undefined,
      true,
      'reroll'
    );

    expect(resolved.eventLog.map((entry) => entry.event).filter((event) => event.eventType === TriggerCondition.ON_CHEER)).toHaveLength(2);
    expect(bp2003UseCount(resolved)).toBe(1);
    expect(didUse(resolved)).toBe(true);
    expect(resolved.pendingAbilities).toEqual([]);
    expect(resolved.activeEffect).toBeNull();
    expect(
      resolved.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId === ABILITY_ID &&
          action.payload.step === 'CONFIRM_PENDING_ABILITY'
      )
    ).toBe(false);
  });

  it('rechecks targets on activation: a partial stale set still rerolls, while an empty set does not consume turn1', () => {
    const oldOne = createCardInstance(member('OLD-ONE'), PLAYER1, 'old-one');
    const oldTwo = createCardInstance(member('OLD-TWO'), PLAYER1, 'old-two');
    const newCard = createCardInstance(member('NEW'), PLAYER1, 'new');
    const deckRemainder = createCardInstance(member('DECK-REMAINDER'), PLAYER1, 'deck-remainder');
    const deckTail = createCardInstance(member('DECK-TAIL'), PLAYER1, 'deck-tail');
    const partial = setup({ revealed: [oldOne, oldTwo], deck: [newCard, deckRemainder, deckTail] });
    const partialStarted = queueAndStart(partial.game, partial.event.eventId);
    const oneGone = {
      ...partialStarted,
      resolutionZone: {
        ...partialStarted.resolutionZone,
        cardIds: [oldTwo.instanceId],
        revealedCardIds: [oldTwo.instanceId],
      },
    };
    const partialResolved = confirmActiveEffectStep(
      oneGone,
      PLAYER1,
      oneGone.activeEffect!.id,
      undefined,
      undefined,
      false,
      'reroll'
    );
    expect(partialResolved.players[0].waitingRoom.cardIds).toEqual([oldTwo.instanceId]);
    expect(partialResolved.liveResolution.firstPlayerCheerCardIds).toEqual([
      newCard.instanceId,
      deckRemainder.instanceId,
    ]);
    expect(didUse(partialResolved)).toBe(true);

    const empty = setup({ revealed: [createCardInstance(member('OLD'), PLAYER1, 'old')] });
    const emptyStarted = queueAndStart(empty.game, empty.event.eventId);
    const allGone = {
      ...emptyStarted,
      resolutionZone: { ...emptyStarted.resolutionZone, cardIds: [], revealedCardIds: [] },
    };
    const emptyResolved = confirmActiveEffectStep(
      allGone,
      PLAYER1,
      allGone.activeEffect!.id,
      undefined,
      undefined,
      false,
      'reroll'
    );
    expect(emptyResolved.activeEffect).toBeNull();
    expect(didUse(emptyResolved)).toBe(false);
    expect(emptyResolved.actionHistory.some((action) => action.type === 'CHEER' && action.payload.automated === true)).toBe(false);
  });

  it('does not treat a manually injected unrelated event as this pending ability event', () => {
    const source = createCardInstance(member('PL!S-bp2-004-R'), PLAYER1, 'dia');
    const opponentCard = createCardInstance(member('OPPONENT'), PLAYER2, 'opponent');
    let game = registerCards(createGameState('s-bp2-004-opponent', PLAYER1, 'P1', PLAYER2, 'P2'), [source, opponentCard]);
    game = updatePlayer(game, PLAYER1, (player) => ({
      ...player,
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId),
    }));
    const opponentEvent = createCheerEvent(PLAYER2, [opponentCard.instanceId], 1);
    game = emitGameEvent(game, opponentEvent);
    const pending: PendingAbilityState = {
      id: 'bad-event',
      abilityId: ABILITY_ID,
      sourceCardId: source.instanceId,
      controllerId: PLAYER1,
      mandatory: true,
      timingId: TriggerCondition.ON_CHEER,
      eventIds: [opponentEvent.eventId],
    };
    const result = resolvePendingCardEffects({ ...game, pendingAbilities: [pending] }).gameState;
    expect(result.activeEffect).toBeNull();
    expect(didUse(result)).toBe(false);
  });
});
