import { isLiveCardData, isMemberCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getOpponent,
  getPlayerById,
  type GameState,
} from '../../../../domain/entities/game.js';
import { GamePhase, ZoneType } from '../../../../shared/types/enums.js';
import { cardCodeMatchesBase } from '../../../../shared/utils/card-code.js';
import { payImmediateEffectCosts } from '../../../effects/effect-costs.js';
import { S_BP3_007_ACTIVATED_PAY_ENERGY_BOTTOM_WAITING_LIVE_DRAW_ABILITY_ID as ABILITY } from '../../ability-ids.js';
import {
  drawCardsForPlayer,
  moveWaitingRoomCardsToDeckBottomForPlayer,
} from '../../runtime/actions.js';
import { registerActivatedAbilityHandler } from '../../runtime/activated-registry.js';
import { wasRestoredAfterPublicCardSelectionConfirmation } from '../../runtime/public-card-selection-confirmation.js';
import { getSourceMemberSlot } from '../../runtime/source-member.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import {
  getAbilityEffectText,
  recordAbilityUseForContext,
  recordPayCostAction,
} from '../../runtime/workflow-helpers.js';

const SELECT_PLAYER = 'S_BP3_007_SELECT_PLAYER';
const SELECT_LIVE = 'S_BP3_007_SELECT_WAITING_LIVE';

export function registerSBp3007HanamaruWorkflowHandlers(): void {
  registerActivatedAbilityHandler(ABILITY, start);
  registerActiveEffectStepHandler(ABILITY, SELECT_PLAYER, (game, input) =>
    choosePlayer(game, input.selectedOptionId ?? null)
  );
  registerActiveEffectStepHandler(ABILITY, SELECT_LIVE, (game, input, context) =>
    finish(game, input.selectedCardId ?? null, context.continuePendingCardEffects)
  );
}

function start(game: GameState, playerId: string, sourceCardId: string): GameState {
  if (
    game.activeEffect ||
    game.currentPhase !== GamePhase.MAIN_PHASE ||
    game.players[game.activePlayerIndex]?.id !== playerId
  )
    return game;
  const player = getPlayerById(game, playerId);
  const opponent = getOpponent(game, playerId);
  const source = getCardById(game, sourceCardId);
  if (
    !player ||
    !opponent ||
    !source ||
    source.ownerId !== playerId ||
    !isMemberCardData(source.data) ||
    !cardCodeMatchesBase(source.data.cardCode, 'PL!S-bp3-007') ||
    getSourceMemberSlot(game, playerId, sourceCardId) === null
  )
    return game;
  const payment = payImmediateEffectCosts(game, playerId, sourceCardId, [
    { kind: 'TAP_ACTIVE_ENERGY', count: 1 },
  ]);
  if (!payment) return game;
  let state = recordPayCostAction(payment.gameState, playerId, {
    abilityId: ABILITY,
    sourceCardId,
    energyCardIds: payment.paidEnergyCardIds,
    amount: 1,
  });
  state = recordAbilityUseForContext(state, playerId, { abilityId: ABILITY, sourceCardId });
  return {
    ...state,
    activeEffect: {
      id: `${ABILITY}:${sourceCardId}:turn-${state.turnCount}:action-${state.actionHistory.length}`,
      abilityId: ABILITY,
      sourceCardId,
      controllerId: playerId,
      effectText: getAbilityEffectText(ABILITY),
      stepId: SELECT_PLAYER,
      stepText: '请选择要处理休息室的玩家。',
      awaitingPlayerId: playerId,
      selectableCardIds: [],
      selectableCardVisibility: 'PUBLIC',
      selectableOptions: [
        { id: playerId, label: '自己' },
        { id: opponent.id, label: '对方' },
      ],
      canSkipSelection: false,
    },
  };
}

