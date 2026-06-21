import type { GameState } from '../../domain/entities/game.js';
import { emitGameEvent, getPlayerById, updatePlayer } from '../../domain/entities/game.js';
import type { MemberCardData } from '../../domain/entities/card.js';
import { isMemberCardData } from '../../domain/entities/card.js';
import { recordPositionMove } from '../../domain/entities/player.js';
import { removeCardFromZone } from '../../domain/entities/zone.js';
import {
  createEnterStageEvent,
  createMemberSlotMovedEvent,
  createMemberStateChangedEvent,
} from '../../domain/events/game-events.js';
import type { MemberStateChangeCause } from '../../domain/events/game-events.js';
import { FaceState, OrientationState, SlotPosition, ZoneType } from '../../shared/types/enums.js';

export interface SetMemberOrientationResult {
  readonly gameState: GameState;
  readonly cardId: string;
  readonly previousOrientation: OrientationState;
  readonly nextOrientation: OrientationState;
}

export interface SetMembersOrientationResult {
  readonly gameState: GameState;
  readonly updatedMemberCardIds: readonly string[];
  readonly previousOrientations: readonly {
    readonly cardId: string;
    readonly orientation: OrientationState;
  }[];
  readonly nextOrientation: OrientationState;
}

export interface MoveMemberBetweenSlotsResult {
  readonly gameState: GameState;
  readonly movedCardId: string;
  readonly fromSlot: SlotPosition;
  readonly toSlot: SlotPosition;
  readonly swappedCardId: string | null;
}

export interface PlayMembersFromWaitingRoomResult {
  readonly gameState: GameState;
  readonly playedMembers: readonly {
    readonly cardId: string;
    readonly toSlot: SlotPosition;
    readonly data: MemberCardData;
  }[];
}

export interface PlayMemberBelowCardToEmptySlotResult {
  readonly gameState: GameState;
  readonly playedMember: {
    readonly cardId: string;
    readonly fromSlot: SlotPosition;
    readonly toSlot: SlotPosition;
    readonly hostCardId: string;
    readonly data: MemberCardData;
  };
}

export function setMemberOrientation(
  game: GameState,
  playerId: string,
  cardId: string,
  orientation: OrientationState,
  cause?: MemberStateChangeCause
): SetMemberOrientationResult | null {
  const player = getPlayerById(game, playerId);
  const currentState = player?.memberSlots.cardStates.get(cardId);
  if (!player || !currentState || !findMemberSlotByCardId(player.memberSlots.slots, cardId)) {
    return null;
  }

  if (currentState.orientation === orientation) {
    return {
      gameState: game,
      cardId,
      previousOrientation: currentState.orientation,
      nextOrientation: orientation,
    };
  }

  let gameState = updatePlayer(game, playerId, (currentPlayer) => {
    const cardStates = new Map(currentPlayer.memberSlots.cardStates);
    cardStates.set(cardId, {
      ...currentState,
      orientation,
    });

    return {
      ...currentPlayer,
      memberSlots: {
        ...currentPlayer.memberSlots,
        cardStates,
      },
    };
  });
  const slot = findMemberSlotByCardId(player.memberSlots.slots, cardId);
  if (!slot) {
    return null;
  }
  gameState = emitGameEvent(
    gameState,
    createMemberStateChangedEvent(cardId, playerId, slot, currentState.orientation, orientation, cause)
  );

  return {
    gameState,
    cardId,
    previousOrientation: currentState.orientation,
    nextOrientation: orientation,
  };
}

