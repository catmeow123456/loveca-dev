import { GameCommandType } from '../application/game-commands.js';
import {
  MAIN_PHASE_ACTIVE_PLAYER_COMMAND_TYPES,
  OWN_DESK_FREE_DRAG_COMMAND_TYPES,
  isOwnDeskFreeDragCommand,
  isOwnDeskFreeDragWindow,
  PERFORMANCE_LIVE_START_COMMAND_TYPES,
  RESULT_SUCCESS_EFFECT_COMMAND_TYPES,
  PERFORMANCE_SUCCESS_INTERACTION_COMMAND_TYPES,
  isResultSuccessEffectSubPhase,
} from '../application/command-availability.js';
import { getActivatedAbilityUiConfig } from '../application/card-effect-runner.js';
import { CardAbilitySourceZone } from '../application/card-effects/ability-definition-types.js';
import {
  hasPendingAbilityOrChoice,
  type ActiveEffectState,
  type GameState,
  type LiveModifierState,
} from '../domain/entities/game.js';
import type { PlayerState } from '../domain/entities/player.js';
import type {
  BaseZoneState,
  MemberSlotZoneState,
  StatefulZoneState,
} from '../domain/entities/zone.js';
import type { CardInstance, HeartRequirement } from '../domain/entities/card.js';
import { isLiveCardData, isMemberCardData } from '../domain/entities/card.js';
import {
  EffectWindowType,
  FaceState,
  GameMode,
  GamePhase,
  HeartColor,
  SlotPosition,
  SubPhase,
  ZoneType,
} from '../shared/types/enums.js';
import { isPlayerActive } from '../shared/phase-config/index.js';
import {
  collectLiveModifiers,
  getMemberEffectiveBladeCount,
  getMemberEffectiveHeartIcons,
  getPlayerLiveScoreModifier,
  projectLiveModifierCompatibility,
} from '../domain/rules/live-modifiers.js';
import { getMemberEffectiveCost } from '../domain/rules/member-effective-cost.js';
import {
  canLiveCardEnterSuccessZone,
  getCurrentSuccessLiveSettlementPlayerId,
  getSuccessLiveSelectionCandidateIds,
  hasPendingSuccessLiveSelection,
  haveAllSuccessLiveSettlementsCompleted,
} from '../domain/rules/success-live-placement.js';
import { isActiveEffectControlledInspection } from '../domain/rules/inspection-control.js';
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
  ViewHeartRequirement,
  ViewMemberModifierDelta,
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
import { createBlindCardSelectionToken } from '../shared/utils/blind-card-selection.js';

interface ProjectPlayerViewStateOptions {
  readonly seq?: number;
  readonly gameMode?: GameMode;
  readonly now?: number;
}

type VisibleSurface = Extract<ViewCardObject['surface'], 'BACK' | 'FRONT'>;
type WindowDescriptor = Omit<ViewWindowState, 'status'>;

interface ActiveEffectCardSelectionProjection {
  readonly selectableObjectIds?: readonly string[];
  readonly selectableObjectsFaceDown?: boolean;
  readonly selectableObjectMode?: 'SINGLE' | 'ORDERED_MULTI';
  readonly minSelectableObjects?: number;
  readonly maxSelectableObjects?: number;
  readonly selectionLabel?: string;
  readonly confirmSelectionLabel?: string;
  readonly canSkipSelection?: boolean;
  readonly skipSelectionLabel?: string;
}

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
  GameCommandType.CONFIRM_EFFECT_STEP,
  GameCommandType.CONFIRM_PERFORMANCE_OUTCOME,
  GameCommandType.SUBMIT_JUDGMENT,
  GameCommandType.SUBMIT_SCORE,
  GameCommandType.SELECT_SUCCESS_LIVE,
];

const ACTIVE_EFFECT_INSPECTION_COMMAND_TYPES = new Set<GameCommandType>([
  GameCommandType.OPEN_INSPECTION,
  GameCommandType.REVEAL_INSPECTED_CARD,
  GameCommandType.MOVE_INSPECTED_CARD_TO_TOP,
  GameCommandType.MOVE_INSPECTED_CARD_TO_BOTTOM,
  GameCommandType.MOVE_INSPECTED_CARD_TO_ZONE,
  GameCommandType.MOVE_CARD_TO_INSPECTION,
  GameCommandType.REORDER_INSPECTED_CARD,
  GameCommandType.FINISH_INSPECTION_WITH_ARRANGEMENT,
  GameCommandType.FINISH_INSPECTION,
]);

