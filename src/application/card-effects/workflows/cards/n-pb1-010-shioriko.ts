import {
  addAction,
  getCardById,
  getPlayerById,
  type ActiveEffectState,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { CardType, ZoneType } from '../../../../shared/types/enums.js';
import { and, groupAliasIs, typeIs } from '../../../effects/card-selectors.js';
import { getEnergySelectionCandidates } from '../../../effects/energy-selection.js';
import { PL_N_PB1_010_ON_ENTER_CHOOSE_ACTIVATE_ONE_ENERGY_OR_STACK_NIJIGASAKI_LIVE_TO_DECK_TOP_ABILITY_ID } from '../../ability-ids.js';
import {
  activateWaitingEnergyCardsForPlayer,
  moveWaitingRoomCardsToDeckTopForPlayer,
} from '../../runtime/actions.js';
import { startPendingActiveEffect } from '../../runtime/active-effect.js';
import { wasRestoredAfterPublicCardSelectionConfirmation } from '../../runtime/public-card-selection-confirmation.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';

export const N_PB1_010_SELECT_OPTION_STEP_ID = 'N_PB1_010_SELECT_OPTION';
export const N_PB1_010_SELECT_NIJIGASAKI_LIVE_STEP_ID =
  'N_PB1_010_SELECT_NIJIGASAKI_LIVE_TO_DECK_TOP';
export const N_PB1_010_ACTIVATE_ONE_ENERGY_OPTION_ID = 'activate-one-energy';
export const N_PB1_010_STACK_NIJIGASAKI_LIVE_OPTION_ID = 'stack-nijigasaki-live-to-deck-top';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

const nijigasakiLiveSelector = and(typeIs(CardType.LIVE), groupAliasIs('虹ヶ咲'));

export function registerNPb1010ShiorikoWorkflowHandlers(): void {
  registerPendingAbilityStarterHandler(
    PL_N_PB1_010_ON_ENTER_CHOOSE_ACTIVATE_ONE_ENERGY_OR_STACK_NIJIGASAKI_LIVE_TO_DECK_TOP_ABILITY_ID,
    (game, ability, options) =>
      startShiorikoOnEnterChoice(game, ability, options.orderedResolution === true)
  );
  registerActiveEffectStepHandler(
    PL_N_PB1_010_ON_ENTER_CHOOSE_ACTIVATE_ONE_ENERGY_OR_STACK_NIJIGASAKI_LIVE_TO_DECK_TOP_ABILITY_ID,
    N_PB1_010_SELECT_OPTION_STEP_ID,
    (game, input, context) =>
      resolveShiorikoOption(
        game,
        input.selectedOptionId ?? null,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    PL_N_PB1_010_ON_ENTER_CHOOSE_ACTIVATE_ONE_ENERGY_OR_STACK_NIJIGASAKI_LIVE_TO_DECK_TOP_ABILITY_ID,
    N_PB1_010_SELECT_NIJIGASAKI_LIVE_STEP_ID,
    (game, input, context) =>
      resolveShiorikoStackSelection(
        game,
        input.selectedCardIds ?? [],
        context.continuePendingCardEffects
      )
  );
}

function startShiorikoOnEnterChoice(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) return game;

  return startPendingActiveEffect(game, {
    ability,
    playerId: player.id,
    activeEffect: {
      id: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      controllerId: ability.controllerId,
      effectText: getAbilityEffectText(ability.abilityId),
      stepId: N_PB1_010_SELECT_OPTION_STEP_ID,
      stepText: '请选择要执行的效果。',
      awaitingPlayerId: player.id,
      selectableOptions: [
        {
          id: N_PB1_010_ACTIVATE_ONE_ENERGY_OPTION_ID,
          label: '将1张能量变为活跃状态',
        },
        {
          id: N_PB1_010_STACK_NIJIGASAKI_LIVE_OPTION_ID,
          label: '将至多2张虹咲LIVE卡放置于卡组顶',
        },
      ],
      effectChoice: {
        mode: 'SINGLE',
        options: [
          {
            id: N_PB1_010_ACTIVATE_ONE_ENERGY_OPTION_ID,
            text: '将1张能量变为活跃状态。',
          },
          {
            id: N_PB1_010_STACK_NIJIGASAKI_LIVE_OPTION_ID,
            text: '从自己的休息室将至多2张『虹ヶ咲』LIVE卡按任意顺序放置于卡组顶。',
          },
        ],
        minSelections: 1,
        maxSelections: 1,
        publicConfirmation: true,
      },
      canSkipSelection: false,
      metadata: { orderedResolution },
    },
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      step: 'SELECT_OPTION',
      optionIds: [
        N_PB1_010_ACTIVATE_ONE_ENERGY_OPTION_ID,
        N_PB1_010_STACK_NIJIGASAKI_LIVE_OPTION_ID,
      ],
    },
  });
}

