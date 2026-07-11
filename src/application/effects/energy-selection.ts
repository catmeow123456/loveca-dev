import type { GameState } from '../../domain/entities/game.js';
import { getPlayerById } from '../../domain/entities/game.js';
import { OrientationState } from '../../shared/types/enums.js';

export type EnergySelectionOperation =
  'TAP_ACTIVE_ENERGY' | 'RETURN_TO_ENERGY_DECK' | 'ACTIVATE_WAITING_ENERGY' | 'STACK_BELOW_MEMBER';

export interface EnergySelectionResolution {
  readonly playerId: string;
  readonly operation: EnergySelectionOperation;
  readonly requiredCount: number;
  readonly selectedEnergyCardIds: readonly string[];
}

let currentEnergySelectionResolutions: readonly EnergySelectionResolution[] = [];
let currentEnergySelectionResolutionIndex = 0;

export function withEnergySelectionResolution<T>(
  resolution: EnergySelectionResolution,
  callback: () => T
): T {
  return withEnergySelectionResolutions([resolution], callback);
}

export function withEnergySelectionResolutions<T>(
  resolutions: readonly EnergySelectionResolution[],
  callback: () => T
): T {
  const previousResolutions = currentEnergySelectionResolutions;
  const previousIndex = currentEnergySelectionResolutionIndex;
  currentEnergySelectionResolutions = resolutions;
  currentEnergySelectionResolutionIndex = 0;
  try {
    return callback();
  } finally {
    currentEnergySelectionResolutions = previousResolutions;
    currentEnergySelectionResolutionIndex = previousIndex;
  }
}

export interface ResolveEnergySelectionResult {
  readonly gameState: GameState;
  readonly selectedEnergyCardIds: readonly string[];
}

export class EnergySelectionRequiredError extends Error {
  constructor(
    readonly playerId: string,
    readonly operation: EnergySelectionOperation,
    readonly requiredCount: number,
    readonly candidateEnergyCardIds: readonly string[],
    readonly priorResolutions: readonly EnergySelectionResolution[]
  ) {
    super(`Energy selection required for ${operation}`);
    this.name = 'EnergySelectionRequiredError';
  }
}

export function getEnergySelectionCandidates(
  game: GameState,
  playerId: string,
  operation: EnergySelectionOperation
): readonly string[] {
  const player = getPlayerById(game, playerId);
  if (!player) return [];
  if (operation === 'TAP_ACTIVE_ENERGY') {
    return player.energyZone.cardIds.filter(
      (id) => player.energyZone.cardStates.get(id)?.orientation !== OrientationState.WAITING
    );
  }
  if (operation === 'ACTIVATE_WAITING_ENERGY') {
    return player.energyZone.cardIds.filter(
      (id) => player.energyZone.cardStates.get(id)?.orientation === OrientationState.WAITING
    );
  }
  if (operation === 'STACK_BELOW_MEMBER') {
    const waiting = player.energyZone.cardIds.filter(
      (id) => player.energyZone.cardStates.get(id)?.orientation === OrientationState.WAITING
    );
    const active = player.energyZone.cardIds.filter(
      (id) => player.energyZone.cardStates.get(id)?.orientation !== OrientationState.WAITING
    );
    return [...waiting, ...active];
  }
  return player.energyZone.cardIds;
}

export function shouldSelectEnergyForOperation(
  game: GameState,
  playerId: string,
  operation: EnergySelectionOperation,
  requiredCount: number
): boolean {
  return shouldSelectEnergyCards(
    game,
    getEnergySelectionCandidates(game, playerId, operation),
    requiredCount
  );
}

export function shouldSelectEnergyCards(
  game: GameState,
  candidateEnergyCardIds: readonly string[],
  requiredCount: number
): boolean {
  if (candidateEnergyCardIds.length <= requiredCount || requiredCount <= 0) return false;
  const marked = new Set((game.energyActivePhaseSkips ?? []).map((skip) => skip.energyCardId));
  return candidateEnergyCardIds.some((cardId) => marked.has(cardId));
}

export function resolveEnergySelectionForOperation(
  game: GameState,
  playerId: string,
  operation: EnergySelectionOperation,
  requiredCount: number
): ResolveEnergySelectionResult | null {
  if (!Number.isInteger(requiredCount) || requiredCount < 0) return null;
  const candidateEnergyCardIds = getEnergySelectionCandidates(game, playerId, operation);
  if (candidateEnergyCardIds.length < requiredCount) return null;
  if (requiredCount === 0) {
    return { gameState: game, selectedEnergyCardIds: [] };
  }

  const resolution = currentEnergySelectionResolutions[currentEnergySelectionResolutionIndex];
  if (
    resolution &&
    resolution.playerId === playerId &&
    resolution.operation === operation &&
    resolution.requiredCount === requiredCount
  ) {
    currentEnergySelectionResolutionIndex += 1;
    const selectedEnergyCardIds = resolution.selectedEnergyCardIds;
    if (
      selectedEnergyCardIds.length !== requiredCount ||
      new Set(selectedEnergyCardIds).size !== selectedEnergyCardIds.length ||
      selectedEnergyCardIds.some((cardId) => !candidateEnergyCardIds.includes(cardId))
    ) {
      return null;
    }
    return {
      gameState: game,
      selectedEnergyCardIds,
    };
  }

  if (shouldSelectEnergyCards(game, candidateEnergyCardIds, requiredCount)) {
    throw new EnergySelectionRequiredError(
      playerId,
      operation,
      requiredCount,
      candidateEnergyCardIds,
      currentEnergySelectionResolutions.slice(0, currentEnergySelectionResolutionIndex)
    );
  }

  return {
    gameState: game,
    selectedEnergyCardIds: candidateEnergyCardIds.slice(0, requiredCount),
  };
}
