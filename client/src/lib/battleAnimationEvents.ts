import type { PlayerViewState, ViewCardObject, ViewZoneKey } from '@game/online';
import { OrientationState, ZoneType } from '@game/shared/types/enums';

export type BattleAnimationKind = 'CARD_MOVE' | 'CARD_FLIP' | 'ORIENTATION_CHANGE' | 'ZONE_PULSE';

export interface BattleAnimationRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export interface BattleAnimationCardAnchor extends BattleAnimationRect {
  readonly imageSrc?: string;
}

export interface BattleAnimationCardRender {
  readonly objectId: string;
  readonly cardId: string;
  readonly fromSurface: 'FRONT' | 'BACK';
  readonly toSurface: 'FRONT' | 'BACK';
  readonly surface: 'FRONT' | 'BACK';
  readonly cardCode?: string;
  readonly name?: string;
  readonly imageSrc?: string;
}

export type BattleAnimationEvent =
  | {
      readonly id: string;
      readonly kind: 'CARD_MOVE';
      readonly render: BattleAnimationCardRender;
      readonly fromZoneType: string;
      readonly toZoneType: string;
      readonly fromRect: BattleAnimationRect;
      readonly toRect: BattleAnimationRect;
    }
  | {
      readonly id: string;
      readonly kind: 'CARD_FLIP';
      readonly render: BattleAnimationCardRender;
      readonly rect: BattleAnimationRect;
    }
  | {
      readonly id: string;
      readonly kind: 'ORIENTATION_CHANGE';
      readonly objectId: string;
      readonly rect: BattleAnimationRect;
      readonly fromOrientation?: OrientationState;
      readonly toOrientation?: OrientationState;
    }
  | {
      readonly id: string;
      readonly kind: 'ZONE_PULSE';
      readonly rect: BattleAnimationRect;
    };

export interface BattleAnimationAnchorMaps {
  readonly cards: ReadonlyMap<string, BattleAnimationCardAnchor>;
  readonly zones: ReadonlyMap<string, BattleAnimationRect>;
}

interface ObjectLocation {
  readonly zoneKey: ViewZoneKey;
  readonly zoneType: string;
  readonly key: string;
  readonly zoneAnchorKey: string;
}

const MAX_INDIVIDUAL_MOVES = 8;

export function collectBattleAnimationAnchors(): BattleAnimationAnchorMaps {
  const cards = new Map<string, BattleAnimationCardAnchor>();
  const zones = new Map<string, BattleAnimationRect>();

  document.querySelectorAll<HTMLElement>('[data-object-id]').forEach((element) => {
    const objectId = element.dataset.objectId;
    if (!objectId || cards.has(objectId)) {
      return;
    }
    cards.set(objectId, {
      ...rectFromDomRect(element.getBoundingClientRect()),
      imageSrc: findRenderedImageSrc(element),
    });
  });

  document.querySelectorAll<HTMLElement>('[data-zone-id]').forEach((element) => {
    const zoneId = element.dataset.zoneId;
    if (zoneId && !zones.has(zoneId)) {
      zones.set(zoneId, rectFromDomRect(element.getBoundingClientRect()));
    }
    if (element.id && !zones.has(element.id)) {
      zones.set(element.id, rectFromDomRect(element.getBoundingClientRect()));
    }
  });

  document.querySelectorAll<HTMLElement>('[data-animation-zone-id]').forEach((element) => {
    const zoneId = element.dataset.animationZoneId;
    if (!zoneId) {
      return;
    }
    zones.set(zoneId, rectFromDomRect(element.getBoundingClientRect()));
  });

  return { cards, zones };
}

