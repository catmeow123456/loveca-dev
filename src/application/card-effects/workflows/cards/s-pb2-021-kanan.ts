import { isMemberCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardActiveEffect,
  getCardById,
  getPlayerById,
  type GameState,
} from '../../../../domain/entities/game.js';
import { replaceLiveModifier } from '../../../../domain/rules/live-modifiers.js';
import { GamePhase, HeartColor } from '../../../../shared/types/enums.js';
import { cardCodeMatchesBase } from '../../../../shared/utils/card-code.js';
import { S_PB2_021_ACTIVATED_DISCARD_REPLACE_ORIGINAL_HEARTS_GREEN_ABILITY_ID as ABILITY } from '../../ability-ids.js';
import { getStageMemberLifecycleId } from '../../runtime/ability-source-lifecycle.js';
import {
  createOptionalDiscardHandToWaitingRoomActiveEffect,
  finishSkippedActiveEffect,
} from '../../runtime/active-effect.js';
import { registerActivatedAbilityHandler } from '../../runtime/activated-registry.js';
import {
  discardOneHandCardToWaitingRoomAndEnqueueTriggers,
  type EnqueueTriggeredCardEffectsForEnterWaitingRoom,
} from '../../runtime/enter-waiting-room-triggers.js';
import { queryCardSelection } from '../../runtime/selection-query.js';
import { isCurrentStageMemberAbilitySource } from '../../runtime/source-member.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import {
  getAbilityEffectText,
  recordAbilityUseForContext,
  recordPayCostAction,
} from '../../runtime/workflow-helpers.js';

const SELECT_DISCARD = 'S_PB2_021_SELECT_DISCARD_FOR_ORIGINAL_GREEN_HEARTS';

export function registerSPb2021KananWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom;
}): void {
  registerActivatedAbilityHandler(
    ABILITY,
    (game, playerId, sourceCardId) => {
      const player = getPlayerById(game, playerId);
      if (!player || !canStart(game, playerId, sourceCardId)) return game;
      const effect = createOptionalDiscardHandToWaitingRoomActiveEffect({
        ability: {
          id: `${ABILITY}:${sourceCardId}:turn-${game.turnCount}:action-${game.actionSequence}`,
          abilityId: ABILITY,
          sourceCardId,
          controllerId: playerId,
        },
        playerId,
        effectText: getAbilityEffectText(ABILITY),
        stepId: SELECT_DISCARD,
        selectableCardIds: player.hand.cardIds,
        orderedResolution: false,
      });
      return {
        ...game,
        activeEffect: {
          ...effect,
          sourceLifecycleId: getStageMemberLifecycleId(game, sourceCardId),
        },
      };
    },
    canStart
  );

  registerActiveEffectStepHandler(
    ABILITY,
    SELECT_DISCARD,
    (game, input, context) => {
      const effect = getCardActiveEffect(game);
      if (!effect) return game;
      if (input.selectedCardId == null)
        return finishSkippedActiveEffect(game, context.continuePendingCardEffects);
      if (!isCurrentStageMemberAbilitySource(game, effect)) {
        return finishSkippedActiveEffect(game, context.continuePendingCardEffects, {
          step: 'SOURCE_NO_LONGER_CURRENT',
        });
      }
      const discarded = discardOneHandCardToWaitingRoomAndEnqueueTriggers(
        game,
        effect.controllerId,
        input.selectedCardId,
        { candidateCardIds: effect.selectableCardIds ?? [] },
        deps.enqueueTriggeredCardEffects
      );
      if (!discarded) return game;

      const paid = recordPayCostAction(discarded.gameState, effect.controllerId, {
        pendingAbilityId: effect.id,
        abilityId: ABILITY,
        sourceCardId: effect.sourceCardId,
        discardedCardIds: discarded.discardedCardIds,
        enterWaitingRoomEventId: discarded.enterWaitingRoomEvent?.eventId,
      });
      const used = recordAbilityUseForContext(paid, effect.controllerId, {
        pendingAbilityId: effect.id,
        abilityId: ABILITY,
        sourceCardId: effect.sourceCardId,
        sourceLifecycleId: effect.sourceLifecycleId,
      });
      const marker = {
        kind: 'MEMBER_ORIGINAL_HEART_REPLACEMENT' as const,
        playerId: effect.controllerId,
        sourceCardId: effect.sourceCardId,
        abilityId: ABILITY,
      };
      const state = replaceLiveModifier({ ...used, activeEffect: null }, marker, {
        ...marker,
        memberCardId: effect.sourceCardId,
        color: HeartColor.GREEN,
      });
      return context.continuePendingCardEffects(
        addAction(state, 'RESOLVE_ABILITY', effect.controllerId, {
          pendingAbilityId: effect.id,
          abilityId: ABILITY,
          sourceCardId: effect.sourceCardId,
          step: 'DISCARD_REPLACE_ORIGINAL_HEARTS_GREEN',
          heartColor: HeartColor.GREEN,
          discardedCardIds: discarded.discardedCardIds,
        }),
        false
      );
    },
    queryCardSelection
  );
}

function canStart(game: GameState, playerId: string, sourceCardId: string): boolean {
  const player = getPlayerById(game, playerId);
  const card = getCardById(game, sourceCardId);
  return (
    game.activeEffect === null &&
    game.currentPhase === GamePhase.MAIN_PHASE &&
    game.players[game.activePlayerIndex]?.id === playerId &&
    player !== null &&
    player.hand.cardIds.length > 0 &&
    card !== null &&
    card.ownerId === playerId &&
    isMemberCardData(card.data) &&
    cardCodeMatchesBase(card.data.cardCode, 'PL!S-pb2-021') &&
    isCurrentStageMemberAbilitySource(game, { controllerId: playerId, sourceCardId })
  );
}
