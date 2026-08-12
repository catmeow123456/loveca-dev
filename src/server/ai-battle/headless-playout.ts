import {
  buildAiDecisionContract,
  materializeAiDecisionCommand,
  validateAiDecisionSelection,
  type AiDecisionContractHandle,
  type AiDecisionSelection,
} from '../../application/ai-decisions/index.js';
import { createSystemConcedeCommand } from '../../application/game-commands.js';
import { createGameSession, type GameSession } from '../../application/game-session.js';
import type { DeckConfig } from '../../application/game-service.js';
import type { GameState } from '../../domain/entities/game.js';
import {
  createReplayRuleRandomSource,
  createSeededRuleRandomSource,
  type RuleRandomFact,
} from '../../domain/rules/rule-random.js';
import type { Seat } from '../../online/index.js';
import { GameEndReason } from '../../shared/types/enums.js';
import { AI_BATTLE_PROTOCOL_VERSIONS } from '../../shared/ai-battle-protocol-versions.js';
import { selectConservativeDecision } from './conservative-decision-policy.js';
import {
  createReplayRandomLegalDecisionPolicy,
  createSeededRandomLegalDecisionPolicy,
  type RandomLegalDecisionFact,
  type RandomLegalDecisionPolicy,
} from './random-legal-decision-policy.js';
import {
  captureAiRuleProgress,
  createMachineLivenessState,
  recordMachineLivenessDecision,
  type MachineLivenessState,
} from './rule-progress.js';

export const AI_HEADLESS_PLAYOUT_SCHEMA_VERSION =
  AI_BATTLE_PROTOCOL_VERSIONS.evaluation.headlessPlayout;
export const AI_HEADLESS_FAILURE_ARTIFACT_SCHEMA_VERSION =
  AI_BATTLE_PROTOCOL_VERSIONS.evaluation.headlessFailureArtifact;

export interface HeadlessPlayoutLimits {
  readonly maxTurnsPerGame: number;
  readonly maxDecisionsPerGame: number;
  readonly maxRepairRetriesPerWindow: number;
  readonly maxDecisionsWithoutAuthorityProgress: number;
  readonly maxWallClockMsPerGame: number;
}

export type HeadlessSeatStrategy =
  | { readonly kind: 'RANDOM_LEGAL' }
  | { readonly kind: 'CONSERVATIVE_FROM_START' }
  | {
      readonly kind: 'CONSERVATIVE_AFTER_DECISIONS';
      readonly randomDecisionCount: number;
    };

export interface HeadlessPlayoutPlayer {
  readonly playerId: string;
  readonly playerName: string;
  readonly deck: DeckConfig;
  readonly strategy: HeadlessSeatStrategy;
}

export interface HeadlessPlayoutReplayInput {
  readonly ruleRandomFacts: readonly RuleRandomFact[];
  readonly randomDecisionFactsBySeat: Readonly<
    Partial<Record<Seat, readonly RandomLegalDecisionFact[]>>
  >;
}

export interface HeadlessPlayoutInput {
  readonly scenarioId: string;
  readonly firstPlayer: HeadlessPlayoutPlayer;
  readonly secondPlayer: HeadlessPlayoutPlayer;
  readonly ruleSeed: string | number;
  readonly strategySeed: string | number;
  readonly limits: HeadlessPlayoutLimits;
  readonly replay?: HeadlessPlayoutReplayInput;
}

export interface HeadlessDecisionTrace {
  readonly sequence: number;
  readonly authorityRevision: number;
  readonly seat: Seat;
  readonly playerId: string;
  readonly strategy: 'RANDOM_LEGAL' | 'CONSERVATIVE';
  readonly decisionId: string;
  readonly windowSignature: string;
  readonly contractKind: AiDecisionContractHandle['contract']['kind'];
  readonly selection: AiDecisionSelection;
  readonly repairAttempts: number | null;
  readonly authorityStateProgress: boolean;
}