export function setMembersOrientation(
  game: GameState,
  playerId: string,
  cardIds: readonly string[],
  orientation: OrientationState,
  cause?: MemberStateChangeCause
): SetMembersOrientationResult | null {
  const player = getPlayerById(game, playerId);
  const uniqueCardIds = [...new Set(cardIds)];
  if (!player || uniqueCardIds.length !== cardIds.length) {
    return null;
  }

  const previousOrientations: {
    readonly cardId: string;
    readonly orientation: OrientationState;
  }[] = [];
  for (const cardId of uniqueCardIds) {
    const currentState = player.memberSlots.cardStates.get(cardId);
    if (!currentState || !findMemberSlotByCardId(player.memberSlots.slots, cardId)) {
      return null;
    }
    previousOrientations.push({ cardId, orientation: currentState.orientation });
  }

  if (uniqueCardIds.length === 0) {
    return {
      gameState: game,
      updatedMemberCardIds: [],
      previousOrientations: [],
      nextOrientation: orientation,
    };
  }

  let gameState = updatePlayer(game, playerId, (currentPlayer) => {
    const cardStates = new Map(currentPlayer.memberSlots.cardStates);
    for (const cardId of uniqueCardIds) {
      const currentState = cardStates.get(cardId);
      if (currentState && currentState.orientation !== orientation) {
        cardStates.set(cardId, {
          ...currentState,
          orientation,
        });
      }
    }

    return {
      ...currentPlayer,
      memberSlots: {
        ...currentPlayer.memberSlots,
        cardStates,
      },
    };
  });
  for (const previous of previousOrientations) {
    if (previous.orientation === orientation) {
      continue;
    }
    const slot = findMemberSlotByCardId(player.memberSlots.slots, previous.cardId);
    if (!slot) {
      return null;
    }
    gameState = emitGameEvent(
      gameState,
      createMemberStateChangedEvent(
        previous.cardId,
        playerId,
        slot,
        previous.orientation,
        orientation,
        cause
      )
    );
  }

  return {
    gameState,
    updatedMemberCardIds: uniqueCardIds,
    previousOrientations,
    nextOrientation: orientation,
  };
}

export function moveMemberBetweenSlots(
  game: GameState,
  playerId: string,
  cardId: string,
  toSlot: SlotPosition
): MoveMemberBetweenSlotsResult | null {
  const player = getPlayerById(game, playerId);
  if (!player) {
    return null;
  }

  const fromSlot = findMemberSlotByCardId(player.memberSlots.slots, cardId);
  if (!fromSlot || fromSlot === toSlot) {
    return null;
  }

  const swappedCardId = player.memberSlots.slots[toSlot] ?? null;
  let gameState = updatePlayer(game, playerId, (currentPlayer) => {
    const fromEnergyBelow = currentPlayer.memberSlots.energyBelow[fromSlot] ?? [];
    const toEnergyBelow = currentPlayer.memberSlots.energyBelow[toSlot] ?? [];
    const fromMemberBelow = currentPlayer.memberSlots.memberBelow[fromSlot] ?? [];
    const toMemberBelow = currentPlayer.memberSlots.memberBelow[toSlot] ?? [];

    let nextPlayer = {
      ...currentPlayer,
      memberSlots: {
        ...currentPlayer.memberSlots,
        slots: {
          ...currentPlayer.memberSlots.slots,
          [fromSlot]: swappedCardId,
          [toSlot]: cardId,
        },
        energyBelow: {
          ...currentPlayer.memberSlots.energyBelow,
          [fromSlot]: [...toEnergyBelow],
          [toSlot]: [...fromEnergyBelow],
        },
        memberBelow: {
          ...currentPlayer.memberSlots.memberBelow,
          [fromSlot]: [...toMemberBelow],
          [toSlot]: [...fromMemberBelow],
        },
      },
    };
    nextPlayer = recordPositionMove(nextPlayer, cardId);
    return swappedCardId ? recordPositionMove(nextPlayer, swappedCardId) : nextPlayer;
  });
  gameState = emitGameEvent(
    gameState,
    createMemberSlotMovedEvent(cardId, playerId, fromSlot, toSlot, swappedCardId ?? undefined)
  );
  if (swappedCardId) {
    gameState = emitGameEvent(
      gameState,
      createMemberSlotMovedEvent(swappedCardId, playerId, toSlot, fromSlot, cardId)
    );
  }

  return {
    gameState,
    movedCardId: cardId,
    fromSlot,
    toSlot,
    swappedCardId,
  };
}

