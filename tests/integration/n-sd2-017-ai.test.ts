import { describe, expect, it } from 'vitest';
import type { EnergyCardData, MemberCardData } from '../../src/domain/entities/card';
import { createCardInstance, createHeartIcon } from '../../src/domain/entities/card';
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
import {
  confirmActiveEffectStep,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import { N_SD2_017_LIVE_START_PAY_ENERGY_ACTIVATE_STAGE_MEMBER_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
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

function member(cardCode: string, name = cardCode): MemberCardData {
  return {
    cardCode,
    name,
    groupNames: ['虹ヶ咲'],
    cardType: CardType.MEMBER,
    cost: 4,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
  };
}

function energy(cardCode: string): EnergyCardData {
  return {
    cardCode,
    name: cardCode,
    cardType: CardType.ENERGY,
  };
}

function setup(options: { readonly withWaitingTarget?: boolean } = {}): {
  readonly game: GameState;
  readonly sourceId: string;
  readonly waitingId: string;
  readonly activeId: string;
  readonly opponentId: string;
  readonly belowId: string;
  readonly energyId: string;
} {
  const source = createCardInstance(
    member('PL!N-sd2-017-SD2', '宫下爱'),
    PLAYER1,
    'n-sd2-017-source'
  );
  const waiting = createCardInstance(member('WAITING-TARGET'), PLAYER1, 'waiting-target');
  const active = createCardInstance(member('ACTIVE-TARGET'), PLAYER1, 'active-target');
  const opponent = createCardInstance(member('OPPONENT-TARGET'), PLAYER2, 'opponent-target');
  const below = createCardInstance(member('BELOW-TARGET'), PLAYER1, 'below-target');
  const energyCard = createCardInstance(energy('N-SD2-017-ENERGY'), PLAYER1, 'n-sd2-017-energy');
  let game = registerCards(createGameState('n-sd2-017', PLAYER1, 'P1', PLAYER2, 'P2'), [
    source,
    waiting,
    active,
    opponent,
    below,
    energyCard,
  ]);
  game = updatePlayer(game, PLAYER1, (player) => {
    let memberSlots = placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    });
    memberSlots = placeCardInSlot(memberSlots, SlotPosition.RIGHT, active.instanceId, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    });
    if (options.withWaitingTarget !== false) {
      memberSlots = placeCardInSlot(memberSlots, SlotPosition.LEFT, waiting.instanceId, {
        orientation: OrientationState.WAITING,
        face: FaceState.FACE_UP,
      });
      memberSlots = addMemberBelowMember(memberSlots, SlotPosition.CENTER, below.instanceId);
    }
    return {
      ...player,
      memberSlots,
      energyZone: addCardToStatefulZone(player.energyZone, energyCard.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      }),
    };
  });
  game = updatePlayer(game, PLAYER2, (player) => ({
    ...player,
    memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, opponent.instanceId, {
      orientation: OrientationState.WAITING,
      face: FaceState.FACE_UP,
    }),
  }));
  game = {
    ...game,
    pendingAbilities: [
      {
        id: 'n-sd2-017-pending',
        abilityId: N_SD2_017_LIVE_START_PAY_ENERGY_ACTIVATE_STAGE_MEMBER_ABILITY_ID,
        sourceCardId: source.instanceId,
        controllerId: PLAYER1,
        mandatory: false,
        timingId: TriggerCondition.ON_LIVE_START,
        eventIds: ['live-start-event'],
        sourceSlot: SlotPosition.CENTER,
      },
    ],
  };
  return {
    game,
    sourceId: source.instanceId,
    waitingId: waiting.instanceId,
    activeId: active.instanceId,
    opponentId: opponent.instanceId,
    belowId: below.instanceId,
    energyId: energyCard.instanceId,
  };
}

function start(game: GameState): GameState {
  return resolvePendingCardEffects(game).gameState;
}

function pay(game: GameState): GameState {
  return confirmActiveEffectStep(
    game,
    PLAYER1,
    game.activeEffect!.id,
    undefined,
    undefined,
    undefined,
    'pay'
  );
}

