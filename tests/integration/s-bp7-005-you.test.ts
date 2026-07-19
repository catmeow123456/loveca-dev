import { describe, expect, it } from 'vitest';
import {
  activateCardAbility,
  confirmActiveEffectStep,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import {
  PL_S_BP5_004_ON_ENTER_CHOOSE_AQOURS_BLADE_OR_SAINTSNOW_POSITION_CHANGE_ABILITY_ID,
  PL_S_PB1_001_ON_ENTER_OPPONENT_HAND_TWO_MORE_RECOVER_LIVE_ABILITY_ID,
  PL_S_PB1_002_ON_ENTER_OPPONENT_DISCARD_LIVE_OR_SOURCE_SCORE_ABILITY_ID,
  S_BP7_002_ON_ENTER_AQOURS_COST_NINE_DRAW_ONE_ABILITY_ID,
  S_BP7_005_ACTIVATED_DISCARD_TWO_DELEGATE_TWO_ON_ENTER_ABILITY_ID,
  S_BP7_005_ON_ENTER_STACK_WAITING_MEMBER_BELOW_STAGE_MEMBER_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
import { createCardInstance, createHeartIcon } from '../../src/domain/entities/card';
import {
  createGameState,
  registerCards,
  updatePlayer,
  type PendingAbilityState,
} from '../../src/domain/entities/game';
import {
  addCardToStatefulZone,
  placeCardInSlot,
  removeCardFromSlot,
} from '../../src/domain/entities/zone';
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

function member(code: string, id: string, cost = 15) {
  return createCardInstance(
    {
      cardCode: code,
      name: id,
      groupNames: ['Aqours'],
      cardType: CardType.MEMBER,
      cost,
      blade: 1,
      hearts: [createHeartIcon(HeartColor.BLUE, 1)],
    },
    P1,
    id
  );
}

function energy(id: string, ownerId = P1) {
  return createCardInstance({ cardCode: id, name: id, cardType: CardType.ENERGY }, ownerId, id);
}

function live(id: string, ownerId = P1) {
  return createCardInstance(
    {
      cardCode: id,
      name: id,
      groupNames: ['Aqours'],
      cardType: CardType.LIVE,
      score: 1,
      requiredHearts: [],
    },
    ownerId,
    id
  );
}

describe('PL!S-bp7-005-SEC 渡边曜', () => {
  it('ON_ENTER 可将休息室成员压到自身或其他顶层成员下方', () => {
    const you = member('PL!S-bp7-005-SEC', 'you');
    const host = member('HOST', 'host');
    const below = member('BELOW', 'below');
    let game = registerCards(createGameState('you-enter', P1, 'P1', P2, 'P2'), [you, host, below]);
    game = updatePlayer(game, P1, (player) => ({
      ...player,
      waitingRoom: addCardToStatefulZone(player.waitingRoom, below.instanceId),
      memberSlots: placeCardInSlot(
        placeCardInSlot(player.memberSlots, SlotPosition.CENTER, you.instanceId, {
          orientation: OrientationState.ACTIVE,
          face: FaceState.FACE_UP,
        }),
        SlotPosition.RIGHT,
        host.instanceId,
        { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }
      ),
    }));
    const pending: PendingAbilityState = {
      id: 'you-enter-pending',
      abilityId: S_BP7_005_ON_ENTER_STACK_WAITING_MEMBER_BELOW_STAGE_MEMBER_ABILITY_ID,
      sourceCardId: you.instanceId,
      controllerId: P1,
      mandatory: true,
      timingId: TriggerCondition.ON_ENTER_STAGE,
      eventIds: [],
      sourceSlot: SlotPosition.CENTER,
    };
    const selectingMember = resolvePendingCardEffects({ ...game, pendingAbilities: [pending] }).gameState;
    const selectingHost = confirmActiveEffectStep(
      selectingMember,
      P1,
      selectingMember.activeEffect!.id,
      below.instanceId
    );
    expect(selectingHost.activeEffect?.selectableCardIds).toEqual(
      expect.arrayContaining([you.instanceId, host.instanceId])
    );
    const done = confirmActiveEffectStep(
      selectingHost,
      P1,
      selectingHost.activeEffect!.id,
      host.instanceId
    );
    expect(done.players[0].memberSlots.memberBelow[SlotPosition.RIGHT]).toEqual([
      below.instanceId,
    ]);
  });

  it('已入队 ON_ENTER 在来源曜离场后仍只重验当前休息室成员与当前 host', () => {
    const you = member('PL!S-bp7-005-SEC', 'you-left');
    const host = member('HOST', 'remaining-host');
    const below = member('BELOW', 'queued-below');
    let game = registerCards(createGameState('you-enter-source-left', P1, 'P1', P2, 'P2'), [
      you,
      host,
      below,
    ]);
    game = updatePlayer(game, P1, (player) => ({
      ...player,
      waitingRoom: addCardToStatefulZone(player.waitingRoom, below.instanceId),
      memberSlots: placeCardInSlot(
        placeCardInSlot(player.memberSlots, SlotPosition.CENTER, you.instanceId),
        SlotPosition.RIGHT,
        host.instanceId
      ),
    }));
    const pending: PendingAbilityState = {
      id: 'you-left-enter-pending',
      abilityId: S_BP7_005_ON_ENTER_STACK_WAITING_MEMBER_BELOW_STAGE_MEMBER_ABILITY_ID,
      sourceCardId: you.instanceId,
      controllerId: P1,
      mandatory: true,
      timingId: TriggerCondition.ON_ENTER_STAGE,
      eventIds: [],
      sourceSlot: SlotPosition.CENTER,
    };
    game = updatePlayer({ ...game, pendingAbilities: [pending] }, P1, (player) => ({
      ...player,
      memberSlots: removeCardFromSlot(player.memberSlots, SlotPosition.CENTER),
    }));
    const selectingMember = resolvePendingCardEffects(game).gameState;
    expect(selectingMember.activeEffect?.selectableCardIds).toContain(below.instanceId);
    const selectingHost = confirmActiveEffectStep(
      selectingMember,
      P1,
      selectingMember.activeEffect!.id,
      below.instanceId
    );
    expect(selectingHost.activeEffect?.selectableCardIds).toEqual([host.instanceId]);
    const done = confirmActiveEffectStep(
      selectingHost,
      P1,
      selectingHost.activeEffect!.id,
      host.instanceId
    );
    expect(done.players[0].memberSlots.memberBelow[SlotPosition.RIGHT]).toEqual([
      below.instanceId,
    ]);
  });

  it('弃实际2手后允许选择两个 ON_ENTER 的顺序，子能力连续完成再回到全局', () => {
    const you = member('PL!S-bp7-005-SEC', 'you');
    const target = member('PL!S-bp7-002-P', 'target', 9);
    const discarded = [energy('discard-1'), energy('discard-2')];
    const drawn = member('DRAWN', 'drawn');
    let game = registerCards(createGameState('you-activated', P1, 'P1', P2, 'P2'), [
      you,
      target,
      ...discarded,
      drawn,
    ]);
    game = updatePlayer(game, P1, (player) => ({
      ...player,
      hand: discarded.reduce((zone, card) => addCardToStatefulZone(zone, card.instanceId), player.hand),
      mainDeck: { ...player.mainDeck, cardIds: [drawn.instanceId] },
      memberSlots: placeCardInSlot(
        placeCardInSlot(player.memberSlots, SlotPosition.CENTER, you.instanceId, {
          orientation: OrientationState.ACTIVE,
          face: FaceState.FACE_UP,
        }),
        SlotPosition.RIGHT,
        target.instanceId,
        { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }
      ),
    }));
    game = { ...game, currentPhase: GamePhase.MAIN_PHASE, activePlayerIndex: 0 };
    const started = activateCardAbility(
      game,
      P1,
      you.instanceId,
      S_BP7_005_ACTIVATED_DISCARD_TWO_DELEGATE_TWO_ON_ENTER_ABILITY_ID
    );
    const selectingTarget = confirmActiveEffectStep(
      started,
      P1,
      started.activeEffect!.id,
      undefined,
      undefined,
      undefined,
      undefined,
      discarded.map((card) => card.instanceId)
    );
    expect(selectingTarget.players[0].waitingRoom.cardIds).toEqual(
      expect.arrayContaining(discarded.map((card) => card.instanceId))
    );
    const selectingOrder = confirmActiveEffectStep(
      selectingTarget,
      P1,
      selectingTarget.activeEffect!.id,
      target.instanceId
    );
    expect(selectingOrder.activeEffect?.selectableOptions?.map((option) => option.id)).toEqual([
      'source-first',
      'target-first',
    ]);
    const done = confirmActiveEffectStep(
      selectingOrder,
      P1,
      selectingOrder.activeEffect!.id,
      undefined,
      undefined,
      undefined,
      'source-first'
    );
    expect(done.delegatedAbilitySequence).toBeNull();
    expect(done.players[0].hand.cardIds).toContain(drawn.instanceId);
    expect(
      done.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            S_BP7_005_ACTIVATED_DISCARD_TWO_DELEGATE_TWO_ON_ENTER_ABILITY_ID &&
          action.payload.step === 'ABILITY_USE'
      )
    ).toBe(true);
    const sequenceActions = done.actionHistory.filter((action) =>
      ['START_DELEGATED_ON_ENTER_SEQUENCE', 'DELEGATED_ABILITY_SEQUENCE_COMPLETE'].includes(
        String(action.payload.step)
      )
    );
    expect(sequenceActions.map((action) => action.payload.step)).toEqual([
      'START_DELEGATED_ON_ENTER_SEQUENCE',
      'DELEGATED_ABILITY_SEQUENCE_COMPLETE',
    ]);
    expect(sequenceActions[1]?.payload.resolvedPendingAbilityIds).toEqual(
      expect.arrayContaining([
        expect.stringContaining(`:${you.instanceId}:`),
        expect.stringContaining(`:${target.instanceId}:`),
      ])
    );
    expect(sequenceActions[1]?.payload.resolvedAbilityIds).toEqual(
      expect.arrayContaining([
        S_BP7_005_ON_ENTER_STACK_WAITING_MEMBER_BELOW_STAGE_MEMBER_ABILITY_ID,
        S_BP7_002_ON_ENTER_AQOURS_COST_NINE_DRAW_ONE_ABILITY_ID,
      ])
    );
    expect(done.actionHistory.some((action) => action.payload.abilityId === S_BP7_002_ON_ENTER_AQOURS_COST_NINE_DRAW_ONE_ABILITY_ID)).toBe(true);
  });

  it('手牌不足2时不能发动且不消耗 turn1', () => {
    const you = member('PL!S-bp7-005-SEC', 'you');
    const target = member('PL!S-bp7-002-P', 'target', 9);
    const one = energy('one');
    let game = registerCards(createGameState('you-short-hand', P1, 'P1', P2, 'P2'), [you, target, one]);
    game = updatePlayer(game, P1, (player) => ({
      ...player,
      hand: addCardToStatefulZone(player.hand, one.instanceId),
      memberSlots: placeCardInSlot(
        placeCardInSlot(player.memberSlots, SlotPosition.CENTER, you.instanceId),
        SlotPosition.RIGHT,
        target.instanceId
      ),
    }));
    game = { ...game, currentPhase: GamePhase.MAIN_PHASE, activePlayerIndex: 0 };
    const result = activateCardAbility(
      game,
      P1,
      you.instanceId,
      S_BP7_005_ACTIVATED_DISCARD_TWO_DELEGATE_TWO_ON_ENTER_ABILITY_ID
    );
    expect(result).toBe(game);
    expect(
      result.actionHistory.some(
        (action) =>
          action.payload.abilityId ===
          S_BP7_005_ACTIVATED_DISCARD_TWO_DELEGATE_TWO_ON_ENTER_ABILITY_ID
      )
    ).toBe(false);
  });

  it.each([
    [
      'PL!S-pb1-001-R',
      PL_S_PB1_001_ON_ENTER_OPPONENT_HAND_TWO_MORE_RECOVER_LIVE_ABILITY_ID,
      'waiting-live',
      2,
    ],
    [
      'PL!S-pb1-002-R',
      PL_S_PB1_002_ON_ENTER_OPPONENT_DISCARD_LIVE_OR_SOURCE_SCORE_ABILITY_ID,
      null,
      1,
    ],
    [
      'PL!S-bp5-004-R',
      PL_S_BP5_004_ON_ENTER_CHOOSE_AQOURS_BLADE_OR_SAINTSNOW_POSITION_CHANGE_ABILITY_ID,
      null,
      0,
    ],
  ] as const)(
    '通过曜的真实 runner 委托打开 %s 的历史 ON_ENTER workflow',
    (targetCardCode, expectedAbilityId, waitingLiveId, opponentHandCount) => {
      const you = member('PL!S-bp7-005-SEC', `you:${targetCardCode}`);
      const target = member(targetCardCode, `target:${targetCardCode}`);
      const discarded = [
        energy(`discard-1:${targetCardCode}`),
        energy(`discard-2:${targetCardCode}`),
      ];
      const waitingLive = waitingLiveId ? live(`${waitingLiveId}:${targetCardCode}`) : null;
      const opponentCards = Array.from({ length: opponentHandCount }, (_, index) =>
        index === 0 && targetCardCode === 'PL!S-pb1-002-R'
          ? live(`opponent-live:${targetCardCode}`, P2)
          : energy(`opponent-card-${index}:${targetCardCode}`, P2)
      );
      let game = registerCards(
        createGameState(`you-delegates:${targetCardCode}`, P1, 'P1', P2, 'P2'),
        [you, target, ...discarded, ...opponentCards, ...(waitingLive ? [waitingLive] : [])]
      );
      game = updatePlayer(game, P1, (player) => ({
        ...player,
        hand: discarded.reduce(
          (zone, card) => addCardToStatefulZone(zone, card.instanceId),
          player.hand
        ),
        waitingRoom: waitingLive
          ? addCardToStatefulZone(player.waitingRoom, waitingLive.instanceId)
          : player.waitingRoom,
        memberSlots: placeCardInSlot(
          placeCardInSlot(player.memberSlots, SlotPosition.CENTER, you.instanceId),
          SlotPosition.RIGHT,
          target.instanceId
        ),
      }));
      game = updatePlayer(game, P2, (player) => ({
        ...player,
        hand: opponentCards.reduce(
          (zone, card) => addCardToStatefulZone(zone, card.instanceId),
          player.hand
        ),
      }));
      game = { ...game, currentPhase: GamePhase.MAIN_PHASE, activePlayerIndex: 0 };

      const discardWindow = activateCardAbility(
        game,
        P1,
        you.instanceId,
        S_BP7_005_ACTIVATED_DISCARD_TWO_DELEGATE_TWO_ON_ENTER_ABILITY_ID
      );
      const targetWindow = confirmActiveEffectStep(
        discardWindow,
        P1,
        discardWindow.activeEffect!.id,
        undefined,
        undefined,
        undefined,
        undefined,
        discarded.map((card) => card.instanceId)
      );
      const orderWindow = confirmActiveEffectStep(
        targetWindow,
        P1,
        targetWindow.activeEffect!.id,
        target.instanceId
      );
      const delegated = confirmActiveEffectStep(
        orderWindow,
        P1,
        orderWindow.activeEffect!.id,
        undefined,
        undefined,
        undefined,
        'target-first'
      );

      expect(delegated.delegatedAbilitySequence).not.toBeNull();
      expect(delegated.activeEffect).toMatchObject({
        abilityId: expectedAbilityId,
        sourceCardId: target.instanceId,
      });
    }
  );
});
