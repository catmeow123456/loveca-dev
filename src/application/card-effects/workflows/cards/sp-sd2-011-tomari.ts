import {
  addAction,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { SP_SD2_011_AUTO_ON_MOVE_GAIN_BLADE_ABILITY_ID } from '../../ability-ids.js';
import { addBladeLiveModifierForSourceMember } from '../../runtime/actions.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { recordAbilityUseForContext } from '../../runtime/workflow-helpers.js';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerSpSd2011TomariWorkflowHandlers(): void {
  registerPendingAbilityStarterHandler(
    SP_SD2_011_AUTO_ON_MOVE_GAIN_BLADE_ABILITY_ID,
    (game, ability, options, context) =>
      resolveSpSd2011TomariOnMoveGainBlade(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
}

function resolveSpSd2011TomariOnMoveGainBlade(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const stateWithoutPending: GameState = {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
  };
  const stateAfterUseRecord = recordAbilityUseForContext(stateWithoutPending, player.id, {
    abilityId: ability.abilityId,
    sourceCardId: ability.sourceCardId,
  });
  const bladeResult = addBladeLiveModifierForSourceMember(stateAfterUseRecord, {
    playerId: player.id,
    sourceCardId: ability.sourceCardId,
    abilityId: ability.abilityId,
    amount: 1,
  });
  if (!bladeResult) {
    return game;
  }

  return continuePendingCardEffects(
    addAction(bladeResult.gameState, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: 'ON_MOVE_GAIN_BLADE',
      sourceSlot: ability.sourceSlot,
      fromSlot: ability.metadata?.fromSlot,
      toSlot: ability.metadata?.toSlot,
      swappedCardInstanceId: ability.metadata?.swappedCardInstanceId,
      bladeBonus: bladeResult.bladeBonus,
    }),
    orderedResolution
  );
}