function choosePlayer(game: GameState, targetPlayerId: string | null): GameState {
  const effect = game.activeEffect;
  const controller = effect ? getPlayerById(game, effect.controllerId) : null;
  const opponent = controller ? getOpponent(game, controller.id) : null;
  if (
    !effect ||
    effect.abilityId !== ABILITY ||
    effect.stepId !== SELECT_PLAYER ||
    !controller ||
    (targetPlayerId !== controller.id && targetPlayerId !== opponent?.id)
  )
    return game;
  const target = getPlayerById(game, targetPlayerId);
  if (!target) return game;
  const candidates = target.waitingRoom.cardIds.filter((id) => {
    const card = getCardById(game, id);
    return card !== null && isLiveCardData(card.data);
  });
  if (candidates.length === 0)
    return addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', controller.id, {
      abilityId: ABILITY,
      sourceCardId: effect.sourceCardId,
      step: 'NO_LIVE_TARGET',
      targetPlayerId,
      movedCardIds: [],
      drawnCardIds: [],
    });
  return {
    ...game,
    activeEffect: {
      ...effect,
      stepId: SELECT_LIVE,
      stepText: '请选择1张LIVE卡放置于该玩家的卡组底。',
      selectableOptions: undefined,
      selectableCardIds: candidates,
      selectableCardVisibility: 'PUBLIC',
      selectableCardMode: 'SINGLE',
      minSelectableCards: 1,
      maxSelectableCards: 1,
      selectionLabel: '选择要放置于卡组底的LIVE卡',
      confirmSelectionLabel: '放置于卡组底',
      canSkipSelection: false,
      metadata: {
        targetPlayerId,
        candidateCardIds: candidates,
        publicCardSelectionConfirmation: {
          destination: 'MAIN_DECK_BOTTOM',
          sourcePlayerId: targetPlayerId,
        },
      },
    },
  };
}

function finish(
  game: GameState,
  selectedCardId: string | null,
  continuePendingCardEffects: (game: GameState, orderedResolution: boolean) => GameState
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== ABILITY ||
    effect.stepId !== SELECT_LIVE ||
    !selectedCardId ||
    typeof effect.metadata?.targetPlayerId !== 'string' ||
    !Array.isArray(effect.metadata.candidateCardIds)
  )
    return game;
  const candidates = effect.metadata.candidateCardIds.filter(
    (id): id is string => typeof id === 'string'
  );
  const moved = moveWaitingRoomCardsToDeckBottomForPlayer(
    { ...game, activeEffect: null },
    effect.metadata.targetPlayerId,
    [selectedCardId],
    { candidateCardIds: candidates, minCount: 1, maxCount: 1 }
  );
  if (!moved || moved.movedCardIds.length !== 1) {
    if (!wasRestoredAfterPublicCardSelectionConfirmation(effect)) return game;
    return continuePendingCardEffects(
      addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', effect.controllerId, {
        abilityId: ABILITY,
        sourceCardId: effect.sourceCardId,
        step: 'SELECTED_LIVE_LEFT_WAITING_ROOM',
        targetPlayerId: effect.metadata.targetPlayerId,
        selectedCardId,
        movedCardIds: [],
        drawnCardIds: [],
      }),
      effect.metadata?.orderedResolution === true
    );
  }
  const drawn = drawCardsForPlayer(moved.gameState, effect.controllerId, 1);
  const state = drawn?.gameState ?? moved.gameState;
  return addAction(state, 'RESOLVE_ABILITY', effect.controllerId, {
    abilityId: ABILITY,
    sourceCardId: effect.sourceCardId,
    step: 'BOTTOM_WAITING_LIVE_DRAW',
    targetPlayerId: effect.metadata.targetPlayerId,
    cardIds: moved.movedCardIds,
    movedCardIds: moved.movedCardIds,
    fromZone: ZoneType.WAITING_ROOM,
    toZone: ZoneType.MAIN_DECK,
    drawnCardIds: drawn?.drawnCardIds ?? [],
  });
}
