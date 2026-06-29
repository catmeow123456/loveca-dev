import {
  addAction,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { findMemberSlot } from '../../../../domain/entities/player.js';
import { getAllMemberCardIds } from '../../../../domain/entities/zone.js';
import { addLiveModifier } from '../../../../domain/rules/live-modifiers.js';
import { SP_BP2_010_LIVE_START_OTHER_MEMBER_CHEER_COUNT_MINUS_EIGHT_ABILITY_ID } from '../../ability-ids.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

const CHEER_COUNT_DELTA = -8;

export function registerSpBp2010MargareteWorkflowHandlers(): void {
  registerPendingAbilityStarterHandler(
    SP_BP2_010_LIVE_START_OTHER_MEMBER_CHEER_COUNT_MINUS_EIGHT_ABILITY_ID,
    (game, ability, options, context) =>
      resolveSpBp2010MargareteLiveStart(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
}

function resolveSpBp2010MargareteLiveStart(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const sourceSlot = findMemberSlot(player, ability.sourceCardId);
  const otherMemberCardIds = getAllMemberCardIds(player.memberSlots).filter(
    (cardId) => cardId !== ability.sourceCardId
  );
  const conditionMet = sourceSlot !== null && otherMemberCardIds.length > 0;
  const stateWithoutPending: GameState = {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
  };
  const stateAfterModifier = conditionMet
    ? addLiveModifier(stateWithoutPending, {
        kind: 'CHEER_COUNT',
        playerId: player.id,
        countDelta: CHEER_COUNT_DELTA,
        sourceCardId: ability.sourceCardId,
        abilityId: ability.abilityId,
      })
    : stateWithoutPending;

  return continuePendingCardEffects(
    addAction(stateAfterModifier, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: 'OTHER_MEMBER_CHEER_COUNT_MINUS_EIGHT',
      sourceSlot,
      otherMemberCardIds,
      conditionMet,
      cheerCountDelta: conditionMet ? CHEER_COUNT_DELTA : 0,
    }),
    orderedResolution
  );
}
