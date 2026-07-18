import { describe, expect, it } from 'vitest';
import type { LiveCardData, MemberCardData } from '../../src/domain/entities/card';
import { createCardInstance, createHeartRequirement } from '../../src/domain/entities/card';
import { createGameState, emitGameEvent, registerCards, updatePlayer, type GameState } from '../../src/domain/entities/game';
import { addCardToStatefulZone } from '../../src/domain/entities/zone';
import { createCheerEvent } from '../../src/domain/events/game-events';
import { confirmActiveEffectStep, enqueueTriggeredCardEffects, resolvePendingCardEffects } from '../../src/application/card-effect-runner';
import { S_BP3_020_AUTO_ON_CHEER_AT_MOST_TWO_BLADE_HEART_REROLL_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
import { PUBLIC_CARD_SELECTION_CONFIRMATION_STEP_ID } from '../../src/application/card-effects/runtime/public-card-selection-confirmation';
import { createGameSession } from '../../src/application/game-session';
import { createAutoAdvancePublicCardSelectionCommand, createConfirmEffectStepCommand } from '../../src/application/game-commands';
import { createPublicObjectId, projectPlayerViewState } from '../../src/online/projector';
import { BladeHeartEffect, CardType, HeartColor, TriggerCondition } from '../../src/shared/types/enums';

const P1 = 'player1';
const P2 = 'player2';
const ABILITY_ID = S_BP3_020_AUTO_ON_CHEER_AT_MOST_TWO_BLADE_HEART_REROLL_ABILITY_ID;

function live(): LiveCardData {
  return { cardCode: 'PL!S-bp3-020-L', name: 'ダイスキだったらダイジョウブ！', cardType: CardType.LIVE, score: 1,
    requirements: createHeartRequirement({ [HeartColor.RED]: 1 }) };
}
function member(index: number, bladeHeart: boolean): MemberCardData {
  return { cardCode: `CHEER-${index}`, name: `CHEER-${index}`, cardType: CardType.MEMBER, cost: 1, blade: 1, hearts: [],
    bladeHearts: bladeHeart ? [{ effect: BladeHeartEffect.SCORE }] : [] };
}

function start(bladeHeartCount: number, totalCount = Math.max(1, bladeHeartCount), options: { sourceCount?: number; deckCount?: number; bottomCheer?: boolean } = {}) {
  const sources = Array.from({ length: options.sourceCount ?? 1 }, (_, index) =>
    createCardInstance(live(), P1, `source-020-${index}`)
  );
  const source = sources[0]!;
  const bottomCheerSource = options.bottomCheer
    ? createCardInstance(
        { ...live(), cardCode: 'PL!S-bp7-022-SECL', name: '想在水族馆恋爱' },
        P1,
        'bottom-cheer-source'
      )
    : null;
  const cards = Array.from({ length: totalCount }, (_, index) => createCardInstance(member(index, index < bladeHeartCount), P1, `cheer-${index}`));
  const deck = Array.from({ length: options.deckCount ?? 0 }, (_, index) =>
    createCardInstance(member(100 + index, false), P1, `deck-${index}`)
  );
  let game = registerCards(createGameState('s-bp3-020', P1, 'P1', P2, 'P2'), [...sources, ...(bottomCheerSource ? [bottomCheerSource] : []), ...cards, ...deck]);
  game = updatePlayer(game, P1, (player) => ({
    ...player,
    liveZone: [...sources, ...(bottomCheerSource ? [bottomCheerSource] : [])].reduce((zone, card) => addCardToStatefulZone(zone, card.instanceId), player.liveZone),
    mainDeck: { ...player.mainDeck, cardIds: deck.map((card) => card.instanceId) },
  }));
  const event = createCheerEvent(P1, cards.map((card) => card.instanceId), 2);
  game = emitGameEvent(game, event);
  game = { ...game,
    liveResolution: { ...game.liveResolution, isInLive: true, performingPlayerId: P1, firstPlayerCheerCardIds: cards.map((card) => card.instanceId) },
    resolutionZone: { ...game.resolutionZone, cardIds: cards.map((card) => card.instanceId), revealedCardIds: cards.map((card) => card.instanceId) },
  };
  const queued = enqueueTriggeredCardEffects(game, [TriggerCondition.ON_CHEER], { cheerEvents: [event] });
  return { state: resolvePendingCardEffects(queued).gameState, cards, deck, source, sources, event };
}

function createSession(state: GameState) {
  let now = 10_000;
  const session = createGameSession({ now: () => now });
  session.createGame('s-bp3-020-session', P1, 'P1', P2, 'P2');
  (session as unknown as { authorityState: GameState }).authorityState = state;
  return {
    session,
    setNow(value: number) { now = value; },
    setState(value: GameState) {
      (session as unknown as { authorityState: GameState }).authorityState = value;
    },
  };
}

function startPublicDisplay(session: ReturnType<typeof createGameSession>) {
  const effect = session.state!.activeEffect!;
  const result = session.executeCommand(
    createConfirmEffectStepCommand(P1, effect.id, null, null, undefined, 'reroll')
  );
  expect(result.success, result.error).toBe(true);
  return session.state!.activeEffect!;
}

function didUse020(state: GameState, sourceCardId?: string): boolean {
  return state.actionHistory.some((action) =>
    action.type === 'RESOLVE_ABILITY' &&
    action.payload.abilityId === ABILITY_ID &&
    action.payload.step === 'ABILITY_USE' &&
    (sourceCardId === undefined || action.payload.sourceCardId === sourceCardId)
  );
}

describe('shared cheer-reroll family: PL!S-bp3-020-L', () => {
  it.each([0, 1, 2])('opens one positive option plus skip with %i Blade-Heart cards', (count) => {
    const { state } = start(count, Math.max(2, count));
    expect(state.activeEffect).toMatchObject({
      abilityId: ABILITY_ID,
      stepText: '可以将本次声援公开的卡片全部放置入休息室。如此做时，失去本次声援获得的BLADE HEART，并重新进行声援。',
      selectableOptions: [{ id: 'reroll', label: '全部放置入休息室并重新进行声援' }],
      skipSelectionLabel: '不发动',
    });
    expect(state.activeEffect?.selectableCardIds).toBeUndefined();
  });

  it('does not open when three revealed cards have Blade Heart', () => {
    expect(start(3, 3).state.activeEffect).toBeNull();
  });

  it('declining does not move cards or record turn1', () => {
    const { state, cards } = start(1, 2);
    const declined = confirmActiveEffectStep(state, P1, state.activeEffect!.id);
    expect(declined.resolutionZone.cardIds).toEqual(cards.map((card) => card.instanceId));
    expect(declined.actionHistory.some((action) => action.payload.abilityId === ABILITY_ID && action.payload.step === 'ABILITY_USE')).toBe(false);
  });

  it('first activation only enters the shared public display and does not move or consume turn1', () => {
    const { state, cards } = start(2, 2);
    const displaying = confirmActiveEffectStep(state, P1, state.activeEffect!.id, undefined, undefined, false, 'reroll');
    expect(displaying.activeEffect?.stepId).toBe(PUBLIC_CARD_SELECTION_CONFIRMATION_STEP_ID);
    expect(displaying.activeEffect?.revealedCardIds).toEqual(cards.map((card) => card.instanceId));
    expect(displaying.resolutionZone.cardIds).toEqual(cards.map((card) => card.instanceId));
    expect(displaying.actionHistory.some((action) => action.payload.abilityId === ABILITY_ID && action.payload.step === 'ABILITY_USE')).toBe(false);
  });

  it.each([P1, P2])('crosses the authoritative deadline when %s resumes, completes once, and records instance turn1', (resumingPlayerId) => {
    const scenario = start(1, 2, { deckCount: 3 });
    const { session, setNow } = createSession(scenario.state);
    const reveal = startPublicDisplay(session);
    const deadline = reveal.publicCardSelectionAutoAdvanceAt!;
    expect(deadline).toBe(12_300);
    const expectedObjectIds = scenario.cards.map((card) => createPublicObjectId(card.instanceId));
    expect(projectPlayerViewState(session.state!, P1, { now: 10_000 }).activeEffect).toMatchObject({
      revealedObjectIds: expectedObjectIds, publicCardSelectionAutoAdvanceAt: deadline,
    });
    expect(projectPlayerViewState(session.state!, P2, { now: 10_000 }).activeEffect).toMatchObject({
      revealedObjectIds: expectedObjectIds, publicCardSelectionAutoAdvanceAt: deadline,
    });
    setNow(deadline - 1);
    expect(session.executeCommand(createAutoAdvancePublicCardSelectionCommand(resumingPlayerId, reveal.id, deadline - 1)).success).toBe(false);
    setNow(deadline);
    expect(session.executeCommand(createAutoAdvancePublicCardSelectionCommand(resumingPlayerId, reveal.id, deadline)).success).toBe(true);
    expect(session.state!.players[0].waitingRoom.cardIds).toEqual(scenario.cards.map((card) => card.instanceId));
    expect(session.state!.resolutionZone.revealedCardIds).toEqual(scenario.deck.slice(0, 2).map((card) => card.instanceId));
    expect(didUse020(session.state!, scenario.source.instanceId)).toBe(true);
    const completed = session.state!;
    expect(session.executeCommand(createAutoAdvancePublicCardSelectionCommand(resumingPlayerId === P1 ? P2 : P1, reveal.id, deadline)).success).toBe(false);
    expect(session.state).toEqual(completed);
  });

  it('ends all-or-nothing when any displayed target becomes stale before deadline', () => {
    const scenario = start(1, 2, { deckCount: 2 });
    const control = createSession(scenario.state);
    const reveal = startPublicDisplay(control.session);
    control.setState({
      ...control.session.state!,
      resolutionZone: {
        ...control.session.state!.resolutionZone,
        cardIds: [scenario.cards[1]!.instanceId],
        revealedCardIds: [scenario.cards[1]!.instanceId],
      },
    });
    control.setNow(reveal.publicCardSelectionAutoAdvanceAt!);
    expect(control.session.executeCommand(
      createAutoAdvancePublicCardSelectionCommand(P2, reveal.id, reveal.publicCardSelectionAutoAdvanceAt!)
    ).success).toBe(true);
    expect(control.session.state!.players[0].waitingRoom.cardIds).toEqual([]);
    expect(control.session.state!.resolutionZone.cardIds).toEqual([scenario.cards[1]!.instanceId]);
    expect(didUse020(control.session.state!)).toBe(false);
  });

  it('safely ends when the source LIVE leaves before activation or during public display', () => {
    const before = start(1, 2);
    const staleBefore = updatePlayer(before.state, P1, (player) => ({
      ...player, liveZone: { ...player.liveZone, cardIds: [] },
    }));
    const ended = confirmActiveEffectStep(staleBefore, P1, staleBefore.activeEffect!.id, undefined, undefined, false, 'reroll');
    expect(ended.activeEffect).toBeNull();
    expect(didUse020(ended)).toBe(false);

    const during = start(1, 2);
    const control = createSession(during.state);
    const reveal = startPublicDisplay(control.session);
    control.setState(updatePlayer(control.session.state!, P1, (player) => ({
      ...player, liveZone: { ...player.liveZone, cardIds: [] },
    })));
    control.setNow(reveal.publicCardSelectionAutoAdvanceAt!);
    expect(control.session.executeCommand(createAutoAdvancePublicCardSelectionCommand(P2, reveal.id, reveal.publicCardSelectionAutoAdvanceAt!)).success).toBe(true);
    expect(control.session.state!.players[0].waitingRoom.cardIds).toEqual([]);
    expect(didUse020(control.session.state!)).toBe(false);
  });

  it('keeps turn1 per source instance so the second 020 can trigger from the first reroll FAQ', () => {
    const scenario = start(1, 2, { sourceCount: 2, deckCount: 2 });
    const order = scenario.state;
    expect(order.activeEffect?.abilityId).toBe('system:select-pending-card-effect');
    const firstDecision = confirmActiveEffectStep(
      order, P1, order.activeEffect!.id, scenario.sources[0]!.instanceId
    );
    const displayed = confirmActiveEffectStep(
      firstDecision, P1, firstDecision.activeEffect!.id, undefined, undefined, false, 'reroll'
    );
    const afterFirst = confirmActiveEffectStep(displayed, P1, displayed.activeEffect!.id);
    expect(didUse020(afterFirst, scenario.sources[0]!.instanceId)).toBe(true);
    expect(didUse020(afterFirst, scenario.sources[1]!.instanceId)).toBe(false);
    expect(afterFirst.pendingAbilities.some((ability) =>
      ability.abilityId === ABILITY_ID && ability.sourceCardId === scenario.sources[0]!.instanceId
    )).toBe(false);
    expect(afterFirst.pendingAbilities.some((ability) =>
      ability.abilityId === ABILITY_ID && ability.sourceCardId === scenario.sources[1]!.instanceId
    ) || afterFirst.activeEffect?.sourceCardId === scenario.sources[1]!.instanceId).toBe(true);
  });

  it('returns reroll-created pending to the live pool and invalidates the old ordered batch', () => {
    const scenario = start(1, 2, { sourceCount: 2, deckCount: 2 });
    const orderedFirst = confirmActiveEffectStep(
      scenario.state, P1, scenario.state.activeEffect!.id, undefined, undefined, true
    );
    expect(orderedFirst.activeEffect?.abilityId).toBe(ABILITY_ID);
    const displayed = confirmActiveEffectStep(
      orderedFirst, P1, orderedFirst.activeEffect!.id, undefined, undefined, false, 'reroll'
    );
    const afterFirst = confirmActiveEffectStep(displayed, P1, displayed.activeEffect!.id);
    expect(afterFirst.activeEffect).toMatchObject({
      abilityId: ABILITY_ID,
      sourceCardId: scenario.sources[1]!.instanceId,
      metadata: { orderedResolution: false },
    });
    const rerollEvent = afterFirst.eventLog.map((entry) => entry.event).at(-1)!;
    expect(rerollEvent.eventType).toBe(TriggerCondition.ON_CHEER);
    expect(afterFirst.activeEffect?.metadata?.originalCheerEventId).toBe(rerollEvent.eventId);
    expect(afterFirst.activeEffect?.metadata?.originalCheerEventId).not.toBe(scenario.event.eventId);
  });

  it('rerolls from the current deck bottom, replaces current cheer facts, and records the real edge', () => {
    const scenario = start(1, 2, { deckCount: 4, bottomCheer: true });
    const displayed = confirmActiveEffectStep(
      scenario.state,
      P1,
      scenario.state.activeEffect!.id,
      undefined,
      undefined,
      false,
      'reroll'
    );
    const done = confirmActiveEffectStep(displayed, P1, displayed.activeEffect!.id);
    const expected = [scenario.deck[3]!.instanceId, scenario.deck[2]!.instanceId];
    expect(done.liveResolution.firstPlayerCheerCardIds).toEqual(expected);
    expect(done.resolutionZone.revealedCardIds).toEqual(expected);
    expect(
      done.eventLog
        .map((entry) => entry.event)
        .filter((event) => event.eventType === TriggerCondition.ON_CHEER)
        .at(-1)
    ).toMatchObject({ revealedCardIds: expected, deckEdge: 'BOTTOM' });
    expect(done.actionHistory.findLast((action) => action.type === 'CHEER')?.payload).toMatchObject({
      cheerCardIds: expected,
      deckEdge: 'BOTTOM',
    });
  });
});
