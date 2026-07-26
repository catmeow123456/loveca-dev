import { describe, expect, it } from 'vitest';
import {
  activateCardAbility,
  confirmActiveEffectStep,
} from '../../src/application/card-effect-runner';
import {
  SP_BP7_003_ACTIVATED_REVEAL_COST_TEN_OR_TWENTY_MEMBER_STACK_DRAW_TWO_ABILITY_ID,
  SP_BP7_003_CONTINUOUS_MEMBER_BELOW_GAIN_BLADE_ABILITY_ID,
  SP_BP7_003_CONTINUOUS_THREE_MEMBER_BELOW_LIVE_SCORE_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
import {
  CardAbilityCategory,
  CardAbilitySourceZone,
} from '../../src/application/card-effects/ability-definition-types';
import { getCardAbilityDefinitionsForCardCode } from '../../src/application/card-effects/definitions/lookup';
import {
  createCardInstance,
  createHeartIcon,
  createHeartRequirement,
  type CardInstance,
} from '../../src/domain/entities/card';
import {
  createGameState,
  registerCards,
  updatePlayer,
  type GameState,
} from '../../src/domain/entities/game';
import {
  addCardToStatefulZone,
  addMemberBelowMember,
  placeCardInSlot,
  removeCardFromSlot,
} from '../../src/domain/entities/zone';
import { collectLiveModifiers } from '../../src/domain/rules/live-modifiers';
import { createPublicObjectId, projectPlayerViewState } from '../../src/online/projector';
import {
  CardType,
  FaceState,
  GamePhase,
  HeartColor,
  OrientationState,
  SlotPosition,
} from '../../src/shared/types/enums';

const P1 = 'p1';
const P2 = 'p2';
const ACTIVATED = SP_BP7_003_ACTIVATED_REVEAL_COST_TEN_OR_TWENTY_MEMBER_STACK_DRAW_TWO_ABILITY_ID;

function member(code: string, id: string, cost: number, ownerId = P1): CardInstance {
  return createCardInstance(
    {
      cardCode: code,
      name: id,
      groupNames: ['Liella!'],
      cardType: CardType.MEMBER,
      cost,
      blade: 1,
      hearts: [createHeartIcon(HeartColor.YELLOW, 1)],
    },
    ownerId,
    id
  );
}

function live(code: string, id: string): CardInstance {
  return createCardInstance(
    {
      cardCode: code,
      name: id,
      groupNames: ['Liella!'],
      cardType: CardType.LIVE,
      score: 1,
      requirements: createHeartRequirement({}),
    },
    P1,
    id
  );
}

function setup() {
  const source = member('PL!SP-bp7-003-SEC', 'chisato', 10);
  const cost10 = member('COST-10', 'cost-10', 10);
  const cost20 = member('COST-20', 'cost-20', 20);
  const cost11 = member('COST-11', 'cost-11', 11);
  const live10 = live('LIVE-10', 'live-10');
  const drawOne = member('DRAW-ONE', 'draw-one', 1);
  const drawTwo = member('DRAW-TWO', 'draw-two', 2);
  const cards = [source, cost10, cost20, cost11, live10, drawOne, drawTwo];
  let game = registerCards(createGameState('sp-bp7-003', P1, 'P1', P2, 'P2'), cards);
  game = updatePlayer(game, P1, (player) => ({
    ...player,
    hand: {
      ...player.hand,
      cardIds: [cost10.instanceId, cost20.instanceId, cost11.instanceId, live10.instanceId],
    },
    mainDeck: {
      ...player.mainDeck,
      cardIds: [drawOne.instanceId, drawTwo.instanceId],
    },
    memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    }),
  }));
  game = {
    ...game,
    currentPhase: GamePhase.MAIN_PHASE,
    activePlayerIndex: 0,
  };
  return { game, source, cost10, cost20, cost11, live10, drawOne, drawTwo };
}

