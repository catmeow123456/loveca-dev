import { GameCommandType } from '../application/game-commands.js';
import type { GameState } from '../domain/entities/game.js';
import type { PlayerState } from '../domain/entities/player.js';
import type {
  BaseZoneState,
  MemberSlotZoneState,
  StatefulZoneState,
} from '../domain/entities/zone.js';
import type { CardInstance } from '../domain/entities/card.js';
import { isLiveCardData, isMemberCardData } from '../domain/entities/card.js';
import {
  EffectWindowType,
  FaceState,
  GameMode,
  GamePhase,
  SlotPosition,
  SubPhase,
  ZoneType,
} from '../shared/types/enums.js';
import { isPlayerActive } from '../shared/phase-config/index.js';
import type {
  MatchViewState,
  PermissionViewState,
  PlayerViewState,
  Seat,
  UiHintViewState,
  ViewCardObject,
  ViewFrontCardInfo,
  ViewWindowState,
  ViewZoneKey,
  ViewZoneState,
} from './types.js';
import {
  getProjectedFaceState,
  getViewerSurfaceForCard,
  getZoneOrderedForViewer,
  isZoneOccupancyVisibleToViewer,
} from './visibility.js';

interface ProjectPlayerViewStateOptions {
  readonly seq?: number;
  readonly gameMode?: GameMode;
}

type VisibleSurface = Extract<ViewCardObject['surface'], 'BACK' | 'FRONT'>;

const HIDDEN_OWNER_ZONE_ACTIONS: readonly string[] = [];

interface BaseZoneProjectionSpec {
  readonly key: string;
  readonly getZone: (player: PlayerState) => BaseZoneState;
}

interface StatefulZoneProjectionSpec {
  readonly key: string;
  readonly getZone: (player: PlayerState) => StatefulZoneState;
}

const PRIVATE_ZONE_SPECS: readonly BaseZoneProjectionSpec[] = [
  { key: 'HAND', getZone: (player) => player.hand },
  { key: 'MAIN_DECK', getZone: (player) => player.mainDeck },
  { key: 'ENERGY_DECK', getZone: (player) => player.energyDeck },
];

const PUBLIC_BASE_ZONE_SPECS: readonly BaseZoneProjectionSpec[] = [
  { key: 'SUCCESS_ZONE', getZone: (player) => player.successZone },
  { key: 'WAITING_ROOM', getZone: (player) => player.waitingRoom },
];

const PUBLIC_STATEFUL_ZONE_SPECS: readonly StatefulZoneProjectionSpec[] = [
  { key: 'ENERGY_ZONE', getZone: (player) => player.energyZone },
  { key: 'LIVE_ZONE', getZone: (player) => player.liveZone },
  { key: 'EXILE_ZONE', getZone: (player) => player.exileZone },
];

export function getSeatByPlayerIndex(playerIndex: number): Seat {
  return playerIndex === 0 ? 'FIRST' : 'SECOND';
}

export function getSeatForPlayer(game: GameState, playerId: string): Seat | null {
  const playerIndex = game.players.findIndex((player) => player.id === playerId);
  if (playerIndex === -1) {
    return null;
  }
  return getSeatByPlayerIndex(playerIndex);
}

export function getPlayerIdForSeat(game: GameState, seat: Seat): string {
  return seat === 'FIRST' ? game.players[0].id : game.players[1].id;
}

export function createPublicObjectId(instanceId: string): string {
  return `obj_${instanceId}`;
}

