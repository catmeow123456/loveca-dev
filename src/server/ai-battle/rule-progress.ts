import type { GameState } from '../../domain/entities/game.js';
import type { PlayerState } from '../../domain/entities/player.js';
import type { MemberSlotZoneState, StatefulZoneState } from '../../domain/entities/zone.js';
import { SlotPosition } from '../../shared/types/enums.js';
import {
  AI_BATTLE_CONSERVATIVE_LIVENESS_LIMITS,
  AI_BATTLE_HEADLESS_ACCEPTANCE_LIMITS,
  AI_BATTLE_RULE_PROGRESS_POLICY,
} from './phase-zero-baseline.js';

export const AI_RULE_PROGRESS_SNAPSHOT_VERSION = 'ai-battle.rule-progress-snapshot/v1' as const;

export interface AiRuleProgressSnapshot {
  readonly schemaVersion: typeof AI_RULE_PROGRESS_SNAPSHOT_VERSION;
  readonly policyVersion: typeof AI_BATTLE_RULE_PROGRESS_POLICY.version;
  readonly authorityStateSignature: string;
  readonly strategicRuleSignature: string;
}

export type MachineLivenessTerminalReason =
  | 'AI_TURNS_WITHOUT_STRATEGIC_PROGRESS'
  | 'CONSERVATIVE_DECISION_LIMIT'
  | 'DEGRADED_DURATION_LIMIT'
  | 'AUTHORITY_PROGRESS_WATCHDOG';

export type MachineStrategyMode = 'PRIMARY' | 'CONSERVATIVE_FALLBACK';

export interface MachineLivenessLimits {
  readonly maxAiTurnsWithoutRuleProgress: number;
  readonly maxConservativeDecisions: number;
  readonly maxDegradedDurationMs: number;
  readonly maxDecisionsWithoutAuthorityProgress: number;
}

export interface MachineLivenessState {
  readonly policyVersion: typeof AI_BATTLE_RULE_PROGRESS_POLICY.version;
  readonly strategyMode: MachineStrategyMode;
  readonly degradedAt: number | null;
  readonly conservativeDecisionCount: number;
  readonly decisionsWithoutAuthorityProgress: number;
  readonly aiTurnsWithoutStrategicProgress: number;
  readonly activeAiTurnKey: string | null;
  readonly activeAiTurnHasStrategicProgress: boolean;
  readonly lastAuthorityStateSignature: string;
  readonly lastStrategicRuleSignature: string;
  readonly terminalReason: MachineLivenessTerminalReason | null;
}

export interface MachineLivenessDecisionResult {
  readonly state: MachineLivenessState;
  readonly authorityStateProgress: boolean;
  readonly strategicRuleProgress: boolean;
  readonly terminalReason: MachineLivenessTerminalReason | null;
}

export const DEFAULT_MACHINE_LIVENESS_LIMITS: MachineLivenessLimits = {
  maxAiTurnsWithoutRuleProgress:
    AI_BATTLE_CONSERVATIVE_LIVENESS_LIMITS.maxAiTurnsWithoutRuleProgress,
  maxConservativeDecisions: AI_BATTLE_CONSERVATIVE_LIVENESS_LIMITS.maxConservativeDecisions,
  maxDegradedDurationMs: AI_BATTLE_CONSERVATIVE_LIVENESS_LIMITS.maxDegradedDurationMs,
  maxDecisionsWithoutAuthorityProgress:
    AI_BATTLE_HEADLESS_ACCEPTANCE_LIMITS.maxDecisionsWithoutAuthorityProgress,
};

export function captureAiRuleProgress(game: GameState): AiRuleProgressSnapshot {
  const strategic = buildStrategicSnapshot(game);
  const authority = {
    strategic,
    authorityZones: {
      players: game.players.map((player) => buildPlayerZoneSnapshot(player, true)),
      resolutionZone: {
        cardIds: game.resolutionZone.cardIds,
        revealedCardIds: game.resolutionZone.revealedCardIds,
      },
      inspectionZone: {
        cardIds: game.inspectionZone.cardIds,
        revealedCardIds: game.inspectionZone.revealedCardIds,
      },
    },
    turnCount: game.turnCount,
    currentPhase: game.currentPhase,
    currentSubPhase: game.currentSubPhase,
    currentTurnType: game.currentTurnType,
    firstPlayerIndex: game.firstPlayerIndex,
    activePlayerIndex: game.activePlayerIndex,
    effectWindowType: game.effectWindowType,
    waitingForInput: game.waitingForInput,
    waitingPlayerId: game.waitingPlayerId,
    availableAbilityIds: game.availableAbilityIds,
    pendingAbilities: normalizeRuleValue(game.pendingAbilities),
    delegatedAbilitySequence: normalizeRuleValue(game.delegatedAbilitySequence ?? null),
    checkTimingContext: normalizeRuleValue(game.checkTimingContext),
    pendingChoice: normalizeRuleValue(game.pendingChoice),
    activeEffect: normalizeAuthorityWindow(game.activeEffect),
    pendingCostPayment: normalizeRuleValue(game.pendingCostPayment),
    pendingSpecialMemberPlay: normalizeRuleValue(game.pendingSpecialMemberPlay ?? null),
    inspectionContext: normalizeRuleValue(game.inspectionContext),
    liveSetCardIds: normalizeRuleValue(game.liveSetCardIds),
    liveSetCompletedPlayers: game.liveSetCompletedPlayers,
    mulliganCompletedPlayers: game.mulliganCompletedPlayers,
  };
  return {
    schemaVersion: AI_RULE_PROGRESS_SNAPSHOT_VERSION,
    policyVersion: AI_BATTLE_RULE_PROGRESS_POLICY.version,
    authorityStateSignature: stableStringify(authority),
    strategicRuleSignature: stableStringify(strategic),
  };
}

