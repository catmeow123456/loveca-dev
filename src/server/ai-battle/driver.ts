import type { CodexAiReasoningEffort } from '../../online/ai-battle-model-registry.js';
import type { CodexBattleBudget } from '../../online/ai-battle-billing-types.js';
import type { OnlineMatchService } from '../services/online-match-service.js';
import {
  AI_MODEL_TIMEOUT_MS,
  type AiBattleAdvanceResult,
  type AiModelOutcome,
  type AiModelTask,
} from './runtime.js';
import type { AiDecisionInput } from './protocol.js';
import type { AiBattleTraceObserver } from './trace-store.js';
import type { AiKnowledgeMaterial } from './presets.js';
import { safeAiErrorForLog } from './billing.js';

export interface AiBattleModelClient {
  dispose?(): Promise<void>;
  readonly reasoningEffort?: CodexAiReasoningEffort;
  readonly fastMode?: boolean;
  readonly codexBudget?: CodexBattleBudget;
  /** Trusted provider deadline, bounded to 120 s; never read from model output. */
  readonly requestTimeoutMs?: number;
  readonly stopOnTimeout?: boolean;
  readonly configurationMaterial?: AiKnowledgeMaterial;
  decide(
    input: AiDecisionInput,
    signal: AbortSignal,
    context: AiModelRequestContext
  ): Promise<AiModelOutcome>;
}

export interface AiModelRequestContext {
  readonly matchId: string;
  readonly taskId: string;
  readonly revision: number;
  readonly windowKey: string;
  readonly attempt: number;
}

interface DrivenMatch {
  readonly matchId: string;
  readonly model: AiBattleModelClient;
  readonly observer?: AiBattleTraceObserver;
  readonly requests: Set<string>;
  observing: boolean;
  dirty: boolean;
  wakeGeneration: number;
  timer: ReturnType<typeof setTimeout> | null;
}

/** Network calls never occupy the authority queue. Each wake samples through the match service. */
export class AiBattleDriver {
  private readonly matches = new Map<string, DrivenMatch>();

  constructor(
    private readonly service: Pick<
      OnlineMatchService,
      'attachAiBattle' | 'advanceAiBattle' | 'completeAiBattleTask'
    >,
    private readonly now: () => number = Date.now
  ) {}

  async start(
    matchId: string,
    model: AiBattleModelClient,
    observer?: AiBattleTraceObserver
  ): Promise<void> {
    if (this.matches.has(matchId)) throw new Error('AI driver already started');
    const entry: DrivenMatch = {
      matchId,
      model,
      observer,
      requests: new Set(),
      observing: false,
      dirty: false,
      wakeGeneration: 0,
      timer: null,
    };
    this.matches.set(matchId, entry);
    try {
      await this.service.attachAiBattle(matchId, () => this.wake(entry), observer);
    } catch (error) {
      await this.stop(matchId);
      throw error;
    }
  }

  async stop(matchId: string): Promise<void> {
    const entry = this.matches.get(matchId);
    if (!entry) return;
    this.matches.delete(matchId);
    if (entry.timer) clearTimeout(entry.timer);
    try {
      await entry.model.dispose?.();
    } catch (error) {
      this.reportFault(entry, 'request', error);
    }
  }

  private wake(entry: DrivenMatch): void {
    if (this.matches.get(entry.matchId) !== entry) return;
    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = null;
    entry.wakeGeneration++;
    entry.dirty = true;
    // Terminal catch: the observe loop has an inner finally, but a rejection from the
    // serialized-queue wrapper itself must never become an unhandled rejection.
    if (!entry.observing)
      void this.observe(entry).catch((error) => this.reportFault(entry, 'observe', error));
  }

  private async observe(entry: DrivenMatch): Promise<void> {
    entry.observing = true;
    try {
      while (entry.dirty && this.matches.get(entry.matchId) === entry) {
        entry.dirty = false;
        const generation = entry.wakeGeneration;
        const result = await this.service.advanceAiBattle(entry.matchId);
        this.handle(entry, result, generation);
      }
    } finally {
      entry.observing = false;
    }
  }

