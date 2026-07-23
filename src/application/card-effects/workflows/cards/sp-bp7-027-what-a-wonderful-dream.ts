import { isLiveCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { SP_BP7_027_LIVE_SUCCESS_PLACE_SKIPPED_WAITING_ENERGY_ABILITY_ID } from '../../ability-ids.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import {
  placeWaitingEnergyWithActivePhaseSkip,
  type EnqueueTriggeredCardEffectsForWaitingEnergyPlacement,
} from '../../runtime/waiting-energy-placement.js';
import { maybeStartConfirmablePendingAbilityConfirmation } from '../../runtime/workflow-helpers.js';

const CARD_CODE = 'PL!SP-bp7-027-L';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerSpBp7027WhatAWonderfulDreamWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForWaitingEnergyPlacement;
}): void {
  registerPendingAbilityStarterHandler(
    SP_BP7_027_LIVE_SUCCESS_PLACE_SKIPPED_WAITING_ENERGY_ABILITY_ID,
    (game, ability, options, context) => {
      const confirmation = maybeStartConfirmablePendingAbilityConfirmation(game, ability, options, {
        stepText: '确认后结算此效果。',
      });
      return (
        confirmation ??
        resolvePlacement(
          game,
          ability,
          options.orderedResolution === true,
          context.continuePendingCardEffects,
          deps.enqueueTriggeredCardEffects
        )
      );
    }
  );
}

function resolvePlacement(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForWaitingEnergyPlacement
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  const sourceValid = player !== null && isValidSource(game, player.id, ability.sourceCardId);
  const placement =
    sourceValid && player
      ? placeWaitingEnergyWithActivePhaseSkip(game, {
          count: 1,
          cause: {
            kind: 'CARD_EFFECT',
            playerId: player.id,
            sourceCardId: ability.sourceCardId,
            abilityId: ability.abilityId,
            pendingAbilityId: ability.id,
          },
          enqueueTriggeredCardEffects,
        })
      : null;
  const state = {
    ...(placement?.gameState ?? game),
    pendingAbilities: (placement?.gameState ?? game).pendingAbilities.filter(
      (candidate) => candidate.id !== ability.id
    ),
  };
  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', ability.controllerId, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: 'PLACE_WAITING_ENERGY_SKIP_NEXT_ACTIVE',
      sourceValid,
      placedEnergyCardIds: placement?.placedEnergyCardIds ?? [],
    }),
    orderedResolution
  );
}

function isValidSource(game: GameState, playerId: string, sourceCardId: string): boolean {
  const player = getPlayerById(game, playerId);
  const source = getCardById(game, sourceCardId);
  return (
    player !== null &&
    source !== null &&
    source.ownerId === playerId &&
    isLiveCardData(source.data) &&
    source.data.cardCode === CARD_CODE &&
    player.liveZone.cardIds.includes(sourceCardId)
  );
}
