import { createHash } from 'node:crypto';
import { hashAiModelRequestEnvelope, type AiModelRequestEnvelope } from './model-protocol.js';
import {
  AI_MODEL_ID,
  AI_MODEL_PROVIDER_ID,
  AI_MODEL_PROVIDER_PROFILE_VERSION,
  type AiModelProvider,
  type AiModelProviderResult,
  type AiModelProviderUsage,
} from './model-provider.js';

export const AI_MODEL_INVOCATION_POLICY_VERSION = 'ai-battle.model-invocation-policy/v1' as const;
export const AI_MODEL_DECISION_POLICY_VERSION = 'ai-battle.model-decision-policy/v1' as const;
export const AI_MODEL_INVOCATION_AUDIT_SCHEMA_VERSION =
  'ai-battle.model-invocation-audit/v1' as const;

export const AI_MODEL_INVOCATION_LIMITS = {
  timeoutMs: 12_000,
  maximumAttemptsPerDecision: 2,
  maximumConcurrentGlobal: 4,
  maximumConcurrentPerAccount: 1,
  maximumConcurrentPerMatch: 1,
  maximumRequestsPerMinuteGlobal: 30,
  maximumRequestsPerMinutePerAccount: 12,
  maximumRequestsPerMatch: 80,
  maximumEstimatedInputTokensPerCall: 64_000,
  maximumInputTokensPerMatch: 800_000,
  maximumOutputTokensPerMatch: 64_000,
  maximumEstimatedCostMicrosCnyPerMatch: 1_000_000,
} as const;

const INPUT_PRICE_MICROS_CNY_PER_MILLION_TOKENS = 800_000;
const OUTPUT_PRICE_MICROS_CNY_PER_MILLION_TOKENS = 2_000_000;
const ONE_MINUTE_MS = 60_000;

export type AiModelGovernanceDenialCode =
  | 'GLOBAL_CONCURRENCY'
  | 'ACCOUNT_CONCURRENCY'
  | 'MATCH_CONCURRENCY'
  | 'GLOBAL_RATE_LIMIT'
  | 'ACCOUNT_RATE_LIMIT'
  | 'MATCH_REQUEST_BUDGET'
  | 'MATCH_INPUT_BUDGET'
  | 'MATCH_OUTPUT_BUDGET'
  | 'MATCH_COST_BUDGET'
  | 'REQUEST_TOO_LARGE';

export type AiModelInvocationAttemptOutcome =
  | 'SUCCESS'
  | 'INVALID_JSON'
  | 'INVALID_SCHEMA'
  | 'INVALID_SELECTION'
  | 'TIMEOUT'
  | 'ABORTED'
  | 'PROVIDER_RETRYABLE'
  | 'PROVIDER_FATAL'
  | 'BUDGET_REJECTED';

export interface AiModelInvocationAttemptAudit {
  readonly attemptNumber: 1 | 2;
  readonly requestSha256: string;
  readonly requestEnvelopeVersion: AiModelRequestEnvelope['schemaVersion'];
  readonly promptVersion: AiModelRequestEnvelope['promptVersion'];
  readonly outputSchemaVersion: AiModelRequestEnvelope['outputSchemaVersion'];
  readonly providerProfileVersion: typeof AI_MODEL_PROVIDER_PROFILE_VERSION;
  readonly modelId: typeof AI_MODEL_ID;
  readonly outcome: AiModelInvocationAttemptOutcome;
  readonly latencyMs: number;
  readonly usage: AiModelProviderUsage;
  readonly estimatedCostMicrosCny: number;
  readonly providerRequestIdSha256: string | null;
  readonly governanceDenialCode: AiModelGovernanceDenialCode | null;
}

export interface AiModelInvocationAudit {
  readonly schemaVersion: typeof AI_MODEL_INVOCATION_AUDIT_SCHEMA_VERSION;
  readonly policyVersion: typeof AI_MODEL_INVOCATION_POLICY_VERSION;
  readonly providerId: typeof AI_MODEL_PROVIDER_ID;
  readonly providerProfileVersion: typeof AI_MODEL_PROVIDER_PROFILE_VERSION;
  readonly modelId: typeof AI_MODEL_ID;
  readonly finalOutcome: 'MODEL_SELECTION' | 'CONSERVATIVE_FALLBACK' | 'CANCELLED';
  readonly attempts: readonly AiModelInvocationAttemptAudit[];
}

