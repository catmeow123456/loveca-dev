import type { GameCommand } from '../../application/game-commands.js';
import type { Seat } from '../../online/types.js';
import {
  parseAiBattleResponse,
  validateSelection,
  type AiDecision,
  type AiDecisionInput,
  type AiDecisionQuery,
  type AiSelection,
} from './protocol.js';
import { getAiFallbackSelection, getAiMechanicalSelection } from './policy.js';
import type { AiBattleTraceObserver } from './trace-store.js';
import type { PlayerViewState } from '../../online/types.js';
import { AiDecisionContext, type AiPublicObservation } from './decision-context.js';

export const AI_MODEL_TIMEOUT_MS = 30_000;
export const AI_SERVICE_RETRY_LIMIT = 1;
export const AI_CONSECUTIVE_FAILURE_LIMIT = 3;

export type AiModelOutcome =
  | { readonly kind: 'RESPONSE'; readonly text: string; readonly truncated?: boolean }
  | { readonly kind: 'ADAPTER_ERROR'; readonly message: string }
  | { readonly kind: 'SERVICE_ERROR'; readonly message: string; readonly retryable: boolean };

export type AiSelectionSource = 'MODEL' | 'MECHANICAL' | 'FALLBACK';

export interface AiTaskIdentity {
  readonly taskId: string;
  readonly revision: number;
  readonly windowKey: string;
}

export interface AiModelTask extends AiTaskIdentity {
  readonly input: AiDecisionInput;
  readonly attempt: number;
  readonly signal: AbortSignal;
}

export type AiBattleAdvanceResult =
  | { readonly kind: 'MODEL'; readonly task: AiModelTask }
  | { readonly kind: 'WAIT'; readonly deadlineAt: number; readonly reason: string }
  | { readonly kind: 'IDLE' | 'BUSY' | 'STALE' | 'ACCEPTED' | 'ENDED' }
  | { readonly kind: 'STOPPED'; readonly reason: string };

export interface AiPreparedSelection {
  readonly source: AiSelectionSource;
  readonly selection: AiSelection;
  readonly tradeoff?: string;
}

export interface AiRuntimeTask extends AiTaskIdentity {
  readonly decision: AiDecision;
  readonly controller: AbortController;
  attempt: number;
  prepared: AiPreparedSelection | null;
}

/** All mutating methods run inside OnlineMatchService's existing match queue. */
export class AiBattleRuntime {
  current: AiRuntimeTask | null = null;
  consecutiveFailures = 0;
  stoppedReason: string | null = null;
  ended = false;
  private sequence = 0;
  private observationId: string | null = null;
  private readonly context: AiDecisionContext;

  constructor(
    readonly seat: Seat,
    readonly wake: () => void,
    private readonly observer?: AiBattleTraceObserver
  ) {
    this.context = new AiDecisionContext(seat);
  }

  get observedPublicSeq(): number {
    return this.context.publicSeq;
  }

  invalidate(reason: 'STALE' | 'ACCEPTED' | 'STOPPED' | 'ENDED' = 'STALE'): void {
    if (this.current && reason === 'STALE') this.record('INVALIDATED', { reason }, 'STALE');
    this.current?.controller.abort();
    this.current = null;
  }

  stop(reason: string): AiBattleAdvanceResult {
    this.stoppedReason ??= reason;
    this.record(
      'STOP',
      {
        reason: this.stoppedReason,
        consecutiveFailures: this.consecutiveFailures,
        limit: AI_CONSECUTIVE_FAILURE_LIMIT,
      },
      'STOPPED'
    );
    this.invalidate('STOPPED');
    return { kind: 'STOPPED', reason: this.stoppedReason };
  }

  end(): void {
    if (this.ended) return;
    this.ended = true;
    this.record('END', {
      consecutiveFailures: this.consecutiveFailures,
      stoppedReason: this.stoppedReason,
    });
    this.invalidate('ENDED');
    this.capture(() => this.observer?.end());
  }

  observe(
    revision: number,
    windowKey: string,
    query: AiDecisionQuery,
    view?: PlayerViewState,
    publicObservation?: AiPublicObservation
  ): AiBattleAdvanceResult | null {
    if (this.ended) return { kind: 'ENDED' };
    if (this.stoppedReason) return { kind: 'STOPPED', reason: this.stoppedReason };
    if (view) this.context.observe(view, publicObservation);
    if (this.current) return this.current.prepared ? null : { kind: 'BUSY' };
    if (query.kind === 'DECISION')
      query = {
        ...query,
        decision: {
          ...query.decision,
          input: {
            ...query.decision.input,
            context: this.context.input(query.decision.input.state.turn),
          },
        },
      };
    const id = String(++this.sequence);
    this.observationId = id;
    this.capture(() =>
      this.observer?.begin({
        id,
        revision,
        windowKey,
        seat: this.seat,
        purpose: query.kind === 'DECISION' ? query.decision.input.purpose : query.kind,
      })
    );
    this.record('SAMPLE', {
      identity: { id, revision, windowKey, seat: this.seat },
      queryKind: query.kind,
      view: view ?? null,
      input: query.kind === 'DECISION' ? query.decision.input : null,
      querySources: ['projectPlayerViewState', 'buildAiBattleDecision'],
      ...(query.kind === 'UNSUPPORTED' ? { reason: query.reason } : {}),
    });
    switch (query.kind) {
      case 'ENDED':
        this.end();
        return { kind: 'ENDED' };
      case 'WAITING_FOR_PLAYER':
        this.record('WAIT', { reason: 'HUMAN_INPUT' }, 'WAITING');
        return { kind: 'IDLE' };
      case 'WAITING_FOR_TIME':
        this.record('WAIT', { reason: query.reason, deadlineAt: query.deadlineAt }, 'WAITING');
        return { kind: 'WAIT', deadlineAt: query.deadlineAt, reason: query.reason };
      case 'UNSUPPORTED':
        return this.stop(`ADAPTER_UNSUPPORTED: ${query.reason}`);
      case 'DECISION': {
        const task: AiRuntimeTask = {
          taskId: id,
          revision,
          windowKey,
          decision: query.decision,
          controller: new AbortController(),
          attempt: 0,
          prepared: null,
        };
        this.current = task;
        try {
          const selection = getAiMechanicalSelection(task.decision);
          if (selection) {
            validateSelection(task.decision.input.space, selection);
            task.prepared = { source: 'MECHANICAL', selection };
            this.record('PREPARED', { ...task.prepared, validation: 'VALID' });
            return null;
          }
          return this.modelRequest(task);
        } catch (error) {
          return this.stop(`ADAPTER_MECHANICAL: ${errorMessage(error)}`);
        }
      }
    }
  }

