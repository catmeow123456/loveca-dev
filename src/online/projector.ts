import { GameCommandType } from '../application/game-commands.js';
import {
  MAIN_PHASE_MANUAL_COMMAND_TYPES,
  PERFORMANCE_LIVE_START_COMMAND_TYPES,
  PERFORMANCE_SUCCESS_EFFECT_COMMAND_TYPES,
  PERFORMANCE_SUCCESS_INTERACTION_COMMAND_TYPES,
  isPerformanceSuccessEffectSubPhase,
} from '../application/command-availability.js';
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
  LiveResultViewState,
  MatchViewState,
  PermissionViewState,
  PlayerViewState,
  Seat,
  UiHintViewState,
  ViewCardObject,
  ViewCommandHint,
  ViewCommandScope,
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
type WindowDescriptor = Omit<ViewWindowState, 'status'>;

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

function createOwnedViewZoneKey(seat: Seat, suffix: string): ViewZoneKey {
  return `${seat}_${suffix}` as ViewZoneKey;
}

const BLOCKED_DURING_INSPECTION_COMMAND_TYPES: readonly GameCommandType[] = [
  GameCommandType.END_PHASE,
  GameCommandType.CONFIRM_STEP,
  GameCommandType.CONFIRM_PERFORMANCE_OUTCOME,
  GameCommandType.SUBMIT_JUDGMENT,
  GameCommandType.SUBMIT_SCORE,
  GameCommandType.SELECT_SUCCESS_LIVE,
];

function buildWindowDescriptor(game: GameState): WindowDescriptor | null {
  const waitingSeat =
    game.waitingPlayerId !== null ? getSeatForPlayer(game, game.waitingPlayerId) : null;
  const activeSeat = getSeatByPlayerIndex(game.activePlayerIndex);
  const winnerSeats = game.liveResolution.liveWinnerIds
    .map((playerId) => getSeatForPlayer(game, playerId))
    .filter((seat): seat is Seat => seat !== null);

  if (game.inspectionContext) {
    const inspectionSeat = getSeatForPlayer(game, game.inspectionContext.ownerPlayerId);
    return {
      windowType: 'INSPECTION',
      actingSeat: inspectionSeat,
      waitingSeats: inspectionSeat ? [inspectionSeat] : [],
      context: {
        sourceZone: game.inspectionContext.sourceZone,
      },
    };
  }

  if (game.waitingForInput) {
    return {
      windowType: 'SHARED_CONFIRM',
      actingSeat: activeSeat,
      waitingSeats: waitingSeat ? [waitingSeat] : [],
    };
  }

  if (
    game.currentPhase === GamePhase.MULLIGAN_PHASE ||
    game.currentPhase === GamePhase.LIVE_SET_PHASE ||
    game.currentSubPhase === SubPhase.RESULT_SCORE_CONFIRM ||
    game.currentSubPhase === SubPhase.RESULT_SETTLEMENT
  ) {
    return {
      windowType: 'SIMULTANEOUS_COMMIT',
      actingSeat: activeSeat,
      waitingSeats: waitingSeat ? [waitingSeat] : [],
    };
  }

  if (game.currentSubPhase === SubPhase.RESULT_ANIMATION) {
    return {
      windowType: 'RESULT_ANIMATION',
      actingSeat: activeSeat,
      waitingSeats: waitingSeat ? [waitingSeat] : [],
      context: {
        winnerSeats,
      },
    };
  }

  if (game.currentSubPhase === SubPhase.PERFORMANCE_JUDGMENT) {
    return {
      windowType: 'SERIAL_PRIORITY',
      actingSeat: activeSeat,
      waitingSeats: waitingSeat ? [waitingSeat] : [],
    };
  }

  if (game.currentSubPhase === SubPhase.PERFORMANCE_SUCCESS_EFFECTS) {
    return {
      windowType: 'SERIAL_PRIORITY',
      actingSeat: activeSeat,
      waitingSeats: waitingSeat ? [waitingSeat] : [],
    };
  }

  if (game.effectWindowType !== EffectWindowType.NONE) {
    return {
      windowType: 'SERIAL_PRIORITY',
      actingSeat: activeSeat,
      waitingSeats: waitingSeat ? [waitingSeat] : [],
      context: {
        effectWindowType: game.effectWindowType,
      },
    };
  }

  return null;
}