export interface AiModelInvocationRuntime {
  invoke(input: {
    readonly matchId: string;
    readonly accountKey: string;
    readonly envelope: AiModelRequestEnvelope;
  }): Promise<AiModelInvocationAttemptResult>;
  cancelMatch(matchId: string): void;
  createAudit(
    attempts: readonly AiModelInvocationAttemptAudit[],
    finalOutcome: AiModelInvocationAudit['finalOutcome']
  ): AiModelInvocationAudit;
}

export type AiModelInvocationAttemptResult =
  | {
      readonly ok: true;
      readonly rawOutput: string;
      readonly audit: AiModelInvocationAttemptAudit;
    }
  | {
      readonly ok: false;
      readonly outcome: Exclude<AiModelInvocationAttemptOutcome, 'SUCCESS'>;
      readonly retryable: boolean;
      readonly audit: AiModelInvocationAttemptAudit;
    };

export interface CreateAiModelInvocationRuntimeInput {
  readonly provider: AiModelProvider;
  readonly now?: () => number;
  readonly scheduleTimeout?: (
    callback: () => void,
    delayMs: number
  ) => ReturnType<typeof setTimeout>;
  readonly cancelTimeout?: (handle: ReturnType<typeof setTimeout>) => void;
}

interface MatchBudgetState {
  requests: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCostMicrosCny: number;
  active: number;
}

interface Reservation {
  readonly key: string;
  readonly matchId: string;
  readonly accountKey: string;
  readonly estimatedInputTokens: number;
}

