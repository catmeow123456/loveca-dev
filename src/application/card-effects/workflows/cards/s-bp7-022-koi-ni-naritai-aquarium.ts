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
import { CardType, HeartColor } from '../../../../shared/types/enums.js';
import { evaluateDistinctCheerCardsCoverHeartColors } from '../../../effects/cheer-selection.js';
import { S_BP7_022_LIVE_SUCCESS_DISTINCT_AQOURS_RED_GREEN_BLUE_CHEER_SCORE_ABILITY_ID } from '../../ability-ids.js';
import type { PendingAbilityStarterOptions } from '../../runtime/starter-registry.js';
import {
  getAbilityEffectText,
  registerManualConfirmablePendingAbilityStarterHandler,
} from '../../runtime/workflow-helpers.js';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

const ABILITY_ID =
  S_BP7_022_LIVE_SUCCESS_DISTINCT_AQOURS_RED_GREEN_BLUE_CHEER_SCORE_ABILITY_ID;
const EXACT_CARD_CODE = 'PL!S-bp7-022-SECL';
const REQUIRED_COLORS = [HeartColor.RED, HeartColor.GREEN, HeartColor.BLUE] as const;

export function registerSBp7022KoiNiNaritaiAquariumWorkflowHandlers(): void {
  registerManualConfirmablePendingAbilityStarterHandler(
    ABILITY_ID,
    (game, ability, options, context) =>
      resolveKoiNiNaritaiAquarium(
        game,
        ability,
        options,
        context.continuePendingCardEffects
    ),
    (game, ability) => {
      const { cheerEvaluation: evaluation, scoreBonus } = evaluateResolution(game, ability);
      const redCount = evaluation.candidateCountsByColor.get(HeartColor.RED) ?? 0;
      const greenCount = evaluation.candidateCountsByColor.get(HeartColor.GREEN) ?? 0;
      const blueCount = evaluation.candidateCountsByColor.get(HeartColor.BLUE) ?? 0;
      return {
        effectText: `${getAbilityEffectText(ability.abilityId)}（当前持有[赤ハート]的『Aqours』成员候选${redCount}张，持有[緑ハート]的候选${greenCount}张，持有[青ハート]的候选${blueCount}张；需要三张不同卡，${
          scoreBonus > 0
            ? '可完成匹配，实际此LIVE[スコア]+1。'
            : evaluation.conditionMet
              ? '可完成匹配，但本次实际不增加[スコア]。'
              : '无法完成匹配，本次实际不增加[スコア]。'
        }）`,
        stepText: '确认后结算此效果。',
      };
    }
  );
}

function resolveKoiNiNaritaiAquarium(
  game: GameState,
  ability: PendingAbilityState,
  options: PendingAbilityStarterOptions,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const { cheerEvaluation: evaluation, scoreBonus } = evaluateResolution(game, ability);
  const previousScoreBonus = getExistingScoreBonus(game, ability);
  const replacement: LiveModifierState | null =
    scoreBonus > 0
      ? {
          kind: 'SCORE',
          playerId: ability.controllerId,
          countDelta: scoreBonus,
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
  state = refreshPlayerScoreDraft(state, ability.controllerId, scoreBonus - previousScoreBonus);
  state = addAction(
    {
      ...state,
      pendingAbilities: state.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
    },
    'RESOLVE_ABILITY',
    ability.controllerId,
    {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: 'DISTINCT_AQOURS_RED_GREEN_BLUE_CHEER_SCORE',
      redCandidateCount: evaluation.candidateCountsByColor.get(HeartColor.RED) ?? 0,
      greenCandidateCount: evaluation.candidateCountsByColor.get(HeartColor.GREEN) ?? 0,
      blueCandidateCount: evaluation.candidateCountsByColor.get(HeartColor.BLUE) ?? 0,
      conditionMet: scoreBonus > 0,
      assignment: scoreBonus > 0 ? evaluation.assignment : [],
      matchedCardIds: scoreBonus > 0 ? evaluation.matchedCardIds : [],
      scoreBonus,
    }
  );
  return continuePendingCardEffects(state, options.orderedResolution === true);
}

function evaluateResolution(game: GameState, ability: PendingAbilityState) {
  const cheerEvaluation = evaluateCondition(game, ability.controllerId);
  const player = getPlayerById(game, ability.controllerId);
  const sourceValid =
    player !== null && isValidSourceLive(game, player.id, ability.sourceCardId);
  return {
    cheerEvaluation,
    scoreBonus: sourceValid && cheerEvaluation.conditionMet ? 1 : 0,
  } as const;
}

function evaluateCondition(game: GameState, playerId: string) {
  return evaluateDistinctCheerCardsCoverHeartColors(game, playerId, {
    requiredColors: REQUIRED_COLORS,
    groupAlias: 'Aqours',
    cardType: CardType.MEMBER,
  });
}

function isValidSourceLive(game: GameState, playerId: string, sourceCardId: string): boolean {
  const player = getPlayerById(game, playerId);
  const source = getCardById(game, sourceCardId);
  return (
    player !== null &&
    source !== null &&
    source.ownerId === playerId &&
    isLiveCardData(source.data) &&
    source.data.cardCode === EXACT_CARD_CODE &&
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
