import {
  addAction,
  type ActiveEffectState,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { CardType } from '../../../../shared/types/enums.js';
import { and, groupAliasIs, hasBladeHeart, not, typeIs } from '../../../effects/card-selectors.js';
import { selectWaitingRoomCardIds } from '../../../effects/zone-selection.js';
import { PL_BP8_014_ON_ENTER_BOTTOM_TWO_NO_BLADE_HEART_MUSE_DRAW_ONE_ABILITY_ID as ABILITY_ID } from '../../ability-ids.js';
import { startPendingActiveEffect } from '../../runtime/active-effect.js';
import { drawCardsForPlayer } from '../../runtime/actions.js';
import { getPendingAbilitySourceLifecycleId } from '../../runtime/ability-source-lifecycle.js';
import { readExclusiveCardSelectionInput } from '../../runtime/grouped-selection.js';
import { isAbilityActivationCostWaived } from '../../runtime/on-enter-ability-invocation.js';
import { wasRestoredAfterPublicCardSelectionConfirmation } from '../../runtime/public-card-selection-confirmation.js';
import { queryCardSelection } from '../../runtime/selection-query.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { moveWaitingRoomCardsToDeckBottomAndEnqueueTriggers } from '../../runtime/waiting-room-main-deck-triggers.js';
import { getAbilityEffectText, recordPayCostAction } from '../../runtime/workflow-helpers.js';

const SELECT_STEP = 'PL_BP8_014_SELECT_TWO_NO_BLADE_HEART_MUSE_MEMBERS';
const PAYMENT_SELECTOR = and(typeIs(CardType.MEMBER), groupAliasIs('μ’s'), not(hasBladeHeart()));
type Continue = (game: GameState, orderedResolution: boolean) => GameState;

export function registerPlBp8014RinWorkflowHandlers(): void {
  registerPendingAbilityStarterHandler(ABILITY_ID, (game, ability, options, context) =>
    start(game, ability, options.orderedResolution === true, context.continuePendingCardEffects)
  );
  registerActiveEffectStepHandler(
    ABILITY_ID,
    SELECT_STEP,
    (game, input, context) => {
      const selected = readExclusiveCardSelectionInput(input);
      return selected === null ? game : finish(game, selected, context.continuePendingCardEffects);
    },
    queryCardSelection
  );
}

function candidates(game: GameState, playerId: string): readonly string[] {
  return selectWaitingRoomCardIds(game, playerId, PAYMENT_SELECTOR);
}

function start(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  next: Continue
): GameState {
  const stateWithoutPending = {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((pending) => pending.id !== ability.id),
  };
  if (isAbilityActivationCostWaived(ability)) {
    return drawAndContinue(stateWithoutPending, ability, [], orderedResolution, next);
  }
  const selectableCardIds = candidates(game, ability.controllerId);
  if (selectableCardIds.length < 2) {
    return next(
      addAction(stateWithoutPending, 'RESOLVE_ABILITY', ability.controllerId, {
        pendingAbilityId: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        step: 'INSUFFICIENT_WAITING_MEMBERS',
        movedCardIds: [],
        drawnCardIds: [],
      }),
      orderedResolution
    );
  }
  return startPendingActiveEffect(game, {
    ability,
    playerId: ability.controllerId,
    activeEffect: {
      id: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      sourceLifecycleId: getPendingAbilitySourceLifecycleId(game, ability),
      controllerId: ability.controllerId,
      effectText: getAbilityEffectText(ability.abilityId),
      stepId: SELECT_STEP,
      stepText:
        '可以按放置顺序选择自己休息室中2张不持有BLADE HEART的『μ’s』成员卡，放置于卡组底以支付费用。',
      awaitingPlayerId: ability.controllerId,
      selectableCardIds,
      selectableCardVisibility: 'PUBLIC',
      selectableCardMode: 'ORDERED_MULTI',
      minSelectableCards: 2,
      maxSelectableCards: 2,
      selectionLabel: '按放置顺序选择2张『μ’s』成员卡',
      confirmSelectionLabel: '按此顺序放置于卡组底',
      canSkipSelection: true,
      skipSelectionLabel: '不发动',
      metadata: {
        publicCardSelectionConfirmation: {
          source: 'WAITING_ROOM',
          destination: 'MAIN_DECK_BOTTOM',
          sourcePlayerId: ability.controllerId,
          ordered: true,
        },
        orderedResolution,
      },
    },
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      step: 'START_SELECT_TWO_NO_BLADE_HEART_MUSE_MEMBERS',
      selectableCardIds,
    },
  });
}

function finish(game: GameState, selected: readonly string[], next: Continue): GameState {
  const effect = game.activeEffect;
  if (!effect || effect.abilityId !== ABILITY_ID || effect.stepId !== SELECT_STEP) return game;
  if (selected.length === 0) return finishWithoutPayment(game, effect, 'DECLINED', next);
  if (
    selected.length !== 2 ||
    new Set(selected).size !== 2 ||
    selected.some((id) => !effect.selectableCardIds?.includes(id))
  ) {
    return game;
  }
  const currentCandidates = candidates(game, effect.controllerId);
  if (selected.some((id) => !currentCandidates.includes(id))) {
    return wasRestoredAfterPublicCardSelectionConfirmation(effect)
      ? finishWithoutPayment(game, effect, 'STALE_PAYMENT_NO_MOVE', next)
      : game;
  }
  const movement = moveWaitingRoomCardsToDeckBottomAndEnqueueTriggers(
    { ...game, activeEffect: null },
    effect.controllerId,
    selected,
    {
      candidateCardIds: currentCandidates,
      minCount: 2,
      maxCount: 2,
      cause: {
        kind: 'CARD_EFFECT',
        playerId: effect.controllerId,
        sourceCardId: effect.sourceCardId,
        abilityId: effect.abilityId,
        pendingAbilityId: effect.id,
      },
    }
  );
  if (!movement) return game;
  const paidState = recordPayCostAction(movement.gameState, effect.controllerId, {
    abilityId: effect.abilityId,
    sourceCardId: effect.sourceCardId,
    pendingAbilityId: effect.id,
    costType: 'MOVE_WAITING_ROOM_MEMBERS_TO_DECK_BOTTOM',
    movedCardIds: movement.movedCardIds,
    waitingRoomCardsMovedToMainDeckEventId: movement.waitingRoomCardsMovedToMainDeckEvent?.eventId,
  });
  return drawAndContinue(
    paidState,
    effect,
    movement.movedCardIds,
    effect.metadata?.orderedResolution === true,
    next
  );
}

function drawAndContinue(
  game: GameState,
  source: Pick<PendingAbilityState, 'id' | 'abilityId' | 'sourceCardId' | 'controllerId'>,
  movedCardIds: readonly string[],
  orderedResolution: boolean,
  next: Continue
): GameState {
  const drawn = drawCardsForPlayer(game, source.controllerId, 1);
  return next(
    addAction(drawn?.gameState ?? game, 'RESOLVE_ABILITY', source.controllerId, {
      pendingAbilityId: source.id,
      abilityId: source.abilityId,
      sourceCardId: source.sourceCardId,
      step: 'BOTTOM_TWO_MEMBERS_DRAW_ONE',
      movedCardIds,
      drawnCardIds: drawn?.drawnCardIds ?? [],
    }),
    orderedResolution
  );
}

function finishWithoutPayment(
  game: GameState,
  effect: ActiveEffectState,
  step: string,
  next: Continue
): GameState {
  return next(
    addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', effect.controllerId, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step,
      movedCardIds: [],
      drawnCardIds: [],
    }),
    effect.metadata?.orderedResolution === true
  );
}
