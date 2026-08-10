import { isMemberCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  type ActiveEffectState,
  type GameState,
} from '../../../../domain/entities/game.js';
import { GamePhase } from '../../../../shared/types/enums.js';
import { cardCodeMatchesBase } from '../../../../shared/utils/card-code.js';
import { cardNameAliasAny } from '../../../effects/card-selectors.js';
import { getEnergySelectionCandidates } from '../../../effects/energy-selection.js';
import { LL_BP3_001_ACTIVATED_SHUFFLE_NAMED_MEMBERS_ACTIVATE_ENERGY_ABILITY_ID } from '../../ability-ids.js';
import { activateWaitingEnergyCardsForPlayer } from '../../runtime/actions.js';
import { registerActivatedAbilityHandler } from '../../runtime/activated-registry.js';
import { wasRestoredAfterPublicCardSelectionConfirmation } from '../../runtime/public-card-selection-confirmation.js';
import { getSourceMemberSlot } from '../../runtime/source-member.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { shuffleWaitingRoomCardsToDeckBottomAndEnqueueTriggers } from '../../runtime/waiting-room-main-deck-triggers.js';
import {
  getAbilityEffectText,
  recordAbilityUseForContext,
  recordPayCostAction,
} from '../../runtime/workflow-helpers.js';

const ABILITY_ID = LL_BP3_001_ACTIVATED_SHUFFLE_NAMED_MEMBERS_ACTIVATE_ENERGY_ABILITY_ID;
const BASE_CARD_CODE = 'LL-bp3-001';
const SELECT_COST_STEP_ID = 'LL_BP3_001_SELECT_NAMED_MEMBERS_TO_SHUFFLE_BOTTOM';
const REQUIRED_COST_COUNT = 6;
const MAX_ACTIVATION_COUNT = 6;
const namedMemberSelector = cardNameAliasAny(['園田海未', '津島善子', '天王寺璃奈']);

export function registerLlBp3001UmiYoshikoRinaWorkflowHandlers(): void {
  registerActivatedAbilityHandler(ABILITY_ID, startActivatedAbility);
  registerActiveEffectStepHandler(ABILITY_ID, SELECT_COST_STEP_ID, (game, input) =>
    finishNamedMemberShuffleCost(
      game,
      input.selectedCardIds ?? (input.selectedCardId ? [input.selectedCardId] : [])
    )
  );
}

function startActivatedAbility(game: GameState, playerId: string, sourceCardId: string): GameState {
  if (game.activeEffect || game.currentPhase !== GamePhase.MAIN_PHASE) return game;
  const activePlayerId = game.players[game.activePlayerIndex]?.id ?? null;
  const sourceSlot = getValidSourceSlot(game, playerId, sourceCardId);
  const candidateCardIds = getNamedWaitingRoomMemberCardIds(game, playerId);
  if (
    activePlayerId !== playerId ||
    sourceSlot === null ||
    candidateCardIds.length < REQUIRED_COST_COUNT
  ) {
    return game;
  }

  const effectText = getAbilityEffectText(ABILITY_ID);
  return addAction(
    {
      ...game,
      activeEffect: {
        id: `${ABILITY_ID}:${sourceCardId}:turn-${game.turnCount}:action-${game.actionHistory.length}`,
        abilityId: ABILITY_ID,
        sourceCardId,
        controllerId: playerId,
        effectText,
        stepId: SELECT_COST_STEP_ID,
        stepText:
          '请从自己的休息室选择合计6张姓名为「园田海未」「津岛善子」「天王寺璃奈」的成员卡，洗牌后放置于卡组底。',
        awaitingPlayerId: playerId,
        selectableCardIds: candidateCardIds,
        selectableCardVisibility: 'PUBLIC',
        selectableCardMode: 'ORDERED_MULTI',
        minSelectableCards: REQUIRED_COST_COUNT,
        maxSelectableCards: REQUIRED_COST_COUNT,
        selectionLabel: '选择要洗牌并放置于卡组底的卡',
        confirmSelectionLabel: '洗牌并放置于卡组底',
        canSkipSelection: false,
        metadata: {
          publicCardSelectionConfirmation: { destination: 'MAIN_DECK_BOTTOM' },
          candidateCardIds,
          sourceSlot,
        },
      },
    },
    'RESOLVE_ABILITY',
    playerId,
    {
      abilityId: ABILITY_ID,
      sourceCardId,
      sourceSlot,
      step: 'START_SELECT_NAMED_MEMBERS_TO_SHUFFLE_BOTTOM',
      candidateCardIds,
    }
  );
}

