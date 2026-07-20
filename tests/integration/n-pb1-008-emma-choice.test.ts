import { describe, expect, it } from 'vitest';
import {
  confirmActiveEffectStep,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import { EMMA_ON_ENTER_ACTIVATE_MEMBER_OR_ENERGY_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
import { createCardInstance, createHeartIcon } from '../../src/domain/entities/card';
import {
  createGameState,
  registerCards,
  updatePlayer,
  type PendingAbilityState,
} from '../../src/domain/entities/game';
import { placeCardInSlot } from '../../src/domain/entities/zone';
import {
  CardType,
  FaceState,
  HeartColor,
  OrientationState,
  SlotPosition,
  TriggerCondition,
} from '../../src/shared/types/enums';

const P1 = 'p1';
const P2 = 'p2';

describe('PL!N-pb1-008-P+ 艾玛·维尔德选择性能量活跃', () => {
  it('能量区4张全部已活跃时仍可选能量分支，并以0张实际变化正常结束', () => {
    const source = createCardInstance(
      {
        cardCode: 'PL!N-pb1-008-P+',
        name: '艾玛·维尔德',
        groupNames: ['虹ヶ咲'],
        cardType: CardType.MEMBER,
        cost: 17,
        blade: 1,
        hearts: [createHeartIcon(HeartColor.GREEN, 1)],
      },
      P1,
      'emma'
    );
    const energies = Array.from({ length: 4 }, (_, index) =>
      createCardInstance(
        {
          cardCode: `ENERGY-${index}`,
          name: `Energy ${index}`,
          cardType: CardType.ENERGY,
        },
        P1,
        `energy-${index}`
      )
    );
    let game = registerCards(createGameState('emma-all-active', P1, 'P1', P2, 'P2'), [
      source,
      ...energies,
    ]);
    game = updatePlayer(game, P1, (player) => ({
      ...player,
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      }),
      energyZone: {
        ...player.energyZone,
        cardIds: energies.map((card) => card.instanceId),
        cardStates: new Map(
          energies.map((card) => [
            card.instanceId,
            { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP },
          ])
        ),
      },
    }));
    const pending: PendingAbilityState = {
      id: 'emma-enter',
      abilityId: EMMA_ON_ENTER_ACTIVATE_MEMBER_OR_ENERGY_ABILITY_ID,
      sourceCardId: source.instanceId,
      controllerId: P1,
      mandatory: true,
      timingId: TriggerCondition.ON_ENTER_STAGE,
      eventIds: ['emma-enter-event'],
      sourceSlot: SlotPosition.CENTER,
    };

    const choosing = resolvePendingCardEffects({ ...game, pendingAbilities: [pending] }).gameState;
    expect(choosing.activeEffect?.selectableOptions).toEqual([
      { id: 'energy', label: '将能量变活跃' },
    ]);

    const done = confirmActiveEffectStep(
      choosing,
      P1,
      choosing.activeEffect!.id,
      undefined,
      undefined,
      undefined,
      'energy'
    );
    expect(done.activeEffect).toBeNull();
    expect(
      energies.map(
        (card) => done.players[0].energyZone.cardStates.get(card.instanceId)?.orientation
      )
    ).toEqual(Array.from({ length: 4 }, () => OrientationState.ACTIVE));
    expect(done.actionHistory.at(-1)?.payload).toMatchObject({
      abilityId: EMMA_ON_ENTER_ACTIVATE_MEMBER_OR_ENERGY_ABILITY_ID,
      step: 'ACTIVATE_ENERGY',
      activatedEnergyCardIds: [],
    });
  });
});