function buildWindowDescriptor(game: GameState): WindowDescriptor | null {
  const waitingSeat =
    game.waitingPlayerId !== null ? getSeatForPlayer(game, game.waitingPlayerId) : null;
  const activeSeat = getSeatByPlayerIndex(game.activePlayerIndex);
  const winnerSeats = game.liveResolution.liveWinnerIds
    .map((playerId) => getSeatForPlayer(game, playerId))
    .filter((seat): seat is Seat => seat !== null);

  if (game.inspectionContext) {
    const inspectionSeat = getSeatForPlayer(
      game,
      game.inspectionContext.viewerPlayerId ?? game.inspectionContext.ownerPlayerId
    );
    return {
      windowType: 'INSPECTION',
      actingSeat: inspectionSeat,
      waitingSeats: inspectionSeat ? [inspectionSeat] : [],
      context: {
        sourceZone: game.inspectionContext.sourceZone,
        activeEffectId: game.activeEffect?.id,
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
    game.currentSubPhase === SubPhase.RESULT_SCORE_CONFIRM
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

  if (game.currentSubPhase === SubPhase.RESULT_SETTLEMENT) {
    const currentSettlementPlayerId = getCurrentSuccessLiveSettlementPlayerId(game);
    const currentSettlementSeat =
      currentSettlementPlayerId !== null ? getSeatForPlayer(game, currentSettlementPlayerId) : null;
    return {
      windowType: currentSettlementSeat ? 'SERIAL_PRIORITY' : 'SIMULTANEOUS_COMMIT',
      actingSeat: currentSettlementSeat ?? activeSeat,
      waitingSeats: currentSettlementSeat ? [currentSettlementSeat] : winnerSeats,
      context: {
        winnerSeats,
        successLiveSelection:
          currentSettlementPlayerId !== null
            ? {
                waitingSeat: currentSettlementSeat,
                candidateObjectIds: getSuccessLiveSelectionCandidateIds(
                  game,
                  currentSettlementPlayerId
                ).map(createPublicObjectId),
              }
            : null,
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

  if (isResultSuccessEffectSubPhase(game.currentSubPhase)) {
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
    liveResult: buildLiveResultView(game, viewerSeat),
    seq: options.seq ?? 0,
  };

  const objects: Record<string, ViewCardObject> = {};
  const zones: Partial<Record<ViewZoneKey, ViewZoneState>> = {};

  for (const [playerIndex, player] of game.players.entries()) {
    const ownerSeat = getSeatByPlayerIndex(playerIndex);
    projectPlayerZones(game, player, ownerSeat, viewerSeat, objects, zones);
  }
  projectResolutionAndInspectionZones(game, viewerSeat, objects, zones);
  projectActiveEffectRevealedCards(game, objects);

  const permissions = buildPermissionViewState(game, viewerPlayerId, viewerSeat);
  const activeEffectCardSelection = projectActiveEffectCardSelection(game, viewerSeat, objects);
  const publicCardSelectionAutoAdvanceAt = game.activeEffect?.publicCardSelectionAutoAdvanceAt;
  for (const skip of game.energyActivePhaseSkips ?? []) {
    const publicObjectId = createPublicObjectId(skip.energyCardId);
    const object = objects[publicObjectId];
    if (object) objects[publicObjectId] = { ...object, skipsNextActivePhase: true };
  }
  const activeEffect = game.activeEffect
    ? {
        id: game.activeEffect.id,
        abilityId: game.activeEffect.abilityId,
        sourceObjectId: createPublicObjectId(game.activeEffect.sourceCardId),
        controllerSeat: getSeatForPlayer(game, game.activeEffect.controllerId),
        effectText: game.activeEffect.effectText,
        stepId: game.activeEffect.stepId,
        stepText: game.activeEffect.stepText,
        waitingSeat: game.activeEffect.awaitingPlayerId
          ? getSeatForPlayer(game, game.activeEffect.awaitingPlayerId)
          : null,
        revealedObjectIds: game.activeEffect.revealedCardIds?.map(createPublicObjectId),
        publicCardSelectionAutoAdvanceAt,
        publicCardSelectionAutoAdvanceAfterMs: publicCardSelectionAutoAdvanceAt
          ? Math.max(0, publicCardSelectionAutoAdvanceAt - (options.now ?? Date.now()))
          : undefined,
        publicCardSelectionOrdered: game.activeEffect.publicCardSelectionOrdered,
        inspectionObjectIds: game.activeEffect.inspectionCardIds?.map(createPublicObjectId),
        ...activeEffectCardSelection,
        selectableSlots: game.activeEffect.selectableSlots,
        selectableOptions: game.activeEffect.selectableOptions,
        stageFormation: projectActiveEffectStageFormation(game),
        numericInput: game.activeEffect.numericInput,
        canResolveInOrder: game.activeEffect.canResolveInOrder,
      }
    : null;
  const pendingCostPayment = game.pendingCostPayment
    ? {
        id: game.pendingCostPayment.id,
        source: game.pendingCostPayment.source,
        sourceObjectId: createPublicObjectId(game.pendingCostPayment.sourceCardId),
        playerSeat: getSeatForPlayer(game, game.pendingCostPayment.playerId),
        targetSlot: game.pendingCostPayment.targetSlot,
        baseCost: game.pendingCostPayment.baseCost,
        finalEnergyCost: game.pendingCostPayment.finalEnergyCost,
        relayDiscount: game.pendingCostPayment.relayDiscount,
        replacedMemberObjectId: game.pendingCostPayment.replacedMemberCardId
          ? createPublicObjectId(game.pendingCostPayment.replacedMemberCardId)
          : null,
        payableEnergyObjectIds:
          game.pendingCostPayment.payableEnergyCardIds.map(createPublicObjectId),
        explanation: game.pendingCostPayment.explanation,
      }
    : null;
  const uiHints: UiHintViewState = {
    gameMode: options.gameMode ?? GameMode.DEBUG,
  };

  return {
    match,
    table: { zones: zones as Record<ViewZoneKey, ViewZoneState> },
    objects,
    permissions,
    activeEffect,
    pendingCostPayment,
    uiHints,
  };
}

function projectActiveEffectRevealedCards(
  game: GameState,
  objects: Record<string, ViewCardObject>
): void {
  const revealedCardIds = game.activeEffect?.revealedCardIds ?? [];
  for (const cardId of revealedCardIds) {
    const card = game.cardRegistry.get(cardId);
    if (!card) {
      continue;
    }
    const ownerSeat = getSeatForPlayer(game, card.ownerId);
    if (!ownerSeat) {
      continue;
    }
    upsertViewObject(objects, card, ownerSeat, 'FRONT', undefined, undefined, {
      publiclyRevealed: true,
    });
  }
}

function projectActiveEffectStageFormation(game: GameState) {
  const formation = game.activeEffect?.stageFormation;
  if (!formation) {
    return undefined;
  }
  return {
    playerSeat: getSeatForPlayer(game, formation.playerId),
    slots: formation.slots.map((slot) => ({
      slot: slot.slot,
      cardId: slot.cardId,
      objectId: slot.cardId ? createPublicObjectId(slot.cardId) : null,
      originalSlot: slot.originalSlot,
      energyBelowCount: slot.energyBelowCount,
      memberBelowCount: slot.memberBelowCount,
    })),
  };
}

function projectActiveEffectCardSelection(
  game: GameState,
  viewerSeat: Seat,
  objects: Record<string, ViewCardObject>
): ActiveEffectCardSelectionProjection {
  const effect = game.activeEffect;
  if (!effect) {
    return {};
  }

  const selectableCardIds = effect.selectableCardIds;
  const waitingSeat = effect.awaitingPlayerId
    ? getSeatForPlayer(game, effect.awaitingPlayerId)
    : null;
  const isWaitingPlayerView = waitingSeat === viewerSeat;
  const blindForWaitingPlayer =
    effect.selectableCardVisibility === 'AWAITING_PLAYER_BLIND' && isWaitingPlayerView;
  const explicitlyPrivate =
    (effect.selectableCardVisibility === 'AWAITING_PLAYER_ONLY' ||
      effect.selectableCardVisibility === 'AWAITING_PLAYER_BLIND') &&
    !isWaitingPlayerView;

  if (blindForWaitingPlayer) {
    const selectableObjectIds = (selectableCardIds ?? []).map((_, index) => {
      const token = createBlindCardSelectionToken(index);
      const publicObjectId = createPublicObjectId(token);
      objects[publicObjectId] = {
        publicObjectId,
        ownerSeat: getSeatForPlayer(game, effect.controllerId) ?? viewerSeat,
        controllerSeat: getSeatForPlayer(game, effect.controllerId) ?? viewerSeat,
        surface: 'BACK',
      };
      return publicObjectId;
    });

    return {
      selectableObjectIds,
      selectableObjectsFaceDown: true,
      selectableObjectMode: effect.selectableCardMode,
      minSelectableObjects: effect.minSelectableCards,
      maxSelectableObjects: effect.maxSelectableCards,
      selectionLabel: effect.selectionLabel,
      confirmSelectionLabel: effect.confirmSelectionLabel,
      canSkipSelection: effect.canSkipSelection,
      skipSelectionLabel: effect.skipSelectionLabel,
    };
  }
  const allSelectableCardsVisible =
    selectableCardIds === undefined ||
    selectableCardIds.every((cardId) => {
      const object = objects[createPublicObjectId(cardId)];
      return object?.surface === 'FRONT';
    });

  if (explicitlyPrivate || !allSelectableCardsVisible) {
    return {};
  }

  return {
    selectableObjectIds: selectableCardIds?.map(createPublicObjectId),
    selectableObjectMode: effect.selectableCardMode,
    minSelectableObjects: effect.minSelectableCards,
    maxSelectableObjects: effect.maxSelectableCards,
    selectionLabel: effect.selectionLabel,
    confirmSelectionLabel: effect.confirmSelectionLabel,
    canSkipSelection: effect.canSkipSelection,
    skipSelectionLabel: effect.skipSelectionLabel,
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
    player.id,
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

function collectLiveModifiersForViewer(
  game: GameState,
  viewerSeat: Seat
): readonly LiveModifierState[] {
  return collectLiveModifiers(game).filter((modifier) =>
    isLiveModifierVisibleToViewer(game, viewerSeat, modifier)
  );
}

function isLiveModifierVisibleToViewer(
  game: GameState,
  viewerSeat: Seat,
  modifier: LiveModifierState
): boolean {
  const dependency = modifier.visibilityDependency;
  if (!dependency) {
    return true;
  }

  switch (dependency.kind) {
    case 'PLAYER_LIVE_ZONE_CONTENTS':
      return arePlayerLiveZoneContentsVisibleToViewer(game, dependency.playerId, viewerSeat);
  }
}

function arePlayerLiveZoneContentsVisibleToViewer(
  game: GameState,
  playerId: string,
  viewerSeat: Seat
): boolean {
  const ownerSeat = getSeatForPlayer(game, playerId);
  if (ownerSeat === null || ownerSeat === viewerSeat) {
    return true;
  }

  const player = game.players.find((candidate) => candidate.id === playerId);
  if (!player) {
    return true;
  }

  return player.liveZone.cardIds.every(
    (cardId) => player.liveZone.cardStates.get(cardId)?.face !== FaceState.FACE_DOWN
  );
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
  playerId: string,
  zone: MemberSlotZoneState,
  movedToStageThisTurn: readonly string[],
  ownerSeat: Seat,
  viewerSeat: Seat,
  objects: Record<string, ViewCardObject>,
  zones: Partial<Record<ViewZoneKey, ViewZoneState>>
): void {
  const liveModifiers = collectLiveModifiersForViewer(game, viewerSeat);

  for (const slot of [SlotPosition.LEFT, SlotPosition.CENTER, SlotPosition.RIGHT]) {
    const occupantId = zone.slots[slot];
    const overlayIds = zone.energyBelow[slot];
    const memberBelowIds = zone.memberBelow[slot];
    const zoneKey = `${ownerSeat}_MEMBER_${slot}` as ViewZoneKey;

    zones[zoneKey] = {
      zone: ZoneType.MEMBER_SLOT,
      ownerSeat,
      count: (occupantId ? 1 : 0) + overlayIds.length + memberBelowIds.length,
      ordered: false,
      slotMap: {
        [slot]: occupantId ? createPublicObjectId(occupantId) : null,
      },
      overlays: {
        [slot]: overlayIds.map((cardId) => createPublicObjectId(cardId)),
      },
      memberBelow: {
        [slot]: memberBelowIds.map((cardId) => createPublicObjectId(cardId)),
      },
    };

    if (occupantId) {
      const occupant = game.cardRegistry.get(occupantId);
      const state = zone.cardStates.get(occupantId);
      if (occupant) {
        const effectiveHearts = isMemberCardData(occupant.data)
          ? getMemberEffectiveHeartIcons(game, playerId, occupantId, liveModifiers)
          : [];
        const effectiveBlade = isMemberCardData(occupant.data)
          ? getMemberEffectiveBladeCount(game, playerId, occupantId, liveModifiers)
          : 0;
        const effectiveCost = isMemberCardData(occupant.data)
          ? getMemberEffectiveCost(game, playerId, occupantId)
          : 0;
        upsertViewObject(objects, occupant, ownerSeat, 'FRONT', state?.orientation, state?.face, {
          enteredStageThisTurn: movedToStageThisTurn.includes(occupantId),
          frontInfo: isMemberCardData(occupant.data)
            ? buildStageMemberFrontInfo(occupant, effectiveHearts, effectiveBlade, effectiveCost)
            : undefined,
          activatedAbilityUiConfig: isMemberCardData(occupant.data)
            ? (getActivatedAbilityUiConfig(
                occupant.data.cardCode,
                CardAbilitySourceZone.STAGE_MEMBER,
                {
                  game,
                  playerId,
                  sourceCardId: occupantId,
                }
              ) ?? undefined)
            : undefined,
        });
      }
    }

    for (const energyId of overlayIds) {
      const energy = game.cardRegistry.get(energyId);
      if (energy) {
        upsertViewObject(objects, energy, ownerSeat, 'FRONT');
      }
    }

    for (const memberId of memberBelowIds) {
      const member = game.cardRegistry.get(memberId);
      if (member) {
        upsertViewObject(objects, member, ownerSeat, 'FRONT', undefined, undefined, {
          enteredStageThisTurn: movedToStageThisTurn.includes(memberId),
        });
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
  const inspectionViewerId =
    game.inspectionContext?.viewerPlayerId ?? game.inspectionContext?.ownerPlayerId ?? null;
  const inspectionViewerSeat = inspectionViewerId
    ? getSeatForPlayer(game, inspectionViewerId)
    : null;
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
        ownerSeat: inspectionViewerSeat ?? seat,
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
  metadata?: Pick<
    ViewCardObject,
    | 'publiclyRevealed'
    | 'judgmentResult'
    | 'enteredStageThisTurn'
    | 'frontInfo'
    | 'activatedAbilityUiConfig'
  > & {
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
    frontInfo: surface === 'FRONT' ? (metadata?.frontInfo ?? buildFrontInfo(card)) : undefined,
    activatedAbilityUiConfig: surface === 'FRONT' ? metadata?.activatedAbilityUiConfig : undefined,
  };
}

function buildLiveResultView(game: GameState, viewerSeat: Seat): LiveResultViewState {
  const firstPlayerId = game.players[0]?.id;
  const secondPlayerId = game.players[1]?.id;
  const currentSuccessLiveSettlementPlayerId =
    game.currentSubPhase === SubPhase.RESULT_SETTLEMENT
      ? getCurrentSuccessLiveSettlementPlayerId(game)
      : null;
  const currentSuccessLiveSettlementSeat =
    currentSuccessLiveSettlementPlayerId !== null
      ? getSeatForPlayer(game, currentSuccessLiveSettlementPlayerId)
      : null;
  const successLiveSelectionCandidateIds =
    currentSuccessLiveSettlementPlayerId !== null
      ? getSuccessLiveSelectionCandidateIds(game, currentSuccessLiveSettlementPlayerId)
      : [];
  const liveModifiers = collectLiveModifiersForViewer(game, viewerSeat);
  const liveModifierProjection = projectLiveModifierCompatibility(liveModifiers);
  const liveRequirementReductions = new Map(game.liveResolution.liveRequirementReductions);
  for (const [cardId, reduction] of liveModifierProjection.liveRequirementReductions.entries()) {
    liveRequirementReductions.set(cardId, reduction);
  }
  const liveRequirementModifiers = new Map(game.liveResolution.liveRequirementModifiers);
  for (const [cardId, modifiers] of liveModifierProjection.liveRequirementModifiers.entries()) {
    liveRequirementModifiers.set(cardId, modifiers);
  }
  const playerHeartBonuses = new Map(game.liveResolution.playerHeartBonuses);
  for (const [playerId, hearts] of liveModifierProjection.playerHeartBonuses.entries()) {
    playerHeartBonuses.set(playerId, hearts);
  }

  return {
    scores: {
      FIRST: firstPlayerId ? (game.liveResolution.playerScores.get(firstPlayerId) ?? 0) : 0,
      SECOND: secondPlayerId ? (game.liveResolution.playerScores.get(secondPlayerId) ?? 0) : 0,
    },
    scoreModifiers: {
      FIRST: firstPlayerId
        ? getPlayerLiveScoreModifier(game.liveResolution, firstPlayerId, liveModifiers)
        : 0,
      SECOND: secondPlayerId
        ? getPlayerLiveScoreModifier(game.liveResolution, secondPlayerId, liveModifiers)
        : 0,
    },
    heartBonuses: {
      FIRST: firstPlayerId ? (playerHeartBonuses.get(firstPlayerId) ?? []) : [],
      SECOND: secondPlayerId ? (playerHeartBonuses.get(secondPlayerId) ?? []) : [],
    },
    cheerHeartColorReplacements: buildCheerHeartColorReplacementView(game, liveModifiers),
    requirementReductions: Object.fromEntries(
      [...liveRequirementReductions.entries()].map(([cardId, reduction]) => [
        createPublicObjectId(cardId),
        reduction,
      ])
    ),
    requirementModifiers: Object.fromEntries(
      [...liveRequirementModifiers.entries()].map(([cardId, modifiers]) => [
        createPublicObjectId(cardId),
        modifiers,
      ])
    ),
    liveCardScoreModifiers: buildLiveCardScoreModifierView(liveModifiers),
    winnerSeats: game.liveResolution.liveWinnerIds
      .map((playerId) => getSeatForPlayer(game, playerId))
      .filter((seat): seat is Seat => seat !== null),
    confirmedSeats: game.liveResolution.scoreConfirmedBy
      .map((playerId) => getSeatForPlayer(game, playerId))
      .filter((seat): seat is Seat => seat !== null),
    successLiveSelection:
      currentSuccessLiveSettlementPlayerId !== null
        ? {
            waitingSeat: currentSuccessLiveSettlementSeat,
            candidateObjectIds: successLiveSelectionCandidateIds.map(createPublicObjectId),
            canSkipToWaitingRoom: true,
          }
        : null,
  };
}

function buildCheerHeartColorReplacementView(
  game: GameState,
  liveModifiers: readonly LiveModifierState[]
): LiveResultViewState['cheerHeartColorReplacements'] {
  const replacements: Record<Seat, LiveResultViewState['cheerHeartColorReplacements'][Seat]> = {
    FIRST: null,
    SECOND: null,
  };
  for (const modifier of liveModifiers) {
    if (modifier.kind !== 'CHEER_CARD_HEART_COLOR_REPLACEMENT') {
      continue;
    }
    const seat = getSeatForPlayer(game, modifier.playerId);
    if (!seat) {
      continue;
    }
    replacements[seat] = {
      fromColors: [...modifier.fromColors],
      toColor: modifier.toColor,
    };
  }
  return replacements;
}

function buildLiveCardScoreModifierView(
  liveModifiers: readonly LiveModifierState[]
): Record<string, number> {
  const modifiers: Record<string, number> = {};
  for (const modifier of liveModifiers) {
    if (modifier.kind !== 'SCORE' || !modifier.liveCardId) {
      continue;
    }
    const objectId = createPublicObjectId(modifier.liveCardId);
    modifiers[objectId] = (modifiers[objectId] ?? 0) + modifier.countDelta;
  }
  return modifiers;
}

function buildFrontInfo(card: CardInstance): ViewFrontCardInfo {
  if (isMemberCardData(card.data)) {
    return {
      cardCode: card.data.cardCode,
      nameJp: card.data.nameJp,
      nameCn: card.data.nameCn,
      cardType: card.data.cardType,
      cost: card.data.cost,
      hearts: card.data.hearts.map((heart) => ({ color: heart.color, count: heart.count })),
      bladeHearts: card.data.bladeHearts?.map((item) => ({ ...item })),
      cardTextJp: card.data.cardTextJp,
      cardTextCn: card.data.cardTextCn,
    };
  }

  if (isLiveCardData(card.data)) {
    return {
      cardCode: card.data.cardCode,
      nameJp: card.data.nameJp,
      nameCn: card.data.nameCn,
      cardType: card.data.cardType,
      score: card.data.score,
      requiredHearts: buildViewHeartRequirement(card.data.requirements),
      bladeHearts: card.data.bladeHearts?.map((item) => ({ ...item })),
      cardTextJp: card.data.cardTextJp,
      cardTextCn: card.data.cardTextCn,
    };
  }

  return {
    cardCode: card.data.cardCode,
    nameJp: card.data.nameJp,
    nameCn: card.data.nameCn,
    cardType: card.data.cardType,
    cardTextJp: card.data.cardTextJp,
    cardTextCn: card.data.cardTextCn,
  };
}

function buildStageMemberFrontInfo(
  card: CardInstance,
  hearts: readonly { readonly color: HeartColor; readonly count: number }[],
  blade: number,
  cost: number
): ViewFrontCardInfo {
  const frontInfo = buildFrontInfo(card);
  if (!isMemberCardData(card.data)) {
    return frontInfo;
  }

  const modifierDelta = buildMemberModifierDelta(
    card.data.hearts,
    hearts,
    card.data.blade,
    blade,
    card.data.cost,
    cost
  );

  return {
    ...frontInfo,
    hearts: hearts.map((heart) => ({ color: heart.color, count: heart.count })),
    ...(modifierDelta ? { modifierDelta } : {}),
  };
}

function buildMemberModifierDelta(
  printedHearts: readonly { readonly color: HeartColor; readonly count: number }[],
  effectiveHearts: readonly { readonly color: HeartColor; readonly count: number }[],
  printedBlade: number,
  effectiveBlade: number,
  printedCost: number,
  effectiveCost: number
): ViewMemberModifierDelta | undefined {
  const heartDeltas = buildHeartDeltas(printedHearts, effectiveHearts);
  const bladeDelta = effectiveBlade - printedBlade;
  const costDelta = effectiveCost - printedCost;
  if (costDelta === 0 && bladeDelta === 0 && heartDeltas.length === 0) {
    return undefined;
  }

  return {
    ...(costDelta !== 0 ? { costDelta } : {}),
    ...(bladeDelta !== 0 ? { bladeDelta } : {}),
    ...(heartDeltas.length > 0 ? { heartDeltas } : {}),
  };
}

function buildHeartDeltas(
  printedHearts: readonly { readonly color: HeartColor; readonly count: number }[],
  effectiveHearts: readonly { readonly color: HeartColor; readonly count: number }[]
): readonly { readonly color: HeartColor; readonly count: number }[] {
  const printedCounts = countHeartsByColor(printedHearts);
  const effectiveCounts = countHeartsByColor(effectiveHearts);
  const colors = new Set<HeartColor>([...printedCounts.keys(), ...effectiveCounts.keys()]);
  return [...colors]
    .map((color) => ({
      color,
      count: (effectiveCounts.get(color) ?? 0) - (printedCounts.get(color) ?? 0),
    }))
    .filter((heart) => heart.count !== 0);
}

function countHeartsByColor(
  hearts: readonly { readonly color: HeartColor; readonly count: number }[]
): ReadonlyMap<HeartColor, number> {
  const counts = new Map<HeartColor, number>();
  for (const heart of hearts) {
    counts.set(heart.color, (counts.get(heart.color) ?? 0) + heart.count);
  }
  return counts;
}

function buildViewHeartRequirement(requirement: HeartRequirement): ViewHeartRequirement {
  const colorRequirements: Partial<Record<HeartColor, number>> = {};
  for (const [color, count] of requirement.colorRequirements) {
    if (count > 0) {
      colorRequirements[color] = count;
    }
  }

  return {
    colorRequirements,
    totalRequired: requirement.totalRequired,
  };
}

function buildPermissionViewState(
  game: GameState,
  viewerPlayerId: string,
  viewerSeat: Seat
): PermissionViewState {
  const availableActionTypes = inferAvailableActionTypes(game);
  const canUsePhaseCommands = canViewerUsePhaseCommands(game, viewerPlayerId, viewerSeat);
  const allowSharedOwnDeskCommands =
    game.currentSubPhase !== SubPhase.RESULT_ANIMATION &&
    game.currentSubPhase !== SubPhase.RESULT_SETTLEMENT;
  const phaseHints = availableActionTypes
    .filter(
      (command) =>
        canUsePhaseCommands ||
        (allowSharedOwnDeskCommands &&
          isOwnDeskFreeDragWindow(game.currentPhase, game.currentSubPhase) &&
          isOwnDeskFreeDragCommand(command))
    )
    .map((command) => buildPhaseCommandHint(command, game, viewerPlayerId, viewerSeat))
    .filter((hint): hint is ViewCommandHint => hint !== null);
  const activeEffectPhaseHints = game.activeEffect
    ? phaseHints.filter((hint) => hint.command !== GameCommandType.OPEN_INSPECTION)
    : phaseHints;

  if (!game.inspectionContext) {
    return {
      availableCommands: mergeCommandHints(
        activeEffectPhaseHints,
        buildActiveEffectCommandHints(game, viewerPlayerId),
        buildPendingCostCommandHints(game, viewerPlayerId, viewerSeat)
      ),
    };
  }

  const inspectionSeat = getSeatForPlayer(
    game,
    game.inspectionContext.viewerPlayerId ?? game.inspectionContext.ownerPlayerId
  );
  if (inspectionSeat !== viewerSeat) {
    // 检视期间不支持并发检视，非检视所有者不应看到 OPEN_INSPECTION 为可用命令
    return {
      availableCommands: mergeCommandHints(
        phaseHints.filter((hint) => hint.command !== GameCommandType.OPEN_INSPECTION),
        buildActiveEffectCommandHints(game, viewerPlayerId),
        buildPendingCostCommandHints(game, viewerPlayerId, viewerSeat)
      ),
    };
  }

  const activeEffectControlsInspection = isActiveEffectControlledInspection(game, viewerPlayerId);
  const inspectionPhaseHints = activeEffectControlsInspection
    ? phaseHints.filter(
        (hint) => !ACTIVE_EFFECT_INSPECTION_COMMAND_TYPES.has(hint.command as GameCommandType)
      )
    : activeEffectPhaseHints;

  return {
    availableCommands: mergeCommandHints(
      inspectionPhaseHints,
      activeEffectControlsInspection
        ? []
        : buildInspectionCommandHints(game, viewerPlayerId, viewerSeat, {
            skipOpenInspection: !!game.activeEffect,
          }),
      buildActiveEffectCommandHints(game, viewerPlayerId),
      buildPendingCostCommandHints(game, viewerPlayerId, viewerSeat)
    ),
  };
}

function buildActiveEffectCommandHints(
  game: GameState,
  viewerPlayerId: string
): readonly ViewCommandHint[] {
  if (!game.activeEffect) {
    return [];
  }
  if (
    game.activeEffect.publicCardSelectionAutoAdvanceAt === undefined &&
    game.activeEffect.awaitingPlayerId !== viewerPlayerId
  ) {
    return [];
  }

  return [
    buildCommandHint(GameCommandType.CONFIRM_EFFECT_STEP, {
      params: {
        effectId: game.activeEffect.id,
        ...(game.activeEffect.publicCardSelectionAutoAdvanceAt !== undefined
          ? {
              publicCardSelectionAutoAdvanceAt:
                game.activeEffect.publicCardSelectionAutoAdvanceAt,
            }
          : {}),
      },
    }),
  ];
}

function buildPendingCostCommandHints(
  game: GameState,
  viewerPlayerId: string,
  viewerSeat: Seat
): readonly ViewCommandHint[] {
  if (!game.pendingCostPayment || game.pendingCostPayment.playerId !== viewerPlayerId) {
    return [];
  }

  return [
    buildCommandHint(GameCommandType.CONFIRM_COST_PAYMENT, {
      scope: createCommandScope({
        zoneKeys: [createOwnedViewZoneKey(viewerSeat, 'ENERGY_ZONE')],
        cardIds: game.pendingCostPayment.payableEnergyCardIds,
      }),
      params: {
        paymentId: game.pendingCostPayment.id,
        requiredCount: game.pendingCostPayment.finalEnergyCost,
      },
    }),
  ];
}

function canViewerUsePhaseCommands(
  game: GameState,
  viewerPlayerId: string,
  viewerSeat: Seat
): boolean {
  if (game.currentSubPhase === SubPhase.RESULT_SCORE_CONFIRM) {
    return true;
  }

  if (game.currentSubPhase === SubPhase.RESULT_ANIMATION) {
    return game.liveResolution.liveWinnerIds.includes(viewerPlayerId);
  }

  if (game.currentSubPhase === SubPhase.RESULT_SETTLEMENT) {
    const currentSettlementPlayerId = getCurrentSuccessLiveSettlementPlayerId(game);
    return currentSettlementPlayerId !== null
      ? currentSettlementPlayerId === viewerPlayerId
      : game.liveResolution.liveWinnerIds.includes(viewerPlayerId);
  }

  const waitingForSeat =
    game.waitingPlayerId !== null ? getSeatForPlayer(game, game.waitingPlayerId) : null;
  return waitingForSeat !== null
    ? waitingForSeat === viewerSeat
    : isPlayerActive(game, viewerPlayerId);
}

function mergeCommandHints(
  ...hintGroups: readonly (readonly ViewCommandHint[])[]
): readonly ViewCommandHint[] {
  const merged = new Map<string, ViewCommandHint>();
  for (const hints of hintGroups) {
    for (const hint of hints) {
      merged.set(hint.command, hint);
    }
  }
  return [...merged.values()];
}

function inferAvailableActionTypes(game: GameState): readonly GameCommandType[] {
  const hasUnresolvedAbilityOrCost = hasPendingAbilityOrChoice(game);
  switch (game.currentPhase) {
    case GamePhase.MULLIGAN_PHASE:
      return [GameCommandType.MULLIGAN];
    case GamePhase.MAIN_PHASE:
      return [...MAIN_PHASE_ACTIVE_PLAYER_COMMAND_TYPES, GameCommandType.END_PHASE];
    case GamePhase.LIVE_SET_PHASE:
      return [
        GameCommandType.SET_LIVE_CARD,
        ...(isOwnDeskFreeDragWindow(game.currentPhase, game.currentSubPhase)
          ? OWN_DESK_FREE_DRAG_COMMAND_TYPES
          : []),
        GameCommandType.CONFIRM_STEP,
      ];
    case GamePhase.PERFORMANCE_PHASE:
      if (game.currentSubPhase === SubPhase.PERFORMANCE_JUDGMENT) {
        return PERFORMANCE_SUCCESS_INTERACTION_COMMAND_TYPES;
      }
      if (game.currentSubPhase === SubPhase.PERFORMANCE_LIVE_START_EFFECTS) {
        return PERFORMANCE_LIVE_START_COMMAND_TYPES;
      }
      if (game.currentSubPhase === SubPhase.PERFORMANCE_REVEAL) {
        // PERFORMANCE_REVEAL 是自动化子阶段（requiresUserAction: false），
        // 由 REVEAL_LIVE_CARDS 事件驱动推进，不属于玩家交互窗口
        return [];
      }
      return [...OWN_DESK_FREE_DRAG_COMMAND_TYPES, GameCommandType.CONFIRM_STEP];
    case GamePhase.LIVE_RESULT_PHASE:
      if (isResultSuccessEffectSubPhase(game.currentSubPhase)) {
        return RESULT_SUCCESS_EFFECT_COMMAND_TYPES;
      }
      if (game.currentSubPhase === SubPhase.RESULT_SCORE_CONFIRM) {
        return [
          ...OWN_DESK_FREE_DRAG_COMMAND_TYPES,
          ...(hasUnresolvedAbilityOrCost ? [] : [GameCommandType.SUBMIT_SCORE]),
        ];
      }
      if (game.currentSubPhase === SubPhase.RESULT_ANIMATION) {
        return [...OWN_DESK_FREE_DRAG_COMMAND_TYPES, GameCommandType.CONFIRM_STEP];
      }
      if (game.currentSubPhase === SubPhase.RESULT_SETTLEMENT) {
        return [
          ...OWN_DESK_FREE_DRAG_COMMAND_TYPES,
          GameCommandType.SELECT_SUCCESS_LIVE,
          GameCommandType.CONFIRM_STEP,
        ];
      }
      if (game.currentSubPhase === SubPhase.RESULT_TURN_END) {
        // RESULT_TURN_END 是自动化子阶段（requiresUserAction: false），
        // 由 FINALIZE_LIVE_RESULT 事件驱动推进，不允许手动命令
        return [];
      }
      return [...OWN_DESK_FREE_DRAG_COMMAND_TYPES, GameCommandType.CONFIRM_STEP];
    default:
      return [];
  }
}

function buildInspectionCommandHints(
  game: GameState,
  viewerPlayerId: string,
  viewerSeat: Seat,
  options: { readonly skipOpenInspection?: boolean } = {}
): readonly ViewCommandHint[] {
  const inspectionOwnerId = game.inspectionContext?.ownerPlayerId ?? viewerPlayerId;
  const ownedCardCount = game.inspectionZone.cardIds.filter(
    (cardId) => game.cardRegistry.get(cardId)?.ownerId === inspectionOwnerId
  ).length;
  const ownedCardIds = getOwnedCardIds(game.inspectionZone.cardIds, game, inspectionOwnerId);
  const unrevealedOwnedCardIds = ownedCardIds.filter(
    (cardId) => !game.inspectionZone.revealedCardIds.includes(cardId)
  );
  const sourceSuffix =
    game.inspectionContext?.sourceZone === ZoneType.ENERGY_DECK ? 'ENERGY_DECK' : 'MAIN_DECK';
  const inspectionZoneKey = createOwnedViewZoneKey(viewerSeat, 'INSPECTION_ZONE');
  const hints: ViewCommandHint[] = [];

  if (options.skipOpenInspection !== true) {
    hints.push(
      buildCommandHint(GameCommandType.OPEN_INSPECTION, {
        scope: createCommandScope({
          zoneKeys: [createOwnedViewZoneKey(viewerSeat, sourceSuffix)],
        }),
        params: {
          sourceZone: game.inspectionContext?.sourceZone,
        },
      })
    );
  }

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
      }),
      buildCommandHint(GameCommandType.FINISH_INSPECTION_WITH_ARRANGEMENT, {
        scope: inspectionScope,
        params: {
          sourceZone: game.inspectionContext?.sourceZone,
          requiresAllRemainingInspectionCards: true,
        },
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
    case GameCommandType.TAP_MEMBER:
      return buildCommandHint(command, {
        scope: createCommandScope({
          zoneKeys: [
            createOwnedViewZoneKey(viewerSeat, 'MEMBER_LEFT'),
            createOwnedViewZoneKey(viewerSeat, 'MEMBER_CENTER'),
            createOwnedViewZoneKey(viewerSeat, 'MEMBER_RIGHT'),
          ],
        }),
      });
    case GameCommandType.ACTIVATE_ABILITY:
      return buildCommandHint(command, {
        scope: createCommandScope({
          zoneKeys: [
            createOwnedViewZoneKey(viewerSeat, 'HAND'),
            createOwnedViewZoneKey(viewerSeat, 'MEMBER_LEFT'),
            createOwnedViewZoneKey(viewerSeat, 'MEMBER_CENTER'),
            createOwnedViewZoneKey(viewerSeat, 'MEMBER_RIGHT'),
            createOwnedViewZoneKey(viewerSeat, 'WAITING_ROOM'),
          ],
        }),
      });
    case GameCommandType.TAP_ENERGY:
      return buildCommandHint(command, {
        scope: createCommandScope({
          zoneKeys: [createOwnedViewZoneKey(viewerSeat, 'ENERGY_ZONE')],
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
    const currentSettlementPlayerId = getCurrentSuccessLiveSettlementPlayerId(game);
    const allSettlementsCompleted = haveAllSuccessLiveSettlementsCompleted(game);
    const hasCandidates = hasPendingSuccessLiveSelection(game, viewerPlayerId);
    const isCurrentSettlementPlayer = currentSettlementPlayerId === viewerPlayerId;
    const hasConfirmedSettlement =
      game.liveResolution.settlementConfirmedBy.includes(viewerPlayerId);
    const enabled =
      isWinner &&
      (allSettlementsCompleted ||
        (isCurrentSettlementPlayer && !hasConfirmedSettlement && !hasCandidates));
    const reason = !isWinner
      ? '当前玩家不是本轮胜者'
      : allSettlementsCompleted
        ? undefined
        : !isCurrentSettlementPlayer
          ? '等待当前胜者完成成功 Live 选择'
          : hasCandidates
            ? '请先选择成功 Live，或使用全部放置入休息室'
            : hasConfirmedSettlement
              ? '已确认结算'
              : undefined;
    return buildCommandHint(GameCommandType.CONFIRM_STEP, {
      enabled,
      reason,
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
  const currentSettlementPlayerId = getCurrentSuccessLiveSettlementPlayerId(game);
  const isActivePerformer = game.players[game.activePlayerIndex]?.id === viewerPlayerId;
  const canSelectDuringPerformance =
    (game.currentPhase === GamePhase.PERFORMANCE_PHASE &&
      game.currentSubPhase === SubPhase.PERFORMANCE_JUDGMENT) ||
    (game.currentPhase === GamePhase.LIVE_RESULT_PHASE &&
      isResultSuccessEffectSubPhase(game.currentSubPhase));
  const ownedLiveCardIds =
    game.currentSubPhase === SubPhase.RESULT_SETTLEMENT
      ? getSuccessLiveSelectionCandidateIds(game, viewerPlayerId)
      : getOwnedCardIds(
          game.players.find((player) => player.id === viewerPlayerId)?.liveZone.cardIds ?? [],
          game,
          viewerPlayerId
        ).filter((cardId) => canLiveCardEnterSuccessZone(game, viewerPlayerId, cardId));
  const enabled = hasMoved
    ? false
    : canSelectDuringPerformance
      ? isActivePerformer
      : isWinner && currentSettlementPlayerId === viewerPlayerId && ownedLiveCardIds.length > 0;
  let reason: string | undefined;
  if (hasMoved) {
    reason = '已选择成功 Live 卡';
  } else if (canSelectDuringPerformance) {
    reason = isActivePerformer ? undefined : '当前不是你的表演阶段';
  } else if (!isWinner) {
    reason = '当前玩家不是本轮胜者';
  } else if (currentSettlementPlayerId !== viewerPlayerId) {
    reason = '当前不是你的成功 Live 结算顺序';
  } else if (ownedLiveCardIds.length === 0) {
    reason = '没有可进入成功区的成功 Live';
  }

  return buildCommandHint(GameCommandType.SELECT_SUCCESS_LIVE, {
    enabled,
    reason,
    scope: createCommandScope({
      zoneKeys: [createOwnedViewZoneKey(viewerSeat, 'LIVE_ZONE')],
      cardIds: ownedLiveCardIds,
    }),
    params: {
      canSkipSuccessLiveSelection:
        game.currentSubPhase === SubPhase.RESULT_SETTLEMENT &&
        currentSettlementPlayerId === viewerPlayerId,
    },
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
