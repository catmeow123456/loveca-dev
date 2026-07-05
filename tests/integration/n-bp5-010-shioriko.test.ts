import { describe, expect, it } from 'vitest';
import type { MemberCardData } from '../../src/domain/entities/card';
import { createCardInstance, createHeartIcon } from '../../src/domain/entities/card';
import {
  createGameState,
  registerCards,
  updateLiveResolution,
  updatePlayer,
  type GameState,
} from '../../src/domain/entities/game';
import { placeCardInSlot, removeCardFromSlot } from '../../src/domain/entities/zone';
import {
  confirmActiveEffectStep,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import { N_BP5_010_LIVE_SUCCESS_REMAINING_HEART_SCORE_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
import {
  CardType,
  FaceState,
  HeartColor,
  OrientationState,
  SlotPosition,
  TriggerCondition,
} from '../../src/shared/types/enums';
import { confirmIfConfirmOnly } from './confirm-only-pending';

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';

function createMember(): MemberCardData {
  return {
    cardCode: 'PL!N-bp5-010-R',
    name: '三船栞子',
    groupNames: ['虹ヶ咲'],
    cardType: CardType.MEMBER,
    cost: 13,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.GREEN, 1)],
  };
}

function setupShiorikoLiveSuccess(options: {
  readonly remainingHeartCount: number;
  readonly playerScore: number;
  readonly removeSource?: boolean;
  readonly secondSource?: boolean;
}) {
  const source = createCardInstance(createMember(), PLAYER1, 'n-bp5-010-source');
  const secondSource = createCardInstance(createMember(), PLAYER1, 'n-bp5-010-source-2');
  let game = createGameState('n-bp5-010-shioriko', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [source, secondSource]);
  game = updatePlayer(game, PLAYER1, (player) => {
    let memberSlots = placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    });
    if (options.secondSource) {
      memberSlots = placeCardInSlot(memberSlots, SlotPosition.RIGHT, secondSource.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      });
    }
    return {
      ...player,
      memberSlots: options.removeSource
        ? removeCardFromSlot(memberSlots, SlotPosition.CENTER)
        : memberSlots,
    };
  });
  game = updateLiveResolution(game, (liveResolution) => {
    const playerScores = new Map(liveResolution.playerScores);
    const playerRemainingHearts = new Map(liveResolution.playerRemainingHearts);
    playerScores.set(PLAYER1, options.playerScore);
    playerRemainingHearts.set(
      PLAYER1,
      options.remainingHeartCount > 0
        ? [createHeartIcon(HeartColor.RED, options.remainingHeartCount)]
        : []
    );
    return { ...liveResolution, playerScores, playerRemainingHearts };
  });
  game = {
    ...game,
    pendingAbilities: [
      {
        id: 'n-bp5-010-live-success',
        abilityId: N_BP5_010_LIVE_SUCCESS_REMAINING_HEART_SCORE_ABILITY_ID,
        sourceCardId: source.instanceId,
        controllerId: PLAYER1,
        mandatory: true,
        timingId: TriggerCondition.ON_LIVE_SUCCESS,
        eventIds: ['live-success'],
        sourceSlot: SlotPosition.CENTER,
      },
      ...(options.secondSource
        ? [
            {
              id: 'n-bp5-010-live-success-2',
              abilityId: N_BP5_010_LIVE_SUCCESS_REMAINING_HEART_SCORE_ABILITY_ID,
              sourceCardId: secondSource.instanceId,
              controllerId: PLAYER1,
              mandatory: true,
              timingId: TriggerCondition.ON_LIVE_SUCCESS,
              eventIds: ['live-success-2'],
              sourceSlot: SlotPosition.RIGHT,
            },
          ]
        : []),
    ],
  };
  return { game, source, secondSource };
}

function resolve(game: GameState): GameState {
  return confirmIfConfirmOnly(resolvePendingCardEffects(game).gameState, PLAYER1);
}

function abilityScoreModifierDeltas(game: GameState): readonly number[] {
  return game.liveResolution.liveModifiers
    .filter(
      (modifier) =>
        modifier.kind === 'SCORE' &&
        modifier.abilityId === N_BP5_010_LIVE_SUCCESS_REMAINING_HEART_SCORE_ABILITY_ID
    )
    .map((modifier) => modifier.countDelta);
}

