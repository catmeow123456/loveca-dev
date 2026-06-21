import {
  addAction,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { addHeartLiveModifierForMember } from '../../../../domain/rules/live-modifiers.js';
import { CardType, HeartColor, ZoneType } from '../../../../shared/types/enums.js';
import {
  HS_BP5_013_LIVE_START_MILL_GAIN_BLADE_ABILITY_ID,
  HS_PR_019_ON_ENTER_MILL_GAIN_GREEN_HEART_ABILITY_ID,
  HS_PR_021_ON_ENTER_MILL_GAIN_PINK_HEART_ABILITY_ID,
  HS_SD1_013_ON_ENTER_MILL_GAIN_BLUE_HEART_ABILITY_ID,
} from '../../ability-ids.js';
import { addBladeLiveModifierForSourceMember } from '../../runtime/actions.js';
import { startPendingActiveEffect } from '../../runtime/active-effect.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';
import {
  memberHasHeartColor,
  typeIs,
  type CardSelector,
} from '../../../effects/card-selectors.js';
import { allCardIdsMatchingSelector } from '../../../effects/conditions.js';
import { inspectTopCards, moveInspectedCardsToWaitingRoom } from '../../../effects/look-top.js';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

type MillTopReward =
  | {
      readonly type: 'heart';
      readonly heartColor: HeartColor;
      readonly label: string;
      readonly actionPayloadKey: 'heartBonus';
    }
  | {
      readonly type: 'blade';
      readonly amount: number;
      readonly label: string;
      readonly actionPayloadKey: 'bladeBonus';
    };

interface MillTopGainLiveModifierConfig {
  readonly abilityId: string;
  readonly stepId: string;
  readonly topCount: number;
  readonly conditionSelector: CardSelector;
  readonly conditionLabel: string;
  readonly reward: MillTopReward;
  readonly finishStep: string;
}

const MILL_TOP_GAIN_LIVE_MODIFIER_CONFIGS: readonly MillTopGainLiveModifierConfig[] = [
  {
    abilityId: HS_PR_019_ON_ENTER_MILL_GAIN_GREEN_HEART_ABILITY_ID,
    stepId: 'HS_PR_019_REVEAL_TOP_THREE',
    topCount: 3,
    conditionSelector: memberHasHeartColor(HeartColor.GREEN),
    conditionLabel: '持有绿色Heart的成员',
    reward: {
      type: 'heart',
      heartColor: HeartColor.GREEN,
      label: '绿色Heart',
      actionPayloadKey: 'heartBonus',
    },
    finishStep: 'FINISH_MILL_TOP_THREE_CHECK_GREEN_HEART_MEMBERS',
  },
  {
    abilityId: HS_PR_021_ON_ENTER_MILL_GAIN_PINK_HEART_ABILITY_ID,
    stepId: 'HS_PR_021_REVEAL_TOP_THREE',
    topCount: 3,
    conditionSelector: memberHasHeartColor(HeartColor.PINK),
    conditionLabel: '持有桃Heart的成员',
    reward: {
      type: 'heart',
      heartColor: HeartColor.PINK,
      label: '桃Heart',
      actionPayloadKey: 'heartBonus',
    },
    finishStep: 'FINISH_MILL_TOP_THREE_CHECK_PINK_HEART_MEMBERS',
  },
  {
    abilityId: HS_SD1_013_ON_ENTER_MILL_GAIN_BLUE_HEART_ABILITY_ID,
    stepId: 'HS_SD1_013_REVEAL_TOP_THREE',
    topCount: 3,
    conditionSelector: memberHasHeartColor(HeartColor.BLUE),
    conditionLabel: '持有蓝Heart的成员',
    reward: {
      type: 'heart',
      heartColor: HeartColor.BLUE,
      label: '蓝Heart',
      actionPayloadKey: 'heartBonus',
    },
    finishStep: 'FINISH_MILL_TOP_THREE_CHECK_BLUE_HEART_MEMBERS',
  },
  {
    abilityId: HS_BP5_013_LIVE_START_MILL_GAIN_BLADE_ABILITY_ID,
    stepId: 'HS_BP5_013_REVEAL_TOP_THREE',
    topCount: 3,
    conditionSelector: typeIs(CardType.MEMBER),
    conditionLabel: '成员卡',
    reward: {
      type: 'blade',
      amount: 2,
      label: '[BLADE][BLADE]',
      actionPayloadKey: 'bladeBonus',
    },
    finishStep: 'FINISH_MILL_TOP_THREE_CHECK_MEMBERS_GAIN_BLADE',
  },
];

export function registerMillTopGainLiveModifierWorkflowHandlers(): void {
  for (const config of MILL_TOP_GAIN_LIVE_MODIFIER_CONFIGS) {
    registerPendingAbilityStarterHandler(config.abilityId, (game, ability, options) =>
      startMillTopGainLiveModifierInspection(
        game,
        ability,
        options.orderedResolution === true,
        config
      )
    );
    registerActiveEffectStepHandler(config.abilityId, config.stepId, (game, _input, context) =>
      finishMillTopGainLiveModifier(game, context.continuePendingCardEffects, config)
    );
  }
}

function startMillTopGainLiveModifierInspection(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  config: MillTopGainLiveModifierConfig
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const inspection = inspectTopCards(game, player.id, {
    count: config.topCount,
    reveal: true,
  });
  if (!inspection) {
    return game;
  }

  const { gameState, inspectedCardIds } = inspection;
  return startPendingActiveEffect(gameState, {
    ability,
    playerId: player.id,
    activeEffect: {
      id: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      controllerId: ability.controllerId,
      effectText: getAbilityEffectText(config.abilityId),
      stepId: config.stepId,
      stepText: `卡组顶${config.topCount}张已公开。确认后将这些牌放入休息室，并在均为${config.conditionLabel}时获得${config.reward.label}。`,
      awaitingPlayerId: player.id,
      inspectionCardIds: inspectedCardIds,
      metadata: {
        sourceZone: ZoneType.MAIN_DECK,
        orderedResolution,
      },
    },
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      step: 'START_INSPECTION',
      inspectedCardIds,
    },
  });
}