function resolveShiorikoOption(
  game: GameState,
  selectedOptionId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = getExpectedEffect(game, N_PB1_010_SELECT_OPTION_STEP_ID);
  if (!effect || !effect.selectableOptions?.some((option) => option.id === selectedOptionId)) {
    return game;
  }
  if (selectedOptionId === N_PB1_010_ACTIVATE_ONE_ENERGY_OPTION_ID) {
    return resolveActivateOneEnergy(game, effect, continuePendingCardEffects);
  }
  if (selectedOptionId !== N_PB1_010_STACK_NIJIGASAKI_LIVE_OPTION_ID) return game;

  const player = getPlayerById(game, effect.controllerId);
  if (!player) return game;
  const selectableCardIds = selectCurrentNijigasakiLiveCardIds(game, player.id);
  if (selectableCardIds.length === 0) {
    return finishAndContinue(
      game,
      effect,
      player.id,
      continuePendingCardEffects,
      'SKIP_STACK_NIJIGASAKI_LIVE',
      {
        selectedOptionId,
        candidateCardIds: [],
        selectedCardIds: [],
        movedCardIds: [],
      }
    );
  }

  const nextEffect = createNijigasakiLiveSelectionEffect(effect, player.id, selectableCardIds);
  return addAction({ ...game, activeEffect: nextEffect }, 'RESOLVE_ABILITY', player.id, {
    pendingAbilityId: effect.id,
    abilityId: effect.abilityId,
    sourceCardId: effect.sourceCardId,
    step: 'SELECT_NIJIGASAKI_LIVE_TO_DECK_TOP',
    selectedOptionId,
    candidateCardIds: selectableCardIds,
    maxSelectableCards: nextEffect.maxSelectableCards,
  });
}

function resolveActivateOneEnergy(
  game: GameState,
  effect: ActiveEffectState,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, effect.controllerId);
  if (!player) return game;
  const candidateEnergyCardIds = getEnergySelectionCandidates(
    game,
    player.id,
    'ACTIVATE_WAITING_ENERGY'
  );
  const activation = activateWaitingEnergyCardsForPlayer(
    game,
    player.id,
    Math.min(1, candidateEnergyCardIds.length)
  );
  if (!activation) return game;

  const step =
    activation.activatedEnergyCardIds.length === 0
      ? 'NO_OP_NO_WAITING_ENERGY'
      : 'ACTIVATE_ONE_ENERGY';
  return finishAndContinue(
    activation.gameState,
    effect,
    player.id,
    continuePendingCardEffects,
    step,
    {
      selectedOptionId: N_PB1_010_ACTIVATE_ONE_ENERGY_OPTION_ID,
      candidateEnergyCardIds,
      activatedEnergyCardIds: activation.activatedEnergyCardIds,
      previousOrientations: activation.previousOrientations,
      nextOrientation: activation.nextOrientation,
    }
  );
}

function resolveShiorikoStackSelection(
  game: GameState,
  selectedCardIds: readonly string[],
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = getExpectedEffect(game, N_PB1_010_SELECT_NIJIGASAKI_LIVE_STEP_ID);
  if (!effect) return game;
  const player = getPlayerById(game, effect.controllerId);
  if (!player) return game;

  const initialCandidateCardIds = effect.selectableCardIds ?? [];
  const maxSelectableCards = Math.min(2, initialCandidateCardIds.length);
  const selectionIsValid =
    selectedCardIds.length <= maxSelectableCards &&
    new Set(selectedCardIds).size === selectedCardIds.length &&
    selectedCardIds.every((cardId) =>
      isCurrentNijigasakiLiveCandidate(game, player.id, cardId, initialCandidateCardIds)
    );
  if (!selectionIsValid) {
    if (!wasRestoredAfterPublicCardSelectionConfirmation(effect)) return game;
    return recoverFromStaleStackSelection(
      game,
      effect,
      player.id,
      selectedCardIds,
      continuePendingCardEffects
    );
  }

  const moveResult = moveWaitingRoomCardsToDeckTopForPlayer(game, player.id, selectedCardIds, {
    candidateCardIds: initialCandidateCardIds,
    minCount: 0,
    maxCount: maxSelectableCards,
  });
  if (!moveResult) return game;
  return finishAndContinue(
    moveResult.gameState,
    effect,
    player.id,
    continuePendingCardEffects,
    selectedCardIds.length === 0
      ? 'SKIP_STACK_NIJIGASAKI_LIVE'
      : 'STACK_NIJIGASAKI_LIVE_TO_DECK_TOP',
    {
      selectedOptionId: N_PB1_010_STACK_NIJIGASAKI_LIVE_OPTION_ID,
      candidateCardIds: initialCandidateCardIds,
      selectedCardIds,
      movedCardIds: moveResult.movedCardIds,
    }
  );
}

