import { getCardById, getPlayerById, type GameState } from '../entities/game.js';
import { isLiveCardData } from '../entities/card.js';
import { getStageMemberLifecycleId } from '../rules/card-lifecycle.js';
import type { HextechState } from './state.js';
import { SlotPosition } from '../../shared/types/enums.js';
import { toPlayerLocalSlotForControllerPerspective } from '../../shared/utils/slot-perspective.js';

const SLOTS = [SlotPosition.LEFT, SlotPosition.CENTER, SlotPosition.RIGHT] as const;

function stageSlot(game: GameState, playerId: string, cardId: string) {
  const player = getPlayerById(game, playerId);
  return SLOTS.find((slot) => player?.memberSlots.slots[slot] === cardId);
}

/** External silence disables even a granted column aura; column auras never disable each other. */
export function isMemberDirectlySilenced(game: GameState, cardId: string): boolean {
  return (game.hextech?.silencedMembers ?? []).some(
    (entry) =>
      entry.memberCardId === cardId &&
      entry.turn === game.turnCount &&
      stageSlot(game, entry.playerId, cardId) !== undefined &&
      entry.lifecycleId === getStageMemberLifecycleId(game, cardId)
  );
}

export function isDarkColumnLockActive(
  game: GameState,
  entry: NonNullable<HextechState['columnLocks']>[number]
): boolean {
  return (
    stageSlot(game, entry.playerId, entry.memberCardId) !== undefined &&
    entry.lifecycleId === getStageMemberLifecycleId(game, entry.memberCardId) &&
    !isMemberDirectlySilenced(game, entry.memberCardId)
  );
}

export function getDarkLockedColumns(game: GameState, playerId: string): readonly SlotPosition[] {
  const columns = (game.hextech?.columnLocks ?? []).flatMap((entry) => {
    const slot = stageSlot(game, entry.playerId, entry.memberCardId);
    if (!isDarkColumnLockActive(game, entry)) return [];
    return [toPlayerLocalSlotForControllerPerspective(slot!, entry.playerId, playerId)];
  });
  return [...new Set(columns)];
}

/** Positions refer to the original placed row, including non-LIVE cards removed after reveal. */
export function getDarkLiveSlots(game: GameState, playerId: string): readonly string[] {
  return (
    game.hextech?.liveSlots?.find(
      (entry) => entry.playerId === playerId && entry.turn === game.turnCount
    )?.cardIds ??
    getPlayerById(game, playerId)?.liveZone.cardIds ??
    []
  );
}

export function isFirstLiveSlotMuted(game: GameState, playerId: string): boolean {
  return !!game.hextech?.owned.some(
    (owned) => owned.playerId !== playerId && owned.definitionId === 'dark-first-slot-mute'
  );
}

/** Queries sources only. Never filter already-resolved modifiers or already-queued abilities here. */
export function isCardAbilitySuppressedByDarkHextech(game: GameState, cardId: string): boolean {
  if (!game.hextech) return false;
  const card = getCardById(game, cardId);
  if (!card) return false;
  const player = getPlayerById(game, card.ownerId);
  if (!player) return false;
  const slot = stageSlot(game, player.id, cardId);
  if (slot !== undefined)
    return (
      isMemberDirectlySilenced(game, cardId) || getDarkLockedColumns(game, player.id).includes(slot)
    );
  // Success-zone, hand and below-stage sources are not members/LIVE in a stage column.
  if (!player.liveZone.cardIds.includes(cardId) || !isLiveCardData(card.data)) return false;
  const index = getDarkLiveSlots(game, player.id).indexOf(cardId);
  return (
    (index === 0 && isFirstLiveSlotMuted(game, player.id)) ||
    (player.liveZone.cardIds.indexOf(cardId) < SLOTS.length &&
      getDarkLockedColumns(game, player.id).includes(
        SLOTS[player.liveZone.cardIds.indexOf(cardId)]
      ))
  );
}

export function freezeDarkLiveSlots(game: GameState, playerId: string): GameState {
  if (
    !game.hextech ||
    game.hextech.liveSlots?.some(
      (entry) => entry.playerId === playerId && entry.turn === game.turnCount
    )
  )
    return game;
  return {
    ...game,
    hextech: {
      ...game.hextech,
      liveSlots: [
        ...(game.hextech.liveSlots ?? []).filter((entry) => entry.turn === game.turnCount),
        {
          playerId,
          turn: game.turnCount,
          cardIds: [...(getPlayerById(game, playerId)?.liveZone.cardIds ?? [])],
        },
      ],
    },
  };
}

export function clearDarkHextechUntilLiveEnd(game: GameState): GameState {
  if (!game.hextech) return game;
  return {
    ...game,
    hextech: { ...game.hextech, silencedMembers: undefined, liveSlots: undefined },
  };
}
