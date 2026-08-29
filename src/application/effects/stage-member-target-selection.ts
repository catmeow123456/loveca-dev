import {
  getPlayerById,
  type ActiveEffectState,
  type GameState,
  type PendingAbilityState,
} from '../../domain/entities/game.js';
import type { MemberStateChangeCause } from '../../domain/events/game-events.js';
import { isMemberWaitProtectedFromChange } from '../../domain/rules/member-wait-protections.js';
import { OrientationState } from '../../shared/types/enums.js';
import type { CardSelector } from './card-selectors.js';
import { setMemberOrientation, type SetMemberOrientationResult } from './member-state.js';
import { getStageMemberCardIdsMatching, type StageMemberStatePredicate } from './stage-targets.js';

export interface StageMemberOrientationTargetSelectionConfig {
  readonly ability: PendingAbilityState;
  readonly effectText: string;
  readonly stepId: string;
  readonly stepText: string;
  readonly awaitingPlayerId: string;
  readonly targetPlayerId: string;
  readonly selector: CardSelector;
  readonly statePredicate?: StageMemberStatePredicate;
  readonly targetOrientation: OrientationState;
  readonly selectionLabel: string;
  readonly confirmSelectionLabel?: string;
  readonly orderedResolution: boolean;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface StageMemberOrientationTargetSelectionStart {
  readonly selectableCardIds: readonly string[];
  readonly activeEffect: ActiveEffectState | null;
}

export function createStageMemberOrientationTargetSelection(
  game: GameState,
  config: StageMemberOrientationTargetSelectionConfig
): StageMemberOrientationTargetSelectionStart {
  const targetPlayer = getPlayerById(game, config.targetPlayerId);
  const cause = createMemberStateChangeCauseFromSelectionConfig(config);
  const selectableCardIds = getStageMemberCardIdsMatching(
    game,
    config.targetPlayerId,
    config.selector,
    config.statePredicate
  ).filter(
    (cardId) =>
      targetPlayer?.memberSlots.cardStates.get(cardId)?.orientation !== config.targetOrientation &&
      !(
        config.targetOrientation === OrientationState.WAITING &&
        isMemberWaitProtectedFromChange(game, config.targetPlayerId, cardId, cause)
      )
  );

  if (selectableCardIds.length === 0) {
    return {
      selectableCardIds,
      activeEffect: null,
    };
  }

  return {
    selectableCardIds,
    activeEffect: {
      id: config.ability.id,
      abilityId: config.ability.abilityId,
      sourceCardId: config.ability.sourceCardId,
      controllerId: config.ability.controllerId,
      effectText: config.effectText,
      stepId: config.stepId,
      stepText: config.stepText,
      awaitingPlayerId: config.awaitingPlayerId,
      selectableCardIds,
      selectionLabel: config.selectionLabel,
      confirmSelectionLabel: config.confirmSelectionLabel,
      metadata: {
        ...config.metadata,
        stageMemberOrientationTarget: true,
        orderedResolution: config.orderedResolution,
        targetPlayerId: config.targetPlayerId,
        targetOrientation: config.targetOrientation,
      },
    },
  };
}

export function resolveStageMemberOrientationTargetSelection(
  game: GameState,
  effect: ActiveEffectState,
  selectedCardId: string | null
): SetMemberOrientationResult | null {
  if (
    effect.metadata?.stageMemberOrientationTarget !== true ||
    !selectedCardId ||
    effect.selectableCardIds?.includes(selectedCardId) !== true
  ) {
    return null;
  }

  const targetPlayerId =
    typeof effect.metadata.targetPlayerId === 'string' ? effect.metadata.targetPlayerId : null;
  const targetOrientation = getTargetOrientation(effect.metadata.targetOrientation);
  if (!targetPlayerId || !targetOrientation) {
    return null;
  }

  return setMemberOrientation(game, targetPlayerId, selectedCardId, targetOrientation, {
    kind: 'CARD_EFFECT',
    playerId: effect.controllerId,
    selectionPlayerId: effect.awaitingPlayerId ?? undefined,
    sourceCardId: effect.sourceCardId,
    abilityId: effect.abilityId,
    pendingAbilityId: effect.id,
  });
}

function createMemberStateChangeCauseFromSelectionConfig(
  config: StageMemberOrientationTargetSelectionConfig
): MemberStateChangeCause {
  return {
    kind: 'CARD_EFFECT',
    playerId: config.ability.controllerId,
    selectionPlayerId: config.awaitingPlayerId,
    sourceCardId: config.ability.sourceCardId,
    abilityId: config.ability.abilityId,
    pendingAbilityId: config.ability.id,
  };
}

export function getStageMemberOrientationTargetMetadata(
  effect: ActiveEffectState
): { readonly targetPlayerId: string; readonly targetOrientation: OrientationState } | null {
  const targetPlayerId =
    typeof effect.metadata?.targetPlayerId === 'string' ? effect.metadata.targetPlayerId : null;
  const targetOrientation = getTargetOrientation(effect.metadata?.targetOrientation);
  if (!targetPlayerId || !targetOrientation) {
    return null;
  }

  return {
    targetPlayerId,
    targetOrientation,
  };
}

function getTargetOrientation(value: unknown): OrientationState | null {
  return typeof value === 'string' ? (value as OrientationState) : null;
}
