import { isMemberCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getOpponent,
  getPlayerById,
  type GameState,
} from '../../../../domain/entities/game.js';
import { CardType, GamePhase, OrientationState, SlotPosition } from '../../../../shared/types/enums.js';
import { cardCodeMatchesBase } from '../../../../shared/utils/card-code.js';
import { typeIs } from '../../../effects/card-selectors.js';
import { setMemberOrientation } from '../../../effects/member-state.js';
import { getStageMemberCardIdsMatching } from '../../../effects/stage-targets.js';
import { selectWaitingRoomCardIds } from '../../../effects/zone-selection.js';
import { PL_BP5_111_ACTIVATED_DISCARD_ACTIVATE_WAITING_MEMBER_RECOVER_LIVE_ABILITY_ID } from '../../ability-ids.js';
import { recoverCardsFromWaitingRoomToHandForPlayer } from '../../runtime/actions.js';
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
  recordPayCostAction,
} from '../../runtime/workflow-helpers.js';

const TSUBASA_SELECT_DISCARD_STEP_ID = 'PL_BP5_111_SELECT_DISCARD_COST';
const TSUBASA_SELECT_WAITING_MEMBER_STEP_ID = 'PL_BP5_111_SELECT_WAITING_MEMBER_TO_ACTIVATE';
const TSUBASA_SELECT_WAITING_ROOM_LIVE_STEP_ID = 'PL_BP5_111_SELECT_WAITING_ROOM_LIVE';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;
type EnqueueTriggeredCardEffects = EnqueueTriggeredCardEffectsForEnterWaitingRoom &
  EnqueueTriggeredCardEffectsForMemberStateChanged;

