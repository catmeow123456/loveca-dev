import {
  addAction,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { addHeartLiveModifierForMember } from '../../../../domain/rules/live-modifiers.js';
import { HeartColor, ZoneType } from '../../../../shared/types/enums.js';
import { HS_PR_019_ON_ENTER_MILL_GAIN_GREEN_HEART_ABILITY_ID } from '../../ability-ids.js';
import { startPendingActiveEffect } from '../../runtime/active-effect.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';
import { memberHasHeartColor } from '../../../effects/card-selectors.js';
import { allCardIdsMatchingSelector } from '../../../effects/conditions.js';
import {
  inspectTopCards,
  moveInspectedCardsToWaitingRoom,
} from '../../../effects/look-top.js';

const HS_PR_019_REVEAL_TOP_THREE_STEP_ID = 'HS_PR_019_REVEAL_TOP_THREE';
const GREEN_HEART_MEMBER_CARD = memberHasHeartColor(HeartColor.GREEN);

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerHsPr019GinkoWorkflowHandlers(): void {
  registerPendingAbilityStarterHandler(
    HS_PR_019_ON_ENTER_MILL_GAIN_GREEN_HEART_ABILITY_ID,
    (game, ability, options) =>
      startHsPr019GinkoMillGainGreenHeartInspection(
        game,
        ability,
        options.orderedResolution === true
      )
  );
  registerActiveEffectStepHandler(
    HS_PR_019_ON_ENTER_MILL_GAIN_GREEN_HEART_ABILITY_ID,
    HS_PR_019_REVEAL_TOP_THREE_STEP_ID,
    (game, _input, context) =>
      finishHsPr019GinkoMillGainGreenHeart(game, context.continuePendingCardEffects)
  );
}

function startHsPr019GinkoMillGainGreenHeartInspection(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const inspection = inspectTopCards(game, player.id, {
    count: 3,
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
      effectText: getAbilityEffectText(HS_PR_019_ON_ENTER_MILL_GAIN_GREEN_HEART_ABILITY_ID),
      stepId: HS_PR_019_REVEAL_TOP_THREE_STEP_ID,
      stepText:
        '卡组顶3张已公开。确认后将这些牌放入休息室，并在均为持有绿色Heart的成员时获得绿色Heart。',
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

function finishHsPr019GinkoMillGainGreenHeart(
  game: GameState,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== HS_PR_019_ON_ENTER_MILL_GAIN_GREEN_HEART_ABILITY_ID ||
    effect.stepId !== HS_PR_019_REVEAL_TOP_THREE_STEP_ID
  ) {
    return game;
  }

  const player = getPlayerById(game, effect.controllerId);
  if (!player) {
    return game;
  }

  const inspectedCardIds = effect.inspectionCardIds ?? [];
  const conditionMet =
    inspectedCardIds.length === 3 &&
    allCardIdsMatchingSelector(game, inspectedCardIds, GREEN_HEART_MEMBER_CARD);

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

  if (conditionMet) {
    const modifierResult = addHeartLiveModifierForMember(state, {
      playerId: player.id,
      memberCardId: effect.sourceCardId,
      sourceCardId: effect.sourceCardId,
      abilityId: effect.abilityId,
      hearts: [{ color: HeartColor.GREEN, count: 1 }],
    });
    if (!modifierResult) {
      return game;
    }
    state = modifierResult.gameState;
  }

  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'FINISH_MILL_TOP_THREE_CHECK_GREEN_HEART_MEMBERS',
      milledCardIds: moveResult.movedCardIds,
      conditionMet,
      heartBonus: conditionMet ? [{ color: HeartColor.GREEN, count: 1 }] : [],
    }),
    effect.metadata?.orderedResolution === true
  );
}