export function buildViewWindowState(game: GameState): ViewWindowState | null {
  const waitingForSeat =
    game.waitingPlayerId !== null ? getSeatForPlayer(game, game.waitingPlayerId) : null;
  const activeSeat = getSeatByPlayerIndex(game.activePlayerIndex);

  if (game.inspectionContext) {
    const inspectionSeat = getSeatForPlayer(game, game.inspectionContext.ownerPlayerId);
    return {
      type: 'INSPECTION',
      actingSeat: inspectionSeat,
      waitingForSeat: inspectionSeat,
      subPhase: game.currentSubPhase,
      sourceZone: game.inspectionContext.sourceZone,
    };
  }

  if (game.waitingForInput) {
    return {
      type: 'INPUT',
      actingSeat: activeSeat,
      waitingForSeat,
      subPhase: game.currentSubPhase,
    };
  }

  if (game.currentPhase === GamePhase.MULLIGAN_PHASE) {
    return {
      type: 'MULLIGAN',
      actingSeat: activeSeat,
      waitingForSeat,
      subPhase: game.currentSubPhase,
    };
  }

  if (game.currentPhase === GamePhase.LIVE_SET_PHASE) {
    return {
      type: 'LIVE_SET',
      actingSeat: activeSeat,
      waitingForSeat,
      subPhase: game.currentSubPhase,
    };
  }

  if (game.currentSubPhase === SubPhase.PERFORMANCE_JUDGMENT) {
    return {
      type: 'JUDGMENT',
      actingSeat: activeSeat,
      waitingForSeat,
      subPhase: game.currentSubPhase,
    };
  }

  if (
    game.currentPhase === GamePhase.LIVE_RESULT_PHASE ||
    game.currentSubPhase === SubPhase.RESULT_SETTLEMENT
  ) {
    return {
      type: 'RESULT',
      actingSeat: activeSeat,
      waitingForSeat,
      subPhase: game.currentSubPhase,
    };
  }

  if (game.effectWindowType !== EffectWindowType.NONE) {
    return {
      type: 'EFFECT',
      actingSeat: activeSeat,
      waitingForSeat,
      subPhase: game.currentSubPhase,
      effectWindowType: game.effectWindowType,
    };
  }

  return null;
}

export function getWindowSignature(window: ViewWindowState | null): string {
  if (!window) {
    return 'NONE';
  }

  return JSON.stringify(window);
}

export function projectPlayerViewState(
  game: GameState,
  viewerPlayerId: string,
  options: ProjectPlayerViewStateOptions = {}
): PlayerViewState {
  const viewerSeat = getSeatForPlayer(game, viewerPlayerId);
  if (!viewerSeat) {
    throw new Error(`Unknown player for projection: ${viewerPlayerId}`);
  }

  const activeSeat = getSeatByPlayerIndex(game.activePlayerIndex);
  const match: MatchViewState = {
    matchId: game.gameId,
    viewerSeat,
    turnCount: game.turnCount,
    phase: game.currentPhase,
    subPhase: game.currentSubPhase,
    activeSeat,
    prioritySeat:
      game.waitingPlayerId !== null ? getSeatForPlayer(game, game.waitingPlayerId) : activeSeat,
    window: buildViewWindowState(game),
    seq: options.seq ?? 0,
  };

  const objects: Record<string, ViewCardObject> = {};
  const zones: Partial<Record<ViewZoneKey, ViewZoneState>> = {};

  for (const [playerIndex, player] of game.players.entries()) {
    const ownerSeat = getSeatByPlayerIndex(playerIndex);
    projectPlayerZones(game, player, ownerSeat, viewerSeat, objects, zones);
  }

  projectResolutionAndInspectionZones(game, viewerSeat, objects, zones);

  const permissions = buildPermissionViewState(game, viewerPlayerId, viewerSeat);
  const uiHints: UiHintViewState = {
    gameMode: options.gameMode ?? GameMode.DEBUG,
    isLocalMode: true,
  };

  return {
    match,
    table: { zones: zones as Record<ViewZoneKey, ViewZoneState> },
    objects,
    permissions,
    uiHints,
  };
}

function projectPlayerZones(
  game: GameState,
  player: PlayerState,
  ownerSeat: Seat,
  viewerSeat: Seat,
  objects: Record<string, ViewCardObject>,
  zones: Partial<Record<ViewZoneKey, ViewZoneState>>
): void {
  for (const spec of PRIVATE_ZONE_SPECS) {
    projectBaseZone(game, spec.getZone(player), ownerSeat, viewerSeat, spec.key, objects, zones);
  }

  addMemberSlotZones(game, player.memberSlots, ownerSeat, viewerSeat, objects, zones);
  for (const spec of PUBLIC_STATEFUL_ZONE_SPECS) {
    projectStatefulZone(
      game,
      spec.getZone(player),
      ownerSeat,
      viewerSeat,
      spec.key,
      objects,
      zones
    );
  }
  for (const spec of PUBLIC_BASE_ZONE_SPECS) {
    projectBaseZone(game, spec.getZone(player), ownerSeat, viewerSeat, spec.key, objects, zones);
  }
}