export interface HeadlessFailureArtifact {
  readonly schemaVersion: typeof AI_HEADLESS_FAILURE_ARTIFACT_SCHEMA_VERSION;
  readonly scenarioId: string;
  readonly ruleSeed: string;
  readonly strategySeed: string;
  readonly reason: string;
  readonly detail: string;
  readonly turnCount: number;
  readonly decisionCount: number;
  readonly authorityRevision: number;
  readonly lastState: {
    readonly phase: string;
    readonly subPhase: string;
    readonly activePlayerId: string | null;
    readonly waitingPlayerId: string | null;
    readonly pendingAbilityIds: readonly string[];
    readonly activeEffectId: string | null;
    readonly activeEffectStepId: string | null;
  };
  readonly lastDecision: HeadlessDecisionTrace | null;
  readonly ruleRandomFacts: readonly RuleRandomFact[];
  readonly randomDecisionFactsBySeat: Readonly<Record<Seat, readonly RandomLegalDecisionFact[]>>;
  readonly decisionTrace: readonly HeadlessDecisionTrace[];
}

export type HeadlessPlayoutResult =
  | {
      readonly ok: true;
      readonly schemaVersion: typeof AI_HEADLESS_PLAYOUT_SCHEMA_VERSION;
      readonly scenarioId: string;
      readonly endReason: GameEndReason;
      readonly winnerId: string | null;
      readonly turnCount: number;
      readonly decisionCount: number;
      readonly authorityRevision: number;
      readonly elapsedMs: number;
      readonly ruleRandomFacts: readonly RuleRandomFact[];
      readonly randomDecisionFactsBySeat: Readonly<
        Record<Seat, readonly RandomLegalDecisionFact[]>
      >;
      readonly decisionTrace: readonly HeadlessDecisionTrace[];
      readonly finalAuthoritySignature: string;
    }
  | {
      readonly ok: false;
      readonly schemaVersion: typeof AI_HEADLESS_PLAYOUT_SCHEMA_VERSION;
      readonly scenarioId: string;
      readonly failure: HeadlessFailureArtifact;
    };

interface RuntimeSeat {
  readonly seat: Seat;
  readonly player: HeadlessPlayoutPlayer;
  readonly randomPolicy: RandomLegalDecisionPolicy;
  randomDecisionCount: number;
  liveness: MachineLivenessState | null;
}

