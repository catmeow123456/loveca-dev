import { describe, expect, it } from 'vitest';
import type { MemberCardData } from '../../src/domain/entities/card';
import { createCardInstance, createHeartIcon } from '../../src/domain/entities/card';
import {
  createGameState,
  registerCards,
  updatePlayer,
  type GameState,
  type PendingAbilityState,
} from '../../src/domain/entities/game';
import { placeCardInSlot } from '../../src/domain/entities/zone';
import {
  confirmActiveEffectStep,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import { N_BP7_012_LIVE_START_WAIT_NIJIGASAKI_MEMBER_CHOOSE_HEART_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
import {
  CardType,
  FaceState,
  HeartColor,
  OrientationState,
  SlotPosition,
  TriggerCondition,
} from '../../src/shared/types/enums';

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';
const EFFECT_TEXT =
  '【LIVE开始时】可以将1名『虹咲』的成员变为待机状态：指定1个任意HEART的颜色。LIVE结束时为止，获得1个指定颜色的HEART。';

function member(
  cardCode: string,
  name: string,
  groupNames: readonly string[] = ['虹ヶ咲']
): MemberCardData {
  return {
    cardCode,
    name,
    groupNames,
    cardType: CardType.MEMBER,
    cost: 5,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.BLUE, 1)],
  };
}

function pending(sourceCardId: string): PendingAbilityState {
  return {
    id: 'n-bp7-012-pending',
    abilityId: N_BP7_012_LIVE_START_WAIT_NIJIGASAKI_MEMBER_CHOOSE_HEART_ABILITY_ID,
    sourceCardId,
    controllerId: PLAYER1,
    mandatory: false,
    timingId: TriggerCondition.ON_LIVE_START,
    eventIds: ['live-start-event'],
    sourceSlot: SlotPosition.CENTER,
  };
}

function setup(options: { readonly allNijigasakiWaiting?: boolean } = {}) {
  const source = createCardInstance(
    member('PL!N-bp7-012-R', '鐘 嵐珠'),
    PLAYER1,
    'n-bp7-012-source'
  );
  const target = createCardInstance(
    member('PL!N-test-target', '上原歩夢'),
    PLAYER1,
    'n-bp7-012-target'
  );
  const other = createCardInstance(
    member('PL!S-test-other', '高海千歌', ['Aqours']),
    PLAYER1,
    'n-bp7-012-other'
  );
  let game = registerCards(createGameState('n-bp7-012-lanzhu', PLAYER1, 'P1', PLAYER2, 'P2'), [
    source,
    target,
    other,
  ]);
  game = updatePlayer(game, PLAYER1, (player) => {
    let memberSlots = placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId, {
      orientation: options.allNijigasakiWaiting
        ? OrientationState.WAITING
        : OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    });
    memberSlots = placeCardInSlot(memberSlots, SlotPosition.LEFT, target.instanceId, {
      orientation: options.allNijigasakiWaiting
        ? OrientationState.WAITING
        : OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    });
    memberSlots = placeCardInSlot(memberSlots, SlotPosition.RIGHT, other.instanceId, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    });
    return { ...player, memberSlots };
  });
  return {
    game: { ...game, pendingAbilities: [pending(source.instanceId)] },
    source,
    target,
    other,
  };
}

function selectHeart(game: GameState, color: HeartColor): GameState {
  const publicConfirmation = confirmActiveEffectStep(
    game,
    PLAYER1,
    game.activeEffect!.id,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    [color]
  );
  return confirmActiveEffectStep(publicConfirmation, PLAYER1, publicConfirmation.activeEffect!.id);
}

function latestPayload(game: GameState) {
  return game.actionHistory
    .filter(
      (action) =>
        action.type === 'RESOLVE_ABILITY' &&
        action.payload.abilityId ===
          N_BP7_012_LIVE_START_WAIT_NIJIGASAKI_MEMBER_CHOOSE_HEART_ABILITY_ID
    )
    .at(-1)?.payload;
}