export function createAiModelInvocationRuntime(
  input: CreateAiModelInvocationRuntimeInput
): AiModelInvocationRuntime {
  const now = input.now ?? Date.now;
  const scheduleTimeout = input.scheduleTimeout ?? setTimeout;
  const cancelTimeout = input.cancelTimeout ?? clearTimeout;
  const matchBudgets = new Map<string, MatchBudgetState>();
  const accountActive = new Map<string, number>();
  const globalRequestTimes: number[] = [];
  const accountRequestTimes = new Map<string, number[]>();
  const activeControllers = new Map<
    string,
    { readonly matchId: string; readonly controller: AbortController }
  >();
  let globalActive = 0;
  let sequence = 0;

  const begin = (
    matchId: string,
    accountKey: string,
    envelope: AiModelRequestEnvelope
  ):
    | { readonly ok: true; readonly reservation: Reservation }
    | {
        readonly ok: false;
        readonly code: AiModelGovernanceDenialCode;
      } => {
    const currentTime = now();
    pruneTimes(globalRequestTimes, currentTime);
    const accountTimes = accountRequestTimes.get(accountKey) ?? [];
    pruneTimes(accountTimes, currentTime);
    accountRequestTimes.set(accountKey, accountTimes);
    const budget = matchBudgets.get(matchId) ?? {
      requests: 0,
      inputTokens: 0,
      outputTokens: 0,
      estimatedCostMicrosCny: 0,
      active: 0,
    };
    matchBudgets.set(matchId, budget);
    const estimatedInputTokens = estimateInputTokens(envelope);
    const projectedCost = estimateCostMicrosCny(estimatedInputTokens, 512);

    const denialCode =
      globalActive >= AI_MODEL_INVOCATION_LIMITS.maximumConcurrentGlobal
        ? 'GLOBAL_CONCURRENCY'
        : (accountActive.get(accountKey) ?? 0) >=
            AI_MODEL_INVOCATION_LIMITS.maximumConcurrentPerAccount
          ? 'ACCOUNT_CONCURRENCY'
          : budget.active >= AI_MODEL_INVOCATION_LIMITS.maximumConcurrentPerMatch
            ? 'MATCH_CONCURRENCY'
            : globalRequestTimes.length >= AI_MODEL_INVOCATION_LIMITS.maximumRequestsPerMinuteGlobal
              ? 'GLOBAL_RATE_LIMIT'
              : accountTimes.length >= AI_MODEL_INVOCATION_LIMITS.maximumRequestsPerMinutePerAccount
                ? 'ACCOUNT_RATE_LIMIT'
                : budget.requests >= AI_MODEL_INVOCATION_LIMITS.maximumRequestsPerMatch
                  ? 'MATCH_REQUEST_BUDGET'
                  : estimatedInputTokens >
                      AI_MODEL_INVOCATION_LIMITS.maximumEstimatedInputTokensPerCall
                    ? 'REQUEST_TOO_LARGE'
                    : budget.inputTokens + estimatedInputTokens >
                        AI_MODEL_INVOCATION_LIMITS.maximumInputTokensPerMatch
                      ? 'MATCH_INPUT_BUDGET'
                      : budget.outputTokens >=
                          AI_MODEL_INVOCATION_LIMITS.maximumOutputTokensPerMatch
                        ? 'MATCH_OUTPUT_BUDGET'
                        : budget.estimatedCostMicrosCny + projectedCost >
                            AI_MODEL_INVOCATION_LIMITS.maximumEstimatedCostMicrosCnyPerMatch
                          ? 'MATCH_COST_BUDGET'
                          : null;
    if (denialCode) return { ok: false, code: denialCode };

    sequence += 1;
    const reservation = {
      key: `${matchId}:${String(sequence)}`,
      matchId,
      accountKey,
      estimatedInputTokens,
    };
    budget.requests += 1;
    budget.inputTokens += estimatedInputTokens;
    budget.estimatedCostMicrosCny += projectedCost;
    budget.active += 1;
    globalActive += 1;
    accountActive.set(accountKey, (accountActive.get(accountKey) ?? 0) + 1);
    globalRequestTimes.push(currentTime);
    accountTimes.push(currentTime);
    return { ok: true, reservation };
  };

  const finish = (
    reservation: Reservation,
    usage: AiModelProviderUsage,
    hasActualUsage: boolean
  ): number => {
    const reservedCost = estimateCostMicrosCny(reservation.estimatedInputTokens, 512);
    const budget = matchBudgets.get(reservation.matchId);
    if (budget) {
      budget.active = Math.max(0, budget.active - 1);
      if (hasActualUsage) {
        budget.inputTokens += usage.inputTokens - reservation.estimatedInputTokens;
        budget.outputTokens += usage.outputTokens;
        const actualCost = estimateCostMicrosCny(usage.inputTokens, usage.outputTokens);
        budget.estimatedCostMicrosCny += actualCost - reservedCost;
      }
    }
    globalActive = Math.max(0, globalActive - 1);
    const accountCount = Math.max(0, (accountActive.get(reservation.accountKey) ?? 1) - 1);
    if (accountCount === 0) accountActive.delete(reservation.accountKey);
    else accountActive.set(reservation.accountKey, accountCount);
    return hasActualUsage
      ? estimateCostMicrosCny(usage.inputTokens, usage.outputTokens)
      : reservedCost;
  };

  return {
    async invoke({ matchId, accountKey, envelope }) {
      const attemptNumber = envelope.attempt.attemptNumber;
      const requestSha256 = hashAiModelRequestEnvelope(envelope);
      const startedAt = now();
      const acquired = begin(matchId, accountKey, envelope);
      if (!acquired.ok) {
        return {
          ok: false,
          outcome: 'BUDGET_REJECTED',
          retryable: false,
          audit: createAttemptAudit({
            envelope,
            attemptNumber,
            requestSha256,
            outcome: 'BUDGET_REJECTED',
            latencyMs: 0,
            usage: emptyUsage(),
            estimatedCostMicrosCny: 0,
            providerRequestId: null,
            governanceDenialCode: acquired.code,
          }),
        };
      }

      const controller = new AbortController();
      activeControllers.set(acquired.reservation.key, { matchId, controller });
      let timedOut = false;
      const timeout = scheduleTimeout(() => {
        timedOut = true;
        controller.abort();
      }, AI_MODEL_INVOCATION_LIMITS.timeoutMs);

      let providerResult: AiModelProviderResult;
      try {
        providerResult = await input.provider.invoke(
          {
            systemMessage: JSON.stringify({
              schemaVersion: envelope.schemaVersion,
              promptVersion: envelope.promptVersion,
              systemInstruction: envelope.systemInstruction,
              responseContract: envelope.responseContract,
            }),
            userMessage: JSON.stringify({
              attempt: envelope.attempt,
              strategyContext: envelope.strategyContext,
            }),
          },
          controller.signal
        );
      } catch {
        providerResult = controller.signal.aborted
          ? { ok: false, code: 'ABORTED', retryable: false }
          : { ok: false, code: 'NETWORK', retryable: true };
      } finally {
        cancelTimeout(timeout);
        activeControllers.delete(acquired.reservation.key);
      }

      const usage = providerResult.ok ? providerResult.usage : emptyUsage();
      const hasActualUsage = providerResult.ok && hasCompleteProviderUsage(usage);
      const estimatedCostMicrosCny = finish(acquired.reservation, usage, hasActualUsage);
      const latencyMs = Math.max(0, now() - startedAt);
      if (!providerResult.ok) {
        const outcome: Exclude<AiModelInvocationAttemptOutcome, 'SUCCESS'> = timedOut
          ? 'TIMEOUT'
          : providerResult.code === 'ABORTED'
            ? 'ABORTED'
            : providerResult.retryable
              ? 'PROVIDER_RETRYABLE'
              : 'PROVIDER_FATAL';
        return {
          ok: false,
          outcome,
          retryable: outcome === 'TIMEOUT' || outcome === 'PROVIDER_RETRYABLE',
          audit: createAttemptAudit({
            envelope,
            attemptNumber,
            requestSha256,
            outcome,
            latencyMs,
            usage,
            estimatedCostMicrosCny,
            providerRequestId: null,
            governanceDenialCode: null,
          }),
        };
      }
      return {
        ok: true,
        rawOutput: providerResult.rawOutput,
        audit: createAttemptAudit({
          envelope,
          attemptNumber,
          requestSha256,
          outcome: 'SUCCESS',
          latencyMs,
          usage,
          estimatedCostMicrosCny,
          providerRequestId: providerResult.providerRequestId,
          governanceDenialCode: null,
        }),
      };
    },
    cancelMatch(matchId) {
      for (const active of activeControllers.values()) {
        if (active.matchId === matchId) active.controller.abort();
      }
    },
    createAudit(attempts, finalOutcome) {
      return {
        schemaVersion: AI_MODEL_INVOCATION_AUDIT_SCHEMA_VERSION,
        policyVersion: AI_MODEL_INVOCATION_POLICY_VERSION,
        providerId: AI_MODEL_PROVIDER_ID,
        providerProfileVersion: input.provider.profileVersion,
        modelId: input.provider.modelId,
        finalOutcome,
        attempts: attempts.map((attempt) => ({ ...attempt, usage: { ...attempt.usage } })),
      };
    },
  };
}

