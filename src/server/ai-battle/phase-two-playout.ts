import {
  buildAiDecisionContract,
  materializeAiDecisionCommand,
  validateAiDecisionSelection,
  type AiDecisionContractHandle,
} from '../../application/ai-decisions/index.js';
import { createGameSession } from '../../application/game-session.js';
import type { DeckConfig } from '../../application/game-service.js';
import type { GameState } from '../../domain/entities/game.js';
import { createSeededRuleRandomSource } from '../../domain/rules/rule-random.js';
import { projectPlayerViewState, type Seat } from '../../online/index.js';
import { buildAiObservation } from './ai-observation.js';
import { selectExplainableDecision } from './explainable-decision-policy.js';
import {
  AI_BATTLE_HEADLESS_ACCEPTANCE_LIMITS,
  AI_BATTLE_PHASE_ZERO_DECKS,
  type AiBattlePhaseZeroDeckKey,
} from './phase-zero-baseline.js';
import { buildAiStrategyContext } from './strategy-context.js';
import {
  createAiStrategyDecisionAudit,
  createAiStrategyDecisionRecord,
  createInMemoryAiStrategyDecisionRecordStore,
} from './strategy-decision-audit.js';
import type { AiStrategyEvaluationGame } from './strategy-evaluation.js';
import {
  createAiSelectedHistoryTracker,
  type AiSelectedHistoryTracker,
} from './strategy-history.js';

export const AI_PHASE_TWO_PLAYOUT_SCHEMA_VERSION = 'ai-battle.phase-two-playout/v1' as const;

export interface AiPhaseTwoPlayoutSeat {
  readonly playerId: string;
  readonly playerName: string;
  readonly deckKey: AiBattlePhaseZeroDeckKey;
  readonly deck: DeckConfig;
}

export interface AiPhaseTwoPlayoutInput {
  readonly scenarioId: string;
  readonly seed: string;
  readonly firstPlayer: AiPhaseTwoPlayoutSeat;
  readonly secondPlayer: AiPhaseTwoPlayoutSeat;
  readonly limits?: {
    readonly maxTurnsPerGame: number;
    readonly maxDecisionsPerGame: number;
    readonly maxWallClockMsPerGame: number;
  };
}

interface RuntimeSeat {
  readonly seat: Seat;
  readonly player: AiPhaseTwoPlayoutSeat;
  readonly history: AiSelectedHistoryTracker;
}

