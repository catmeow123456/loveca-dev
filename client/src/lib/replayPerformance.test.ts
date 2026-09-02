import { afterEach, describe, expect, it, vi } from 'vitest';
import { REPLAY_PERFORMANCE_ENTRY_NAME, recordReplayPerformanceEvent } from './replayPerformance';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('recordReplayPerformanceEvent', () => {
  it('does not evaluate lazy detail while the performance probe is disabled', () => {
    vi.stubEnv('VITE_MATCH_REPLAY_PERFORMANCE_PROBE', 'false');
    const detailFactory = vi.fn(() => ({ responseBytes: 1024 }));

    recordReplayPerformanceEvent('NODE_REQUEST_COMPLETED', detailFactory);

    expect(detailFactory).not.toHaveBeenCalled();
  });

  it('evaluates lazy detail once after the performance probe is enabled', () => {
    vi.stubEnv('VITE_MATCH_REPLAY_PERFORMANCE_PROBE', 'true');
    const mark = vi
      .spyOn(globalThis.performance, 'mark')
      .mockImplementation(() => ({}) as PerformanceMark);
    const detailFactory = vi.fn(() => ({ responseBytes: 2048 }));

    recordReplayPerformanceEvent('NODE_REQUEST_COMPLETED', detailFactory);

    expect(detailFactory).toHaveBeenCalledTimes(1);
    expect(mark).toHaveBeenCalledWith(REPLAY_PERFORMANCE_ENTRY_NAME, {
      detail: {
        event: 'NODE_REQUEST_COMPLETED',
        responseBytes: 2048,
      },
    });
  });
});
