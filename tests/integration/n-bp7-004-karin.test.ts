import { describe, expect, it } from 'vitest';
import { activateCardAbility, confirmActiveEffectStep } from '../../src/application/card-effect-runner';
import { N_BP7_004_ACTIVATED_STACK_ENERGY_BELOW_WAIT_ORIGINAL_BLADE_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
import { createCardInstance, createHeartIcon } from '../../src/domain/entities/card';
import { createGameState, registerCards, updatePlayer } from '../../src/domain/entities/game';
import { placeCardInSlot } from '../../src/domain/entities/zone';
import { addLiveModifier } from '../../src/domain/rules/live-modifiers';
import { CardType, FaceState, GamePhase, HeartColor, OrientationState, SlotPosition, TriggerCondition } from '../../src/shared/types/enums';

const P1 = 'p1'; const P2 = 'p2';
function member(code: string, id: string, ownerId: string, blade: number) {
  return createCardInstance({ cardCode: code, name: id, groupNames: ['虹ヶ咲'], cardType: CardType.MEMBER, cost: 5, blade, hearts: [createHeartIcon(HeartColor.RED, 1)] }, ownerId, id);
}
function setup() {
  const karin = member('PL!N-bp7-004-P', 'karin', P1, 1);
  const target = member('TARGET', 'target', P2, 2);
  const energy = createCardInstance({ cardCode: 'ENERGY', name: 'Energy', cardType: CardType.ENERGY }, P1, 'energy');
  let game = registerCards(createGameState('bp7-004', P1, 'P1', P2, 'P2'), [karin, target, energy]);
  game = updatePlayer(game, P1, (player) => ({ ...player,
    memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, karin.instanceId, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }),
    energyZone: { ...player.energyZone, cardIds: [energy.instanceId], cardStates: new Map([[energy.instanceId, { orientation: OrientationState.WAITING, face: FaceState.FACE_UP }]]) },
  }));
  game = updatePlayer(game, P2, (player) => ({ ...player, memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, target.instanceId, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }) }));
  return { game: { ...game, currentPhase: GamePhase.MAIN_PHASE, activePlayerIndex: 0 }, karin, target, energy };
}

describe('PL!N-bp7-004-P 朝香果林', () => {
  it('从能量区支付后以 energyBelow+1 阈值比较 original Blade，相等可选且临时 BLADE 不影响', () => {
    const { game, karin, target, energy } = setup();
    const boosted = addLiveModifier(game, { kind: 'BLADE', playerId: P2, countDelta: 5, sourceCardId: target.instanceId, abilityId: 'temporary' });
    const selecting = activateCardAbility(boosted, P1, karin.instanceId, N_BP7_004_ACTIVATED_STACK_ENERGY_BELOW_WAIT_ORIGINAL_BLADE_ABILITY_ID);
    expect(selecting.players[0].energyZone.cardIds).toEqual([]);
    expect(selecting.players[0].memberSlots.energyBelow[SlotPosition.CENTER]).toEqual([energy.instanceId]);
    expect(selecting.activeEffect?.selectableCardIds).toEqual([target.instanceId]);
    const done = confirmActiveEffectStep(selecting, P1, selecting.activeEffect!.id, target.instanceId);
    expect(done.players[1].memberSlots.cardStates.get(target.instanceId)?.orientation).toBe(OrientationState.WAITING);
    const events = done.eventLog.filter((entry) => entry.event.eventType === TriggerCondition.ON_MEMBER_STATE_CHANGED);
    expect(events).toHaveLength(1);
    expect(events[0]?.event).toMatchObject({ cause: { kind: 'CARD_EFFECT', playerId: P1, sourceCardId: karin.instanceId, abilityId: N_BP7_004_ACTIVATED_STACK_ENERGY_BELOW_WAIT_ORIGINAL_BLADE_ABILITY_ID } });
  });

  it('支付失败不写 PAY_COST 或 turn1', () => {
    const { game, karin } = setup();
    const empty = updatePlayer(game, P1, (player) => ({ ...player, energyZone: { ...player.energyZone, cardIds: [], cardStates: new Map() } }));
    const done = activateCardAbility(empty, P1, karin.instanceId, N_BP7_004_ACTIVATED_STACK_ENERGY_BELOW_WAIT_ORIGINAL_BLADE_ABILITY_ID);
    expect(done.actionHistory).toEqual(empty.actionHistory);
  });
});