function createAttemptAudit(input: {
  readonly envelope: AiModelRequestEnvelope;
  readonly attemptNumber: 1 | 2;
  readonly requestSha256: string;
  readonly outcome: AiModelInvocationAttemptOutcome;
  readonly latencyMs: number;
  readonly usage: AiModelProviderUsage;
  readonly estimatedCostMicrosCny: number;
  readonly providerRequestId: string | null;
  readonly governanceDenialCode: AiModelGovernanceDenialCode | null;
}): AiModelInvocationAttemptAudit {
  return {
    attemptNumber: input.attemptNumber,
    requestSha256: input.requestSha256,
    requestEnvelopeVersion: input.envelope.schemaVersion,
    promptVersion: input.envelope.promptVersion,
    outputSchemaVersion: input.envelope.outputSchemaVersion,
    providerProfileVersion: AI_MODEL_PROVIDER_PROFILE_VERSION,
    modelId: AI_MODEL_ID,
    outcome: input.outcome,
    latencyMs: input.latencyMs,
    usage: { ...input.usage },
    estimatedCostMicrosCny: input.estimatedCostMicrosCny,
    providerRequestIdSha256: input.providerRequestId
      ? `sha256:${createHash('sha256').update(input.providerRequestId).digest('hex')}`
      : null,
    governanceDenialCode: input.governanceDenialCode,
  };
}

function emptyUsage(): AiModelProviderUsage {
  return { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
}

function hasCompleteProviderUsage(usage: AiModelProviderUsage): boolean {
  return (
    usage.inputTokens > 0 &&
    usage.outputTokens > 0 &&
    usage.totalTokens >= usage.inputTokens + usage.outputTokens
  );
}

function estimateInputTokens(envelope: AiModelRequestEnvelope): number {
  return Math.ceil(Buffer.byteLength(JSON.stringify(envelope), 'utf8') / 3);
}

function estimateCostMicrosCny(inputTokens: number, outputTokens: number): number {
  return Math.ceil(
    (inputTokens * INPUT_PRICE_MICROS_CNY_PER_MILLION_TOKENS +
      outputTokens * OUTPUT_PRICE_MICROS_CNY_PER_MILLION_TOKENS) /
      1_000_000
  );
}

function pruneTimes(times: number[], now: number): void {
  while (times.length > 0 && now - times[0]! >= ONE_MINUTE_MS) times.shift();
}
