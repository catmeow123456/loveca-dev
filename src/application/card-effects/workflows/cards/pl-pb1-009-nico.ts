import { addAction, type GameState, type PendingAbilityState } from '../../../../domain/entities/game.js';
import { addMemberEffectActivationProhibitionUntilTurnEnd } from '../../../../domain/rules/member-effect-activation-prohibitions.js';
import { PL_PB1_009_ON_ENTER_PREVENT_EFFECT_MEMBER_ACTIVATION_THIS_TURN_ABILITY_ID } from '../../ability-ids.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerPlPb1009NicoWorkflowHandlers(): void {
  registerPendingAbilityStarterHandler(
    PL_PB1_009_ON_ENTER_PREVENT_EFFECT_MEMBER_ACTIVATION_THIS_TURN_ABILITY_ID,
    (game, ability, options, context) =>
      resolve(game, ability, options.orderedResolution === true, context.continuePendingCardEffects)
  );
}

function resolve(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const stateWithoutPending = {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
  };
  const stateWithProhibition = addMemberEffectActivationProhibitionUntilTurnEnd(
    stateWithoutPending,
    {
      affectedPlayerIds: game.players.map((player) => player.id),
      sourceCardId: ability.sourceCardId,
      abilityId: ability.abilityId,
    }
  );
  return continuePendingCardEffects(
    addAction(stateWithProhibition, 'RESOLVE_ABILITY', ability.controllerId, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: 'PREVENT_EFFECT_MEMBER_ACTIVATION_THIS_TURN',
    }),
    orderedResolution
  );
}