export function runHeadlessPlayout(input: HeadlessPlayoutInput): HeadlessPlayoutResult {
  assertLimits(input.limits);
  const startedAt = Date.now();
  let logicalNow = 1_000;
  let authorityRevision = 0;
  let decisionsWithoutAuthorityProgress = 0;
  const decisionTrace: HeadlessDecisionTrace[] = [];
  const ruleRandomSource = input.replay
    ? createReplayRuleRandomSource(input.replay.ruleRandomFacts)
    : createSeededRuleRandomSource(input.ruleSeed);
  const session = createGameSession({
    now: () => logicalNow,
    ruleRandomSource,
  });
  const seats: readonly RuntimeSeat[] = [
    createRuntimeSeat('FIRST', input.firstPlayer, input),
    createRuntimeSeat('SECOND', input.secondPlayer, input),
  ];

  try {
    session.createGame(
      `headless-${input.scenarioId}-${String(input.ruleSeed)}-${String(input.strategySeed)}`,
      input.firstPlayer.playerId,
      input.firstPlayer.playerName,
      input.secondPlayer.playerId,
      input.secondPlayer.playerName
    );
    const initialized = session.initializeGame(input.firstPlayer.deck, input.secondPlayer.deck);
    if (!initialized.success || !session.state) {
      return fail(
        input,
        session,
        seats,
        decisionTrace,
        authorityRevision,
        'INITIALIZATION_FAILED',
        initialized.error
      );
    }

    while (!session.state.isEnded) {
      const game = session.state;
      const elapsedMs = Date.now() - startedAt;
      if (elapsedMs > input.limits.maxWallClockMsPerGame) {
        return fail(
          input,
          session,
          seats,
          decisionTrace,
          authorityRevision,
          'WALL_CLOCK_LIMIT',
          `对局超过 ${String(input.limits.maxWallClockMsPerGame)}ms`
        );
      }
      if (game.turnCount > input.limits.maxTurnsPerGame) {
        return fail(
          input,
          session,
          seats,
          decisionTrace,
          authorityRevision,
          'TURN_LIMIT',
          `对局超过 ${String(input.limits.maxTurnsPerGame)} 回合`
        );
      }
      if (decisionTrace.length >= input.limits.maxDecisionsPerGame) {
        return fail(
          input,
          session,
          seats,
          decisionTrace,
          authorityRevision,
          'DECISION_LIMIT',
          `对局超过 ${String(input.limits.maxDecisionsPerGame)} 个决策`
        );
      }

      logicalNow = Math.max(logicalNow + 1, readActiveEffectDeadline(game) ?? 0);
      const decision = findNextDecision(game, seats, authorityRevision, logicalNow);
      if (!decision.ok) {
        return fail(
          input,
          session,
          seats,
          decisionTrace,
          authorityRevision,
          decision.reason,
          decision.detail
        );
      }

      const before = session.state;
      const selected = selectForSeat(decision.seat, decision.handle);
      if (!selected.ok) {
        return fail(
          input,
          session,
          seats,
          decisionTrace,
          authorityRevision,
          selected.reason,
          selected.detail
        );
      }
      const validation = validateAiDecisionSelection(decision.handle, selected.selection);
      if (!validation.ok) {
        return fail(
          input,
          session,
          seats,
          decisionTrace,
          authorityRevision,
          'INVALID_SELECTION',
          validation.error
        );
      }
      const materialized = materializeAiDecisionCommand(
        decision.handle,
        selected.selection,
        logicalNow
      );
      if (!materialized.ok) {
        return fail(
          input,
          session,
          seats,
          decisionTrace,
          authorityRevision,
          'MATERIALIZATION_FAILED',
          materialized.error
        );
      }
      const executed = session.executeCommand(materialized.command);
      if (!executed.success || !session.state) {
        return fail(
          input,
          session,
          seats,
          decisionTrace,
          authorityRevision,
          'COMMAND_REJECTED',
          JSON.stringify({
            error: executed.error ?? materialized.command.type,
            contract: decision.handle.contract,
            selection: selected.selection,
            command: materialized.command,
          })
        );
      }
      authorityRevision += 1;
      const beforeProgress = captureAiRuleProgress(before);
      const afterProgress = captureAiRuleProgress(session.state);
      const authorityStateProgress =
        beforeProgress.authorityStateSignature !== afterProgress.authorityStateSignature;
      decisionsWithoutAuthorityProgress = authorityStateProgress
        ? 0
        : decisionsWithoutAuthorityProgress + 1;
      decisionTrace.push({
        sequence: decisionTrace.length + 1,
        authorityRevision,
        seat: decision.seat.seat,
        playerId: decision.seat.player.playerId,
        strategy: selected.strategy,
        decisionId: decision.handle.contract.decisionId,
        windowSignature: decision.handle.contract.windowSignature,
        contractKind: decision.handle.contract.kind,
        selection: cloneSelection(selected.selection),
        repairAttempts: selected.repairAttempts,
        authorityStateProgress,
      });
      if (decisionsWithoutAuthorityProgress >= input.limits.maxDecisionsWithoutAuthorityProgress) {
        return fail(
          input,
          session,
          seats,
          decisionTrace,
          authorityRevision,
          'AUTHORITY_PROGRESS_WATCHDOG',
          `连续 ${String(decisionsWithoutAuthorityProgress)} 个决策没有权威状态进展`
        );
      }

      if (selected.strategy === 'CONSERVATIVE' && !session.state.isEnded) {
        const previous = decision.seat.liveness ?? createMachineLivenessState(before, logicalNow);
        const liveness = recordMachineLivenessDecision({
          previous,
          before,
          after: session.state,
          systemPlayerId: decision.seat.player.playerId,
          now: logicalNow,
        });
        decision.seat.liveness = liveness.state;
        if (liveness.terminalReason) {
          const terminal = session.executeSystemConcession({
            ...createSystemConcedeCommand(decision.seat.player.playerId, liveness.terminalReason),
            timestamp: logicalNow,
          });
          if (!terminal.success) {
            return fail(
              input,
              session,
              seats,
              decisionTrace,
              authorityRevision,
              'LIVENESS_TERMINAL_REJECTED',
              terminal.error
            );
          }
          authorityRevision += 1;
        }
      }
    }

    session.assertRuleRandomReplayComplete();
    for (const seat of seats) {
      seat.randomPolicy.assertReplayComplete();
    }
    const finalState = session.state;
    const completedElapsedMs = Date.now() - startedAt;
    if (completedElapsedMs > input.limits.maxWallClockMsPerGame) {
      return fail(
        input,
        session,
        seats,
        decisionTrace,
        authorityRevision,
        'WALL_CLOCK_LIMIT',
        `对局完成时超过 ${String(input.limits.maxWallClockMsPerGame)}ms`
      );
    }
    if (finalState && finalState.turnCount > input.limits.maxTurnsPerGame) {
      return fail(
        input,
        session,
        seats,
        decisionTrace,
        authorityRevision,
        'TURN_LIMIT',
        `对局完成时超过 ${String(input.limits.maxTurnsPerGame)} 回合`
      );
    }
    if (!finalState?.endInfo) {
      return fail(
        input,
        session,
        seats,
        decisionTrace,
        authorityRevision,
        'MISSING_END_INFO',
        '终局缺少 endInfo'
      );
    }
    return {
      ok: true,
      schemaVersion: AI_HEADLESS_PLAYOUT_SCHEMA_VERSION,
      scenarioId: input.scenarioId,
      endReason: finalState.endInfo.reason,
      winnerId: finalState.endInfo.winnerId,
      turnCount: finalState.turnCount,
      decisionCount: decisionTrace.length,
      authorityRevision,
      elapsedMs: completedElapsedMs,
      ruleRandomFacts: session.getRuleRandomFacts(),
      randomDecisionFactsBySeat: {
        FIRST: seats[0].randomPolicy.getFacts(),
        SECOND: seats[1].randomPolicy.getFacts(),
      },
      decisionTrace,
      finalAuthoritySignature: captureAiRuleProgress(finalState).authorityStateSignature,
    };
  } catch (error) {
    return fail(
      input,
      session,
      seats,
      decisionTrace,
      authorityRevision,
      'UNHANDLED_ERROR',
      error instanceof Error ? error.message : String(error)
    );
  }
}

