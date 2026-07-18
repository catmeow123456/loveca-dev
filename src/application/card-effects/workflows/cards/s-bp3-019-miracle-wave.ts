import { isLiveCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  updateLiveResolution,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { getLiveCardScoreModifier, replaceLiveModifier } from '../../../../domain/rules/live-modifiers.js';
import { TriggerCondition } from '../../../../shared/types/enums.js';
import { hasBladeHeart } from '../../../effects/card-selectors.js';
import { getRemainingHeartTotalCount } from '../../../effects/remaining-hearts.js';
import { S_BP3_019_LIVE_SUCCESS_NO_NON_BLADE_CHEER_OR_TWO_REMAINING_HEART_SET_SCORE_ABILITY_ID } from '../../ability-ids.js';
import type { PendingAbilityStarterOptions } from '../../runtime/starter-registry.js';
import {
  getAbilityEffectText,
  registerManualConfirmablePendingAbilityStarterHandler,
} from '../../runtime/workflow-helpers.js';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerSBp3019MiracleWaveWorkflowHandlers(): void {
  registerManualConfirmablePendingAbilityStarterHandler(
    S_BP3_019_LIVE_SUCCESS_NO_NON_BLADE_CHEER_OR_TWO_REMAINING_HEART_SET_SCORE_ABILITY_ID,
    (game, ability, options, context) =>
      resolveMiracleWave(game, ability, options, context.continuePendingCardEffects),
    (game, ability) => {
      const evaluation = evaluateMiracleWave(game, ability);
      const preview = getPreviewText(evaluation);
      return { effectText: `${getAbilityEffectText(ability.abilityId)}（${preview}）`, stepText: preview };
    }
  );
}

function resolveMiracleWave(
  game: GameState,
  ability: PendingAbilityState,
  options: PendingAbilityStarterOptions,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const evaluation = evaluateMiracleWave(game, ability);
  let state: GameState = {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
  };

  if (evaluation.conditionMet && evaluation.sourceInLiveZone) {
    state = replaceLiveModifier(
      state,
      {
        kind: 'SCORE',
        playerId: ability.controllerId,
        liveCardId: ability.sourceCardId,
        sourceCardId: ability.sourceCardId,
        abilityId: ability.abilityId,
      },
      {
        kind: 'SCORE',
        playerId: ability.controllerId,
        countDelta: evaluation.desiredOwnModifierDelta,
        liveCardId: ability.sourceCardId,
        sourceCardId: ability.sourceCardId,
        abilityId: ability.abilityId,
      }
    );
    if (evaluation.scoreDelta !== 0) {
      state = updateLiveResolution(state, (liveResolution) => {
        const playerScores = new Map(liveResolution.playerScores);
        playerScores.set(
          ability.controllerId,
          (playerScores.get(ability.controllerId) ?? 0) + evaluation.scoreDelta
        );
        return { ...liveResolution, playerScores };
      });
    }
  }

  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', ability.controllerId, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: evaluation.conditionMet && evaluation.sourceInLiveZone ? 'SET_SCORE_TO_FOUR' : 'CONDITION_NOT_MET',
      revealedCheerCardCount: evaluation.revealedCheerCardCount,
      nonBladeHeartCardCount: evaluation.nonBladeHeartCardCount,
      remainingHeartCount: evaluation.remainingHeartCount,
      previousCardScore: evaluation.currentCardScore,
      nextCardScore: evaluation.conditionMet && evaluation.sourceInLiveZone ? 4 : evaluation.currentCardScore,
      scoreDelta: evaluation.scoreDelta,
    }),
    options.orderedResolution === true
  );
}