describe('PL!N-sd2-017-SD2 费用4「宫下爱」', () => {
  it('支付[E]后强制选择己方主舞台待机成员，并派发一次状态变化事件', () => {
    const scenario = setup();
    let state = start(scenario.game);
    expect(state.activeEffect).toMatchObject({
      abilityId: N_SD2_017_LIVE_START_PAY_ENERGY_ACTIVATE_STAGE_MEMBER_ABILITY_ID,
      effectText: '【LIVE开始时】可以支付[E]：将存在于自己的舞台的1名成员变为活跃状态。',
      stepId: 'N_SD2_017_LIVE_START_PAY_ENERGY',
      selectableOptions: [{ id: 'pay', label: '支付[E]' }],
      canSkipSelection: true,
      skipSelectionLabel: '不发动',
    });

    state = pay(state);
    expect(state.players[0].energyZone.cardStates.get(scenario.energyId)?.orientation).toBe(
      OrientationState.WAITING
    );
    expect(state.activeEffect).toMatchObject({
      stepId: 'N_SD2_017_LIVE_START_SELECT_MEMBER_TO_ACTIVE',
      stepText: '请选择自己舞台上的1名待机状态成员变为活跃状态。',
      selectableCardIds: [scenario.waitingId],
      selectionLabel: '选择要变为活跃状态的成员',
      confirmSelectionLabel: '变为活跃状态',
      canSkipSelection: false,
    });
    expect(state.activeEffect?.selectableCardIds).not.toContain(scenario.activeId);
    expect(state.activeEffect?.selectableCardIds).not.toContain(scenario.opponentId);
    expect(state.activeEffect?.selectableCardIds).not.toContain(scenario.belowId);

    state = confirmActiveEffectStep(state, PLAYER1, state.activeEffect!.id, scenario.waitingId);
    expect(state.players[0].memberSlots.cardStates.get(scenario.waitingId)?.orientation).toBe(
      OrientationState.ACTIVE
    );
    expect(
      state.eventLog.filter(
        (entry) =>
          entry.event.eventType === TriggerCondition.ON_MEMBER_STATE_CHANGED &&
          entry.event.cardInstanceId === scenario.waitingId
      )
    ).toHaveLength(1);
    expect(state.activeEffect).toBeNull();
    expect(state.pendingAbilities).toEqual([]);
  });

  it('后续目标不存在不阻止合法支付，且不产生伪状态事件', () => {
    const scenario = setup({ withWaitingTarget: false });
    const state = pay(start(scenario.game));
    expect(state.players[0].energyZone.cardStates.get(scenario.energyId)?.orientation).toBe(
      OrientationState.WAITING
    );
    expect(state.activeEffect).toBeNull();
    expect(state.pendingAbilities).toEqual([]);
    expect(
      state.eventLog.some(
        (entry) => entry.event.eventType === TriggerCondition.ON_MEMBER_STATE_CHANGED
      )
    ).toBe(false);
    expect(
      state.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.step === 'PAY_ENERGY_NO_WAITING_MEMBER_TARGET'
      )
    ).toBe(true);
  });

  it('支付后的唯一目标失效时保留费用并安全结束', () => {
    const scenario = setup();
    let state = pay(start(scenario.game));
    state = updatePlayer(state, PLAYER1, (player) => ({
      ...player,
      memberSlots: removeCardFromSlot(player.memberSlots, SlotPosition.LEFT),
    }));
    state = confirmActiveEffectStep(state, PLAYER1, state.activeEffect!.id, scenario.waitingId);
    expect(state.players[0].energyZone.cardStates.get(scenario.energyId)?.orientation).toBe(
      OrientationState.WAITING
    );
    expect(state.activeEffect).toBeNull();
    expect(state.pendingAbilities).toEqual([]);
  });

  it('能力入队后来源离场仍可支付并结算后续目标', () => {
    const scenario = setup();
    let state = start(scenario.game);
    state = updatePlayer(state, PLAYER1, (player) => ({
      ...player,
      memberSlots: removeCardFromSlot(player.memberSlots, SlotPosition.CENTER),
    }));
    state = pay(state);
    expect(state.players[0].energyZone.cardStates.get(scenario.energyId)?.orientation).toBe(
      OrientationState.WAITING
    );
    expect(state.activeEffect?.selectableCardIds).toEqual([scenario.waitingId]);

    state = confirmActiveEffectStep(state, PLAYER1, state.activeEffect!.id, scenario.waitingId);
    expect(state.players[0].memberSlots.cardStates.get(scenario.waitingId)?.orientation).toBe(
      OrientationState.ACTIVE
    );
    expect(state.pendingAbilities).toEqual([]);
  });

  it('不发动时不支付能量也不改变成员状态', () => {
    const scenario = setup();
    let state = start(scenario.game);
    state = confirmActiveEffectStep(state, PLAYER1, state.activeEffect!.id);
    expect(state.players[0].energyZone.cardStates.get(scenario.energyId)?.orientation).toBe(
      OrientationState.ACTIVE
    );
    expect(state.players[0].memberSlots.cardStates.get(scenario.waitingId)?.orientation).toBe(
      OrientationState.WAITING
    );
    expect(state.activeEffect).toBeNull();
  });
});
