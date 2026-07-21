import { describe, expect, it } from 'vitest';
import { confirmActiveEffectStep, resolvePendingCardEffects } from '../../src/application/card-effect-runner';
import { N_BP7_007_LIVE_SUCCESS_PLACE_ENERGY_DECK_BELOW_SELF_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
import { createCardInstance, createHeartIcon } from '../../src/domain/entities/card';
import { createGameState, registerCards, updatePlayer, type PendingAbilityState } from '../../src/domain/entities/game';
import { addEnergyBelowMember, placeCardInSlot } from '../../src/domain/entities/zone';
import { getMemberEffectiveHeartIcons } from '../../src/domain/rules/live-modifiers';
import { CardType, FaceState, HeartColor, OrientationState, SlotPosition, TriggerCondition } from '../../src/shared/types/enums';

const P1 = 'p1'; const P2 = 'p2';
function setup(energyZoneCount = 7, belowCount = 2) {
  const setsuna = createCardInstance({ cardCode: 'PL!N-bp7-007-SEC', name: '优木雪菜', groupNames: ['虹ヶ咲'], cardType: CardType.MEMBER, cost: 10, blade: 1, hearts: [createHeartIcon(HeartColor.BLUE, 1)] }, P1, 'setsuna');
  const energies = Array.from({ length: energyZoneCount + belowCount + 1 }, (_, i) => createCardInstance({ cardCode: `E-${i}`, name: `E-${i}`, cardType: CardType.ENERGY }, P1, `energy-${i}`));
  let game = registerCards(createGameState('bp7-007', P1, 'P1', P2, 'P2'), [setsuna, ...energies]);
  game = updatePlayer(game, P1, (player) => {
    let memberSlots = placeCardInSlot(player.memberSlots, SlotPosition.CENTER, setsuna.instanceId, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP });
    for (const energy of energies.slice(energyZoneCount, energyZoneCount + belowCount)) memberSlots = addEnergyBelowMember(memberSlots, SlotPosition.CENTER, energy.instanceId);
    return { ...player, memberSlots,
      energyZone: { ...player.energyZone, cardIds: energies.slice(0, energyZoneCount).map((e) => e.instanceId), cardStates: new Map(energies.slice(0, energyZoneCount).map((e, i) => [e.instanceId, { orientation: i % 2 ? OrientationState.WAITING : OrientationState.ACTIVE, face: FaceState.FACE_UP }])) },
      energyDeck: { ...player.energyDeck, cardIds: [energies.at(-1)!.instanceId] },
    };
  });
  return { game, setsuna, deckEnergy: energies.at(-1)! };
}

describe('PL!N-bp7-007-SEC 优木雪菜', () => {
  it('energyBelow 与超过6张能量的两段红 Heart 独立叠加', () => {
    const { game, setsuna } = setup(8, 2);
    const red = getMemberEffectiveHeartIcons(game, P1, setsuna.instanceId).filter((heart) => heart.color === HeartColor.RED).reduce((sum, heart) => sum + heart.count, 0);
    expect(red).toBe(4);
  });

  it('LIVE成功单 pending 确认前不移动，确认后从能量卡组顶放到来源当前槽位且不发能量区放置事件', () => {
    const { game, setsuna, deckEnergy } = setup(6, 0);
    const pending: PendingAbilityState = { id: 'setsuna-live-success', abilityId: N_BP7_007_LIVE_SUCCESS_PLACE_ENERGY_DECK_BELOW_SELF_ABILITY_ID, sourceCardId: setsuna.instanceId, controllerId: P1, mandatory: true, timingId: TriggerCondition.ON_LIVE_SUCCESS, eventIds: ['live-success'], sourceSlot: SlotPosition.CENTER };
    const started = resolvePendingCardEffects({ ...game, pendingAbilities: [pending] }).gameState;
    expect(started.activeEffect).not.toBeNull();
    expect(started.players[0].energyDeck.cardIds).toContain(deckEnergy.instanceId);
    const done = confirmActiveEffectStep(started, P1, started.activeEffect!.id);
    expect(done.players[0].memberSlots.energyBelow[SlotPosition.CENTER]).toEqual([deckEnergy.instanceId]);
    expect(done.eventLog.some((entry) => entry.event.eventType === TriggerCondition.ON_ENERGY_PLACED_BY_CARD_EFFECT)).toBe(false);
    expect(done.actionHistory.at(-1)?.payload.placedEnergyCardIds).toEqual([deckEnergy.instanceId]);
  });
});
