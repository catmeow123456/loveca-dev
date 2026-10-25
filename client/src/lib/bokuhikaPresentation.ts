import type { PlayerViewState } from '@game/online/types';
import { cardCodeMatchesBase } from '@game/shared/utils/card-code';
import { ZoneType } from '@game/shared/types/enums';
import {
  bokuhikaContributionFromNames,
  bokuhikaSuccessCueKey,
} from '@/components/game/song-animation/bokuhikaCast';

/** Warm only after the song is public; never consult hidden cards or the full registry. */
export function shouldPreloadBokuhika(view: PlayerViewState): boolean {
  return Object.values(view.table.zones).some(
    (zone) =>
      [ZoneType.LIVE_ZONE, ZoneType.SUCCESS_ZONE, ZoneType.WAITING_ROOM].some(
        (type) => type === zone.zone
      ) &&
      zone.objectIds?.some((id) => {
        const object = view.objects[id];
        return (
          object?.surface === 'FRONT' &&
          !!object.frontInfo &&
          cardCodeMatchesBase(object.frontInfo.cardCode, 'PL!-pb2-039')
        );
      })
  );
}

/** Consume the authority's public cue, never infer contributors from client zones or a registry. */
export function getBokuhikaPresentation(view: PlayerViewState) {
  const cue = view.match.entrance?.bokuhikaSuccess;
  if (!cue) return null;
  // Ordered auto-resolution has no confirmation panel; only an authority cue can present it.
  if (view.activeEffect && !bokuhikaSuccessCueKey(view.activeEffect)) return null;
  const source = view.objects[cue.sourceObjectId];
  if (
    (view.activeEffect && cue.sourceObjectId !== view.activeEffect.sourceObjectId) ||
    source?.surface !== 'FRONT' ||
    !source.frontInfo ||
    !cardCodeMatchesBase(source.frontInfo.cardCode, 'PL!-pb2-039')
  )
    return null;
  return bokuhikaContributionFromNames(cue.normalizedNames, cue.scoreBonus);
}
