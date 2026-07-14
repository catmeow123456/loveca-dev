import {
  addAction,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { N_PR_025_AUTO_TWICE_PER_TURN_OWN_RELAY_MEMBER_ENTER_DRAW_ONE_ABILITY_ID } from '../../ability-ids.js';
import { drawCardsForPlayer } from '../../runtime/actions.js';
import { startConfirmOnlyPendingAbilityEffect } from '../../runtime/active-effect.js';
import {
  registerPendingAbilityStarterHandler,
  type PendingAbilityStarterOptions,
} from '../../runtime/starter-registry.js';
import {
  getAbilityEffectText,
  recordAbilityUseForContext,
} from '../../runtime/workflow-helpers.js';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerNPr025SetsunaWorkflowHandlers(): void {
  registerPendingAbilityStarterHandler(
    N_PR_025_AUTO_TWICE_PER_TURN_OWN_RELAY_MEMBER_ENTER_DRAW_ONE_ABILITY_ID,
    (game, ability, options, context) =>
      resolveNPr025SetsunaRelayDraw(game, ability, options, context.continuePendingCardEffects)
  );
}

function resolveNPr025SetsunaRelayDraw(
  game: GameState,
  ability: PendingAbilityState,
  options: PendingAbilityStarterOptions,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  if (options.manualConfirmation === true && options.skipManualConfirmation !== true) {
    return startConfirmOnlyPendingAbilityEffect(game, {
      ability,
      effectText: getAbilityEffectText(ability.abilityId),
      orderedResolution: options.orderedResolution === true,
      stepText: '确认后结算此效果。',
    });
  }

  let state: GameState = {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
  };
  state = recordAbilityUseForContext(state, player.id, {
    abilityId: ability.abilityId,
    sourceCardId: ability.sourceCardId,
  });
  const drawResult = drawCardsForPlayer(state, player.id, 1);
  state = drawResult?.gameState ?? state;

  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: 'DRAW_ONE_AFTER_OWN_RELAY_MEMBER_ENTER',
      drawnCardIds: drawResult?.drawnCardIds ?? [],
    }),
    options.orderedResolution === true
  );
}
