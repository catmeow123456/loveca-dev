export interface SingleMatchCriticalSection {
  readonly matchId: string;
  readonly token: symbol;
}

/**
 * Single-process FIFO critical section keyed by match ID.
 *
 * The executor deliberately owns no game semantics. Online player commands,
 * machine submissions, undo, deadlines and recovery can share it without
 * introducing an AI-only lock. Multi-process fencing remains a later phase.
 */
export class SingleMatchSerialExecutor {
  private readonly tails = new Map<string, Promise<void>>();
  private readonly activeSections = new Set<SingleMatchCriticalSection>();

  runExclusive<T>(
    matchId: string,
    operation: (criticalSection: SingleMatchCriticalSection) => Promise<T> | T
  ): Promise<T> {
    if (!matchId.trim()) {
      return Promise.reject(new Error('matchId 不能为空'));
    }
    const previous = this.tails.get(matchId) ?? Promise.resolve();
    const result = previous
      .catch(() => undefined)
      .then(async () => {
        const criticalSection = { matchId, token: Symbol(matchId) };
        this.activeSections.add(criticalSection);
        try {
          return await operation(criticalSection);
        } finally {
          this.activeSections.delete(criticalSection);
        }
      });
    const tail = result.then(
      () => undefined,
      () => undefined
    );
    this.tails.set(matchId, tail);
    void tail.finally(() => {
      if (this.tails.get(matchId) === tail) {
        this.tails.delete(matchId);
      }
    });
    return result;
  }

  hasPendingOperations(matchId: string): boolean {
    return this.tails.has(matchId);
  }

  isExecutingMatch(
    matchId: string,
    criticalSection: SingleMatchCriticalSection | null | undefined
  ): boolean {
    return criticalSection?.matchId === matchId && this.activeSections.has(criticalSection);
  }
}