function finishNamedMemberShuffleCost(
  game: GameState,
  selectedCardIds: readonly string[]
): GameState {
  const effect = getActiveEffect(game);
  if (!effect) return game;
  const originalCandidateCardIds = getStringArray(effect.metadata?.candidateCardIds);
  if (
    selectedCardIds.length !== REQUIRED_COST_COUNT ||
    new Set(selectedCardIds).size !== selectedCardIds.length ||
    selectedCardIds.some((cardId) => !originalCandidateCardIds.includes(cardId))
  ) {
    return game;
  }

  const sourceSlot = getValidSourceSlot(game, effect.controllerId, effect.sourceCardId);
  const currentCandidateCardIdSet = new Set(
    getNamedWaitingRoomMemberCardIds(game, effect.controllerId)
  );
  if (
    sourceSlot === null ||
    selectedCardIds.some((cardId) => !currentCandidateCardIdSet.has(cardId))
  ) {
    return finishNoOp(game, effect, {
      step: sourceSlot === null ? 'SOURCE_INVALID_BEFORE_COST' : 'STALE_NAMED_MEMBER_COST',
      selectedCardIds,
      restoredAfterPublicConfirmation: wasRestoredAfterPublicCardSelectionConfirmation(effect),
    });
  }

  const shuffleResult = shuffleWaitingRoomCardsToDeckBottomAndEnqueueTriggers(
    game,
    effect.controllerId,
    selectedCardIds,
    {
      kind: 'CARD_EFFECT',
      playerId: effect.controllerId,
      sourceCardId: effect.sourceCardId,
      abilityId: effect.abilityId,
    }
  );
  if (!shuffleResult || shuffleResult.movedCardIds.length !== REQUIRED_COST_COUNT) {
    return finishNoOp(game, effect, {
      step: 'FAILED_NAMED_MEMBER_COST',
      selectedCardIds,
    });
  }

  let state = recordPayCostAction(shuffleResult.gameState, effect.controllerId, {
    abilityId: effect.abilityId,
    sourceCardId: effect.sourceCardId,
    sourceSlot,
    costType: 'SHUFFLE_WAITING_ROOM_CARDS_TO_DECK_BOTTOM',
    selectedCardIds,
    movedCardIds: shuffleResult.movedCardIds,
    waitingRoomCardsMovedToMainDeckEventId:
      shuffleResult.waitingRoomCardsMovedToMainDeckEvent?.eventId ?? null,
  });
  state = recordAbilityUseForContext(state, effect.controllerId, {
    abilityId: effect.abilityId,
    sourceCardId: effect.sourceCardId,
  });

  const waitingEnergyCount = getEnergySelectionCandidates(
    state,
    effect.controllerId,
    'ACTIVATE_WAITING_ENERGY'
  ).length;
  const activationCount = Math.min(MAX_ACTIVATION_COUNT, waitingEnergyCount);
  const activationResult = activateWaitingEnergyCardsForPlayer(
    state,
    effect.controllerId,
    activationCount
  );
  if (!activationResult) return game;

  return addAction(
    { ...activationResult.gameState, activeEffect: null },
    'RESOLVE_ABILITY',
    effect.controllerId,
    {
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      sourceSlot,
      step: 'SHUFFLE_NAMED_MEMBERS_BOTTOM_ACTIVATE_ENERGY',
      selectedCardIds,
      movedCardIds: shuffleResult.movedCardIds,
      activatedEnergyCardIds: activationResult.activatedEnergyCardIds,
      previousOrientations: activationResult.previousOrientations,
      nextOrientation: activationResult.nextOrientation,
    }
  );
}

function getNamedWaitingRoomMemberCardIds(game: GameState, playerId: string): readonly string[] {
  const player = getPlayerById(game, playerId);
  return (
    player?.waitingRoom.cardIds.filter((cardId) => {
      const card = getCardById(game, cardId);
      return card !== null && isMemberCardData(card.data) && namedMemberSelector(card);
    }) ?? []
  );
}

function getValidSourceSlot(game: GameState, playerId: string, sourceCardId: string) {
  const sourceCard = getCardById(game, sourceCardId);
  if (
    !sourceCard ||
    sourceCard.ownerId !== playerId ||
    !isMemberCardData(sourceCard.data) ||
    !cardCodeMatchesBase(sourceCard.data.cardCode, BASE_CARD_CODE)
  ) {
    return null;
  }
  return getSourceMemberSlot(game, playerId, sourceCardId);
}

function getActiveEffect(game: GameState): ActiveEffectState | null {
  const effect = game.activeEffect;
  return effect?.abilityId === ABILITY_ID && effect.stepId === SELECT_COST_STEP_ID ? effect : null;
}

function finishNoOp(
  game: GameState,
  effect: ActiveEffectState,
  payload: Readonly<Record<string, unknown>>
): GameState {
  return addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', effect.controllerId, {
    abilityId: effect.abilityId,
    sourceCardId: effect.sourceCardId,
    ...payload,
  });
}

function getStringArray(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}