function finishMillTopGainLiveModifier(
  game: GameState,
  continuePendingCardEffects: ContinuePendingCardEffects,
  config: MillTopGainLiveModifierConfig
): GameState {
  const effect = game.activeEffect;
  if (!effect || effect.abilityId !== config.abilityId || effect.stepId !== config.stepId) {
    return game;
  }

  const player = getPlayerById(game, effect.controllerId);
  if (!player) {
    return game;
  }

  const inspectedCardIds = effect.inspectionCardIds ?? [];
  const conditionMet =
    inspectedCardIds.length === config.topCount &&
    allCardIdsMatchingSelector(game, inspectedCardIds, config.conditionSelector);

  const moveResult = moveInspectedCardsToWaitingRoom(game, player.id, inspectedCardIds);
  if (!moveResult) {
    return game;
  }

  let state: GameState = {
    ...moveResult.gameState,
    inspectionContext:
      moveResult.gameState.inspectionZone.cardIds.length > 0
        ? moveResult.gameState.inspectionContext
        : null,
    activeEffect: null,
  };

  if (conditionMet) {
    const modifierResult =
      config.reward.type === 'heart'
        ? addHeartLiveModifierForMember(state, {
            playerId: player.id,
            memberCardId: effect.sourceCardId,
            sourceCardId: effect.sourceCardId,
            abilityId: effect.abilityId,
            hearts: [{ color: config.reward.heartColor, count: 1 }],
          })
        : addBladeLiveModifierForSourceMember(state, {
            playerId: player.id,
            sourceCardId: effect.sourceCardId,
            abilityId: effect.abilityId,
            amount: config.reward.amount,
          });
    if (!modifierResult) {
      return game;
    }
    state = modifierResult.gameState;
  }

  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: config.finishStep,
      milledCardIds: moveResult.movedCardIds,
      conditionMet,
      ...createRewardActionPayload(config.reward, conditionMet),
    }),
    effect.metadata?.orderedResolution === true
  );
}

function createRewardActionPayload(
  reward: MillTopReward,
  conditionMet: boolean
): Readonly<Record<string, unknown>> {
  if (reward.type === 'heart') {
    return {
      [reward.actionPayloadKey]: conditionMet
        ? [{ color: reward.heartColor, count: 1 }]
        : [],
    };
  }
  return {
    [reward.actionPayloadKey]: conditionMet ? reward.amount : 0,
  };
}
