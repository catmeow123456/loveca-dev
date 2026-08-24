import { describe, expect, it } from 'vitest';
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
  type PendingAbilityState,
} from '../../src/domain/entities/game';
import { createLiveSuccessEvent } from '../../src/domain/events/game-events';
import { addCardToZone, placeCardInSlot } from '../../src/domain/entities/zone';
import {
  isLiveAbilitySuppressed,
  suppressLiveAbility,
} from '../../src/domain/rules/live-modifiers';
import {
  confirmActiveEffectStep,
  enqueueTriggeredCardEffects,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import { GameService } from '../../src/application/game-service';
import {
  PL_PB2_003_LIVE_START_SUPPRESS_OPPONENT_MEMBER_LIVE_SUCCESS_GAIN_YELLOW_HEART_ABILITY_ID,
  SP_BP7_006_LIVE_SUCCESS_ENERGY_RETURNED_SCORE_ABILITY_ID,
  SP_BP7_007_LIVE_SUCCESS_MORE_ENERGY_ACTIVATE_SIX_ABILITY_ID,
  SP_BP7_007_LIVE_SUCCESS_PLACE_TWO_SKIPPED_ENERGY_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
import { getCardAbilityDefinitionsForCardCode } from '../../src/application/card-effects/definitions/lookup';
import {
  CardAbilityCategory,
  CardAbilitySourceZone,
} from '../../src/application/card-effects/ability-definition-types';
import {
  CardType,
  FaceState,
  GamePhase,
  HeartColor,
  OrientationState,
  SlotPosition,
  SubPhase,
  TriggerCondition,
} from '../../src/shared/types/enums';

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';
const EFFECT_TEXT =
  '【LIVE开始时】将存在于对方的舞台的1名成员的所有的【LIVE成功时】能力，LIVE结束为止，变为无效。因此使其无效的场合，LIVE结束时为止，获得[黄ハート]。';

function member(
  cardCode: string,
  ownerId: string,
  instanceId: string,
  name = instanceId
): CardInstance {
  return createCardInstance(
    {
      cardCode,
      name,
      cardType: CardType.MEMBER,
      cost: 9,
      blade: 1,
      hearts: [createHeartIcon(HeartColor.YELLOW, 1)],
    },
    ownerId,
    instanceId
  );
}

function live(ownerId: string, instanceId: string): CardInstance {
  return createCardInstance(
    {
      cardCode: `TEST-LIVE-${instanceId}`,
      name: instanceId,
      cardType: CardType.LIVE,
      score: 1,
      requirements: createHeartRequirement({ [HeartColor.YELLOW]: 1 }),
    },
    ownerId,
    instanceId
  );
}

function pending(sourceCardId: string, suffix = 'first'): PendingAbilityState {
  return {
    id: `pending-pl-pb2-003-${suffix}`,
    abilityId:
      PL_PB2_003_LIVE_START_SUPPRESS_OPPONENT_MEMBER_LIVE_SUCCESS_GAIN_YELLOW_HEART_ABILITY_ID,
    sourceCardId,
    controllerId: PLAYER1,
    mandatory: true,
    timingId: TriggerCondition.ON_LIVE_START,
    eventIds: [`live-start-${suffix}`],
    sourceSlot: SlotPosition.CENTER,
  };
}

function setup(
  options: {
    readonly includeMultiAbilityTarget?: boolean;
    readonly includePlainTarget?: boolean;
    readonly pendingCount?: number;
    readonly multiAbilityCardCode?: string;
    readonly multiAbilityTargetOwnerId?: string;
  } = {}
) {
  const source = member('PL!-pb2-003-PP', PLAYER1, 'kotori', '南ことり');
  const multiAbilityTarget =
    options.includeMultiAbilityTarget === false
      ? null
      : member(
          options.multiAbilityCardCode ?? 'PL!SP-bp7-007-P',
          options.multiAbilityTargetOwnerId ?? PLAYER2,
          'multi-target',
          '若菜四季'
        );
  const plainTarget =
    options.includePlainTarget === false
      ? null
      : member('TEST-PLAIN-MEMBER', PLAYER2, 'plain-target', 'Plain member');
  const successfulLive = live(PLAYER2, 'opponent-live');
  let game = registerCards(createGameState('pl-pb2-003-kotori', PLAYER1, 'P1', PLAYER2, 'P2'), [
    source,
    successfulLive,
    ...(multiAbilityTarget ? [multiAbilityTarget] : []),
    ...(plainTarget ? [plainTarget] : []),
  ]);
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    }),
  }));
  game = updatePlayer(game, PLAYER2, (player) => {
    let memberSlots = player.memberSlots;
    if (multiAbilityTarget) {
      memberSlots = placeCardInSlot(memberSlots, SlotPosition.LEFT, multiAbilityTarget.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      });
    }
    if (plainTarget) {
      memberSlots = placeCardInSlot(memberSlots, SlotPosition.RIGHT, plainTarget.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      });
    }
    return {
      ...player,
      memberSlots,
      liveZone: addCardToZone(player.liveZone, successfulLive.instanceId),
    };
  });
  game = {
    ...game,
    pendingAbilities: Array.from({ length: options.pendingCount ?? 1 }, (_, index) =>
      pending(source.instanceId, `${index + 1}`)
    ),
  };
  return { game, source, multiAbilityTarget, plainTarget, successfulLive };
}

