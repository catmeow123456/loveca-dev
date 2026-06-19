import {
  addAction,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { addMemberActivePhaseSkip } from '../../../../domain/rules/member-active-skips.js';
import { OrientationState } from '../../../../shared/types/enums.js';
import { setMemberOrientation } from '../../../effects/member-state.js';
import { HS_BP6_006_LIVE_SUCCESS_WAIT_SKIP_NEXT_ACTIVE_ABILITY_ID } from '../../ability-ids.js';
import { getSourceMemberSlot } from '../../runtime/source-member.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerHsBp6006HimeWorkflowHandlers(): void {
  registerPendingAbilityStarterHandler(
    HS_BP6_006_LIVE_SUCCESS_WAIT_SKIP_NEXT_ACTIVE_ABILITY_ID,
    (game, ability, options, context) =>
      resolveHsBp6006HimeLiveSuccess(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
}

function resolveHsBp6006HimeLiveSuccess(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const sourceSlot =
    ability.sourceSlot ?? getSourceMemberSlot(game, player.id, ability.sourceCardId);
  let state: GameState = {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
  };

  if (!sourceSlot) {
    return continuePendingCardEffects(
      addAction(state, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        step: 'SOURCE_NOT_ON_STAGE_NO_OP',
      }),
      orderedResolution
    );
  }

  const waitResult = setMemberOrientation(
    state,
    player.id,
    ability.sourceCardId,
    OrientationState.WAITING,
    {
      kind: 'CARD_EFFECT',
      playerId: player.id,
      sourceCardId: ability.sourceCardId,
      abilityId: ability.abilityId,
      pendingAbilityId: ability.id,
    }
  );
  if (!waitResult) {
    return continuePendingCardEffects(
      addAction(state, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        step: 'SOURCE_NOT_ON_STAGE_NO_OP',
        sourceSlot,
      }),
      orderedResolution
    );
  }

  state = addMemberActivePhaseSkip(waitResult.gameState, {
    playerId: player.id,
    memberCardId: ability.sourceCardId,
    sourceCardId: ability.sourceCardId,
    abilityId: ability.abilityId,
  });

  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: 'WAIT_SOURCE_SKIP_NEXT_ACTIVE',
      sourceSlot,
      previousOrientation: waitResult.previousOrientation,
      nextOrientation: waitResult.nextOrientation,
      skipNextActivePlayerId: player.id,
      skipNextActiveMemberCardId: ability.sourceCardId,
    }),
    orderedResolution
  );
}
