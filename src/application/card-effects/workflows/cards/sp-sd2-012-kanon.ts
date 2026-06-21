import {
  addAction,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { addHeartLiveModifierForMember } from '../../../../domain/rules/live-modifiers.js';
import { HeartColor } from '../../../../shared/types/enums.js';
import { SP_SD2_012_AUTO_ON_MOVE_GAIN_RED_HEART_ABILITY_ID } from '../../ability-ids.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { recordAbilityUseForContext } from '../../runtime/workflow-helpers.js';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerSpSd2012KanonWorkflowHandlers(): void {
  registerPendingAbilityStarterHandler(
    SP_SD2_012_AUTO_ON_MOVE_GAIN_RED_HEART_ABILITY_ID,
    (game, ability, options, context) =>
      resolveSpSd2012KanonOnMoveGainRedHeart(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
}

function resolveSpSd2012KanonOnMoveGainRedHeart(
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
  const heartResult = addHeartLiveModifierForMember(stateAfterUseRecord, {
    playerId: player.id,
    memberCardId: ability.sourceCardId,
    sourceCardId: ability.sourceCardId,
    abilityId: ability.abilityId,
    hearts: [{ color: HeartColor.RED, count: 1 }],
  });
  if (!heartResult) {
    return game;
  }

  return continuePendingCardEffects(
    addAction(heartResult.gameState, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: 'ON_MOVE_GAIN_RED_HEART',
      sourceSlot: ability.sourceSlot,
      fromSlot: ability.metadata?.fromSlot,
      toSlot: ability.metadata?.toSlot,
      swappedCardInstanceId: ability.metadata?.swappedCardInstanceId,
      heartBonus: heartResult.heartBonus,
    }),
    orderedResolution
  );
}
