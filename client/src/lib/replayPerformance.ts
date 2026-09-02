export const REPLAY_PERFORMANCE_ENTRY_NAME = 'loveca:replay:event';
export const REPLAY_PERFORMANCE_PROBE_STORAGE_KEY = 'loveca:replayPerformanceProbe';
export const REPLAY_PREFETCH_STORAGE_KEY = 'loveca:replayAdjacentPrefetch';

export type ReplayPerformanceEvent =
  | 'CONTEXT_REQUEST_STARTED'
  | 'CONTEXT_REQUEST_COMPLETED'
  | 'CONTEXT_REQUEST_ABORTED'
  | 'CONTEXT_REQUEST_TIMEOUT'
  | 'CONTEXT_REQUEST_FAILED'
  | 'NODE_REQUEST_STARTED'
  | 'NODE_REQUEST_COMPLETED'
  | 'NODE_REQUEST_ABORTED'
  | 'NODE_REQUEST_TIMEOUT'
  | 'NODE_REQUEST_FAILED'
  | 'NODE_CACHE_HIT'
  | 'NODE_CACHE_EVICTED'
  | 'NODE_IN_FLIGHT_REUSED'
  | 'NODE_STORE_COMMITTED'
  | 'NODE_NEXT_FRAME'
  | 'IMAGE_PRELOAD_COMPLETED'
  | 'IMAGE_PRELOAD_FAILED'
  | 'PREFETCH_STARTED'
  | 'PREFETCH_COMPLETED'
  | 'PREFETCH_HIT'
  | 'PREFETCH_CANCELLED'
  | 'PREFETCH_FAILED'
  | 'PREFETCH_UNUSED';

type ReplayPerformanceDetail = Readonly<Record<string, string | number | boolean | null>>;
type ReplayPerformanceDetailInput = ReplayPerformanceDetail | (() => ReplayPerformanceDetail);

export function recordReplayPerformanceEvent(
  event: ReplayPerformanceEvent,
  detailInput: ReplayPerformanceDetailInput = {}
): void {
  if (!isReplayPerformanceProbeEnabled()) {
    return;
  }
  const target = globalThis.performance;
  if (!target || typeof target.mark !== 'function') {
    return;
  }

  try {
    const detail = typeof detailInput === 'function' ? detailInput() : detailInput;
    target.mark(REPLAY_PERFORMANCE_ENTRY_NAME, {
      detail: {
        event,
        ...detail,
      },
    });
  } catch {
    // Performance instrumentation must never affect replay behavior.
  }
}

export function isReplayPerformanceProbeEnabled(): boolean {
  const envValue = import.meta.env.VITE_MATCH_REPLAY_PERFORMANCE_PROBE;
  if (isEnabledValue(envValue)) {
    return true;
  }
  if (typeof window === 'undefined') {
    return false;
  }
  try {
    return isEnabledValue(window.localStorage.getItem(REPLAY_PERFORMANCE_PROBE_STORAGE_KEY));
  } catch {
    return false;
  }
}

export function isReplayAdjacentPrefetchEnabled(): boolean {
  const envValue = import.meta.env.VITE_MATCH_REPLAY_ADJACENT_PREFETCH;
  if (isEnabledValue(envValue)) {
    return true;
  }
  if (typeof window === 'undefined') {
    return false;
  }
  try {
    return isEnabledValue(window.localStorage.getItem(REPLAY_PREFETCH_STORAGE_KEY));
  } catch {
    return false;
  }
}

export function replayPerformanceNow(): number {
  return globalThis.performance?.now() ?? Date.now();
}

export function estimateUtf8Bytes(value: unknown): number {
  try {
    const serialized = JSON.stringify(value);
    return typeof TextEncoder === 'undefined'
      ? serialized.length
      : new TextEncoder().encode(serialized).byteLength;
  } catch {
    return 0;
  }
}

function isEnabledValue(value: string | null | undefined): boolean {
  const normalized = value?.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'on';
}
