import {
  addAction,
  getCardById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { BladeHeartEffect, HeartColor } from '../../../../shared/types/enums.js';
import { cardCodeMatchesBase } from '../../../../shared/utils/card-code.js';
import {
  selectCurrentLiveRevealedCheerCardIdsWithoutBladeHearts,
  selectCurrentLiveRevealedCheerCardsWithEffectiveBladeHearts,
} from '../../../effects/cheer-selection.js';
import {
  PL_BP8_022_LIVE_SUCCESS_FIVE_YELLOW_CHEER_THIS_LIVE_SCORE_ABILITY_ID,
  PL_BP8_023_LIVE_SUCCESS_SIX_ORANGE_CHEER_SCORE_ABILITY_ID,
  PYHN_AD2_001_LIVE_SUCCESS_TWO_NO_BLADE_CHEER_THIS_LIVE_SCORE_ABILITY_ID,
} from '../../ability-ids.js';
import { getPendingAbilitySourceLifecycleId } from '../../runtime/ability-source-lifecycle.js';
import { replaceSourceLiveCardScoreModifierAndRefresh } from '../../runtime/live-card-score.js';
import { isCurrentLiveCardAbilitySource } from '../../runtime/source-live.js';
import {
  getAbilityEffectText,
  registerManualConfirmablePendingAbilityStarterHandler,
} from '../../runtime/workflow-helpers.js';

type CheerScoreCondition =
  | { readonly kind: 'HEART_COLOR'; readonly color: HeartColor }
  | { readonly kind: 'NO_BLADE_HEART' };

interface CheerSourceScoreConfig {
  readonly abilityId: string;
  readonly baseCardCode: string;
  readonly condition: CheerScoreCondition;
  readonly minCount: number;
  readonly countDescription: string;
  readonly scoreBonus: number;
}

const CONFIGS: readonly CheerSourceScoreConfig[] = [
  {
    abilityId: PL_BP8_022_LIVE_SUCCESS_FIVE_YELLOW_CHEER_THIS_LIVE_SCORE_ABILITY_ID,
    baseCardCode: 'PL!-bp8-022',
    condition: { kind: 'HEART_COLOR', color: HeartColor.YELLOW },
    minCount: 5,
    countDescription: '持有[黄ブレード]的卡片',
    scoreBonus: 1,
  },
  {
    abilityId: PYHN_AD2_001_LIVE_SUCCESS_TWO_NO_BLADE_CHEER_THIS_LIVE_SCORE_ABILITY_ID,
    baseCardCode: 'PYHN-ad2-001',
    condition: { kind: 'NO_BLADE_HEART' },
    minCount: 2,
    countDescription: '不持有BLADE HEART的卡片',
    scoreBonus: 1,
  },
  {
    abilityId: PL_BP8_023_LIVE_SUCCESS_SIX_ORANGE_CHEER_SCORE_ABILITY_ID,
    baseCardCode: 'PL!-bp8-023',
    condition: { kind: 'HEART_COLOR', color: HeartColor.ORANGE },
    minCount: 6,
    countDescription: '持有[オレンジブレード]的卡片',
    scoreBonus: 2,
  },
];

function evaluate(game: GameState, ability: PendingAbilityState, config: CheerSourceScoreConfig) {
  const sourceLifecycleId = getPendingAbilitySourceLifecycleId(game, ability);
  const source = getCardById(game, ability.sourceCardId);
  const sourceValid =
    source !== null &&
    cardCodeMatchesBase(source.data.cardCode, config.baseCardCode) &&
    isCurrentLiveCardAbilitySource(game, { ...ability, sourceLifecycleId });
  const condition = config.condition;
  const matchingCardIds =
    condition.kind === 'NO_BLADE_HEART'
      ? selectCurrentLiveRevealedCheerCardIdsWithoutBladeHearts(game, ability.controllerId)
      : selectCurrentLiveRevealedCheerCardsWithEffectiveBladeHearts(game, ability.controllerId)
          .filter(({ effectiveBladeHearts }) =>
            effectiveBladeHearts.some(
              (heart) =>
                heart.effect === BladeHeartEffect.HEART && heart.heartColor === condition.color
            )
          )
          .map(({ cardId }) => cardId);
  const conditionMet = matchingCardIds.length >= config.minCount;
  return {
    sourceLifecycleId,
    sourceValid,
    matchingCardIds,
    conditionMet,
    scoreBonus: sourceValid && conditionMet ? config.scoreBonus : 0,
  };
}

export function registerLiveSuccessCheerConditionSourceScoreWorkflowHandlers(): void {
  for (const config of CONFIGS) {
    registerManualConfirmablePendingAbilityStarterHandler(
      config.abilityId,
      (game, ability, options, runtime) => {
        const result = evaluate(game, ability, config);
        let state: GameState = {
          ...game,
          pendingAbilities: game.pendingAbilities.filter((pending) => pending.id !== ability.id),
        };
        if (result.sourceValid) {
          state = replaceSourceLiveCardScoreModifierAndRefresh(state, ability, result.scoreBonus);
        }
        return runtime.continuePendingCardEffects(
          addAction(state, 'RESOLVE_ABILITY', ability.controllerId, {
            pendingAbilityId: ability.id,
            abilityId: ability.abilityId,
            sourceCardId: ability.sourceCardId,
            sourceLifecycleId: result.sourceLifecycleId,
            step: 'CHEER_CONDITION_SOURCE_LIVE_SCORE',
            matchingCardIds: result.matchingCardIds,
            matchingCount: result.matchingCardIds.length,
            conditionMet: result.conditionMet,
            scoreBonus: result.scoreBonus,
          }),
          options.orderedResolution === true
        );
      },
      (game, ability) => {
        const result = evaluate(game, ability, config);
        return {
          effectText: `${getAbilityEffectText(config.abilityId)}（本次声援公开的${config.countDescription}有${result.matchingCardIds.length}张；条件${result.conditionMet ? '满足' : '未满足'}；此卡实际分数＋${result.scoreBonus}。）`,
          stepText: '确认后按当前声援公开的卡片结算分数。',
        };
      }
    );
  }
}
