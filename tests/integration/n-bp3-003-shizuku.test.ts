import { describe, expect, it } from 'vitest';
import { createCardInstance, createHeartIcon, type MemberCardData } from '../../src/domain/entities/card';
import { createGameState, registerCards, updatePlayer, type GameState, type PendingAbilityState } from '../../src/domain/entities/game';
import { addCardToZone, placeCardInSlot } from '../../src/domain/entities/zone';
import { confirmActiveEffectStep, resolvePendingCardEffects } from '../../src/application/card-effect-runner';
import { getCardAbilityDefinitionsForCardCode } from '../../src/application/card-effects/definitions/lookup';
import { PL_N_BP3_003_ON_ENTER_ACTIVATE_WAITING_LOW_COST_NIJIGASAKI_MEMBER_ON_ENTER_ABILITY_ID, PL_N_BP3_012_ON_ENTER_DISCARD_LOOK_TOP_NIJIGASAKI_CARD_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
import { CardType, FaceState, GamePhase, HeartColor, OrientationState, SlotPosition, TriggerCondition } from '../../src/shared/types/enums';

const P1 = 'p1';
function member(cardCode: string, group: string, cost: number): MemberCardData { return { cardCode, name: cardCode, groupNames: [group], unitName: group, cardType: CardType.MEMBER, cost, blade: 1, hearts: [createHeartIcon(HeartColor.PINK, 1)] }; }
function setup(includeLegal = true): { game: GameState; sourceId: string; legalId: string; invalidId: string; handId: string; deckIds: readonly string[] } {
  const source = createCardInstance(member('PL!N-bp3-003-R', '虹ヶ咲学園スクールアイドル同好会', 9), P1, 'shizuku');
  const legal = createCardInstance(member('PL!N-bp3-012-R', '虹ヶ咲学園スクールアイドル同好会', 4), P1, 'lanzhu');
  const invalid = createCardInstance(member('PL!N-bp5-009-R', '虹ヶ咲学園スクールアイドル同好会', 4), P1, 'self-wait');
  const hand = createCardInstance(member('hand-cost', '虹ヶ咲学園スクールアイドル同好会', 1), P1, 'hand');
  const deck = [0, 1, 2, 3, 4, 5].map((index) => createCardInstance(member(`deck-${index}`, '虹ヶ咲学園スクールアイドル同好会', 1), P1, `deck-${index}`));
  let game = registerCards(createGameState('shizuku', P1, 'P1', 'p2', 'P2'), [source, legal, invalid, hand, ...deck]);
  game = updatePlayer(game, P1, (p) => ({ ...p, memberSlots: placeCardInSlot(p.memberSlots, SlotPosition.CENTER, source.instanceId, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }), waitingRoom: { ...p.waitingRoom, cardIds: includeLegal ? [legal.instanceId, invalid.instanceId] : [invalid.instanceId] }, hand: addCardToZone(p.hand, hand.instanceId), mainDeck: { ...p.mainDeck, cardIds: deck.map((card) => card.instanceId) } }));
  const pending: PendingAbilityState = { id: 'shizuku-pending', abilityId: PL_N_BP3_003_ON_ENTER_ACTIVATE_WAITING_LOW_COST_NIJIGASAKI_MEMBER_ON_ENTER_ABILITY_ID, sourceCardId: source.instanceId, controllerId: P1, mandatory: true, timingId: TriggerCondition.ON_ENTER_STAGE, eventIds: ['natural-enter'], sourceSlot: SlotPosition.CENTER };
  return { game: { ...game, currentPhase: GamePhase.MAIN_PHASE, pendingAbilities: [pending] }, sourceId: source.instanceId, legalId: legal.instanceId, invalidId: invalid.instanceId, handId: hand.instanceId, deckIds: deck.map((card) => card.instanceId) };
}

describe('PL!N-bp3-003 Shizuku', () => {
  it.each(['PL!N-bp3-003-R', 'PL!N-bp3-003-P'])('classifies %s through one base definition', (code) => expect(getCardAbilityDefinitionsForCardCode(code).map((d) => d.abilityId)).toContain(PL_N_BP3_003_ON_ENTER_ACTIVATE_WAITING_LOW_COST_NIJIGASAKI_MEMBER_ON_ENTER_ABILITY_ID));

  it('filters self-wait abilities before selection and delegates with the waiting member as source', () => {
    const s = setup();
    const started = resolvePendingCardEffects(s.game).gameState;
    expect(started.activeEffect?.selectableCardIds).toEqual([s.legalId]);
    expect(started.activeEffect?.canSkipSelection).toBe(false);
    const delegated = confirmActiveEffectStep(started, P1, started.activeEffect!.id, s.legalId);
    expect(delegated.activeEffect?.abilityId).toBe(PL_N_BP3_012_ON_ENTER_DISCARD_LOOK_TOP_NIJIGASAKI_CARD_ABILITY_ID);
    expect(delegated.activeEffect?.sourceCardId).toBe(s.legalId);
    expect(delegated.players[0].waitingRoom.cardIds).toContain(s.legalId);
    expect(delegated.players[0].movedToStageThisTurn).not.toContain(s.legalId);
    expect(delegated.eventLog.some((entry) => entry.event.eventType === TriggerCondition.ON_ENTER_STAGE)).toBe(false);
  });

  it('consumes the pending safely when no member has a legal opt-in ability', () => {
    const s = setup(false);
    const done = resolvePendingCardEffects(s.game).gameState;
    expect(done.activeEffect).toBeNull();
    expect(done.pendingAbilities).toEqual([]);
  });

  it('lets the delegated real workflow pay its own discard cost and complete before continuation', () => {
    const s = setup();
    const started = resolvePendingCardEffects(s.game).gameState;
    const delegated = confirmActiveEffectStep(started, P1, started.activeEffect!.id, s.legalId);
    let state = confirmActiveEffectStep(delegated, P1, delegated.activeEffect!.id, s.handId);
    expect(state.players[0].waitingRoom.cardIds).toEqual(expect.arrayContaining([s.legalId, s.handId]));
    expect(state.eventLog.some((entry) => entry.event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM)).toBe(true);
    for (let index = 0; index < 4 && state.activeEffect; index += 1) {
      state = confirmActiveEffectStep(state, P1, state.activeEffect.id, state.activeEffect.selectableCardIds?.[0] ?? null);
    }
    expect(state.activeEffect).toBeNull();
    expect(state.pendingAbilities).toEqual([]);
    expect(state.actionHistory.some((action) => action.payload.sourceCardId === s.legalId && action.payload.step === 'FINISH')).toBe(true);
  });
});
