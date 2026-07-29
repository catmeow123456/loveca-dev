import type { GameEndReason } from '../../shared/types/enums.js';
import type { Seat } from '../../online/index.js';
import {
  AI_BATTLE_PHASE_ZERO_CERTIFICATION_VERSIONS,
  type AiBattlePhaseZeroDeckKey,
} from './phase-zero-baseline.js';
import type {
  AiStrategyDecisionRecord,
  AiStrategyDecisionAudit,
} from './strategy-decision-audit.js';

export const AI_STRATEGY_EVALUATION_SCHEMA_VERSION = 'ai-battle.strategy-evaluation/v1' as const;

export interface AiStrategyEvaluationGame {
  readonly scenarioId: string;
  readonly seed: string;
  readonly completed: boolean;
  readonly endReason: GameEndReason | null;
  readonly winnerSeat: Seat | null;
  readonly winnerDeckKey: AiBattlePhaseZeroDeckKey | null;
  readonly turnCount: number;
  readonly decisionCount: number;
  readonly historyContextDecisionCount: number;
  readonly records: readonly AiStrategyDecisionRecord[];
  readonly failureReason?: string;
}

export interface AiStrategyEvaluationSummary {
  readonly schemaVersion: typeof AI_STRATEGY_EVALUATION_SCHEMA_VERSION;
  readonly matchupMatrixVersion: (typeof AI_BATTLE_PHASE_ZERO_CERTIFICATION_VERSIONS)['matchupMatrixVersion'];
  readonly gameCount: number;
  readonly completedGameCount: number;
  readonly completionRate: number;
  readonly failedGameCount: number;
  readonly totalDecisionCount: number;
  readonly acceptedDecisionCount: number;
  readonly rejectedDecisionCount: number;
  readonly historyContextDecisionCount: number;
  readonly historyContextCoverageRate: number;
  readonly tierCounts: Readonly<Record<'RULE_FORCED' | 'DETERMINISTIC' | 'HEURISTIC', number>>;
  readonly decisionKindCounts: Readonly<Record<string, number>>;
  readonly reasonCodeCounts: Readonly<Record<string, number>>;
  readonly quality: {
    readonly stageDevelopmentGames: number;
    readonly liveSetGames: number;
    readonly successLiveSelectionGames: number;
    readonly gamesWithAllStrategyTiers: number;
    readonly averageTurns: number;
    readonly averageDecisions: number;
    readonly maxTurns: number;
    readonly maxDecisions: number;
    readonly winsByDeck: Readonly<Record<AiBattlePhaseZeroDeckKey, number>>;
  };
}

export function summarizeAiStrategyEvaluation(
  games: readonly AiStrategyEvaluationGame[]
): AiStrategyEvaluationSummary {
  const records = games.flatMap((game) => game.records);
  const audits = records.map((record) => record.decisionAudit);
  const completedGameCount = games.filter((game) => game.completed).length;
  const historyContextDecisionCount = games.reduce(
    (sum, game) => sum + game.historyContextDecisionCount,
    0
  );
  const winsByDeck: Record<AiBattlePhaseZeroDeckKey, number> = {
    MUSE_STARTER: 0,
    GREEN_HASUNOSORA_B6: 0,
  };
  for (const game of games) {
    if (game.winnerDeckKey) winsByDeck[game.winnerDeckKey] += 1;
  }

  return {
    schemaVersion: AI_STRATEGY_EVALUATION_SCHEMA_VERSION,
    matchupMatrixVersion: AI_BATTLE_PHASE_ZERO_CERTIFICATION_VERSIONS.matchupMatrixVersion,
    gameCount: games.length,
    completedGameCount,
    completionRate: rate(completedGameCount, games.length),
    failedGameCount: games.length - completedGameCount,
    totalDecisionCount: records.length,
    acceptedDecisionCount: records.filter((record) => record.execution.status === 'ACCEPTED')
      .length,
    rejectedDecisionCount: records.filter((record) => record.execution.status === 'REJECTED')
      .length,
    historyContextDecisionCount,
    historyContextCoverageRate: rate(historyContextDecisionCount, records.length),
    tierCounts: {
      RULE_FORCED: count(audits, (audit) => audit.tier === 'RULE_FORCED'),
      DETERMINISTIC: count(audits, (audit) => audit.tier === 'DETERMINISTIC'),
      HEURISTIC: count(audits, (audit) => audit.tier === 'HEURISTIC'),
    },
    decisionKindCounts: countBy(audits, (audit) => audit.decisionKind),
    reasonCodeCounts: countBy(audits, (audit) => audit.reasonCode),
    quality: {
      stageDevelopmentGames: countGamesWithReason(games, 'PLAY_HIGHEST_RANKED_MEMBER'),
      liveSetGames: countGamesWithReason(games, 'SET_HIGHEST_RANKED_LIVE'),
      successLiveSelectionGames: countGamesWithReason(games, 'SELECT_HIGHEST_SCORE_SUCCESS_LIVE'),
      gamesWithAllStrategyTiers: games.filter((game) => {
        const tiers = new Set(game.records.map((record) => record.decisionAudit.tier));
        return tiers.has('RULE_FORCED') && tiers.has('DETERMINISTIC') && tiers.has('HEURISTIC');
      }).length,
      averageTurns: average(games.map((game) => game.turnCount)),
      averageDecisions: average(games.map((game) => game.decisionCount)),
      maxTurns: maximum(games.map((game) => game.turnCount)),
      maxDecisions: maximum(games.map((game) => game.decisionCount)),
      winsByDeck,
    },
  };
}

function countGamesWithReason(
  games: readonly AiStrategyEvaluationGame[],
  reasonCode: string
): number {
  return games.filter((game) =>
    game.records.some((record) => record.decisionAudit.reasonCode === reasonCode)
  ).length;
}

function count(
  audits: readonly AiStrategyDecisionAudit[],
  predicate: (audit: AiStrategyDecisionAudit) => boolean
): number {
  return audits.filter(predicate).length;
}

function countBy<T>(
  items: readonly T[],
  keyOf: (item: T) => string
): Readonly<Record<string, number>> {
  const result: Record<string, number> = {};
  for (const item of items) {
    const key = keyOf(item);
    result[key] = (result[key] ?? 0) + 1;
  }
  return result;
}

function rate(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

function average(values: readonly number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function maximum(values: readonly number[]): number {
  return values.length === 0 ? 0 : Math.max(...values);
}
