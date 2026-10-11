import {
  addAction,
  getCardById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { addLiveModifier } from '../../../../domain/rules/live-modifiers.js';
import { HeartColor } from '../../../../shared/types/enums.js';
import { cardCodeMatchesBase } from '../../../../shared/utils/card-code.js';
import { N_BP8_030_AUTO_FROM_WAITING_ROOM_REDUCE_REQUIREMENT_ABILITY_ID } from '../../ability-ids.js';
import { getPendingAbilitySourceLifecycleId } from '../../runtime/ability-source-lifecycle.js';
import { isCurrentLiveCardAbilitySource } from '../../runtime/source-live.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerNBp8030StayWorkflowHandlers(): void {
  registerPendingAbilityStarterHandler(
    N_BP8_030_AUTO_FROM_WAITING_ROOM_REDUCE_REQUIREMENT_ABILITY_ID,
    (game, ability, options, context) =>
      resolveStayRequirementReduction(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
}

function resolveStayRequirementReduction(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const sourceLifecycleId = getPendingAbilitySourceLifecycleId(game, ability);
  const source = getCardById(game, ability.sourceCardId);
  const rewardApplied =
    source !== null &&
    cardCodeMatchesBase(source.data.cardCode, 'PL!N-bp8-030') &&
    isCurrentLiveCardAbilitySource(game, { ...ability, sourceLifecycleId });
  let state: GameState = {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
  };
  if (rewardApplied) {
    state = addLiveModifier(state, {
      kind: 'REQUIREMENT',
      liveCardId: ability.sourceCardId,
      modifiers: [{ color: HeartColor.RAINBOW, countDelta: -3 }],
      sourceCardId: ability.sourceCardId,
      abilityId: ability.abilityId,
    });
  }
  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', ability.controllerId, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      sourceLifecycleId,
      step: 'REDUCE_SOURCE_LIVE_REQUIREMENT_FROM_WAITING_ROOM',
      requirementReduction: rewardApplied ? 3 : 0,
      rewardApplied,
    }),
    orderedResolution
  );
}
