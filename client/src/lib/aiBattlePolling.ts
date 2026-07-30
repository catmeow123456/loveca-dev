import { SerialPollingScheduler } from './asyncRequestControl';

export const AI_BATTLE_MATCH_POLL_INTERVAL_MS = 800;

export interface CreateAiBattlePollingSchedulerOptions {
  readonly syncRemoteState: () => Promise<void>;
  readonly onError?: (error: unknown) => void;
}

export function createAiBattlePollingScheduler(
  options: CreateAiBattlePollingSchedulerOptions
): SerialPollingScheduler {
  return new SerialPollingScheduler({
    intervalMs: AI_BATTLE_MATCH_POLL_INTERVAL_MS,
    poll: async () => {
      try {
        await options.syncRemoteState();
      } catch (error) {
        options.onError?.(error);
      }
    },
  });
}