export function playMembersFromWaitingRoomToEmptySlots(
  game: GameState,
  playerId: string,
  placements: readonly {
    readonly cardId: string;
    readonly toSlot: SlotPosition;
  }[],
  orientation: OrientationState = OrientationState.ACTIVE
): PlayMembersFromWaitingRoomResult | null {
  const player = getPlayerById(game, playerId);
  const uniqueCardIds = new Set(placements.map((placement) => placement.cardId));
  const uniqueSlots = new Set(placements.map((placement) => placement.toSlot));
  if (
    !player ||
    uniqueCardIds.size !== placements.length ||
    uniqueSlots.size !== placements.length
  ) {
    return null;
  }

  const playedMembers: {
    readonly cardId: string;
    readonly toSlot: SlotPosition;
    readonly data: MemberCardData;
  }[] = [];
  for (const placement of placements) {
    if (
      !player.waitingRoom.cardIds.includes(placement.cardId) ||
      player.memberSlots.slots[placement.toSlot] !== null
    ) {
      return null;
    }
    const card = game.cardRegistry.get(placement.cardId);
    if (!card || !isMemberCardData(card.data)) {
      return null;
    }
    playedMembers.push({
      cardId: placement.cardId,
      toSlot: placement.toSlot,
      data: card.data,
    });
  }

  if (placements.length === 0) {
    return {
      gameState: game,
      playedMembers: [],
    };
  }

  let gameState = updatePlayer(game, playerId, (currentPlayer) => {
    let waitingRoom = currentPlayer.waitingRoom;
    const cardStates = new Map(currentPlayer.memberSlots.cardStates);
    const slots = { ...currentPlayer.memberSlots.slots };

    for (const placement of placements) {
      waitingRoom = removeCardFromZone(waitingRoom, placement.cardId);
      slots[placement.toSlot] = placement.cardId;
      cardStates.set(placement.cardId, { orientation, face: FaceState.FACE_UP });
    }

    return {
      ...currentPlayer,
      waitingRoom,
      memberSlots: {
        ...currentPlayer.memberSlots,
        slots,
        cardStates,
      },
    };
  });
  for (const playedMember of playedMembers) {
    gameState = emitGameEvent(
      gameState,
      createEnterStageEvent(
        playedMember.cardId,
        ZoneType.WAITING_ROOM,
        playedMember.toSlot,
        playerId,
        playerId
      )
    );
  }

  return {
    gameState,
    playedMembers,
  };
}

export function playMemberBelowCardToEmptySlot(
  game: GameState,
  playerId: string,
  options: {
    readonly hostCardId: string;
    readonly fromSlot: SlotPosition;
    readonly cardId: string;
    readonly toSlot: SlotPosition;
  }
): PlayMemberBelowCardToEmptySlotResult | null {
  const player = getPlayerById(game, playerId);
  const card = game.cardRegistry.get(options.cardId);
  if (
    !player ||
    !card ||
    card.ownerId !== playerId ||
    !isMemberCardData(card.data) ||
    player.memberSlots.slots[options.fromSlot] !== options.hostCardId ||
    player.memberSlots.slots[options.toSlot] !== null ||
    !(player.memberSlots.memberBelow[options.fromSlot] ?? []).includes(options.cardId)
  ) {
    return null;
  }

  let gameState = updatePlayer(game, playerId, (currentPlayer) => {
    const memberBelow = {
      ...currentPlayer.memberSlots.memberBelow,
      [options.fromSlot]: (currentPlayer.memberSlots.memberBelow[options.fromSlot] ?? []).filter(
        (cardId) => cardId !== options.cardId
      ),
    };
    const slots = {
      ...currentPlayer.memberSlots.slots,
      [options.toSlot]: options.cardId,
    };
    const cardStates = new Map(currentPlayer.memberSlots.cardStates);
    cardStates.set(options.cardId, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    });

    return {
      ...currentPlayer,
      memberSlots: {
        ...currentPlayer.memberSlots,
        slots,
        memberBelow,
        cardStates,
      },
    };
  });
  gameState = emitGameEvent(
    gameState,
    createEnterStageEvent(
      options.cardId,
      ZoneType.MEMBER_SLOT,
      options.toSlot,
      playerId,
      playerId
    )
  );

  return {
    gameState,
    playedMember: {
      cardId: options.cardId,
      fromSlot: options.fromSlot,
      toSlot: options.toSlot,
      hostCardId: options.hostCardId,
      data: card.data,
    },
  };
}

function findMemberSlotByCardId(
  slots: Readonly<Record<SlotPosition, string | null>>,
  cardId: string
): SlotPosition | null {
  for (const slot of Object.values(SlotPosition)) {
    if (slots[slot] === cardId) {
      return slot;
    }
  }

  return null;
}