export function createMachineLivenessState(
  game: GameState,
  now: number,
  strategyMode: MachineStrategyMode = 'CONSERVATIVE_FALLBACK'
): MachineLivenessState {
  const progress = captureAiRuleProgress(game);
  return {
    policyVersion: AI_BATTLE_RULE_PROGRESS_POLICY.version,
    strategyMode,
    degradedAt: strategyMode === 'CONSERVATIVE_FALLBACK' ? now : null,
    conservativeDecisionCount: 0,
    decisionsWithoutAuthorityProgress: 0,
    aiTurnsWithoutStrategicProgress: 0,
    activeAiTurnKey: null,
    activeAiTurnHasStrategicProgress: false,
    lastAuthorityStateSignature: progress.authorityStateSignature,
    lastStrategicRuleSignature: progress.strategicRuleSignature,
    terminalReason: null,
  };
}

export function recordMachineLivenessDecision(input: {
  readonly previous: MachineLivenessState;
  readonly before: GameState;
  readonly after: GameState;
  readonly systemPlayerId: string;
  readonly now: number;
  readonly strategyMode?: MachineStrategyMode;
  readonly limits?: MachineLivenessLimits;
}): MachineLivenessDecisionResult {
  const limits = input.limits ?? DEFAULT_MACHINE_LIVENESS_LIMITS;
  const strategyMode = input.strategyMode ?? input.previous.strategyMode;
  assertMachineLivenessLimits(limits);
  const beforeProgress = captureAiRuleProgress(input.before);
  const afterProgress = captureAiRuleProgress(input.after);
  const authorityStateProgress =
    beforeProgress.authorityStateSignature !== afterProgress.authorityStateSignature;
  const strategicRuleProgress =
    beforeProgress.strategicRuleSignature !== afterProgress.strategicRuleSignature;
  const beforeTurnKey = getAiTurnKey(input.before, input.systemPlayerId);
  const afterTurnKey = getAiTurnKey(input.after, input.systemPlayerId);

  const modeChanged = input.previous.strategyMode !== strategyMode;
  let activeAiTurnKey = modeChanged ? null : input.previous.activeAiTurnKey;
  let activeAiTurnHasStrategicProgress = modeChanged
    ? false
    : input.previous.activeAiTurnHasStrategicProgress;
  let aiTurnsWithoutStrategicProgress =
    strategyMode === 'CONSERVATIVE_FALLBACK' && !modeChanged
      ? input.previous.aiTurnsWithoutStrategicProgress
      : 0;
  if (strategyMode === 'CONSERVATIVE_FALLBACK') {
    if (beforeTurnKey && activeAiTurnKey !== beforeTurnKey) {
      activeAiTurnKey = beforeTurnKey;
      activeAiTurnHasStrategicProgress = false;
    }
    if (strategicRuleProgress) {
      activeAiTurnHasStrategicProgress = true;
      aiTurnsWithoutStrategicProgress = 0;
    }
    if (beforeTurnKey && afterTurnKey !== beforeTurnKey) {
      aiTurnsWithoutStrategicProgress = activeAiTurnHasStrategicProgress
        ? 0
        : aiTurnsWithoutStrategicProgress + 1;
      activeAiTurnKey = afterTurnKey;
      activeAiTurnHasStrategicProgress = false;
    }
  } else {
    activeAiTurnKey = null;
    activeAiTurnHasStrategicProgress = false;
  }

  const conservativeDecisionCount =
    strategyMode === 'CONSERVATIVE_FALLBACK'
      ? (modeChanged ? 0 : input.previous.conservativeDecisionCount) + 1
      : 0;
  const degradedAt =
    strategyMode === 'CONSERVATIVE_FALLBACK'
      ? modeChanged || input.previous.degradedAt === null
        ? input.now
        : input.previous.degradedAt
      : null;
  const decisionsWithoutAuthorityProgress = authorityStateProgress
    ? 0
    : input.previous.decisionsWithoutAuthorityProgress + 1;
  const terminalReason = resolveTerminalReason({
    strategyMode,
    aiTurnsWithoutStrategicProgress,
    conservativeDecisionCount,
    decisionsWithoutAuthorityProgress,
    degradedDurationMs: degradedAt === null ? 0 : Math.max(0, input.now - degradedAt),
    limits,
  });
  const state: MachineLivenessState = {
    ...input.previous,
    strategyMode,
    degradedAt,
    conservativeDecisionCount,
    decisionsWithoutAuthorityProgress,
    aiTurnsWithoutStrategicProgress,
    activeAiTurnKey,
    activeAiTurnHasStrategicProgress,
    lastAuthorityStateSignature: afterProgress.authorityStateSignature,
    lastStrategicRuleSignature: afterProgress.strategicRuleSignature,
    terminalReason,
  };
  return {
    state,
    authorityStateProgress,
    strategicRuleProgress,
    terminalReason,
  };
}

