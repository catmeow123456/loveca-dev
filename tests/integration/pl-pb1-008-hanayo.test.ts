import { describe, expect, it } from 'vitest';
import type { MemberCardData } from '../../src/domain/entities/card';
import { createCardInstance, createHeartIcon } from '../../src/domain/entities/card';
import { createGameState, registerCards, updatePlayer, type PendingAbilityState } from '../../src/domain/entities/game';
import { addMemberBelowMember, removeCardFromSlot } from '../../src/domain/entities/zone';
import { confirmActiveEffectStep, resolvePendingCardEffects } from '../../src/application/card-effect-runner';
import { MEMBER_ON_ENTER_DRAW_ONE_ABILITY_ID, PL_PB1_008_ON_ENTER_WAIT_UP_TO_THREE_MEMBERS_DRAW_PER_WAITED_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
import { CardType, FaceState, HeartColor, OrientationState, SlotPosition, TriggerCondition } from '../../src/shared/types/enums';

const P1 = 'p1'; const P2 = 'p2';
function member(cardCode: string): MemberCardData { return { cardCode, name: cardCode, groupNames: ["μ's"], cardType: CardType.MEMBER, cost: 1, blade: 1, hearts: [createHeartIcon(HeartColor.PINK, 1)] }; }
function pending(id: string, abilityId: string, sourceCardId: string): PendingAbilityState { return { id, abilityId, sourceCardId, controllerId: P1, mandatory: true, timingId: TriggerCondition.ON_ENTER_STAGE, sourceSlot: SlotPosition.CENTER }; }
function setup(options: { sourceCode?: string; sourceOrientation?: OrientationState; leftOrientation?: OrientationState; includeContinuation?: boolean; includeMemberBelow?: boolean } = {}) {
  const source = createCardInstance(member(options.sourceCode ?? 'PL!-pb1-008-R'), P1, 'source');
  const left = createCardInstance(member('LEFT'), P1, 'left'); const right = createCardInstance(member('RIGHT'), P1, 'right');
  const opponent = createCardInstance(member('OPPONENT'), P2, 'opponent'); const below = createCardInstance(member('BELOW'), P1, 'below'); const continuation = createCardInstance(member('CONT'), P1, 'cont');
  const deck = Array.from({ length: 5 }, (_, i) => createCardInstance(member(`DECK-${i}`), P1, `deck-${i}`));
  let game = registerCards(createGameState('pb1-008', P1, 'P1', P2, 'P2'), [source, left, right, opponent, below, continuation, ...deck]);
  game = updatePlayer(game, P1, (p) => ({ ...p, mainDeck: { ...p.mainDeck, cardIds: deck.map(c => c.instanceId) }, memberSlots: (() => { const slots = { ...p.memberSlots, slots: { [SlotPosition.LEFT]: left.instanceId, [SlotPosition.CENTER]: source.instanceId, [SlotPosition.RIGHT]: right.instanceId }, cardStates: new Map([[left.instanceId, { orientation: options.leftOrientation ?? OrientationState.ACTIVE, face: FaceState.FACE_UP }], [source.instanceId, { orientation: options.sourceOrientation ?? OrientationState.ACTIVE, face: FaceState.FACE_UP }], [right.instanceId, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }]]) }; return options.includeMemberBelow ? addMemberBelowMember(slots, SlotPosition.CENTER, below.instanceId) : slots; })() }));
  game = updatePlayer(game, P2, (p) => ({ ...p, memberSlots: { ...p.memberSlots, slots: { ...p.memberSlots.slots, [SlotPosition.CENTER]: opponent.instanceId }, cardStates: new Map([[opponent.instanceId, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }]]) } }));
  return { game: { ...game, pendingAbilities: [pending('008', PL_PB1_008_ON_ENTER_WAIT_UP_TO_THREE_MEMBERS_DRAW_PER_WAITED_ABILITY_ID, source.instanceId), ...(options.includeContinuation ? [pending('cont', MEMBER_ON_ENTER_DRAW_ONE_ABILITY_ID, continuation.instanceId)] : [])] }, source, left, right, opponent, below, deck };
}
function start(game: ReturnType<typeof setup>['game'], sourceId: string) { const state = resolvePendingCardEffects(game).gameState; return state.activeEffect?.abilityId === 'system:select-pending-card-effect' ? confirmActiveEffectStep(state, P1, state.activeEffect.id, sourceId) : state; }
function choose(game: ReturnType<typeof start>, ids: readonly string[]) { return confirmActiveEffectStep(game, P1, game.activeEffect!.id, undefined, undefined, undefined, undefined, ids); }
function expectContinuationDraw(state: ReturnType<typeof choose>, cardId: string) {
  const action = state.actionHistory.find((candidate) => candidate.payload.abilityId === MEMBER_ON_ENTER_DRAW_ONE_ABILITY_ID && candidate.payload.step === 'ON_ENTER_DRAW_ONE');
  expect(action?.payload.drawnCardIds).toEqual([cardId]);
  expect(state.players[0].hand.cardIds).toContain(cardId);
  expect(state.pendingAbilities).toEqual([]);
  expect(state.activeEffect).toBeNull();
}