function projectBaseZone(
  game: GameState,
  zone: BaseZoneState,
  ownerSeat: Seat,
  viewerSeat: Seat,
  zoneName: string,
  objects: Record<string, ViewCardObject>,
  zones: Partial<Record<ViewZoneKey, ViewZoneState>>
): void {
  const zoneKey = `${ownerSeat}_${zoneName}` as ViewZoneKey;
  const canSeeObjects = isZoneOccupancyVisibleToViewer(zone.zoneType, ownerSeat, viewerSeat);
  const objectIds = canSeeObjects
    ? zone.cardIds.map((cardId) => createPublicObjectId(cardId))
    : undefined;

  zones[zoneKey] = {
    zone: zone.zoneType,
    ownerSeat,
    count: zone.cardIds.length,
    ordered: getZoneOrderedForViewer(zone.zoneType, ownerSeat, viewerSeat),
    objectIds,
  };

  if (!canSeeObjects) {
    return;
  }

  for (const cardId of zone.cardIds) {
    const card = game.cardRegistry.get(cardId);
    if (!card) {
      continue;
    }

    const surface = getViewerSurfaceForCard({
      zone: zone.zoneType,
      ownerSeat,
      viewerSeat,
    });
    if (surface === 'NONE') {
      continue;
    }

    upsertViewObject(objects, card, ownerSeat, surface);
  }
}

function addMemberSlotZones(
  game: GameState,
  zone: MemberSlotZoneState,
  ownerSeat: Seat,
  viewerSeat: Seat,
  objects: Record<string, ViewCardObject>,
  zones: Partial<Record<ViewZoneKey, ViewZoneState>>
): void {
  for (const slot of [SlotPosition.LEFT, SlotPosition.CENTER, SlotPosition.RIGHT]) {
    const occupantId = zone.slots[slot];
    const overlayIds = zone.energyBelow[slot];
    const zoneKey = `${ownerSeat}_MEMBER_${slot}` as ViewZoneKey;

    zones[zoneKey] = {
      zone: ZoneType.MEMBER_SLOT,
      ownerSeat,
      count: (occupantId ? 1 : 0) + overlayIds.length,
      ordered: false,
      slotMap: {
        [slot]: occupantId ? createPublicObjectId(occupantId) : null,
      },
      overlays: {
        [slot]: overlayIds.map((cardId) => createPublicObjectId(cardId)),
      },
    };

    if (occupantId) {
      const occupant = game.cardRegistry.get(occupantId);
      const state = zone.cardStates.get(occupantId);
      if (occupant) {
        upsertViewObject(objects, occupant, ownerSeat, 'FRONT', state?.orientation, state?.face);
      }
    }

    for (const energyId of overlayIds) {
      const energy = game.cardRegistry.get(energyId);
      if (energy) {
        upsertViewObject(objects, energy, ownerSeat, 'FRONT');
      }
    }
  }
}

function projectStatefulZone(
  game: GameState,
  zone: StatefulZoneState,
  ownerSeat: Seat,
  viewerSeat: Seat,
  zoneName: string,
  objects: Record<string, ViewCardObject>,
  zones: Partial<Record<ViewZoneKey, ViewZoneState>>
): void {
  const zoneKey = `${ownerSeat}_${zoneName}` as ViewZoneKey;
  zones[zoneKey] = {
    zone: zone.zoneType,
    ownerSeat,
    count: zone.cardIds.length,
    ordered: getZoneOrderedForViewer(zone.zoneType, ownerSeat, viewerSeat),
    objectIds: zone.cardIds.map((cardId) => createPublicObjectId(cardId)),
  };

  for (const cardId of zone.cardIds) {
    const card = game.cardRegistry.get(cardId);
    if (!card) {
      continue;
    }

    const cardState = zone.cardStates.get(cardId);
    const surface = getViewerSurfaceForCard({
      zone: zone.zoneType,
      ownerSeat,
      viewerSeat,
      liveFaceState: cardState?.face,
    });
    if (surface === 'NONE') {
      continue;
    }
    const faceState = getProjectedFaceState({
      zone: zone.zoneType,
      viewerSurface: surface,
      actualFaceState: cardState?.face,
    });

    upsertViewObject(objects, card, ownerSeat, surface, cardState?.orientation, faceState);
  }
}

function projectResolutionAndInspectionZones(
  game: GameState,
  viewerSeat: Seat,
  objects: Record<string, ViewCardObject>,
  zones: Partial<Record<ViewZoneKey, ViewZoneState>>
): void {
  // Always project resolution zone independently
  projectResolutionZone(game, viewerSeat, objects, zones);
  // Always project inspection zone independently
  projectInspectionZones(game, viewerSeat, objects, zones);
}

