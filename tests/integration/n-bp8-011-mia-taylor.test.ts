import { describe, expect, it } from 'vitest';
import {
  N_BP8_011_DECK_REFRESH_DRAW_TWO_DISCARD_ONE_ABILITY_ID as REFRESH_ABILITY,
  N_BP8_011_LIVE_SUCCESS_OPTIONAL_MILL_TOP_FIVE_ABILITY_ID as MILL_ABILITY,
} from '../../src/application/card-effects/ability-ids';
import {
  confirmActiveEffectStep,
  enqueueTriggeredCardEffects,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import { getAbilityTurnLimitStatus } from '../../src/application/card-effects/runtime/ability-turn-limit';
import {
  enqueueUntriggeredWaitingRoomCardsMovedToMainDeckCardEffects,
  moveWaitingRoomCardsToDeckBottomAndEnqueueTriggers,
} from '../../src/application/card-effects/runtime/waiting-room-main-deck-triggers';
import { sendStageMemberToWaitingRoomAndEnqueueLeaveStageTriggers } from '../../src/application/card-effects/runtime/leave-stage-triggers';
import { discardHandCardsToWaitingRoomAndEnqueueTriggers } from '../../src/application/card-effects/runtime/enter-waiting-room-triggers';
import { moveTopDeckCardsToWaitingRoomWithRefreshAndEnqueueTriggers } from '../../src/application/card-effects/runtime/main-deck-waiting-room-triggers';
import { drawCardsFromMainDeckToHand } from '../../src/application/effects/draw';
import { inspectTopCards } from '../../src/application/effects/look-top';
import { revealCheerCardsFromMainDeck } from '../../src/application/effects/cheer';
import { applyPendingRefreshForPlayer } from '../../src/application/effects/refresh';
import {
  createAutoAdvancePublicRevealCommand,
  createConfirmEffectStepCommand,
  createConfirmStepCommand,
} from '../../src/application/game-commands';
import { createGameSession } from '../../src/application/game-session';
import {
  createCardInstance,
  createHeartRequirement,
  type MemberCardData,
} from '../../src/domain/entities/card';
import {
  createGameState,
  emitGameEvent,
  registerCards,
  updatePlayer,
  type GameState,
} from '../../src/domain/entities/game';
import { placeCardInSlot } from '../../src/domain/entities/zone';
import { createEnterStageEvent, createLiveSuccessEvent } from '../../src/domain/events/game-events';
import { applyRuleActionResult, ruleActionProcessor } from '../../src/domain/rules/rule-actions';
import {
  BladeHeartEffect,
  CardType,
  EffectWindowType,
  GamePhase,
  HeartColor,
  SlotPosition,
  SubPhase,
  TriggerCondition,
  TurnType,
  ZoneType,
} from '../../src/shared/types/enums';

const P1 = 'player1';
const P2 = 'player2';

function card(id: string, mia = false, drawBladeHeart = false) {
  const data: MemberCardData = {
    cardCode: mia ? 'PL!N-bp8-011-P' : `TEST-${id}`,
    name: mia ? '米娅·泰勒' : id,
    cardType: CardType.MEMBER,
    cost: mia ? 4 : 1,
    blade: mia ? 2 : 0,
    hearts: [{ color: HeartColor.PINK, count: 1 }],
    bladeHearts: drawBladeHeart ? [{ effect: BladeHeartEffect.DRAW }] : [],
    groupNames: ['虹ヶ咲'],
  };
  return createCardInstance(data, P1, id);
}

function setup(
  options: {
    miaCount?: number;
    deckCount?: number;
    waitingCount?: number;
    drawBladeHearts?: boolean;
  } = {}
) {
  const mias = Array.from({ length: options.miaCount ?? 1 }, (_, i) => card(`mia-${i}`, true));
  const deck = Array.from({ length: options.deckCount ?? 8 }, (_, i) =>
    card(`deck-${i}`, false, options.drawBladeHearts)
  );
  const waiting = Array.from({ length: options.waitingCount ?? 0 }, (_, i) =>
    card(`wait-${i}`, false, options.drawBladeHearts)
  );
  const live = createCardInstance(
    {
      cardCode: 'TEST-LIVE',
      name: '测试LIVE',
      cardType: CardType.LIVE,
      score: 1,
      requirements: createHeartRequirement({ [HeartColor.PINK]: 1 }),
    },
    P1,
    'live'
  );
  let game = registerCards(createGameState('mia-bp8', P1, 'P1', P2, 'P2'), [
    ...mias,
    ...deck,
    ...waiting,
    live,
  ]);
  game = updatePlayer(game, P1, (player) => {
    let memberSlots = player.memberSlots;
    for (const [i, source] of mias.entries()) {
      memberSlots = placeCardInSlot(
        memberSlots,
        [SlotPosition.LEFT, SlotPosition.CENTER, SlotPosition.RIGHT][i]!,
        source.instanceId
      );
    }
    return {
      ...player,
      memberSlots,
      mainDeck: { ...player.mainDeck, cardIds: deck.map((c) => c.instanceId) },
      waitingRoom: { ...player.waitingRoom, cardIds: waiting.map((c) => c.instanceId) },
      liveZone: { ...player.liveZone, cardIds: [live.instanceId] },
    };
  });
  return { game, mias, deck, waiting, live };
}

function refreshEvents(game: GameState) {
  return game.eventLog
    .map((entry) => entry.event)
    .filter(
      (event) =>
        event.eventType === TriggerCondition.ON_WAITING_ROOM_CARDS_MOVED_TO_MAIN_DECK &&
        event.cause.kind === 'RULE_ACTION' &&
        event.cause.ruleAction === 'REFRESH'
    );
}

function triggered(game: GameState) {
  return game.actionHistory.filter(
    (action) => action.type === 'TRIGGER_ABILITY' && action.payload.abilityId === REFRESH_ABILITY
  );
}

function used(game: GameState) {
  return game.actionHistory.filter(
    (action) =>
      action.type === 'RESOLVE_ABILITY' &&
      action.payload.abilityId === REFRESH_ABILITY &&
      action.payload.step === 'ABILITY_USE'
  );
}

function discard(game: GameState) {
  const effect = game.activeEffect!;
  expect(effect.abilityId).toBe(REFRESH_ABILITY);
  return confirmActiveEffectStep(game, P1, effect.id, effect.selectableCardIds![0]);
}

function startSuccess(game: GameState) {
  const event = createLiveSuccessEvent(P1, ['live'], 1);
  return resolvePendingCardEffects(
    enqueueTriggeredCardEffects(emitGameEvent(game, event), [TriggerCondition.ON_LIVE_SUCCESS], {
      liveSuccessEvents: [event],
    })
  ).gameState;
}

describe('PL!N-bp8-011-P 费用4「米娅·泰勒」', () => {
  it('GameSession reveals the entire multi-card cheer batch and draws every DRAW BLADE HEART before opening AUTO ordering', () => {
    const scenario = setup({ miaCount: 2, deckCount: 1, waitingCount: 14, drawBladeHearts: true });
    const session = createGameSession();
    session.createGame('mia-cheer-session', P1, 'P1', P2, 'P2');
    (session as unknown as { authorityState: GameState }).authorityState = {
      ...scenario.game,
      currentPhase: GamePhase.PERFORMANCE_PHASE,
      currentSubPhase: SubPhase.PERFORMANCE_LIVE_START_EFFECTS,
      currentTurnType: TurnType.FIRST_PLAYER_TURN,
      activePlayerIndex: 0,
      firstPlayerIndex: 0,
      effectWindowType: EffectWindowType.LIVE_START,
      liveResolution: { ...scenario.game.liveResolution, isInLive: true, performingPlayerId: P1 },
    };

    const result = session.executeCommand(
      createConfirmStepCommand(P1, SubPhase.PERFORMANCE_LIVE_START_EFFECTS)
    );
    expect(result.success, result.error).toBe(true);
    const state = session.state!;
    expect(refreshEvents(state)).toHaveLength(1);
    expect(state.resolutionZone.revealedCardIds).toHaveLength(4);
    const cheerAction = state.actionHistory.find((action) => action.type === 'CHEER')!;
    expect(cheerAction.payload.cheerCardIds).toEqual(state.resolutionZone.revealedCardIds);
    expect(cheerAction.payload.bladeHeartDrawCount).toBe(4);
    expect(cheerAction.payload.bladeHeartDrawnCardIds).toEqual(state.players[0].hand.cardIds);
    expect(state.players[0].hand.cardIds).toHaveLength(4);
    expect(state.activeEffect?.abilityId).toBe('system:select-pending-card-effect');
    expect(
      state.pendingAbilities.filter((ability) => ability.abilityId === REFRESH_ABILITY)
    ).toHaveLength(2);
    expect(used(state)).toHaveLength(0);

    const choose = session.executeCommand(
      createConfirmEffectStepCommand(P1, state.activeEffect!.id, scenario.mias[1]!.instanceId)
    );
    expect(choose.success, choose.error).toBe(true);
    expect(session.state!.activeEffect?.abilityId).toBe(REFRESH_ABILITY);
    expect(session.state!.players[0].hand.cardIds).toHaveLength(6);
    const firstUse = used(session.state!)[0]!;
    expect(firstUse.sequence).toBeGreaterThan(cheerAction.sequence);
    const firstDiscard = session.state!.activeEffect!.selectableCardIds![0]!;
    expect(
      session.executeCommand(
        createConfirmEffectStepCommand(P1, session.state!.activeEffect!.id, firstDiscard)
      ).success
    ).toBe(true);
    expect(session.state!.activeEffect?.sourceCardId).toBe(scenario.mias[0]!.instanceId);
    expect(session.state!.players[0].hand.cardIds).toHaveLength(7);
    expect(
      session.executeCommand(
        createConfirmEffectStepCommand(
          P1,
          session.state!.activeEffect!.id,
          session.state!.activeEffect!.selectableCardIds![0]
        )
      ).success
    ).toBe(true);
    expect(session.state!.activeEffect).toBeNull();
    expect(used(session.state!)).toHaveLength(2);
    for (const mia of scenario.mias)
      expect(
        getAbilityTurnLimitStatus(session.state!, P1, REFRESH_ABILITY, mia.instanceId)?.remaining
      ).toBe(0);
  });

  it.each(['draw', 'mill', 'look', 'cheer', 'rule action'] as const)(
    '%s refresh uses the same central fact and cannot dispatch it twice',
    (entry) => {
      const scenario = setup({ deckCount: entry === 'rule action' ? 0 : 1, waitingCount: 6 });
      let state = scenario.game;
      switch (entry) {
        case 'draw':
          state = drawCardsFromMainDeckToHand(state, P1, 1)!.gameState;
          break;
        case 'mill':
          state = moveTopDeckCardsToWaitingRoomWithRefreshAndEnqueueTriggers(
            state,
            P1,
            2,
            enqueueTriggeredCardEffects
          )!.gameState;
          break;
        case 'look':
          state = inspectTopCards(state, P1, { count: 2 })!.gameState;
          break;
        case 'cheer':
          state = revealCheerCardsFromMainDeck(state, P1, 2).gameState;
          break;
        case 'rule action':
          state = applyRuleActionResult(
            state,
            ruleActionProcessor.executeRefresh(P1),
            (id) => state.cardRegistry.get(id)?.data.cardType ?? null
          );
          break;
      }
      expect(refreshEvents(state)).toHaveLength(1);
      expect(refreshEvents(state)[0]).toMatchObject({
        refreshStageSources: [{ sourceCardId: 'mia-0', sourceSlot: SlotPosition.LEFT }],
      });
      expect(state.activeEffect).toBeNull();
      const queued = enqueueUntriggeredWaitingRoomCardsMovedToMainDeckCardEffects(state);
      expect(
        queued.pendingAbilities.filter((ability) => ability.abilityId === REFRESH_ABILITY)
      ).toHaveLength(1);
      expect(enqueueUntriggeredWaitingRoomCardsMovedToMainDeckCardEffects(queued)).toBe(queued);
      const opened = resolvePendingCardEffects(queued).gameState;
      expect(opened.activeEffect?.abilityId).toBe(REFRESH_ABILITY);
      expect(opened.activeEffect?.confirmSelectionLabel).toBe('放置入休息室');
      expect(confirmActiveEffectStep(opened, P1, opened.activeEffect!.id)).toBe(opened);
      const illegal = confirmActiveEffectStep(opened, P1, opened.activeEffect!.id, 'not-in-hand');
      expect(illegal).toBe(opened);
      expect(discard(opened).activeEffect).toBeNull();
    }
  );

  it('records use before drawing two so a second refresh in those draws does not recursively trigger', () => {
    const scenario = setup({ deckCount: 0, waitingCount: 1 });
    const laterDiscard = card('later-discard');
    let state = registerCards(scenario.game, [laterDiscard]);
    state = updatePlayer(state, P1, (player) => ({
      ...player,
      hand: { ...player.hand, cardIds: [laterDiscard.instanceId] },
    }));
    state = applyPendingRefreshForPlayer(state, P1);
    state = discardHandCardsToWaitingRoomAndEnqueueTriggers(
      state,
      P1,
      [laterDiscard.instanceId],
      { count: 1 },
      enqueueTriggeredCardEffects
    )!.gameState;
    const opened = resolvePendingCardEffects(state).gameState;
    expect(refreshEvents(opened)).toHaveLength(2);
    expect(opened.players[0].hand.cardIds).toEqual(['wait-0', 'later-discard']);
    expect(used(opened)).toHaveLength(1);
    const refreshActions = opened.actionHistory.filter(
      (action) => action.type === 'RULE_ACTION' && action.payload.type === 'REFRESH'
    );
    expect(refreshActions).toHaveLength(2);
    expect(used(opened)[0]!.sequence).toBeLessThan(refreshActions[1]!.sequence);
    const finished = discard(opened);
    expect(triggered(finished)).toHaveLength(1);
    expect(used(finished)).toHaveLength(1);
    expect(finished.activeEffect).toBeNull();
  });

  it('does not trigger from an ordinary waiting-room return or an opponent refresh', () => {
    const scenario = setup({ waitingCount: 2 });
    const returned = moveWaitingRoomCardsToDeckBottomAndEnqueueTriggers(
      scenario.game,
      P1,
      ['wait-0'],
      {
        candidateCardIds: ['wait-0', 'wait-1'],
        minCount: 1,
        maxCount: 1,
        cause: {
          kind: 'CARD_EFFECT',
          playerId: P1,
          sourceCardId: 'mia-0',
          abilityId: MILL_ABILITY,
          pendingAbilityId: 'test',
        },
      }
    )!;
    expect(triggered(returned.gameState)).toHaveLength(0);
    let other = updatePlayer(returned.gameState, P2, (player) => ({
      ...player,
      waitingRoom: { ...player.waitingRoom, cardIds: ['opponent-wait'] },
    }));
    other = applyPendingRefreshForPlayer(other, P2);
    expect(
      triggered(enqueueUntriggeredWaitingRoomCardsMovedToMainDeckCardEffects(other))
    ).toHaveLength(0);
  });

  it('one lifecycle uses AUTO once this turn and can use it again next turn', () => {
    const scenario = setup({ deckCount: 0, waitingCount: 7 });
    const first = discard(
      resolvePendingCardEffects(applyPendingRefreshForPlayer(scenario.game, P1)).gameState
    );
    const sameTurnRefresh = applyRuleActionResult(
      first,
      ruleActionProcessor.executeRefresh(P1),
      (id) => first.cardRegistry.get(id)?.data.cardType ?? null
    );
    const sameTurnResolved = resolvePendingCardEffects(sameTurnRefresh).gameState;
    expect(sameTurnResolved.activeEffect).toBeNull();
    expect(used(sameTurnResolved)).toHaveLength(1);
    expect(triggered(sameTurnResolved)).toHaveLength(1);
    const nextTurn = { ...sameTurnResolved, turnCount: sameTurnResolved.turnCount + 1 };
    const discardCandidate = nextTurn.players[0].hand.cardIds[0]!;
    const withWaiting = discardHandCardsToWaitingRoomAndEnqueueTriggers(
      nextTurn,
      P1,
      [discardCandidate],
      { count: 1 },
      enqueueTriggeredCardEffects
    )!.gameState;
    const refreshed = applyRuleActionResult(
      withWaiting,
      ruleActionProcessor.executeRefresh(P1),
      (id) => withWaiting.cardRegistry.get(id)?.data.cardType ?? null
    );
    const second = resolvePendingCardEffects(refreshed).gameState;
    expect(second.activeEffect?.abilityId).toBe(REFRESH_ABILITY);
    expect(used(discard(second))).toHaveLength(2);
  });

  it('captures no source at refresh, so a later stage entry cannot consume that history', () => {
    const scenario = setup({ miaCount: 0, deckCount: 0, waitingCount: 4 });
    const refreshed = applyPendingRefreshForPlayer(scenario.game, P1);
    expect(refreshEvents(refreshed)[0]).toMatchObject({ refreshStageSources: [] });
    const mia = card('late-mia', true);
    let later = registerCards(refreshed, [mia]);
    later = updatePlayer(later, P1, (player) => ({
      ...player,
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.LEFT, mia.instanceId),
    }));
    later = emitGameEvent(
      later,
      createEnterStageEvent(mia.instanceId, ZoneType.HAND, SlotPosition.LEFT, P1, P1)
    );
    expect(
      triggered(enqueueUntriggeredWaitingRoomCardsMovedToMainDeckCardEffects(later))
    ).toHaveLength(0);
  });

  it('the optional LIVE_SUCCESS mill keeps its reveal active until expiry, then a departed source still draws and discards', () => {
    const scenario = setup({ deckCount: 2, waitingCount: 7 });
    let now = 10_000;
    const session = createGameSession({ now: () => now });
    session.createGame('mia-mill-session', P1, 'P1', P2, 'P2');
    (session as unknown as { authorityState: GameState }).authorityState = startSuccess(
      scenario.game
    );
    expect(session.state!.activeEffect).toMatchObject({
      abilityId: MILL_ABILITY,
      selectableOptions: [{ id: 'activate', label: '发动' }],
      canSkipSelection: true,
      skipSelectionLabel: '不发动',
    });
    expect(
      session.executeCommand(
        createConfirmEffectStepCommand(
          P1,
          session.state!.activeEffect!.id,
          undefined,
          undefined,
          undefined,
          'activate'
        )
      ).success
    ).toBe(true);
    const reveal = session.state!.activeEffect!;
    expect(reveal.abilityId).toBe(MILL_ABILITY);
    expect(reveal.stepId).toBe('COMMON_PUBLIC_REVEAL_DWELL');
    const millAction = session.state!.actionHistory.find(
      (action) =>
        action.type === 'RESOLVE_ABILITY' &&
        action.payload.abilityId === MILL_ABILITY &&
        action.payload.step === 'MILL_TOP_CARDS'
    )!;
    const milledCardIds = millAction.payload.milledCardIds as readonly string[];
    expect(milledCardIds).toHaveLength(5);
    expect(reveal.revealedCardIds).toEqual([...new Set(milledCardIds)]);
    expect(refreshEvents(session.state!)).toHaveLength(1);
    expect(used(session.state!)).toHaveLength(0);
    for (const playerId of [P1, P2])
      expect(session.getPlayerViewState(playerId)?.activeEffect?.revealedObjectIds).toHaveLength(
        new Set(milledCardIds).size
      );
    const departed = sendStageMemberToWaitingRoomAndEnqueueLeaveStageTriggers(
      session.state!,
      P1,
      'mia-0',
      enqueueTriggeredCardEffects
    )!.gameState;
    (session as unknown as { authorityState: GameState }).authorityState = departed;
    const premature = session.executeCommand(
      createAutoAdvancePublicRevealCommand(
        P1,
        reveal.id,
        reveal.publicRevealAutoAdvanceAt!,
        reveal.publicRevealGeneration!
      )
    );
    expect(premature.success).toBe(false);
    expect(session.state!.activeEffect?.abilityId).toBe(MILL_ABILITY);
    now = reveal.publicRevealAutoAdvanceAt!;
    expect(
      session.executeCommand(
        createAutoAdvancePublicRevealCommand(
          P1,
          reveal.id,
          reveal.publicRevealAutoAdvanceAt!,
          reveal.publicRevealGeneration!
        )
      ).success
    ).toBe(true);
    expect(session.state!.activeEffect?.abilityId).toBe(REFRESH_ABILITY);
    expect(session.state!.players[0].hand.cardIds).toHaveLength(2);
    expect(session.state!.players[0].memberSlots.slots[SlotPosition.LEFT]).toBeNull();
    expect(
      session.executeCommand(
        createConfirmEffectStepCommand(
          P1,
          session.state!.activeEffect!.id,
          session.state!.activeEffect!.selectableCardIds![0]
        )
      ).success
    ).toBe(true);
    expect(session.state!.activeEffect).toBeNull();
    expect(session.state!.players[0].hand.cardIds).toHaveLength(1);
  });

  it('old refresh pending keeps its lifecycle across re-entry and does not consume the new source turn limit', () => {
    const scenario = setup({ deckCount: 0, waitingCount: 6 });
    const initialEntry = createEnterStageEvent('mia-0', ZoneType.HAND, SlotPosition.LEFT, P1, P1);
    let state = emitGameEvent(scenario.game, initialEntry);
    state = applyPendingRefreshForPlayer(state, P1);
    state = sendStageMemberToWaitingRoomAndEnqueueLeaveStageTriggers(
      state,
      P1,
      'mia-0',
      enqueueTriggeredCardEffects
    )!.gameState;
    state = updatePlayer(state, P1, (player) => ({
      ...player,
      waitingRoom: {
        ...player.waitingRoom,
        cardIds: player.waitingRoom.cardIds.filter((id) => id !== 'mia-0'),
      },
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.LEFT, 'mia-0'),
    }));
    const reentry = createEnterStageEvent(
      'mia-0',
      ZoneType.WAITING_ROOM,
      SlotPosition.LEFT,
      P1,
      P1
    );
    state = emitGameEvent(state, reentry);
    const opened = resolvePendingCardEffects(state).gameState;
    expect(opened.activeEffect?.sourceLifecycleId).toBe(
      `source-lifecycle:event:${initialEntry.eventId}`
    );
    const finished = discard(opened);
    expect(used(finished)[0]!.payload.sourceLifecycleId).toBe(
      `source-lifecycle:event:${initialEntry.eventId}`
    );
    expect(getAbilityTurnLimitStatus(finished, P1, REFRESH_ABILITY, 'mia-0')?.remaining).toBe(1);
    const newRefresh = applyRuleActionResult(
      finished,
      ruleActionProcessor.executeRefresh(P1),
      (id) => finished.cardRegistry.get(id)?.data.cardType ?? null
    );
    const newOpened = resolvePendingCardEffects(newRefresh).gameState;
    expect(newOpened.activeEffect?.sourceLifecycleId).toBe(
      `source-lifecycle:event:${reentry.eventId}`
    );
    expect(used(discard(newOpened))).toHaveLength(2);
  });

  it('declining the optional mill changes no deck cards and causes no refresh', () => {
    const scenario = setup({ deckCount: 2, waitingCount: 7 });
    const opened = startSuccess(scenario.game);
    expect(
      confirmActiveEffectStep(
        opened,
        P1,
        opened.activeEffect!.id,
        undefined,
        undefined,
        undefined,
        'invalid'
      )
    ).toBe(opened);
    const declined = confirmActiveEffectStep(opened, P1, opened.activeEffect!.id);
    expect(declined.activeEffect).toBeNull();
    expect(declined.players[0].mainDeck.cardIds).toEqual(scenario.game.players[0].mainDeck.cardIds);
    expect(declined.players[0].waitingRoom.cardIds).toEqual(
      scenario.game.players[0].waitingRoom.cardIds
    );
    expect(refreshEvents(declined)).toHaveLength(0);
  });
});
