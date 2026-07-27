import {
  addAction,
  getCardById,
  getPlayerById,
  type ActiveEffectState,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { CardType, OrientationState } from '../../../../shared/types/enums.js';
import { and, hasBladeHeart, not, typeIs } from '../../../effects/card-selectors.js';
import { setEnergyOrientation } from '../../../effects/energy.js';
import {
  getEnergySelectionCandidates,
  shouldSelectEnergyForOperation,
} from '../../../effects/energy-selection.js';
import { N_BP7_008_ON_ENTER_BOTTOM_UP_TO_FOUR_NO_BLADE_HEART_MEMBERS_ACTIVATE_ENERGY_ABILITY_ID } from '../../ability-ids.js';
import { startPendingActiveEffect } from '../../runtime/active-effect.js';
import { activateWaitingEnergyCardsForPlayer } from '../../runtime/actions.js';
import { wasRestoredAfterPublicCardSelectionConfirmation } from '../../runtime/public-card-selection-confirmation.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { moveWaitingRoomCardsToDeckBottomAndEnqueueTriggers } from '../../runtime/waiting-room-main-deck-triggers.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';

const ABILITY_ID =
  N_BP7_008_ON_ENTER_BOTTOM_UP_TO_FOUR_NO_BLADE_HEART_MEMBERS_ACTIVATE_ENERGY_ABILITY_ID;
const SELECT_BOTTOM_STEP_ID = 'N_BP7_008_SELECT_MEMBERS_TO_DECK_BOTTOM';
const SELECT_ENERGY_STEP_ID = 'N_BP7_008_SELECT_ENERGY_TO_ACTIVATE';
const MAX_BOTTOM_COUNT = 4;

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

const waitingRoomMemberWithoutBladeHeart = and(typeIs(CardType.MEMBER), not(hasBladeHeart()));

export function registerNBp7008EmmaVerdeWorkflowHandlers(): void {
  registerPendingAbilityStarterHandler(ABILITY_ID, (game, ability, options, context) =>
    startBottomSelection(
      game,
      ability,
      options.orderedResolution === true,
      context.continuePendingCardEffects
    )
  );
  registerActiveEffectStepHandler(ABILITY_ID, SELECT_BOTTOM_STEP_ID, (game, input, context) =>
    finishBottomSelection(
      game,
      input.selectedCardIds ?? (input.selectedCardId ? [input.selectedCardId] : []),
      context.continuePendingCardEffects
    )
  );
  registerActiveEffectStepHandler(ABILITY_ID, SELECT_ENERGY_STEP_ID, (game, input, context) =>
    finishEnergySelection(
      game,
      input.selectedCardIds ?? (input.selectedCardId ? [input.selectedCardId] : []),
      context.continuePendingCardEffects
    )
  );
}

function startBottomSelection(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) return game;
  const candidateCardIds = getCurrentWaitingRoomCandidates(game, player.id);
  if (candidateCardIds.length === 0) {
    return finishPending(game, ability, orderedResolution, continuePendingCardEffects, {
      step: 'NO_MEMBER_WITHOUT_BLADE_HEART',
      selectedCardIds: [],
      movedCardIds: [],
      activatedEnergyCardIds: [],
    });
  }

  const maxSelectableCards = Math.min(MAX_BOTTOM_COUNT, candidateCardIds.length);
  return startPendingActiveEffect(game, {
    ability,
    playerId: player.id,
    activeEffect: {
      id: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      controllerId: player.id,
      effectText: getAbilityEffectText(ability.abilityId),
      stepId: SELECT_BOTTOM_STEP_ID,
      stepText: '可以按放置顺序选择自己休息室中至多4张不持有BLADE HEART的成员卡放置于卡组底。',
      awaitingPlayerId: player.id,
      selectableCardIds: candidateCardIds,
      selectableCardVisibility: 'PUBLIC',
      selectableCardMode: 'ORDERED_MULTI',
      minSelectableCards: 0,
      maxSelectableCards,
      selectionLabel: '按放置顺序选择卡片',
      confirmSelectionLabel: '按此顺序放置于卡组底',
      canSkipSelection: true,
      skipSelectionLabel: '不放置',
      metadata: {
        publicCardSelectionConfirmation: {
          source: 'WAITING_ROOM',
          destination: 'MAIN_DECK_BOTTOM',
          ordered: true,
          sourcePlayerId: player.id,
        },
        orderedResolution,
        candidateCardIds,
        maxSelectableCards,
      },
    },
    actionPayload: {
      step: 'START_SELECT_MEMBERS_TO_DECK_BOTTOM',
      candidateCardIds,
      maxSelectableCards,
    },
  });
}

