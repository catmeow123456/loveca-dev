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
import {
  confirmActiveEffectStep,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import {
  SP_PB2_024_ON_ENTER_WAIT_OPPONENT_COST_TWO_MEMBER_ABILITY_ID,
  SP_PB2_029_LIVE_START_WAIT_OPPONENT_COST_TWO_MEMBER_ABILITY_ID,
  SP_PB2_029_ON_ENTER_WAIT_OPPONENT_COST_TWO_MEMBER_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
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

function createMember(cardCode: string, cost: number, name = cardCode): MemberCardData {
  return {
    cardCode,
    name,
    groupNames: ['Liella!'],
    unitName: 'Liella!',
    cardType: CardType.MEMBER,
    cost,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.RED, 1)],
  };
}

function setupState(options: {
  readonly sourceCardCode: string;
  readonly sourceId?: string;
  readonly lowCostOrientation?: OrientationState;
  readonly highCostOrientation?: OrientationState;
}): {
  readonly game: GameState;
  readonly sourceId: string;
  readonly lowCostTargetId: string;
  readonly highCostTargetId: string;
} {
  const source = createCardInstance(
    createMember(options.sourceCardCode, 4, 'Source'),
    PLAYER1,
    options.sourceId ?? 'source'
  );
  const lowCostTarget = createCardInstance(
    createMember('PL!SP-opponent-low-cost', 2, 'Low Cost'),
    PLAYER2,
    'opponent-low-cost'
  );
  const highCostTarget = createCardInstance(
    createMember('PL!SP-opponent-high-cost', 3, 'High Cost'),
    PLAYER2,
    'opponent-high-cost'
  );

  let game = createGameState('sp-pb2-low-cost-opponent-wait', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [source, lowCostTarget, highCostTarget]);
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    memberSlots: {
      ...player.memberSlots,
      slots: {
        ...player.memberSlots.slots,
        [SlotPosition.CENTER]: source.instanceId,
      },
      cardStates: new Map([
        [source.instanceId, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
      ]),
    },
  }));
  game = updatePlayer(game, PLAYER2, (player) => ({
    ...player,
    memberSlots: {
      ...player.memberSlots,
      slots: {
        [SlotPosition.LEFT]: lowCostTarget.instanceId,
        [SlotPosition.CENTER]: highCostTarget.instanceId,
        [SlotPosition.RIGHT]: null,
      },
      cardStates: new Map([
        [
          lowCostTarget.instanceId,
          {
            orientation: options.lowCostOrientation ?? OrientationState.ACTIVE,
            face: FaceState.FACE_UP,
          },
        ],
        [
          highCostTarget.instanceId,
          {
            orientation: options.highCostOrientation ?? OrientationState.ACTIVE,
            face: FaceState.FACE_UP,
          },
        ],
      ]),
    },
  }));

  return {
    game,
    sourceId: source.instanceId,
    lowCostTargetId: lowCostTarget.instanceId,
    highCostTargetId: highCostTarget.instanceId,
  };
}

function pendingAbility(
  abilityId: string,
  sourceCardId: string,
  timingId: TriggerCondition
): PendingAbilityState {
  return {
    id: `${abilityId}:pending`,
    abilityId,
    sourceCardId,
    controllerId: PLAYER1,
    mandatory: true,
    timingId,
    eventIds: [`${timingId}:event`],
  };
}

function startAbility(
  game: GameState,
  abilityId: string,
  sourceCardId: string,
  timingId: TriggerCondition
): GameState {
  return resolvePendingCardEffects({
    ...game,
    pendingAbilities: [pendingAbility(abilityId, sourceCardId, timingId)],
  }).gameState;
}

function selectTarget(game: GameState, targetCardId: string): GameState {
  return confirmActiveEffectStep(game, PLAYER1, game.activeEffect!.id, targetCardId);
}