function start(game: GameState): GameState {
  return resolvePendingCardEffects(game).gameState;
}

function choose(game: GameState, selectedCardId: string | null): GameState {
  return confirmActiveEffectStep(
    game,
    PLAYER1,
    game.activeEffect!.id,
    selectedCardId,
    null,
    false,
    null
  );
}

function suppressionModifiers(game: GameState, targetCardId: string) {
  return game.liveResolution.liveModifiers.filter(
    (modifier) => modifier.kind === 'SUPPRESS_ABILITY' && modifier.sourceCardId === targetCardId
  );
}

function sourceYellowHeartModifiers(game: GameState, sourceCardId: string) {
  return game.liveResolution.liveModifiers.filter(
    (modifier) =>
      modifier.kind === 'HEART' &&
      modifier.target === 'SOURCE_MEMBER' &&
      modifier.sourceCardId === sourceCardId &&
      modifier.hearts.some((heart) => heart.color === HeartColor.YELLOW && heart.count === 1)
  );
}

describe('PL!-pb2-003-PP Kotori LIVE_START suppression', () => {
  it('uses the exact definition text and exposes every opponent top-level member as a mandatory target', () => {
    const scenario = setup();
    const definition = getCardAbilityDefinitionsForCardCode('PL!-pb2-003-UNSEEN').find(
      (candidate) =>
        candidate.abilityId ===
        PL_PB2_003_LIVE_START_SUPPRESS_OPPONENT_MEMBER_LIVE_SUCCESS_GAIN_YELLOW_HEART_ABILITY_ID
    );
    expect(definition).toMatchObject({
      baseCardCodes: ['PL!-pb2-003'],
      category: CardAbilityCategory.LIVE_START,
      sourceZone: CardAbilitySourceZone.STAGE_MEMBER,
      triggerCondition: TriggerCondition.ON_LIVE_START,
      queued: true,
      implemented: true,
      effectText: EFFECT_TEXT,
    });

    const waiting = start(scenario.game);
    expect(waiting.activeEffect).toMatchObject({
      abilityId:
        PL_PB2_003_LIVE_START_SUPPRESS_OPPONENT_MEMBER_LIVE_SUCCESS_GAIN_YELLOW_HEART_ABILITY_ID,
      effectText: EFFECT_TEXT,
      stepText: '请选择对方舞台上的1名成员，使其全部【LIVE成功时】能力直到LIVE结束时为止无效。',
      selectableCardIds: [
        scenario.multiAbilityTarget!.instanceId,
        scenario.plainTarget!.instanceId,
      ],
      selectionLabel: '选择要使LIVE成功时能力无效的成员',
      confirmSelectionLabel: '使能力无效',
      canSkipSelection: false,
      minSelectableCards: 1,
      maxSelectableCards: 1,
    });
    expect(waiting.activeEffect?.metadata?.confirmOnlyPendingAbility).toBeUndefined();
    expect(choose(waiting, 'forged-target')).toBe(waiting);
  });

  it('suppresses all currently applicable LIVE_SUCCESS abilities and grants exactly one yellow Heart', () => {
    const scenario = setup({ includePlainTarget: false });
    const resolved = choose(start(scenario.game), scenario.multiAbilityTarget!.instanceId);

    expect(suppressionModifiers(resolved, scenario.multiAbilityTarget!.instanceId)).toEqual([
      expect.objectContaining({
        suppressedAbilityId: SP_BP7_007_LIVE_SUCCESS_PLACE_TWO_SKIPPED_ENERGY_ABILITY_ID,
        abilityId:
          PL_PB2_003_LIVE_START_SUPPRESS_OPPONENT_MEMBER_LIVE_SUCCESS_GAIN_YELLOW_HEART_ABILITY_ID,
      }),
      expect.objectContaining({
        suppressedAbilityId: SP_BP7_007_LIVE_SUCCESS_MORE_ENERGY_ACTIVATE_SIX_ABILITY_ID,
        abilityId:
          PL_PB2_003_LIVE_START_SUPPRESS_OPPONENT_MEMBER_LIVE_SUCCESS_GAIN_YELLOW_HEART_ABILITY_ID,
      }),
    ]);
    expect(sourceYellowHeartModifiers(resolved, scenario.source.instanceId)).toHaveLength(1);
    expect(resolved.activeEffect).toBeNull();
    expect(resolved.pendingAbilities).toEqual([]);
  });

  it('suppresses every LIVE_SUCCESS ability even when its slot condition is currently inactive', () => {
    const scenario = setup({
      includePlainTarget: false,
      multiAbilityCardCode: 'PL!SP-bp7-006-L',
      multiAbilityTargetOwnerId: PLAYER1,
    });
    const resolved = choose(start(scenario.game), scenario.multiAbilityTarget!.instanceId);

    expect(suppressionModifiers(resolved, scenario.multiAbilityTarget!.instanceId)).toEqual([
      expect.objectContaining({
        suppressedAbilityId: SP_BP7_006_LIVE_SUCCESS_ENERGY_RETURNED_SCORE_ABILITY_ID,
      }),
    ]);
    expect(sourceYellowHeartModifiers(resolved, scenario.source.instanceId)).toHaveLength(1);
  });

  it('allows a member with no suppressible ability to be selected without granting Heart', () => {
    const scenario = setup({ includeMultiAbilityTarget: false });
    const resolved = choose(start(scenario.game), scenario.plainTarget!.instanceId);

    expect(suppressionModifiers(resolved, scenario.plainTarget!.instanceId)).toEqual([]);
    expect(sourceYellowHeartModifiers(resolved, scenario.source.instanceId)).toEqual([]);
    expect(resolved.actionHistory.at(-1)?.payload).toMatchObject({
      step: 'NO_NEW_LIVE_SUCCESS_ABILITY_SUPPRESSED',
      suppressedAbilityIds: [],
      heartApplied: false,
    });
  });

  it('does not count abilities already suppressed by another effect', () => {
    const scenario = setup({ includePlainTarget: false });
    let game = scenario.game;
    for (const abilityId of [
      SP_BP7_007_LIVE_SUCCESS_PLACE_TWO_SKIPPED_ENERGY_ABILITY_ID,
      SP_BP7_007_LIVE_SUCCESS_MORE_ENERGY_ACTIVATE_SIX_ABILITY_ID,
    ]) {
      game = suppressLiveAbility(game, {
        sourceCardId: scenario.multiAbilityTarget!.instanceId,
        suppressedAbilityId: abilityId,
        abilityId: 'test:existing-suppression',
      });
    }

    const resolved = choose(start(game), scenario.multiAbilityTarget!.instanceId);
    expect(suppressionModifiers(resolved, scenario.multiAbilityTarget!.instanceId)).toHaveLength(2);
    expect(sourceYellowHeartModifiers(resolved, scenario.source.instanceId)).toEqual([]);
    expect(resolved.actionHistory.at(-1)?.payload).toMatchObject({
      suppressedAbilityIds: [],
      heartApplied: false,
    });
  });

  it('grants Heart when at least one of multiple abilities is newly suppressed', () => {
    const scenario = setup({ includePlainTarget: false });
    const game = suppressLiveAbility(scenario.game, {
      sourceCardId: scenario.multiAbilityTarget!.instanceId,
      suppressedAbilityId: SP_BP7_007_LIVE_SUCCESS_PLACE_TWO_SKIPPED_ENERGY_ABILITY_ID,
      abilityId: 'test:existing-suppression',
    });

    const resolved = choose(start(game), scenario.multiAbilityTarget!.instanceId);
    expect(suppressionModifiers(resolved, scenario.multiAbilityTarget!.instanceId)).toHaveLength(2);
    expect(sourceYellowHeartModifiers(resolved, scenario.source.instanceId)).toHaveLength(1);
    expect(resolved.actionHistory.at(-1)?.payload).toMatchObject({
      suppressedAbilityIds: [SP_BP7_007_LIVE_SUCCESS_MORE_ENERGY_ACTIVATE_SIX_ABILITY_ID],
      heartApplied: true,
    });
  });

  it('safely consumes a stale target and continues to the next pending ability', () => {
    const scenario = setup({ includePlainTarget: false, pendingCount: 2 });
    const orderWindow = start(scenario.game);
    const waiting = confirmActiveEffectStep(
      orderWindow,
      PLAYER1,
      orderWindow.activeEffect!.id,
      null,
      null,
      false,
      'pending-pl-pb2-003-1'
    );
    expect(waiting.activeEffect?.abilityId).toBe(
      PL_PB2_003_LIVE_START_SUPPRESS_OPPONENT_MEMBER_LIVE_SUCCESS_GAIN_YELLOW_HEART_ABILITY_ID
    );
    const stale = updatePlayer(waiting, PLAYER2, (player) => ({
      ...player,
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.LEFT, null),
    }));
    const afterStale = choose(stale, scenario.multiAbilityTarget!.instanceId);

    expect(afterStale.activeEffect).toBeNull();
    expect(afterStale.pendingAbilities).toEqual([]);
    expect(suppressionModifiers(afterStale, scenario.multiAbilityTarget!.instanceId)).toEqual([]);
    expect(sourceYellowHeartModifiers(afterStale, scenario.source.instanceId)).toEqual([]);
    expect(
      afterStale.actionHistory.some(
        (action) => action.payload.step === 'STALE_OPPONENT_MEMBER_NO_OP'
      )
    ).toBe(true);
    expect(
      afterStale.actionHistory.some((action) => action.payload.step === 'NO_OPPONENT_STAGE_MEMBER')
    ).toBe(true);
  });

  it('consumes safely when the opponent has no stage member', () => {
    const scenario = setup({ includeMultiAbilityTarget: false, includePlainTarget: false });
    const resolved = start(scenario.game);

    expect(resolved.activeEffect).toBeNull();
    expect(resolved.pendingAbilities).toEqual([]);
    expect(resolved.actionHistory.at(-1)?.payload).toMatchObject({
      step: 'NO_OPPONENT_STAGE_MEMBER',
      suppressedAbilityIds: [],
      heartApplied: false,
    });
  });

  it('prevents all suppressed target abilities from entering the LIVE_SUCCESS pending queue', () => {
    const scenario = setup({ includePlainTarget: false });
    const resolved = choose(start(scenario.game), scenario.multiAbilityTarget!.instanceId);
    const liveSuccess = enqueueTriggeredCardEffects(resolved, [TriggerCondition.ON_LIVE_SUCCESS], {
      liveSuccessEvents: [createLiveSuccessEvent(PLAYER2, [scenario.successfulLive.instanceId], 1)],
    });

    expect(
      liveSuccess.pendingAbilities.filter(
        (ability) => ability.sourceCardId === scenario.multiAbilityTarget!.instanceId
      )
    ).toEqual([]);
    expect(
      isLiveAbilitySuppressed(
        liveSuccess,
        scenario.multiAbilityTarget!.instanceId,
        SP_BP7_007_LIVE_SUCCESS_PLACE_TWO_SKIPPED_ENERGY_ABILITY_ID
      )
    ).toBe(true);
  });

  it('clears the suppression and yellow Heart modifiers at real LIVE_END', () => {
    const scenario = setup({ includePlainTarget: false });
    const resolved = choose(start(scenario.game), scenario.multiAbilityTarget!.instanceId);
    const finalized = new GameService().finalizeLiveResult({
      ...resolved,
      currentPhase: GamePhase.LIVE_RESULT_PHASE,
      currentSubPhase: SubPhase.RESULT_SETTLEMENT,
    });

    expect(finalized.success, finalized.error).toBe(true);
    expect(finalized.gameState.liveResolution.liveModifiers).toEqual([]);
    expect(
      isLiveAbilitySuppressed(
        finalized.gameState,
        scenario.multiAbilityTarget!.instanceId,
        SP_BP7_007_LIVE_SUCCESS_PLACE_TWO_SKIPPED_ENERGY_ABILITY_ID
      )
    ).toBe(false);
  });
});