function projectInspectionZones(
  game: GameState,
  viewerSeat: Seat,
  objects: Record<string, ViewCardObject>,
  zones: Partial<Record<ViewZoneKey, ViewZoneState>>
): void {
  const inspectionOwnerId = game.inspectionContext?.ownerPlayerId ?? null;
  for (const seat of ['FIRST', 'SECOND'] as const) {
    const ownerPlayerId = getPlayerIdForSeat(game, seat);
    const ownedCardIds =
      inspectionOwnerId === ownerPlayerId
        ? game.inspectionZone.cardIds.filter(
            (cardId) => game.cardRegistry.get(cardId)?.ownerId === ownerPlayerId
          )
        : [];
    const zoneKey = `${seat}_INSPECTION_ZONE` as ViewZoneKey;

    zones[zoneKey] = {
      zone: ZoneType.INSPECTION_ZONE,
      ownerSeat: seat,
      count: ownedCardIds.length,
      ordered: getZoneOrderedForViewer(ZoneType.INSPECTION_ZONE, seat, viewerSeat),
      objectIds: ownedCardIds.map((cardId) => createPublicObjectId(cardId)),
    };

    for (const cardId of ownedCardIds) {
      const card = game.cardRegistry.get(cardId);
      if (!card) {
        continue;
      }

      const surface = getViewerSurfaceForCard({
        zone: ZoneType.INSPECTION_ZONE,
        ownerSeat: seat,
        viewerSeat,
        isInspectionCardRevealed: game.inspectionZone.revealedCardIds.includes(cardId),
      });
      if (surface === 'NONE') {
        continue;
      }
      upsertViewObject(objects, card, seat, surface);
    }
  }
}

function projectResolutionZone(
  game: GameState,
  viewerSeat: Seat,
  objects: Record<string, ViewCardObject>,
  zones: Partial<Record<ViewZoneKey, ViewZoneState>>
): void {
  const zone = game.resolutionZone;
  zones.SHARED_RESOLUTION_ZONE = {
    zone: zone.zoneType,
    count: zone.cardIds.length,
    ordered: getZoneOrderedForViewer(zone.zoneType, viewerSeat, viewerSeat),
    objectIds: zone.cardIds.map((cardId) => createPublicObjectId(cardId)),
  };

  for (const cardId of zone.cardIds) {
    const card = game.cardRegistry.get(cardId);
    if (!card) {
      continue;
    }
    const ownerSeat = getSeatForPlayer(game, card.ownerId) ?? viewerSeat;
    const surface = getViewerSurfaceForCard({
      zone: zone.zoneType,
      ownerSeat,
      viewerSeat,
      isResolutionCardRevealed: zone.revealedCardIds.includes(cardId),
    });
    if (surface === 'NONE') {
      continue;
    }
    upsertViewObject(objects, card, ownerSeat, surface);
  }
}

function upsertViewObject(
  objects: Record<string, ViewCardObject>,
  card: CardInstance,
  ownerSeat: Seat,
  surface: VisibleSurface,
  orientation?: ViewCardObject['orientation'],
  faceState?: ViewCardObject['faceState']
): void {
  const publicObjectId = createPublicObjectId(card.instanceId);
  objects[publicObjectId] = {
    publicObjectId,
    ownerSeat,
    controllerSeat: ownerSeat,
    cardType: surface === 'FRONT' ? card.data.cardType : undefined,
    surface,
    orientation,
    faceState,
    frontInfo: surface === 'FRONT' ? buildFrontInfo(card) : undefined,
  };
}

function buildFrontInfo(card: CardInstance): ViewFrontCardInfo {
  if (isMemberCardData(card.data)) {
    return {
      cardCode: card.data.cardCode,
      name: card.data.name,
      cardType: card.data.cardType,
      cost: card.data.cost,
      hearts: card.data.hearts,
      text: card.data.cardText,
    };
  }

  if (isLiveCardData(card.data)) {
    return {
      cardCode: card.data.cardCode,
      name: card.data.name,
      cardType: card.data.cardType,
      score: card.data.score,
      requiredHearts: card.data.requirements,
      text: card.data.cardText,
    };
  }

  return {
    cardCode: card.data.cardCode,
    name: card.data.name,
    cardType: card.data.cardType,
    text: card.data.cardText,
  };
}

