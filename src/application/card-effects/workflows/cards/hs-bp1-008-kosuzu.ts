import {
  addAction,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { CardType, ZoneType } from '../../../../shared/types/enums.js';
import { allCardIdsMatchingSelector } from '../../../effects/conditions.js';
import { typeIs } from '../../../effects/card-selectors.js';
import { inspectTopCards, moveInspectedCardsToWaitingRoom } from '../../../effects/look-top.js';
import { HS_BP1_008_ON_ENTER_MILL_THREE_DRAW_IF_ALL_MEMBERS_ABILITY_ID } from '../../ability-ids.js';
import { drawCardsForPlayer } from '../../runtime/actions.js';
import { startPendingActiveEffect } from '../../runtime/active-effect.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';

const HS_BP1_008_REVEAL_TOP_THREE_STEP_ID = 'HS_BP1_008_REVEAL_TOP_THREE';
const TOP_COUNT = 3;

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerHsBp1008KosuzuWorkflowHandlers(): void {
  registerPendingAbilityStarterHandler(
    HS_BP1_008_ON_ENTER_MILL_THREE_DRAW_IF_ALL_MEMBERS_ABILITY_ID,
    (game, ability, options) =>
      startHsBp1008KosuzuInspection(game, ability, options.orderedResolution === true)
  );
  registerActiveEffectStepHandler(
    HS_BP1_008_ON_ENTER_MILL_THREE_DRAW_IF_ALL_MEMBERS_ABILITY_ID,
    HS_BP1_008_REVEAL_TOP_THREE_STEP_ID,
    (game, _input, context) =>
      finishHsBp1008Kosuzu(game, context.continuePendingCardEffects)
  );
}

function startHsBp1008KosuzuInspection(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const inspection = inspectTopCards(game, player.id, {
    count: TOP_COUNT,
    reveal: true,
  });
  if (!inspection) {
    return game;
  }

  const { gameState, inspectedCardIds } = inspection;
  return startPendingActiveEffect(gameState, {
    ability,
    playerId: player.id,
    activeEffect: {
      id: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      controllerId: ability.controllerId,
      effectText: getAbilityEffectText(ability.abilityId),
      stepId: HS_BP1_008_REVEAL_TOP_THREE_STEP_ID,
      stepText: '卡组顶3张已公开。确认后将这些牌放入休息室，并在实际公开满3张且均为成员卡时抽1张。',
      awaitingPlayerId: player.id,
      inspectionCardIds: inspectedCardIds,
      metadata: {
        sourceZone: ZoneType.MAIN_DECK,
        orderedResolution,
      },
    },
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      step: 'START_INSPECTION',
      inspectedCardIds,
    },
  });
}

function finishHsBp1008Kosuzu(
  game: GameState,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== HS_BP1_008_ON_ENTER_MILL_THREE_DRAW_IF_ALL_MEMBERS_ABILITY_ID ||
    effect.stepId !== HS_BP1_008_REVEAL_TOP_THREE_STEP_ID
  ) {
    return game;
  }

  const player = getPlayerById(game, effect.controllerId);
  if (!player) {
    return game;
  }

  const inspectedCardIds = effect.inspectionCardIds ?? [];
  const conditionMet =
    inspectedCardIds.length === TOP_COUNT &&
    allCardIdsMatchingSelector(game, inspectedCardIds, typeIs(CardType.MEMBER));
  const moveResult = moveInspectedCardsToWaitingRoom(game, player.id, inspectedCardIds);
  if (!moveResult) {
    return game;
  }

  let state: GameState = {
    ...moveResult.gameState,
    inspectionContext:
      moveResult.gameState.inspectionZone.cardIds.length > 0
        ? moveResult.gameState.inspectionContext
        : null,
    activeEffect: null,
  };
  const drawResult = conditionMet ? drawCardsForPlayer(state, player.id, 1) : null;
  if (conditionMet && !drawResult) {
    return game;
  }
  state = drawResult?.gameState ?? state;

  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'FINISH_MILL_TOP_THREE_DRAW_IF_ALL_MEMBERS',
      milledCardIds: moveResult.movedCardIds,
      conditionMet,
      drawnCardIds: drawResult?.drawnCardIds ?? [],
    }),
    effect.metadata?.orderedResolution === true
  );
}
