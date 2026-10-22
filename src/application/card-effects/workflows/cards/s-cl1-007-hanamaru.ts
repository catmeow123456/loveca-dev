import {
  addAction,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { addLiveModifier } from '../../../../domain/rules/live-modifiers.js';
import { S_CL1_007_LIVE_START_DISCARD_CHEER_FROM_BOTTOM_ABILITY_ID as ABILITY_ID } from '../../ability-ids.js';
import {
  createOptionalDiscardHandToWaitingRoomActiveEffect,
  finishSkippedActiveEffect,
  startPendingActiveEffect,
} from '../../runtime/active-effect.js';
import {
  discardOneHandCardToWaitingRoomAndEnqueueTriggers,
  type EnqueueTriggeredCardEffectsForEnterWaitingRoom,
} from '../../runtime/enter-waiting-room-triggers.js';
import { queryCardSelection } from '../../runtime/selection-query.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText, recordPayCostAction } from '../../runtime/workflow-helpers.js';

const STEP_ID = 'S_CL1_007_DISCARD_FOR_BOTTOM_CHEER';
type Continue = (game: GameState, ordered: boolean) => GameState;

export function registerSCl1007HanamaruWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom;
}): void {
  registerPendingAbilityStarterHandler(ABILITY_ID, (game, ability, options, context) =>
    start(game, ability, options.orderedResolution === true, context.continuePendingCardEffects)
  );
  registerActiveEffectStepHandler(
    ABILITY_ID,
    STEP_ID,
    (game, input, context) => {
      if (!input.selectedCardId)
        return finishSkippedActiveEffect(game, context.continuePendingCardEffects);
      const effect = game.activeEffect;
      if (!effect || effect.abilityId !== ABILITY_ID || effect.stepId !== STEP_ID) return game;
      const discard = discardOneHandCardToWaitingRoomAndEnqueueTriggers(
        game,
        effect.controllerId,
        input.selectedCardId,
        { candidateCardIds: effect.selectableCardIds ?? [] },
        deps.enqueueTriggeredCardEffects
      );
      if (!discard) return game;
      const paid = recordPayCostAction(discard.gameState, effect.controllerId, {
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        pendingAbilityId: effect.id,
        costType: 'DISCARD_HAND_TO_WAITING_ROOM',
        discardedCardIds: discard.discardedCardIds,
        enterWaitingRoomEventId: discard.enterWaitingRoomEvent?.eventId,
      });
      const state = addLiveModifier(paid, {
        kind: 'CHEER_DIRECTION',
        playerId: effect.controllerId,
        deckEdge: 'BOTTOM',
        sourceCardId: effect.sourceCardId,
        abilityId: ABILITY_ID,
      });
      return context.continuePendingCardEffects(
        addAction({ ...state, activeEffect: null }, 'RESOLVE_ABILITY', effect.controllerId, {
          pendingAbilityId: effect.id,
          abilityId: ABILITY_ID,
          sourceCardId: effect.sourceCardId,
          step: 'DISCARD_AND_CHEER_FROM_BOTTOM',
          discardedCardIds: discard.discardedCardIds,
        }),
        effect.metadata?.orderedResolution === true
      );
    },
    queryCardSelection
  );
}

function start(
  game: GameState,
  ability: PendingAbilityState,
  ordered: boolean,
  next: Continue
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) return game;
  if (player.hand.cardIds.length === 0)
    return next(
      addAction(
        {
          ...game,
          pendingAbilities: game.pendingAbilities.filter((item) => item.id !== ability.id),
        },
        'RESOLVE_ABILITY',
        player.id,
        {
          pendingAbilityId: ability.id,
          abilityId: ABILITY_ID,
          sourceCardId: ability.sourceCardId,
          step: 'NO_DISCARD_PAYMENT',
        }
      ),
      ordered
    );
  return startPendingActiveEffect(game, {
    ability,
    playerId: player.id,
    activeEffect: createOptionalDiscardHandToWaitingRoomActiveEffect({
      ability,
      playerId: player.id,
      effectText: getAbilityEffectText(ABILITY_ID),
      stepId: STEP_ID,
      selectableCardIds: player.hand.cardIds,
      orderedResolution: ordered,
    }),
    actionPayload: { sourceCardId: ability.sourceCardId, step: 'START_DISCARD_FOR_BOTTOM_CHEER' },
  });
}
