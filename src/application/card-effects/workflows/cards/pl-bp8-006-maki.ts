import { isMemberCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
} from '../../../../domain/entities/game.js';
import { CardType, GamePhase } from '../../../../shared/types/enums.js';
import { cardCodeMatchesBase } from '../../../../shared/utils/card-code.js';
import { and, groupAliasIs, typeIs } from '../../../effects/card-selectors.js';
import { payImmediateEffectCosts } from '../../../effects/effect-costs.js';
import { getEnergySelectionCandidates } from '../../../effects/energy-selection.js';
import {
  createWaitingRoomToHandEffectState,
  createWaitingRoomToHandSelectionConfig,
  selectWaitingRoomCardIds,
} from '../../../effects/zone-selection.js';
import { PL_BP8_006_ACTIVATED_WAITING_ROOM_PAY_TWO_BOTTOM_SELF_RECOVER_MUSE_LIVE_ABILITY_ID as ABILITY_ID } from '../../ability-ids.js';
import { registerActivatedAbilityHandler } from '../../runtime/activated-registry.js';
import { queryCardSelection } from '../../runtime/selection-query.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { moveWaitingRoomCardsToDeckBottomAndEnqueueTriggers } from '../../runtime/waiting-room-main-deck-triggers.js';
import {
  getAbilityEffectText,
  recordAbilityUseForContext,
  recordPayCostAction,
} from '../../runtime/workflow-helpers.js';
import { finishWaitingRoomToHandWorkflow } from '../shared/waiting-room-to-hand.js';

const BASE_CARD_CODE = 'PL!-bp8-006';
const RECOVER_STEP = 'PL_BP8_006_SELECT_MUSE_LIVE_TO_HAND';
const MUSE_LIVE = and(typeIs(CardType.LIVE), groupAliasIs('μ’s'));
type Continue = (game: GameState, orderedResolution: boolean) => GameState;

export function registerPlBp8006MakiWorkflowHandlers(deps: {
  readonly continuePendingCardEffects: Continue;
}): void {
  registerActivatedAbilityHandler(
    ABILITY_ID,
    (game, playerId, cardId) => start(game, playerId, cardId, deps.continuePendingCardEffects),
    canActivate
  );
  registerActiveEffectStepHandler(
    ABILITY_ID,
    RECOVER_STEP,
    (game, input, context) =>
      finishWaitingRoomToHandWorkflow(
        game,
        input.selectedCardId ?? null,
        input.selectedCardIds,
        context.continuePendingCardEffects,
        {
          currentCandidateCardIds: selectWaitingRoomCardIds(
            game,
            game.activeEffect!.controllerId,
            MUSE_LIVE
          ),
        }
      ),
    queryCardSelection
  );
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
    player.waitingRoom.cardIds.includes(cardId) &&
    getEnergySelectionCandidates(game, playerId, 'TAP_ACTIVE_ENERGY').length >= 2
  );
}

function start(game: GameState, playerId: string, cardId: string, next: Continue): GameState {
  if (!canActivate(game, playerId, cardId)) return game;
  const payment = payImmediateEffectCosts(game, playerId, cardId, [
    { kind: 'TAP_ACTIVE_ENERGY', count: 2 },
  ]);
  if (!payment) return game;
  const movement = moveWaitingRoomCardsToDeckBottomAndEnqueueTriggers(
    payment.gameState,
    playerId,
    [cardId],
    {
      candidateCardIds: [cardId],
      minCount: 1,
      maxCount: 1,
      cause: { kind: 'CARD_EFFECT', playerId, sourceCardId: cardId, abilityId: ABILITY_ID },
    }
  );
  if (!movement) return game;
  const paid = recordAbilityUseForContext(
    recordPayCostAction(movement.gameState, playerId, {
      abilityId: ABILITY_ID,
      sourceCardId: cardId,
      energyCardIds: payment.paidEnergyCardIds,
      amount: payment.paidEnergyCardIds.length,
      movedCardIds: movement.movedCardIds,
      destination: 'MAIN_DECK_BOTTOM',
      waitingRoomCardsMovedToMainDeckEventId:
        movement.waitingRoomCardsMovedToMainDeckEvent?.eventId,
    }),
    playerId,
    { abilityId: ABILITY_ID, sourceCardId: cardId }
  );
  const candidates = selectWaitingRoomCardIds(paid, playerId, MUSE_LIVE);
  if (candidates.length === 0)
    return next(
      addAction(paid, 'RESOLVE_ABILITY', playerId, {
        abilityId: ABILITY_ID,
        sourceCardId: cardId,
        step: 'PAID_COST_NO_MUSE_LIVE',
        recoveredCardIds: [],
      }),
      false
    );
  return {
    ...paid,
    activeEffect: createWaitingRoomToHandEffectState({
      id: `${ABILITY_ID}:${cardId}:action-${paid.actionSequence}`,
      abilityId: ABILITY_ID,
      sourceCardId: cardId,
      controllerId: playerId,
      effectText: getAbilityEffectText(ABILITY_ID),
      stepId: RECOVER_STEP,
      stepText: '请选择自己休息室中1张『μ’s』的LIVE卡加入手牌。',
      awaitingPlayerId: playerId,
      selectableCardIds: candidates,
      selectionLabel: '选择要加入手牌的『μ’s』LIVE卡',
      confirmSelectionLabel: '加入手牌',
      canSkipSelection: false,
      zoneSelection: createWaitingRoomToHandSelectionConfig({
        minCount: 1,
        maxCount: 1,
        optional: false,
      }),
    }),
  };
}