function buildPermissionViewState(
  game: GameState,
  viewerPlayerId: string,
  viewerSeat: Seat
): PermissionViewState {
  if (game.inspectionContext) {
    const inspectionSeat = getSeatForPlayer(game, game.inspectionContext.ownerPlayerId);
    const canAct = inspectionSeat === viewerSeat;
    return {
      canAct,
      waitingForSeat: inspectionSeat,
      availableActionTypes: canAct
        ? inferInspectionActionTypes(game, viewerPlayerId)
        : HIDDEN_OWNER_ZONE_ACTIONS,
    };
  }

  const waitingForSeat =
    game.waitingPlayerId !== null ? getSeatForPlayer(game, game.waitingPlayerId) : null;
  const canAct =
    waitingForSeat !== null ? waitingForSeat === viewerSeat : isPlayerActive(game, viewerPlayerId);

  return {
    canAct,
    waitingForSeat,
    availableActionTypes: canAct ? inferAvailableActionTypes(game) : HIDDEN_OWNER_ZONE_ACTIONS,
  };
}

function inferAvailableActionTypes(game: GameState): readonly string[] {
  switch (game.currentPhase) {
    case GamePhase.MULLIGAN_PHASE:
      return [GameCommandType.MULLIGAN];
    case GamePhase.MAIN_PHASE:
      return [
        GameCommandType.OPEN_INSPECTION,
        GameCommandType.PLAY_MEMBER_TO_SLOT,
        GameCommandType.TAP_MEMBER,
        GameCommandType.TAP_ENERGY,
        GameCommandType.MOVE_TABLE_CARD,
        GameCommandType.MOVE_MEMBER_TO_SLOT,
        GameCommandType.ATTACH_ENERGY_TO_MEMBER,
        GameCommandType.MOVE_PUBLIC_CARD_TO_WAITING_ROOM,
        GameCommandType.DRAW_CARD_TO_HAND,
        GameCommandType.DRAW_ENERGY_TO_ZONE,
        GameCommandType.RETURN_HAND_CARD_TO_TOP,
        GameCommandType.END_PHASE,
      ];
    case GamePhase.LIVE_SET_PHASE:
      return [
        GameCommandType.SET_LIVE_CARD,
        GameCommandType.MOVE_PUBLIC_CARD_TO_HAND,
        GameCommandType.CONFIRM_STEP,
      ];
    case GamePhase.PERFORMANCE_PHASE:
      if (game.currentSubPhase === SubPhase.PERFORMANCE_JUDGMENT) {
        return [
          GameCommandType.REVEAL_CHEER_CARD,
          GameCommandType.MOVE_RESOLUTION_CARD_TO_ZONE,
          GameCommandType.CONFIRM_PERFORMANCE_OUTCOME,
          GameCommandType.SUBMIT_JUDGMENT,
        ];
      }
      return [GameCommandType.CONFIRM_STEP];
    case GamePhase.LIVE_RESULT_PHASE:
      switch (game.currentSubPhase) {
        case SubPhase.RESULT_SETTLEMENT:
          return [GameCommandType.SUBMIT_SCORE];
        case SubPhase.RESULT_FIRST_SUCCESS_EFFECTS:
        case SubPhase.RESULT_SECOND_SUCCESS_EFFECTS:
          return [GameCommandType.SELECT_SUCCESS_LIVE, GameCommandType.CONFIRM_STEP];
        default:
          return [GameCommandType.CONFIRM_STEP];
      }
    default:
      return [];
  }
}

function inferInspectionActionTypes(game: GameState, viewerPlayerId: string): readonly string[] {
  if (game.inspectionContext?.ownerPlayerId !== viewerPlayerId) {
    return HIDDEN_OWNER_ZONE_ACTIONS;
  }

  const ownedCardCount = game.inspectionZone.cardIds.filter(
    (cardId) => game.cardRegistry.get(cardId)?.ownerId === viewerPlayerId
  ).length;
  const actionTypes = [
    GameCommandType.REVEAL_INSPECTED_CARD,
    GameCommandType.MOVE_INSPECTED_CARD_TO_TOP,
    GameCommandType.MOVE_INSPECTED_CARD_TO_BOTTOM,
    GameCommandType.MOVE_INSPECTED_CARD_TO_ZONE,
    GameCommandType.FINISH_INSPECTION,
  ];

  if (ownedCardCount > 1) {
    actionTypes.splice(4, 0, GameCommandType.REORDER_INSPECTED_CARD);
  }

  return actionTypes;
}
