import {
  addAction,
  getOpponent,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { addLiveModifier } from '../../../../domain/rules/live-modifiers.js';
import { CardType } from '../../../../shared/types/enums.js';
import type { CardInstance } from '../../../../domain/entities/card.js';
import { selectCurrentLiveRevealedCheerCardsWithEffectiveBladeHearts } from '../../../effects/cheer-selection.js';
import {
  N_BP8_010_LIVE_SUCCESS_THREE_NO_BLADE_HEART_NIJIGASAKI_CHEER_SCORE_ABILITY_ID,
  SP_PR_035_LIVE_SUCCESS_OPPONENT_TWELVE_CHEER_SCORE_ABILITY_ID,
} from '../../ability-ids.js';
import {
  getAbilityEffectText,
  registerManualConfirmablePendingAbilityStarterHandler,
} from '../../runtime/workflow-helpers.js';

interface CheerThresholdScoreConfig {
  readonly abilityId: string;
  readonly subject: 'SELF' | 'OPPONENT';
  readonly minCount: number;
  readonly noBladeHeartNijigasakiMembers: boolean;
  readonly countDescription: string;
}
const CONFIGS: readonly CheerThresholdScoreConfig[] = [
  {
    abilityId: N_BP8_010_LIVE_SUCCESS_THREE_NO_BLADE_HEART_NIJIGASAKI_CHEER_SCORE_ABILITY_ID,
    subject: 'SELF',
    minCount: 3,
    noBladeHeartNijigasakiMembers: true,
    countDescription: '自己声援公开的不持有BLADE HEART的『虹咲』成员',
  },
  {
    abilityId: SP_PR_035_LIVE_SUCCESS_OPPONENT_TWELVE_CHEER_SCORE_ABILITY_ID,
    subject: 'OPPONENT',
    minCount: 12,
    noBladeHeartNijigasakiMembers: false,
    countDescription: '对方声援公开的卡片',
  },
];

/** Empty or absent lists mean no Blade Hearts; null and other invalid domain values do not. */
function hasValidBladeHeartList(card: CardInstance): boolean {
  const bladeHearts = 'bladeHearts' in card.data ? card.data.bladeHearts : undefined;
  return bladeHearts === undefined || Array.isArray(bladeHearts);
}

function getContext(
  game: GameState,
  ability: PendingAbilityState,
  config: CheerThresholdScoreConfig
) {
  const playerId =
    config.subject === 'SELF' ? ability.controllerId : getOpponent(game, ability.controllerId)?.id;
  const matchingCardIds = playerId
    ? selectCurrentLiveRevealedCheerCardsWithEffectiveBladeHearts(
        game,
        playerId,
        config.noBladeHeartNijigasakiMembers
          ? { cardTypes: CardType.MEMBER, groupAliases: ['虹ヶ咲'] }
          : {}
      )
        .filter(
          ({ card, effectiveBladeHearts }) =>
            !config.noBladeHeartNijigasakiMembers ||
            (hasValidBladeHeartList(card) && effectiveBladeHearts.length === 0)
        )
        .map(({ cardId }) => cardId)
    : [];
  return { matchingCardIds, conditionMet: matchingCardIds.length >= config.minCount };
}

export function registerLiveSuccessRevealedCheerThresholdScoreWorkflowHandlers(): void {
  for (const config of CONFIGS) {
    registerManualConfirmablePendingAbilityStarterHandler(
      config.abilityId,
      (game, ability, options, runtime) => {
        const context = getContext(game, ability, config);
        let state: GameState = {
          ...game,
          pendingAbilities: game.pendingAbilities.filter((pending) => pending.id !== ability.id),
        };
        if (context.conditionMet) {
          state = addLiveModifier(state, {
            kind: 'SCORE',
            playerId: ability.controllerId,
            countDelta: 1,
            sourceCardId: ability.sourceCardId,
            abilityId: ability.abilityId,
          });
          const scores = new Map(state.liveResolution.playerScores);
          scores.set(ability.controllerId, (scores.get(ability.controllerId) ?? 0) + 1);
          state = { ...state, liveResolution: { ...state.liveResolution, playerScores: scores } };
        }
        return runtime.continuePendingCardEffects(
          addAction(state, 'RESOLVE_ABILITY', ability.controllerId, {
            pendingAbilityId: ability.id,
            abilityId: ability.abilityId,
            sourceCardId: ability.sourceCardId,
            step: 'REVEALED_CHEER_THRESHOLD_TOTAL_SCORE',
            matchingCardIds: context.matchingCardIds,
            subject: config.subject,
            conditionMet: context.conditionMet,
            scoreBonus: Number(context.conditionMet),
          }),
          options.orderedResolution === true
        );
      },
      (game, ability) => {
        const context = getContext(game, ability, config);
        return {
          effectText: `${getAbilityEffectText(ability.abilityId)}（当前${config.countDescription}${context.matchingCardIds.length}张；条件${context.conditionMet ? '满足' : '未满足'}；实际LIVE合计分数＋${Number(context.conditionMet)}。）`,
        };
      }
    );
  }
}