function recoverFromStaleStackSelection(
  game: GameState,
  effect: ActiveEffectState,
  playerId: string,
  staleSelectedCardIds: readonly string[],
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const currentCandidateCardIds = selectCurrentNijigasakiLiveCardIds(game, playerId);
  if (currentCandidateCardIds.length === 0) {
    return finishAndContinue(
      game,
      effect,
      playerId,
      continuePendingCardEffects,
      'STALE_STACK_SELECTION_NO_OP',
      {
        selectedOptionId: N_PB1_010_STACK_NIJIGASAKI_LIVE_OPTION_ID,
        candidateCardIds: effect.selectableCardIds ?? [],
        selectedCardIds: staleSelectedCardIds,
        currentCandidateCardIds,
        movedCardIds: [],
      }
    );
  }

  const refreshedEffect = createNijigasakiLiveSelectionEffect(
    effect,
    playerId,
    currentCandidateCardIds
  );
  return addAction({ ...game, activeEffect: refreshedEffect }, 'RESOLVE_ABILITY', playerId, {
    pendingAbilityId: effect.id,
    abilityId: effect.abilityId,
    sourceCardId: effect.sourceCardId,
    step: 'STALE_STACK_SELECTION_REFRESH',
    selectedOptionId: N_PB1_010_STACK_NIJIGASAKI_LIVE_OPTION_ID,
    staleSelectedCardIds,
    currentCandidateCardIds,
  });
}

function createNijigasakiLiveSelectionEffect(
  effect: ActiveEffectState,
  playerId: string,
  selectableCardIds: readonly string[]
): ActiveEffectState {
  return {
    id: effect.id,
    abilityId: effect.abilityId,
    sourceCardId: effect.sourceCardId,
    controllerId: effect.controllerId,
    effectText: effect.effectText,
    stepId: N_PB1_010_SELECT_NIJIGASAKI_LIVE_STEP_ID,
    stepText: '请从自己休息室中选择至多2张『虹咲』LIVE卡，按选择顺序放置于卡组顶。',
    awaitingPlayerId: playerId,
    selectableCardIds,
    selectableCardVisibility: 'PUBLIC',
    selectableCardMode: 'ORDERED_MULTI',
    minSelectableCards: 0,
    maxSelectableCards: Math.min(2, selectableCardIds.length),
    canSkipSelection: true,
    skipSelectionLabel: '不放置',
    selectionLabel: '按放置顺序选择卡片',
    confirmSelectionLabel: '按此顺序放置于卡组顶',
    metadata: {
      orderedResolution: effect.metadata?.orderedResolution === true,
      sourceZone: ZoneType.WAITING_ROOM,
      destination: ZoneType.MAIN_DECK,
      publicCardSelectionConfirmation: {
        source: 'WAITING_ROOM',
        destination: 'MAIN_DECK_TOP',
        ordered: true,
        sourcePlayerId: playerId,
      },
    },
  };
}

function selectCurrentNijigasakiLiveCardIds(game: GameState, playerId: string): readonly string[] {
  const player = getPlayerById(game, playerId);
  if (!player) return [];
  return player.waitingRoom.cardIds.filter((cardId) => {
    const card = getCardById(game, cardId);
    return card?.ownerId === playerId && nijigasakiLiveSelector(card);
  });
}

function isCurrentNijigasakiLiveCandidate(
  game: GameState,
  playerId: string,
  cardId: string,
  initialCandidateCardIds: readonly string[]
): boolean {
  const player = getPlayerById(game, playerId);
  const card = getCardById(game, cardId);
  return (
    initialCandidateCardIds.includes(cardId) &&
    player?.waitingRoom.cardIds.includes(cardId) === true &&
    card?.ownerId === playerId &&
    nijigasakiLiveSelector(card)
  );
}

function getExpectedEffect(game: GameState, stepId: string): ActiveEffectState | null {
  const effect = game.activeEffect;
  return effect?.abilityId ===
    PL_N_PB1_010_ON_ENTER_CHOOSE_ACTIVATE_ONE_ENERGY_OR_STACK_NIJIGASAKI_LIVE_TO_DECK_TOP_ABILITY_ID &&
    effect.stepId === stepId
    ? effect
    : null;
}

function finishAndContinue(
  game: GameState,
  effect: ActiveEffectState,
  playerId: string,
  continuePendingCardEffects: ContinuePendingCardEffects,
  step: string,
  payload: Readonly<Record<string, unknown>>
): GameState {
  return continuePendingCardEffects(
    addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', playerId, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step,
      orderedResolution: effect.metadata?.orderedResolution === true,
      ...payload,
    }),
    effect.metadata?.orderedResolution === true
  );
}