describe('PL!N-bp7-012 Lanzhu LIVE_START wait-cost choose-Heart workflow', () => {
  it('pays by waiting one active Nijigasaki member, emits the event, then forces one standard Heart choice', () => {
    const scenario = setup();
    const costWindow = resolvePendingCardEffects(scenario.game).gameState;

    expect(costWindow.activeEffect).toMatchObject({
      abilityId: N_BP7_012_LIVE_START_WAIT_NIJIGASAKI_MEMBER_CHOOSE_HEART_ABILITY_ID,
      effectText: EFFECT_TEXT,
      selectableCardIds: [scenario.target.instanceId, scenario.source.instanceId],
      canSkipSelection: true,
      skipSelectionLabel: '不发动',
    });
    expect(costWindow.activeEffect?.selectableCardIds).not.toContain(scenario.other.instanceId);

    const heartWindow = confirmActiveEffectStep(
      costWindow,
      PLAYER1,
      costWindow.activeEffect!.id,
      scenario.target.instanceId
    );
    expect(
      heartWindow.players[0].memberSlots.cardStates.get(scenario.target.instanceId)?.orientation
    ).toBe(OrientationState.WAITING);
    expect(heartWindow.activeEffect).toMatchObject({
      effectText: EFFECT_TEXT,
      canSkipSelection: false,
      effectChoice: {
        mode: 'SINGLE',
        minSelections: 1,
        maxSelections: 1,
        publicConfirmation: true,
        options: [
          { id: HeartColor.PINK, text: '获得[桃ハート]。' },
          { id: HeartColor.RED, text: '获得[赤ハート]。' },
          { id: HeartColor.YELLOW, text: '获得[黄ハート]。' },
          { id: HeartColor.GREEN, text: '获得[緑ハート]。' },
          { id: HeartColor.BLUE, text: '获得[青ハート]。' },
          { id: HeartColor.PURPLE, text: '获得[紫ハート]。' },
        ],
      },
    });

    const stateChangedEvent = heartWindow.eventLog.find(
      (entry) =>
        entry.event.eventType === TriggerCondition.ON_MEMBER_STATE_CHANGED &&
        entry.event.cardInstanceId === scenario.target.instanceId
    )?.event;
    expect(stateChangedEvent).toMatchObject({
      previousOrientation: OrientationState.ACTIVE,
      nextOrientation: OrientationState.WAITING,
      cause: {
        kind: 'CARD_EFFECT',
        sourceCardId: scenario.source.instanceId,
        abilityId: N_BP7_012_LIVE_START_WAIT_NIJIGASAKI_MEMBER_CHOOSE_HEART_ABILITY_ID,
      },
    });
    expect(
      heartWindow.actionHistory.find((action) => action.type === 'PAY_COST')?.payload
    ).toMatchObject({
      paidCostCardId: scenario.target.instanceId,
      memberStateChangedEventIds: [stateChangedEvent?.eventId],
    });

    const resolved = selectHeart(heartWindow, HeartColor.GREEN);
    expect(resolved.activeEffect).toBeNull();
    expect(resolved.pendingAbilities).toEqual([]);
    expect(resolved.liveResolution.liveModifiers).toContainEqual({
      kind: 'HEART',
      target: 'SOURCE_MEMBER',
      playerId: PLAYER1,
      sourceCardId: scenario.source.instanceId,
      abilityId: N_BP7_012_LIVE_START_WAIT_NIJIGASAKI_MEMBER_CHOOSE_HEART_ABILITY_ID,
      hearts: [{ color: HeartColor.GREEN, count: 1 }],
    });
    expect(latestPayload(resolved)).toMatchObject({
      step: 'PAY_WAIT_COST_GAIN_SELECTED_HEART',
      paidCostCardId: scenario.target.instanceId,
      heartColor: HeartColor.GREEN,
      heartApplied: true,
    });
  });

  it('declines without changing member state or opening the mandatory Heart step', () => {
    const scenario = setup();
    const costWindow = resolvePendingCardEffects(scenario.game).gameState;
    const resolved = confirmActiveEffectStep(
      costWindow,
      PLAYER1,
      costWindow.activeEffect!.id,
      null
    );

    expect(
      resolved.players[0].memberSlots.cardStates.get(scenario.target.instanceId)?.orientation
    ).toBe(OrientationState.ACTIVE);
    expect(resolved.eventLog).toHaveLength(0);
    expect(resolved.actionHistory.some((action) => action.type === 'PAY_COST')).toBe(false);
    expect(latestPayload(resolved)).toMatchObject({
      step: 'DECLINE_WAIT_COST',
      paidCostCardId: null,
      heartApplied: false,
    });
  });

  it('keeps the paid WAITING cost and continues when the source leaves before Heart selection', () => {
    const scenario = setup();
    const costWindow = resolvePendingCardEffects(scenario.game).gameState;
    let heartWindow = confirmActiveEffectStep(
      costWindow,
      PLAYER1,
      costWindow.activeEffect!.id,
      scenario.target.instanceId
    );
    heartWindow = updatePlayer(heartWindow, PLAYER1, (player) => {
      const cardStates = new Map(player.memberSlots.cardStates);
      cardStates.delete(scenario.source.instanceId);
      return {
        ...player,
        waitingRoom: {
          ...player.waitingRoom,
          cardIds: [...player.waitingRoom.cardIds, scenario.source.instanceId],
        },
        memberSlots: {
          ...player.memberSlots,
          slots: { ...player.memberSlots.slots, [SlotPosition.CENTER]: null },
          cardStates,
        },
      };
    });

    const resolved = selectHeart(heartWindow, HeartColor.PURPLE);
    expect(
      resolved.players[0].memberSlots.cardStates.get(scenario.target.instanceId)?.orientation
    ).toBe(OrientationState.WAITING);
    expect(resolved.actionHistory.some((action) => action.type === 'PAY_COST')).toBe(true);
    expect(resolved.liveResolution.liveModifiers).toEqual([]);
    expect(resolved.activeEffect).toBeNull();
    expect(latestPayload(resolved)).toMatchObject({
      step: 'PAY_WAIT_COST_SOURCE_NO_LONGER_VALID_AFTER_HEART_SELECTION',
      heartColor: HeartColor.PURPLE,
      heartApplied: false,
    });
  });

  it('consumes the pending ability without a window when no active Nijigasaki member can pay', () => {
    const scenario = setup({ allNijigasakiWaiting: true });
    const resolved = resolvePendingCardEffects(scenario.game).gameState;

    expect(resolved.activeEffect).toBeNull();
    expect(resolved.pendingAbilities).toEqual([]);
    expect(latestPayload(resolved)).toMatchObject({
      step: 'NO_ACTIVE_NIJIGASAKI_MEMBER_FOR_COST',
      paidCostCardId: null,
      heartApplied: false,
    });
  });
});