function evaluateMiracleWave(
  game: GameState,
  ability: Pick<PendingAbilityState, 'abilityId' | 'controllerId' | 'sourceCardId'>
) {
  const player = getPlayerById(game, ability.controllerId);
  const source = getCardById(game, ability.sourceCardId);
  const sourceInLiveZone = player?.liveZone.cardIds.includes(ability.sourceCardId) === true;
  const revealedCardIds: string[] = [];
  const seen = new Set<string>();
  for (const { event } of getCurrentTurnEventEntries(game)) {
    if (
      event.eventType !== TriggerCondition.ON_CHEER ||
      !('playerId' in event) ||
      event.playerId !== ability.controllerId ||
      !('revealedCardIds' in event) ||
      !Array.isArray(event.revealedCardIds)
    ) {
      continue;
    }
    for (const cardId of event.revealedCardIds) {
      if (!seen.has(cardId) && getCardById(game, cardId)?.ownerId === ability.controllerId) {
        seen.add(cardId);
        revealedCardIds.push(cardId);
      }
    }
  }
  const nonBladeHeartCardCount = revealedCardIds.filter((cardId) => {
    const card = getCardById(game, cardId);
    return card !== null && !hasBladeHeart()(card);
  }).length;
  const remainingHeartCount = getRemainingHeartTotalCount(game, ability.controllerId);
  const conditionMet = nonBladeHeartCardCount === 0 || remainingHeartCount >= 2;
  const printedScore = source && isLiveCardData(source.data) ? source.data.score : 0;
  const totalModifier = getLiveCardScoreModifier(game.liveResolution, ability.sourceCardId);
  const ownModifiers = game.liveResolution.liveModifiers.filter(
    (modifier) =>
      modifier.kind === 'SCORE' &&
      modifier.playerId === ability.controllerId &&
      modifier.liveCardId === ability.sourceCardId &&
      modifier.sourceCardId === ability.sourceCardId &&
      modifier.abilityId === ability.abilityId
  );
  const existingOwnModifierDelta = ownModifiers.reduce(
    (sum, modifier) => sum + (modifier.kind === 'SCORE' ? modifier.countDelta : 0),
    0
  );
  const otherModifierDelta = totalModifier - existingOwnModifierDelta;
  const currentCardScore = printedScore + totalModifier;
  const desiredOwnModifierDelta = 4 - printedScore - otherModifierDelta;
  return {
    sourceInLiveZone,
    revealedCheerCardCount: revealedCardIds.length,
    nonBladeHeartCardCount,
    remainingHeartCount,
    conditionMet,
    currentCardScore,
    desiredOwnModifierDelta,
    scoreDelta: conditionMet && sourceInLiveZone ? 4 - currentCardScore : 0,
  };
}

function getCurrentTurnEventEntries(game: GameState): GameState['eventLog'] {
  for (let index = game.eventLog.length - 1; index >= 0; index -= 1) {
    if (game.eventLog[index]?.event.eventType === TriggerCondition.ON_TURN_START) {
      return game.eventLog.slice(index + 1);
    }
  }
  for (let index = game.eventLog.length - 1; index >= 0; index -= 1) {
    if (game.eventLog[index]?.event.eventType === TriggerCondition.ON_TURN_END) {
      return game.eventLog.slice(index + 1);
    }
  }
  return game.eventLog;
}

function getPreviewText(evaluation: ReturnType<typeof evaluateMiracleWave>): string {
  const cheerConditionMet = evaluation.nonBladeHeartCardCount === 0;
  const remainingHeartConditionMet = evaluation.remainingHeartCount >= 2;
  const result = evaluation.sourceInLiveZone && evaluation.conditionMet
    ? `此卡当前分数为${evaluation.currentCardScore}，结算后变为4`
    : `此卡当前分数为${evaluation.currentCardScore}，结算后分数不变`;
  return `本回合声援公开${evaluation.revealedCheerCardCount}张卡，其中未持有BLADE HEART的卡为${evaluation.nonBladeHeartCardCount}张（${cheerConditionMet ? '满足' : '未满足'}条件）；当前剩余Heart为${evaluation.remainingHeartCount}个（${remainingHeartConditionMet ? '满足' : '未满足'}条件）；${result}。`;
}
