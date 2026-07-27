import { describe, expect, it } from 'vitest';
import {
  activateCardAbility,
  confirmActiveEffectStep,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import {
  N_BP7_001_AUTO_TURN_ONCE_ENERGY_PLACED_BELOW_PLACE_WAITING_ENERGY_ABILITY_ID,
  N_BP7_010_ACTIVATED_STACK_ENERGY_PLAY_LOW_COST_NIJIGASAKI_FROM_WAITING_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
import { createCardInstance, createHeartIcon } from '../../src/domain/entities/card';
import {
  createGameState,
  registerCards,
  updatePlayer,
  type GameState,
} from '../../src/domain/entities/game';
import { placeCardInSlot } from '../../src/domain/entities/zone';
import { canPlayMemberInStageSlotThisTurn } from '../../src/domain/rules/member-turn-state';
import {
  CardType,
  FaceState,
  GamePhase,
  HeartColor,
  OrientationState,
  SlotPosition,
  TriggerCondition,
} from '../../src/shared/types/enums';

const P1 = 'p1';
const P2 = 'p2';

function member(
  cardCode: string,
  instanceId: string,
  cost: number,
  groupNames: readonly string[] = ['虹ヶ咲']
) {
  return createCardInstance(
    {
      cardCode,
      name: instanceId,
      groupNames,
      cardType: CardType.MEMBER,
      cost,
      blade: 1,
      hearts: [createHeartIcon(HeartColor.PINK, 1)],
    },
    P1,
    instanceId
  );
}

function energy(instanceId: string) {
  return createCardInstance(
    { cardCode: `ENERGY-${instanceId}`, name: instanceId, cardType: CardType.ENERGY },
    P1,
    instanceId
  );
}

function setup(): {
  readonly game: GameState;
  readonly shiorikoId: string;
  readonly ayumuId: string;
  readonly targetId: string;
  readonly energyId: string;
  readonly deckEnergyId: string;
} {
  const shioriko = member('PL!N-bp7-010-P', 'shioriko-bp7-010', 9);
  const ayumu = member('PL!N-bp7-001-P', 'ayumu-bp7-001', 4);
  const target = member('TARGET-NIJIGASAKI-COST-2', 'waiting-target', 2);
  const energyCard = energy('energy-zone-card');
  const deckEnergy = energy('energy-deck-card');
  let game = registerCards(
    createGameState('n-bp7-010-shioriko', P1, 'P1', P2, 'P2'),
    [shioriko, ayumu, target, energyCard, deckEnergy]
  );
  game = updatePlayer(game, P1, (player) => ({
    ...player,
    memberSlots: placeCardInSlot(
      placeCardInSlot(player.memberSlots, SlotPosition.LEFT, ayumu.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      }),
      SlotPosition.CENTER,
      shioriko.instanceId,
      {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      }
    ),
    waitingRoom: { ...player.waitingRoom, cardIds: [target.instanceId] },
    energyZone: {
      ...player.energyZone,
      cardIds: [energyCard.instanceId],
      cardStates: new Map([
        [
          energyCard.instanceId,
          { orientation: OrientationState.WAITING, face: FaceState.FACE_UP },
        ],
      ]),
    },
    energyDeck: { ...player.energyDeck, cardIds: [deckEnergy.instanceId] },
  }));
  return {
    game: { ...game, currentPhase: GamePhase.MAIN_PHASE, activePlayerIndex: 0 },
    shiorikoId: shioriko.instanceId,
    ayumuId: ayumu.instanceId,
    targetId: target.instanceId,
    energyId: energyCard.instanceId,
    deckEnergyId: deckEnergy.instanceId,
  };
}

describe('PL!N-bp7-010-P 三船栞子', () => {
  it('pays by stacking energy, plays one low-cost Nijigasaki member WAITING, locks that slot, then continues Ayumu trigger', () => {
    const scenario = setup();
    const selectingMember = activateCardAbility(
      scenario.game,
      P1,
      scenario.shiorikoId,
      N_BP7_010_ACTIVATED_STACK_ENERGY_PLAY_LOW_COST_NIJIGASAKI_FROM_WAITING_ABILITY_ID
    );
    expect(selectingMember.players[0].energyZone.cardIds).toEqual([]);
    expect(selectingMember.players[0].memberSlots.energyBelow[SlotPosition.CENTER]).toEqual([
      scenario.energyId,
    ]);
    expect(selectingMember.activeEffect).toMatchObject({
      abilityId:
        N_BP7_010_ACTIVATED_STACK_ENERGY_PLAY_LOW_COST_NIJIGASAKI_FROM_WAITING_ABILITY_ID,
      stepText: '请从自己的休息室选择1张费用小于等于2的『虹咲』成员卡。',
      selectableCardIds: [scenario.targetId],
      selectableCardVisibility: 'PUBLIC',
      selectionLabel: '选择要登场的成员',
      confirmSelectionLabel: '选择登场区域',
    });

    const selectingSlot = confirmActiveEffectStep(
      selectingMember,
      P1,
      selectingMember.activeEffect!.id,
      scenario.targetId
    );
    expect(selectingSlot.activeEffect).toMatchObject({
      stepText: '请选择该成员要登场的空区域。',
      selectableSlots: [SlotPosition.RIGHT],
      selectionLabel: '选择登场区域',
      confirmSelectionLabel: '以待机状态登场',
    });

    const done = confirmActiveEffectStep(
      selectingSlot,
      P1,
      selectingSlot.activeEffect!.id,
      undefined,
      SlotPosition.RIGHT
    );
    expect(done.players[0].memberSlots.slots[SlotPosition.RIGHT]).toBe(
      scenario.targetId
    );
    expect(
      done.players[0].memberSlots.cardStates.get(scenario.targetId)?.orientation
    ).toBe(OrientationState.WAITING);
    expect(done.players[0].waitingRoom.cardIds).not.toContain(scenario.targetId);
    expect(done.players[0].movedToStageThisTurn).toContain(scenario.targetId);
    expect(canPlayMemberInStageSlotThisTurn(done, P1, SlotPosition.RIGHT)).toBe(
      false
    );
    expect(
      done.eventLog.some(
        (entry) =>
          entry.event.eventType === TriggerCondition.ON_ENTER_STAGE &&
          entry.event.cardInstanceId === scenario.targetId
      )
    ).toBe(true);
    expect(done.activeEffect).toBeNull();
    expect(done.pendingAbilities).toEqual([]);
    expect(
      done.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            N_BP7_001_AUTO_TURN_ONCE_ENERGY_PLACED_BELOW_PLACE_WAITING_ENERGY_ABILITY_ID
      )
    ).toBe(true);
    expect(done.players[0].energyZone.cardIds).toEqual([scenario.deckEnergyId]);
    expect(done.players[0].energyZone.cardStates.get(scenario.deckEnergyId)?.orientation).toBe(
      OrientationState.WAITING
    );
  });

  it('does not pay or consume the turn use when an activation precondition is missing', () => {
    const scenario = setup();
    const noEnergy = updatePlayer(scenario.game, P1, (player) => ({
      ...player,
      energyZone: { ...player.energyZone, cardIds: [], cardStates: new Map() },
    }));
    const rejected = activateCardAbility(
      noEnergy,
      P1,
      scenario.shiorikoId,
      N_BP7_010_ACTIVATED_STACK_ENERGY_PLAY_LOW_COST_NIJIGASAKI_FROM_WAITING_ABILITY_ID
    );
    expect(rejected).toBe(noEnergy);
    expect(rejected.actionHistory).toEqual([]);
    expect(rejected.pendingAbilities).toEqual([]);
  });

  it('still pays the energy-below cost and consumes the turn use when no eligible member exists', () => {
    const scenario = setup();
    const noTarget = updatePlayer(scenario.game, P1, (player) => ({
      ...player,
      waitingRoom: { ...player.waitingRoom, cardIds: [] },
    }));
    const activated = activateCardAbility(
      noTarget,
      P1,
      scenario.shiorikoId,
      N_BP7_010_ACTIVATED_STACK_ENERGY_PLAY_LOW_COST_NIJIGASAKI_FROM_WAITING_ABILITY_ID
    );

    expect(activated).not.toBe(noTarget);
    expect(activated.activeEffect).toBeNull();
    expect(activated.players[0].energyZone.cardIds).toEqual([]);
    expect(activated.players[0].memberSlots.energyBelow[SlotPosition.CENTER]).toEqual([
      scenario.energyId,
    ]);
    expect(activated.actionHistory).toContainEqual(
      expect.objectContaining({
        type: 'RESOLVE_ABILITY',
        payload: expect.objectContaining({
          abilityId:
            N_BP7_010_ACTIVATED_STACK_ENERGY_PLAY_LOW_COST_NIJIGASAKI_FROM_WAITING_ABILITY_ID,
          step: 'NO_PLAY_AFTER_COST',
          reason: 'NO_ELIGIBLE_WAITING_ROOM_MEMBER',
          stackedEnergyCardIds: [scenario.energyId],
        }),
      })
    );
    expect(
      activated.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            N_BP7_010_ACTIVATED_STACK_ENERGY_PLAY_LOW_COST_NIJIGASAKI_FROM_WAITING_ABILITY_ID &&
          action.payload.step === 'ABILITY_USE'
      )
    ).toBe(true);

    const done = resolvePendingCardEffects(activated).gameState;
    expect(done.pendingAbilities).toEqual([]);
    expect(done.players[0].energyZone.cardIds).toEqual([scenario.deckEnergyId]);
  });

  it('also pays the cost when every member area is occupied', () => {
    const scenario = setup();
    const filler = member('FILLER', 'right-filler', 1);
    let fullStage = registerCards(scenario.game, [filler]);
    fullStage = updatePlayer(fullStage, P1, (player) => ({
      ...player,
      memberSlots: placeCardInSlot(
        player.memberSlots,
        SlotPosition.RIGHT,
        filler.instanceId,
        {
          orientation: OrientationState.ACTIVE,
          face: FaceState.FACE_UP,
        }
      ),
    }));
    const activated = activateCardAbility(
      fullStage,
      P1,
      scenario.shiorikoId,
      N_BP7_010_ACTIVATED_STACK_ENERGY_PLAY_LOW_COST_NIJIGASAKI_FROM_WAITING_ABILITY_ID
    );

    expect(activated.players[0].memberSlots.energyBelow[SlotPosition.CENTER]).toEqual([
      scenario.energyId,
    ]);
    expect(activated.players[0].waitingRoom.cardIds).toContain(scenario.targetId);
    expect(activated.activeEffect).toBeNull();
    expect(activated.actionHistory).toContainEqual(
      expect.objectContaining({
        type: 'RESOLVE_ABILITY',
        payload: expect.objectContaining({
          abilityId:
            N_BP7_010_ACTIVATED_STACK_ENERGY_PLAY_LOW_COST_NIJIGASAKI_FROM_WAITING_ABILITY_ID,
          step: 'NO_PLAY_AFTER_COST',
          reason: 'NO_EMPTY_LEGAL_SLOT',
        }),
      })
    );
  });
});
