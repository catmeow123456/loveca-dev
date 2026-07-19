import { ApiClientError } from '@/lib/apiClient';

export type SpectatorPollingErrorKind = 'RATE_LIMITED' | 'NETWORK' | 'OTHER';

export interface SpectatorPollingErrorState {
  readonly error: unknown;
  readonly kind: SpectatorPollingErrorKind;
  readonly retryAfterMs: number;
  readonly retryAt: number;
}

interface SpectatorPollingSchedulerOptions {
  readonly intervalMs: number;
  readonly poll: () => Promise<void>;
  readonly onSuccess?: () => void;
  readonly onError?: (state: SpectatorPollingErrorState) => void;
  readonly maxNetworkBackoffMs?: number;
  readonly now?: () => number;
  readonly random?: () => number;
  readonly setTimer?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  readonly clearTimer?: (timer: ReturnType<typeof setTimeout>) => void;
}

const RATE_LIMIT_BOUNDARY_PADDING_MS = 50;

export class SpectatorPollingScheduler {
  private readonly intervalMs: number;
  private readonly poll: () => Promise<void>;
  private readonly onSuccess?: () => void;
  private readonly onError?: (state: SpectatorPollingErrorState) => void;
  private readonly maxNetworkBackoffMs: number;
  private readonly now: () => number;
  private readonly random: () => number;
  private readonly setTimer: NonNullable<SpectatorPollingSchedulerOptions['setTimer']>;
  private readonly clearTimer: NonNullable<SpectatorPollingSchedulerOptions['clearTimer']>;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private inFlight = false;
  private generation = 0;
  private networkFailureCount = 0;

  constructor(options: SpectatorPollingSchedulerOptions) {
    this.intervalMs = options.intervalMs;
    this.poll = options.poll;
    this.onSuccess = options.onSuccess;
    this.onError = options.onError;
    this.maxNetworkBackoffMs = options.maxNetworkBackoffMs ?? 15_000;
    this.now = options.now ?? (() => Date.now());
    this.random = options.random ?? Math.random;
    this.setTimer = options.setTimer ?? ((callback, delayMs) => setTimeout(callback, delayMs));
    this.clearTimer = options.clearTimer ?? ((timer) => clearTimeout(timer));
  }

  start(): void {
    if (this.running) {
      return;
    }
    this.running = true;
    this.schedule(this.intervalMs);
  }

  pause(): void {
    this.running = false;
    this.generation += 1;
    if (this.timer !== null) {
      this.clearTimer(this.timer);
      this.timer = null;
    }
  }

  resume(error?: unknown): void {
    this.pause();
    this.running = true;
    if (error === undefined) {
      this.schedule(this.intervalMs);
      return;
    }
    const errorState = this.buildErrorState(error);
    this.onError?.(errorState);
    this.schedule(errorState.retryAfterMs);
  }

  dispose(): void {
    this.pause();
  }

  private schedule(delayMs: number): void {
    if (!this.running || this.timer !== null) {
      return;
    }
    const generation = this.generation;
    this.timer = this.setTimer(
      () => {
        this.timer = null;
        void this.runPoll(generation);
      },
      Math.max(0, delayMs)
    );
  }

  private async runPoll(generation: number): Promise<void> {
    if (!this.running || generation !== this.generation) {
      return;
    }
    if (this.inFlight) {
      this.schedule(this.intervalMs);
      return;
    }
    this.inFlight = true;
    let nextDelayMs = this.intervalMs;
    try {
      await this.poll();
      if (!this.isCurrent(generation)) {
        return;
      }
      this.networkFailureCount = 0;
      this.onSuccess?.();
    } catch (error) {
      if (!this.isCurrent(generation)) {
        return;
      }
      const errorState = this.buildErrorState(error);
      nextDelayMs = errorState.retryAfterMs;
      this.onError?.(errorState);
    } finally {
      this.inFlight = false;
      if (this.isCurrent(generation)) {
        this.schedule(nextDelayMs);
      }
    }
  }

  private isCurrent(generation: number): boolean {
    return this.running && generation === this.generation;
  }

  private buildErrorState(error: unknown): SpectatorPollingErrorState {
    const kind = classifyPollingError(error);
    let retryAfterMs = this.intervalMs;
    if (kind === 'RATE_LIMITED') {
      const serverDelay = error instanceof ApiClientError ? error.retryAfterMs : undefined;
      retryAfterMs = Math.max(this.intervalMs, serverDelay ?? this.intervalMs);
      retryAfterMs += RATE_LIMIT_BOUNDARY_PADDING_MS;
    } else if (kind === 'NETWORK') {
      this.networkFailureCount += 1;
      const exponentialDelay = Math.min(
        this.maxNetworkBackoffMs,
        this.intervalMs * 2 ** this.networkFailureCount
      );
      const jitterFactor = 0.8 + this.random() * 0.4;
      retryAfterMs = Math.max(this.intervalMs, Math.round(exponentialDelay * jitterFactor));
    } else {
      this.networkFailureCount = 0;
    }
    return {
      error,
      kind,
      retryAfterMs,
      retryAt: this.now() + retryAfterMs,
    };
  }
}

function classifyPollingError(error: unknown): SpectatorPollingErrorKind {
  if (!(error instanceof ApiClientError)) {
    return 'OTHER';
  }
  if (error.code === 'ONLINE_SPECTATOR_RATE_LIMITED' && error.status === 429) {
    return 'RATE_LIMITED';
  }
  if (error.code === 'NETWORK_ERROR' || error.code === 'TIMEOUT') {
    return 'NETWORK';
  }
  return 'OTHER';
}
