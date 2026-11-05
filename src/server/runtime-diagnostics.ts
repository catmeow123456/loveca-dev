import { monitorEventLoopDelay, type IntervalHistogram } from 'node:perf_hooks';
import { pool } from './db/pool.js';

let eventLoop: IntervalHistogram | undefined;

export function startRuntimeDiagnostics(): void {
  if (eventLoop) return;
  eventLoop = monitorEventLoopDelay({ resolution: 20 });
  eventLoop.enable();
}

export function stopRuntimeDiagnostics(): void {
  eventLoop?.disable();
  eventLoop = undefined;
}

export function readRuntimeDiagnostics() {
  return {
    databasePool: {
      total: pool.totalCount,
      idle: pool.idleCount,
      waiting: pool.waitingCount,
    },
    // Histogram spans the time since the last periodic runtime-stats entry.
    // Error/slow-operation reads do not reset it.
    eventLoopDelayMs:
      eventLoop && eventLoop.count > 0
        ? {
            mean: eventLoop.mean / 1e6,
            p99: eventLoop.percentile(99) / 1e6,
            max: eventLoop.max / 1e6,
          }
        : null,
  };
}

export function resetRuntimeDiagnosticsWindow(): void {
  eventLoop?.reset();
}
