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
import { cardCodeMatchesBase } from '../../../../shared/utils/card-code.js';
import { cardBelongsToGroup } from '../../../../shared/utils/card-identity.js';
import { selectCurrentLiveDifferentNamedStageAndCheerMembers } from '../../../effects/cheer-selection.js';
import {
  PL_PB2_039_LIVE_START_SUCCESS_MUSE_TWO_CHEER_TEN_ABILITY_ID,
  PL_PB2_039_LIVE_SUCCESS_DISTINCT_MUSE_STAGE_CHEER_SCORE_ABILITY_ID,
} from '../../ability-ids.js';
import {
  getAbilityEffectText,
  registerManualConfirmablePendingAbilityStarterHandler,
} from '../../runtime/workflow-helpers.js';
import { registerLiveStartCheerCountWorkflowHandlers } from '../shared/live-start-cheer-count.js';

const BASE_CARD_CODE = 'PL!-pb2-039';
const LIVE_START_ABILITY_ID = PL_PB2_039_LIVE_START_SUCCESS_MUSE_TWO_CHEER_TEN_ABILITY_ID;
const LIVE_SUCCESS_ABILITY_ID = PL_PB2_039_LIVE_SUCCESS_DISTINCT_MUSE_STAGE_CHEER_SCORE_ABILITY_ID;

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerPlPb2039BokutachiWaHitotsuNoHikariWorkflowHandlers(): void {
  registerLiveStartCheerCountWorkflowHandlers([
    {
      abilityId: LIVE_START_ABILITY_ID,
      countDelta: 10,
      actionStep: 'SUCCESS_MUSE_TWO_CHEER_COUNT_PLUS_TEN',
      getContext: getLiveStartContext,
      getConfirmationEffectText: (_game, ability, context) => {
        const successMuseCount = numberValue(context.metadata?.successMuseCount);
        return `${getAbilityEffectText(ability.abilityId)}（当前成功LIVE卡区有${successMuseCount}张『μ’s』卡，${
          context.conditionMet ? '满足条件，实际声援张数增加10张' : '未满足条件，实际声援张数不变'
        }。）`;
      },
    },
  ]);
  registerManualConfirmablePendingAbilityStarterHandler(
    LIVE_SUCCESS_ABILITY_ID,
    (game, ability, options, context) =>
      resolveLiveSuccessScore(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      ),
    (game, ability) => {
      const evaluation = getLiveSuccessContext(game, ability);
      return {
        effectText: `${getAbilityEffectText(ability.abilityId)}（当前舞台与本次声援中共有${
          evaluation.differentNameCount
        }名不同名称的『μ’s』成员，实际此LIVE[スコア]+${evaluation.scoreBonus}。）`,
        stepText: '确认后结算此效果。',
      };
    }
  );
}

function getLiveStartContext(game: GameState, ability: PendingAbilityState) {
  const player = getPlayerById(game, ability.controllerId);
  const sourceInLiveZone = isValidSourceLive(game, ability.controllerId, ability.sourceCardId);
  const successMuseCardIds =
    player?.successZone.cardIds.filter((cardId) => {
      const card = getCardById(game, cardId);
      return card !== null && card.ownerId === player.id && cardBelongsToGroup(card.data, "μ's");
    }) ?? [];
  return {
    conditionMet: sourceInLiveZone && successMuseCardIds.length >= 2,
    metadata: {
      sourceInLiveZone,
      successMuseCardIds,
      successMuseCount: successMuseCardIds.length,
    },
  };
}

function resolveLiveSuccessScore(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const evaluation = getLiveSuccessContext(game, ability);
  const previousScoreBonus = getExistingScoreBonus(game, ability);
  const replacement: LiveModifierState | null =
    evaluation.scoreBonus > 0
      ? {
          kind: 'SCORE',
          playerId: ability.controllerId,
          countDelta: evaluation.scoreBonus,
          liveCardId: ability.sourceCardId,
          sourceCardId: ability.sourceCardId,
          abilityId: ability.abilityId,
        }
      : null;
  let state = replaceLiveModifier(
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
  state = refreshPlayerScoreDraft(
    state,
    ability.controllerId,
    evaluation.scoreBonus - previousScoreBonus
  );
  state = {
    ...state,
    pendingAbilities: state.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
  };

  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', ability.controllerId, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: 'DISTINCT_MUSE_STAGE_AND_CHEER_SCORE',
      sourceInLiveZone: evaluation.sourceInLiveZone,
      candidateCardIds: evaluation.candidateCardIds,
      selectedCardIds: evaluation.selectedCardIds,
      normalizedNames: evaluation.normalizedNames,
      differentNameCount: evaluation.differentNameCount,
      scoreBonus: evaluation.scoreBonus,
    }),
    orderedResolution
  );
}

function getLiveSuccessContext(game: GameState, ability: PendingAbilityState) {
  const sourceInLiveZone = isValidSourceLive(game, ability.controllerId, ability.sourceCardId);
  const names = selectCurrentLiveDifferentNamedStageAndCheerMembers(
    game,
    ability.controllerId,
    "μ's"
  );
  return {
    ...names,
    sourceInLiveZone,
    scoreBonus: sourceInLiveZone ? names.differentNameCount : 0,
  };
}

function isValidSourceLive(game: GameState, playerId: string, sourceCardId: string): boolean {
  const player = getPlayerById(game, playerId);
  const source = getCardById(game, sourceCardId);
  return Boolean(
    player &&
    source &&
    source.ownerId === playerId &&
    isLiveCardData(source.data) &&
    cardCodeMatchesBase(source.data.cardCode, BASE_CARD_CODE) &&
    player.liveZone.cardIds.includes(sourceCardId)
  );
}

function getExistingScoreBonus(game: GameState, ability: PendingAbilityState): number {
  return game.liveResolution.liveModifiers
    .filter(
      (modifier) =>
        modifier.kind === 'SCORE' &&
        modifier.playerId === ability.controllerId &&
        modifier.liveCardId === ability.sourceCardId &&
        modifier.sourceCardId === ability.sourceCardId &&
        modifier.abilityId === ability.abilityId
    )
    .reduce((total, modifier) => total + (modifier.kind === 'SCORE' ? modifier.countDelta : 0), 0);
}

function refreshPlayerScoreDraft(game: GameState, playerId: string, scoreDelta: number): GameState {
  if (scoreDelta === 0) {
    return game;
  }
  const playerScores = new Map(game.liveResolution.playerScores);
  playerScores.set(playerId, (playerScores.get(playerId) ?? 0) + scoreDelta);
  return {
    ...game,
    liveResolution: {
      ...game.liveResolution,
      playerScores,
    },
  };
}

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}