describe('PL!N-bp5-010 Shioriko live-success remaining Heart score workflow', () => {
  it('opens manual confirm-only and adds score when there is no remaining Heart', () => {
    const { game } = setupShiorikoLiveSuccess({ remainingHeartCount: 0, playerScore: 1 });
    const confirmation = resolvePendingCardEffects(game).gameState;

    expect(confirmation.activeEffect?.metadata?.confirmOnlyPendingAbility).toBe(true);
    expect(confirmation.activeEffect?.effectText).toContain('当前余剩 Heart 为0个');
    expect(confirmation.activeEffect?.effectText).not.toContain('余剰ハート');
    expect(confirmation.activeEffect?.effectText).toContain('本次LIVE合计分数+1');
    expect(confirmation.activeEffect?.effectText).not.toContain('确认后');

    const result = confirmIfConfirmOnly(confirmation, PLAYER1);
    expect(result.pendingAbilities).toEqual([]);
    expect(result.liveResolution.playerScores.get(PLAYER1)).toBe(2);
    expect(abilityScoreModifierDeltas(result)).toEqual([1]);
  });

  it('keeps the score unchanged when there is exactly one remaining Heart', () => {
    const { game } = setupShiorikoLiveSuccess({ remainingHeartCount: 1, playerScore: 2 });

    const result = resolve(game);

    expect(result.liveResolution.playerScores.get(PLAYER1)).toBe(2);
    expect(abilityScoreModifierDeltas(result)).toEqual([]);
    expect(
      result.actionHistory.find(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId === N_BP5_010_LIVE_SUCCESS_REMAINING_HEART_SCORE_ABILITY_ID
      )?.payload.actualScoreDelta
    ).toBe(0);
  });

  it('subtracts one score when there are two or more remaining Hearts', () => {
    const { game } = setupShiorikoLiveSuccess({ remainingHeartCount: 2, playerScore: 3 });

    const result = resolve(game);

    expect(result.liveResolution.playerScores.get(PLAYER1)).toBe(2);
    expect(abilityScoreModifierDeltas(result)).toEqual([-1]);
  });

  it('does not reduce the score below zero', () => {
    const { game } = setupShiorikoLiveSuccess({ remainingHeartCount: 3, playerScore: 0 });

    const result = resolve(game);

    expect(result.liveResolution.playerScores.get(PLAYER1)).toBe(0);
    expect(abilityScoreModifierDeltas(result)).toEqual([]);
    expect(
      result.actionHistory.find(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId === N_BP5_010_LIVE_SUCCESS_REMAINING_HEART_SCORE_ABILITY_ID
      )?.payload.requestedScoreDelta
    ).toBe(-1);
  });

  it('no-ops when the source leaves stage before resolution', () => {
    const { game } = setupShiorikoLiveSuccess({
      remainingHeartCount: 0,
      playerScore: 1,
      removeSource: true,
    });

    const result = resolve(game);

    expect(result.liveResolution.playerScores.get(PLAYER1)).toBe(1);
    expect(abilityScoreModifierDeltas(result)).toEqual([]);
    expect(
      result.actionHistory.find(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId === N_BP5_010_LIVE_SUCCESS_REMAINING_HEART_SCORE_ABILITY_ID
      )?.payload.step
    ).toBe('SOURCE_NOT_ON_STAGE');
  });

  it('resolves multiple pending abilities in order without opening confirm-only prompts', () => {
    const { game } = setupShiorikoLiveSuccess({
      remainingHeartCount: 2,
      playerScore: 1,
      secondSource: true,
    });
    const orderSelection = resolvePendingCardEffects(game).gameState;
    expect(orderSelection.activeEffect?.abilityId).toBe('system:select-pending-card-effect');

    const result = confirmActiveEffectStep(
      orderSelection,
      PLAYER1,
      orderSelection.activeEffect!.id,
      null,
      null,
      true
    );
    const resolveActions = result.actionHistory.filter(
      (action) =>
        action.type === 'RESOLVE_ABILITY' &&
        action.payload.abilityId === N_BP5_010_LIVE_SUCCESS_REMAINING_HEART_SCORE_ABILITY_ID &&
        action.payload.step === 'REMAINING_HEART_SCORE'
    );

    expect(result.activeEffect).toBeNull();
    expect(result.pendingAbilities).toEqual([]);
    expect(result.liveResolution.playerScores.get(PLAYER1)).toBe(0);
    expect(resolveActions).toHaveLength(2);
    expect(
      resolveActions.map((action) =>
        Object.is(action.payload.actualScoreDelta, -0) ? 0 : action.payload.actualScoreDelta
      )
    ).toEqual([-1, 0]);
    expect(resolveActions.map((action) => action.payload.previousScore)).toEqual([1, 0]);
    expect(resolveActions.map((action) => action.payload.nextScore)).toEqual([0, 0]);
  });
});
