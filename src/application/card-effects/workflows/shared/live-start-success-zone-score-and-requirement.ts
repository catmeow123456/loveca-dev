import {
  addAction,
  getCardById,
  type GameState,
  type LiveRequirementModifierState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { replaceLiveModifier } from '../../../../domain/rules/live-modifiers.js';
import { countSuccessZoneCardsForCardEffect } from '../../../../domain/rules/success-zone-card-queries.js';
import { HeartColor, ZoneType } from '../../../../shared/types/enums.js';
import { cardCodeMatchesBase } from '../../../../shared/utils/card-code.js';
import { unitAliasIs, type CardSelector } from '../../../effects/card-selectors.js';
import { getCardIdsInZoneMatching } from '../../../effects/conditions.js';
import {
  HS_BP8_023_LIVE_START_EDELNOTE_SUCCESS_SCORE_REQUIREMENT_ABILITY_ID,
  PL_BP5_022_LIVE_START_SUCCESS_ZONE_SCORE_AND_REQUIREMENT_ABILITY_ID,
} from '../../ability-ids.js';
import { getPendingAbilitySourceLifecycleId } from '../../runtime/ability-source-lifecycle.js';
import { replaceSourceLiveCardScoreModifierAndRefresh } from '../../runtime/live-card-score.js';
import { isCurrentLiveCardAbilitySource } from '../../runtime/source-live.js';
import {
  getAbilityEffectText,
  registerManualConfirmablePendingAbilityStarterHandler,
} from '../../runtime/workflow-helpers.js';

interface Config {
  readonly abilityId: string;
  readonly sourceBaseCardCodes: readonly string[];
  readonly successCardSelector?: CardSelector;
  readonly scorePerCard: number;
  readonly requirementPerCard: readonly LiveRequirementModifierState[];
  readonly countLabel: string;
  readonly requirementLabel: string;
}
const CONFIGS: readonly Config[] = [
  {
    abilityId: PL_BP5_022_LIVE_START_SUCCESS_ZONE_SCORE_AND_REQUIREMENT_ABILITY_ID,
    sourceBaseCardCodes: ['PL!-bp5-022'],
    scorePerCard: 2,
    requirementPerCard: [
      HeartColor.PINK,
      HeartColor.YELLOW,
      HeartColor.PURPLE,
      HeartColor.RAINBOW,
    ].map((color) => ({ color, countDelta: 1 })),
    countLabel: '成功LIVE卡区的卡片',
    requirementLabel: '[桃ハート][黄ハート][紫ハート][無ハート]',
  },
  {
    abilityId: HS_BP8_023_LIVE_START_EDELNOTE_SUCCESS_SCORE_REQUIREMENT_ABILITY_ID,
    sourceBaseCardCodes: ['PL!HS-bp8-023'],
    successCardSelector: unitAliasIs('EdelNote'),
    scorePerCard: 3,
    requirementPerCard: [
      { color: HeartColor.PURPLE, countDelta: 3 },
      { color: HeartColor.RAINBOW, countDelta: 3 },
    ],
    countLabel: '成功LIVE卡区的Edel Note卡片',
    requirementLabel: '[紫ハート]×3、[無ハート]×3',
  },
];

function getContext(game: GameState, ability: PendingAbilityState, config: Config) {
  const source = getCardById(game, ability.sourceCardId);
  const sourceCurrent =
    !!source &&
    config.sourceBaseCardCodes.some((base) => cardCodeMatchesBase(source.data.cardCode, base)) &&
    isCurrentLiveCardAbilitySource(game, {
      ...ability,
      sourceLifecycleId: getPendingAbilitySourceLifecycleId(game, ability),
    });
  const matching = config.successCardSelector
    ? getCardIdsInZoneMatching(
        game,
        ability.controllerId,
        ZoneType.SUCCESS_ZONE,
        config.successCardSelector
      )
    : undefined;
  const count = countSuccessZoneCardsForCardEffect(
    game,
    ability.controllerId,
    ability.sourceCardId,
    matching
  );
  return {
    count,
    sourceCurrent,
    scoreBonus: sourceCurrent ? count * config.scorePerCard : 0,
    requirementModifiers: sourceCurrent
      ? config.requirementPerCard.map((modifier) => ({
          ...modifier,
          countDelta: modifier.countDelta * count,
        }))
      : [],
  };
}

export function registerLiveStartSuccessZoneScoreAndRequirementWorkflowHandlers(): void {
  for (const config of CONFIGS) {
    registerManualConfirmablePendingAbilityStarterHandler(
      config.abilityId,
      (game, ability, options, runtime) => {
        const evaluation = getContext(game, ability, config);
        let state = game;
        if (evaluation.sourceCurrent) {
          state = replaceSourceLiveCardScoreModifierAndRefresh(
            state,
            ability,
            evaluation.scoreBonus
          );
          state = replaceLiveModifier(
            state,
            {
              kind: 'REQUIREMENT',
              liveCardId: ability.sourceCardId,
              sourceCardId: ability.sourceCardId,
              abilityId: ability.abilityId,
            },
            evaluation.count > 0
              ? {
                  kind: 'REQUIREMENT',
                  liveCardId: ability.sourceCardId,
                  sourceCardId: ability.sourceCardId,
                  abilityId: ability.abilityId,
                  modifiers: evaluation.requirementModifiers,
                }
              : null
          );
        }
        state = {
          ...state,
          pendingAbilities: state.pendingAbilities.filter((item) => item.id !== ability.id),
        };
        return runtime.continuePendingCardEffects(
          addAction(state, 'RESOLVE_ABILITY', ability.controllerId, {
            pendingAbilityId: ability.id,
            abilityId: ability.abilityId,
            sourceCardId: ability.sourceCardId,
            step: 'APPLY_SUCCESS_ZONE_SCORE_AND_REQUIREMENT',
            ...evaluation,
          }),
          options.orderedResolution === true
        );
      },
      (game, ability) => {
        const evaluation = getContext(game, ability, config);
        return {
          effectText: `${getAbilityEffectText(config.abilityId)}（当前${config.countLabel}${evaluation.count}张；实际分数＋${evaluation.scoreBonus}，必要HEART增加（${config.requirementLabel}）×${evaluation.sourceCurrent ? evaluation.count : 0}。）`,
        };
      }
    );
  }
}
