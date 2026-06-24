import { isMemberCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
} from '../../../../domain/entities/game.js';
import type {
  EnterWaitingRoomEvent,
  MemberStateChangedEvent,
} from '../../../../domain/events/game-events.js';
import {
  CardType,
  GamePhase,
  OrientationState,
  SlotPosition,
  TriggerCondition,
} from '../../../../shared/types/enums.js';
import { SP_BP5_002_ACTIVATED_WAIT_DRAW_THREE_DISCARD_TWO_NO_BLADE_HEART_REWARD_ABILITY_ID } from '../../ability-ids.js';
import { registerActivatedAbilityHandler } from '../../runtime/activated-registry.js';
import { drawCardsForPlayer, addBladeLiveModifierForSourceMember } from '../../runtime/actions.js';
import { discardHandCardsToWaitingRoomAndEnqueueTriggers } from '../../runtime/enter-waiting-room-triggers.js';
import { isDirectOrRenGrantedActivatedAbilitySource } from '../../runtime/granted-activated-abilities.js';
import { getSourceMemberSlot } from '../../runtime/source-member.js';
import {
  enqueueMemberStateChangedTriggersFromOrientationResult,
  type EnqueueTriggeredCardEffectsForMemberStateChanged,
} from '../../runtime/member-state-changed-triggers.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import {
  getAbilityEffectText,
  recordAbilityUseForContext,
} from '../../runtime/workflow-helpers.js';
import { and, hasBladeHeart, not, typeIs } from '../../../effects/card-selectors.js';
import { setMemberOrientation } from '../../../effects/member-state.js';

const SP_BP5_002_SELECT_DISCARD_TWO_STEP_ID = 'SP_BP5_002_SELECT_DISCARD_TWO';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

type EnqueueTriggeredCardEffects = (
  game: GameState,
  triggerConditions: readonly TriggerCondition[],
  options?: {
    readonly enterWaitingRoomEvents?: readonly EnterWaitingRoomEvent[];
    readonly memberStateChangedEvents?: readonly MemberStateChangedEvent[];
  }
) => GameState;

const noBladeHeartMember = and(typeIs(CardType.MEMBER), not(hasBladeHeart()));

export function registerSpBp5002KekeWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffects;
}): void {
  registerActivatedAbilityHandler(
    SP_BP5_002_ACTIVATED_WAIT_DRAW_THREE_DISCARD_TWO_NO_BLADE_HEART_REWARD_ABILITY_ID,
    (game, playerId, cardId) =>
      startSpBp5002KekeActivatedEffect(game, playerId, cardId, deps.enqueueTriggeredCardEffects)
  );
  registerActiveEffectStepHandler(
    SP_BP5_002_ACTIVATED_WAIT_DRAW_THREE_DISCARD_TWO_NO_BLADE_HEART_REWARD_ABILITY_ID,
    SP_BP5_002_SELECT_DISCARD_TWO_STEP_ID,
    (game, input, context) =>
      finishSpBp5002KekeDiscardTwo(
        game,
        input.selectedCardIds ?? [],
        context.continuePendingCardEffects,
        deps.enqueueTriggeredCardEffects
      )
  );
}

