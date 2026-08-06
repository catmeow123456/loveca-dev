import {
  addAction,
  getCardById,
  getPlayerById,
  type ActiveEffectState,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { unitAliasIs, type CardSelector } from '../../../effects/card-selectors.js';
import { SP_BP7_012_ON_ENTER_BOTTOM_CATCHU_KALEIDOSCORE_FIVEYNCRISE_DRAW_ONE_ABILITY_ID } from '../../ability-ids.js';
import { drawCardsForPlayer } from '../../runtime/actions.js';
import { startPendingActiveEffect } from '../../runtime/active-effect.js';
import { wasRestoredAfterPublicCardSelectionConfirmation } from '../../runtime/public-card-selection-confirmation.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { moveWaitingRoomCardsToDeckBottomAndEnqueueTriggers } from '../../runtime/waiting-room-main-deck-triggers.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';

const SELECT_WAITING_CARDS_STEP_ID = 'SP_BP7_012_SELECT_WAITING_UNIT_CARDS';
const REQUIRED_CARD_COUNT = 3;

const REQUIRED_UNITS = ['CatChu!', 'KALEIDOSCORE', '5yncri5e!'] as const;
const REQUIRED_UNIT_SELECTORS: readonly CardSelector[] = REQUIRED_UNITS.map((unitName) =>
  unitAliasIs(unitName)
);

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

interface UnitSelectionState {
  readonly candidateCardIds: readonly string[];
  readonly candidateCardIdsByUnit: readonly (readonly string[])[];
  readonly hasCompleteAssignment: boolean;
}

export function registerSpBp7012KanonWorkflowHandlers(): void {
  registerPendingAbilityStarterHandler(
    SP_BP7_012_ON_ENTER_BOTTOM_CATCHU_KALEIDOSCORE_FIVEYNCRISE_DRAW_ONE_ABILITY_ID,
    (game, ability, options, context) =>
      startSelectWaitingCards(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    SP_BP7_012_ON_ENTER_BOTTOM_CATCHU_KALEIDOSCORE_FIVEYNCRISE_DRAW_ONE_ABILITY_ID,
    SELECT_WAITING_CARDS_STEP_ID,
    (game, input, context) =>
      finishSelectWaitingCards(
        game,
        input.selectedCardIds ?? [],
        context.continuePendingCardEffects
      )
  );
}

function startSelectWaitingCards(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) return game;

  const selection = getUnitSelectionState(game, player.id);
  if (!selection.hasCompleteAssignment) {
    return continuePendingCardEffects(
      addAction(
        {
          ...game,
          pendingAbilities: game.pendingAbilities.filter(
            (candidate) => candidate.id !== ability.id
          ),
        },
        'RESOLVE_ABILITY',
        player.id,
        {
          pendingAbilityId: ability.id,
          abilityId: ability.abilityId,
          sourceCardId: ability.sourceCardId,
          step: 'NO_COMPLETE_UNIT_ASSIGNMENT',
          movedCardIds: [],
          drawnCardIds: [],
        }
      ),
      orderedResolution
    );
  }

  return startPendingActiveEffect(game, {
    ability,
    playerId: player.id,
    activeEffect: {
      id: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      controllerId: ability.controllerId,
      effectText: getAbilityEffectText(ability.abilityId),
      stepId: SELECT_WAITING_CARDS_STEP_ID,
      stepText:
        '可以从自己的休息室选择『CatChu!』、『KALEIDOSCORE』和『5yncri5e!』的卡片各1张。选择顺序会成为放置于卡组底的顺序。',
      awaitingPlayerId: player.id,
      selectableCardIds: selection.candidateCardIds,
      selectableCardVisibility: 'PUBLIC',
      selectableCardMode: 'ORDERED_MULTI',
      minSelectableCards: REQUIRED_CARD_COUNT,
      maxSelectableCards: REQUIRED_CARD_COUNT,
      selectionLabel: '按放置顺序选择各小队的卡片',
      confirmSelectionLabel: '按此顺序放置于卡组底',
      canSkipSelection: true,
      skipSelectionLabel: '不发动',
      metadata: {
        publicCardSelectionConfirmation: {
          destination: 'MAIN_DECK_BOTTOM',
          ordered: true,
          sourcePlayerId: player.id,
          distinctGroupAssignment: true,
          groups: selection.candidateCardIdsByUnit.map((candidateCardIds) => ({
            candidateCardIds,
            minCount: 1,
            maxCount: 1,
          })),
        },
        orderedResolution,
        sourceSlot: ability.sourceSlot,
        eventIds: ability.eventIds,
        candidateCardIds: selection.candidateCardIds,
      },
    },
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      sourceSlot: ability.sourceSlot,
      step: 'START_SELECT_WAITING_UNIT_CARDS',
      selectableCardIds: selection.candidateCardIds,
    },
  });
}

