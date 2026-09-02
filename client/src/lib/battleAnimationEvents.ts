import type { PlayerViewState, ViewCardObject, ViewZoneKey } from '@game/online';
import { OrientationState, ZoneType } from '@game/shared/types/enums';

export type BattleAnimationKind =
  'CARD_MOVE' | 'DISCARD_PRESENTATION_BATCH' | 'CARD_FLIP' | 'ORIENTATION_CHANGE' | 'ZONE_PULSE';

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

function getFrontInfoDisplayName(
  frontInfo: ViewCardObject['frontInfo'] | null
): string | undefined {
  if (!frontInfo) {
    return undefined;
  }
  return frontInfo.nameCn?.trim() || frontInfo.nameJp?.trim() || frontInfo.cardCode;
}

export type BattleAnimationPresentation = 'DEFAULT' | 'WAITING_ROOM_REVEAL';
export type BattleAnimationSeat = 'FIRST' | 'SECOND';

export interface DiscardPresentationCard {
  readonly render: BattleAnimationCardRender;
  /**
   * 可见己方手牌可传逐卡矩形；对手隐藏手牌传匿名手牌区矩形即可。
   * 展示层只消费该几何信息，不要求来源对象仍存在于投影中。
   */
  readonly fromRect: BattleAnimationRect;
}

export interface DiscardPresentationBatchEvent {
  readonly id: string;
  readonly kind: 'DISCARD_PRESENTATION_BATCH';
  readonly cards: readonly DiscardPresentationCard[];
  readonly toSeat: BattleAnimationSeat;
  readonly toZoneKey?: ViewZoneKey;
  readonly toRect: BattleAnimationRect;
}

export interface CreateDiscardPresentationBatchEventOptions {
  readonly id: string;
  readonly cards: readonly DiscardPresentationCard[];
  readonly toSeat: BattleAnimationSeat;
  readonly toZoneKey?: ViewZoneKey;
  readonly toRect: BattleAnimationRect;
}

export interface DiscardPresentationCardLayout extends BattleAnimationRect {
  readonly rotation: number;
}

export interface DiscardPresentationBatchLayout {
  readonly mode: 'SINGLE' | 'FAN' | 'GRID';
  readonly bounds: BattleAnimationRect;
  readonly cards: readonly DiscardPresentationCardLayout[];
}

export type BattleAnimationEvent =
  | {
      readonly id: string;
      readonly kind: 'CARD_MOVE';
      readonly render: BattleAnimationCardRender;
      readonly fromZoneType: string;
      readonly toZoneType: string;
      readonly presentation?: BattleAnimationPresentation;
      readonly toSeat?: BattleAnimationSeat;
      readonly toZoneKey?: ViewZoneKey;
      readonly fromRect: BattleAnimationRect;
      readonly toRect: BattleAnimationRect;
    }
  | DiscardPresentationBatchEvent
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

export interface BattleObjectLocation {
  readonly zoneKey: ViewZoneKey;
  readonly zoneType: string;
  readonly key: string;
  readonly zoneAnchorKey: string;
}

const MAX_INDIVIDUAL_MOVES = 8;
const IGNORED_ANIMATION_ANCHOR_SELECTOR = '[data-battle-animation-ignore="true"]';

/**
 * 构造一个与 store / PublicEvent 类型无关的弃牌展示批次。
 *
 * 公共事件接入方应只传已经公开、可安全携带 cardCode 的正面卡牌。本函数会去重并
 * 丢弃不完整的候选，避免展示层自行猜测隐藏信息。
 */
export function createDiscardPresentationBatchEvent(
  options: CreateDiscardPresentationBatchEventOptions
): DiscardPresentationBatchEvent | null {
  const seenObjectIds = new Set<string>();
  const cards = options.cards.filter(({ render }) => {
    if (render.surface !== 'FRONT' || !render.cardCode || seenObjectIds.has(render.objectId)) {
      return false;
    }
    seenObjectIds.add(render.objectId);
    return true;
  });
  if (cards.length === 0) {
    return null;
  }

  return {
    id: options.id,
    kind: 'DISCARD_PRESENTATION_BATCH',
    cards,
    toSeat: options.toSeat,
    ...(options.toZoneKey ? { toZoneKey: options.toZoneKey } : {}),
    toRect: options.toRect,
  };
}

