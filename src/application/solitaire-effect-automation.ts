import type { GameState } from '../domain/entities/game.js';
import {
  createBlindCardSelectionToken,
  resolveBlindCardSelectionToken,
} from '../shared/utils/blind-card-selection.js';
import {
  GameCommandType,
  type ConfirmEffectStepCommand,
  type GameCommand,
} from './game-commands.js';

/**
 * Builds the narrow set of opponent effect decisions that solitaire mode can
 * make without card-specific knowledge or access to hidden card faces.
 */
export function buildSolitaireOpponentEffectCommand(
  state: GameState,
  opponentPlayerId: string,
  now: number
): ConfirmEffectStepCommand | null {
  if (
    state.pendingChoice ||
    state.pendingCostPayment ||
    state.pendingSpecialMemberPlay
  ) {
    return null;
  }

  const effect = state.activeEffect;
  if (!effect || effect.awaitingPlayerId !== opponentPlayerId) {
    return null;
  }

  if (effect.publicCardSelectionAutoAdvanceAt !== undefined) {
    if (now < effect.publicCardSelectionAutoAdvanceAt) {
      return null;
    }
    return {
      type: GameCommandType.CONFIRM_EFFECT_STEP,
      playerId: opponentPlayerId,
      effectId: effect.id,
      publicCardSelectionAutoAdvanceAt: effect.publicCardSelectionAutoAdvanceAt,
      timestamp: now,
    };
  }

  if (effect.publicEffectChoiceAutoAdvanceAt !== undefined) {
    if (now < effect.publicEffectChoiceAutoAdvanceAt) {
      return null;
    }
    return {
      type: GameCommandType.CONFIRM_EFFECT_STEP,
      playerId: opponentPlayerId,
      effectId: effect.id,
      publicEffectChoiceAutoAdvanceAt: effect.publicEffectChoiceAutoAdvanceAt,
      timestamp: now,
    };
  }

  if (
    effect.publicRevealAutoAdvanceAt !== undefined &&
    effect.publicRevealGeneration !== undefined
  ) {
    if (now < effect.publicRevealAutoAdvanceAt) {
      return null;
    }
    return {
      type: GameCommandType.CONFIRM_EFFECT_STEP,
      playerId: opponentPlayerId,
      effectId: effect.id,
      publicRevealAutoAdvanceAt: effect.publicRevealAutoAdvanceAt,
      publicRevealGeneration: effect.publicRevealGeneration,
      timestamp: now,
    };
  }

  if (
    effect.effectChoice ||
    effect.numericInput ||
    effect.stageFormation
  ) {
    return null;
  }

  if (effect.selectableCardMode === 'ORDERED_MULTI') {
    if (
      effect.selectableCardVisibility !== 'AWAITING_PLAYER_ONLY' ||
      effect.canSkipSelection === true
    ) {
      return null;
    }

    const candidateCardIds = effect.selectableCardIds ?? [];
    if (!areCardsInPlayerHand(state, opponentPlayerId, candidateCardIds)) {
      return null;
    }

    const minCount = effect.minSelectableCards;
    const maxCount = effect.maxSelectableCards;
    if (
      minCount === undefined ||
      maxCount === undefined ||
      !Number.isInteger(minCount) ||
      !Number.isInteger(maxCount) ||
      minCount < 0 ||
      maxCount < minCount
    ) {
      return null;
    }

    const selectedCount = Math.min(maxCount, candidateCardIds.length);
    if (selectedCount < minCount) {
      return null;
    }

    const version =
      typeof effect.metadata?.blindSelectionVersion === 'number'
        ? effect.metadata.blindSelectionVersion
        : undefined;
    return createEffectCommand(opponentPlayerId, effect.id, now, {
      selectedCardIds: Array.from({ length: selectedCount }, (_, index) =>
        createBlindCardSelectionToken(index, version)
      ),
    });
  }

  if (effect.canSkipSelection === true) {
    return createEffectCommand(opponentPlayerId, effect.id, now, {
      selectedCardId: null,
    });
  }

  const hasCardSelection =
    effect.selectableCardMode !== undefined ||
    (effect.selectableCardIds?.length ?? 0) > 0;
  const hasOptionSelection = (effect.selectableOptions?.length ?? 0) > 0;
  const hasSlotSelection = (effect.selectableSlots?.length ?? 0) > 0;
  const inputSurfaceCount = [
    hasCardSelection,
    hasOptionSelection,
    hasSlotSelection,
  ].filter(Boolean).length;

  if (inputSurfaceCount > 1) {
    return null;
  }

  if (hasCardSelection) {
    if (
      effect.selectableCardMode !== undefined &&
      effect.selectableCardMode !== 'SINGLE'
    ) {
      return null;
    }
    const candidateCardIds = effect.selectableCardIds ?? [];
    if (!candidateCardIds[0]) {
      return null;
    }

    if (
      effect.selectableCardVisibility === 'AWAITING_PLAYER_ONLY' &&
      !areCardsInPlayerHand(state, opponentPlayerId, candidateCardIds)
    ) {
      return null;
    }

    const selectedCardId =
      effect.selectableCardVisibility === 'AWAITING_PLAYER_BLIND' ||
      effect.selectableCardVisibility === 'AWAITING_PLAYER_ONLY'
        ? createBlindCardSelectionToken(
            0,
            typeof effect.metadata?.blindSelectionVersion === 'number'
              ? effect.metadata.blindSelectionVersion
              : undefined
          )
        : candidateCardIds[0];
    return createEffectCommand(opponentPlayerId, effect.id, now, {
      selectedCardId,
    });
  }

  if (hasOptionSelection) {
    const selectedOptionId = effect.selectableOptions?.[0]?.id;
    return selectedOptionId
      ? createEffectCommand(opponentPlayerId, effect.id, now, {
          selectedOptionId,
        })
      : null;
  }

  if (hasSlotSelection) {
    const selectedSlot = effect.selectableSlots?.[0];
    return selectedSlot
      ? createEffectCommand(opponentPlayerId, effect.id, now, {
          selectedSlot,
        })
      : null;
  }

  return createEffectCommand(opponentPlayerId, effect.id, now);
}