export function buildViewWindowState(game: GameState): ViewWindowState | null {
  const descriptor = buildWindowDescriptor(game);
  return descriptor ? { ...descriptor, status: 'OPENED' } : null;
}

export function getWindowSignature(window: ViewWindowState | null): string {
  if (!window) {
    return 'NONE';
  }

  return JSON.stringify({
    windowType: window.windowType,
    actingSeat: window.actingSeat ?? null,
    waitingSeats: [...window.waitingSeats],
    context: window.context ?? null,
  });
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
    participants: {
      FIRST: { id: game.players[0].id, name: game.players[0].name },
      SECOND: { id: game.players[1].id, name: game.players[1].name },
    },
    turnCount: game.turnCount,
    phase: game.currentPhase,
    subPhase: game.currentSubPhase,
    activeSeat,
    prioritySeat:
      game.waitingPlayerId !== null ? getSeatForPlayer(game, game.waitingPlayerId) : activeSeat,
    window: buildViewWindowState(game),
    liveResult: buildLiveResultView(game),
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

  addMemberSlotZones(
    game,
    player.memberSlots,
    player.movedToStageThisTurn,
    ownerSeat,
    viewerSeat,
    objects,
    zones
  );
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

    upsertViewObject(objects, card, ownerSeat, surface, undefined, undefined, {
      knownCardType: card.data.cardType,
    });
  }
}

function addMemberSlotZones(
  game: GameState,
  zone: MemberSlotZoneState,
  movedToStageThisTurn: readonly string[],
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
        upsertViewObject(objects, occupant, ownerSeat, 'FRONT', state?.orientation, state?.face, {
          enteredStageThisTurn: movedToStageThisTurn.includes(occupantId),
        });
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

    upsertViewObject(objects, card, ownerSeat, surface, cardState?.orientation, faceState, {
      judgmentResult:
        zone.zoneType === ZoneType.LIVE_ZONE
          ? game.liveResolution.liveResults.get(cardId)
          : undefined,
    });
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
      upsertViewObject(objects, card, seat, surface, undefined, undefined, {
        publiclyRevealed: game.inspectionZone.revealedCardIds.includes(cardId),
      });
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
    upsertViewObject(objects, card, ownerSeat, surface, undefined, undefined, {
      publiclyRevealed: zone.revealedCardIds.includes(cardId),
    });
  }
}

function upsertViewObject(
  objects: Record<string, ViewCardObject>,
  card: CardInstance,
  ownerSeat: Seat,
  surface: VisibleSurface,
  orientation?: ViewCardObject['orientation'],
  faceState?: ViewCardObject['faceState'],
  metadata?: Pick<ViewCardObject, 'publiclyRevealed' | 'judgmentResult' | 'enteredStageThisTurn'> & {
    readonly knownCardType?: ViewCardObject['cardType'];
  }
): void {
  const publicObjectId = createPublicObjectId(card.instanceId);
  objects[publicObjectId] = {
    publicObjectId,
    ownerSeat,
    controllerSeat: ownerSeat,
    cardType: metadata?.knownCardType ?? (surface === 'FRONT' ? card.data.cardType : undefined),
    surface,
    orientation,
    faceState,
    publiclyRevealed: metadata?.publiclyRevealed,
    judgmentResult: metadata?.judgmentResult,
    enteredStageThisTurn: metadata?.enteredStageThisTurn,
    frontInfo: surface === 'FRONT' ? buildFrontInfo(card) : undefined,
  };
}