  private handle(entry: DrivenMatch, result: AiBattleAdvanceResult, generation: number): void {
    if (this.matches.get(entry.matchId) !== entry) return;
    switch (result.kind) {
      case 'MODEL': {
        const key = `${result.task.taskId}:${result.task.attempt}`;
        if (result.task.signal.aborted || entry.requests.has(key)) return;
        entry.requests.add(key);
        void this.request(entry, result.task)
          .catch((error) => this.reportFault(entry, 'request', error))
          .finally(() => entry.requests.delete(key));
        return;
      }
      case 'WAIT':
        if (entry.wakeGeneration !== generation) return;
        if (entry.timer) clearTimeout(entry.timer);
        entry.timer = setTimeout(
          () => {
            entry.timer = null;
            this.wake(entry);
          },
          Math.max(0, result.deadlineAt - this.now())
        );
        entry.timer.unref?.();
        return;
      case 'ENDED':
      case 'STOPPED':
        void this.stop(entry.matchId);
        return;
      case 'ACCEPTED':
        // Authority-change notification already schedules the next observation.
        return;
      case 'STALE':
      case 'IDLE':
      case 'BUSY':
        return;
    }
  }

  private async request(entry: DrivenMatch, task: AiModelTask): Promise<void> {
    const outcome = await requestWithDeadline(entry.model, task, entry.matchId);
    this.capture(entry, task, 'MODEL_OUTCOME', outcome);
    const generation = entry.wakeGeneration;
    const result = await this.service.completeAiBattleTask(entry.matchId, task, outcome);
    this.capture(entry, task, 'COMPLETION', {
      kind: result.kind,
      ...('reason' in result ? { reason: result.reason } : {}),
      ...('deadlineAt' in result ? { deadlineAt: result.deadlineAt } : {}),
    });
    if (!task.signal.aborted) this.handle(entry, result, generation);
  }

  private capture(entry: DrivenMatch, task: AiModelTask, stage: string, payload: unknown): void {
    try {
      entry.observer?.append(task.taskId, stage, { attempt: task.attempt, outcome: payload });
    } catch {
      entry.observer?.reportFailure();
    }
  }

  /** Sanitized last-resort log; error text is URL-redacted and never reflects credentials. */
  private reportFault(entry: DrivenMatch, stage: 'observe' | 'request', error: unknown): void {
    console.error(`[AiBattleDriver] ${stage} failed`, {
      matchId: entry.matchId,
      ...safeAiErrorForLog(error),
    });
  }
}

async function requestWithDeadline(
  model: AiBattleModelClient,
  task: AiModelTask,
  matchId: string
): Promise<AiModelOutcome> {
  const controller = new AbortController();
  let finishAbort!: (outcome: AiModelOutcome) => void;
  const interrupted = new Promise<AiModelOutcome>((resolve) => {
    finishAbort = resolve;
  });
  const cancel = () => {
    finishAbort({ kind: 'SERVICE_ERROR', message: 'Task superseded', retryable: false });
    controller.abort();
  };
  const timer = setTimeout(
    () => {
      finishAbort(
        model.stopOnTimeout
          ? { kind: 'ADAPTER_ERROR', message: 'Model request timed out; provider requires stop' }
          : { kind: 'SERVICE_ERROR', message: 'Model request timed out', retryable: true }
      );
      controller.abort();
    },
    Math.max(1, Math.min(model.requestTimeoutMs ?? AI_MODEL_TIMEOUT_MS, 120_000))
  );
  timer.unref?.();
  task.signal.addEventListener('abort', cancel, { once: true });
  try {
    if (task.signal.aborted) {
      cancel();
      return await interrupted;
    }
    const response = Promise.resolve().then(() =>
      model.decide(task.input, controller.signal, {
        matchId,
        taskId: task.taskId,
        revision: task.revision,
        windowKey: task.windowKey,
        attempt: task.attempt,
      })
    );
    return await Promise.race([response, interrupted]);
  } catch {
    // Typed service failures come from the client; unexpected client faults are not retryable.
    return {
      kind: 'SERVICE_ERROR',
      message: 'Unexpected model client failure',
      retryable: false,
    };
  } finally {
    clearTimeout(timer);
    task.signal.removeEventListener('abort', cancel);
  }
}
