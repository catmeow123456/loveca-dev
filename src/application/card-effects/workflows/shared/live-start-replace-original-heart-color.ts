import {
  addAction,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { replaceLiveModifier } from '../../../../domain/rules/live-modifiers.js';
import { HeartColor } from '../../../../shared/types/enums.js';
import {
  PL_N_BP3_014_LIVE_START_REPLACE_ORIGINAL_HEART_COLOR_ABILITY_ID,
  PL_N_BP3_015_LIVE_START_REPLACE_ORIGINAL_HEART_COLOR_ABILITY_ID,
  PL_N_PB1_034_LIVE_START_REPLACE_ORIGINAL_HEART_COLOR_ABILITY_ID,
  PL_N_PB1_036_LIVE_START_REPLACE_ORIGINAL_HEART_COLOR_ABILITY_ID,
} from '../../ability-ids.js';
import { startPendingActiveEffect } from '../../runtime/active-effect.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';

const REPLACE_ORIGINAL_HEART_COLOR_STEP_ID = 'REPLACE_ORIGINAL_HEART_COLOR';

const HEART_COLOR_OPTION_LABELS: Readonly<Record<HeartColor, string>> = {
  [HeartColor.PINK]: '桃Heart',
  [HeartColor.RED]: '红Heart',
  [HeartColor.YELLOW]: '黄Heart',
  [HeartColor.GREEN]: '绿Heart',
  [HeartColor.BLUE]: '蓝Heart',
  [HeartColor.PURPLE]: '紫Heart',
  [HeartColor.RAINBOW]: '虹Heart',
};

interface ReplaceOriginalHeartColorConfig {
  readonly abilityId: string;
  readonly heartColorOptions: readonly HeartColor[];
}

const REPLACE_ORIGINAL_HEART_COLOR_CONFIGS: readonly ReplaceOriginalHeartColorConfig[] = [
  {
    abilityId: PL_N_BP3_014_LIVE_START_REPLACE_ORIGINAL_HEART_COLOR_ABILITY_ID,
    heartColorOptions: [HeartColor.PINK, HeartColor.YELLOW, HeartColor.GREEN],
  },
  {
    abilityId: PL_N_BP3_015_LIVE_START_REPLACE_ORIGINAL_HEART_COLOR_ABILITY_ID,
    heartColorOptions: [HeartColor.RED, HeartColor.BLUE, HeartColor.PURPLE],
  },
  {
    abilityId: PL_N_PB1_034_LIVE_START_REPLACE_ORIGINAL_HEART_COLOR_ABILITY_ID,
    heartColorOptions: [HeartColor.YELLOW, HeartColor.GREEN, HeartColor.BLUE],
  },
  {
    abilityId: PL_N_PB1_036_LIVE_START_REPLACE_ORIGINAL_HEART_COLOR_ABILITY_ID,
    heartColorOptions: [HeartColor.PINK, HeartColor.RED, HeartColor.PURPLE],
  },
];

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerLiveStartReplaceOriginalHeartColorWorkflowHandlers(): void {
  for (const config of REPLACE_ORIGINAL_HEART_COLOR_CONFIGS) {
    registerPendingAbilityStarterHandler(config.abilityId, (game, ability, options) =>
      startReplaceOriginalHeartColorChoice(
        game,
        ability,
        options.orderedResolution === true,
        config
      )
    );
    registerActiveEffectStepHandler(config.abilityId, REPLACE_ORIGINAL_HEART_COLOR_STEP_ID, (game, input, context) =>
      finishReplaceOriginalHeartColorChoice(
        game,
        input.selectedOptionId ?? null,
        context.continuePendingCardEffects
      )
    );
  }
}

function startReplaceOriginalHeartColorChoice(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  config: ReplaceOriginalHeartColorConfig
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  return startPendingActiveEffect(game, {
    ability,
    playerId: player.id,
    activeEffect: {
      id: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      controllerId: ability.controllerId,
      effectText: getAbilityEffectText(config.abilityId),
      stepId: REPLACE_ORIGINAL_HEART_COLOR_STEP_ID,
      stepText: '请选择此成员原本持有的 Heart 要变成的颜色。',
      awaitingPlayerId: player.id,
      selectableCardIds: [],
      selectableCardVisibility: 'PUBLIC',
      selectableOptions: config.heartColorOptions.map((color) => ({
        id: color,
        label: HEART_COLOR_OPTION_LABELS[color],
      })),
      canSkipSelection: false,
      metadata: {
        heartColorOptions: [...config.heartColorOptions],
        orderedResolution,
      },
    },
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      step: 'START_SELECT_HEART_COLOR',
      heartColorOptions: config.heartColorOptions,
    },
  });
}

function finishReplaceOriginalHeartColorChoice(
  game: GameState,
  selectedOptionId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (!effect || effect.stepId !== REPLACE_ORIGINAL_HEART_COLOR_STEP_ID) {
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

  const state = replaceLiveModifier(
    { ...game, activeEffect: null },
    {
      kind: 'MEMBER_ORIGINAL_HEART_REPLACEMENT',
      playerId: player.id,
      sourceCardId: effect.sourceCardId,
      abilityId: effect.abilityId,
    },
    {
      kind: 'MEMBER_ORIGINAL_HEART_REPLACEMENT',
      playerId: player.id,
      memberCardId: effect.sourceCardId,
      color: selectedColor,
      sourceCardId: effect.sourceCardId,
      abilityId: effect.abilityId,
    }
  );

  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'APPLY_ORIGINAL_HEART_COLOR_REPLACEMENT',
      heartColor: selectedColor,
    }),
    effect.metadata?.orderedResolution === true
  );
}

function getHeartColorOptionsForEffect(
  metadata: Readonly<Record<string, unknown>> | undefined
): readonly HeartColor[] {
  if (!Array.isArray(metadata?.heartColorOptions)) {
    return [];
  }
  return metadata.heartColorOptions.filter((color): color is HeartColor =>
    Object.values(HeartColor).includes(color as HeartColor)
  );
}