function finishBottomSelection(
  game: GameState,
  selectedCardIds: readonly string[],
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (!effect || effect.abilityId !== ABILITY_ID || effect.stepId !== SELECT_BOTTOM_STEP_ID) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  if (!player) return game;
  const originalCandidateCardIds = getStringArray(effect.metadata?.candidateCardIds);
  const maxSelectableCards = Math.min(
    MAX_BOTTOM_COUNT,
    getNonNegativeInteger(effect.metadata?.maxSelectableCards)
  );
  if (
    new Set(selectedCardIds).size !== selectedCardIds.length ||
    selectedCardIds.length > maxSelectableCards ||
    selectedCardIds.some((cardId) => !originalCandidateCardIds.includes(cardId))
  ) {
    return game;
  }
  if (selectedCardIds.length === 0) {
    return finishEffect(game, effect, continuePendingCardEffects, {
      step: 'DECLINE_BOTTOM_MEMBERS',
      selectedCardIds: [],
      movedCardIds: [],
      activatedEnergyCardIds: [],
    });
  }

  const currentCandidateSet = new Set(getCurrentWaitingRoomCandidates(game, player.id));
  if (selectedCardIds.some((cardId) => !currentCandidateSet.has(cardId))) {
    return wasRestoredAfterPublicCardSelectionConfirmation(effect)
      ? finishEffect(game, effect, continuePendingCardEffects, {
          step: 'STALE_BOTTOM_SELECTION',
          selectedCardIds,
          movedCardIds: [],
          activatedEnergyCardIds: [],
        })
      : game;
  }

  const movement = moveWaitingRoomCardsToDeckBottomAndEnqueueTriggers(
    game,
    player.id,
    selectedCardIds,
    {
      candidateCardIds: originalCandidateCardIds,
      minCount: 0,
      maxCount: maxSelectableCards,
      cause: {
        kind: 'CARD_EFFECT',
        playerId: player.id,
        sourceCardId: effect.sourceCardId,
        abilityId: effect.abilityId,
        pendingAbilityId: effect.id,
      },
    }
  );
  if (!movement) {
    return wasRestoredAfterPublicCardSelectionConfirmation(effect)
      ? finishEffect(game, effect, continuePendingCardEffects, {
          step: 'STALE_BOTTOM_SELECTION',
          selectedCardIds,
          movedCardIds: [],
          activatedEnergyCardIds: [],
        })
      : game;
  }

  return resolveEnergyActivationAfterMove(
    movement.gameState,
    effect,
    movement.movedCardIds,
    continuePendingCardEffects
  );
}

function resolveEnergyActivationAfterMove(
  game: GameState,
  effect: ActiveEffectState,
  movedCardIds: readonly string[],
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const waitingEnergyCardIds = getEnergySelectionCandidates(
    game,
    effect.controllerId,
    'ACTIVATE_WAITING_ENERGY'
  );
  const activationCount = Math.min(movedCardIds.length, waitingEnergyCardIds.length);
  if (
    shouldSelectEnergyForOperation(
      game,
      effect.controllerId,
      'ACTIVATE_WAITING_ENERGY',
      activationCount
    )
  ) {
    return createEnergySelectionWindow(
      game,
      effect,
      movedCardIds,
      waitingEnergyCardIds,
      activationCount
    );
  }

  const activation = activateWaitingEnergyCardsForPlayer(
    game,
    effect.controllerId,
    activationCount
  );
  if (!activation) {
    return finishEffect(game, effect, continuePendingCardEffects, {
      step: 'BOTTOM_MEMBERS_ENERGY_NO_OP',
      selectedCardIds: movedCardIds,
      movedCardIds,
      activatedEnergyCardIds: [],
    });
  }
  return finishEffect(activation.gameState, effect, continuePendingCardEffects, {
    step: 'BOTTOM_MEMBERS_ACTIVATE_ENERGY',
    selectedCardIds: movedCardIds,
    movedCardIds,
    activatedEnergyCardIds: activation.activatedEnergyCardIds,
  });
}

function createEnergySelectionWindow(
  game: GameState,
  previousEffect: ActiveEffectState,
  movedCardIds: readonly string[],
  waitingEnergyCardIds: readonly string[],
  activationCount: number
): GameState {
  return {
    ...game,
    activeEffect: {
      id: previousEffect.id,
      abilityId: previousEffect.abilityId,
      sourceCardId: previousEffect.sourceCardId,
      sourceCardDisplayCode: previousEffect.sourceCardDisplayCode,
      sourceLifecycleId: previousEffect.sourceLifecycleId,
      controllerId: previousEffect.controllerId,
      effectText: previousEffect.effectText,
      stepId: SELECT_ENERGY_STEP_ID,
      stepText: '请选择要变为活跃状态的待机能量。',
      awaitingPlayerId: previousEffect.controllerId,
      selectableCardIds: waitingEnergyCardIds,
      selectableCardVisibility: 'PUBLIC',
      selectableCardMode: activationCount > 1 ? 'ORDERED_MULTI' : 'SINGLE',
      minSelectableCards: activationCount,
      maxSelectableCards: activationCount,
      selectionLabel: '选择要变为活跃状态的能量',
      confirmSelectionLabel: '变为活跃状态',
      canSkipSelection: false,
      metadata: {
        orderedResolution: previousEffect.metadata?.orderedResolution === true,
        movedCardIds,
        activationCount,
      },
    },
  };
}

