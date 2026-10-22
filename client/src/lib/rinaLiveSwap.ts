import type { PlayerViewState } from '@game/online/types';
import { ZoneType } from '@game/shared/types/enums';
import { getEntranceStageTarget } from './cardEntranceLanding';
import { supportsRinaSec } from '@/components/game/card-entrance/rina-sec/rinaSecTimeline';

/** Uses only the authority's public movement snapshot; never inspects a hidden deck object. */
export function getRinaLiveSwapSource(view: PlayerViewState, imagePath: (code: string) => string) {
  const swap = view.match.entrance?.rinaLiveSwap;
  if (!swap) return undefined;
  const target = getEntranceStageTarget(view, swap.hostObjectId);
  if (!target || !supportsRinaSec(target.cardCode) || swap.liveIndex < 0 || swap.liveIndex > 2)
    return undefined;
  if (swap.phase === 'PLACE') {
    const live = view.objects[swap.liveObjectId];
    const zone = Object.values(view.table.zones).find(
      (zone) => zone.zone === ZoneType.LIVE_ZONE && zone.ownerSeat === swap.ownerSeat
    );
    if (
      live?.surface !== 'FRONT' ||
      live.frontInfo?.cardCode !== swap.liveCardCode ||
      !zone?.objectIds?.includes(swap.liveObjectId)
    )
      return undefined;
  }
  return {
    ...swap,
    target,
    imagePath: imagePath(swap.liveCardCode),
    side: swap.ownerSeat === view.match.viewerSeat ? ('self' as const) : ('opponent' as const),
  };
}
export type RinaLiveSwapSource = NonNullable<ReturnType<typeof getRinaLiveSwapSource>>;
