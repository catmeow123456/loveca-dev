import { isMemberCardData } from '../../../../domain/entities/card.js';
import { addAction, getCardById, type GameState } from '../../../../domain/entities/game.js';
import { addMemberCostLiveModifierForMember } from '../../../../domain/rules/live-modifiers.js';
import { CardType, GamePhase } from '../../../../shared/types/enums.js';
import { cardCodeMatchesBase } from '../../../../shared/utils/card-code.js';
import { and, groupAliasIs, hasBladeHeart, not, typeIs } from '../../../effects/card-selectors.js';
import { selectWaitingRoomCardIds } from '../../../effects/zone-selection.js';
import { PL_BP8_004_ACTIVATED_BOTTOM_TWO_NO_BLADE_HEART_MUSE_GAIN_COST_ABILITY_ID as ABILITY_ID } from '../../ability-ids.js';
import { getAbilitySourceLifecycleId } from '../../runtime/ability-source-lifecycle.js';
import { registerActivatedAbilityHandler } from '../../runtime/activated-registry.js';
import { wasRestoredAfterPublicCardSelectionConfirmation } from '../../runtime/public-card-selection-confirmation.js';
import { queryCardSelection } from '../../runtime/selection-query.js';
import {
  getSourceMemberSlot,
  isCurrentStageMemberAbilitySource,
} from '../../runtime/source-member.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { moveWaitingRoomCardsToDeckBottomAndEnqueueTriggers } from '../../runtime/waiting-room-main-deck-triggers.js';
import {
  getAbilityEffectText,
  recordAbilityUseForContext,
  recordPayCostAction,
} from '../../runtime/workflow-helpers.js';

const BASE_CARD_CODE = 'PL!-bp8-004';
const SELECT_STEP = 'PL_BP8_004_SELECT_TWO_NO_BLADE_HEART_MUSE_MEMBERS';
const PAYMENT_SELECTOR = and(typeIs(CardType.MEMBER), groupAliasIs('μ’s'), not(hasBladeHeart()));
type Continue = (game: GameState, orderedResolution: boolean) => GameState;

export function registerPlBp8004UmiWorkflowHandlers(): void {
  registerActivatedAbilityHandler(ABILITY_ID, start, canActivate);
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
  return selectWaitingRoomCardIds(game, playerId, PAYMENT_SELECTOR);
}

function canActivate(game: GameState, playerId: string, cardId: string): boolean {
  const card = getCardById(game, cardId);
  return (
    !game.activeEffect &&
    game.currentPhase === GamePhase.MAIN_PHASE &&
    game.players[game.activePlayerIndex]?.id === playerId &&
    !!card &&
    card.ownerId === playerId &&
    isMemberCardData(card.data) &&
    cardCodeMatchesBase(card.data.cardCode, BASE_CARD_CODE) &&
    getSourceMemberSlot(game, playerId, cardId) !== null &&
    candidates(game, playerId).length >= 2
  );
}

function start(game: GameState, playerId: string, cardId: string): GameState {
  if (!canActivate(game, playerId, cardId)) return game;
  return {
    ...game,
    activeEffect: {
      id: `${ABILITY_ID}:${cardId}:action-${game.actionSequence}`,
      abilityId: ABILITY_ID,
      sourceCardId: cardId,
      sourceLifecycleId: getAbilitySourceLifecycleId(game, ABILITY_ID, cardId),
      controllerId: playerId,
      effectText: getAbilityEffectText(ABILITY_ID),
      stepId: SELECT_STEP,
      stepText:
        '按放置顺序选择自己休息室中2张不持有BLADE HEART的『μ’s』成员卡，放置于卡组底以支付费用。',
      awaitingPlayerId: playerId,
      selectableCardIds: candidates(game, playerId),
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
  if (selected.length === 0) return next({ ...game, activeEffect: null }, false);
  if (
    selected.length !== 2 ||
    new Set(selected).size !== 2 ||
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
            step: 'STALE_PAYMENT_NO_MOVE',
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
      minCount: 2,
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
  let state = recordAbilityUseForContext(
    recordPayCostAction(movement.gameState, effect.controllerId, {
      abilityId: ABILITY_ID,
      sourceCardId: effect.sourceCardId,
      movedCardIds: movement.movedCardIds,
      destination: 'MAIN_DECK_BOTTOM',
      waitingRoomCardsMovedToMainDeckEventId:
        movement.waitingRoomCardsMovedToMainDeckEvent?.eventId,
    }),
    effect.controllerId,
    {
      abilityId: ABILITY_ID,
      sourceCardId: effect.sourceCardId,
      sourceLifecycleId: effect.sourceLifecycleId,
    }
  );
  const reward = isCurrentStageMemberAbilitySource(state, effect)
    ? addMemberCostLiveModifierForMember(state, {
        playerId: effect.controllerId,
        memberCardId: effect.sourceCardId,
        sourceCardId: effect.sourceCardId,
        abilityId: ABILITY_ID,
        countDelta: 2,
      })
    : null;
  state = reward?.gameState ?? state;
  return next(
    addAction({ ...state, activeEffect: null }, 'RESOLVE_ABILITY', effect.controllerId, {
      abilityId: ABILITY_ID,
      sourceCardId: effect.sourceCardId,
      step: 'BOTTOM_TWO_MEMBERS_GAIN_COST',
      movedCardIds: movement.movedCardIds,
      costDelta: reward?.costDelta ?? 0,
    }),
    false
  );
}