function finishEnergySelection(
  game: GameState,
  selectedEnergyCardIds: readonly string[],
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (!effect || effect.abilityId !== ABILITY_ID || effect.stepId !== SELECT_ENERGY_STEP_ID) {
    return game;
  }
  const movedCardIds = getStringArray(effect.metadata?.movedCardIds);
  const originalActivationCount = getNonNegativeInteger(effect.metadata?.activationCount);
  if (
    selectedEnergyCardIds.length !== originalActivationCount ||
    new Set(selectedEnergyCardIds).size !== selectedEnergyCardIds.length ||
    selectedEnergyCardIds.some((cardId) => effect.selectableCardIds?.includes(cardId) !== true)
  ) {
    return game;
  }

  const waitingEnergyCardIds = getEnergySelectionCandidates(
    game,
    effect.controllerId,
    'ACTIVATE_WAITING_ENERGY'
  );
  const currentActivationCount = Math.min(movedCardIds.length, waitingEnergyCardIds.length);
  if (currentActivationCount === 0) {
    return finishEffect(game, effect, continuePendingCardEffects, {
      step: 'ENERGY_BECAME_UNAVAILABLE_AFTER_MOVE',
      selectedCardIds: movedCardIds,
      movedCardIds,
      activatedEnergyCardIds: [],
    });
  }

  const stillRequiresSelection = shouldSelectEnergyForOperation(
    game,
    effect.controllerId,
    'ACTIVATE_WAITING_ENERGY',
    currentActivationCount
  );
  if (stillRequiresSelection) {
    if (
      currentActivationCount !== selectedEnergyCardIds.length ||
      selectedEnergyCardIds.some((cardId) => !waitingEnergyCardIds.includes(cardId))
    ) {
      return createEnergySelectionWindow(
        game,
        effect,
        movedCardIds,
        waitingEnergyCardIds,
        currentActivationCount
      );
    }
    const orientation = setEnergyOrientation(
      game,
      effect.controllerId,
      selectedEnergyCardIds,
      OrientationState.ACTIVE
    );
    if (!orientation || orientation.updatedEnergyCardIds.length !== currentActivationCount) {
      return createEnergySelectionWindow(
        game,
        effect,
        movedCardIds,
        waitingEnergyCardIds,
        currentActivationCount
      );
    }
    return finishEffect(orientation.gameState, effect, continuePendingCardEffects, {
      step: 'BOTTOM_MEMBERS_ACTIVATE_SELECTED_ENERGY',
      selectedCardIds: movedCardIds,
      movedCardIds,
      activatedEnergyCardIds: orientation.updatedEnergyCardIds,
    });
  }

  const activation = activateWaitingEnergyCardsForPlayer(
    game,
    effect.controllerId,
    currentActivationCount
  );
  return finishEffect(activation?.gameState ?? game, effect, continuePendingCardEffects, {
    step: activation
      ? 'BOTTOM_MEMBERS_ACTIVATE_CURRENT_ENERGY'
      : 'ENERGY_BECAME_UNAVAILABLE_AFTER_MOVE',
    selectedCardIds: movedCardIds,
    movedCardIds,
    activatedEnergyCardIds: activation?.activatedEnergyCardIds ?? [],
  });
}

function getCurrentWaitingRoomCandidates(game: GameState, playerId: string): readonly string[] {
  const player = getPlayerById(game, playerId);
  if (!player) return [];
  return player.waitingRoom.cardIds.filter((cardId) => {
    const card = getCardById(game, cardId);
    return card !== null && card.ownerId === player.id && waitingRoomMemberWithoutBladeHeart(card);
  });
}

function finishPending(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects,
  payload: Readonly<Record<string, unknown>>
): GameState {
  return continuePendingCardEffects(
    addAction(
      {
        ...game,
        pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
      },
      'RESOLVE_ABILITY',
      ability.controllerId,
      {
        pendingAbilityId: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        ...payload,
      }
    ),
    orderedResolution
  );
}

function finishEffect(
  game: GameState,
  effect: ActiveEffectState,
  continuePendingCardEffects: ContinuePendingCardEffects,
  payload: Readonly<Record<string, unknown>>
): GameState {
  return continuePendingCardEffects(
    addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', effect.controllerId, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      ...payload,
    }),
    effect.metadata?.orderedResolution === true
  );
}

function getStringArray(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value.filter((candidate): candidate is string => typeof candidate === 'string')
    : [];
}

function getNonNegativeInteger(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : 0;
}
