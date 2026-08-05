import { isMemberCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { GamePhase, OrientationState } from '../../../../shared/types/enums.js';
import {
  SP_BP7_008_ACTIVATED_WAIT_SELF_DRAW_ONE_ABILITY_ID,
  SP_BP7_008_AUTO_ON_MOVE_ACTIVATE_SELF_ABILITY_ID,
} from '../../ability-ids.js';
import { drawCardsForPlayer } from '../../runtime/actions.js';
import { registerActivatedAbilityHandler } from '../../runtime/activated-registry.js';
import { isDirectOrRenGrantedActivatedAbilitySource } from '../../runtime/granted-activated-abilities.js';
import {
  enqueueMemberStateChangedTriggersFromOrientationResult,
  type EnqueueTriggeredCardEffectsForMemberStateChanged,
} from '../../runtime/member-state-changed-triggers.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { getSourceMemberSlot } from '../../runtime/source-member.js';
import {
  maybeStartConfirmablePendingAbilityConfirmation,
  recordAbilityUseForContext,
  recordPayCostAction,
} from '../../runtime/workflow-helpers.js';
import { setMemberOrientation } from '../../../effects/member-state.js';

const BASE_CARD_CODE = 'PL!SP-bp7-008';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerSpBp7008ShikiWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForMemberStateChanged;
}): void {
  registerActivatedAbilityHandler(
    SP_BP7_008_ACTIVATED_WAIT_SELF_DRAW_ONE_ABILITY_ID,
    (game, playerId, cardId) => activateWaitSelfDrawOne(game, playerId, cardId, deps)
  );
  registerPendingAbilityStarterHandler(
    SP_BP7_008_AUTO_ON_MOVE_ACTIVATE_SELF_ABILITY_ID,
    (game, ability, options, context) => {
      const confirmation = maybeStartConfirmablePendingAbilityConfirmation(game, ability, options);
      return (
        confirmation ??
        resolveOnMoveActivateSelf(
          game,
          ability,
          options.orderedResolution === true,
          context.continuePendingCardEffects,
          deps
        )
      );
    }
  );
}

function activateWaitSelfDrawOne(
  game: GameState,
  playerId: string,
  cardId: string,
  deps: {
    readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForMemberStateChanged;
  }
): GameState {
  const player = getPlayerById(game, playerId);
  const card = getCardById(game, cardId);
  const sourceSlot = getSourceMemberSlot(game, playerId, cardId);
  const sourceState = player?.memberSlots.cardStates.get(cardId);
  if (
    game.activeEffect ||
    game.currentPhase !== GamePhase.MAIN_PHASE ||
    game.players[game.activePlayerIndex]?.id !== playerId ||
    !player ||
    !card ||
    card.ownerId !== playerId ||
    !isMemberCardData(card.data) ||
    !isDirectOrRenGrantedActivatedAbilitySource(
      game,
      playerId,
      cardId,
      SP_BP7_008_ACTIVATED_WAIT_SELF_DRAW_ONE_ABILITY_ID,
      [BASE_CARD_CODE]
    ) ||
    sourceSlot === null ||
    sourceState?.orientation !== OrientationState.ACTIVE
  ) {
    return game;
  }

  const waitResult = setMemberOrientation(game, playerId, cardId, OrientationState.WAITING, {
    kind: 'CARD_EFFECT',
    playerId,
    sourceCardId: cardId,
    abilityId: SP_BP7_008_ACTIVATED_WAIT_SELF_DRAW_ONE_ABILITY_ID,
  });
  if (!waitResult?.changed) {
    return game;
  }

  const withStateTriggers = enqueueMemberStateChangedTriggersFromOrientationResult(
    game,
    waitResult,
    deps.enqueueTriggeredCardEffects,
    {
      prepareGameStateBeforeEnqueue: (state, result, events) =>
        recordPayCostAction(state, playerId, {
          abilityId: SP_BP7_008_ACTIVATED_WAIT_SELF_DRAW_ONE_ABILITY_ID,
          sourceCardId: cardId,
          sourceSlot,
          waitedMemberCardId: cardId,
          previousOrientation: result.previousOrientation,
          nextOrientation: result.nextOrientation,
          memberStateChangedEventIds: events.map((event) => event.eventId),
        }),
    }
  );
  const stateAfterUse = recordAbilityUseForContext(withStateTriggers.gameState, playerId, {
    abilityId: SP_BP7_008_ACTIVATED_WAIT_SELF_DRAW_ONE_ABILITY_ID,
    sourceCardId: cardId,
  });
  const drawResult = drawCardsForPlayer(stateAfterUse, playerId, 1);
  return addAction(drawResult?.gameState ?? stateAfterUse, 'RESOLVE_ABILITY', playerId, {
    abilityId: SP_BP7_008_ACTIVATED_WAIT_SELF_DRAW_ONE_ABILITY_ID,
    sourceCardId: cardId,
    sourceSlot,
    step: 'WAIT_SELF_DRAW_ONE',
    drawnCardIds: drawResult?.drawnCardIds ?? [],
  });
}

function resolveOnMoveActivateSelf(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects,
  deps: {
    readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForMemberStateChanged;
  }
): GameState {
  const stateWithoutPending: GameState = {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
  };
  const player = getPlayerById(stateWithoutPending, ability.controllerId);
  const sourceSlot = player
    ? getSourceMemberSlot(stateWithoutPending, player.id, ability.sourceCardId)
    : null;
  const sourceState = player?.memberSlots.cardStates.get(ability.sourceCardId);
  if (!player || sourceSlot === null || sourceState?.orientation !== OrientationState.WAITING) {
    return continuePendingCardEffects(
      addResolutionRecord(stateWithoutPending, ability, 'NO_OP_SOURCE_NOT_WAITING_ON_STAGE'),
      orderedResolution
    );
  }

  const activeResult = setMemberOrientation(
    stateWithoutPending,
    player.id,
    ability.sourceCardId,
    OrientationState.ACTIVE,
    {
      kind: 'CARD_EFFECT',
      playerId: player.id,
      sourceCardId: ability.sourceCardId,
      abilityId: ability.abilityId,
      pendingAbilityId: ability.id,
    }
  );
  if (!activeResult?.changed) {
    return continuePendingCardEffects(
      addResolutionRecord(stateWithoutPending, ability, 'NO_OP_ACTIVATION_BLOCKED'),
      orderedResolution
    );
  }

  const withStateTriggers = enqueueMemberStateChangedTriggersFromOrientationResult(
    stateWithoutPending,
    activeResult,
    deps.enqueueTriggeredCardEffects,
    {
      prepareGameStateBeforeEnqueue: (state) =>
        addResolutionRecord(state, ability, 'ACTIVATE_SELF_AFTER_MOVE'),
    }
  );
  return continuePendingCardEffects(withStateTriggers.gameState, orderedResolution);
}

function addResolutionRecord(
  game: GameState,
  ability: PendingAbilityState,
  step: string
): GameState {
  return addAction(
    recordAbilityUseForContext(game, ability.controllerId, {
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      pendingAbilityId: ability.id,
    }),
    'RESOLVE_ABILITY',
    ability.controllerId,
    {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      sourceSlot: ability.sourceSlot,
      step,
      fromSlot: ability.metadata?.fromSlot,
      toSlot: ability.metadata?.toSlot,
      orientationAtMove: ability.metadata?.orientationAtMove,
    }
  );
}