/**
 * 休息室邻近展示布局：单张正常尺寸，2-4 张扇形，5 张以上紧凑多行。
 * 所有坐标均为 fixed viewport 坐标，便于 view-diff 与公共事件入口共同复用。
 */
export function getDiscardPresentationBatchLayout({
  count,
  toRect,
  toSeat,
  viewportWidth,
  viewportHeight,
}: {
  readonly count: number;
  readonly toRect: BattleAnimationRect;
  readonly toSeat: BattleAnimationSeat;
  readonly viewportWidth: number;
  readonly viewportHeight: number;
}): DiscardPresentationBatchLayout {
  const safeCount = Math.max(1, Math.floor(count));
  const safeViewportWidth = Math.max(1, viewportWidth);
  const safeViewportHeight = Math.max(1, viewportHeight);
  const edge = 8;
  const isNarrow = safeViewportWidth < 640;
  const cardAspect = 5 / 7;
  const destinationCenterX = toRect.left + toRect.width / 2;
  const verticalGap = isNarrow ? 10 : 18;

  let mode: DiscardPresentationBatchLayout['mode'];
  let cardWidth: number;
  let cardHeight: number;
  let groupWidth: number;
  let groupHeight: number;
  let cardOffsets: readonly {
    readonly left: number;
    readonly top: number;
    readonly rotation: number;
  }[];

  if (safeCount === 1) {
    mode = 'SINGLE';
    cardWidth = clampNumber(isNarrow ? 76 : 92, 56, safeViewportWidth * 0.24);
    cardHeight = cardWidth / cardAspect;
    groupWidth = cardWidth;
    groupHeight = cardHeight;
    cardOffsets = [{ left: 0, top: 0, rotation: 0 }];
  } else if (safeCount <= 4) {
    mode = 'FAN';
    cardWidth = clampNumber(isNarrow ? 62 : 78, 48, safeViewportWidth * 0.2);
    cardHeight = cardWidth / cardAspect;
    const step = cardWidth * (isNarrow ? 0.54 : 0.58);
    groupWidth = cardWidth + step * (safeCount - 1);
    groupHeight = cardHeight + (isNarrow ? 8 : 10);
    cardOffsets = Array.from({ length: safeCount }, (_, index) => ({
      left: step * index,
      top: Math.abs(index - (safeCount - 1) / 2) * (isNarrow ? 2 : 3),
      rotation: (index - (safeCount - 1) / 2) * (isNarrow ? 2.5 : 3),
    }));
  } else {
    mode = 'GRID';
    const columns = Math.min(isNarrow ? 3 : 4, safeCount);
    const rows = Math.ceil(safeCount / columns);
    const gap = isNarrow ? 3 : 5;
    const maxGroupWidth = Math.min(
      safeViewportWidth - edge * 2,
      isNarrow ? safeViewportWidth * 0.72 : 360
    );
    cardWidth = clampNumber(
      (maxGroupWidth - gap * (columns - 1)) / columns,
      isNarrow ? 42 : 48,
      isNarrow ? 58 : 68
    );
    cardHeight = cardWidth / cardAspect;
    groupWidth = cardWidth * columns + gap * (columns - 1);
    groupHeight = cardHeight * rows + gap * (rows - 1);
    cardOffsets = Array.from({ length: safeCount }, (_, index) => ({
      left: (index % columns) * (cardWidth + gap),
      top: Math.floor(index / columns) * (cardHeight + gap),
      rotation: 0,
    }));
  }

  const maxHeight = Math.max(82, safeViewportHeight * (isNarrow ? 0.38 : 0.42));
  if (groupHeight > maxHeight) {
    const scale = maxHeight / groupHeight;
    cardWidth *= scale;
    cardHeight *= scale;
    groupWidth *= scale;
    groupHeight *= scale;
    cardOffsets = cardOffsets.map((offset) => ({
      left: offset.left * scale,
      top: offset.top * scale,
      rotation: offset.rotation,
    }));
  }

  const desiredLeft = destinationCenterX - groupWidth / 2;
  const desiredTop =
    toSeat === 'SECOND'
      ? toRect.top + toRect.height + verticalGap
      : toRect.top - groupHeight - verticalGap;
  const bounds: BattleAnimationRect = {
    left: clampNumber(desiredLeft, edge, Math.max(edge, safeViewportWidth - groupWidth - edge)),
    top: clampNumber(desiredTop, edge, Math.max(edge, safeViewportHeight - groupHeight - edge)),
    width: groupWidth,
    height: groupHeight,
  };

  return {
    mode,
    bounds,
    cards: cardOffsets.map((offset) => ({
      left: bounds.left + offset.left,
      top: bounds.top + offset.top,
      width: cardWidth,
      height: cardHeight,
      rotation: offset.rotation,
    })),
  };
}

