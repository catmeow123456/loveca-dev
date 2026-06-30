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
  PB1_011_ON_ENTER_DIFFERENT_BIBI_WAIT_OPPONENT_LOW_COST_MEMBER_ABILITY_ID,
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
    readonly unitName?: string;
    readonly groupNames?: readonly string[];
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
  readonly supportKind?: 'different-bibi' | 'same-name-bibi' | 'non-bibi' | 'opponent-bibi';
  readonly opponentTargetCost?: number;
  readonly opponentTargetOrientation?: OrientationState;
}) {
  const source = createMember(options.sourceCardCode ?? 'PL!-pb1-011-R', 'pb1-011-source', {
    name: '絢瀬絵里',
    cost: 2,
    unitName: 'BiBi',
  });
  const support =
    options.supportKind === 'same-name-bibi'
      ? createMember('PL!-support-eli', 'pb1-011-support', {
          name: '絢瀬絵里',
          unitName: 'BiBi',
        })
      : options.supportKind === 'non-bibi'
        ? createMember('PL!-support-honoka', 'pb1-011-support', {
            name: '高坂穂乃果',
            unitName: 'Printemps',
          })
        : options.supportKind === 'opponent-bibi'
          ? createMember('PL!-support-honoka', 'pb1-011-support', {
              name: '高坂穂乃果',
              unitName: 'Printemps',
            })
          : createMember('PL!-pb1-015-P', 'pb1-011-support', {
              name: '西木野真姫',
              cost: 11,
              unitName: 'BiBi',
            });
  const opponentBibi = createMember(
    'PL!-opponent-bibi',
    'pb1-011-opponent-bibi',
    { name: '矢澤にこ', unitName: 'BiBi' },
    PLAYER2
  );
  const opponentTarget = createMember(
    'PL!-opponent-target',
    'pb1-011-opponent-target',
    { cost: options.opponentTargetCost ?? 4 },
    PLAYER2
  );
  const opponentWaiting = createMember(
    'PL!-opponent-waiting',
    'pb1-011-opponent-waiting',
    { cost: 4 },
    PLAYER2
  );
  const drawCard = createMember('PL!-draw-card', 'pb1-011-draw-card');

  let game = createGameState('pl-pb1-011-eli', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [
    source,
    support,
    opponentBibi,
    opponentTarget,
    opponentWaiting,
    drawCard,
  ]);
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    memberSlots: placeCardInSlot(
      placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      }),
      SlotPosition.LEFT,
      support.instanceId,
      {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      }
    ),
    mainDeck: addCardToZone(player.mainDeck, drawCard.instanceId),
  }));
  game = updatePlayer(game, PLAYER2, (player) => ({
    ...player,
    memberSlots:
      options.supportKind === 'opponent-bibi'
        ? placeCardInSlot(
            placeCardInSlot(player.memberSlots, SlotPosition.CENTER, opponentTarget.instanceId, {
              orientation: options.opponentTargetOrientation ?? OrientationState.ACTIVE,
              face: FaceState.FACE_UP,
            }),
            SlotPosition.RIGHT,
            opponentBibi.instanceId,
            {
              orientation: OrientationState.ACTIVE,
              face: FaceState.FACE_UP,
            }
          )
        : placeCardInSlot(
            placeCardInSlot(player.memberSlots, SlotPosition.CENTER, opponentTarget.instanceId, {
              orientation: options.opponentTargetOrientation ?? OrientationState.ACTIVE,
              face: FaceState.FACE_UP,
            }),
            SlotPosition.LEFT,
            opponentWaiting.instanceId,
            {
              orientation: OrientationState.WAITING,
              face: FaceState.FACE_UP,
            }
          ),
  }));

  return { game, source, support, opponentTarget, opponentWaiting, drawCard };
}

function enqueueFromEnterStage(game: GameState, sourceCardId: string): GameState {
  const entered = emitGameEvent(
    game,
    createEnterStageEvent(sourceCardId, ZoneType.HAND, SlotPosition.CENTER, PLAYER1, PLAYER1)
  );
  return enqueueTriggeredCardEffects(entered, [TriggerCondition.ON_ENTER_STAGE]);
}

function startAbility(game: GameState, sourceCardId: string): GameState {
  const pendingAbility: PendingAbilityState = {
    id: 'pb1-011-pending',
    abilityId: PB1_011_ON_ENTER_DIFFERENT_BIBI_WAIT_OPPONENT_LOW_COST_MEMBER_ABILITY_ID,
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
        action.payload.abilityId ===
          PB1_011_ON_ENTER_DIFFERENT_BIBI_WAIT_OPPONENT_LOW_COST_MEMBER_ABILITY_ID
    )
    .at(-1)?.payload;
}

