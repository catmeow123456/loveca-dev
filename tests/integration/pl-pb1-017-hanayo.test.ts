import { describe, expect, it } from 'vitest';
import type { MemberCardData } from '../../src/domain/entities/card';
import { createCardInstance, createHeartIcon } from '../../src/domain/entities/card';
import { createGameState, registerCards, updatePlayer, type PendingAbilityState } from '../../src/domain/entities/game';
import { confirmActiveEffectStep, resolvePendingCardEffects } from '../../src/application/card-effect-runner';
import { removeCardFromSlot } from '../../src/domain/entities/zone';
import { MEMBER_ON_ENTER_DRAW_ONE_ABILITY_ID, PL_PB1_017_ON_ENTER_WAIT_SELF_DRAW_DISCARD_UNLESS_PRINTEMPS_RELAY_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
import { CardType, FaceState, HeartColor, OrientationState, SlotPosition, TriggerCondition } from '../../src/shared/types/enums';

const P1 = 'p1'; const P2 = 'p2';
function member(cardCode: string, unitName?: string): MemberCardData { return { cardCode, name: cardCode, groupNames: ["μ's"], unitName, cardType: CardType.MEMBER, cost: 1, blade: 1, hearts: [createHeartIcon(HeartColor.PINK, 1)] }; }
function pending(sourceCardId: string, relayReplacements?: unknown): PendingAbilityState { return { id: '017', abilityId: PL_PB1_017_ON_ENTER_WAIT_SELF_DRAW_DISCARD_UNLESS_PRINTEMPS_RELAY_ABILITY_ID, sourceCardId, controllerId: P1, mandatory: true, timingId: TriggerCondition.ON_ENTER_STAGE, sourceSlot: SlotPosition.CENTER, metadata: relayReplacements === undefined ? undefined : { relayReplacements } }; }
function setup(options: { sourceCode?: string; sourceOrientation?: OrientationState; handCount?: number; deckCount?: number; relayUnit?: string; includeContinuation?: boolean } = {}) {
  const source = createCardInstance(member(options.sourceCode ?? 'PL!-pb1-017-R'), P1, 'source'); const replaced = createCardInstance(member('REPLACED', options.relayUnit), P1, 'replaced'); const cont = createCardInstance(member('CONT'), P1, 'cont');
  const hand = Array.from({ length: options.handCount ?? 1 }, (_, i) => createCardInstance(member(`HAND-${i}`), P1, `hand-${i}`)); const deck = Array.from({ length: options.deckCount ?? 1 }, (_, i) => createCardInstance(member(`DECK-${i}`), P1, `deck-${i}`));
  let game = registerCards(createGameState('pb1-017', P1, 'P1', P2, 'P2'), [source, replaced, cont, ...hand, ...deck]);
  game = updatePlayer(game, P1, p => ({ ...p, hand: { ...p.hand, cardIds: hand.map(c => c.instanceId) }, mainDeck: { ...p.mainDeck, cardIds: deck.map(c => c.instanceId) }, memberSlots: { ...p.memberSlots, slots: { ...p.memberSlots.slots, [SlotPosition.CENTER]: source.instanceId }, cardStates: new Map([[source.instanceId, { orientation: options.sourceOrientation ?? OrientationState.ACTIVE, face: FaceState.FACE_UP }]]) } }));
  const replacements = options.relayUnit === undefined ? undefined : [{ cardId: replaced.instanceId, slot: SlotPosition.CENTER, effectiveCost: 1 }];
  return { game: { ...game, pendingAbilities: [pending(source.instanceId, replacements), ...(options.includeContinuation ? [{ id: 'cont', abilityId: MEMBER_ON_ENTER_DRAW_ONE_ABILITY_ID, sourceCardId: cont.instanceId, controllerId: P1, mandatory: true, timingId: TriggerCondition.ON_ENTER_STAGE }] : [])] }, source, replaced, hand, deck };
}
function start(game: ReturnType<typeof setup>['game'], id: string) { const state = resolvePendingCardEffects(game).gameState; return state.activeEffect?.abilityId === 'system:select-pending-card-effect' ? confirmActiveEffectStep(state, P1, state.activeEffect.id, id) : state; }
function option(game: ReturnType<typeof start>, id: string | null) { return confirmActiveEffectStep(game, P1, game.activeEffect!.id, undefined, undefined, undefined, id); }
function expectContinuationDraw(state: ReturnType<typeof option>, cardId: string | undefined) {
  const action = state.actionHistory.find((candidate) => candidate.payload.abilityId === MEMBER_ON_ENTER_DRAW_ONE_ABILITY_ID && candidate.payload.step === 'ON_ENTER_DRAW_ONE');
  expect(action).toBeDefined();
  expect(action?.payload.drawnCardIds).toEqual(cardId ? [cardId] : []);
  if (cardId) expect(state.players[0].hand.cardIds).toContain(cardId);
  expect(state.pendingAbilities).toEqual([]); expect(state.activeEffect).toBeNull();
}

describe('PL!-pb1-017 小泉花陽', () => {
  it('decline or inactive source consumes without draw/discard and continues', () => {
    const s = setup({ includeContinuation: true }); const declined = option(start(s.game, s.source.instanceId), null);
    expect(declined.players[0].memberSlots.cardStates.get(s.source.instanceId)?.orientation).toBe(OrientationState.ACTIVE);
    expect(declined.actionHistory.some((action) => action.payload.abilityId === PL_PB1_017_ON_ENTER_WAIT_SELF_DRAW_DISCARD_UNLESS_PRINTEMPS_RELAY_ABILITY_ID && String(action.payload.step).startsWith('DRAW'))).toBe(false);
    expect(declined.eventLog.filter((entry) => entry.event.eventType === TriggerCondition.ON_MEMBER_STATE_CHANGED || entry.event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM)).toHaveLength(0);
    expectContinuationDraw(declined, s.deck[0]!.instanceId);
    const waiting = setup({ sourceOrientation: OrientationState.WAITING }); const done = resolvePendingCardEffects(waiting.game).gameState;
    expect(done.activeEffect).toBeNull(); expect(done.players[0].hand.cardIds).toEqual(waiting.hand.map(c => c.instanceId));
  });

  it('normally waits, draws, then discards from the post-draw hand with both trigger facts', () => {
    const s = setup({ sourceCode: 'PL!-pb1-017-P＋', includeContinuation: true, deckCount: 2 }); const paid = option(start(s.game, s.source.instanceId), 'WAIT_SOURCE');
    expect(paid.activeEffect).toMatchObject({ stepId: 'PL_PB1_017_SELECT_DISCARD_AFTER_DRAW' }); expect(paid.activeEffect?.selectableCardIds).toContain(s.deck[0]!.instanceId);
    const done = confirmActiveEffectStep(paid, P1, paid.activeEffect!.id, s.deck[0]!.instanceId);
    expect(done.players[0].memberSlots.cardStates.get(s.source.instanceId)?.orientation).toBe(OrientationState.WAITING);
    const stateEvent = done.eventLog.find(e => e.event.eventType === TriggerCondition.ON_MEMBER_STATE_CHANGED && e.event.cardInstanceId === s.source.instanceId)?.event;
    const discardEvent = done.eventLog.find(e => e.event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM && e.event.cardInstanceId === s.deck[0]!.instanceId)?.event;
    expect(stateEvent).toMatchObject({ previousOrientation: OrientationState.ACTIVE, nextOrientation: OrientationState.WAITING, cause: { kind: 'CARD_EFFECT', abilityId: PL_PB1_017_ON_ENTER_WAIT_SELF_DRAW_DISCARD_UNLESS_PRINTEMPS_RELAY_ABILITY_ID } });
    expect(done.actionHistory.find((action) => action.type === 'PAY_COST')?.payload.memberStateChangedEventIds).toContain(stateEvent?.eventId);
    expect(discardEvent).toMatchObject({ cardInstanceId: s.deck[0]!.instanceId, fromZone: 'HAND', toZone: 'WAITING_ROOM' });
    expectContinuationDraw(done, s.deck[1]!.instanceId);
  });

  it('uses only this pending relayReplacements Printemps identity to waive discard, otherwise retains the discard branch', () => {
    const printemps = setup({ relayUnit: 'Printemps', includeContinuation: true, deckCount: 2 }); const paid = option(start(printemps.game, printemps.source.instanceId), 'WAIT_SOURCE');
    expect(paid.activeEffect).toBeNull(); expect(paid.players[0].hand.cardIds).toContain(printemps.deck[0]!.instanceId); expect(paid.players[0].waitingRoom.cardIds).not.toContain(printemps.deck[0]!.instanceId);
    expect(paid.eventLog.some((entry) => entry.event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM)).toBe(false);
    expect(paid.actionHistory.find((action) => action.payload.step === 'WAIT_SELF_DRAW_PRINTEMPS_RELAY')?.payload.drawnCardIds).toEqual([printemps.deck[0]!.instanceId]);
    expectContinuationDraw(paid, printemps.deck[1]!.instanceId);
    for (const relayUnit of ['BiBi', undefined] as const) {
      const non = setup({ relayUnit, includeContinuation: true, deckCount: 2 }); const nonPaid = option(start(non.game, non.source.instanceId), 'WAIT_SOURCE');
      expect(nonPaid.activeEffect?.stepId).toBe('PL_PB1_017_SELECT_DISCARD_AFTER_DRAW');
      const done = confirmActiveEffectStep(nonPaid, P1, nonPaid.activeEffect!.id, non.deck[0]!.instanceId);
      expectContinuationDraw(done, non.deck[1]!.instanceId);
    }
    const emptyMetadata = setup({ includeContinuation: true, deckCount: 2 });
    const emptyState = { ...emptyMetadata.game, pendingAbilities: [{ ...emptyMetadata.game.pendingAbilities[0]!, metadata: { relayReplacements: [] } }, ...emptyMetadata.game.pendingAbilities.slice(1)] };
    const emptyPaid = option(start(emptyState, emptyMetadata.source.instanceId), 'WAIT_SOURCE');
    expect(emptyPaid.activeEffect?.stepId).toBe('PL_PB1_017_SELECT_DISCARD_AFTER_DRAW');
  });

  it('rejects illegal discard input but clears an offered stale discard target without recreating events', () => {
    const s = setup({ includeContinuation: true, deckCount: 2 }); const paid = option(start(s.game, s.source.instanceId), 'WAIT_SOURCE'); const illegal = confirmActiveEffectStep(paid, P1, paid.activeEffect!.id, 'never-offered'); expect(illegal).toBe(paid);
    const stale = updatePlayer(paid, P1, p => ({ ...p, hand: { ...p.hand, cardIds: p.hand.cardIds.filter(id => id !== s.hand[0]!.instanceId) } }));
    const done = confirmActiveEffectStep(stale, P1, stale.activeEffect!.id, s.hand[0]!.instanceId);
    expect(done.players[0].memberSlots.cardStates.get(s.source.instanceId)?.orientation).toBe(OrientationState.WAITING);
    expect(done.actionHistory.filter(a => a.payload.step === 'STALE_TARGET')).toHaveLength(1);
    expect(done.actionHistory.find(a => a.payload.step === 'STALE_TARGET')?.payload.drawnCardIds).toEqual([s.deck[0]!.instanceId]);
    expect(done.eventLog.filter((entry) => entry.event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM)).toHaveLength(0);
    expect(done.players[0].hand.cardIds).toContain(s.deck[0]!.instanceId);
    expectContinuationDraw(done, s.deck[1]!.instanceId);
  });

  it('consumes an off-stage source and both empty-deck boundaries without leaving a discard window', () => {
    const left = setup({ includeContinuation: true });
    const offStage = updatePlayer(left.game, P1, (player) => ({ ...player, memberSlots: removeCardFromSlot(player.memberSlots, SlotPosition.CENTER) }));
    const offStageDone = start(offStage, left.source.instanceId);
    expect(offStageDone.actionHistory.some((action) => action.payload.abilityId === PL_PB1_017_ON_ENTER_WAIT_SELF_DRAW_DISCARD_UNLESS_PRINTEMPS_RELAY_ABILITY_ID && String(action.payload.step).startsWith('DRAW'))).toBe(false);
    expectContinuationDraw(offStageDone, left.deck[0]!.instanceId);

    const handOnly = setup({ handCount: 1, deckCount: 0, includeContinuation: true }); const paid = option(start(handOnly.game, handOnly.source.instanceId), 'WAIT_SOURCE');
    expect(paid.activeEffect?.stepId).toBe('PL_PB1_017_SELECT_DISCARD_AFTER_DRAW');
    const discarded = confirmActiveEffectStep(paid, P1, paid.activeEffect!.id, handOnly.hand[0]!.instanceId);
    expect(discarded.eventLog.find((entry) => entry.event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM)?.event).toMatchObject({ cardInstanceId: handOnly.hand[0]!.instanceId, fromZone: 'HAND', toZone: 'WAITING_ROOM' });
    expectContinuationDraw(discarded, handOnly.hand[0]!.instanceId);

    const empty = setup({ handCount: 0, deckCount: 0, includeContinuation: true }); const emptyDone = option(start(empty.game, empty.source.instanceId), 'WAIT_SOURCE');
    expect(emptyDone.activeEffect).toBeNull(); expectContinuationDraw(emptyDone, undefined);
  });
});
