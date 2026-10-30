import type { PlayerViewState } from '@game/online/types';
import { cardCodeMatchesBase } from '@game/shared/utils/card-code';
import { ZoneType } from '@game/shared/types/enums';
import cover from '@/components/game/song-animation/mirai-return/cover.jpg';
import { MODIFIER_ICON_SOURCE } from './modifierIconAssets';
export const MIRAI_DURATION = 2100;
export const miraiCover = cover;
export interface MiraiReturnPresentation {
  side: 'self' | 'opponent';
  sourceObjectId: string;
  members: readonly { objectId: string; image: string }[];
  targets: readonly string[];
}
export function getMiraiReturn(
  view: PlayerViewState,
  imagePath: (code: string) => string
): MiraiReturnPresentation | null {
  const cue = view.match.entrance?.miraiReturn;
  const source = cue && view.objects[cue.sourceObjectId];
  if (
    !cue ||
    cue.members.length !== 9 ||
    source?.surface !== 'FRONT' ||
    !source.frontInfo ||
    !cardCodeMatchesBase(source.frontInfo.cardCode, 'PL!SP-bp7-028')
  )
    return null;
  return {
    side: cue.ownerSeat === view.match.viewerSeat ? 'self' : 'opponent',
    sourceObjectId: cue.sourceObjectId,
    members: cue.members.map((m) => ({ objectId: m.objectId, image: imagePath(m.cardCode) })),
    targets: cue.targetMemberObjectIds,
  };
}
/** Prewarm only public LIVE faces and public waiting-room candidates. */
export function miraiPreloadUrls(
  view: PlayerViewState,
  imagePath: (code: string) => string
): string[] {
  const publicSong = Object.values(view.table.zones).some(
    (zone) =>
      [ZoneType.LIVE_ZONE, ZoneType.WAITING_ROOM, ZoneType.SUCCESS_ZONE].some(
        (type) => zone.zone === type
      ) &&
      zone.objectIds?.some((id) => {
        const o = view.objects[id];
        return (
          o?.surface === 'FRONT' &&
          o.frontInfo &&
          cardCodeMatchesBase(o.frontInfo.cardCode, 'PL!SP-bp7-028')
        );
      })
  );
  if (!publicSong && !view.match.entrance?.miraiReturn) return [];
  const cue = getMiraiReturn(view, imagePath);
  const candidates = Object.values(view.table.zones)
    .filter((z) => z.zone === ZoneType.WAITING_ROOM)
    .flatMap((z) => z.objectIds ?? [])
    .flatMap((id) => {
      const o = view.objects[id];
      return o?.surface === 'FRONT' && o.frontInfo ? [imagePath(o.frontInfo.cardCode)] : [];
    });
  return [
    ...new Set([
      cover,
      MODIFIER_ICON_SOURCE.blade,
      ...(cue?.members.map((m) => m.image) ?? []),
      ...candidates,
    ]),
  ].slice(0, 16);
}
export const clamp = (v: number) => Math.max(0, Math.min(1, v));
export const ease = (v: number) => {
  const t = clamp(v);
  return t * t * (3 - 2 * t);
};
