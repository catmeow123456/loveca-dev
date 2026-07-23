import { isLiveCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
  type LiveModifierState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { replaceLiveModifier } from '../../../../domain/rules/live-modifiers.js';
import { HeartColor } from '../../../../shared/types/enums.js';
import { collectCurrentLiveRevealedCheerBladeHeartColors } from '../../../effects/cheer-selection.js';
import { N_BP7_025_LIVE_SUCCESS_THREE_BLADE_HEART_COLORS_SCORE_ABILITY_ID } from '../../ability-ids.js';
import {
  getAbilityEffectText,
  registerManualConfirmablePendingAbilityStarterHandler,
} from '../../runtime/workflow-helpers.js';

const ABILITY_ID = N_BP7_025_LIVE_SUCCESS_THREE_BLADE_HEART_COLORS_SCORE_ABILITY_ID;
const EXACT_CARD_CODE = 'PL!N-bp7-025-SECL';
const SCORE_BONUS = 1;
const REQUIRED_COLOR_COUNT = 3;
const COUNTED_HEART_COLORS = [
  HeartColor.PINK,
  HeartColor.RED,
  HeartColor.YELLOW,
  HeartColor.GREEN,
  HeartColor.BLUE,
  HeartColor.PURPLE,
] as const;
const HEART_COLOR_LABELS: Readonly<Record<(typeof COUNTED_HEART_COLORS)[number], string>> = {
  [HeartColor.PINK]: '[桃ハート]',
  [HeartColor.RED]: '[赤ハート]',
  [HeartColor.YELLOW]: '[黄ハート]',
  [HeartColor.GREEN]: '[緑ハート]',
  [HeartColor.BLUE]: '[青ハート]',
  [HeartColor.PURPLE]: '[紫ハート]',
};

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

interface LiveSuccessEvaluation {
  readonly sourceInLiveZone: boolean;
  readonly matchedColors: readonly (typeof COUNTED_HEART_COLORS)[number][];
  readonly matchedColorCount: number;
  readonly conditionMet: boolean;
}

export function registerNBp7025ColorfulDreamsColorfulSmilesWorkflowHandlers(): void {
  registerManualConfirmablePendingAbilityStarterHandler(
    ABILITY_ID,
    (game, ability, options, context) =>
      resolveLiveSuccess(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      ),
    getConfirmationConfig
  );
}

function getConfirmationConfig(
  game: GameState,
  ability: PendingAbilityState
): {
  readonly effectText: string;
  readonly stepText: string;
} {
  const evaluation = evaluateLiveSuccess(game, ability);
  const matchedColorText =
    evaluation.matchedColors.map((color) => HEART_COLOR_LABELS[color]).join('、') || '无';
  return {
    effectText: `${getAbilityEffectText(
      ability.abilityId
    )}（当前命中：${matchedColorText}，共${evaluation.matchedColorCount}种；${
      evaluation.conditionMet ? '满足条件，实际[スコア]+1' : '未满足条件，实际不增加[スコア]'
    }。）`,
    stepText: evaluation.conditionMet ? '确认后此卡[スコア]+1。' : '确认后此卡不增加[スコア]。',
  };
}

function resolveLiveSuccess(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const evaluation = evaluateLiveSuccess(game, ability);
  const stateWithoutPending = removePendingAbility(game, ability.id);
  const stateAfterScore = evaluation.sourceInLiveZone
    ? replaceScoreModifierAndRefresh(
        stateWithoutPending,
        ability,
        evaluation.conditionMet ? SCORE_BONUS : 0
      )
    : stateWithoutPending;

  return continuePendingCardEffects(
    addAction(stateAfterScore, 'RESOLVE_ABILITY', ability.controllerId, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: evaluation.conditionMet ? 'THREE_BLADE_HEART_COLORS_SCORE' : 'CONDITION_NOT_MET',
      sourceInLiveZone: evaluation.sourceInLiveZone,
      matchedHeartColors: evaluation.matchedColors,
      matchedHeartColorCount: evaluation.matchedColorCount,
      conditionMet: evaluation.conditionMet,
      scoreBonus: evaluation.conditionMet ? SCORE_BONUS : 0,
    }),
    orderedResolution
  );
}

function evaluateLiveSuccess(
  game: GameState,
  ability: Pick<PendingAbilityState, 'controllerId' | 'sourceCardId'>
): LiveSuccessEvaluation {
  const player = getPlayerById(game, ability.controllerId);
  const sourceCard = getCardById(game, ability.sourceCardId);
  const sourceInLiveZone =
    player !== null &&
    sourceCard !== null &&
    sourceCard.ownerId === player.id &&
    isLiveCardData(sourceCard.data) &&
    sourceCard.data.cardCode === EXACT_CARD_CODE &&
    player.liveZone.cardIds.includes(sourceCard.instanceId);
  const colorSet = sourceInLiveZone
    ? collectCurrentLiveRevealedCheerBladeHeartColors(game, ability.controllerId, {
        includedColors: COUNTED_HEART_COLORS,
      })
    : new Set<HeartColor>();
  const matchedColors = COUNTED_HEART_COLORS.filter((color) => colorSet.has(color));

  return {
    sourceInLiveZone,
    matchedColors,
    matchedColorCount: matchedColors.length,
    conditionMet: sourceInLiveZone && matchedColors.length >= REQUIRED_COLOR_COUNT,
  };
}

function replaceScoreModifierAndRefresh(
  game: GameState,
  ability: Pick<PendingAbilityState, 'abilityId' | 'controllerId' | 'sourceCardId'>,
  scoreBonus: number
): GameState {
  const matches = (modifier: LiveModifierState) =>
    modifier.kind === 'SCORE' &&
    modifier.playerId === ability.controllerId &&
    modifier.liveCardId === ability.sourceCardId &&
    modifier.sourceCardId === ability.sourceCardId &&
    modifier.abilityId === ability.abilityId;
  const previousScoreBonus = game.liveResolution.liveModifiers
    .filter(matches)
    .reduce((total, modifier) => total + (modifier.kind === 'SCORE' ? modifier.countDelta : 0), 0);
  const replacement: Extract<LiveModifierState, { readonly kind: 'SCORE' }> | null =
    scoreBonus > 0
      ? {
          kind: 'SCORE',
          playerId: ability.controllerId,
          countDelta: SCORE_BONUS,
          liveCardId: ability.sourceCardId,
          sourceCardId: ability.sourceCardId,
          abilityId: ability.abilityId,
        }
      : null;
  const state = replaceLiveModifier(
    game,
    {
      kind: 'SCORE',
      playerId: ability.controllerId,
      liveCardId: ability.sourceCardId,
      sourceCardId: ability.sourceCardId,
      abilityId: ability.abilityId,
    },
    replacement
  );
  const scoreDelta = scoreBonus - previousScoreBonus;
  if (scoreDelta === 0) {
    return state;
  }
  const playerScores = new Map(state.liveResolution.playerScores);
  playerScores.set(
    ability.controllerId,
    (playerScores.get(ability.controllerId) ?? 0) + scoreDelta
  );
  return {
    ...state,
    liveResolution: {
      ...state.liveResolution,
      playerScores,
    },
  };
}

function removePendingAbility(game: GameState, pendingAbilityId: string): GameState {
  return {
    ...game,
    pendingAbilities: game.pendingAbilities.filter(
      (candidate) => candidate.id !== pendingAbilityId
    ),
  };
}
