import {
  addAction,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { CardType, OrientationState } from '../../../../shared/types/enums.js';
import { and, typeIs, unitAliasIs } from '../../../effects/card-selectors.js';
import { getEnergyCardIdsByOrientation } from '../../../effects/energy.js';
import { getStageMemberCardIdsMatching } from '../../../effects/stage-targets.js';
import { HS_BP6_012_ON_ENTER_OTHER_CERISE_BOUQUET_ACTIVATE_ENERGY_ABILITY_ID } from '../../ability-ids.js';
import { activateWaitingEnergyCardsForPlayer } from '../../runtime/actions.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

const ceriseBouquetMember = and(typeIs(CardType.MEMBER), unitAliasIs('Cerise Bouquet'));
const ACTIVATE_ENERGY_COUNT = 1;

export function registerHsBp6012GinkoWorkflowHandlers(): void {
  registerPendingAbilityStarterHandler(
    HS_BP6_012_ON_ENTER_OTHER_CERISE_BOUQUET_ACTIVATE_ENERGY_ABILITY_ID,
    (game, ability, options, context) =>
      resolveHsBp6012GinkoOnEnter(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
}

function resolveHsBp6012GinkoOnEnter(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const otherCeriseBouquetMemberIds = getStageMemberCardIdsMatching(
    game,
    player.id,
    ceriseBouquetMember
  ).filter((cardId) => cardId !== ability.sourceCardId);
  if (otherCeriseBouquetMemberIds.length === 0) {
    return consumePendingWithoutActiveEffect(
      game,
      ability,
      player.id,
      orderedResolution,
      continuePendingCardEffects,
      'NO_OTHER_CERISE_BOUQUET_MEMBER',
      {
        otherCeriseBouquetMemberIds,
        waitingEnergyCardIds: getEnergyCardIdsByOrientation(
          game,
          player.id,
          OrientationState.WAITING
        ),
      }
    );
  }

  const waitingEnergyCardIds = getEnergyCardIdsByOrientation(
    game,
    player.id,
    OrientationState.WAITING
  );
  const activationCount = Math.min(ACTIVATE_ENERGY_COUNT, waitingEnergyCardIds.length);
  const activationResult = activateWaitingEnergyCardsForPlayer(game, player.id, activationCount);
  if (!activationResult) {
    return game;
  }

  const stateWithoutPending: GameState = {
    ...activationResult.gameState,
    pendingAbilities: activationResult.gameState.pendingAbilities.filter(
      (candidate) => candidate.id !== ability.id
    ),
  };

  return continuePendingCardEffects(
    addAction(stateWithoutPending, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: activationCount > 0 ? 'ACTIVATE_WAITING_ENERGY' : 'NO_WAITING_ENERGY',
      requestedActivationCount: ACTIVATE_ENERGY_COUNT,
      otherCeriseBouquetMemberIds,
      waitingEnergyCardIds,
      activatedEnergyCardIds: activationResult.activatedEnergyCardIds,
      previousOrientations: activationResult.previousOrientations,
      nextOrientation: activationResult.nextOrientation,
    }),
    orderedResolution
  );
}

function consumePendingWithoutActiveEffect(
  game: GameState,
  ability: PendingAbilityState,
  playerId: string,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects,
  step: string,
  extraPayload: Readonly<Record<string, unknown>>
): GameState {
  const state = {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
  };

  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', playerId, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step,
      sourceSlot: ability.sourceSlot,
      ...extraPayload,
    }),
    orderedResolution
  );
}