export function prepareBattleAnimationLayoutForViewDiff({
  previousViewState,
  nextViewState,
}: {
  readonly previousViewState: PlayerViewState;
  readonly nextViewState: PlayerViewState;
}): void {
  if (typeof document === 'undefined') {
    return;
  }
  if (previousViewState.match.matchId !== nextViewState.match.matchId) {
    return;
  }

  for (const [zoneKey, nextZone] of Object.entries(nextViewState.table.zones) as [
    ViewZoneKey,
    PlayerViewState['table']['zones'][ViewZoneKey],
  ][]) {
    if (nextZone.zone !== ZoneType.INSPECTION_ZONE) {
      continue;
    }

    const previousZone = previousViewState.table.zones[zoneKey];
    const previousObjectIds = previousZone?.objectIds ?? [];
    const nextObjectIds = nextZone.objectIds ?? [];
    if (!didZoneGainObjects(previousObjectIds, nextObjectIds)) {
      continue;
    }

    const scrollContainer = document.getElementById(getZoneAnchorKey(zoneKey, nextZone.zone));
    if (!scrollContainer) {
      continue;
    }

    const maxScrollLeft = Math.max(0, scrollContainer.scrollWidth - scrollContainer.clientWidth);
    if (maxScrollLeft <= 0) {
      continue;
    }

    scrollContainer.scrollLeft = maxScrollLeft;
  }
}

export function createBattleAnimationEventsFromViewDiff({
  previousViewState,
  nextViewState,
  previousAnchors,
  nextAnchors,
}: {
  readonly previousViewState: PlayerViewState;
  readonly nextViewState: PlayerViewState;
  readonly previousAnchors: BattleAnimationAnchorMaps;
  readonly nextAnchors: BattleAnimationAnchorMaps;
}): BattleAnimationEvent[] {
  if (previousViewState.match.matchId !== nextViewState.match.matchId) {
    return [];
  }

  const previousLocations = collectObjectLocations(previousViewState);
  const nextLocations = collectObjectLocations(nextViewState);
  const moveCandidates: BattleAnimationEvent[] = [];
  const otherEvents: BattleAnimationEvent[] = [];

  for (const [objectId, previousLocation] of previousLocations) {
    const nextLocation = nextLocations.get(objectId);
    if (!nextLocation) {
      continue;
    }

    const previousObject = previousViewState.objects[objectId];
    const nextObject = nextViewState.objects[objectId];
    if (!previousObject || !nextObject) {
      continue;
    }

    if (previousLocation.key !== nextLocation.key) {
      const fromRect = resolveAnimationRect(previousAnchors, objectId, previousLocation);
      const toRect = resolveAnimationRect(nextAnchors, objectId, nextLocation, {
        preferZoneAnchor: nextLocation.zoneType === ZoneType.WAITING_ROOM,
      });
      if (fromRect && toRect && !sameRect(fromRect, toRect)) {
        moveCandidates.push({
          id: `move:${nextViewState.match.seq}:${objectId}:${previousLocation.key}->${nextLocation.key}`,
          kind: 'CARD_MOVE',
          render: createCardRender({
            objectId,
            previousObject,
            nextObject,
            previousAnchors,
            nextAnchors,
          }),
          fromZoneType: previousLocation.zoneType,
          toZoneType: nextLocation.zoneType,
          fromRect,
          toRect,
        });
      }
      continue;
    }

    if (previousObject.surface !== nextObject.surface) {
      const rect = resolveAnimationRect(nextAnchors, objectId, nextLocation);
      if (rect) {
        otherEvents.push({
          id: `flip:${nextViewState.match.seq}:${objectId}`,
          kind: 'CARD_FLIP',
          render: createCardRender({
            objectId,
            previousObject,
            nextObject,
            previousAnchors,
            nextAnchors,
          }),
          rect,
        });
      }
    }

    if (previousObject.orientation !== nextObject.orientation) {
      const rect = resolveAnimationRect(nextAnchors, objectId, nextLocation);
      if (rect) {
        otherEvents.push({
          id: `orientation:${nextViewState.match.seq}:${objectId}`,
          kind: 'ORIENTATION_CHANGE',
          objectId,
          rect,
          fromOrientation: previousObject.orientation,
          toOrientation: nextObject.orientation,
        });
      }
    }
  }

  if (moveCandidates.length > MAX_INDIVIDUAL_MOVES) {
    return createZonePulseEventsForLargeDiff(nextViewState, nextAnchors, moveCandidates);
  }

  return [...moveCandidates, ...otherEvents].slice(0, 16);
}