function withMembersBelow(game: GameState, source: CardInstance, count: number): GameState {
  const belowCards = Array.from({ length: count }, (_, index) =>
    member(`BELOW-${index}`, `below-${index}`, index + 1)
  );
  let state = registerCards(game, belowCards);
  state = updatePlayer(state, P1, (player) => ({
    ...player,
    memberSlots: belowCards.reduce(
      (slots, card) => addMemberBelowMember(slots, SlotPosition.CENTER, card.instanceId),
      player.memberSlots
    ),
  }));
  expect(state.players[0].memberSlots.slots[SlotPosition.CENTER]).toBe(source.instanceId);
  return state;
}

describe('PL!SP-bp7-003-SEC 费用10「岚千砂都」', () => {
  it('按基础编号登记两段常时与一段起动能力', () => {
    const definitions = getCardAbilityDefinitionsForCardCode('PL!SP-bp7-003-SEC');
    expect(definitions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          abilityId: SP_BP7_003_CONTINUOUS_MEMBER_BELOW_GAIN_BLADE_ABILITY_ID,
          baseCardCodes: ['PL!SP-bp7-003'],
          category: CardAbilityCategory.CONTINUOUS,
          sourceZone: CardAbilitySourceZone.STAGE_MEMBER,
          queued: false,
          implemented: true,
        }),
        expect.objectContaining({
          abilityId: SP_BP7_003_CONTINUOUS_THREE_MEMBER_BELOW_LIVE_SCORE_ABILITY_ID,
          baseCardCodes: ['PL!SP-bp7-003'],
          category: CardAbilityCategory.CONTINUOUS,
          sourceZone: CardAbilitySourceZone.STAGE_MEMBER,
          queued: false,
          implemented: true,
        }),
        expect.objectContaining({
          abilityId: ACTIVATED,
          baseCardCodes: ['PL!SP-bp7-003'],
          category: CardAbilityCategory.ACTIVATED,
          sourceZone: CardAbilitySourceZone.STAGE_MEMBER,
          queued: false,
          implemented: true,
          perTurnLimit: 1,
        }),
      ])
    );
    expect(getCardAbilityDefinitionsForCardCode('PL!SP-bp7-003-R')).toHaveLength(3);
    expect(getCardAbilityDefinitionsForCardCode('PL!SP-bp7-004-SEC')).not.toContainEqual(
      expect.objectContaining({ abilityId: ACTIVATED })
    );
  });

  it('按来源槽真实 memberBelow 数量动态获得 BLADE，并仅在3张以上增加LIVE合计分数', () => {
    const scenario = setup();
    const twoBelow = withMembersBelow(scenario.game, scenario.source, 2);
    expect(collectLiveModifiers(twoBelow)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'BLADE',
          playerId: P1,
          sourceCardId: scenario.source.instanceId,
          abilityId: SP_BP7_003_CONTINUOUS_MEMBER_BELOW_GAIN_BLADE_ABILITY_ID,
          countDelta: 2,
        }),
      ])
    );
    expect(
      collectLiveModifiers(twoBelow).some(
        (modifier) =>
          modifier.abilityId === SP_BP7_003_CONTINUOUS_THREE_MEMBER_BELOW_LIVE_SCORE_ABILITY_ID
      )
    ).toBe(false);

    const threeBelow = withMembersBelow(scenario.game, scenario.source, 3);
    expect(collectLiveModifiers(threeBelow)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'BLADE',
          abilityId: SP_BP7_003_CONTINUOUS_MEMBER_BELOW_GAIN_BLADE_ABILITY_ID,
          countDelta: 3,
        }),
        expect.objectContaining({
          kind: 'SCORE',
          playerId: P1,
          sourceCardId: scenario.source.instanceId,
          abilityId: SP_BP7_003_CONTINUOUS_THREE_MEMBER_BELOW_LIVE_SCORE_ABILITY_ID,
          countDelta: 1,
        }),
      ])
    );

    const offStage = updatePlayer(threeBelow, P1, (player) => ({
      ...player,
      memberSlots: removeCardFromSlot(player.memberSlots, SlotPosition.CENTER),
    }));
    expect(
      collectLiveModifiers(offStage).filter(
        (modifier) =>
          modifier.abilityId === SP_BP7_003_CONTINUOUS_MEMBER_BELOW_GAIN_BLADE_ABILITY_ID ||
          modifier.abilityId === SP_BP7_003_CONTINUOUS_THREE_MEMBER_BELOW_LIVE_SCORE_ABILITY_ID
      )
    ).toEqual([]);
  });

  it('先私密选择并公开费用10或20成员，公开确认后压到来源下方再抽2', () => {
    const scenario = setup();
    const selecting = activateCardAbility(scenario.game, P1, scenario.source.instanceId, ACTIVATED);
    expect(selecting.activeEffect).toMatchObject({
      stepId: 'SP_BP7_003_SELECT_HAND_MEMBER_TO_REVEAL',
      selectableCardIds: [scenario.cost10.instanceId, scenario.cost20.instanceId],
      selectableCardVisibility: 'AWAITING_PLAYER_ONLY',
      selectionLabel: '选择要公开的费用10或20成员卡',
      confirmSelectionLabel: '公开',
      canSkipSelection: false,
    });
    expect(selecting.activeEffect?.selectableCardIds).not.toContain(scenario.cost11.instanceId);
    expect(selecting.activeEffect?.selectableCardIds).not.toContain(scenario.live10.instanceId);
    expect(projectPlayerViewState(selecting, P1).activeEffect?.selectableObjectIds).toEqual([
      createPublicObjectId(scenario.cost10.instanceId),
      createPublicObjectId(scenario.cost20.instanceId),
    ]);
    expect(projectPlayerViewState(selecting, P2).activeEffect?.selectableObjectIds).toBeUndefined();

    const revealed = confirmActiveEffectStep(
      selecting,
      P1,
      selecting.activeEffect!.id,
      scenario.cost20.instanceId
    );
    expect(revealed.activeEffect).toMatchObject({
      stepId: 'SP_BP7_003_REVEAL_HAND_MEMBER_COST',
      revealedCardIds: [scenario.cost20.instanceId],
      selectableCardIds: [],
      selectableCardVisibility: 'PUBLIC',
      confirmSelectionLabel: '放置于成员下方',
    });
    expect(revealed.players[0].hand.cardIds).toContain(scenario.cost20.instanceId);
    expect(revealed.players[0].memberSlots.memberBelow[SlotPosition.CENTER]).toEqual([]);
    expect(revealed.players[0].mainDeck.cardIds).toEqual([
      scenario.drawOne.instanceId,
      scenario.drawTwo.instanceId,
    ]);
    for (const viewerId of [P1, P2]) {
      expect(projectPlayerViewState(revealed, viewerId).activeEffect?.revealedObjectIds).toEqual([
        createPublicObjectId(scenario.cost20.instanceId),
      ]);
    }
    expect(
      revealed.actionHistory.some(
        (action) =>
          action.type === 'PAY_COST' &&
          action.payload.abilityId === ACTIVATED &&
          Array.isArray(action.payload.revealedCardIds) &&
          action.payload.revealedCardIds.includes(scenario.cost20.instanceId)
      )
    ).toBe(true);

    const done = confirmActiveEffectStep(revealed, P1, revealed.activeEffect!.id);
    expect(done.activeEffect).toBeNull();
    expect(done.players[0].hand.cardIds).toEqual([
      scenario.cost10.instanceId,
      scenario.cost11.instanceId,
      scenario.live10.instanceId,
      scenario.drawOne.instanceId,
      scenario.drawTwo.instanceId,
    ]);
    expect(done.players[0].memberSlots.memberBelow[SlotPosition.CENTER]).toEqual([
      scenario.cost20.instanceId,
    ]);
    expect(done.players[0].mainDeck.cardIds).toEqual([]);
    expect(activateCardAbility(done, P1, scenario.source.instanceId, ACTIVATED)).toBe(done);
  });

  it('来源或待公开手牌 stale 时不公开、不记录费用且保持原选择窗口', () => {
    const scenario = setup();
    const selecting = activateCardAbility(scenario.game, P1, scenario.source.instanceId, ACTIVATED);
    const sourceStale = updatePlayer(selecting, P1, (player) => ({
      ...player,
      memberSlots: removeCardFromSlot(player.memberSlots, SlotPosition.CENTER),
    }));
    expect(
      confirmActiveEffectStep(
        sourceStale,
        P1,
        sourceStale.activeEffect!.id,
        scenario.cost10.instanceId
      )
    ).toBe(sourceStale);

    const handStale = updatePlayer(selecting, P1, (player) => ({
      ...player,
      hand: {
        ...player.hand,
        cardIds: player.hand.cardIds.filter((cardId) => cardId !== scenario.cost10.instanceId),
      },
      waitingRoom: addCardToStatefulZone(player.waitingRoom, scenario.cost10.instanceId),
    }));
    const result = confirmActiveEffectStep(
      handStale,
      P1,
      handStale.activeEffect!.id,
      scenario.cost10.instanceId
    );
    expect(result).toBe(handStale);
    expect(
      result.actionHistory.some(
        (action) =>
          action.payload.abilityId === ACTIVATED &&
          (action.type === 'PAY_COST' || action.payload.step === 'ABILITY_USE')
      )
    ).toBe(false);
  });

  it('非自己主要阶段或没有合法公开费用时不能开始起动窗口', () => {
    const scenario = setup();
    const noEligibleHand = updatePlayer(scenario.game, P1, (player) => ({
      ...player,
      hand: {
        ...player.hand,
        cardIds: [scenario.cost11.instanceId, scenario.live10.instanceId],
      },
    }));
    expect(activateCardAbility(noEligibleHand, P1, scenario.source.instanceId, ACTIVATED)).toBe(
      noEligibleHand
    );

    const livePhase = { ...scenario.game, currentPhase: GamePhase.PERFORMANCE_PHASE };
    expect(activateCardAbility(livePhase, P1, scenario.source.instanceId, ACTIVATED)).toBe(
      livePhase
    );
    expect(activateCardAbility(scenario.game, P2, scenario.source.instanceId, ACTIVATED)).toBe(
      scenario.game
    );
  });

  it('公开后来源或费用卡 stale 时不压入、不抽牌且不消费公开窗口', () => {
    const scenario = setup();
    const selecting = activateCardAbility(scenario.game, P1, scenario.source.instanceId, ACTIVATED);
    const revealed = confirmActiveEffectStep(
      selecting,
      P1,
      selecting.activeEffect!.id,
      scenario.cost10.instanceId
    );
    const sourceStale = updatePlayer(revealed, P1, (player) => ({
      ...player,
      memberSlots: removeCardFromSlot(player.memberSlots, SlotPosition.CENTER),
    }));
    expect(confirmActiveEffectStep(sourceStale, P1, sourceStale.activeEffect!.id)).toBe(
      sourceStale
    );

    const handStale = updatePlayer(revealed, P1, (player) => ({
      ...player,
      hand: {
        ...player.hand,
        cardIds: player.hand.cardIds.filter((cardId) => cardId !== scenario.cost10.instanceId),
      },
      waitingRoom: addCardToStatefulZone(player.waitingRoom, scenario.cost10.instanceId),
    }));
    const result = confirmActiveEffectStep(handStale, P1, handStale.activeEffect!.id);
    expect(result).toBe(handStale);
    expect(result.activeEffect?.stepId).toBe('SP_BP7_003_REVEAL_HAND_MEMBER_COST');
    expect(result.players[0].mainDeck.cardIds).toEqual([
      scenario.drawOne.instanceId,
      scenario.drawTwo.instanceId,
    ]);
  });
});