  isCurrent(identity: AiTaskIdentity): boolean {
    return (
      !this.ended &&
      !this.stoppedReason &&
      this.current?.taskId === identity.taskId &&
      this.current.revision === identity.revision &&
      this.current.windowKey === identity.windowKey
    );
  }

  resolve(outcome: AiModelOutcome): AiBattleAdvanceResult | null {
    const task = this.current;
    if (!task || task.prepared) return { kind: 'STALE' };
    if (outcome.kind === 'ADAPTER_ERROR') return this.stop(`ADAPTER_CONTEXT: ${outcome.message}`);
    if (
      outcome.kind === 'SERVICE_ERROR' &&
      outcome.retryable &&
      task.attempt < AI_SERVICE_RETRY_LIMIT
    ) {
      task.attempt++;
      this.record('SERVICE_RETRY', {
        reason: outcome.message,
        attempt: task.attempt,
        limit: AI_SERVICE_RETRY_LIMIT,
      });
      return this.modelRequest(task);
    }
    let failure: string;
    if (outcome.kind === 'RESPONSE') {
      try {
        if (outcome.truncated) throw new Error('Upstream output truncated');
        const { selection, tradeoff } = parseAiBattleResponse(task.decision, outcome.text);
        task.prepared = { source: 'MODEL', selection, ...(tradeoff ? { tradeoff } : {}) };
        this.record('MODEL_VALIDATION', { selection, tradeoff, validation: 'VALID' });
        return null;
      } catch (error) {
        failure = `MODEL_SELECTION: ${errorMessage(error)}`;
      }
    } else {
      failure = `MODEL_SERVICE: ${outcome.message}`;
    }
    this.consecutiveFailures++;
    this.record('MODEL_FAILURE', {
      failure,
      consecutiveFailures: this.consecutiveFailures,
      limit: AI_CONSECUTIVE_FAILURE_LIMIT,
    });
    if (this.consecutiveFailures >= AI_CONSECUTIVE_FAILURE_LIMIT)
      return this.stop(`CONSECUTIVE_FAILURE_LIMIT: ${failure}`);
    try {
      const selection = getAiFallbackSelection(task.decision);
      validateSelection(task.decision.input.space, selection);
      task.prepared = { source: 'FALLBACK', selection };
      this.record('PREPARED', {
        ...task.prepared,
        validation: 'VALID',
        reason: failure,
        policy: 'getAiFallbackSelection',
      });
      return null;
    } catch (error) {
      return this.stop(`ADAPTER_FALLBACK: ${errorMessage(error)}`);
    }
  }

  command(now: number): GameCommand {
    const task = this.current;
    if (!task?.prepared) throw new Error('No prepared AI selection');
    validateSelection(task.decision.input.space, task.prepared.selection);
    return task.decision.toCommand(task.prepared.selection, now);
  }

  accepted(view?: PlayerViewState, publicObservation?: AiPublicObservation): void {
    const task = this.current;
    if (task?.prepared)
      this.context.accepted(
        task.decision.input,
        task.prepared.selection,
        task.prepared.source,
        task.prepared.tradeoff,
        view
      );
    if (view) this.context.observe(view, publicObservation);
    if (this.current?.prepared?.source === 'MODEL') this.consecutiveFailures = 0;
    this.record(
      'ACCEPTED',
      { selection: this.current?.prepared, consecutiveFailures: this.consecutiveFailures },
      'ACCEPTED'
    );
    this.invalidate('ACCEPTED');
  }

  record(stage: string, payload: unknown, status?: string): void {
    if (!this.observer) return;
    this.capture(() => {
      if (!this.observationId) {
        this.observationId = `unsampled:${++this.sequence}`;
        this.observer!.begin({
          id: this.observationId,
          revision: -1,
          windowKey: 'UNSAMPLED',
          seat: this.seat,
          purpose: 'CAPTURE_BEFORE_SAMPLE',
        });
      }
      this.observer!.append(this.observationId, stage, payload, { status });
    });
  }

  private capture(write: () => void): void {
    try {
      write();
    } catch {
      this.observer?.reportFailure();
    }
  }

  private modelRequest(task: AiRuntimeTask): AiBattleAdvanceResult {
    return {
      kind: 'MODEL',
      task: {
        taskId: task.taskId,
        revision: task.revision,
        windowKey: task.windowKey,
        input: globalThis.structuredClone(task.decision.input),
        attempt: task.attempt,
        signal: task.controller.signal,
      },
    };
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
