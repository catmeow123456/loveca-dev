export const PUBLIC_CONFIG_REFRESH_INTERVAL_MS = 60_000;
export const PUBLIC_CONFIG_REFRESH_FOCUS_THROTTLE_MS = 15_000;
export const PUBLIC_CONFIG_REFRESH_JITTER_MS = 5_000;
export const PUBLIC_CONFIG_REFRESH_FAILURE_BACKOFF_STEP_MS = 30_000;
export const PUBLIC_CONFIG_REFRESH_MAX_FAILURE_BACKOFF_MS = 5 * 60_000;

export interface PublicConfigRefreshDelayOptions {
  intervalMs?: number;
  jitterMs?: number;
  failureBackoffStepMs?: number;
  maxFailureBackoffMs?: number;
}

export function getPublicConfigRefreshDelay(
  failureCount: number,
  random: () => number = Math.random,
  options: PublicConfigRefreshDelayOptions = {}
): number {
  const intervalMs = options.intervalMs ?? PUBLIC_CONFIG_REFRESH_INTERVAL_MS;
  const jitterMs = Math.max(0, options.jitterMs ?? PUBLIC_CONFIG_REFRESH_JITTER_MS);
  const failureBackoffStepMs = Math.max(
    0,
    options.failureBackoffStepMs ?? PUBLIC_CONFIG_REFRESH_FAILURE_BACKOFF_STEP_MS
  );
  const maxFailureBackoffMs = Math.max(
    0,
    options.maxFailureBackoffMs ?? PUBLIC_CONFIG_REFRESH_MAX_FAILURE_BACKOFF_MS
  );
  const safeFailureCount = Math.max(0, Math.floor(failureCount));
  const failureBackoffMs = Math.min(safeFailureCount * failureBackoffStepMs, maxFailureBackoffMs);
  const jitter =
    jitterMs > 0 ? Math.floor(Math.min(Math.max(random(), 0), 0.999999) * jitterMs) : 0;

  return intervalMs + failureBackoffMs + jitter;
}

export function shouldRunFocusPublicConfigRefresh(
  lastRefreshAttemptAt: number | null,
  now: number,
  throttleMs: number = PUBLIC_CONFIG_REFRESH_FOCUS_THROTTLE_MS
): boolean {
  if (lastRefreshAttemptAt === null) {
    return true;
  }

  return now - lastRefreshAttemptAt >= throttleMs;
}
