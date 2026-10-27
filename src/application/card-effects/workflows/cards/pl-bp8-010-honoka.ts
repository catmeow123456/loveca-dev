import { isMemberCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
} from '../../../../domain/entities/game.js';
import { GamePhase, OrientationState } from '../../../../shared/types/enums.js';
import { cardCodeMatchesBase } from '../../../../shared/utils/card-code.js';
import { setMemberOrientation } from '../../../effects/member-state.js';
import { selectWaitingRoomCardIds } from '../../../effects/zone-selection.js';
import { PL_BP8_010_ACTIVATED_WAIT_SELF_BOTTOM_UP_TO_TWO_WAITING_CARDS_ABILITY_ID as ABILITY_ID } from '../../ability-ids.js';
import { getAbilitySourceLifecycleId } from '../../runtime/ability-source-lifecycle.js';
import { registerActivatedAbilityHandler } from '../../runtime/activated-registry.js';
import {
  enqueueMemberStateChangedTriggersFromOrientationResult,
  type EnqueueTriggeredCardEffectsForMemberStateChanged,
} from '../../runtime/member-state-changed-triggers.js';
import { wasRestoredAfterPublicCardSelectionConfirmation } from '../../runtime/public-card-selection-confirmation.js';
import { queryCardSelection } from '../../runtime/selection-query.js';
import { getSourceMemberSlot } from '../../runtime/source-member.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { moveWaitingRoomCardsToDeckBottomAndEnqueueTriggers } from '../../runtime/waiting-room-main-deck-triggers.js';
import {
  getAbilityEffectText,
  recordAbilityUseForContext,
} from '../../runtime/workflow-helpers.js';

const BASE_CARD_CODE = 'PL!-bp8-010';
const SELECT_STEP = 'PL_BP8_010_SELECT_UP_TO_TWO_WAITING_CARDS';
type Continue = (game: GameState, orderedResolution: boolean) => GameState;

export function registerPlBp8010HonokaWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForMemberStateChanged;
  readonly continuePendingCardEffects: Continue;
}): void {
  registerActivatedAbilityHandler(
    ABILITY_ID,
    (game, playerId, cardId) => start(game, playerId, cardId, deps),
    canActivate
  );
  registerActiveEffectStepHandler(
    ABILITY_ID,
    SELECT_STEP,
    (game, input, context) =>
      finish(
        game,
        input.selectedCardIds ?? (input.selectedCardId ? [input.selectedCardId] : []),
        context.continuePendingCardEffects
      ),
    queryCardSelection
  );
}

function candidates(game: GameState, playerId: string): readonly string[] {
  return selectWaitingRoomCardIds(game, playerId, () => true);
}

function canActivate(game: GameState, playerId: string, cardId: string): boolean {
  const player = getPlayerById(game, playerId);
  const card = getCardById(game, cardId);
  return (
    !game.activeEffect &&
    game.currentPhase === GamePhase.MAIN_PHASE &&
    game.players[game.activePlayerIndex]?.id === playerId &&
    !!player &&
    !!card &&
    card.ownerId === playerId &&
    isMemberCardData(card.data) &&
    cardCodeMatchesBase(card.data.cardCode, BASE_CARD_CODE) &&
    getSourceMemberSlot(game, playerId, cardId) !== null &&
    player.memberSlots.cardStates.get(cardId)?.orientation === OrientationState.ACTIVE
  );
}