describe('PL!-pb1-008 小泉花陽', () => {
  it('covers R/P＋, offers only own non-WAITING main-stage members including source, and draws actual count', () => {
    for (const code of ['PL!-pb1-008-R', 'PL!-pb1-008-P＋']) {
      const s = setup({ sourceCode: code }); const opened = start(s.game, s.source.instanceId);
      expect(opened.activeEffect).toMatchObject({ selectableCardMode: 'ORDERED_MULTI', minSelectableCards: 0, maxSelectableCards: 3, canSkipSelection: true });
      expect(opened.activeEffect?.selectableCardIds).toEqual([s.left.instanceId, s.source.instanceId, s.right.instanceId]);
      expect(opened.activeEffect?.selectableCardIds).not.toContain(s.opponent.instanceId);
      const done = choose(opened, [s.left.instanceId, s.source.instanceId, s.right.instanceId]);
      expect(done.players[0].hand.cardIds).toEqual(s.deck.slice(0, 3).map(c => c.instanceId));
      expect(done.eventLog.filter(e => e.event.eventType === TriggerCondition.ON_MEMBER_STATE_CHANGED)).toHaveLength(3);
      expect(done.eventLog.filter(e => e.event.eventType === TriggerCondition.ON_MEMBER_STATE_CHANGED).every(e => e.event.cause?.kind === 'CARD_EFFECT' && e.event.cause.abilityId === PL_PB1_008_ON_ENTER_WAIT_UP_TO_THREE_MEMBERS_DRAW_PER_WAITED_ABILITY_ID)).toBe(true);
      expect(done.actionHistory.find(a => a.payload.step === 'WAIT_MEMBERS_DRAW_PER_WAITED')?.payload).toMatchObject({ requestedCount: 3, actualWaitedCount: 3, drawnCardIds: s.deck.slice(0, 3).map(c => c.instanceId) });
    }
  });

  it('allows zero selection and rejects duplicate, over-limit, and never-offered IDs without closing the window', () => {
    const s = setup({ includeContinuation: true }); const opened = start(s.game, s.source.instanceId);
    for (const ids of [[s.left.instanceId, s.left.instanceId], [s.left.instanceId, s.source.instanceId, s.right.instanceId, 'extra'], ['never-offered']]) {
      const rejected = choose(opened, ids); expect(rejected).toBe(opened);
    }
    const skipped = choose(opened, []);
    expect(skipped.actionHistory.find(a => a.payload.step === 'NO_MEMBERS_WAITED')?.payload).toMatchObject({ actualWaitedCount: 0, drawnCardIds: [] });
    expectContinuationDraw(skipped, s.deck[0]!.instanceId);
  });

  it('filters WAITING, memberBelow, and opponent members while retaining the source as a candidate', () => {
    const s = setup({ leftOrientation: OrientationState.WAITING, includeMemberBelow: true }); const opened = start(s.game, s.source.instanceId);
    expect(opened.activeEffect?.selectableCardIds).toEqual([s.source.instanceId, s.right.instanceId]);
    expect(opened.activeEffect?.selectableCardIds).not.toContain(s.left.instanceId);
    expect(opened.activeEffect?.selectableCardIds).not.toContain(s.below.instanceId);
    expect(opened.activeEffect?.selectableCardIds).not.toContain(s.opponent.instanceId);
  });

  it('tolerates partial/all stale offered targets, draws only successful waits, and continues', () => {
    const s = setup({ includeContinuation: true }); const opened = start(s.game, s.source.instanceId);
    const stale = updatePlayer(opened, P1, (p) => ({ ...p, memberSlots: removeCardFromSlot(p.memberSlots, SlotPosition.LEFT) }));
    const partial = choose(stale, [s.left.instanceId, s.source.instanceId]);
    const partialAction = partial.actionHistory.find(a => a.payload.step === 'WAIT_MEMBERS_DRAW_PER_WAITED');
    const sourceEvent = partial.eventLog.find((entry) => entry.event.eventType === TriggerCondition.ON_MEMBER_STATE_CHANGED && entry.event.cardInstanceId === s.source.instanceId)?.event;
    expect(partialAction?.payload).toMatchObject({ actuallyWaitedMemberCardIds: [s.source.instanceId], memberStateChangedEventIds: [sourceEvent?.eventId], actualWaitedCount: 1, drawnCardIds: [s.deck[0]!.instanceId] });
    expect(partial.eventLog.filter((entry) => entry.event.eventType === TriggerCondition.ON_MEMBER_STATE_CHANGED)).toHaveLength(1);
    expectContinuationDraw(partial, s.deck[1]!.instanceId);
    const all = setup({ includeContinuation: true }); const allOpened = start(all.game, all.source.instanceId);
    const allStale = updatePlayer(allOpened, P1, (p) => ({ ...p, memberSlots: removeCardFromSlot(p.memberSlots, SlotPosition.LEFT) }));
    const done = choose(allStale, [all.left.instanceId]);
    expect(done.actionHistory.find(a => a.payload.step === 'NO_MEMBERS_WAITED')?.payload).toMatchObject({ actualWaitedCount: 0, drawnCardIds: [] });
    expect(done.eventLog.filter((entry) => entry.event.eventType === TriggerCondition.ON_MEMBER_STATE_CHANGED)).toHaveLength(0);
    expect(done.players[0].hand.cardIds).toEqual([all.deck[0]!.instanceId]);
    expectContinuationDraw(done, all.deck[0]!.instanceId);
  });
});