function createRuntimeSeat(
  seat: Seat,
  player: HeadlessPlayoutPlayer,
  input: HeadlessPlayoutInput
): RuntimeSeat {
  const replayFacts = input.replay?.randomDecisionFactsBySeat[seat];
  return {
    seat,
    player,
    randomPolicy: replayFacts
      ? createReplayRandomLegalDecisionPolicy(replayFacts)
      : createSeededRandomLegalDecisionPolicy(
          `${String(input.strategySeed)}:${seat}`,
          input.limits.maxRepairRetriesPerWindow
        ),
    randomDecisionCount: 0,
    liveness: null,
  };
}

function findNextDecision(
  game: GameState,
  seats: readonly RuntimeSeat[],
  authorityRevision: number,
  now: number
):
  | {
      readonly ok: true;
      readonly seat: RuntimeSeat;
      readonly handle: AiDecisionContractHandle;
    }
  | {
      readonly ok: false;
      readonly reason: 'NO_DECISION' | 'UNSUPPORTED_WINDOW' | 'INVALID_STATE';
      readonly detail: string;
    } {
  const failures: string[] = [];
  let highestPriorityReason: 'NO_DECISION' | 'UNSUPPORTED_WINDOW' | 'INVALID_STATE' = 'NO_DECISION';
  for (const seat of seats) {
    const result = buildAiDecisionContract(game, seat.player.playerId, authorityRevision, now);
    if (result.ok) {
      return { ok: true, seat, handle: result.handle };
    }
    failures.push(`${seat.seat}:${result.reason}:${result.detail}`);
    if (result.reason === 'INVALID_STATE') {
      highestPriorityReason = 'INVALID_STATE';
    } else if (result.reason === 'UNSUPPORTED_WINDOW' && highestPriorityReason === 'NO_DECISION') {
      highestPriorityReason = 'UNSUPPORTED_WINDOW';
    }
  }
  return {
    ok: false,
    reason: highestPriorityReason,
    detail: failures.join(' | '),
  };
}

