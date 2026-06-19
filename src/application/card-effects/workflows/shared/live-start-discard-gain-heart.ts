import {
  addAction,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { addHeartLiveModifierForMember } from '../../../../domain/rules/live-modifiers.js';
import { HeartColor } from '../../../../shared/types/enums.js';
import { hasOtherStageMember } from '../../../effects/conditions.js';
import {
  HS_BP1_006_LIVE_START_DISCARD_GAIN_HEART_ABILITY_ID,
  KOTORI_LIVE_START_HEART_ABILITY_ID,
} from '../../ability-ids.js';
import {
  createOptionalDiscardHandToWaitingRoomActiveEffect,
  finishSkippedActiveEffect,
  startPendingActiveEffect,
} from '../../runtime/active-effect.js';
import { discardOneHandCardToWaitingRoomForPlayer } from '../../runtime/actions.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';

export const KOTORI_LIVE_START_SELECT_DISCARD_STEP_ID = 'KOTORI_LIVE_START_SELECT_DISCARD';
export const KOTORI_LIVE_START_SELECT_HEART_STEP_ID = 'KOTORI_LIVE_START_SELECT_HEART';

const KOTORI_HEART_COLOR_OPTIONS = [HeartColor.PINK, HeartColor.YELLOW, HeartColor.PURPLE] as const;
const STANDARD_HEART_COLOR_OPTIONS = [
  HeartColor.PINK,
  HeartColor.RED,
  HeartColor.YELLOW,
  HeartColor.GREEN,
  HeartColor.BLUE,
  HeartColor.PURPLE,
] as const;

const HEART_COLOR_OPTION_LABELS: Readonly<Record<HeartColor, string>> = {
  [HeartColor.PINK]: '粉心',
  [HeartColor.RED]: '红心',
  [HeartColor.YELLOW]: '黄心',
  [HeartColor.GREEN]: '绿心',
  [HeartColor.BLUE]: '蓝心',
  [HeartColor.PURPLE]: '紫心',
  [HeartColor.RAINBOW]: '虹心',
};

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

interface LiveStartDiscardGainHeartConfig {
  readonly abilityId: string;
  readonly requiresOtherStageMember: boolean;
  readonly heartColorOptions: readonly HeartColor[];
}

const LIVE_START_DISCARD_GAIN_HEART_CONFIGS: readonly LiveStartDiscardGainHeartConfig[] = [
  {
    abilityId: KOTORI_LIVE_START_HEART_ABILITY_ID,
    requiresOtherStageMember: false,
    heartColorOptions: KOTORI_HEART_COLOR_OPTIONS,
  },
  {
    abilityId: HS_BP1_006_LIVE_START_DISCARD_GAIN_HEART_ABILITY_ID,
    requiresOtherStageMember: true,
    heartColorOptions: STANDARD_HEART_COLOR_OPTIONS,
  },
];

export function registerLiveStartDiscardGainHeartWorkflowHandlers(): void {
  for (const config of LIVE_START_DISCARD_GAIN_HEART_CONFIGS) {
    registerPendingAbilityStarterHandler(config.abilityId, (game, ability, options) =>
      startLiveStartDiscardGainHeartEffect(game, ability, options.orderedResolution === true, config)
    );
    registerActiveEffectStepHandler(
      config.abilityId,
      KOTORI_LIVE_START_SELECT_DISCARD_STEP_ID,
      (game, input, context) =>
        input.selectedCardId
          ? startLiveStartDiscardGainHeartChoice(
              game,
              input.selectedCardId,
              context.continuePendingCardEffects
            )
          : finishSkippedActiveEffect(game, context.continuePendingCardEffects)
    );
    registerActiveEffectStepHandler(
      config.abilityId,
      KOTORI_LIVE_START_SELECT_HEART_STEP_ID,
      (game, input, context) =>
        finishLiveStartDiscardGainHeartBonus(
          game,
          input.selectedOptionId ?? null,
          context.continuePendingCardEffects
        )
    );
  }
}

function startLiveStartDiscardGainHeartEffect(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  config: LiveStartDiscardGainHeartConfig
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const selectableCardIds = player.hand.cardIds;

  return startPendingActiveEffect(game, {
    ability,
    playerId: player.id,
    activeEffect: createOptionalDiscardHandToWaitingRoomActiveEffect({
      ability,
      playerId: player.id,
      effectText: getAbilityEffectText(config.abilityId),
      stepId: KOTORI_LIVE_START_SELECT_DISCARD_STEP_ID,
      selectableCardIds,
      orderedResolution,
      metadata: {
        requiresOtherStageMemberForHeart: config.requiresOtherStageMember,
        heartColorOptions: [...config.heartColorOptions],
      },
    }),
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      step: 'START_SELECT_DISCARD',
      selectableCardIds,
    },
  });
}