export function runAiPhaseTwoExplainablePlayout(
  input: AiPhaseTwoPlayoutInput
): AiStrategyEvaluationGame {
  const limits = input.limits ?? AI_BATTLE_HEADLESS_ACCEPTANCE_LIMITS;
  const startedAt = Date.now();
  const recordStore = createInMemoryAiStrategyDecisionRecordStore();
  let now = 1_000;
  let authorityRevision = 0;
  let decisionCount = 0;
  let historyContextDecisionCount = 0;
  const session = createGameSession({
    now: () => now,
    ruleRandomSource: createSeededRuleRandomSource(`phase-two-rules:${input.seed}`),
  });
  const seats: readonly RuntimeSeat[] = [
    {
      seat: 'FIRST',
      player: input.firstPlayer,
      history: createAiSelectedHistoryTracker('FIRST'),
    },
    {
      seat: 'SECOND',
      player: input.secondPlayer,
      history: createAiSelectedHistoryTracker('SECOND'),
    },
  ];

  session.createGame(
    `phase-two-${input.scenarioId}-${input.seed}`,
    input.firstPlayer.playerId,
    input.firstPlayer.playerName,
    input.secondPlayer.playerId,
    input.secondPlayer.playerName
  );
  const initialized = session.initializeGame(input.firstPlayer.deck, input.secondPlayer.deck);
  if (!initialized.success || !session.state) {
    return failedGame(
      input,
      session.state,
      recordStore.list(),
      decisionCount,
      0,
      initialized.error ?? 'INITIALIZATION_FAILED'
    );
  }

  while (!session.state.isEnded) {
    const state = session.state;
    if (Date.now() - startedAt > limits.maxWallClockMsPerGame) {
      return failedGame(
        input,
        state,
        recordStore.list(),
        decisionCount,
        historyContextDecisionCount,
        'WALL_CLOCK_LIMIT'
      );
    }
    if (state.turnCount > limits.maxTurnsPerGame) {
      return failedGame(
        input,
        state,
        recordStore.list(),
        decisionCount,
        historyContextDecisionCount,
        'TURN_LIMIT'
      );
    }
    if (decisionCount >= limits.maxDecisionsPerGame) {
      return failedGame(
        input,
        state,
        recordStore.list(),
        decisionCount,
        historyContextDecisionCount,
        'DECISION_LIMIT'
      );
    }

    now = Math.max(
      now + 1,
      state.activeEffect?.publicCardSelectionAutoAdvanceAt ?? 0,
      state.activeEffect?.publicEffectChoiceAutoAdvanceAt ?? 0,
      state.activeEffect?.publicRevealAutoAdvanceAt ?? 0
    );
    const next = findNextDecision(state, seats, authorityRevision, now);
    if (!next) {
      return failedGame(
        input,
        state,
        recordStore.list(),
        decisionCount,
        historyContextDecisionCount,
        describeState(state)
      );
    }

    const view = projectPlayerViewState(state, next.runtime.player.playerId, {
      seq: authorityRevision,
      now,
    });
    const observation = buildAiObservation(view, next.handle.contract);
    const selectedHistory = next.runtime.history.observe(observation);
    const context = buildAiStrategyContext({
      observation,
      deckKey: next.runtime.player.deckKey,
      deckContentHash: AI_BATTLE_PHASE_ZERO_DECKS[next.runtime.player.deckKey].contentHash,
      selectedHistory,
    });
    if (context.selectedHistory.length > 0) historyContextDecisionCount += 1;
    const selected = selectExplainableDecision(context);
    if (!selected.ok) {
      return failedGame(
        input,
        state,
        recordStore.list(),
        decisionCount,
        historyContextDecisionCount,
        selected.detail
      );
    }
    const validation = validateAiDecisionSelection(next.handle, selected.selection);
    if (!validation.ok) {
      return failedGame(
        input,
        state,
        recordStore.list(),
        decisionCount,
        historyContextDecisionCount,
        `SELECTION_VALIDATION_FAILED:${validation.error}`
      );
    }
    const materialized = materializeAiDecisionCommand(next.handle, selected.selection, now);
    if (!materialized.ok) {
      return failedGame(
        input,
        state,
        recordStore.list(),
        decisionCount,
        historyContextDecisionCount,
        `COMMAND_MATERIALIZATION_FAILED:${materialized.error}`
      );
    }

    const audit = createAiStrategyDecisionAudit(context, selected);
    const randomFactCountBefore = session.getRuleRandomFacts().length;
    const executed = session.executeCommand(materialized.command);
    const randomFactRefs = session
      .getRuleRandomFacts()
      .slice(randomFactCountBefore)
      .map((fact) => `rule-random-fact-${String(fact.sequence)}`);
    recordStore.append(
      createAiStrategyDecisionRecord({
        decisionAudit: audit,
        decisionId: next.handle.contract.decisionId,
        windowSignature: next.handle.contract.windowSignature,
        commandType: materialized.command.type,
        authorityRevisionAfter: executed.success ? authorityRevision + 1 : authorityRevision,
        execution: executed.success
          ? { status: 'ACCEPTED' }
          : { status: 'REJECTED', errorCode: executed.error ?? 'UNKNOWN_COMMAND_REJECTION' },
        ruleRandomFactRefs: randomFactRefs,
      })
    );
    decisionCount += 1;
    if (!executed.success) {
      return failedGame(
        input,
        session.state,
        recordStore.list(),
        decisionCount,
        historyContextDecisionCount,
        `COMMAND_REJECTED:${executed.error}`
      );
    }
    next.runtime.history.recordAcceptedDecision(observation, selected);
    authorityRevision += 1;
  }

  const finalState = session.state;
  const winnerSeat = seatForPlayerId(finalState, finalState.endInfo?.winnerId ?? null);
  return {
    scenarioId: input.scenarioId,
    seed: input.seed,
    completed: true,
    endReason: finalState.endInfo?.reason ?? null,
    winnerSeat,
    winnerDeckKey: winnerSeat
      ? seats.find((runtime) => runtime.seat === winnerSeat)!.player.deckKey
      : null,
    turnCount: finalState.turnCount,
    decisionCount,
    historyContextDecisionCount,
    records: recordStore.list(),
  };
}

function findNextDecision(
  state: GameState,
  seats: readonly RuntimeSeat[],
  authorityRevision: number,
  now: number
): { readonly runtime: RuntimeSeat; readonly handle: AiDecisionContractHandle } | null {
  for (const runtime of seats) {
    const result = buildAiDecisionContract(state, runtime.player.playerId, authorityRevision, now);
    if (result.ok) return { runtime, handle: result.handle };
  }
  return null;
}

function failedGame(
  input: AiPhaseTwoPlayoutInput,
  state: GameState | null,
  records: AiStrategyEvaluationGame['records'],
  decisionCount: number,
  historyContextDecisionCount: number,
  failureReason: string
): AiStrategyEvaluationGame {
  return {
    scenarioId: input.scenarioId,
    seed: input.seed,
    completed: false,
    endReason: state?.endInfo?.reason ?? null,
    winnerSeat: null,
    winnerDeckKey: null,
    turnCount: state?.turnCount ?? 0,
    decisionCount,
    historyContextDecisionCount,
    records,
    failureReason,
  };
}

function seatForPlayerId(state: GameState, playerId: string | null): Seat | null {
  if (!playerId) return null;
  if (state.players[0]?.id === playerId) return 'FIRST';
  if (state.players[1]?.id === playerId) return 'SECOND';
  return null;
}

function describeState(state: GameState): string {
  return JSON.stringify({
    phase: state.currentPhase,
    subPhase: state.currentSubPhase,
    turnCount: state.turnCount,
    activePlayerIndex: state.activePlayerIndex,
    waitingPlayerId: state.waitingPlayerId,
    activeEffectAbilityId: state.activeEffect?.abilityId,
    activeEffectStepId: state.activeEffect?.stepId,
  });
}
