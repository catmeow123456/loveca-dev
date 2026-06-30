import { describe, expect, it } from 'vitest';
import type { MemberCardData } from '../../src/domain/entities/card';
import { createCardInstance, createHeartIcon } from '../../src/domain/entities/card';
import {
  createGameState,
  emitGameEvent,
  registerCards,
  updatePlayer,
  type GameState,
  type PendingAbilityState,
} from '../../src/domain/entities/game';
import { createEnterStageEvent } from '../../src/domain/events/game-events';
import { addCardToZone, placeCardInSlot } from '../../src/domain/entities/zone';
import {
  confirmActiveEffectStep,
  enqueueTriggeredCardEffects,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import {
  BP4_009_ON_ENTER_OPPONENT_WAIT_OWN_ACTIVE_MEMBER_ABILITY_ID,
  PB1_015_OWN_EFFECT_WAIT_OPPONENT_LOW_COST_DRAW_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
import {
  CardType,
  FaceState,
  HeartColor,
  OrientationState,
  SlotPosition,
  TriggerCondition,
  ZoneType,
} from '../../src/shared/types/enums';

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';

function createMemberData(
  cardCode: string,
  options: {
    readonly name?: string;
    readonly cost?: number;
    readonly groupNames?: readonly string[];
    readonly unitName?: string;
  } = {}
): MemberCardData {
  return {
    cardCode,
    name: options.name ?? cardCode,
    groupNames: options.groupNames ?? ["μ's"],
    unitName: options.unitName,
    cardType: CardType.MEMBER,
    cost: options.cost ?? 4,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
  };
}

function createMember(
  cardCode: string,
  instanceId: string,
  options: Parameters<typeof createMemberData>[1] = {},
  ownerId = PLAYER1
) {
  return createCardInstance(createMemberData(cardCode, options), ownerId, instanceId);
}

function setupState(options: {
  readonly sourceCardCode?: string;
  readonly opponentActive?: boolean;
  readonly includeTriggerSource?: boolean;
}): {
  readonly game: GameState;
  readonly source: ReturnType<typeof createMember>;
  readonly triggerSource: ReturnType<typeof createMember>;
  readonly opponentActiveMember: ReturnType<typeof createMember>;
  readonly opponentWaitingMember: ReturnType<typeof createMember>;
  readonly drawCard: ReturnType<typeof createMember>;
} {
  const source = createMember(options.sourceCardCode ?? 'PL!-bp4-009-R', 'bp4-009-source', {
    name: '矢澤にこ',
    cost: 7,
  });
  const triggerSource = createMember('PL!-pb1-015-P', 'pb1-015-trigger-source', {
    name: '西木野真姫',
    cost: 11,
    unitName: 'BiBi',
  });
  const opponentActiveMember = createMember(
    'PL!-opponent-active',
    'opponent-active-member',
    { cost: 4 },
    PLAYER2
  );
  const opponentWaitingMember = createMember(
    'PL!-opponent-waiting',
    'opponent-waiting-member',
    { cost: 4 },
    PLAYER2
  );
  const drawCard = createMember('PL!-draw-card', 'bp4-009-draw-card');

  let game = createGameState('pl-bp4-009-nico', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [
    source,
    triggerSource,
    opponentActiveMember,
    opponentWaitingMember,
    drawCard,
  ]);
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    memberSlots:
      options.includeTriggerSource === false
        ? placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId, {
            orientation: OrientationState.ACTIVE,
            face: FaceState.FACE_UP,
          })
        : placeCardInSlot(
            placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId, {
              orientation: OrientationState.ACTIVE,
              face: FaceState.FACE_UP,
            }),
            SlotPosition.LEFT,
            triggerSource.instanceId,
            {
              orientation: OrientationState.ACTIVE,
              face: FaceState.FACE_UP,
            }
          ),
    mainDeck: addCardToZone(player.mainDeck, drawCard.instanceId),
  }));
  game = updatePlayer(game, PLAYER2, (player) => ({
    ...player,
    memberSlots: placeCardInSlot(
      placeCardInSlot(player.memberSlots, SlotPosition.CENTER, opponentActiveMember.instanceId, {
        orientation:
          options.opponentActive === false ? OrientationState.WAITING : OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      }),
      SlotPosition.LEFT,
      opponentWaitingMember.instanceId,
      {
        orientation: OrientationState.WAITING,
        face: FaceState.FACE_UP,
      }
    ),
  }));

  return { game, source, triggerSource, opponentActiveMember, opponentWaitingMember, drawCard };
}

function startAbility(game: GameState, sourceCardId: string): GameState {
  const pendingAbility: PendingAbilityState = {
    id: 'bp4-009-pending',
    abilityId: BP4_009_ON_ENTER_OPPONENT_WAIT_OWN_ACTIVE_MEMBER_ABILITY_ID,
    sourceCardId,
    controllerId: PLAYER1,
    mandatory: true,
    timingId: TriggerCondition.ON_ENTER_STAGE,
    eventIds: ['enter-stage'],
    sourceSlot: SlotPosition.CENTER,
  };
  return resolvePendingCardEffects({ ...game, pendingAbilities: [pendingAbility] }).gameState;
}

function latestPayload(game: GameState) {
  return game.actionHistory
    .filter(
      (action) =>
        action.type === 'RESOLVE_ABILITY' &&
        action.payload.abilityId === BP4_009_ON_ENTER_OPPONENT_WAIT_OWN_ACTIVE_MEMBER_ABILITY_ID
    )
    .at(-1)?.payload;
}

