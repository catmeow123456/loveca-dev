import type { PlayerViewState } from '@game/online/types';
import { getPublicStageMemberTarget } from './cardEntranceLanding';

export const izumiReplayTiming = {
  invite: 170,
  bow: 290,
  waiting: 580,
  returnAt: 600,
  portraitAt: 820,
  end: 1000,
  reduced: 160,
} as const;

/** The authority already validated the source, exact target, and successful original-slot return. */
export function getIzumiReplaySource(view: PlayerViewState, imagePath: (code: string) => string) {
  const replay = view.match.entrance?.izumiReplay;
  if (!replay) return undefined;
  const target = getPublicStageMemberTarget(view, replay.targetObjectId);
  if (
    !target ||
    view.objects[replay.targetObjectId]?.ownerSeat !== replay.ownerSeat ||
    !target.locationKey.endsWith(`:${replay.slot}`)
  )
    return undefined;
  const host = getPublicStageMemberTarget(view, replay.sourceObjectId);
  return {
    ...replay,
    target,
    host,
    imagePath: imagePath(target.cardCode),
    hostImagePath: host ? imagePath(host.cardCode) : null,
    side: replay.ownerSeat === view.match.viewerSeat ? ('self' as const) : ('opponent' as const),
  };
}
export type IzumiReplaySource = NonNullable<ReturnType<typeof getIzumiReplaySource>>;
