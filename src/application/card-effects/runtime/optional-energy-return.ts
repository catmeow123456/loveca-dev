import {
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../domain/entities/game.js';
import {
  getEnergySelectionCandidates,
  resolveEnergySelectionForOperation,
  shouldSelectEnergyForOperation,
} from '../../effects/energy-selection.js';
import {
  resolveEnergyReturnByCardEffect,
  type EnqueueTriggeredCardEffectsForEnergyReturn,
} from './energy-return.js';

export interface OptionalEnergyReturnWindowConfig {
  readonly ability: Pick<PendingAbilityState, 'id' | 'abilityId' | 'sourceCardId' | 'controllerId'>;
  readonly requiredCount: number;
  readonly effectText: string;
  readonly stepId: string;
  readonly stepText: string;
  readonly orderedResolution: boolean;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ResolveOptionalEnergyReturnConfig {
  readonly selectedCardIds: readonly string[];
  readonly selectedOptionId: string | null;
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnergyReturn;
}

export interface OptionalEnergyReturnResult {
  readonly gameState: GameState;
  readonly movedEnergyCardIds: readonly string[];
  readonly declined: boolean;
}

export function createOptionalEnergyReturnWindow(
  game: GameState,
  config: OptionalEnergyReturnWindowConfig
): GameState | null {
  const player = getPlayerById(game, config.ability.controllerId);
  if (!player || player.energyZone.cardIds.length < config.requiredCount) return null;
  const candidateEnergyCardIds = getEnergySelectionCandidates(
    game,
    player.id,
    'RETURN_TO_ENERGY_DECK'
  );
  const requiresSelection = shouldSelectEnergyForOperation(
    game,
    player.id,
    'RETURN_TO_ENERGY_DECK',
    config.requiredCount
  );
  const autoSelection = requiresSelection
    ? null
    : resolveEnergySelectionForOperation(
        game,
        player.id,
        'RETURN_TO_ENERGY_DECK',
        config.requiredCount
      );
  if (!requiresSelection && !autoSelection) return null;
  const autoEnergyCardIds = autoSelection?.selectedEnergyCardIds ?? [];
  return {
    ...game,
    activeEffect: {
      id: config.ability.id,
      abilityId: config.ability.abilityId,
      sourceCardId: config.ability.sourceCardId,
      controllerId: config.ability.controllerId,
      effectText: config.effectText,
      stepId: config.stepId,
      stepText: config.stepText,
      awaitingPlayerId: player.id,
      ...(requiresSelection
        ? {
            selectableCardIds: candidateEnergyCardIds,
            ...(config.requiredCount > 1 ? { selectableCardMode: 'ORDERED_MULTI' as const } : {}),
            selectionLabel: '选择要放回能量卡组的能量',
            minSelectableCards: config.requiredCount,
            maxSelectableCards: config.requiredCount,
            confirmSelectionLabel: '支付费用',
          }
        : {
            selectableOptions: [{ id: 'activate', label: '发动' }],
            confirmSelectionLabel: '发动',
          }),
      canSkipSelection: true,
      skipSelectionLabel: '不发动',
      metadata: {
        ...config.metadata,
        orderedResolution: config.orderedResolution,
        requiredEnergyReturnCount: config.requiredCount,
        autoEnergyCardIds,
        requiresEnergySelection: requiresSelection,
      },
    },
  };
}

export function resolveOptionalEnergyReturn(
  game: GameState,
  config: ResolveOptionalEnergyReturnConfig
): OptionalEnergyReturnResult | null {
  const effect = game.activeEffect;
  if (!effect) return null;
  const requiredCount = effect.metadata?.requiredEnergyReturnCount;
  if (typeof requiredCount !== 'number' || requiredCount <= 0) return null;
  const player = getPlayerById(game, effect.controllerId);
  if (!player) return null;
  const requiresSelection = effect.metadata?.requiresEnergySelection === true;
  const selectedEnergyCardIds = requiresSelection
    ? config.selectedCardIds
    : config.selectedOptionId === 'activate' && Array.isArray(effect.metadata?.autoEnergyCardIds)
      ? effect.metadata.autoEnergyCardIds.filter((id): id is string => typeof id === 'string')
      : [];
  if (selectedEnergyCardIds.length === 0) {
    return { gameState: game, movedEnergyCardIds: [], declined: true };
  }
  if (
    selectedEnergyCardIds.length !== requiredCount ||
    new Set(selectedEnergyCardIds).size !== selectedEnergyCardIds.length ||
    selectedEnergyCardIds.some(
      (cardId) =>
        effect.selectableCardIds?.includes(cardId) === false ||
        !player.energyZone.cardIds.includes(cardId)
    )
  )
    return null;
  const movement = resolveEnergyReturnByCardEffect(game, {
    playerId: player.id,
    selectedEnergyCardIds,
    cause: {
      kind: 'CARD_EFFECT',
      playerId: player.id,
      sourceCardId: effect.sourceCardId,
      abilityId: effect.abilityId,
      pendingAbilityId: effect.id,
    },
    exactCount: requiredCount,
    enqueueTriggeredCardEffects: config.enqueueTriggeredCardEffects,
  });
  if (!movement) return null;
  return {
    gameState: movement.gameState,
    movedEnergyCardIds: movement.movedEnergyCardIds,
    declined: false,
  };
}