describe('PL!-pb1-011 Eri different-name BiBi opponent wait workflow', () => {
  it.each(['PL!-pb1-011-R', 'PL!-pb1-011-P＋'] as const)(
    'queues from real ON_ENTER_STAGE for %s and opens opponent low-cost target selection',
    (sourceCardCode) => {
      const scenario = setupState({ sourceCardCode });
      const queued = enqueueFromEnterStage(scenario.game, scenario.source.instanceId);

      expect(queued.pendingAbilities).toEqual([
        expect.objectContaining({
          abilityId: PB1_011_ON_ENTER_DIFFERENT_BIBI_WAIT_OPPONENT_LOW_COST_MEMBER_ABILITY_ID,
          sourceCardId: scenario.source.instanceId,
          sourceSlot: SlotPosition.CENTER,
        }),
      ]);

      const started = resolvePendingCardEffects(queued).gameState;
      expect(started.activeEffect).toMatchObject({
        abilityId: PB1_011_ON_ENTER_DIFFERENT_BIBI_WAIT_OPPONENT_LOW_COST_MEMBER_ABILITY_ID,
        awaitingPlayerId: PLAYER1,
        selectableCardIds: [scenario.opponentTarget.instanceId],
      });
      expect(started.activeEffect?.selectableCardIds).not.toContain(
        scenario.opponentWaiting.instanceId
      );
    }
  );

  it.each([
    { name: 'same-name BiBi copy', supportKind: 'same-name-bibi' as const },
    { name: 'non-BiBi support member', supportKind: 'non-bibi' as const },
    { name: 'opponent BiBi member', supportKind: 'opponent-bibi' as const },
  ])('consumes pending as no-op when only $name is present', ({ supportKind }) => {
    const scenario = setupState({ supportKind });
    const state = startAbility(scenario.game, scenario.source.instanceId);

    expect(state.activeEffect).toBeNull();
    expect(state.pendingAbilities).toHaveLength(0);
    expect(latestPayload(state)).toMatchObject({
      step: 'SKIP_CONDITION_NOT_MET',
      ownStageDifferentBiBiMemberNameCount: 1,
      requiredOwnStageDifferentBiBiMemberNameCount: 2,
    });
  });

  it('does not include cost >4 or already WAITING opponent members as targets', () => {
    const highCost = setupState({ opponentTargetCost: 5 });
    const highCostState = startAbility(highCost.game, highCost.source.instanceId);
    expect(highCostState.activeEffect).toBeNull();
    expect(latestPayload(highCostState)).toMatchObject({
      step: 'SKIP_NO_TARGET',
    });

    const waiting = setupState({ opponentTargetOrientation: OrientationState.WAITING });
    const waitingState = startAbility(waiting.game, waiting.source.instanceId);
    expect(waitingState.activeEffect).toBeNull();
    expect(latestPayload(waitingState)).toMatchObject({
      step: 'SKIP_NO_TARGET',
    });
  });

  it('waits the selected opponent member and enqueues member-state triggers', () => {
    const scenario = setupState({});
    const started = startAbility(scenario.game, scenario.source.instanceId);
    const state = confirmActiveEffectStep(
      started,
      PLAYER1,
      started.activeEffect!.id,
      scenario.opponentTarget.instanceId
    );

    expect(
      state.players[1].memberSlots.cardStates.get(scenario.opponentTarget.instanceId)?.orientation
    ).toBe(OrientationState.WAITING);
    expect(
      state.actionHistory.some(
        (action) =>
          action.type === 'TRIGGER_ABILITY' &&
          action.payload.abilityId === PB1_015_OWN_EFFECT_WAIT_OPPONENT_LOW_COST_DRAW_ABILITY_ID &&
          action.payload.sourceCardId === scenario.support.instanceId
      )
    ).toBe(true);
    expect(state.players[0].hand.cardIds).toContain(scenario.drawCard.instanceId);
    expect(latestPayload(state)).toMatchObject({
      step: 'WAIT_OPPONENT_MEMBER',
      targetCardId: scenario.opponentTarget.instanceId,
      previousOrientation: OrientationState.ACTIVE,
      nextOrientation: OrientationState.WAITING,
    });
  });
});
