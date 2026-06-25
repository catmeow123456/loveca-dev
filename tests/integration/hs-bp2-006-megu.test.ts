import { describe, expect, it } from 'vitest';
import type { MemberCardData } from '../../src/domain/entities/card';
import { createCardInstance, createHeartIcon } from '../../src/domain/entities/card';
import {
  createGameState,
  registerCards,
  updatePlayer,
  type PendingAbilityState,
} from '../../src/domain/entities/game';
import { placeCardInSlot } from '../../src/domain/entities/zone';
import {
  confirmActiveEffectStep,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import {
  HS_BP2_006_CONTINUOUS_OTHER_MIRACRA_STAGE_MEMBER_BLADE_ABILITY_ID,
  HS_BP2_006_ON_ENTER_STAGE_FORMATION_CHANGE_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
import {
  collectLiveModifiers,
  getMemberEffectiveBladeCount,
} from '../../src/domain/rules/live-modifiers';
import { CardType, HeartColor, SlotPosition, TriggerCondition } from '../../src/shared/types/enums';

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';

function createMember(cardCode: string, name: string, unitName: string): MemberCardData {
  return {
    cardCode,
    name,
    groupName: '蓮ノ空',
    unitName,
    cardType: CardType.MEMBER,
    cost: 15,
    blade: cardCode === 'PL!HS-bp2-006-R' ? 4 : 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
  };
}

function pendingAbility(sourceCardId: string): PendingAbilityState {
  return {
    id: 'hs-bp2-006-pending',
    abilityId: HS_BP2_006_ON_ENTER_STAGE_FORMATION_CHANGE_ABILITY_ID,
    sourceCardId,
    controllerId: PLAYER1,
    mandatory: true,
    timingId: TriggerCondition.ON_ENTER_STAGE,
    eventIds: ['enter-stage'],
  };
}

describe('PL!HS-bp2-006 Megu workflow and continuous modifier', () => {
  it('resolves on-enter stage rearrangement and keeps continuous Miracra BLADE active', () => {
    const megu = createCardInstance(
      createMember('PL!HS-bp2-006-R', '藤島 慈', 'みらくらぱーく!'),
      PLAYER1,
      'megu'
    );
    const rurino = createCardInstance(
      createMember('PL!HS-test-rurino', '大沢瑠璃乃', 'みらくらぱーく！'),
      PLAYER1,
      'rurino'
    );
    const hime = createCardInstance(
      createMember('PL!HS-test-hime', '安養寺姫芽', 'Mira-Cra Park!'),
      PLAYER1,
      'hime'
    );
    let game = createGameState('hs-bp2-006-megu', PLAYER1, 'P1', PLAYER2, 'P2');
    game = registerCards(game, [megu, rurino, hime]);
    game = updatePlayer(game, PLAYER1, (player) => ({
      ...player,
      memberSlots: placeCardInSlot(
        placeCardInSlot(
          placeCardInSlot(player.memberSlots, SlotPosition.LEFT, rurino.instanceId),
          SlotPosition.CENTER,
          megu.instanceId
        ),
        SlotPosition.RIGHT,
        hime.instanceId
      ),
    }));

    let state = resolvePendingCardEffects({
      ...game,
      pendingAbilities: [pendingAbility(megu.instanceId)],
    }).gameState;
    expect(state.activeEffect?.selectableOptions).toBeUndefined();
    expect(state.activeEffect?.stageFormation).toBeDefined();

    state = confirmActiveEffectStep(
      state,
      PLAYER1,
      state.activeEffect!.id,
      undefined,
      undefined,
      false,
      undefined,
      undefined,
      undefined,
      [
        { cardId: megu.instanceId, toSlot: SlotPosition.LEFT },
        { cardId: hime.instanceId, toSlot: SlotPosition.CENTER },
      ]
    );

    expect(state.players[0].memberSlots.slots[SlotPosition.LEFT]).toBe(megu.instanceId);
    expect(state.players[0].memberSlots.slots[SlotPosition.CENTER]).toBe(hime.instanceId);
    expect(state.players[0].memberSlots.slots[SlotPosition.RIGHT]).toBe(rurino.instanceId);

    const modifiers = collectLiveModifiers(state);
    expect(modifiers).toContainEqual({
      kind: 'BLADE',
      playerId: PLAYER1,
      countDelta: 2,
      sourceCardId: megu.instanceId,
      abilityId: HS_BP2_006_CONTINUOUS_OTHER_MIRACRA_STAGE_MEMBER_BLADE_ABILITY_ID,
    });
    expect(getMemberEffectiveBladeCount(state, PLAYER1, megu.instanceId, modifiers)).toBe(6);
  });
});