/**
 * Resolves system-only positional tokens immediately before authoritative
 * validation and execution. The recorded automation command remains tokenized,
 * so hidden opponent hand IDs never enter the command log.
 */
export function resolveSolitaireOpponentEffectCommandForExecution(
  state: GameState,
  command: GameCommand
): GameCommand {
  const effect = state.activeEffect;
  if (
    command.type !== GameCommandType.CONFIRM_EFFECT_STEP ||
    !effect ||
    effect.id !== command.effectId ||
    effect.awaitingPlayerId !== command.playerId ||
    effect.selectableCardVisibility !== 'AWAITING_PLAYER_ONLY'
  ) {
    return command;
  }

  const candidateCardIds = effect.selectableCardIds ?? [];
  if (!areCardsInPlayerHand(state, command.playerId, candidateCardIds)) {
    return command;
  }

  const version =
    typeof effect.metadata?.blindSelectionVersion === 'number'
      ? effect.metadata.blindSelectionVersion
      : undefined;

  if (
    command.selectedCardId !== undefined &&
    command.selectedCardId !== null &&
    effect.selectableCardMode !== 'ORDERED_MULTI'
  ) {
    const resolvedCardId = resolveBlindCardSelectionToken(
      candidateCardIds,
      command.selectedCardId,
      version
    );
    return resolvedCardId === null
      ? command
      : {
          ...command,
          selectedCardId: resolvedCardId,
        };
  }

  if (
    command.selectedCardIds === undefined ||
    effect.selectableCardMode !== 'ORDERED_MULTI'
  ) {
    return command;
  }

  const resolvedCardIds = command.selectedCardIds.map((token) =>
    resolveBlindCardSelectionToken(candidateCardIds, token, version)
  );
  if (
    resolvedCardIds.some((cardId) => cardId === null) ||
    new Set(resolvedCardIds).size !== resolvedCardIds.length
  ) {
    return command;
  }

  return {
    ...command,
    selectedCardIds: resolvedCardIds as readonly string[],
  };
}

function areCardsInPlayerHand(
  state: GameState,
  playerId: string,
  cardIds: readonly string[]
): boolean {
  const player = state.players.find((candidate) => candidate.id === playerId);
  return (
    player !== undefined &&
    cardIds.every((cardId) => player.hand.cardIds.includes(cardId))
  );
}

function createEffectCommand(
  playerId: string,
  effectId: string,
  timestamp: number,
  selection: Pick<
    ConfirmEffectStepCommand,
    'selectedCardId' | 'selectedCardIds' | 'selectedOptionId' | 'selectedSlot'
  > = {}
): ConfirmEffectStepCommand {
  return {
    type: GameCommandType.CONFIRM_EFFECT_STEP,
    playerId,
    effectId,
    ...selection,
    timestamp,
  };
}
