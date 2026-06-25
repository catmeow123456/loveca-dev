import {
  addAction,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { getPositionMovedStageMemberIdsMatching } from '../../../effects/conditions.js';
import { SP_BP5_014_ON_ENTER_OTHER_STAGE_MEMBER_MOVED_DRAW_ONE_ABILITY_ID } from '../../ability-ids.js';
import { drawCardsForPlayer } from '../../runtime/actions.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { recordAbilityUseForContext } from '../../runtime/workflow-helpers.js';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerSpBp5014ChisatoWorkflowHandlers(): void {
  registerPendingAbilityStarterHandler(
    SP_BP5_014_ON_ENTER_OTHER_STAGE_MEMBER_MOVED_DRAW_ONE_ABILITY_ID,
    (game, ability, options, context) =>
      resolveSpBp5014ChisatoOnEnter(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
}

function resolveSpBp5014ChisatoOnEnter(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const movedOtherMemberCardIds = getPositionMovedStageMemberIdsMatching(
    game,
    player.id,
    (card) => card.instanceId !== ability.sourceCardId
  );
  const conditionMet = movedOtherMemberCardIds.length > 0;
  const stateWithoutPending: GameState = {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
  };
  const stateAfterUseRecord = recordAbilityUseForContext(stateWithoutPending, player.id, {
    abilityId: ability.abilityId,
    sourceCardId: ability.sourceCardId,
  });
  const drawResult = conditionMet ? drawCardsForPlayer(stateAfterUseRecord, player.id, 1) : null;
  const stateAfterDraw = drawResult?.gameState ?? stateAfterUseRecord;

  return continuePendingCardEffects(
    addAction(stateAfterDraw, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: conditionMet ? 'OTHER_STAGE_MEMBER_MOVED_DRAW_ONE' : 'NO_OTHER_STAGE_MEMBER_MOVED',
      sourceSlot: ability.sourceSlot,
      conditionMet,
      movedOtherMemberCardIds,
      drawnCardIds: drawResult?.drawnCardIds ?? [],
    }),
    orderedResolution
  );
}