describe('PL!-bp4-009 Nico opponent waits own active member workflow', () => {
  it('queues from a real ON_ENTER_STAGE event using the STAGE_MEMBER source-zone definition', () => {
    const scenario = setupState({ includeTriggerSource: false });
    const entered = emitGameEvent(
      scenario.game,
      createEnterStageEvent(
        scenario.source.instanceId,
        ZoneType.HAND,
        SlotPosition.CENTER,
        PLAYER1,
        PLAYER1
      )
    );
    const queued = enqueueTriggeredCardEffects(entered, [TriggerCondition.ON_ENTER_STAGE]);

    expect(queued.pendingAbilities).toEqual([
      expect.objectContaining({
        abilityId: BP4_009_ON_ENTER_OPPONENT_WAIT_OWN_ACTIVE_MEMBER_ABILITY_ID,
        sourceCardId: scenario.source.instanceId,
        controllerId: PLAYER1,
        timingId: TriggerCondition.ON_ENTER_STAGE,
        sourceSlot: SlotPosition.CENTER,
      }),
    ]);
    expect(
      queued.actionHistory.some(
        (action) =>
          action.type === 'TRIGGER_ABILITY' &&
          action.payload.abilityId ===
            BP4_009_ON_ENTER_OPPONENT_WAIT_OWN_ACTIVE_MEMBER_ABILITY_ID &&
          action.payload.sourceCardId === scenario.source.instanceId
      )
    ).toBe(true);

    const state = resolvePendingCardEffects(queued).gameState;
    expect(state.activeEffect).toMatchObject({
      abilityId: BP4_009_ON_ENTER_OPPONENT_WAIT_OWN_ACTIVE_MEMBER_ABILITY_ID,
      awaitingPlayerId: PLAYER2,
      selectableCardIds: [scenario.opponentActiveMember.instanceId],
    });
  });

  it.each(['PL!-bp4-009-R', 'PL!-bp4-009-P'])(
    'matches %s and asks the opponent to select their own active member',
    (sourceCardCode) => {
      const scenario = setupState({ sourceCardCode, includeTriggerSource: false });
      const state = startAbility(scenario.game, scenario.source.instanceId);

      expect(state.activeEffect).toMatchObject({
        abilityId: BP4_009_ON_ENTER_OPPONENT_WAIT_OWN_ACTIVE_MEMBER_ABILITY_ID,
        controllerId: PLAYER1,
        awaitingPlayerId: PLAYER2,
        selectableCardIds: [scenario.opponentActiveMember.instanceId],
      });
      expect(state.activeEffect?.selectableCardIds).not.toContain(
        scenario.opponentWaitingMember.instanceId
      );
      expect(latestPayload(state)).toMatchObject({
        step: 'START_OPPONENT_SELECT_OWN_ACTIVE_MEMBER_TO_WAIT',
        targetPlayerId: PLAYER2,
      });
    }
  );

  it('lets the opponent turn their own active member waiting and enqueues member-state triggers', () => {
    const scenario = setupState({});
    const started = startAbility(scenario.game, scenario.source.instanceId);
    const state = confirmActiveEffectStep(
      started,
      PLAYER2,
      started.activeEffect!.id,
      scenario.opponentActiveMember.instanceId
    );

    expect(
      state.players[1].memberSlots.cardStates.get(scenario.opponentActiveMember.instanceId)
        ?.orientation
    ).toBe(OrientationState.WAITING);
    expect(
      state.eventLog.some(
        (entry) => entry.event.eventType === TriggerCondition.ON_MEMBER_STATE_CHANGED
      )
    ).toBe(true);
    expect(
      state.actionHistory.some(
        (action) =>
          action.type === 'TRIGGER_ABILITY' &&
          action.payload.abilityId === PB1_015_OWN_EFFECT_WAIT_OPPONENT_LOW_COST_DRAW_ABILITY_ID &&
          action.payload.sourceCardId === scenario.triggerSource.instanceId
      )
    ).toBe(true);
    expect(state.players[0].hand.cardIds).toContain(scenario.drawCard.instanceId);
    expect(latestPayload(state)).toMatchObject({
      step: 'OPPONENT_WAIT_OWN_ACTIVE_MEMBER',
      targetPlayerId: PLAYER2,
      targetCardId: scenario.opponentActiveMember.instanceId,
      previousOrientation: OrientationState.ACTIVE,
      nextOrientation: OrientationState.WAITING,
    });
  });

  it('does not allow waiting members or the controller to be selected', () => {
    const scenario = setupState({ includeTriggerSource: false });
    const started = startAbility(scenario.game, scenario.source.instanceId);

    expect(started.activeEffect?.selectableCardIds).toEqual([
      scenario.opponentActiveMember.instanceId,
    ]);
    expect(
      confirmActiveEffectStep(
        started,
        PLAYER2,
        started.activeEffect!.id,
        scenario.opponentWaitingMember.instanceId
      )
    ).toBe(started);
    expect(
      confirmActiveEffectStep(
        started,
        PLAYER2,
        started.activeEffect!.id,
        scenario.source.instanceId
      )
    ).toBe(started);
    expect(
      confirmActiveEffectStep(
        started,
        PLAYER1,
        started.activeEffect!.id,
        scenario.opponentActiveMember.instanceId
      )
    ).toBe(started);
  });

  it('consumes pending as no-op when the opponent has no active member', () => {
    const scenario = setupState({ opponentActive: false, includeTriggerSource: false });
    const state = startAbility(scenario.game, scenario.source.instanceId);

    expect(state.activeEffect).toBeNull();
    expect(state.pendingAbilities).toHaveLength(0);
    expect(latestPayload(state)).toMatchObject({
      step: 'NO_OP_OPPONENT_HAS_NO_ACTIVE_MEMBER',
      targetPlayerId: PLAYER2,
    });
  });
});
