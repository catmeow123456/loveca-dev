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
import { addLiveModifier } from '../../src/domain/rules/live-modifiers';
import { placeCardInSlot } from '../../src/domain/entities/zone';
import {
  confirmActiveEffectStep,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import {
  SP_PB2_009_LIVE_START_WAIT_LIELLA_MEMBER_WAIT_OPPONENT_LOWER_PRINTED_BLADE_ABILITY_ID,
  SP_PB2_009_ON_ENTER_WAIT_LIELLA_MEMBER_WAIT_OPPONENT_LOWER_PRINTED_BLADE_ABILITY_ID,
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

function createMember(
  cardCode: string,
  options: {
    readonly name?: string;
    readonly groupNames?: readonly string[];
    readonly unitName?: string;
    readonly blade?: number;
  } = {}
): MemberCardData {
  return {
    cardCode,
    name: options.name ?? cardCode,
    groupNames: options.groupNames ?? ['Liella!'],
    unitName: options.unitName ?? 'Liella!',
    cardType: CardType.MEMBER,
    cost: 4,
    blade: options.blade ?? 1,
    hearts: [createHeartIcon(HeartColor.RED, 1)],
  };
}

function setupState(options: {
  readonly ownPayBlade?: number;
  readonly ownPayGroupName?: string;
  readonly ownPayOrientation?: OrientationState;
  readonly lowOpponentBlade?: number;
  readonly lowOpponentOrientation?: OrientationState;
  readonly sourceBlade?: number;
} = {}): {
  readonly game: GameState;
  readonly sourceId: string;
  readonly ownPayId: string;
  readonly lowOpponentId: string;
  readonly highOpponentId: string;
} {
  const source = createCardInstance(
    createMember('PL!SP-pb2-009-R', { name: '鬼塚夏美', blade: options.sourceBlade ?? 1 }),
    PLAYER1,
    'sp-pb2-009-source'
  );
  const ownPay = createCardInstance(
    createMember('PL!SP-test-own-liella', {
      name: 'Liella pay member',
      groupNames: [options.ownPayGroupName ?? 'Liella!'],
      unitName: options.ownPayGroupName ?? 'Liella!',
      blade: options.ownPayBlade ?? 4,
    }),
    PLAYER1,
    'sp-pb2-009-own-pay'
  );
  const lowOpponent = createCardInstance(
    createMember('PL!SP-test-opponent-low', {
      name: 'Opponent low blade',
      blade: options.lowOpponentBlade ?? 2,
    }),
    PLAYER2,
    'sp-pb2-009-opponent-low'
  );
  const highOpponent = createCardInstance(
    createMember('PL!SP-test-opponent-high', { name: 'Opponent high blade', blade: 3 }),
    PLAYER2,
    'sp-pb2-009-opponent-high'
  );

  let game = createGameState('sp-pb2-009-natsumi', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [source, ownPay, lowOpponent, highOpponent]);
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    memberSlots: {
      ...placeCardInSlot(
        placeCardInSlot(player.memberSlots, SlotPosition.LEFT, ownPay.instanceId, {
          orientation: options.ownPayOrientation ?? OrientationState.ACTIVE,
          face: FaceState.FACE_UP,
        }),
        SlotPosition.CENTER,
        source.instanceId,
        {
          orientation: OrientationState.ACTIVE,
          face: FaceState.FACE_UP,
        }
      ),
    },
  }));
  game = updatePlayer(game, PLAYER2, (player) => ({
    ...player,
    memberSlots: placeCardInSlot(
      placeCardInSlot(player.memberSlots, SlotPosition.LEFT, lowOpponent.instanceId, {
        orientation: options.lowOpponentOrientation ?? OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      }),
      SlotPosition.RIGHT,
      highOpponent.instanceId,
      {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      }
    ),
  }));

  return {
    game,
    sourceId: source.instanceId,
    ownPayId: ownPay.instanceId,
    lowOpponentId: lowOpponent.instanceId,
    highOpponentId: highOpponent.instanceId,
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
    sourceSlot: SlotPosition.CENTER,
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

function resolveTwoStepWait(
  game: GameState,
  ownPayId: string,
  opponentTargetId: string
): GameState {
  let state = confirmActiveEffectStep(game, PLAYER1, game.activeEffect!.id, ownPayId);
  expect(state.activeEffect?.selectableCardIds).toEqual([opponentTargetId]);
  state = confirmActiveEffectStep(state, PLAYER1, state.activeEffect!.id, opponentTargetId);
  return state;
}

describe('PL!SP-pb2-009 Natsumi wait Liella member then opponent lower printed BLADE', () => {
  it('on enter waits an own Liella member, then waits an opponent member by printed BLADE threshold', () => {
    const scenario = setupState();
    const started = startAbility(
      scenario.game,
      SP_PB2_009_ON_ENTER_WAIT_LIELLA_MEMBER_WAIT_OPPONENT_LOWER_PRINTED_BLADE_ABILITY_ID,
      scenario.sourceId,
      TriggerCondition.ON_ENTER_STAGE
    );

    expect(started.activeEffect?.selectableCardIds).toEqual([scenario.ownPayId]);
    const state = resolveTwoStepWait(started, scenario.ownPayId, scenario.lowOpponentId);

    expect(state.players[0].memberSlots.cardStates.get(scenario.ownPayId)?.orientation).toBe(
      OrientationState.WAITING
    );
    expect(state.players[1].memberSlots.cardStates.get(scenario.lowOpponentId)?.orientation).toBe(
      OrientationState.WAITING
    );
    expect(state.players[1].memberSlots.cardStates.get(scenario.highOpponentId)?.orientation).toBe(
      OrientationState.ACTIVE
    );
    expect(
      state.eventLog.some(
        (entry) =>
          entry.event.eventType === TriggerCondition.ON_MEMBER_STATE_CHANGED &&
          entry.event.cardInstanceId === scenario.lowOpponentId &&
          entry.event.cause?.kind === 'CARD_EFFECT' &&
          entry.event.cause.abilityId ===
            SP_PB2_009_ON_ENTER_WAIT_LIELLA_MEMBER_WAIT_OPPONENT_LOWER_PRINTED_BLADE_ABILITY_ID
      )
    ).toBe(true);
  });

  it('live start resolves the same wait path', () => {
    const scenario = setupState();
    const started = startAbility(
      scenario.game,
      SP_PB2_009_LIVE_START_WAIT_LIELLA_MEMBER_WAIT_OPPONENT_LOWER_PRINTED_BLADE_ABILITY_ID,
      scenario.sourceId,
      TriggerCondition.ON_LIVE_START
    );

    const state = resolveTwoStepWait(started, scenario.ownPayId, scenario.lowOpponentId);

    expect(state.players[0].memberSlots.cardStates.get(scenario.ownPayId)?.orientation).toBe(
      OrientationState.WAITING
    );
    expect(state.players[1].memberSlots.cardStates.get(scenario.lowOpponentId)?.orientation).toBe(
      OrientationState.WAITING
    );
  });

  it('skip leaves both stages unchanged', () => {
    const scenario = setupState();
    const started = startAbility(
      scenario.game,
      SP_PB2_009_ON_ENTER_WAIT_LIELLA_MEMBER_WAIT_OPPONENT_LOWER_PRINTED_BLADE_ABILITY_ID,
      scenario.sourceId,
      TriggerCondition.ON_ENTER_STAGE
    );
    const state = confirmActiveEffectStep(started, PLAYER1, started.activeEffect!.id);

    expect(state.activeEffect).toBeNull();
    expect(state.players[0].memberSlots.cardStates.get(scenario.ownPayId)?.orientation).toBe(
      OrientationState.ACTIVE
    );
    expect(state.players[1].memberSlots.cardStates.get(scenario.lowOpponentId)?.orientation).toBe(
      OrientationState.ACTIVE
    );
  });

  it('does not open a window without an own non-WAITING Liella member or opponent match', () => {
    const noLiella = setupState({ ownPayOrientation: OrientationState.WAITING });
    const noLiellaStarted = startAbility(
      noLiella.game,
      SP_PB2_009_ON_ENTER_WAIT_LIELLA_MEMBER_WAIT_OPPONENT_LOWER_PRINTED_BLADE_ABILITY_ID,
      noLiella.sourceId,
      TriggerCondition.ON_ENTER_STAGE
    );
    expect(noLiellaStarted.activeEffect).toBeNull();

    const noOpponentMatch = setupState({ ownPayBlade: 3, lowOpponentBlade: 2 });
    const noOpponentStarted = startAbility(
      noOpponentMatch.game,
      SP_PB2_009_ON_ENTER_WAIT_LIELLA_MEMBER_WAIT_OPPONENT_LOWER_PRINTED_BLADE_ABILITY_ID,
      noOpponentMatch.sourceId,
      TriggerCondition.ON_ENTER_STAGE
    );
    expect(noOpponentStarted.activeEffect).toBeNull();
  });

  it('uses printed BLADE and ignores BLADE modifiers when checking opponent threshold', () => {
    const scenario = setupState({ ownPayBlade: 2, lowOpponentBlade: 1 });
    const modified = addLiveModifier(scenario.game, {
      kind: 'BLADE',
      playerId: PLAYER1,
      countDelta: 5,
      sourceCardId: scenario.ownPayId,
      abilityId: 'test-modifier',
    });

    const state = startAbility(
      modified,
      SP_PB2_009_ON_ENTER_WAIT_LIELLA_MEMBER_WAIT_OPPONENT_LOWER_PRINTED_BLADE_ABILITY_ID,
      scenario.sourceId,
      TriggerCondition.ON_ENTER_STAGE
    );

    expect(state.activeEffect).toBeNull();
    expect(state.players[0].memberSlots.cardStates.get(scenario.ownPayId)?.orientation).toBe(
      OrientationState.ACTIVE
    );
  });

  it('does not allow already WAITING own or opponent members', () => {
    const ownWaiting = setupState({ ownPayOrientation: OrientationState.WAITING });
    expect(
      startAbility(
        ownWaiting.game,
        SP_PB2_009_ON_ENTER_WAIT_LIELLA_MEMBER_WAIT_OPPONENT_LOWER_PRINTED_BLADE_ABILITY_ID,
        ownWaiting.sourceId,
        TriggerCondition.ON_ENTER_STAGE
      ).activeEffect
    ).toBeNull();

    const opponentWaiting = setupState({ lowOpponentOrientation: OrientationState.WAITING });
    expect(
      startAbility(
        opponentWaiting.game,
        SP_PB2_009_ON_ENTER_WAIT_LIELLA_MEMBER_WAIT_OPPONENT_LOWER_PRINTED_BLADE_ABILITY_ID,
        opponentWaiting.sourceId,
        TriggerCondition.ON_ENTER_STAGE
      ).activeEffect
    ).toBeNull();
  });
});
