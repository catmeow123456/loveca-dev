import { describe, expect, it } from 'vitest';
import {
  N_BP7_006_ACTIVATED_MILL_TOP_THREE_CHOOSE_ENERGY_OR_BLADE_ABILITY_ID,
  N_BP7_006_ACTIVATED_PAY_ENERGY_INSPECT_TOP_FOUR_ABILITY_ID,
  SP_BP5_020_ACTIVATED_PAY_TWO_ENERGY_DRAW_ONE_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
import { getRenGrantedActivatedAbilityDefinitions } from '../../src/application/card-effects/runtime/granted-activated-abilities';
import { hasRemainingLimitedActivatedAbilityForStageMember } from '../../src/application/card-effects/runtime/limited-activated-ability-status';
import { recordAbilityUseForContext } from '../../src/application/card-effects/runtime/workflow-helpers';
import {
  createCardInstance,
  createDefaultCardState,
  createHeartIcon,
  type MemberCardData,
} from '../../src/domain/entities/card';
import {
  createGameState,
  registerCards,
  updatePlayer,
  type GameState,
} from '../../src/domain/entities/game';
import { createPublicObjectId, projectPlayerViewState } from '../../src/online/projector';
import { CardType, HeartColor, SlotPosition } from '../../src/shared/types/enums';

const P1 = 'p1';
const P2 = 'p2';

function memberData(
  cardCode: string,
  name: string,
  groupNames?: readonly string[]
): MemberCardData {
  return {
    cardCode,
    name,
    cardType: CardType.MEMBER,
    cost: 1,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
    ...(groupNames ? { groupNames } : {}),
  };
}

function placeStageMembers(
  gameId: string,
  members: readonly {
    readonly cardCode: string;
    readonly name: string;
    readonly id: string;
    readonly slot: SlotPosition;
  }[]
): GameState {
  const cards = members.map((member) =>
    createCardInstance(memberData(member.cardCode, member.name), P1, member.id)
  );
  let game = registerCards(createGameState(gameId, P1, 'P1', P2, 'P2'), cards);
  game = updatePlayer(game, P1, (player) => ({
    ...player,
    memberSlots: {
      ...player.memberSlots,
      slots: members.reduce((slots, member) => ({ ...slots, [member.slot]: member.id }), {
        ...player.memberSlots.slots,
      }),
      cardStates: new Map(cards.map((card) => [card.instanceId, createDefaultCardState()])),
    },
  }));
  return game;
}

describe('limited activated ability stage reminder status', () => {
  it('only marks implemented per-turn activated stage abilities and follows all independent limits', () => {
    const limitedId = 'limited-kanata';
    const unlimitedId = 'unlimited-shiki';
    const nonActivatedId = 'non-activated-setsuna';
    let game = placeStageMembers('limited-activated-status', [
      {
        cardCode: 'PL!N-bp7-006-P',
        name: '近江彼方',
        id: limitedId,
        slot: SlotPosition.LEFT,
      },
      {
        cardCode: 'PL!SP-bp7-008-P',
        name: '若菜四季',
        id: unlimitedId,
        slot: SlotPosition.CENTER,
      },
      {
        cardCode: 'PL!N-bp7-007-P',
        name: '优木雪菜',
        id: nonActivatedId,
        slot: SlotPosition.RIGHT,
      },
    ]);

    expect(hasRemainingLimitedActivatedAbilityForStageMember(game, P1, limitedId)).toBe(true);
    expect(hasRemainingLimitedActivatedAbilityForStageMember(game, P1, unlimitedId)).toBe(false);
    expect(hasRemainingLimitedActivatedAbilityForStageMember(game, P1, nonActivatedId)).toBe(false);

    const ownView = projectPlayerViewState(game, P1);
    const opponentView = projectPlayerViewState(game, P2);
    expect(
      ownView.objects[createPublicObjectId(limitedId)]?.hasRemainingLimitedActivatedAbility
    ).toBe(true);
    expect(
      ownView.objects[createPublicObjectId(unlimitedId)]?.hasRemainingLimitedActivatedAbility
    ).toBeUndefined();
    expect(
      ownView.objects[createPublicObjectId(nonActivatedId)]?.hasRemainingLimitedActivatedAbility
    ).toBeUndefined();
    expect(
      opponentView.objects[createPublicObjectId(limitedId)]?.hasRemainingLimitedActivatedAbility
    ).toBeUndefined();

    game = recordAbilityUseForContext(game, P1, {
      abilityId: N_BP7_006_ACTIVATED_PAY_ENERGY_INSPECT_TOP_FOUR_ABILITY_ID,
      sourceCardId: limitedId,
    });
    game = recordAbilityUseForContext(game, P1, {
      abilityId: N_BP7_006_ACTIVATED_MILL_TOP_THREE_CHOOSE_ENERGY_OR_BLADE_ABILITY_ID,
      sourceCardId: limitedId,
    });
    expect(hasRemainingLimitedActivatedAbilityForStageMember(game, P1, limitedId)).toBe(true);

    game = recordAbilityUseForContext(game, P1, {
      abilityId: N_BP7_006_ACTIVATED_MILL_TOP_THREE_CHOOSE_ENERGY_OR_BLADE_ABILITY_ID,
      sourceCardId: limitedId,
    });
    expect(hasRemainingLimitedActivatedAbilityForStageMember(game, P1, limitedId)).toBe(false);
    expect(
      projectPlayerViewState(game, P1).objects[createPublicObjectId(limitedId)]
        ?.hasRemainingLimitedActivatedAbility
    ).toBeUndefined();

    game = { ...game, turnCount: game.turnCount + 1 };
    expect(hasRemainingLimitedActivatedAbilityForStageMember(game, P1, limitedId)).toBe(true);
  });

  it('counts a Ren-granted activated ability against the host ability instance', () => {
    const hostId = 'ren-host';
    const grantingId = 'granted-natsumi';
    const host = createCardInstance(memberData('PL!SP-pb2-005-R', '叶月恋'), P1, hostId);
    const grantingMember = createCardInstance(
      memberData('PL!SP-bp5-020-P', '鬼冢夏美', ['Liella!']),
      P1,
      grantingId
    );
    let game = registerCards(createGameState('ren-limited-reminder', P1, 'P1', P2, 'P2'), [
      host,
      grantingMember,
    ]);
    game = updatePlayer(game, P1, (player) => ({
      ...player,
      memberSlots: {
        ...player.memberSlots,
        slots: { ...player.memberSlots.slots, [SlotPosition.CENTER]: hostId },
        memberBelow: {
          ...player.memberSlots.memberBelow,
          [SlotPosition.CENTER]: [grantingId],
        },
        cardStates: new Map([[hostId, createDefaultCardState()]]),
      },
    }));

    const granted = getRenGrantedActivatedAbilityDefinitions(game, P1, hostId).find(
      (candidate) =>
        candidate.definition.abilityId === SP_BP5_020_ACTIVATED_PAY_TWO_ENERGY_DRAW_ONE_ABILITY_ID
    );
    expect(granted).toBeDefined();
    expect(hasRemainingLimitedActivatedAbilityForStageMember(game, P1, hostId)).toBe(true);

    game = recordAbilityUseForContext(game, P1, {
      abilityId: SP_BP5_020_ACTIVATED_PAY_TWO_ENERGY_DRAW_ONE_ABILITY_ID,
      abilityInstanceId: granted?.abilityInstanceId,
      sourceCardId: hostId,
    });
    expect(hasRemainingLimitedActivatedAbilityForStageMember(game, P1, hostId)).toBe(false);
  });
});