describe('PL!SP-pb2 low-cost opponent wait workflows', () => {
  it('waits an opponent cost 2 member for PL!SP-pb2-024 on enter', () => {
    const scenario = setupState({ sourceCardCode: 'PL!SP-pb2-024-N' });
    const started = startAbility(
      scenario.game,
      SP_PB2_024_ON_ENTER_WAIT_OPPONENT_COST_TWO_MEMBER_ABILITY_ID,
      scenario.sourceId,
      TriggerCondition.ON_ENTER_STAGE
    );

    expect(started.activeEffect?.selectableCardIds).toEqual([scenario.lowCostTargetId]);
    const state = selectTarget(started, scenario.lowCostTargetId);

    expect(state.players[1].memberSlots.cardStates.get(scenario.lowCostTargetId)?.orientation).toBe(
      OrientationState.WAITING
    );
    expect(latestPayload(state, SP_PB2_024_ON_ENTER_WAIT_OPPONENT_COST_TWO_MEMBER_ABILITY_ID)).toMatchObject({
      step: 'WAIT_OPPONENT_MEMBER',
      targetPlayerId: PLAYER2,
      targetCardId: scenario.lowCostTargetId,
      nextOrientation: OrientationState.WAITING,
    });
    expect(
      state.eventLog.some(
        (entry) =>
          entry.event.eventType === TriggerCondition.ON_MEMBER_STATE_CHANGED &&
          entry.event.cardInstanceId === scenario.lowCostTargetId &&
          entry.event.cause?.kind === 'CARD_EFFECT' &&
          entry.event.cause.abilityId ===
            SP_PB2_024_ON_ENTER_WAIT_OPPONENT_COST_TWO_MEMBER_ABILITY_ID
      )
    ).toBe(true);
  });

  it('waits an opponent cost 2 member for PL!SP-pb2-029 on enter', () => {
    const scenario = setupState({ sourceCardCode: 'PL!SP-pb2-029-N' });
    const started = startAbility(
      scenario.game,
      SP_PB2_029_ON_ENTER_WAIT_OPPONENT_COST_TWO_MEMBER_ABILITY_ID,
      scenario.sourceId,
      TriggerCondition.ON_ENTER_STAGE
    );

    expect(started.activeEffect?.selectableCardIds).toEqual([scenario.lowCostTargetId]);
    const state = selectTarget(started, scenario.lowCostTargetId);
    expect(state.players[1].memberSlots.cardStates.get(scenario.lowCostTargetId)?.orientation).toBe(
      OrientationState.WAITING
    );
  });

  it('waits an opponent cost 2 member for PL!SP-pb2-029 live start', () => {
    const scenario = setupState({ sourceCardCode: 'PL!SP-pb2-029-N' });
    const started = startAbility(
      scenario.game,
      SP_PB2_029_LIVE_START_WAIT_OPPONENT_COST_TWO_MEMBER_ABILITY_ID,
      scenario.sourceId,
      TriggerCondition.ON_LIVE_START
    );

    expect(started.activeEffect?.selectableCardIds).toEqual([scenario.lowCostTargetId]);
    const state = selectTarget(started, scenario.lowCostTargetId);
    expect(state.players[1].memberSlots.cardStates.get(scenario.lowCostTargetId)?.orientation).toBe(
      OrientationState.WAITING
    );
  });

  it('does not open a selection when there is no legal cost 2 active target', () => {
    const scenario = setupState({
      sourceCardCode: 'PL!SP-pb2-024-N',
      lowCostOrientation: OrientationState.WAITING,
    });
    const state = startAbility(
      scenario.game,
      SP_PB2_024_ON_ENTER_WAIT_OPPONENT_COST_TWO_MEMBER_ABILITY_ID,
      scenario.sourceId,
      TriggerCondition.ON_ENTER_STAGE
    );

    expect(state.activeEffect).toBeNull();
    expect(latestPayload(state, SP_PB2_024_ON_ENTER_WAIT_OPPONENT_COST_TWO_MEMBER_ABILITY_ID)).toMatchObject({
      step: 'SKIP_NO_TARGET',
      targetPlayerId: PLAYER2,
    });
  });

  it('does not allow already WAITING or cost greater than 2 targets', () => {
    const scenario = setupState({
      sourceCardCode: 'PL!SP-pb2-029-N',
      lowCostOrientation: OrientationState.WAITING,
    });
    const state = startAbility(
      scenario.game,
      SP_PB2_029_LIVE_START_WAIT_OPPONENT_COST_TWO_MEMBER_ABILITY_ID,
      scenario.sourceId,
      TriggerCondition.ON_LIVE_START
    );

    expect(state.activeEffect).toBeNull();
    expect(state.players[1].memberSlots.cardStates.get(scenario.highCostTargetId)?.orientation).toBe(
      OrientationState.ACTIVE
    );
  });
});

function latestPayload(game: GameState, abilityId: string): Record<string, unknown> | undefined {
  return [...game.actionHistory]
    .reverse()
    .find((action) => action.type === 'RESOLVE_ABILITY' && action.payload.abilityId === abilityId)
    ?.payload;
}