export function collectBattleAnimationAnchors(): BattleAnimationAnchorMaps {
  const cards = new Map<string, BattleAnimationCardAnchor>();
  const zones = new Map<string, BattleAnimationRect>();

  document.querySelectorAll<HTMLElement>('[data-object-id]').forEach((element) => {
    if (isIgnoredAnimationAnchor(element)) {
      return;
    }
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
    if (isIgnoredAnimationAnchor(element)) {
      return;
    }
    const zoneId = element.dataset.zoneId;
    if (zoneId && !zones.has(zoneId)) {
      zones.set(zoneId, rectFromDomRect(element.getBoundingClientRect()));
    }
    if (element.id && !zones.has(element.id)) {
      zones.set(element.id, rectFromDomRect(element.getBoundingClientRect()));
    }
  });

  document.querySelectorAll<HTMLElement>('[data-animation-zone-id]').forEach((element) => {
    if (isIgnoredAnimationAnchor(element)) {
      return;
    }
    const zoneId = element.dataset.animationZoneId;
    if (!zoneId) {
      return;
    }
    zones.set(zoneId, rectFromDomRect(element.getBoundingClientRect()));
  });

  return { cards, zones };
}

function isIgnoredAnimationAnchor(element: HTMLElement): boolean {
  return element.closest(IGNORED_ANIMATION_ANCHOR_SELECTOR) !== null;
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
  enableWaitingRoomRevealFallback = false,
}: {
  readonly previousViewState: PlayerViewState;
  readonly nextViewState: PlayerViewState;
  readonly previousAnchors: BattleAnimationAnchorMaps;
  readonly nextAnchors: BattleAnimationAnchorMaps;
  /** 仅供没有公共事件队列的教程/离线壳使用，正式对局保持关闭以免重复播放。 */
  readonly enableWaitingRoomRevealFallback?: boolean;
}): BattleAnimationEvent[] {
  if (previousViewState.match.matchId !== nextViewState.match.matchId) {
    return [];
  }

  const previousLocations = collectBattleObjectLocations(previousViewState);
  const nextLocations = collectBattleObjectLocations(nextViewState);
  const moveCandidates: BattleAnimationEvent[] = [];
  const otherEvents: BattleAnimationEvent[] = [];
  const pulseKeys = new Set<string>();

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
      if (shouldSkipLongDistanceInspectionMove(previousLocation, nextLocation)) {
        continue;
      }

      if (shouldSkipSameZoneListReflow(previousLocation, nextLocation)) {
        continue;
      }

      if (shouldPulseInspectionCleanupMove(previousLocation, nextLocation)) {
        const rect = resolveAnimationRect(nextAnchors, objectId, nextLocation, {
          preferZoneAnchor: true,
        });
        addZonePulseEvent({
          events: otherEvents,
          pulseKeys,
          nextViewState,
          pulseKey: `inspection-cleanup:${nextLocation.zoneAnchorKey}`,
          rect,
        });
        continue;
      }

      if (shouldPulseStackedCardMove(previousLocation, nextLocation)) {
        const rect = resolveAnimationRect(nextAnchors, objectId, nextLocation, {
          preferZoneAnchor: true,
        });
        addZonePulseEvent({
          events: otherEvents,
          pulseKeys,
          nextViewState,
          pulseKey: `stack:${nextLocation.zoneAnchorKey}`,
          rect,
        });
        continue;
      }

      const fromRect = resolveAnimationRect(previousAnchors, objectId, previousLocation);
      const toRect = resolveAnimationRect(nextAnchors, objectId, nextLocation, {
        preferZoneAnchor: shouldPreferDestinationZoneAnchor(nextLocation),
      });
      if (fromRect && toRect && !sameRect(fromRect, toRect)) {
        const render = createCardRender({
          objectId,
          previousObject,
          nextObject,
          previousAnchors,
          nextAnchors,
        });
        const isPublicWaitingRoomDiscard = shouldUseWaitingRoomRevealPresentation({
          previousLocation,
          nextLocation,
          render,
        });
        // 正式对局由公共事件批次展示弃牌；view-diff 不再同时生成普通飞牌。
        if (isPublicWaitingRoomDiscard && !enableWaitingRoomRevealFallback) {
          continue;
        }
        moveCandidates.push({
          id: `move:${nextViewState.match.seq}:${objectId}:${previousLocation.key}->${nextLocation.key}`,
          kind: 'CARD_MOVE',
          render,
          fromZoneType: previousLocation.zoneType,
          toZoneType: nextLocation.zoneType,
          presentation: isPublicWaitingRoomDiscard ? 'WAITING_ROOM_REVEAL' : undefined,
          toSeat: getSeatFromZoneKey(nextLocation.zoneKey) ?? undefined,
          toZoneKey: nextLocation.zoneKey,
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

  const discardPresentationBatches = createDiscardPresentationBatches(moveCandidates);
  const ordinaryMoveCandidates = moveCandidates.filter(
    (event) => event.kind === 'CARD_MOVE' && event.presentation !== 'WAITING_ROOM_REVEAL'
  );
  const ordinaryMoveEvents =
    ordinaryMoveCandidates.length > MAX_INDIVIDUAL_MOVES
      ? createZonePulseEventsForLargeDiff(nextViewState, nextAnchors, ordinaryMoveCandidates)
      : ordinaryMoveCandidates;

  return [...discardPresentationBatches, ...ordinaryMoveEvents, ...otherEvents].slice(0, 16);
}

export function collectBattleObjectLocations(
  viewState: PlayerViewState
): Map<string, BattleObjectLocation> {
  const result = new Map<string, BattleObjectLocation>();

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

function shouldPulseStackedCardMove(
  previousLocation: BattleObjectLocation,
  nextLocation: BattleObjectLocation
): boolean {
  return isStackedMemberLocation(previousLocation) || isStackedMemberLocation(nextLocation);
}

function isStackedMemberLocation(location: BattleObjectLocation): boolean {
  return location.key.includes(':overlay:') || location.key.includes(':below:');
}

function shouldSkipSameZoneListReflow(
  previousLocation: BattleObjectLocation,
  nextLocation: BattleObjectLocation
): boolean {
  return (
    previousLocation.zoneKey === nextLocation.zoneKey &&
    previousLocation.zoneType === nextLocation.zoneType &&
    isListLocation(previousLocation) &&
    isListLocation(nextLocation)
  );
}

function isListLocation(location: BattleObjectLocation): boolean {
  return location.key.includes(':list:');
}

function shouldPulseInspectionCleanupMove(
  previousLocation: BattleObjectLocation,
  nextLocation: BattleObjectLocation
): boolean {
  return (
    previousLocation.zoneType === ZoneType.INSPECTION_ZONE &&
    (nextLocation.zoneType === ZoneType.MAIN_DECK ||
      nextLocation.zoneType === ZoneType.WAITING_ROOM)
  );
}

function shouldSkipLongDistanceInspectionMove(
  previousLocation: BattleObjectLocation,
  nextLocation: BattleObjectLocation
): boolean {
  return (
    previousLocation.zoneType === ZoneType.MAIN_DECK &&
    nextLocation.zoneType === ZoneType.INSPECTION_ZONE
  );
}

function addZonePulseEvent({
  events,
  pulseKeys,
  nextViewState,
  pulseKey,
  rect,
}: {
  readonly events: BattleAnimationEvent[];
  readonly pulseKeys: Set<string>;
  readonly nextViewState: PlayerViewState;
  readonly pulseKey: string;
  readonly rect: BattleAnimationRect | null;
}): void {
  if (!rect || pulseKeys.has(pulseKey)) {
    return;
  }

  pulseKeys.add(pulseKey);
  events.push({
    id: `pulse:${nextViewState.match.seq}:${pulseKey}`,
    kind: 'ZONE_PULSE',
    rect,
  });
}

export function findBattleObjectLocation(
  viewState: PlayerViewState | null,
  objectId: string
): BattleObjectLocation | null {
  if (!viewState) {
    return null;
  }

  return collectBattleObjectLocations(viewState).get(objectId) ?? null;
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
  const fromSurface = previousObject.surface === 'FRONT' ? 'FRONT' : 'BACK';
  const toSurface = nextObject.surface === 'FRONT' ? 'FRONT' : 'BACK';
  const frontInfo =
    toSurface === 'FRONT' ? (nextObject.frontInfo ?? previousObject.frontInfo) : null;
  const imageSrc =
    toSurface === 'FRONT'
      ? (nextAnchors.cards.get(objectId)?.imageSrc ?? previousAnchors.cards.get(objectId)?.imageSrc)
      : undefined;
  return {
    objectId,
    cardId: objectId.startsWith('obj_') ? objectId.slice(4) : objectId,
    fromSurface,
    toSurface,
    surface: toSurface,
    cardCode: frontInfo?.cardCode,
    name: getFrontInfoDisplayName(frontInfo),
    imageSrc,
  };
}

function shouldUseWaitingRoomRevealPresentation({
  previousLocation,
  nextLocation,
  render,
}: {
  readonly previousLocation: BattleObjectLocation;
  readonly nextLocation: BattleObjectLocation;
  readonly render: BattleAnimationCardRender;
}): boolean {
  return (
    previousLocation.zoneType === ZoneType.HAND &&
    nextLocation.zoneType === ZoneType.WAITING_ROOM &&
    getSeatFromZoneKey(nextLocation.zoneKey) !== null &&
    render.surface === 'FRONT' &&
    !!render.cardCode
  );
}

function shouldPreferDestinationZoneAnchor(location: BattleObjectLocation): boolean {
  return (
    location.zoneType === ZoneType.WAITING_ROOM ||
    location.zoneType === ZoneType.MAIN_DECK ||
    location.zoneType === ZoneType.ENERGY_DECK
  );
}

function createDiscardPresentationBatches(
  moveCandidates: readonly BattleAnimationEvent[]
): DiscardPresentationBatchEvent[] {
  const revealCandidates = moveCandidates.filter(
    (
      event
    ): event is Extract<BattleAnimationEvent, { kind: 'CARD_MOVE' }> & {
      readonly presentation: 'WAITING_ROOM_REVEAL';
      readonly toSeat: BattleAnimationSeat;
    } =>
      event.kind === 'CARD_MOVE' &&
      event.presentation === 'WAITING_ROOM_REVEAL' &&
      event.toSeat !== undefined
  );
  const groupedCandidates = new Map<string, typeof revealCandidates>();
  for (const candidate of revealCandidates) {
    const key = candidate.toZoneKey ?? `${candidate.toSeat}:waiting-room`;
    const current = groupedCandidates.get(key);
    if (current) {
      current.push(candidate);
    } else {
      groupedCandidates.set(key, [candidate]);
    }
  }

  return [...groupedCandidates.entries()].flatMap(([groupKey, candidates]) => {
    const first = candidates[0];
    if (!first) return [];
    const batch = createDiscardPresentationBatchEvent({
      id: `discard:${first.id}:${groupKey}:${candidates.map((candidate) => candidate.render.objectId).join(',')}`,
      cards: candidates.map((candidate) => ({
        render: candidate.render,
        fromRect: candidate.fromRect,
      })),
      toSeat: first.toSeat,
      toZoneKey: first.toZoneKey,
      toRect: first.toRect,
    });
    return batch ? [batch] : [];
  });
}

function resolveAnimationRect(
  anchors: BattleAnimationAnchorMaps,
  objectId: string,
  location: BattleObjectLocation,
  options: { readonly preferZoneAnchor?: boolean } = {}
): BattleAnimationRect | null {
  const zoneRect =
    anchors.zones.get(location.zoneAnchorKey) ??
    anchors.zones.get(getZoneAnchorKey(location.zoneKey, location.zoneType)) ??
    null;

  if (options.preferZoneAnchor) {
    return zoneRect ?? anchors.cards.get(objectId) ?? null;
  }

  return anchors.cards.get(objectId) ?? zoneRect;
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

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
