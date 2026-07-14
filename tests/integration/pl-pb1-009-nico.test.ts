import { describe, expect, it } from 'vitest';
import type { MemberCardData } from '../../src/domain/entities/card';
import { createCardInstance, createHeartIcon } from '../../src/domain/entities/card';
import { createGameState, registerCards, updatePlayer, type PendingAbilityState } from '../../src/domain/entities/game';
import { placeCardInSlot } from '../../src/domain/entities/zone';
import { confirmActiveEffectStep, resolvePendingCardEffects } from '../../src/application/card-effect-runner';
import {
  PL_PB1_009_ON_ENTER_PREVENT_EFFECT_MEMBER_ACTIVATION_THIS_TURN_ABILITY_ID,
  PL_PB1_009_ON_ENTER_WAIT_OPPONENT_ORIGINAL_BLADE_ONE_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
import { setMemberOrientation, setMembersOrientation } from '../../src/application/effects/member-state';
import { addMemberEffectActivationProhibitionUntilTurnEnd } from '../../src/domain/rules/member-effect-activation-prohibitions';
import { CardType, FaceState, HeartColor, OrientationState, SlotPosition, TriggerCondition } from '../../src/shared/types/enums';

const P1 = 'p1';
const P2 = 'p2';

function member(code: string, blade: number): MemberCardData {
  return { cardCode: code, name: code, cardType: CardType.MEMBER, cost: 4, blade, hearts: [createHeartIcon(HeartColor.PINK, 1)] };
}

function pending(id: string, abilityId: string, sourceCardId: string): PendingAbilityState {
  return { id, abilityId, sourceCardId, controllerId: P1, mandatory: true, timingId: TriggerCondition.ON_ENTER_STAGE, sourceSlot: SlotPosition.CENTER };
}

function setup() {
  const source = createCardInstance(member('PL!-pb1-009-R', 1), P1, 'nico');
  const low = createCardInstance(member('LOW', 1), P2, 'low');
  const high = createCardInstance(member('HIGH', 2), P2, 'high');
  let game = registerCards(createGameState('009', P1, 'P1', P2, 'P2'), [source, low, high]);
  game = { ...game, turnCount: 4 };
  game = updatePlayer(game, P1, (player) => ({ ...player, memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }) }));
  game = updatePlayer(game, P2, (player) => ({ ...player, memberSlots: placeCardInSlot(placeCardInSlot(player.memberSlots, SlotPosition.LEFT, low.instanceId, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }), SlotPosition.RIGHT, high.instanceId, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }) }));
  return { game, source, low, high };
}

describe('PL!-pb1-009 矢澤にこ', () => {
  it('creates a real first-segment choice using printed blade and continues to establish the second rule', () => {
    const s = setup();
    const game = { ...s.game, pendingAbilities: [pending('wait', PL_PB1_009_ON_ENTER_WAIT_OPPONENT_ORIGINAL_BLADE_ONE_ABILITY_ID, s.source.instanceId), pending('prevent', PL_PB1_009_ON_ENTER_PREVENT_EFFECT_MEMBER_ACTIVATION_THIS_TURN_ABILITY_ID, s.source.instanceId)] };
    const order = resolvePendingCardEffects(game).gameState;
    expect(order.activeEffect?.canResolveInOrder).toBe(true);
    expect(order.activeEffect?.selectableOptions?.map((option) => option.label).join(' ')).toContain('[BLADE]');
    const selectedAbility = confirmActiveEffectStep(
      order,
      P1,
      order.activeEffect!.id,
      undefined,
      undefined,
      true
    );
    expect(selectedAbility.activeEffect?.selectableCardIds).toEqual([s.low.instanceId]);
    const resolved = confirmActiveEffectStep(selectedAbility, P1, selectedAbility.activeEffect!.id, s.low.instanceId);
    expect(resolved.players[1].memberSlots.cardStates.get(s.low.instanceId)?.orientation).toBe(OrientationState.WAITING);
    expect(resolved.players[1].memberSlots.cardStates.get(s.high.instanceId)?.orientation).toBe(OrientationState.ACTIVE);
    expect(resolved.memberEffectActivationProhibitions?.[0]?.affectedPlayerIds).toEqual([P1, P2]);
  });

  it('consumes no-target first segment and resolves the second segment', () => {
    const s = setup();
    const noTarget = updatePlayer(s.game, P2, (player) => ({ ...player, memberSlots: { ...player.memberSlots, cardStates: new Map([...player.memberSlots.cardStates].map(([id, state]) => [id, { ...state, orientation: OrientationState.WAITING }])) } }));
    const game = { ...noTarget, pendingAbilities: [pending('wait', PL_PB1_009_ON_ENTER_WAIT_OPPONENT_ORIGINAL_BLADE_ONE_ABILITY_ID, s.source.instanceId), pending('prevent', PL_PB1_009_ON_ENTER_PREVENT_EFFECT_MEMBER_ACTIVATION_THIS_TURN_ABILITY_ID, s.source.instanceId)] };
    const order = resolvePendingCardEffects(game).gameState;
    const resolved = confirmActiveEffectStep(order, P1, order.activeEffect!.id, undefined, undefined, true);
    expect(resolved.pendingAbilities).toEqual([]);
    expect(resolved.activeEffect).toBeNull();
    expect(resolved.memberEffectActivationProhibitions).toHaveLength(1);
  });

  it('blocks either player card effects, but not rule/player actions, and batch reports zero actual changes', () => {
    const s = setup();
    let game = updatePlayer(s.game, P2, (player) => ({ ...player, memberSlots: { ...player.memberSlots, cardStates: new Map([...player.memberSlots.cardStates].map(([id, state]) => [id, { ...state, orientation: OrientationState.WAITING }])) } }));
    game = addMemberEffectActivationProhibitionUntilTurnEnd(game, { affectedPlayerIds: [P1, P2], sourceCardId: s.source.instanceId, abilityId: PL_PB1_009_ON_ENTER_PREVENT_EFFECT_MEMBER_ACTIVATION_THIS_TURN_ABILITY_ID });
    const cardEffect = { kind: 'CARD_EFFECT' as const, playerId: P1, sourceCardId: s.source.instanceId, abilityId: 'activate', pendingAbilityId: 'activate-pending' };
    const single = setMemberOrientation(game, P2, s.low.instanceId, OrientationState.ACTIVE, cardEffect)!;
    expect(single.nextOrientation).toBe(OrientationState.WAITING);
    const batch = setMembersOrientation(game, P2, [s.low.instanceId, s.high.instanceId], OrientationState.ACTIVE, cardEffect)!;
    expect(batch.updatedMemberCardIds).toEqual([]);
    expect(batch.blockedMemberCardIds).toEqual([s.low.instanceId, s.high.instanceId]);
    expect(setMemberOrientation(game, P2, s.low.instanceId, OrientationState.ACTIVE, { kind: 'RULE_ACTION', playerId: P2 })?.changed).toBe(true);
    expect(setMemberOrientation(game, P2, s.low.instanceId, OrientationState.ACTIVE, { kind: 'PLAYER_ACTION', playerId: P2 })?.changed).toBe(true);
  });
});