export function registerBp5111TsubasaWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffects;
}): void {
  registerActivatedAbilityHandler(
    PL_BP5_111_ACTIVATED_DISCARD_ACTIVATE_WAITING_MEMBER_RECOVER_LIVE_ABILITY_ID,
    (game, playerId, cardId) => startTsubasaActivatedWorkflow(game, playerId, cardId)
  );
  registerActiveEffectStepHandler(
    PL_BP5_111_ACTIVATED_DISCARD_ACTIVATE_WAITING_MEMBER_RECOVER_LIVE_ABILITY_ID,
    TSUBASA_SELECT_DISCARD_STEP_ID,
    (game, input, context) =>
      finishTsubasaDiscardCost(
        game,
        input.selectedCardId ?? null,
        deps.enqueueTriggeredCardEffects,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    PL_BP5_111_ACTIVATED_DISCARD_ACTIVATE_WAITING_MEMBER_RECOVER_LIVE_ABILITY_ID,
    TSUBASA_SELECT_WAITING_MEMBER_STEP_ID,
    (game, input, context) =>
      finishTsubasaActivateWaitingMember(
        game,
        input.selectedCardId ?? null,
        deps.enqueueTriggeredCardEffects,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    PL_BP5_111_ACTIVATED_DISCARD_ACTIVATE_WAITING_MEMBER_RECOVER_LIVE_ABILITY_ID,
    TSUBASA_SELECT_WAITING_ROOM_LIVE_STEP_ID,
    (game, input, context) =>
      finishTsubasaRecoverLive(
        game,
        input.selectedCardId ?? null,
        context.continuePendingCardEffects
      )
  );
}

function startTsubasaActivatedWorkflow(
  game: GameState,
  playerId: string,
  sourceCardId: string
): GameState {
  if (game.activeEffect || game.currentPhase !== GamePhase.MAIN_PHASE) {
    return game;
  }
  const activePlayerId = game.players[game.activePlayerIndex]?.id ?? null;
  const player = getPlayerById(game, playerId);
  const sourceSlot = getSourceMemberSlot(game, playerId, sourceCardId);
  if (
    activePlayerId !== playerId ||
    !player ||
    sourceSlot === null ||
    !sourceIsOwnStageTsubasa(game, playerId, sourceCardId) ||
    player.hand.cardIds.length === 0 ||
    getWaitingStageMemberTargets(game, playerId).length === 0
  ) {
    return game;
  }

  return {
    ...game,
    activeEffect: {
      id: `${PL_BP5_111_ACTIVATED_DISCARD_ACTIVATE_WAITING_MEMBER_RECOVER_LIVE_ABILITY_ID}:${sourceCardId}:turn-${game.turnCount}:action-${game.actionHistory.length}`,
      abilityId: PL_BP5_111_ACTIVATED_DISCARD_ACTIVATE_WAITING_MEMBER_RECOVER_LIVE_ABILITY_ID,
      sourceCardId,
      controllerId: player.id,
      effectText: getAbilityEffectText(
        PL_BP5_111_ACTIVATED_DISCARD_ACTIVATE_WAITING_MEMBER_RECOVER_LIVE_ABILITY_ID
      ),
      stepId: TSUBASA_SELECT_DISCARD_STEP_ID,
      stepText: '请选择1张手牌放置入休息室。',
      awaitingPlayerId: player.id,
      selectableCardIds: player.hand.cardIds,
      selectableCardVisibility: 'AWAITING_PLAYER_ONLY',
      selectionLabel: '选择要放置入休息室的手牌',
      confirmSelectionLabel: '放置入休息室',
      canSkipSelection: false,
      metadata: {
        sourceSlot,
      },
    },
  };
}

function finishTsubasaDiscardCost(
  game: GameState,
  selectedCardId: string | null,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffects,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== PL_BP5_111_ACTIVATED_DISCARD_ACTIVATE_WAITING_MEMBER_RECOVER_LIVE_ABILITY_ID ||
    effect.stepId !== TSUBASA_SELECT_DISCARD_STEP_ID ||
    !selectedCardId ||
    effect.selectableCardIds?.includes(selectedCardId) !== true
  ) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  if (!player || !player.hand.cardIds.includes(selectedCardId)) {
    return game;
  }

  const discardResult = discardOneHandCardToWaitingRoomAndEnqueueTriggers(
    game,
    player.id,
    selectedCardId,
    { candidateCardIds: effect.selectableCardIds },
    enqueueTriggeredCardEffects
  );
  if (!discardResult) {
    return game;
  }

  let state = recordPayCostAction(discardResult.gameState, player.id, {
    abilityId: effect.abilityId,
    sourceCardId: effect.sourceCardId,
    sourceSlot: effect.metadata?.sourceSlot ?? null,
    discardedCardId: selectedCardId,
    discardedCardIds: discardResult.discardedCardIds,
    enterWaitingRoomEventId: discardResult.enterWaitingRoomEvent?.eventId ?? null,
  });
  state = recordAbilityUseForContext(state, player.id, {
    abilityId: effect.abilityId,
    sourceCardId: effect.sourceCardId,
  });

  const waitingMemberCardIds = getWaitingStageMemberTargets(state, player.id);
  if (waitingMemberCardIds.length === 0) {
    return continuePendingCardEffects(
      addAction({ ...state, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        step: 'DISCARD_COST_NO_WAITING_MEMBER_TARGET',
        discardedCardIds: discardResult.discardedCardIds,
        activatedMemberCardId: null,
        recoveredCardIds: [],
      }),
      false
    );
  }

  return {
    ...state,
    activeEffect: {
      ...effect,
      stepId: TSUBASA_SELECT_WAITING_MEMBER_STEP_ID,
      stepText: '请选择舞台上1名待机状态成员变为活跃状态。',
      selectableCardIds: waitingMemberCardIds,
      selectableCardVisibility: 'PUBLIC',
      selectionLabel: '选择待机状态成员',
      confirmSelectionLabel: '变为活跃状态',
      metadata: {
        ...effect.metadata,
        discardedCardIds: discardResult.discardedCardIds,
      },
    },
  };
}

function finishTsubasaActivateWaitingMember(
  game: GameState,
  selectedCardId: string | null,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForMemberStateChanged,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== PL_BP5_111_ACTIVATED_DISCARD_ACTIVATE_WAITING_MEMBER_RECOVER_LIVE_ABILITY_ID ||
    effect.stepId !== TSUBASA_SELECT_WAITING_MEMBER_STEP_ID
  ) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  const target = selectedCardId ? findWaitingStageMember(game, selectedCardId) : null;
  if (!player || !selectedCardId || !target || effect.selectableCardIds?.includes(selectedCardId) !== true) {
    return finishTsubasaActiveNoop(
      game,
      effect,
      {
        step: 'WAITING_MEMBER_TARGET_UNAVAILABLE_AFTER_COST',
        selectedCardId,
        activatedMemberCardId: null,
        recoveredCardIds: [],
      },
      continuePendingCardEffects
    );
  }

  const orientationResult = setMemberOrientation(
    game,
    target.playerId,
    selectedCardId,
    OrientationState.ACTIVE,
    {
      kind: 'CARD_EFFECT',
      playerId: player.id,
      sourceCardId: effect.sourceCardId,
      abilityId: effect.abilityId,
    }
  );
  if (!orientationResult || orientationResult.previousOrientation !== OrientationState.WAITING) {
    return finishTsubasaActiveNoop(
      game,
      effect,
      {
        step: 'WAITING_MEMBER_TARGET_UNAVAILABLE_AFTER_COST',
        selectedCardId,
        activatedMemberCardId: null,
        recoveredCardIds: [],
      },
      continuePendingCardEffects
    );
  }

  const opponent = getOpponent(game, player.id);
  const activatedOpponentMember = opponent?.id === target.playerId;
  const liveCandidateIds = activatedOpponentMember
    ? getWaitingRoomLiveCandidateIds(orientationResult.gameState, player.id)
    : [];
  const stateWithTriggers = enqueueMemberStateChangedTriggersFromOrientationResult(
    game,
    orientationResult,
    enqueueTriggeredCardEffects,
    {
      prepareGameStateBeforeEnqueue: (stateAfterOrientation, result, memberStateChangedEvents) => {
        const basePayload = {
          abilityId: effect.abilityId,
          sourceCardId: effect.sourceCardId,
          step: activatedOpponentMember
            ? liveCandidateIds.length > 0
              ? 'ACTIVATE_OPPONENT_WAITING_MEMBER_START_RECOVER_LIVE'
              : 'ACTIVATE_OPPONENT_WAITING_MEMBER_NO_LIVE_TARGET'
            : 'ACTIVATE_OWN_WAITING_MEMBER',
          targetPlayerId: target.playerId,
          activatedMemberCardId: selectedCardId,
          previousOrientation: result.previousOrientation,
          nextOrientation: result.nextOrientation,
          memberStateChangedEventIds: memberStateChangedEvents.map((event) => event.eventId),
          discardedCardIds: getStringArrayMetadata(effect.metadata?.discardedCardIds),
        };
        const stateWithAction = addAction(stateAfterOrientation, 'RESOLVE_ABILITY', player.id, {
          ...basePayload,
          waitingRoomLiveCandidateIds: liveCandidateIds,
          recoveredCardIds: [],
        });
        if (!activatedOpponentMember || liveCandidateIds.length === 0) {
          return { ...stateWithAction, activeEffect: null };
        }
        return {
          ...stateWithAction,
          activeEffect: {
            ...effect,
            stepId: TSUBASA_SELECT_WAITING_ROOM_LIVE_STEP_ID,
            stepText: '请选择自己休息室中1张LIVE卡加入手牌。',
            selectableCardIds: liveCandidateIds,
            selectableCardVisibility: 'PUBLIC',
            selectionLabel: '选择要加入手牌的LIVE卡',
            confirmSelectionLabel: '加入手牌',
            metadata: {
              ...effect.metadata,
              publicCardSelectionConfirmation: { destination: 'HAND' },
              activatedMemberCardId: selectedCardId,
              activatedMemberPlayerId: target.playerId,
              memberStateChangedEventIds: memberStateChangedEvents.map((event) => event.eventId),
            },
          },
        };
      },
    }
  );

  return liveCandidateIds.length > 0 && activatedOpponentMember
    ? stateWithTriggers.gameState
    : continuePendingCardEffects(stateWithTriggers.gameState, false);
}

