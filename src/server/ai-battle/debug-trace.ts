import type { AiDecisionSelection } from '../../application/ai-decisions/index.js';
import { AI_BATTLE_PROTOCOL_VERSIONS } from '../../shared/ai-battle-protocol-versions.js';
import type {
  AiModelInvocationAttemptOutcome,
  AiModelInvocationAudit,
} from './model-governance.js';
import type { AiModelDecisionOutput, AiModelRequestAttempt } from './model-protocol.js';

export const AI_BATTLE_DEBUG_TRACE_SCHEMA_VERSION = AI_BATTLE_PROTOCOL_VERSIONS.audit.debugTrace;
export const AI_BATTLE_DEBUG_TRACE_MAX_ENTRIES = 128;

export type AiBattleDebugDecisionSource = 'RULE' | 'MODEL' | 'CONSERVATIVE_FALLBACK';
export type AiBattleDebugExecutionStatus = 'ACCEPTED' | 'REJECTED' | 'STALE';

export interface AiBattleDebugModelSummary {
  readonly modelId: string;
  readonly finalOutcome: AiModelInvocationAudit['finalOutcome'];
  readonly attemptCount: number;
  readonly outcomes: readonly string[];
  readonly totalLatencyMs: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly estimatedCostMicrosCny: number;
}

export interface AiBattleDebugSelectionSummary {
  readonly kind: AiDecisionSelection['kind'];
  readonly selectedCount: number;
  readonly label: string;
}

export interface AiBattleDebugModelAttemptContext {
  readonly attemptNumber: 1 | 2;
  readonly attemptKind: AiModelRequestAttempt['kind'];
  readonly failureCode: string | null;
  readonly requestSha256: string;
  readonly requestEnvelopeVersion: string;
  readonly promptVersion: string;
  readonly outputSchemaVersion: string;
  /** Exact provider-neutral message, excluding credentials and provider routing. */
  readonly systemMessage: string;
  /** Exact provider-neutral message, including the current semantic strategy context. */
  readonly userMessage: string;
  /** Strictly parsed output only. Invalid/raw provider bodies are never retained. */
  readonly parsedOutput: AiModelDecisionOutput | null;
  readonly outcome: AiModelInvocationAttemptOutcome;
}

export interface AiBattleDebugTraceEntry {
  readonly seq: number;
  readonly createdAt: number;
  readonly stage: 'STARTED' | 'COMPLETED';
  readonly decisionKind: string;
  readonly authorityRevision: number;
  readonly source: AiBattleDebugDecisionSource;
  readonly tier: string | null;
  readonly reasonCode: string | null;
  readonly summary: string;
  readonly selection: AiBattleDebugSelectionSummary | null;
  readonly model: AiBattleDebugModelSummary | null;
  readonly modelContext: {
    readonly attempts: readonly AiBattleDebugModelAttemptContext[];
  } | null;
  readonly executionStatus: AiBattleDebugExecutionStatus | null;
}

export interface AiBattleDebugTraceView {
  readonly schemaVersion: typeof AI_BATTLE_DEBUG_TRACE_SCHEMA_VERSION;
  readonly enabled: boolean;
  readonly matchId: string;
  readonly currentSeq: number;
  readonly truncated: boolean;
  readonly entries: readonly AiBattleDebugTraceEntry[];
}

export interface AiBattleDebugTraceRuntime {
  nextSeq: number;
  readonly entries: AiBattleDebugTraceEntry[];
}

export function readAiBattleDebugTraceConfigurationStatus(
  env: Readonly<Record<string, string | undefined>> = process.env
): { readonly enabled: boolean; readonly requested: boolean; readonly developmentOnly: true } {
  const requested = env.AI_BATTLE_DEBUG_TRACE_ENABLED === '1';
  return {
    enabled: requested && env.NODE_ENV !== 'production',
    requested,
    developmentOnly: true,
  };
}

export function createAiBattleDebugTraceRuntime(): AiBattleDebugTraceRuntime {
  return { nextSeq: 1, entries: [] };
}

export function appendAiBattleDebugTraceEntry(
  runtime: AiBattleDebugTraceRuntime,
  input: Omit<AiBattleDebugTraceEntry, 'seq'>
): AiBattleDebugTraceEntry {
  const entry: AiBattleDebugTraceEntry = {
    ...input,
    seq: runtime.nextSeq,
    selection: input.selection ? { ...input.selection } : null,
    model: input.model
      ? {
          ...input.model,
          outcomes: [...input.model.outcomes],
        }
      : null,
    modelContext: cloneModelContext(input.modelContext),
  };
  runtime.nextSeq += 1;
  runtime.entries.push(entry);
  if (runtime.entries.length > AI_BATTLE_DEBUG_TRACE_MAX_ENTRIES) {
    runtime.entries.splice(0, runtime.entries.length - AI_BATTLE_DEBUG_TRACE_MAX_ENTRIES);
  }
  return cloneTraceEntry(entry);
}

