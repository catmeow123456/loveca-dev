import { isMemberCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { CardType, GamePhase, OrientationState } from '../../../../shared/types/enums.js';
import { cardCodeMatchesBase } from '../../../../shared/utils/card-code.js';
import { typeIs } from '../../../effects/card-selectors.js';
import {
  createStageMemberOrientationTargetSelection,
  getStageMemberOrientationTargetMetadata,
  resolveStageMemberOrientationTargetSelection,
} from '../../../effects/stage-member-target-selection.js';
import { getStageMemberCardIdsByOrientation } from '../../../effects/stage-targets.js';
import {
  PL_PR_023_ACTIVATED_WAIT_OWN_MEMBER_DISCARD_DRAW_ONE_ABILITY_ID,
  PL_PR_023_AUTO_TURN_THREE_MEMBER_WAITED_GAIN_BLADE_ABILITY_ID,
} from '../../ability-ids.js';
import { addBladeLiveModifierForSourceMember, drawCardsForPlayer } from '../../runtime/actions.js';
import { registerActivatedAbilityHandler } from '../../runtime/activated-registry.js';
import {
  discardOneHandCardToWaitingRoomAndEnqueueTriggers,
  type EnqueueTriggeredCardEffectsForEnterWaitingRoom,
} from '../../runtime/enter-waiting-room-triggers.js';
import {
  enqueueMemberStateChangedTriggersFromOrientationResult,
  type EnqueueTriggeredCardEffectsForMemberStateChanged,
} from '../../runtime/member-state-changed-triggers.js';
import { getSourceMemberSlot } from '../../runtime/source-member.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import {
  getAbilityEffectText,
  recordAbilityUseForContext,
  registerManualConfirmablePendingAbilityStarterHandler,
} from '../../runtime/workflow-helpers.js';

const BASE_CARD_CODE = 'PL!-PR-023';
const SELECT_WAIT_MEMBER_STEP_ID = 'PL_PR_023_SELECT_OWN_ACTIVE_MEMBER_TO_WAIT';
const SELECT_DISCARD_STEP_ID = 'PL_PR_023_SELECT_HAND_CARD_TO_DISCARD';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;
type EnqueueTriggeredCardEffects = EnqueueTriggeredCardEffectsForEnterWaitingRoom &
  EnqueueTriggeredCardEffectsForMemberStateChanged;

export function registerPlPr023EliWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffects;
}): void {
  registerManualConfirmablePendingAbilityStarterHandler(
    PL_PR_023_AUTO_TURN_THREE_MEMBER_WAITED_GAIN_BLADE_ABILITY_ID,
    (game, ability, options, context) =>
      resolveMemberWaitedGainBlade(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );

  registerActivatedAbilityHandler(
    PL_PR_023_ACTIVATED_WAIT_OWN_MEMBER_DISCARD_DRAW_ONE_ABILITY_ID,
    (game, playerId, cardId) => startActivatedWaitMemberDiscardDraw(game, playerId, cardId)
  );
  registerActiveEffectStepHandler(
    PL_PR_023_ACTIVATED_WAIT_OWN_MEMBER_DISCARD_DRAW_ONE_ABILITY_ID,
    SELECT_WAIT_MEMBER_STEP_ID,
    (game, input) =>
      payWaitMemberCost(game, input.selectedCardId ?? null, deps.enqueueTriggeredCardEffects)
  );
  registerActiveEffectStepHandler(
    PL_PR_023_ACTIVATED_WAIT_OWN_MEMBER_DISCARD_DRAW_ONE_ABILITY_ID,
    SELECT_DISCARD_STEP_ID,
    (game, input, context) =>
      payDiscardCostAndDraw(
        game,
        input.selectedCardId ?? null,
        deps.enqueueTriggeredCardEffects,
        context.continuePendingCardEffects
      )
  );
}

function resolveMemberWaitedGainBlade(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) return game;

  let state: GameState = {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
  };
  state = recordAbilityUseForContext(state, player.id, {
    abilityId: ability.abilityId,
    sourceCardId: ability.sourceCardId,
    pendingAbilityId: ability.id,
  });

  const sourceSlot = getSourceMemberSlot(state, player.id, ability.sourceCardId);
  const modifierResult =
    sourceSlot === null
      ? null
      : addBladeLiveModifierForSourceMember(state, {
          playerId: player.id,
          sourceCardId: ability.sourceCardId,
          abilityId: ability.abilityId,
          amount: 1,
        });

  return continuePendingCardEffects(
    addAction(modifierResult?.gameState ?? state, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      sourceSlot: ability.sourceSlot ?? sourceSlot,
      step: modifierResult ? 'MEMBER_WAITED_GAIN_ONE_BLADE' : 'SOURCE_NOT_ON_STAGE_NO_OP',
      bladeBonus: modifierResult?.bladeBonus ?? 0,
      bladeApplied: modifierResult !== null,
    }),
    orderedResolution
  );
}