function finishTsubasaRecoverLive(
  game: GameState,
  selectedCardId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== PL_BP5_111_ACTIVATED_DISCARD_ACTIVATE_WAITING_MEMBER_RECOVER_LIVE_ABILITY_ID ||
    effect.stepId !== TSUBASA_SELECT_WAITING_ROOM_LIVE_STEP_ID ||
    !selectedCardId
  ) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  if (!player) {
    return game;
  }

  const recoveryResult = recoverCardsFromWaitingRoomToHandForPlayer(
    game,
    player.id,
    [selectedCardId],
    {
      candidateCardIds: effect.selectableCardIds ?? [],
      exactCount: 1,
    }
  );
  if (!recoveryResult) {
    return finishTsubasaActiveNoop(
      game,
      effect,
      {
        step: 'WAITING_ROOM_LIVE_TARGET_LOST_AFTER_ACTIVATION',
        selectedCardId,
        activatedMemberCardId: getStringMetadata(effect.metadata?.activatedMemberCardId),
        recoveredCardIds: [],
      },
      continuePendingCardEffects
    );
  }

  return continuePendingCardEffects(
    addAction({ ...recoveryResult.gameState, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'RECOVER_LIVE_AFTER_ACTIVATING_OPPONENT_MEMBER',
      activatedMemberCardId: getStringMetadata(effect.metadata?.activatedMemberCardId),
      selectedCardId: recoveryResult.movedCardIds[0] ?? null,
      recoveredCardIds: recoveryResult.movedCardIds,
    }),
    false
  );
}

