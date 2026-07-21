import {
  addAction,
  getCardById,
  getPlayerById,
  type ActiveEffectState,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { groupAliasIs } from '../../../effects/card-selectors.js';
import { S_BP7_019_LIVE_SUCCESS_BOTTOM_UP_TO_TWO_AQOURS_CARDS_ABILITY_ID } from '../../ability-ids.js';
import { startPendingActiveEffect } from '../../runtime/active-effect.js';
import { moveWaitingRoomCardsToDeckBottomForPlayer } from '../../runtime/actions.js';
import { wasRestoredAfterPublicCardSelectionConfirmation } from '../../runtime/public-card-selection-confirmation.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';

const ABILITY_ID = S_BP7_019_LIVE_SUCCESS_BOTTOM_UP_TO_TWO_AQOURS_CARDS_ABILITY_ID;
const SELECT_STEP_ID = 'S_BP7_019_SELECT_AQOURS_CARDS_TO_DECK_BOTTOM';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerSBp7019NandoDatteYakusokuWorkflowHandlers(): void {
  registerPendingAbilityStarterHandler(ABILITY_ID, (game, ability, options, context) =>
    startSelection(
      game,
      ability,
      options.orderedResolution === true,
      context.continuePendingCardEffects
    )
  );
  registerActiveEffectStepHandler(ABILITY_ID, SELECT_STEP_ID, (game, input, context) =>
    finishSelection(
      game,
      input.selectedCardIds ?? (input.selectedCardId ? [input.selectedCardId] : []),
      context.continuePendingCardEffects
    )
  );
}

function startSelection(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) return game;
  const candidateCardIds = getCurrentCandidates(game, player.id);
  if (candidateCardIds.length === 0) {
    return finishPendingNoMove(
      game,
      ability,
      player.id,
      orderedResolution,
      continuePendingCardEffects,
      'NO_AQOURS_CARD'
    );
  }
  const maxSelectableCards = Math.min(2, candidateCardIds.length);
  return startPendingActiveEffect(game, {
    ability,
    playerId: player.id,
    activeEffect: {
      id: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      controllerId: player.id,
      effectText: getAbilityEffectText(ability.abilityId),
      stepId: SELECT_STEP_ID,
      stepText: '可以按放置顺序选择自己休息室中的至多2张『Aqours』卡放置于卡组底。',
      awaitingPlayerId: player.id,
      selectableCardIds: candidateCardIds,
      selectableCardVisibility: 'PUBLIC',
      selectableCardMode: 'ORDERED_MULTI',
      minSelectableCards: 0,
      maxSelectableCards,
      selectionLabel: '按放置顺序选择至多2张『Aqours』卡',
      confirmSelectionLabel: '按此顺序放置于卡组底',
      canSkipSelection: true,
      skipSelectionLabel: '不放置',
      metadata: {
        publicCardSelectionConfirmation: {
          destination: 'MAIN_DECK_BOTTOM',
          ordered: true,
        },
        orderedResolution,
        candidateCardIds,
        maxSelectableCards,
      },
    },
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      step: 'START_SELECT_AQOURS_CARDS_TO_DECK_BOTTOM',
      candidateCardIds,
      maxSelectableCards,
    },
  });
}

function finishSelection(
  game: GameState,
  selectedCardIds: readonly string[],
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (!effect || effect.abilityId !== ABILITY_ID || effect.stepId !== SELECT_STEP_ID) return game;
  const player = getPlayerById(game, effect.controllerId);
  if (!player) return game;
  const candidateCardIds = getStringArray(effect.metadata?.candidateCardIds);
  const maxSelectableCards = Math.min(2, getNumber(effect.metadata?.maxSelectableCards));
  if (
    new Set(selectedCardIds).size !== selectedCardIds.length ||
    selectedCardIds.length > maxSelectableCards ||
    selectedCardIds.some((cardId) => !candidateCardIds.includes(cardId))
  ) {
    return game;
  }
  if (selectedCardIds.length === 0) {
    return finishEffectNoMove(
      game,
      effect,
      player.id,
      continuePendingCardEffects,
      'DECLINE_BOTTOM_AQOURS_CARDS'
    );
  }
  const currentCandidateSet = new Set(getCurrentCandidates(game, player.id));
  if (selectedCardIds.some((cardId) => !currentCandidateSet.has(cardId))) {
    return wasRestoredAfterPublicCardSelectionConfirmation(effect)
      ? finishEffectNoMove(
          game,
          effect,
          player.id,
          continuePendingCardEffects,
          'STALE_AQOURS_SELECTION',
          selectedCardIds
        )
      : game;
  }
  const moveResult = moveWaitingRoomCardsToDeckBottomForPlayer(
    { ...game, activeEffect: null },
    player.id,
    selectedCardIds,
    { candidateCardIds, minCount: 0, maxCount: maxSelectableCards }
  );
  if (!moveResult) {
    return wasRestoredAfterPublicCardSelectionConfirmation(effect)
      ? finishEffectNoMove(
          game,
          effect,
          player.id,
          continuePendingCardEffects,
          'STALE_AQOURS_SELECTION',
          selectedCardIds
        )
      : game;
  }
  return continuePendingCardEffects(
    addAction(moveResult.gameState, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'BOTTOM_AQOURS_CARDS',
      selectedCardIds: moveResult.selectedCardIds,
      movedCardIds: moveResult.movedCardIds,
    }),
    effect.metadata?.orderedResolution === true
  );
}

function getCurrentCandidates(game: GameState, playerId: string): readonly string[] {
  const player = getPlayerById(game, playerId);
  const selector = groupAliasIs('Aqours');
  return player
    ? player.waitingRoom.cardIds.filter((cardId) => {
        const card = getCardById(game, cardId);
        return card !== null && card.ownerId === player.id && selector(card);
      })
    : [];
}

function finishPendingNoMove(
  game: GameState,
  ability: PendingAbilityState,
  playerId: string,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects,
  step: string
): GameState {
  return continuePendingCardEffects(
    addAction(
      {
        ...game,
        pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
      },
      'RESOLVE_ABILITY',
      playerId,
      {
        pendingAbilityId: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        step,
        movedCardIds: [],
      }
    ),
    orderedResolution
  );
}

function finishEffectNoMove(
  game: GameState,
  effect: ActiveEffectState,
  playerId: string,
  continuePendingCardEffects: ContinuePendingCardEffects,
  step: string,
  selectedCardIds: readonly string[] = []
): GameState {
  return continuePendingCardEffects(
    addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', playerId, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step,
      selectedCardIds,
      movedCardIds: [],
    }),
    effect.metadata?.orderedResolution === true
  );
}

function getStringArray(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value.filter((candidate): candidate is string => typeof candidate === 'string')
    : [];
}

function getNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}