function collectObjectLocations(viewState: PlayerViewState): Map<string, ObjectLocation> {
  const result = new Map<string, ObjectLocation>();

  for (const [zoneKey, zone] of Object.entries(viewState.table.zones) as [
    ViewZoneKey,
    PlayerViewState['table']['zones'][ViewZoneKey],
  ][]) {
    const zoneAnchorKey = getZoneAnchorKey(zoneKey, zone.zone);

    zone.objectIds?.forEach((objectId, index) => {
      result.set(objectId, {
        zoneKey,
        zoneType: zone.zone,
        key: `${zoneKey}:list:${index}:${objectId}`,
        zoneAnchorKey,
      });
    });

    for (const [slot, occupantId] of Object.entries(zone.slotMap ?? {})) {
      if (!occupantId) {
        continue;
      }
      result.set(occupantId, {
        zoneKey,
        zoneType: zone.zone,
        key: `${zoneKey}:slot:${slot}`,
        zoneAnchorKey: getMemberSlotAnchorKey(zoneKey, slot),
      });
    }

    for (const [slot, overlayIds] of Object.entries(zone.overlays ?? {})) {
      overlayIds.forEach((objectId, index) => {
        result.set(objectId, {
          zoneKey,
          zoneType: zone.zone,
          key: `${zoneKey}:overlay:${slot}:${index}`,
          zoneAnchorKey: getMemberSlotAnchorKey(zoneKey, slot),
        });
      });
    }

    for (const [slot, memberBelowIds] of Object.entries(zone.memberBelow ?? {})) {
      memberBelowIds.forEach((objectId, index) => {
        result.set(objectId, {
          zoneKey,
          zoneType: zone.zone,
          key: `${zoneKey}:below:${slot}:${index}`,
          zoneAnchorKey: getMemberSlotAnchorKey(zoneKey, slot),
        });
      });
    }
  }

  return result;
}

function didZoneGainObjects(
  previousObjectIds: readonly string[],
  nextObjectIds: readonly string[]
): boolean {
  if (nextObjectIds.length === 0) {
    return false;
  }

  const previousObjectIdSet = new Set(previousObjectIds);
  return nextObjectIds.some((objectId) => !previousObjectIdSet.has(objectId));
}

function createCardRender({
  objectId,
  previousObject,
  nextObject,
  previousAnchors,
  nextAnchors,
}: {
  readonly objectId: string;
  readonly previousObject: ViewCardObject;
  readonly nextObject: ViewCardObject;
  readonly previousAnchors: BattleAnimationAnchorMaps;
  readonly nextAnchors: BattleAnimationAnchorMaps;
}): BattleAnimationCardRender {
  const frontInfo = nextObject.frontInfo ?? previousObject.frontInfo;
  const fromSurface = previousObject.surface === 'FRONT' ? 'FRONT' : 'BACK';
  const toSurface = nextObject.surface === 'FRONT' ? 'FRONT' : 'BACK';
  const imageSrc =
    nextAnchors.cards.get(objectId)?.imageSrc ?? previousAnchors.cards.get(objectId)?.imageSrc;
  return {
    objectId,
    cardId: objectId.startsWith('obj_') ? objectId.slice(4) : objectId,
    fromSurface,
    toSurface,
    surface: toSurface,
    cardCode: frontInfo?.cardCode,
    name: frontInfo?.name,
    imageSrc,
  };
}

function resolveAnimationRect(
  anchors: BattleAnimationAnchorMaps,
  objectId: string,
  location: ObjectLocation,
  options: { readonly preferZoneAnchor?: boolean } = {}
): BattleAnimationRect | null {
  const zoneRect =
    anchors.zones.get(location.zoneAnchorKey) ??
    anchors.zones.get(getZoneAnchorKey(location.zoneKey, location.zoneType)) ??
    null;

  if (options.preferZoneAnchor) {
    return zoneRect ?? anchors.cards.get(objectId) ?? null;
  }

  return (
    anchors.cards.get(objectId) ??
    zoneRect
  );
}