function startLiveStartDiscardGainHeartChoice(
  game: GameState,
  discardCardId: string,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (!effect || !effect.selectableCardIds?.includes(discardCardId)) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  if (!player || !player.hand.cardIds.includes(discardCardId)) {
    return game;
  }

  const discardResult = discardOneHandCardToWaitingRoomForPlayer(game, player.id, discardCardId, {
    candidateCardIds: effect.selectableCardIds ?? [],
  });
  if (!discardResult) {
    return game;
  }

  const state = discardResult.gameState;
  const requiresOtherStageMember = effect.metadata?.requiresOtherStageMemberForHeart === true;
  if (requiresOtherStageMember && !hasOtherStageMember(state, player.id, effect.sourceCardId)) {
    const finishedState = {
      ...state,
      activeEffect: null,
    };
    return continuePendingCardEffects(
      addAction(finishedState, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        step: 'DISCARD_HAND_CARD_NO_OTHER_MEMBER',
        discardCardId: discardResult.discardedCardIds[0],
      }),
      effect.metadata?.orderedResolution === true
    );
  }

  return addAction(
    {
      ...state,
      activeEffect: {
        ...effect,
        stepId: KOTORI_LIVE_START_SELECT_HEART_STEP_ID,
        stepText: '请选择本次 Live 结束前获得的 Heart。',
        selectableCardIds: [],
        selectableCardVisibility: 'PUBLIC',
        selectableOptions: getHeartColorOptionsForEffect(effect.metadata).map((color) => ({
          id: color,
          label: HEART_COLOR_OPTION_LABELS[color],
        })),
        canSkipSelection: false,
        metadata: {
          ...effect.metadata,
          discardCardId: discardResult.discardedCardIds[0],
        },
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'DISCARD_HAND_CARD',
      discardCardId: discardResult.discardedCardIds[0],
    }
  );
}

function finishLiveStartDiscardGainHeartBonus(
  game: GameState,
  selectedOptionId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (!effect) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  const selectedColor = getHeartColorOptionsForEffect(effect.metadata).includes(
    selectedOptionId as HeartColor
  )
    ? (selectedOptionId as HeartColor)
    : null;
  if (!player || selectedColor === null) {
    return game;
  }

  const heartBonus = { color: selectedColor, count: 1 };
  const modifierResult = addHeartLiveModifierForMember(
    { ...game, activeEffect: null },
    {
      playerId: player.id,
      memberCardId: effect.sourceCardId,
      sourceCardId: effect.sourceCardId,
      abilityId: effect.abilityId,
      hearts: [heartBonus],
    }
  );
  if (!modifierResult) {
    return game;
  }

  return continuePendingCardEffects(
    addAction(modifierResult.gameState, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'APPLY_HEART_BONUS',
      heartColor: selectedColor,
    }),
    effect.metadata?.orderedResolution === true
  );
}

function getHeartColorOptionsForEffect(metadata: Readonly<Record<string, unknown>> | undefined): readonly HeartColor[] {
  if (Array.isArray(metadata?.heartColorOptions)) {
    const colors = metadata.heartColorOptions.filter((color): color is HeartColor =>
      Object.values(HeartColor).includes(color as HeartColor)
    );
    if (colors.length > 0) {
      return colors;
    }
  }
  return KOTORI_HEART_COLOR_OPTIONS;
}
