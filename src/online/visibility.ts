import { FaceState, ZoneType } from '../shared/types/enums.js';
import type { Seat, ViewerSurface } from './types.js';

export type ProjectedZoneType = ZoneType;

type OccupancyVisibility = 'OWNER_ONLY' | 'BOTH';

interface OnlineZoneVisibilityPolicy {
  readonly occupancyVisibility: OccupancyVisibility;
  readonly orderedForOwner: boolean;
  readonly orderedForOpponent: boolean;
  readonly publiclyObservable: boolean;
  readonly strictPublicTableMove: boolean;
}

const ONLINE_ZONE_VISIBILITY_POLICIES: Readonly<
  Record<ProjectedZoneType, OnlineZoneVisibilityPolicy>
> = {
  [ZoneType.HAND]: {
    occupancyVisibility: 'OWNER_ONLY',
    orderedForOwner: true,
    orderedForOpponent: false,
    publiclyObservable: false,
    strictPublicTableMove: false,
  },
  [ZoneType.MAIN_DECK]: {
    occupancyVisibility: 'OWNER_ONLY',
    orderedForOwner: true,
    orderedForOpponent: false,
    publiclyObservable: false,
    strictPublicTableMove: false,
  },
  [ZoneType.ENERGY_DECK]: {
    occupancyVisibility: 'OWNER_ONLY',
    orderedForOwner: true,
    orderedForOpponent: false,
    publiclyObservable: false,
    strictPublicTableMove: false,
  },
  [ZoneType.MEMBER_SLOT]: {
    occupancyVisibility: 'BOTH',
    orderedForOwner: false,
    orderedForOpponent: false,
    publiclyObservable: true,
    strictPublicTableMove: true,
  },
  [ZoneType.ENERGY_ZONE]: {
    occupancyVisibility: 'BOTH',
    orderedForOwner: false,
    orderedForOpponent: false,
    publiclyObservable: true,
    strictPublicTableMove: true,
  },
  [ZoneType.LIVE_ZONE]: {
    occupancyVisibility: 'BOTH',
    orderedForOwner: false,
    orderedForOpponent: false,
    publiclyObservable: true,
    strictPublicTableMove: true,
  },
  [ZoneType.SUCCESS_ZONE]: {
    occupancyVisibility: 'BOTH',
    orderedForOwner: true,
    orderedForOpponent: true,
    publiclyObservable: true,
    strictPublicTableMove: true,
  },
  [ZoneType.WAITING_ROOM]: {
    occupancyVisibility: 'BOTH',
    orderedForOwner: false,
    orderedForOpponent: false,
    publiclyObservable: true,
    strictPublicTableMove: true,
  },
  [ZoneType.EXILE_ZONE]: {
    occupancyVisibility: 'BOTH',
    orderedForOwner: false,
    orderedForOpponent: false,
    publiclyObservable: true,
    strictPublicTableMove: true,
  },
  [ZoneType.RESOLUTION_ZONE]: {
    occupancyVisibility: 'BOTH',
    orderedForOwner: false,
    orderedForOpponent: false,
    publiclyObservable: true,
    strictPublicTableMove: false,
  },
  [ZoneType.INSPECTION_ZONE]: {
    occupancyVisibility: 'BOTH',
    orderedForOwner: true,
    orderedForOpponent: true,
    publiclyObservable: true,
    strictPublicTableMove: false,
  },
};

export function getOnlineZoneVisibilityPolicy(zone: ProjectedZoneType): OnlineZoneVisibilityPolicy {
  return ONLINE_ZONE_VISIBILITY_POLICIES[zone];
}

export function isZoneOccupancyVisibleToViewer(
  zone: ProjectedZoneType,
  ownerSeat: Seat,
  viewerSeat: Seat
): boolean {
  const policy = getOnlineZoneVisibilityPolicy(zone);
  return policy.occupancyVisibility === 'BOTH' || ownerSeat === viewerSeat;
}

export function getZoneOrderedForViewer(
  zone: ProjectedZoneType,
  ownerSeat: Seat,
  viewerSeat: Seat
): boolean {
  const policy = getOnlineZoneVisibilityPolicy(zone);
  return ownerSeat === viewerSeat ? policy.orderedForOwner : policy.orderedForOpponent;
}

export function isZonePubliclyObservable(zone: ZoneType): boolean {
  return getOnlineZoneVisibilityPolicy(zone).publiclyObservable;
}

export function isZoneStrictPublicTableMove(zone: ZoneType): boolean {
  return getOnlineZoneVisibilityPolicy(zone).strictPublicTableMove;
}

export function getViewerSurfaceForCard(options: {
  zone: ProjectedZoneType;
  ownerSeat: Seat;
  viewerSeat: Seat;
  liveFaceState?: FaceState;
  isResolutionCardRevealed?: boolean;
  isInspectionCardRevealed?: boolean;
}): ViewerSurface {
  const {
    zone,
    ownerSeat,
    viewerSeat,
    liveFaceState,
    isResolutionCardRevealed = false,
    isInspectionCardRevealed = false,
  } = options;
  const isOwnerViewer = ownerSeat === viewerSeat;

  switch (zone) {
    case ZoneType.HAND:
      return isOwnerViewer ? 'FRONT' : 'NONE';
    case ZoneType.MAIN_DECK:
    case ZoneType.ENERGY_DECK:
      return isOwnerViewer ? 'BACK' : 'NONE';
    case ZoneType.INSPECTION_ZONE:
      return isOwnerViewer || isInspectionCardRevealed ? 'FRONT' : 'BACK';
    case ZoneType.RESOLUTION_ZONE:
      return isOwnerViewer || isResolutionCardRevealed ? 'FRONT' : 'BACK';
    case ZoneType.LIVE_ZONE:
      return !isOwnerViewer && liveFaceState === FaceState.FACE_DOWN ? 'BACK' : 'FRONT';
    default:
      return 'FRONT';
  }
}

export function getProjectedFaceState(options: {
  zone: ProjectedZoneType;
  viewerSurface: ViewerSurface;
  actualFaceState?: FaceState;
}): FaceState | undefined {
  const { zone, viewerSurface, actualFaceState } = options;

  if (
    zone === ZoneType.LIVE_ZONE &&
    viewerSurface === 'BACK' &&
    actualFaceState === FaceState.FACE_DOWN
  ) {
    return FaceState.FACE_DOWN;
  }

  return actualFaceState;
}

export function isZoneCardPublicFront(options: {
  zone: ProjectedZoneType;
  liveFaceState?: FaceState;
  isResolutionCardRevealed?: boolean;
  isInspectionCardRevealed?: boolean;
}): boolean {
  const {
    zone,
    liveFaceState,
    isResolutionCardRevealed = false,
    isInspectionCardRevealed = false,
  } = options;

  switch (zone) {
    case ZoneType.MEMBER_SLOT:
    case ZoneType.ENERGY_ZONE:
    case ZoneType.SUCCESS_ZONE:
    case ZoneType.WAITING_ROOM:
    case ZoneType.EXILE_ZONE:
      return true;
    case ZoneType.LIVE_ZONE:
      return liveFaceState !== FaceState.FACE_DOWN;
    case ZoneType.RESOLUTION_ZONE:
      return isResolutionCardRevealed;
    case ZoneType.INSPECTION_ZONE:
      return isInspectionCardRevealed;
    default:
      return false;
  }
}