function createZonePulseEventsForLargeDiff(
  nextViewState: PlayerViewState,
  nextAnchors: BattleAnimationAnchorMaps,
  moveCandidates: readonly BattleAnimationEvent[]
): BattleAnimationEvent[] {
  const usedKeys = new Set<string>();
  const events: BattleAnimationEvent[] = [];

  for (const event of moveCandidates) {
    if (event.kind !== 'CARD_MOVE') {
      continue;
    }

    const key = `${Math.round(event.toRect.left)}:${Math.round(event.toRect.top)}`;
    if (usedKeys.has(key)) {
      continue;
    }
    usedKeys.add(key);
    events.push({
      id: `pulse:${nextViewState.match.seq}:${key}`,
      kind: 'ZONE_PULSE',
      rect: event.toRect,
    });
    if (events.length >= 4) {
      break;
    }
  }

  if (events.length === 0) {
    const firstZone = nextAnchors.zones.values().next().value as BattleAnimationRect | undefined;
    if (firstZone) {
      events.push({
        id: `pulse:${nextViewState.match.seq}:fallback`,
        kind: 'ZONE_PULSE',
        rect: firstZone,
      });
    }
  }

  return events;
}

function getZoneAnchorKey(zoneKey: ViewZoneKey, zoneType: string): string {
  const scopedZoneId = getScopedZoneAnchorKey(zoneKey, zoneType);
  if (scopedZoneId) {
    return scopedZoneId;
  }

  switch (zoneType) {
    case ZoneType.MEMBER_SLOT:
      return 'member-slot';
    case ZoneType.MAIN_DECK:
      return 'main-deck';
    case ZoneType.ENERGY_DECK:
      return 'energy-deck';
    case ZoneType.RESOLUTION_ZONE:
      return 'resolution-zone';
    default:
      return zoneType;
  }
}

function getMemberSlotAnchorKey(zoneKey: ViewZoneKey, slot: string): string {
  const seat = getSeatFromZoneKey(zoneKey);
  return seat ? `seat-${seat}::slot-${slot}` : `slot-${slot}`;
}

function getScopedZoneAnchorKey(zoneKey: ViewZoneKey, zoneType: string): string | null {
  const seat = getSeatFromZoneKey(zoneKey);
  if (!seat) {
    return zoneKey === 'SHARED_RESOLUTION_ZONE' ? 'resolution-zone' : null;
  }

  const suffix = zoneKey.slice(`${seat}_`.length);
  if (suffix.startsWith('MEMBER_')) {
    return `seat-${seat}::slot-${suffix.slice('MEMBER_'.length)}`;
  }

  const logicalZoneId = getLogicalZoneId(zoneType);
  return logicalZoneId ? `seat-${seat}::${logicalZoneId}` : null;
}

function getLogicalZoneId(zoneType: string): string | null {
  switch (zoneType) {
    case ZoneType.LIVE_ZONE:
      return 'live-zone';
    case ZoneType.ENERGY_ZONE:
      return 'energy-zone';
    case ZoneType.MAIN_DECK:
      return 'main-deck';
    case ZoneType.ENERGY_DECK:
      return 'energy-deck';
    case ZoneType.SUCCESS_ZONE:
      return 'success-zone';
    case ZoneType.HAND:
      return 'hand';
    case ZoneType.WAITING_ROOM:
      return 'waiting-room';
    case ZoneType.RESOLUTION_ZONE:
      return 'resolution-zone';
    case ZoneType.INSPECTION_ZONE:
      return 'inspection-zone';
    default:
      return null;
  }
}

function getSeatFromZoneKey(zoneKey: ViewZoneKey): 'FIRST' | 'SECOND' | null {
  if (zoneKey.startsWith('FIRST_')) {
    return 'FIRST';
  }
  if (zoneKey.startsWith('SECOND_')) {
    return 'SECOND';
  }
  return null;
}

function rectFromDomRect(rect: DOMRect): BattleAnimationRect {
  return {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
  };
}

function findRenderedImageSrc(element: HTMLElement): string | undefined {
  const image = element.matches('img')
    ? (element as HTMLImageElement)
    : element.querySelector<HTMLImageElement>('img');
  return image?.currentSrc || image?.src || undefined;
}

function sameRect(first: BattleAnimationRect, second: BattleAnimationRect): boolean {
  return (
    Math.abs(first.left - second.left) < 1 &&
    Math.abs(first.top - second.top) < 1 &&
    Math.abs(first.width - second.width) < 1 &&
    Math.abs(first.height - second.height) < 1
  );
}