function resolveTerminalReason(input: {
  readonly strategyMode: MachineStrategyMode;
  readonly aiTurnsWithoutStrategicProgress: number;
  readonly conservativeDecisionCount: number;
  readonly decisionsWithoutAuthorityProgress: number;
  readonly degradedDurationMs: number;
  readonly limits: MachineLivenessLimits;
}): MachineLivenessTerminalReason | null {
  if (
    input.decisionsWithoutAuthorityProgress >= input.limits.maxDecisionsWithoutAuthorityProgress
  ) {
    return 'AUTHORITY_PROGRESS_WATCHDOG';
  }
  if (input.strategyMode === 'PRIMARY') {
    return null;
  }
  if (input.aiTurnsWithoutStrategicProgress >= input.limits.maxAiTurnsWithoutRuleProgress) {
    return 'AI_TURNS_WITHOUT_STRATEGIC_PROGRESS';
  }
  if (input.conservativeDecisionCount >= input.limits.maxConservativeDecisions) {
    return 'CONSERVATIVE_DECISION_LIMIT';
  }
  if (input.degradedDurationMs >= input.limits.maxDegradedDurationMs) {
    return 'DEGRADED_DURATION_LIMIT';
  }
  return null;
}

function getAiTurnKey(game: GameState, systemPlayerId: string): string | null {
  if (game.turnCount <= 0 || game.players[game.activePlayerIndex]?.id !== systemPlayerId) {
    return null;
  }
  return `${game.turnCount}:${game.activePlayerIndex}`;
}

function buildStrategicSnapshot(game: GameState): unknown {
  return {
    players: game.players.map(buildStrategicPlayerSnapshot),
    resolutionZone: game.resolutionZone.cardIds,
    inspectionZone: {
      cardIds: game.inspectionZone.cardIds,
      revealedCardIds: game.inspectionZone.revealedCardIds,
    },
    liveResolution: {
      isInLive: game.liveResolution.isInLive,
      performingPlayerId: game.liveResolution.performingPlayerId,
      firstPlayerCheerCardIds: game.liveResolution.firstPlayerCheerCardIds,
      secondPlayerCheerCardIds: game.liveResolution.secondPlayerCheerCardIds,
      liveResults: normalizeRuleValue(game.liveResolution.liveResults),
      playerScores: normalizeRuleValue(game.liveResolution.playerScores),
      playerRemainingHearts: normalizeRuleValue(game.liveResolution.playerRemainingHearts),
      playerLiveJudgmentHearts: normalizeRuleValue(game.liveResolution.playerLiveJudgmentHearts),
      playerScoreBonuses: normalizeRuleValue(game.liveResolution.playerScoreBonuses),
      playerHeartBonuses: normalizeRuleValue(game.liveResolution.playerHeartBonuses),
      liveRequirementReductions: normalizeRuleValue(game.liveResolution.liveRequirementReductions),
      liveRequirementModifiers: normalizeRuleValue(game.liveResolution.liveRequirementModifiers),
      successLivePlacementRestrictions: normalizeRuleValue(
        game.liveResolution.successLivePlacementRestrictions
      ),
      liveModifiers: normalizeRuleValue(game.liveResolution.liveModifiers),
      liveWinnerIds: game.liveResolution.liveWinnerIds,
    },
    liveProhibitions: normalizeRuleValue(game.liveProhibitions),
    liveStartSuppressions: normalizeRuleValue(game.liveStartSuppressions),
    memberActivePhaseSkips: normalizeRuleValue(game.memberActivePhaseSkips),
    energyActivePhaseSkips: normalizeRuleValue(game.energyActivePhaseSkips ?? []),
    memberEffectActivationProhibitions: normalizeRuleValue(
      game.memberEffectActivationProhibitions ?? []
    ),
    memberWaitProtections: normalizeRuleValue(game.memberWaitProtections ?? []),
    liveSetLimitReductions: normalizeRuleValue(game.liveSetLimitReductions),
    terminal: game.endInfo
      ? {
          reason: game.endInfo.reason,
          winnerId: game.endInfo.winnerId,
          loserId: game.endInfo.loserId,
          isDraw: game.endInfo.isDraw,
          finalTurnCount: game.endInfo.finalTurnCount,
        }
      : null,
  };
}

