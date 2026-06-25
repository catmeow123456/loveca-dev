import {
  addAction,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { SP_PB1_006_AUTO_ENTER_OR_MOVE_GAIN_TWO_BLADE_ABILITY_ID } from '../../ability-ids.js';
import { addBladeLiveModifierForSourceMember } from '../../runtime/actions.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { recordAbilityUseForContext } from '../../runtime/workflow-helpers.js';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerSpPb1006KinakoWorkflowHandlers(): void {
  registerPendingAbilityStarterHandler(
    SP_PB1_006_AUTO_ENTER_OR_MOVE_GAIN_TWO_BLADE_ABILITY_ID,
    (game, ability, options, context) =>
      resolveSpPb1006KinakoEnterOrMoveGainBlade(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
}

function resolveSpPb1006KinakoEnterOrMoveGainBlade(
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
    amount: 2,
  });
  if (!bladeResult) {
    return game;
  }

  return continuePendingCardEffects(
    addAction(bladeResult.gameState, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step:
        ability.timingId === 'ON_ENTER_STAGE'
          ? 'ENTER_GAIN_TWO_BLADE'
          : 'ON_MOVE_GAIN_TWO_BLADE',
      timingId: ability.timingId,
      sourceSlot: ability.sourceSlot,
      fromSlot: ability.metadata?.fromSlot,
      toSlot: ability.metadata?.toSlot,
      swappedCardInstanceId: ability.metadata?.swappedCardInstanceId,
      bladeBonus: bladeResult.bladeBonus,
    }),
    orderedResolution
  );
}