function start(
  game: GameState,
  playerId: string,
  cardId: string,
  deps: {
    readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForMemberStateChanged;
    readonly continuePendingCardEffects: Continue;
  }
): GameState {
  if (!canActivate(game, playerId, cardId)) return game;
  const sourceLifecycleId = getAbilitySourceLifecycleId(game, ABILITY_ID, cardId);
  const wait = setMemberOrientation(game, playerId, cardId, OrientationState.WAITING, {
    kind: 'CARD_EFFECT',
    playerId,
    sourceCardId: cardId,
    abilityId: ABILITY_ID,
  });
  if (!wait || wait.previousOrientation !== OrientationState.ACTIVE) return game;
  const waiting = enqueueMemberStateChangedTriggersFromOrientationResult(
    game,
    wait,
    deps.enqueueTriggeredCardEffects,
    {
      prepareGameStateBeforeEnqueue: (state, result, events) =>
        addAction(state, 'PAY_COST', playerId, {
          abilityId: ABILITY_ID,
          sourceCardId: cardId,
          waitedMemberCardId: cardId,
          previousOrientation: result.previousOrientation,
          nextOrientation: result.nextOrientation,
          memberStateChangedEventIds: events.map((event) => event.eventId),
        }),
    }
  );
  const paid = recordAbilityUseForContext(waiting.gameState, playerId, {
    abilityId: ABILITY_ID,
    sourceCardId: cardId,
    sourceLifecycleId,
  });
  const ids = candidates(paid, playerId);
  if (ids.length === 0)
    return deps.continuePendingCardEffects(
      addAction(paid, 'RESOLVE_ABILITY', playerId, {
        abilityId: ABILITY_ID,
        sourceCardId: cardId,
        step: 'PAID_COST_NO_WAITING_CARDS',
        movedCardIds: [],
      }),
      false
    );
  return {
    ...paid,
    activeEffect: {
      id: `${ABILITY_ID}:${cardId}:action-${paid.actionSequence}`,
      abilityId: ABILITY_ID,
      sourceCardId: cardId,
      sourceLifecycleId,
      controllerId: playerId,
      effectText: getAbilityEffectText(ABILITY_ID),
      stepId: SELECT_STEP,
      stepText: '可以按放置顺序选择自己休息室中至多2张卡片放置于卡组底。',
      awaitingPlayerId: playerId,
      selectableCardIds: ids,
      selectableCardVisibility: 'PUBLIC',
      selectableCardMode: 'ORDERED_MULTI',
      minSelectableCards: 0,
      maxSelectableCards: Math.min(2, ids.length),
      selectionLabel: '按放置顺序选择至多2张卡片',
      confirmSelectionLabel: '按此顺序放置于卡组底',
      canSkipSelection: true,
      skipSelectionLabel: '不放置',
      metadata: {
        publicCardSelectionConfirmation: {
          source: 'WAITING_ROOM',
          destination: 'MAIN_DECK_BOTTOM',
          sourcePlayerId: playerId,
          ordered: true,
        },
      },
    },
  };
}

function finish(game: GameState, selected: readonly string[], next: Continue): GameState {
  const effect = game.activeEffect;
  if (!effect || effect.abilityId !== ABILITY_ID || effect.stepId !== SELECT_STEP) return game;
  if (
    selected.length > 2 ||
    new Set(selected).size !== selected.length ||
    selected.some((id) => !effect.selectableCardIds?.includes(id))
  )
    return game;
  const current = candidates(game, effect.controllerId);
  if (selected.some((id) => !current.includes(id)))
    return wasRestoredAfterPublicCardSelectionConfirmation(effect)
      ? next(
          addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', effect.controllerId, {
            abilityId: ABILITY_ID,
            sourceCardId: effect.sourceCardId,
            step: 'STALE_SELECTION_NO_MOVE',
            movedCardIds: [],
          }),
          false
        )
      : game;
  const movement = moveWaitingRoomCardsToDeckBottomAndEnqueueTriggers(
    game,
    effect.controllerId,
    selected,
    {
      candidateCardIds: current,
      minCount: 0,
      maxCount: 2,
      cause: {
        kind: 'CARD_EFFECT',
        playerId: effect.controllerId,
        sourceCardId: effect.sourceCardId,
        abilityId: ABILITY_ID,
      },
    }
  );
  if (!movement) return game;
  return next(
    addAction(
      { ...movement.gameState, activeEffect: null },
      'RESOLVE_ABILITY',
      effect.controllerId,
      {
        abilityId: ABILITY_ID,
        sourceCardId: effect.sourceCardId,
        step: 'BOTTOM_UP_TO_TWO_WAITING_CARDS',
        movedCardIds: movement.movedCardIds,
      }
    ),
    false
  );
}