function finishSelectWaitingCards(
  game: GameState,
  selectedCardIds: readonly string[],
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (!isExpectedStep(effect)) return game;
  const player = getPlayerById(game, effect.controllerId);
  if (!player) return game;

  if (selectedCardIds.length === 0) {
    return completeWithoutMoving(
      game,
      effect,
      'DECLINE_BOTTOM_WAITING_UNIT_CARDS',
      continuePendingCardEffects
    );
  }

  const candidateCardIds = getStringArray(effect.metadata?.candidateCardIds);
  const selectionStillLegal =
    selectedCardIds.length === REQUIRED_CARD_COUNT &&
    new Set(selectedCardIds).size === REQUIRED_CARD_COUNT &&
    selectedCardIds.every((cardId) => candidateCardIds.includes(cardId)) &&
    selectionHasDistinctUnitAssignment(game, player.id, selectedCardIds);
  if (!selectionStillLegal) {
    return wasRestoredAfterPublicCardSelectionConfirmation(effect)
      ? completeWithoutMoving(
          game,
          effect,
          'SELECTED_UNIT_CARDS_LEFT_WAITING_ROOM',
          continuePendingCardEffects
        )
      : game;
  }

  const moveResult = moveWaitingRoomCardsToDeckBottomAndEnqueueTriggers(
    { ...game, activeEffect: null },
    player.id,
    selectedCardIds,
    {
      candidateCardIds,
      minCount: REQUIRED_CARD_COUNT,
      maxCount: REQUIRED_CARD_COUNT,
      cause: {
        kind: 'CARD_EFFECT',
        playerId: player.id,
        sourceCardId: effect.sourceCardId,
        abilityId: effect.abilityId,
        pendingAbilityId: effect.id,
      },
    }
  );
  if (!moveResult || moveResult.movedCardIds.length !== REQUIRED_CARD_COUNT) {
    return wasRestoredAfterPublicCardSelectionConfirmation(effect)
      ? completeWithoutMoving(
          game,
          effect,
          'SELECTED_UNIT_CARDS_LEFT_WAITING_ROOM',
          continuePendingCardEffects
        )
      : game;
  }

  const drawResult = drawCardsForPlayer(moveResult.gameState, player.id, 1);
  const stateAfterDraw = drawResult?.gameState ?? moveResult.gameState;
  return continuePendingCardEffects(
    addAction(stateAfterDraw, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      sourceSlot: effect.metadata?.sourceSlot,
      step: 'BOTTOM_WAITING_UNIT_CARDS_DRAW_ONE',
      selectedCardIds: moveResult.selectedCardIds,
      movedCardIds: moveResult.movedCardIds,
      drawnCardIds: drawResult?.drawnCardIds ?? [],
    }),
    effect.metadata?.orderedResolution === true
  );
}

function completeWithoutMoving(
  game: GameState,
  effect: ActiveEffectState,
  step: string,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  return continuePendingCardEffects(
    addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', effect.controllerId, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      sourceSlot: effect.metadata?.sourceSlot,
      step,
      selectedCardIds: [],
      movedCardIds: [],
      drawnCardIds: [],
    }),
    effect.metadata?.orderedResolution === true
  );
}

function getUnitSelectionState(game: GameState, playerId: string): UnitSelectionState {
  const player = getPlayerById(game, playerId);
  if (!player) {
    return { candidateCardIds: [], candidateCardIdsByUnit: [], hasCompleteAssignment: false };
  }

  const candidateCardIdsByUnit = REQUIRED_UNIT_SELECTORS.map((selector) =>
    player.waitingRoom.cardIds.filter((cardId) => {
      const card = getCardById(game, cardId);
      return card !== null && card.ownerId === player.id && selector(card);
    })
  );
  const candidateIdSet = new Set(candidateCardIdsByUnit.flat());
  const candidateCardIds = player.waitingRoom.cardIds.filter((cardId) =>
    candidateIdSet.has(cardId)
  );
  return {
    candidateCardIds,
    candidateCardIdsByUnit,
    hasCompleteAssignment: hasDistinctAssignment(candidateCardIdsByUnit),
  };
}

function selectionHasDistinctUnitAssignment(
  game: GameState,
  playerId: string,
  selectedCardIds: readonly string[]
): boolean {
  const player = getPlayerById(game, playerId);
  if (!player) return false;
  const selectedIdSet = new Set(selectedCardIds);
  if (
    selectedIdSet.size !== REQUIRED_CARD_COUNT ||
    selectedCardIds.some((cardId) => !player.waitingRoom.cardIds.includes(cardId))
  ) {
    return false;
  }
  const candidateCardIdsByUnit = REQUIRED_UNIT_SELECTORS.map((selector) =>
    selectedCardIds.filter((cardId) => {
      const card = getCardById(game, cardId);
      return card !== null && card.ownerId === player.id && selector(card);
    })
  );
  return hasDistinctAssignment(candidateCardIdsByUnit);
}

function hasDistinctAssignment(candidateCardIdsByUnit: readonly (readonly string[])[]): boolean {
  const usedCardIds = new Set<string>();
  const search = (unitIndex: number): boolean => {
    if (unitIndex >= candidateCardIdsByUnit.length) return true;
    for (const cardId of candidateCardIdsByUnit[unitIndex] ?? []) {
      if (usedCardIds.has(cardId)) continue;
      usedCardIds.add(cardId);
      if (search(unitIndex + 1)) return true;
      usedCardIds.delete(cardId);
    }
    return false;
  };
  return search(0);
}

function isExpectedStep(effect: ActiveEffectState | null): effect is ActiveEffectState {
  return (
    effect?.abilityId ===
      SP_BP7_012_ON_ENTER_BOTTOM_CATCHU_KALEIDOSCORE_FIVEYNCRISE_DRAW_ONE_ABILITY_ID &&
    effect.stepId === SELECT_WAITING_CARDS_STEP_ID
  );
}

function getStringArray(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}
