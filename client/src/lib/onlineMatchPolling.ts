import type { PlayerViewState } from '@game/online/types';

/** Only the current public animation window gets faster polling, including its ACK tail. */
export function getOnlineMatchPollInterval(
  entrance: PlayerViewState['match']['entrance'],
  now = Date.now()
): number {
  return entrance && now < entrance.deadlineAt ? 200 : 800;
}
