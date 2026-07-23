export interface SerialPollingSchedulerOptions {
  readonly intervalMs: number;
  readonly poll: () => Promise<void>;
  readonly runImmediately?: boolean;
  readonly setTimer?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  readonly clearTimer?: (timer: ReturnType<typeof setTimeout>) => void;
}

export class SerialPollingScheduler {
  private readonly intervalMs: number;
  private readonly poll: () => Promise<void>;
  private readonly runImmediately: boolean;
  private readonly setTimer: NonNullable<SerialPollingSchedulerOptions['setTimer']>;
  private readonly clearTimer: NonNullable<SerialPollingSchedulerOptions['clearTimer']>;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private inFlight = false;

  constructor(options: SerialPollingSchedulerOptions) {
    this.intervalMs = options.intervalMs;
    this.poll = options.poll;
    this.runImmediately = options.runImmediately ?? true;
    this.setTimer = options.setTimer ?? ((callback, delayMs) => setTimeout(callback, delayMs));
    this.clearTimer = options.clearTimer ?? ((timer) => clearTimeout(timer));
  }

  start(): void {
    if (this.running) {
      return;
    }
    this.running = true;
    this.schedule(this.runImmediately ? 0 : this.intervalMs);
  }

  dispose(): void {
    this.running = false;
    if (this.timer !== null) {
      this.clearTimer(this.timer);
      this.timer = null;
    }
  }

  private schedule(delayMs: number): void {
    if (!this.running || this.timer !== null || this.inFlight) {
      return;
    }
    this.timer = this.setTimer(() => {
      this.timer = null;
      void this.runPoll();
    }, Math.max(0, delayMs));
  }

  private async runPoll(): Promise<void> {
    if (!this.running || this.inFlight) {
      return;
    }
    this.inFlight = true;
    try {
      await this.poll();
    } finally {
      this.inFlight = false;
      this.schedule(this.intervalMs);
    }
  }
}

export class LatestRequestGate {
  private generation = 0;

  begin(): number {
    this.generation += 1;
    return this.generation;
  }

  invalidate(): void {
    this.generation += 1;
  }

  isCurrent(requestGeneration: number): boolean {
    return requestGeneration === this.generation;
  }
}
