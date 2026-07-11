import {
  addAction,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { addHeartLiveModifierForMember } from '../../../../domain/rules/live-modifiers.js';
import { HeartColor } from '../../../../shared/types/enums.js';
import {
  HS_PB1_003_AUTO_HAND_TO_WAITING_GAIN_HEART_BLADE_ABILITY_ID,
} from '../../ability-ids.js';
import { addBladeLiveModifierForSourceMember } from '../../runtime/actions.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import {
  recordAbilityUseForContext,
} from '../../runtime/workflow-helpers.js';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;
export function registerHsPb1003RurinoWorkflowHandlers(_dependencies: {
  readonly enqueueTriggeredCardEffects: unknown;
}): void {
  registerPendingAbilityStarterHandler(
    HS_PB1_003_AUTO_HAND_TO_WAITING_GAIN_HEART_BLADE_ABILITY_ID,
    (game, ability, options, context) =>
      resolveHsPb1003RurinoHandToWaitingAuto(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
}

function resolveHsPb1003RurinoHandToWaitingAuto(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  let state: GameState = {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
  };
  state = recordAbilityUseForContext(state, player.id, {
    abilityId: ability.abilityId,
    sourceCardId: ability.sourceCardId,
  });

  const heartResult = addHeartLiveModifierForMember(state, {
    playerId: player.id,
    memberCardId: ability.sourceCardId,
    sourceCardId: ability.sourceCardId,
    abilityId: ability.abilityId,
    hearts: [{ color: HeartColor.PINK, count: 1 }],
  });
  if (!heartResult) {
    return game;
  }

  const bladeResult = addBladeLiveModifierForSourceMember(heartResult.gameState, {
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
      step: 'GAIN_PINK_HEART_AND_BLADE_FROM_HAND_TO_WAITING',
      sourceSlot: ability.sourceSlot,
      movedCardIds: ability.metadata?.movedCardIds ?? [],
    }),
    orderedResolution
  );
}
