import type { PlayerViewState } from '@game/online/types';
import { ZoneType } from '@game/shared/types/enums';
import { MODIFIER_ICON_SOURCE, HEART_ICON_SOURCE_BY_COLOR } from './modifierIconAssets';
import { EFFECT_IMAGE_CACHE_LIMIT } from './effectImageCache';
import { IZUMI_REPLAY_CARD_BASE } from '@game/shared/card-entrance';
import { cardCodeMatchesBase } from '@game/shared/utils/card-code';

/** Public cards and explicit public movement snapshots only, never hidden registry identities. */
export function collectSpecialEffectImageUrls(
  view: PlayerViewState,
  imagePath: (code: string) => string,
  reduced: boolean
): string[] {
  const ids = view.match.entranceAssetIds ?? [];
  const izumiVisible = Object.values(view.table.zones).some(
    (zone) =>
      zone.zone === ZoneType.MEMBER_SLOT &&
      Object.values(zone.slotMap ?? {}).some((id) => {
        const object = id ? view.objects[id] : undefined;
        return (
          object?.surface === 'FRONT' &&
          object.frontInfo &&
          cardCodeMatchesBase(object.frontInfo.cardCode, IZUMI_REPLAY_CARD_BASE)
        );
      })
  );
  if (
    !izumiVisible &&
    !view.match.entrance?.izumiReplay &&
    !ids.some((id) => id === 'ginko' || id === 'rina' || id === 'honoka' || id === 'shizuku')
  )
    return [];
  const urls = new Set<string>();
  if (ids.includes('honoka')) urls.add(MODIFIER_ICON_SOURCE.heart_all);
  if (reduced) return [...urls];
  const face = (id: string) => {
    const object = view.objects[id];
    if (object?.surface === 'FRONT' && object.frontInfo)
      urls.add(imagePath(object.frontInfo.cardCode));
  };
  const wait = view.match.entrance;
  if (wait?.izumiReplay) {
    face(wait.izumiReplay.targetObjectId);
    face(wait.izumiReplay.sourceObjectId);
  }
  if (wait?.shizukuRole) {
    face(wait.shizukuRole.sourceObjectId);
    for (const heart of wait.shizukuRole.hearts) urls.add(HEART_ICON_SOURCE_BY_COLOR[heart.color]);
  }
  // These faces were public before the movement, even though the destination is hidden.
  if (wait?.rinaLiveSwap) urls.add(imagePath(wait.rinaLiveSwap.liveCardCode));
  for (const id of wait?.honokaMemory?.memoryObjectIds ?? []) face(id);
  if (wait?.abilityTransfer) face(wait.abilityTransfer.sourceObjectId);
  for (const relay of wait?.kahoRelays ?? []) face(relay.source.objectId);
  for (const id of view.activeEffect?.revealedObjectIds ?? []) face(id);
  const zones = Object.values(view.table.zones);
  const objectIds = (zone: (typeof zones)[number]) => [
    ...(zone.objectIds ?? []),
    ...Object.values(zone.slotMap ?? {}).filter((id): id is string => !!id),
  ];
  const publicIds = new Set(
    zones
      .filter((zone) =>
        [
          ZoneType.LIVE_ZONE,
          ZoneType.SUCCESS_ZONE,
          ZoneType.WAITING_ROOM,
          ZoneType.MEMBER_SLOT,
        ].some((type) => type === zone.zone)
      )
      .flatMap(objectIds)
  );
  for (const id of view.activeEffect?.selectableObjectIds ?? []) if (publicIds.has(id)) face(id);
  // Visible LIVE/success cards take priority over the larger waiting-room pool.
  for (const type of [
    ZoneType.LIVE_ZONE,
    ZoneType.SUCCESS_ZONE,
    ZoneType.MEMBER_SLOT,
    ZoneType.WAITING_ROOM,
  ])
    for (const zone of zones.filter((zone) => zone.zone === type))
      for (const id of objectIds(zone)) face(id);
  return [...urls].slice(0, EFFECT_IMAGE_CACHE_LIMIT);
}