export function readAiBattleDebugTraceView(
  runtime: AiBattleDebugTraceRuntime | null,
  matchId: string,
  afterSeq = 0
): AiBattleDebugTraceView {
  if (!runtime) {
    return {
      schemaVersion: AI_BATTLE_DEBUG_TRACE_SCHEMA_VERSION,
      enabled: false,
      matchId,
      currentSeq: 0,
      truncated: false,
      entries: [],
    };
  }
  const oldestSeq = runtime.entries[0]?.seq ?? runtime.nextSeq;
  const truncated = afterSeq > 0 && afterSeq < oldestSeq - 1;
  const entries = runtime.entries
    .filter((entry) => truncated || entry.seq > afterSeq)
    .map(cloneTraceEntry);
  return {
    schemaVersion: AI_BATTLE_DEBUG_TRACE_SCHEMA_VERSION,
    enabled: true,
    matchId,
    currentSeq: runtime.nextSeq - 1,
    truncated,
    entries,
  };
}

export function summarizeAiDecisionSelection(
  selection: AiDecisionSelection
): AiBattleDebugSelectionSummary {
  switch (selection.kind) {
    case 'MULLIGAN':
      return {
        kind: selection.kind,
        selectedCount: selection.candidateIds.length,
        label: `换牌 ${String(selection.candidateIds.length)} 张`,
      };
    case 'PAY_COST':
      return {
        kind: selection.kind,
        selectedCount: selection.candidateIds.length,
        label: `选择 ${String(selection.candidateIds.length)} 个费用对象`,
      };
    case 'CONFIRM_SPECIAL_MEMBER_PLAY':
    case 'SELECT_EFFECT_CARDS':
      return {
        kind: selection.kind,
        selectedCount: selection.candidateIds.length,
        label: `选择 ${String(selection.candidateIds.length)} 张卡`,
      };
    case 'SELECT_EFFECT_OPTIONS':
      return {
        kind: selection.kind,
        selectedCount: selection.optionIds.length,
        label: `选择 ${String(selection.optionIds.length)} 个效果选项`,
      };
    case 'SET_STAGE_FORMATION':
      return {
        kind: selection.kind,
        selectedCount: selection.placements.length,
        label: `安排 ${String(selection.placements.length)} 个舞台位置`,
      };
    case 'SELECT_SUCCESS_LIVE':
      return { kind: selection.kind, selectedCount: 1, label: '选择 1 张成功 LIVE' };
    case 'SELECT_MAIN_PHASE_ACTION':
      return { kind: selection.kind, selectedCount: 1, label: '选择主要阶段行动' };
    case 'SELECT_LIVE_SET_ACTION':
      return { kind: selection.kind, selectedCount: 1, label: '选择 LIVE 设置行动' };
    case 'SELECT_EFFECT_SLOT':
      return { kind: selection.kind, selectedCount: 1, label: `选择 ${selection.slot} 位置` };
    case 'SELECT_EFFECT_NUMBER':
      return {
        kind: selection.kind,
        selectedCount: 1,
        label: `选择数值 ${String(selection.value)}`,
      };
    default:
      return {
        kind: selection.kind,
        selectedCount: 0,
        label: readSelectionKindLabel(selection.kind),
      };
  }
}

export function summarizeAiModelInvocation(
  audit: AiModelInvocationAudit | null
): AiBattleDebugModelSummary | null {
  if (!audit) return null;
  return {
    modelId: audit.modelId,
    finalOutcome: audit.finalOutcome,
    attemptCount: audit.attempts.length,
    outcomes: audit.attempts.map((attempt) => attempt.outcome),
    totalLatencyMs: audit.attempts.reduce((total, attempt) => total + attempt.latencyMs, 0),
    inputTokens: audit.attempts.reduce((total, attempt) => total + attempt.usage.inputTokens, 0),
    outputTokens: audit.attempts.reduce((total, attempt) => total + attempt.usage.outputTokens, 0),
    estimatedCostMicrosCny: audit.attempts.reduce(
      (total, attempt) => total + attempt.estimatedCostMicrosCny,
      0
    ),
  };
}

function readSelectionKindLabel(kind: AiDecisionSelection['kind']): string {
  switch (kind) {
    case 'CONFIRM_JUDGMENT':
      return '确认 LIVE 判定';
    case 'CONFIRM_SCORE':
      return '确认分数';
    case 'CONFIRM_PHASE':
      return '确认阶段';
    case 'CANCEL_SPECIAL_MEMBER_PLAY':
      return '取消特殊登场';
    case 'CONFIRM_EFFECT':
      return '确认效果';
    case 'RESOLVE_ABILITIES_IN_ORDER':
      return '按顺序处理能力';
    case 'CONFIRM_DEADLINE':
      return '确认公开展示';
    default:
      return kind;
  }
}

function cloneTraceEntry(entry: AiBattleDebugTraceEntry): AiBattleDebugTraceEntry {
  return {
    ...entry,
    selection: entry.selection ? { ...entry.selection } : null,
    model: entry.model ? { ...entry.model, outcomes: [...entry.model.outcomes] } : null,
    modelContext: cloneModelContext(entry.modelContext),
  };
}

function cloneModelContext(
  modelContext: AiBattleDebugTraceEntry['modelContext']
): AiBattleDebugTraceEntry['modelContext'] {
  if (!modelContext) return null;
  return {
    attempts: modelContext.attempts.map((attempt) => ({
      ...attempt,
      parsedOutput: attempt.parsedOutput
        ? (JSON.parse(JSON.stringify(attempt.parsedOutput)) as AiModelDecisionOutput)
        : null,
    })),
  };
}