function startActivatedWaitMemberDiscardDraw(
  game: GameState,
  playerId: string,
  cardId: string
): GameState {
  if (game.activeEffect || game.currentPhase !== GamePhase.MAIN_PHASE) return game;

  const player = getPlayerById(game, playerId);
  const sourceCard = getCardById(game, cardId);
  const sourceSlot = getSourceMemberSlot(game, playerId, cardId);
  if (
    game.players[game.activePlayerIndex]?.id !== playerId ||
    !player ||
    !sourceCard ||
    sourceCard.ownerId !== playerId ||
    !isMemberCardData(sourceCard.data) ||
    !cardCodeMatchesBase(sourceCard.data.cardCode, BASE_CARD_CODE) ||
    sourceSlot === null ||
    player.hand.cardIds.length === 0
  ) {
    return game;
  }

  const ability = {
    id: `${PL_PR_023_ACTIVATED_WAIT_OWN_MEMBER_DISCARD_DRAW_ONE_ABILITY_ID}:${cardId}:turn-${game.turnCount}:action-${game.actionHistory.length}`,
    abilityId: PL_PR_023_ACTIVATED_WAIT_OWN_MEMBER_DISCARD_DRAW_ONE_ABILITY_ID,
    sourceCardId: cardId,
    controllerId: playerId,
    mandatory: true,
    timingId: 'ACTIVATED',
    eventIds: [],
    sourceSlot,
  };
  const targetSelection = createStageMemberOrientationTargetSelection(game, {
    ability,
    effectText: getAbilityEffectText(ability.abilityId),
    stepId: SELECT_WAIT_MEMBER_STEP_ID,
    stepText: '请选择自己舞台上1名活跃状态的成员变为待机状态。',
    awaitingPlayerId: playerId,
    targetPlayerId: playerId,
    selector: typeIs(CardType.MEMBER),
    targetOrientation: OrientationState.WAITING,
    selectionLabel: '选择要变为待机状态的成员',
    confirmSelectionLabel: '变为待机状态',
    orderedResolution: false,
    metadata: { sourceSlot },
  });
  if (targetSelection.activeEffect === null) return game;

  return addAction(
    { ...game, activeEffect: targetSelection.activeEffect },
    'RESOLVE_ABILITY',
    playerId,
    {
      abilityId: ability.abilityId,
      sourceCardId: cardId,
      sourceSlot,
      step: 'START_SELECT_OWN_ACTIVE_MEMBER_TO_WAIT',
      selectableCardIds: targetSelection.selectableCardIds,
    }
  );
}