function startSpBp5002KekeActivatedEffect(
  game: GameState,
  playerId: string,
  cardId: string,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForMemberStateChanged
): GameState {
  if (game.activeEffect || game.currentPhase !== GamePhase.MAIN_PHASE) {
    return game;
  }

  const activePlayerId = game.players[game.activePlayerIndex]?.id ?? null;
  const player = getPlayerById(game, playerId);
  const sourceCard = getCardById(game, cardId);
  const sourceSlot = getSourceMemberSlot(game, playerId, cardId);
  const sourceState = player?.memberSlots.cardStates.get(cardId);
  const drawableCardCount = Math.min(3, player?.mainDeck.cardIds.length ?? 0);
  if (
    activePlayerId !== playerId ||
    !player ||
    !sourceCard ||
    sourceCard.ownerId !== playerId ||
    !isDirectOrRenGrantedActivatedAbilitySource(
      game,
      playerId,
      cardId,
      SP_BP5_002_ACTIVATED_WAIT_DRAW_THREE_DISCARD_TWO_NO_BLADE_HEART_REWARD_ABILITY_ID,
      ['PL!SP-bp5-002']
    ) ||
    !isMemberCardData(sourceCard.data) ||
    sourceSlot !== SlotPosition.LEFT ||
    sourceState?.orientation === OrientationState.WAITING ||
    player.hand.cardIds.length + drawableCardCount < 2
  ) {
    return game;
  }

  const state = recordAbilityUseForContext(game, player.id, {
    abilityId: SP_BP5_002_ACTIVATED_WAIT_DRAW_THREE_DISCARD_TWO_NO_BLADE_HEART_REWARD_ABILITY_ID,
    sourceCardId: cardId,
  });
  const waitResult = setMemberOrientation(
    state,
    player.id,
    cardId,
    OrientationState.WAITING,
    {
      kind: 'CARD_EFFECT',
      playerId: player.id,
      sourceCardId: cardId,
      abilityId: SP_BP5_002_ACTIVATED_WAIT_DRAW_THREE_DISCARD_TWO_NO_BLADE_HEART_REWARD_ABILITY_ID,
    }
  );
  if (!waitResult) {
    return game;
  }

  const stateWithMemberStateTriggers = enqueueMemberStateChangedTriggersFromOrientationResult(
    state,
    waitResult,
    enqueueTriggeredCardEffects,
    {
      prepareGameStateBeforeEnqueue: (stateAfterWait, result) =>
        addAction(stateAfterWait, 'PAY_COST', player.id, {
          abilityId:
            SP_BP5_002_ACTIVATED_WAIT_DRAW_THREE_DISCARD_TWO_NO_BLADE_HEART_REWARD_ABILITY_ID,
          sourceCardId: cardId,
          waitedSourceCardId: cardId,
          sourceSlot,
          previousOrientation: result.previousOrientation,
          nextOrientation: result.nextOrientation,
        }),
    }
  );

  const drawResult = drawCardsForPlayer(stateWithMemberStateTriggers.gameState, player.id, 3);
  if (!drawResult) {
    return game;
  }
  const playerAfterDraw = getPlayerById(drawResult.gameState, player.id);
  if (!playerAfterDraw || playerAfterDraw.hand.cardIds.length < 2) {
    return game;
  }

  return addAction(
    {
      ...drawResult.gameState,
      activeEffect: {
        id: `${SP_BP5_002_ACTIVATED_WAIT_DRAW_THREE_DISCARD_TWO_NO_BLADE_HEART_REWARD_ABILITY_ID}:${cardId}:turn-${state.turnCount}:action-${state.actionHistory.length}`,
        abilityId: SP_BP5_002_ACTIVATED_WAIT_DRAW_THREE_DISCARD_TWO_NO_BLADE_HEART_REWARD_ABILITY_ID,
        sourceCardId: cardId,
        controllerId: player.id,
        effectText: getAbilityEffectText(
          SP_BP5_002_ACTIVATED_WAIT_DRAW_THREE_DISCARD_TWO_NO_BLADE_HEART_REWARD_ABILITY_ID
        ),
        stepId: SP_BP5_002_SELECT_DISCARD_TWO_STEP_ID,
        stepText: '请选择2张手牌放置入休息室。',
        awaitingPlayerId: player.id,
        selectableCardIds: playerAfterDraw.hand.cardIds,
        selectableCardVisibility: 'AWAITING_PLAYER_ONLY',
        selectableCardMode: 'ORDERED_MULTI',
        minSelectableCards: 2,
        maxSelectableCards: 2,
        selectionLabel: '选择要放置入休息室的手牌',
        confirmSelectionLabel: '放置入休息室',
        canSkipSelection: false,
        metadata: {
          sourceSlot,
          drawnCardIds: drawResult.drawnCardIds,
        },
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      abilityId: SP_BP5_002_ACTIVATED_WAIT_DRAW_THREE_DISCARD_TWO_NO_BLADE_HEART_REWARD_ABILITY_ID,
      sourceCardId: cardId,
      step: 'WAIT_SOURCE_DRAW_THREE_SELECT_DISCARD_TWO',
      sourceSlot,
      drawnCardIds: drawResult.drawnCardIds,
      selectableCardIds: playerAfterDraw.hand.cardIds,
    }
  );
}

function finishSpBp5002KekeDiscardTwo(
  game: GameState,
  selectedCardIds: readonly string[],
  continuePendingCardEffects: ContinuePendingCardEffects,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffects
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !==
      SP_BP5_002_ACTIVATED_WAIT_DRAW_THREE_DISCARD_TWO_NO_BLADE_HEART_REWARD_ABILITY_ID ||
    effect.stepId !== SP_BP5_002_SELECT_DISCARD_TWO_STEP_ID
  ) {
    return game;
  }

  const player = getPlayerById(game, effect.controllerId);
  const uniqueSelectedCardIds = [...new Set(selectedCardIds)];
  if (
    !player ||
    selectedCardIds.length !== 2 ||
    uniqueSelectedCardIds.length !== selectedCardIds.length ||
    uniqueSelectedCardIds.some(
      (cardId) =>
        effect.selectableCardIds?.includes(cardId) !== true ||
        !player.hand.cardIds.includes(cardId)
    )
  ) {
    return game;
  }

  const discardedCards = uniqueSelectedCardIds
    .map((cardId) => getCardById(game, cardId))
    .filter((card): card is NonNullable<ReturnType<typeof getCardById>> => card != null);
  const noBladeHeartMemberDiscardCount = discardedCards.filter(noBladeHeartMember).length;

  const discardResult = discardHandCardsToWaitingRoomAndEnqueueTriggers(
    game,
    player.id,
    uniqueSelectedCardIds,
    {
      count: 2,
      candidateCardIds: effect.selectableCardIds ?? [],
    },
    enqueueTriggeredCardEffects
  );
  if (!discardResult) {
    return game;
  }

  let state = discardResult.gameState;
  let activatedSource = false;
  if (noBladeHeartMemberDiscardCount >= 1) {
    const activeResult = setMemberOrientation(
      state,
      player.id,
      effect.sourceCardId,
      OrientationState.ACTIVE,
      {
        kind: 'CARD_EFFECT',
        playerId: player.id,
        sourceCardId: effect.sourceCardId,
        abilityId: effect.abilityId,
      }
    );
    if (activeResult) {
      activatedSource = activeResult.previousOrientation !== activeResult.nextOrientation;
      state = enqueueMemberStateChangedTriggersFromOrientationResult(
        state,
        activeResult,
        enqueueTriggeredCardEffects
      ).gameState;
    }
  }

  let bladeBonus = 0;
  if (noBladeHeartMemberDiscardCount >= 2) {
    const bladeResult = addBladeLiveModifierForSourceMember(state, {
      playerId: player.id,
      sourceCardId: effect.sourceCardId,
      abilityId: effect.abilityId,
      amount: 2,
    });
    if (bladeResult) {
      state = bladeResult.gameState;
      bladeBonus = bladeResult.bladeBonus;
    }
  }

  return continuePendingCardEffects(
    addAction({ ...state, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'DISCARD_TWO_RESOLVE_REWARD',
      sourceSlot: effect.metadata?.sourceSlot,
      discardedCardIds: discardResult.discardedCardIds,
      noBladeHeartMemberDiscardCount,
      activatedSource,
      bladeBonus,
    }),
    effect.metadata?.orderedResolution === true
  );
}