function buildLiveResultView(game: GameState): LiveResultViewState {
  const firstPlayerId = game.players[0]?.id;
  const secondPlayerId = game.players[1]?.id;

  return {
    scores: {
      FIRST: firstPlayerId ? game.liveResolution.playerScores.get(firstPlayerId) ?? 0 : 0,
      SECOND: secondPlayerId ? game.liveResolution.playerScores.get(secondPlayerId) ?? 0 : 0,
    },
    winnerSeats: game.liveResolution.liveWinnerIds
      .map((playerId) => getSeatForPlayer(game, playerId))
      .filter((seat): seat is Seat => seat !== null),
    confirmedSeats: game.liveResolution.scoreConfirmedBy
      .map((playerId) => getSeatForPlayer(game, playerId))
      .filter((seat): seat is Seat => seat !== null),
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
      bladeHearts: card.data.bladeHearts,
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
      bladeHearts: card.data.bladeHearts,
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
  const phaseHints = canViewerUsePhaseCommands(game, viewerPlayerId, viewerSeat)
    ? buildPhaseCommandHints(game, viewerPlayerId, viewerSeat)
    : [];

  if (!game.inspectionContext) {
    return {
      availableCommands: phaseHints,
    };
  }

  const inspectionSeat = getSeatForPlayer(game, game.inspectionContext.ownerPlayerId);
  if (inspectionSeat !== viewerSeat) {
    return {
      availableCommands: phaseHints,
    };
  }

  return {
    availableCommands: mergeCommandHints(
      phaseHints,
      buildInspectionCommandHints(game, viewerPlayerId, viewerSeat)
    ),
  };
}

function canViewerUsePhaseCommands(
  game: GameState,
  viewerPlayerId: string,
  viewerSeat: Seat
): boolean {
  if (game.currentSubPhase === SubPhase.RESULT_SCORE_CONFIRM) {
    return true;
  }

  if (
    game.currentSubPhase === SubPhase.RESULT_ANIMATION ||
    game.currentSubPhase === SubPhase.RESULT_SETTLEMENT
  ) {
    return game.liveResolution.liveWinnerIds.includes(viewerPlayerId);
  }

  const waitingForSeat =
    game.waitingPlayerId !== null ? getSeatForPlayer(game, game.waitingPlayerId) : null;
  return waitingForSeat !== null ? waitingForSeat === viewerSeat : isPlayerActive(game, viewerPlayerId);
}

function mergeCommandHints(
  phaseHints: readonly ViewCommandHint[],
  inspectionHints: readonly ViewCommandHint[]
): readonly ViewCommandHint[] {
  const merged = new Map<string, ViewCommandHint>();
  for (const hint of phaseHints) {
    merged.set(hint.command, hint);
  }
  for (const hint of inspectionHints) {
    merged.set(hint.command, hint);
  }
  return [...merged.values()];
}

function inferAvailableActionTypes(game: GameState): readonly GameCommandType[] {
  switch (game.currentPhase) {
    case GamePhase.MULLIGAN_PHASE:
      return [GameCommandType.MULLIGAN];
    case GamePhase.MAIN_PHASE:
      return [
        ...MAIN_PHASE_MANUAL_COMMAND_TYPES,
        GameCommandType.END_PHASE,
      ];
    case GamePhase.LIVE_SET_PHASE:
      return [
        GameCommandType.SET_LIVE_CARD,
        GameCommandType.DRAW_ENERGY_TO_ZONE,
        GameCommandType.MOVE_PUBLIC_CARD_TO_HAND,
        GameCommandType.MOVE_PUBLIC_CARD_TO_ENERGY_DECK,
        GameCommandType.CONFIRM_STEP,
      ];
    case GamePhase.PERFORMANCE_PHASE:
      if (game.currentSubPhase === SubPhase.PERFORMANCE_JUDGMENT) {
        return PERFORMANCE_SUCCESS_INTERACTION_COMMAND_TYPES;
      }
      if (game.currentSubPhase === SubPhase.PERFORMANCE_LIVE_START_EFFECTS) {
        return PERFORMANCE_LIVE_START_COMMAND_TYPES;
      }
      if (isPerformanceSuccessEffectSubPhase(game.currentSubPhase)) {
        return PERFORMANCE_SUCCESS_EFFECT_COMMAND_TYPES;
      }
      return [GameCommandType.CONFIRM_STEP];
    case GamePhase.LIVE_RESULT_PHASE:
      if (game.currentSubPhase === SubPhase.RESULT_SCORE_CONFIRM) {
        return [GameCommandType.SUBMIT_SCORE];
      }
      if (game.currentSubPhase === SubPhase.RESULT_ANIMATION) {
        return [GameCommandType.CONFIRM_STEP];
      }
      if (game.currentSubPhase === SubPhase.RESULT_SETTLEMENT) {
        return [GameCommandType.SELECT_SUCCESS_LIVE, GameCommandType.CONFIRM_STEP];
      }
      return [GameCommandType.CONFIRM_STEP];
    default:
      return [];
  }
}

function buildPhaseCommandHints(
  game: GameState,
  viewerPlayerId: string,
  viewerSeat: Seat
): readonly ViewCommandHint[] {
  return inferAvailableActionTypes(game)
    .map((command) => buildPhaseCommandHint(command, game, viewerPlayerId, viewerSeat))
    .filter((hint): hint is ViewCommandHint => hint !== null);
}

function buildInspectionCommandHints(
  game: GameState,
  viewerPlayerId: string,
  viewerSeat: Seat
): readonly ViewCommandHint[] {
  const ownedCardCount = game.inspectionZone.cardIds.filter(
    (cardId) => game.cardRegistry.get(cardId)?.ownerId === viewerPlayerId
  ).length;
  const ownedCardIds = getOwnedCardIds(game.inspectionZone.cardIds, game, viewerPlayerId);
  const unrevealedOwnedCardIds = ownedCardIds.filter(
    (cardId) => !game.inspectionZone.revealedCardIds.includes(cardId)
  );
  const sourceSuffix = game.inspectionContext?.sourceZone === ZoneType.ENERGY_DECK
    ? 'ENERGY_DECK'
    : 'MAIN_DECK';
  const inspectionZoneKey = createOwnedViewZoneKey(viewerSeat, 'INSPECTION_ZONE');
  const hints: ViewCommandHint[] = [
    buildCommandHint(GameCommandType.OPEN_INSPECTION, {
      scope: createCommandScope({
        zoneKeys: [createOwnedViewZoneKey(viewerSeat, sourceSuffix)],
      }),
      params: {
        sourceZone: game.inspectionContext?.sourceZone,
      },
    }),
  ];

  if (unrevealedOwnedCardIds.length > 0) {
    hints.push(
      buildCommandHint(GameCommandType.REVEAL_INSPECTED_CARD, {
        scope: createCommandScope({
          zoneKeys: [inspectionZoneKey],
          cardIds: unrevealedOwnedCardIds,
        }),
      })
    );
  }

  if (ownedCardIds.length > 0) {
    const inspectionScope = createCommandScope({
      zoneKeys: [inspectionZoneKey],
      cardIds: ownedCardIds,
    });
    hints.push(
      buildCommandHint(GameCommandType.MOVE_INSPECTED_CARD_TO_TOP, {
        scope: inspectionScope,
      }),
      buildCommandHint(GameCommandType.MOVE_INSPECTED_CARD_TO_BOTTOM, {
        scope: inspectionScope,
      }),
      buildCommandHint(GameCommandType.MOVE_INSPECTED_CARD_TO_ZONE, {
        scope: inspectionScope,
      })
    );
  }

  if (ownedCardCount > 1) {
    hints.push(
      buildCommandHint(GameCommandType.REORDER_INSPECTED_CARD, {
        scope: createCommandScope({
          zoneKeys: [inspectionZoneKey],
          cardIds: ownedCardIds,
        }),
      })
    );
  }

  hints.push(
    buildCommandHint(GameCommandType.FINISH_INSPECTION, {
      enabled: ownedCardCount === 0,
      reason: ownedCardCount === 0 ? undefined : '仍有未处理的检视区卡牌',
      scope: createCommandScope({
        zoneKeys: [inspectionZoneKey],
      }),
      params: {
        requiresEmptyInspectionZone: true,
      },
    })
  );

  for (const command of BLOCKED_DURING_INSPECTION_COMMAND_TYPES) {
    hints.push(
      buildCommandHint(command, {
        enabled: false,
        reason: '当前处于检视流程，请先完成检视',
      })
    );
  }

  return hints;
}

function buildPhaseCommandHint(
  command: GameCommandType,
  game: GameState,
  viewerPlayerId: string,
  viewerSeat: Seat
): ViewCommandHint | null {
  switch (command) {
    case GameCommandType.MULLIGAN:
      return buildCommandHint(command, {
        scope: createCommandScope({
          zoneKeys: [createOwnedViewZoneKey(viewerSeat, 'HAND')],
        }),
      });
    case GameCommandType.SET_LIVE_CARD:
      return buildCommandHint(command, {
        scope: createCommandScope({
          zoneKeys: [createOwnedViewZoneKey(viewerSeat, 'HAND')],
        }),
      });
    case GameCommandType.OPEN_INSPECTION:
      return buildCommandHint(command, {
        scope: createCommandScope({
          zoneKeys: [
            createOwnedViewZoneKey(viewerSeat, 'MAIN_DECK'),
            createOwnedViewZoneKey(viewerSeat, 'ENERGY_DECK'),
          ],
        }),
      });
    case GameCommandType.REVEAL_CHEER_CARD:
      return buildCommandHint(command, {
        scope: createCommandScope({
          zoneKeys: [createOwnedViewZoneKey(viewerSeat, 'MAIN_DECK'), 'SHARED_RESOLUTION_ZONE'],
        }),
      });
    case GameCommandType.MOVE_RESOLUTION_CARD_TO_ZONE: {
      const ownedResolutionCardIds = getOwnedCardIds(
        game.resolutionZone.cardIds,
        game,
        viewerPlayerId
      );
      return buildCommandHint(command, {
        scope: createCommandScope({
          zoneKeys: ['SHARED_RESOLUTION_ZONE'],
          cardIds: ownedResolutionCardIds,
        }),
      });
    }
    case GameCommandType.MOVE_TABLE_CARD:
      return buildCommandHint(command, {
        scope: createCommandScope({
          zoneKeys: [
            createOwnedViewZoneKey(viewerSeat, 'MEMBER_LEFT'),
            createOwnedViewZoneKey(viewerSeat, 'MEMBER_CENTER'),
            createOwnedViewZoneKey(viewerSeat, 'MEMBER_RIGHT'),
            createOwnedViewZoneKey(viewerSeat, 'ENERGY_ZONE'),
            createOwnedViewZoneKey(viewerSeat, 'LIVE_ZONE'),
            createOwnedViewZoneKey(viewerSeat, 'SUCCESS_ZONE'),
            createOwnedViewZoneKey(viewerSeat, 'WAITING_ROOM'),
            createOwnedViewZoneKey(viewerSeat, 'EXILE_ZONE'),
          ],
        }),
      });
    case GameCommandType.MOVE_MEMBER_TO_SLOT:
    case GameCommandType.PLAY_MEMBER_TO_SLOT:
      return buildCommandHint(command, {
        scope: createCommandScope({
          zoneKeys: [
            createOwnedViewZoneKey(viewerSeat, 'HAND'),
            createOwnedViewZoneKey(viewerSeat, 'MEMBER_LEFT'),
            createOwnedViewZoneKey(viewerSeat, 'MEMBER_CENTER'),
            createOwnedViewZoneKey(viewerSeat, 'MEMBER_RIGHT'),
          ],
        }),
      });
    case GameCommandType.ATTACH_ENERGY_TO_MEMBER:
      return buildCommandHint(command, {
        scope: createCommandScope({
          zoneKeys: [
            createOwnedViewZoneKey(viewerSeat, 'ENERGY_ZONE'),
            createOwnedViewZoneKey(viewerSeat, 'ENERGY_DECK'),
            createOwnedViewZoneKey(viewerSeat, 'MEMBER_LEFT'),
            createOwnedViewZoneKey(viewerSeat, 'MEMBER_CENTER'),
            createOwnedViewZoneKey(viewerSeat, 'MEMBER_RIGHT'),
          ],
        }),
      });
    case GameCommandType.MOVE_PUBLIC_CARD_TO_WAITING_ROOM:
      return buildCommandHint(command, {
        scope: createCommandScope({
          zoneKeys: [
            createOwnedViewZoneKey(viewerSeat, 'MEMBER_LEFT'),
            createOwnedViewZoneKey(viewerSeat, 'MEMBER_CENTER'),
            createOwnedViewZoneKey(viewerSeat, 'MEMBER_RIGHT'),
            createOwnedViewZoneKey(viewerSeat, 'LIVE_ZONE'),
            createOwnedViewZoneKey(viewerSeat, 'SUCCESS_ZONE'),
          ],
        }),
      });
    case GameCommandType.MOVE_PUBLIC_CARD_TO_HAND:
      return buildCommandHint(command, {
        scope: createCommandScope({
          zoneKeys: [
            createOwnedViewZoneKey(viewerSeat, 'MEMBER_LEFT'),
            createOwnedViewZoneKey(viewerSeat, 'MEMBER_CENTER'),
            createOwnedViewZoneKey(viewerSeat, 'MEMBER_RIGHT'),
            createOwnedViewZoneKey(viewerSeat, 'LIVE_ZONE'),
            createOwnedViewZoneKey(viewerSeat, 'SUCCESS_ZONE'),
            createOwnedViewZoneKey(viewerSeat, 'WAITING_ROOM'),
          ],
        }),
      });
    case GameCommandType.MOVE_PUBLIC_CARD_TO_ENERGY_DECK:
      return buildCommandHint(command, {
        scope: createCommandScope({
          zoneKeys: [createOwnedViewZoneKey(viewerSeat, 'ENERGY_ZONE')],
        }),
      });
    case GameCommandType.MOVE_OWNED_CARD_TO_ZONE:
      return buildCommandHint(command, {
        scope: createCommandScope({
          zoneKeys: [
            createOwnedViewZoneKey(viewerSeat, 'HAND'),
            createOwnedViewZoneKey(viewerSeat, 'MAIN_DECK'),
            createOwnedViewZoneKey(viewerSeat, 'ENERGY_DECK'),
          ],
        }),
      });
    case GameCommandType.END_PHASE:
      return buildCommandHint(command);
    case GameCommandType.CONFIRM_STEP:
      return buildResultConfirmStepHint(game, viewerPlayerId, viewerSeat);
    case GameCommandType.CONFIRM_PERFORMANCE_OUTCOME:
    case GameCommandType.SUBMIT_JUDGMENT:
    case GameCommandType.SUBMIT_SCORE:
      return buildCommandHint(command);
    case GameCommandType.SELECT_SUCCESS_LIVE:
      return buildSettlementSelectionHint(game, viewerPlayerId, viewerSeat);
    case GameCommandType.DRAW_CARD_TO_HAND:
      return buildCommandHint(command, {
        scope: createCommandScope({
          zoneKeys: [createOwnedViewZoneKey(viewerSeat, 'MAIN_DECK')],
        }),
      });
    case GameCommandType.DRAW_ENERGY_TO_ZONE:
      return buildCommandHint(command, {
        scope: createCommandScope({
          zoneKeys: [createOwnedViewZoneKey(viewerSeat, 'ENERGY_DECK')],
        }),
      });
    case GameCommandType.RETURN_HAND_CARD_TO_TOP:
      return buildCommandHint(command, {
        scope: createCommandScope({
          zoneKeys: [createOwnedViewZoneKey(viewerSeat, 'HAND')],
        }),
      });
    default:
      return null;
  }
}

function buildResultConfirmStepHint(
  game: GameState,
  viewerPlayerId: string,
  viewerSeat: Seat
): ViewCommandHint {
  if (game.currentSubPhase === SubPhase.RESULT_ANIMATION) {
    const isWinner = game.liveResolution.liveWinnerIds.includes(viewerPlayerId);
    const hasConfirmed = game.liveResolution.animationConfirmedBy.includes(viewerPlayerId);
    return buildCommandHint(GameCommandType.CONFIRM_STEP, {
      enabled: isWinner && !hasConfirmed,
      reason: !isWinner
        ? '当前玩家不需要播放胜者动画'
        : hasConfirmed
          ? '已完成胜者动画'
          : undefined,
      params: {
        subPhase: game.currentSubPhase,
      },
    });
  }

  if (game.currentSubPhase === SubPhase.RESULT_SETTLEMENT) {
    const isWinner = game.liveResolution.liveWinnerIds.includes(viewerPlayerId);
    const hasConfirmedSettlement = game.liveResolution.settlementConfirmedBy.includes(viewerPlayerId);
    return buildCommandHint(GameCommandType.CONFIRM_STEP, {
      enabled: isWinner && !hasConfirmedSettlement,
      reason: !isWinner
        ? '当前玩家不是本轮胜者'
        : hasConfirmedSettlement
          ? '已确认结算'
          : undefined,
      params: {
        subPhase: game.currentSubPhase,
      },
    });
  }

  return buildCommandHint(GameCommandType.CONFIRM_STEP, {
    params: {
      subPhase: game.currentSubPhase,
    },
  });
}

function buildSettlementSelectionHint(
  game: GameState,
  viewerPlayerId: string,
  viewerSeat: Seat
): ViewCommandHint {
  const isWinner = game.liveResolution.liveWinnerIds.includes(viewerPlayerId);
  const hasMoved = game.liveResolution.successCardMovedBy.includes(viewerPlayerId);
  const isActivePerformer = game.players[game.activePlayerIndex]?.id === viewerPlayerId;
  const canSelectDuringPerformance =
    game.currentPhase === GamePhase.PERFORMANCE_PHASE &&
    (game.currentSubPhase === SubPhase.PERFORMANCE_JUDGMENT ||
      game.currentSubPhase === SubPhase.PERFORMANCE_SUCCESS_EFFECTS);
  const ownedLiveCardIds = getOwnedCardIds(
    game.players.find((player) => player.id === viewerPlayerId)?.liveZone.cardIds ?? [],
    game,
    viewerPlayerId
  );
  const enabled = hasMoved
    ? false
    : canSelectDuringPerformance
      ? isActivePerformer
      : isWinner;
  const reason = hasMoved
    ? '已选择成功 Live 卡'
    : canSelectDuringPerformance
      ? isActivePerformer
        ? undefined
        : '当前不是你的表演阶段'
      : !isWinner
        ? '当前玩家不是本轮胜者'
        : undefined;

  return buildCommandHint(GameCommandType.SELECT_SUCCESS_LIVE, {
    enabled,
    reason,
    scope: createCommandScope({
      zoneKeys: [createOwnedViewZoneKey(viewerSeat, 'LIVE_ZONE')],
      cardIds: ownedLiveCardIds,
    }),
  });
}

function buildCommandHint(
  command: GameCommandType,
  options: {
    enabled?: boolean;
    reason?: string;
    scope?: ViewCommandScope;
    params?: Readonly<Record<string, unknown>>;
  } = {}
): ViewCommandHint {
  return {
    command,
    enabled: options.enabled ?? true,
    reason: options.reason,
    scope: options.scope,
    params: options.params,
  };
}

function createCommandScope(options: {
  zoneKeys?: readonly ViewZoneKey[];
  cardIds?: readonly string[];
}): ViewCommandScope | undefined {
  const zoneKeys = options.zoneKeys?.filter((zoneKey): zoneKey is ViewZoneKey => !!zoneKey) ?? [];
  const objectIds =
    options.cardIds?.map((cardId) => createPublicObjectId(cardId)).filter(Boolean) ?? [];

  if (zoneKeys.length === 0 && objectIds.length === 0) {
    return undefined;
  }

  return {
    zoneKeys: zoneKeys.length > 0 ? zoneKeys : undefined,
    objectIds: objectIds.length > 0 ? objectIds : undefined,
  };
}

function getOwnedCardIds(
  cardIds: readonly string[],
  game: GameState,
  viewerPlayerId: string
): readonly string[] {
  return cardIds.filter((cardId) => game.cardRegistry.get(cardId)?.ownerId === viewerPlayerId);
}