function payWaitMemberCost(
  game: GameState,
  selectedCardId: string | null,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffects
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== PL_PR_023_ACTIVATED_WAIT_OWN_MEMBER_DISCARD_DRAW_ONE_ABILITY_ID ||
    effect.stepId !== SELECT_WAIT_MEMBER_STEP_ID ||
    !selectedCardId ||
    effect.selectableCardIds?.includes(selectedCardId) !== true
  ) {
    return game;
  }

  const player = getPlayerById(game, effect.controllerId);
  const targetMetadata = getStageMemberOrientationTargetMetadata(effect);
  const currentActiveMemberCardIds = player
    ? getStageMemberCardIdsByOrientation(game, player.id, OrientationState.ACTIVE)
    : [];
  if (
    !player ||
    !targetMetadata ||
    targetMetadata.targetPlayerId !== player.id ||
    !currentActiveMemberCardIds.includes(selectedCardId) ||
    player.hand.cardIds.length === 0
  ) {
    return game;
  }

  const orientationChange = resolveStageMemberOrientationTargetSelection(
    game,
    effect,
    selectedCardId
  );
  if (
    !orientationChange ||
    !orientationChange.changed ||
    orientationChange.previousOrientation !== OrientationState.ACTIVE
  ) {
    return game;
  }

  return enqueueMemberStateChangedTriggersFromOrientationResult(
    game,
    orientationChange,
    enqueueTriggeredCardEffects,
    {
      prepareGameStateBeforeEnqueue: (stateAfterWait, result, memberStateChangedEvents) => {
        const handCardIds = getPlayerById(stateAfterWait, player.id)?.hand.cardIds ?? [];
        return addAction(
          {
            ...stateAfterWait,
            activeEffect: {
              id: effect.id,
              abilityId: effect.abilityId,
              sourceCardId: effect.sourceCardId,
              controllerId: effect.controllerId,
              effectText: effect.effectText,
              stepId: SELECT_DISCARD_STEP_ID,
              stepText: '请选择1张手牌放置入休息室。之后抽1张卡。',
              awaitingPlayerId: player.id,
              selectableCardIds: handCardIds,
              selectableCardVisibility: 'AWAITING_PLAYER_ONLY',
              selectionLabel: '选择要放置入休息室的手牌',
              confirmSelectionLabel: '放置入休息室',
              canSkipSelection: false,
              metadata: {
                sourceSlot: effect.metadata?.sourceSlot,
                waitedMemberCardId: selectedCardId,
                memberStateChangedEventIds: memberStateChangedEvents.map((event) => event.eventId),
              },
            },
          },
          'PAY_COST',
          player.id,
          {
            abilityId: effect.abilityId,
            sourceCardId: effect.sourceCardId,
            sourceSlot: effect.metadata?.sourceSlot,
            waitedMemberCardId: selectedCardId,
            previousOrientation: result.previousOrientation,
            nextOrientation: result.nextOrientation,
            memberStateChangedEventIds: memberStateChangedEvents.map((event) => event.eventId),
          }
        );
      },
    }
  ).gameState;
}

function payDiscardCostAndDraw(
  game: GameState,
  selectedCardId: string | null,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffects,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== PL_PR_023_ACTIVATED_WAIT_OWN_MEMBER_DISCARD_DRAW_ONE_ABILITY_ID ||
    effect.stepId !== SELECT_DISCARD_STEP_ID ||
    !selectedCardId ||
    effect.selectableCardIds?.includes(selectedCardId) !== true
  ) {
    return game;
  }

  const player = getPlayerById(game, effect.controllerId);
  if (!player) return game;
  if (!player.hand.cardIds.includes(selectedCardId)) {
    return player.hand.cardIds.length === 0
      ? game
      : {
          ...game,
          activeEffect: { ...effect, selectableCardIds: player.hand.cardIds },
        };
  }

  const discardResult = discardOneHandCardToWaitingRoomAndEnqueueTriggers(
    game,
    player.id,
    selectedCardId,
    { candidateCardIds: effect.selectableCardIds },
    enqueueTriggeredCardEffects
  );
  if (!discardResult) return game;

  let state = addAction(discardResult.gameState, 'PAY_COST', player.id, {
    abilityId: effect.abilityId,
    sourceCardId: effect.sourceCardId,
    sourceSlot: effect.metadata?.sourceSlot,
    waitedMemberCardId: effect.metadata?.waitedMemberCardId,
    discardedCardId: selectedCardId,
    discardedCardIds: discardResult.discardedCardIds,
    enterWaitingRoomEventId: discardResult.enterWaitingRoomEvent?.eventId ?? null,
  });
  state = recordAbilityUseForContext(state, player.id, {
    abilityId: effect.abilityId,
    sourceCardId: effect.sourceCardId,
  });
  const drawResult = drawCardsForPlayer(state, player.id, 1);
  state = drawResult?.gameState ?? state;

  return continuePendingCardEffects(
    addAction({ ...state, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      sourceSlot: effect.metadata?.sourceSlot,
      step: 'WAIT_OWN_MEMBER_DISCARD_DRAW_ONE',
      waitedMemberCardId: effect.metadata?.waitedMemberCardId,
      discardedCardIds: discardResult.discardedCardIds,
      drawnCardIds: drawResult?.drawnCardIds ?? [],
    }),
    false
  );
}