function finishTsubasaActiveNoop(
  game: GameState,
  effect: NonNullable<GameState['activeEffect']>,
  payload: Record<string, unknown>,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  return continuePendingCardEffects(
    addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', effect.controllerId, {
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      ...payload,
    }),
    false
  );
}

function sourceIsOwnStageTsubasa(game: GameState, playerId: string, sourceCardId: string): boolean {
  const player = getPlayerById(game, playerId);
  const sourceCard = getCardById(game, sourceCardId);
  if (
    !player ||
    !sourceCard ||
    sourceCard.ownerId !== playerId ||
    !isMemberCardData(sourceCard.data) ||
    !cardCodeMatchesBase(sourceCard.data.cardCode, 'PL!-bp5-111')
  ) {
    return false;
  }
  return [SlotPosition.LEFT, SlotPosition.CENTER, SlotPosition.RIGHT].some(
    (slot) => player.memberSlots.slots[slot] === sourceCardId
  );
}

function getWaitingStageMemberTargets(game: GameState, controllerId: string): readonly string[] {
  const player = getPlayerById(game, controllerId);
  const opponent = player ? getOpponent(game, player.id) : null;
  return player && opponent
    ? [
        ...getWaitingStageMemberCardIds(game, player.id),
        ...getWaitingStageMemberCardIds(game, opponent.id),
      ]
    : [];
}

function getWaitingStageMemberCardIds(game: GameState, playerId: string): readonly string[] {
  const player = getPlayerById(game, playerId);
  if (!player) {
    return [];
  }
  return getStageMemberCardIdsMatching(game, playerId, (card) => {
    const orientation = player.memberSlots.cardStates.get(card.instanceId)?.orientation;
    return isMemberCardData(card.data) && orientation === OrientationState.WAITING;
  });
}

function findWaitingStageMember(
  game: GameState,
  cardId: string
): { readonly playerId: string } | null {
  for (const player of game.players) {
    if (
      Object.values(player.memberSlots.slots).includes(cardId) &&
      player.memberSlots.cardStates.get(cardId)?.orientation === OrientationState.WAITING
    ) {
      const card = getCardById(game, cardId);
      return card && isMemberCardData(card.data) ? { playerId: player.id } : null;
    }
  }
  return null;
}

function getWaitingRoomLiveCandidateIds(game: GameState, playerId: string): readonly string[] {
  return selectWaitingRoomCardIds(game, playerId, typeIs(CardType.LIVE));
}

function getStringMetadata(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function getStringArrayMetadata(value: unknown): readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string') ? value : [];
}
