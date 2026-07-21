import { describe, expect, it } from 'vitest';
import { resolvePendingCardEffects } from '../../src/application/card-effect-runner';
import { N_BP7_019_AUTO_RELAY_NIJIGASAKI_PLACE_ENERGY_BELOW_REPLACEMENT_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
import { createCardInstance, createHeartIcon } from '../../src/domain/entities/card';
import { createGameState, emitGameEvent, registerCards, updatePlayer, type PendingAbilityState } from '../../src/domain/entities/game';
import { placeCardInSlot } from '../../src/domain/entities/zone';
import { CardType, FaceState, HeartColor, OrientationState, SlotPosition, TriggerCondition, ZoneType } from '../../src/shared/types/enums';

const P1 = 'p1'; const P2 = 'p2';
function member(code: string, id: string, groups: readonly string[]) { return createCardInstance({ cardCode: code, name: id, groupNames: groups, cardType: CardType.MEMBER, cost: 5, blade: 1, hearts: [createHeartIcon(HeartColor.RED, 1)] }, P1, id); }
function setup(replacingCardId: string | null = 'replacement', groups: readonly string[] = ['虹ヶ咲']) {
  const setsuna = member('PL!N-bp7-019-N', 'setsuna', ['虹ヶ咲']);
  const replacement = member('REPLACEMENT', 'replacement', groups);
  const energy = createCardInstance({ cardCode: 'ENERGY', name: 'Energy', cardType: CardType.ENERGY }, P1, 'energy');
  let game = registerCards(createGameState('bp7-019', P1, 'P1', P2, 'P2'), [setsuna, replacement, energy]);
  game = updatePlayer(game, P1, (player) => ({ ...player,
    memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.RIGHT, replacement.instanceId, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }),
    energyDeck: { ...player.energyDeck, cardIds: [energy.instanceId] },
  }));
  game = emitGameEvent(game, { eventId: 'leave-setsuna', eventType: TriggerCondition.ON_LEAVE_STAGE, timestamp: 1, triggerPlayerId: P1, cardInstanceId: setsuna.instanceId, fromZone: ZoneType.MEMBER_SLOT, toZone: ZoneType.WAITING_ROOM, fromSlot: SlotPosition.CENTER, ownerId: P1, controllerId: P1, ...(replacingCardId ? { replacingCardId } : {}) });
  const pending: PendingAbilityState = { id: 'setsuna-leave', abilityId: N_BP7_019_AUTO_RELAY_NIJIGASAKI_PLACE_ENERGY_BELOW_REPLACEMENT_ABILITY_ID, sourceCardId: setsuna.instanceId, controllerId: P1, mandatory: true, timingId: TriggerCondition.ON_LEAVE_STAGE, eventIds: ['leave-setsuna'], sourceSlot: SlotPosition.CENTER };
  return { game: { ...game, pendingAbilities: [pending] }, energy };
}

describe('PL!N-bp7-019-N 优木雪菜', () => {
  it('只用真实 relay replacingCardId，且来源不再位于休息室也不取消已触发效果', () => {
    const { game, energy } = setup();
    const done = resolvePendingCardEffects(game).gameState;
    expect(done.players[0].memberSlots.energyBelow[SlotPosition.RIGHT]).toEqual([energy.instanceId]);
    expect(done.actionHistory.at(-1)?.payload.placedEnergyCardIds).toEqual([energy.instanceId]);
  });

  it.each([[null, ['虹ヶ咲']], ['replacement', ['Aqours']]] as const)('无真实换手或 replacement 非虹咲时 no-op', (replacementId, groups) => {
    const { game, energy } = setup(replacementId, groups);
    const done = resolvePendingCardEffects(game).gameState;
    expect(done.players[0].energyDeck.cardIds).toContain(energy.instanceId);
    expect(done.pendingAbilities).toEqual([]);
  });
});