function buildStrategicPlayerSnapshot(player: PlayerState): unknown {
  return buildPlayerZoneSnapshot(player, false);
}

function buildPlayerZoneSnapshot(player: PlayerState, includeFace: boolean): unknown {
  return {
    id: player.id,
    hand: player.hand.cardIds,
    mainDeck: player.mainDeck.cardIds,
    energyDeck: player.energyDeck.cardIds,
    memberSlots: buildMemberSlotSnapshot(player.memberSlots, includeFace),
    energyZone: buildStatefulZoneSnapshot(player.energyZone, includeFace),
    liveZone: buildStatefulZoneSnapshot(player.liveZone, includeFace),
    successZone: player.successZone.cardIds,
    waitingRoom: player.waitingRoom.cardIds,
    exileZone: buildStatefulZoneSnapshot(player.exileZone, includeFace),
  };
}

function buildStatefulZoneSnapshot(zone: StatefulZoneState, includeFace: boolean): unknown {
  return {
    cardIds: zone.cardIds,
    cardStates: [...zone.cardStates.entries()]
      .sort(([left], [right]) => compareText(left, right))
      .map(([cardId, state]) => [
        cardId,
        includeFace
          ? { orientation: state.orientation, face: state.face }
          : { orientation: state.orientation },
      ]),
  };
}

function buildMemberSlotSnapshot(zone: MemberSlotZoneState, includeFace: boolean): unknown {
  const slots = [SlotPosition.LEFT, SlotPosition.CENTER, SlotPosition.RIGHT];
  return {
    slots: slots.map((slot) => [slot, zone.slots[slot]]),
    energyBelow: slots.map((slot) => [slot, zone.energyBelow[slot]]),
    memberBelow: slots.map((slot) => [slot, zone.memberBelow[slot]]),
    cardStates: [...zone.cardStates.entries()]
      .sort(([left], [right]) => compareText(left, right))
      .map(([cardId, state]) => [
        cardId,
        includeFace
          ? { orientation: state.orientation, face: state.face }
          : { orientation: state.orientation },
      ]),
  };
}

function normalizeAuthorityWindow(value: GameState['activeEffect']): unknown {
  if (!value) return null;
  const presentationOnlyKeys = new Set([
    'publicCardSelectionAutoAdvanceAt',
    'publicEffectChoiceAutoAdvanceAt',
    'effectText',
    'stepText',
    'selectionLabel',
    'confirmSelectionLabel',
    'skipSelectionLabel',
  ]);
  return normalizeRuleValue(
    Object.fromEntries(Object.entries(value).filter(([key]) => !presentationOnlyKeys.has(key)))
  );
}

function normalizeRuleValue(value: unknown): unknown {
  if (value instanceof Map) {
    const entries: [unknown, unknown][] = [...(value as Map<unknown, unknown>).entries()];
    return entries
      .sort(([left], [right]) => compareText(String(left), String(right)))
      .map(([key, item]) => [key, normalizeRuleValue(item)]);
  }
  if (Array.isArray(value)) {
    const items: readonly unknown[] = value;
    return items.map((item) => normalizeRuleValue(item));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !isAuditOrTimeKey(key))
        .sort(([left], [right]) => compareText(left, right))
        .map(([key, item]) => [key, normalizeRuleValue(item)])
    );
  }
  return value;
}

function isAuditOrTimeKey(key: string): boolean {
  return (
    key === 'timestamp' ||
    key === 'createdAt' ||
    key === 'updatedAt' ||
    key === 'expiresAt' ||
    key === 'autoAdvanceAt' ||
    key.endsWith('AutoAdvanceAt')
  );
}

function stableStringify(value: unknown): string {
  return JSON.stringify(normalizeRuleValue(value));
}

function compareText(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function assertMachineLivenessLimits(limits: MachineLivenessLimits): void {
  for (const [key, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new Error(`${key} 必须是正安全整数`);
    }
  }
}