function selectForSeat(
  seat: RuntimeSeat,
  handle: AiDecisionContractHandle
):
  | {
      readonly ok: true;
      readonly strategy: 'RANDOM_LEGAL' | 'CONSERVATIVE';
      readonly selection: AiDecisionSelection;
      readonly repairAttempts: number | null;
    }
  | {
      readonly ok: false;
      readonly reason: string;
      readonly detail: string;
    } {
  const useConservative =
    seat.player.strategy.kind === 'CONSERVATIVE_FROM_START' ||
    (seat.player.strategy.kind === 'CONSERVATIVE_AFTER_DECISIONS' &&
      seat.randomDecisionCount >= seat.player.strategy.randomDecisionCount);
  if (useConservative) {
    const selected = selectConservativeDecision(handle.contract);
    return selected.ok
      ? {
          ok: true,
          strategy: 'CONSERVATIVE',
          selection: selected.selection,
          repairAttempts: null,
        }
      : { ok: false, reason: selected.reason, detail: selected.detail };
  }
  const selected = seat.randomPolicy.select(handle);
  if (!selected.ok) {
    return selected;
  }
  seat.randomDecisionCount += 1;
  return {
    ok: true,
    strategy: 'RANDOM_LEGAL',
    selection: selected.selection,
    repairAttempts: selected.fact.repairAttempts,
  };
}

function fail(
  input: HeadlessPlayoutInput,
  session: GameSession,
  seats: readonly RuntimeSeat[],
  decisionTrace: readonly HeadlessDecisionTrace[],
  authorityRevision: number,
  reason: string,
  detail: string | undefined
): HeadlessPlayoutResult {
  const game = session.state;
  return {
    ok: false,
    schemaVersion: AI_HEADLESS_PLAYOUT_SCHEMA_VERSION,
    scenarioId: input.scenarioId,
    failure: {
      schemaVersion: AI_HEADLESS_FAILURE_ARTIFACT_SCHEMA_VERSION,
      scenarioId: input.scenarioId,
      ruleSeed: String(input.ruleSeed),
      strategySeed: String(input.strategySeed),
      reason,
      detail: detail ?? reason,
      turnCount: game?.turnCount ?? 0,
      decisionCount: decisionTrace.length,
      authorityRevision,
      lastState: {
        phase: game?.currentPhase ?? 'NO_GAME',
        subPhase: game?.currentSubPhase ?? 'NO_GAME',
        activePlayerId: game?.players[game.activePlayerIndex]?.id ?? null,
        waitingPlayerId: game?.waitingPlayerId ?? null,
        pendingAbilityIds: game?.pendingAbilities.map((ability) => ability.abilityId) ?? [],
        activeEffectId: game?.activeEffect?.id ?? null,
        activeEffectStepId: game?.activeEffect?.stepId ?? null,
      },
      lastDecision: decisionTrace.at(-1) ?? null,
      ruleRandomFacts: session.getRuleRandomFacts(),
      randomDecisionFactsBySeat: {
        FIRST: seats[0].randomPolicy.getFacts(),
        SECOND: seats[1].randomPolicy.getFacts(),
      },
      decisionTrace: decisionTrace.map((trace) => ({
        ...trace,
        selection: cloneSelection(trace.selection),
      })),
    },
  };
}

function readActiveEffectDeadline(game: GameState): number | null {
  const effect = game.activeEffect;
  if (!effect) return null;
  return (
    effect.publicCardSelectionAutoAdvanceAt ??
    effect.publicEffectChoiceAutoAdvanceAt ??
    effect.publicRevealAutoAdvanceAt ??
    null
  );
}

function cloneSelection(selection: AiDecisionSelection): AiDecisionSelection {
  return JSON.parse(JSON.stringify(selection)) as AiDecisionSelection;
}

function assertLimits(limits: HeadlessPlayoutLimits): void {
  for (const [key, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new Error(`${key} 必须是正安全整数`);
    }
  }
}
