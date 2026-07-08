import { isMemberCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
} from '../../../../domain/entities/game.js';
import { GamePhase, OrientationState } from '../../../../shared/types/enums.js';
import { cardCodeMatchesBase } from '../../../../shared/utils/card-code.js';
import { groupAliasIs } from '../../../effects/card-selectors.js';
import { setEnergyOrientation } from '../../../effects/energy.js';
import { setMemberOrientation } from '../../../effects/member-state.js';
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
import { PL_N_BP4_008_ACTIVATED_DISCARD_ACTIVATE_ENERGY_OR_NIJIGASAKI_MEMBER_ABILITY_ID } from '../../ability-ids.js';

const SELECT_DISCARD_STEP_ID = 'PL_N_BP4_008_SELECT_DISCARD_COST';
const SELECT_ACTIVE_TARGET_STEP_ID = 'PL_N_BP4_008_SELECT_ACTIVE_TARGET';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;
type EnqueueTriggeredCardEffects = EnqueueTriggeredCardEffectsForEnterWaitingRoom &
  EnqueueTriggeredCardEffectsForMemberStateChanged;

const isNijigasakiCard = groupAliasIs('虹ヶ咲');

export function registerNBp4008EmmaWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffects;
}): void {
  registerActivatedAbilityHandler(
    PL_N_BP4_008_ACTIVATED_DISCARD_ACTIVATE_ENERGY_OR_NIJIGASAKI_MEMBER_ABILITY_ID,
    (game, playerId, cardId) => startEmmaActivatedWorkflow(game, playerId, cardId)
  );
  registerActiveEffectStepHandler(
    PL_N_BP4_008_ACTIVATED_DISCARD_ACTIVATE_ENERGY_OR_NIJIGASAKI_MEMBER_ABILITY_ID,
    SELECT_DISCARD_STEP_ID,
    (game, input, context) =>
      finishEmmaDiscardCost(
        game,
        input.selectedCardId ?? null,
        deps.enqueueTriggeredCardEffects,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    PL_N_BP4_008_ACTIVATED_DISCARD_ACTIVATE_ENERGY_OR_NIJIGASAKI_MEMBER_ABILITY_ID,
    SELECT_ACTIVE_TARGET_STEP_ID,
    (game, input, context) =>
      finishEmmaActivateTarget(
        game,
        input.selectedCardId ?? null,
        deps.enqueueTriggeredCardEffects,
        context.continuePendingCardEffects
      )
  );
}

function startEmmaActivatedWorkflow(
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
    !isEmmaSourceOnOwnStage(game, player.id, sourceCardId) ||
    player.hand.cardIds.length === 0 ||
    getActiveTargetIds(game, player.id).length === 0
  ) {
    return game;
  }

  return addAction(
    {
      ...game,
      activeEffect: {
        id: `${PL_N_BP4_008_ACTIVATED_DISCARD_ACTIVATE_ENERGY_OR_NIJIGASAKI_MEMBER_ABILITY_ID}:${sourceCardId}:turn-${game.turnCount}:action-${game.actionHistory.length}`,
        abilityId:
          PL_N_BP4_008_ACTIVATED_DISCARD_ACTIVATE_ENERGY_OR_NIJIGASAKI_MEMBER_ABILITY_ID,
        sourceCardId,
        controllerId: player.id,
        effectText: getAbilityEffectText(
          PL_N_BP4_008_ACTIVATED_DISCARD_ACTIVATE_ENERGY_OR_NIJIGASAKI_MEMBER_ABILITY_ID
        ),
        stepId: SELECT_DISCARD_STEP_ID,
        stepText: '请选择1张手牌放置入休息室。',
        awaitingPlayerId: player.id,
        selectableCardIds: player.hand.cardIds,
        selectableCardVisibility: 'AWAITING_PLAYER_ONLY',
        selectionLabel: '选择要放置入休息室的手牌',
        confirmSelectionLabel: '放置入休息室',
        canSkipSelection: false,
        metadata: {
          sourceSlot,
          effectCosts: [
            {
              kind: 'DISCARD_HAND_TO_WAITING_ROOM',
              minCount: 1,
              maxCount: 1,
              optional: false,
            },
          ],
          handToWaitingRoomCost: {
            minCount: 1,
            maxCount: 1,
            optional: false,
          },
        },
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      abilityId: PL_N_BP4_008_ACTIVATED_DISCARD_ACTIVATE_ENERGY_OR_NIJIGASAKI_MEMBER_ABILITY_ID,
      sourceCardId,
      sourceSlot,
      step: 'START_SELECT_DISCARD_COST',
      selectableCardIds: player.hand.cardIds,
    }
  );
}

function finishEmmaDiscardCost(
  game: GameState,
  selectedCardId: string | null,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffects,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  const player = effect ? getPlayerById(game, effect.controllerId) : null;
  if (
    !effect ||
    effect.abilityId !==
      PL_N_BP4_008_ACTIVATED_DISCARD_ACTIVATE_ENERGY_OR_NIJIGASAKI_MEMBER_ABILITY_ID ||
    effect.stepId !== SELECT_DISCARD_STEP_ID ||
    !player ||
    !selectedCardId ||
    effect.selectableCardIds?.includes(selectedCardId) !== true ||
    !player.hand.cardIds.includes(selectedCardId) ||
    getActiveTargetIds(game, player.id).length === 0
  ) {
    return game;
  }

  const discardResult = discardOneHandCardToWaitingRoomAndEnqueueTriggers(
    game,
    player.id,
    selectedCardId,
    { candidateCardIds: effect.selectableCardIds ?? [] },
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

  const selectableCardIds = getActiveTargetIds(state, player.id);
  if (selectableCardIds.length === 0) {
    return continuePendingCardEffects(
      addAction({ ...state, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        sourceSlot: effect.metadata?.sourceSlot ?? null,
        step: 'DISCARD_COST_NO_ACTIVE_TARGETS',
        discardedCardIds: discardResult.discardedCardIds,
        activatedEnergyCardIds: [],
        activatedMemberCardId: null,
      }),
      false
    );
  }

  return addAction(
    {
      ...state,
      activeEffect: {
        ...effect,
        stepId: SELECT_ACTIVE_TARGET_STEP_ID,
        stepText: '请选择1张待机状态能量或1名待机状态「虹咲」成员变为活跃状态。',
        selectableCardIds,
        selectableCardVisibility: 'PUBLIC',
        selectionLabel: '选择变为活跃状态的目标',
        confirmSelectionLabel: '变为活跃状态',
        canSkipSelection: false,
        metadata: {
          ...effect.metadata,
          discardedCardIds: discardResult.discardedCardIds,
        },
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      sourceSlot: effect.metadata?.sourceSlot ?? null,
      step: 'DISCARD_COST_SELECT_ACTIVE_TARGET',
      discardedCardIds: discardResult.discardedCardIds,
      selectableCardIds,
    }
  );
}

function finishEmmaActivateTarget(
  game: GameState,
  selectedCardId: string | null,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForMemberStateChanged,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  const player = effect ? getPlayerById(game, effect.controllerId) : null;
  if (
    !effect ||
    effect.abilityId !==
      PL_N_BP4_008_ACTIVATED_DISCARD_ACTIVATE_ENERGY_OR_NIJIGASAKI_MEMBER_ABILITY_ID ||
    effect.stepId !== SELECT_ACTIVE_TARGET_STEP_ID ||
    !player ||
    !selectedCardId ||
    effect.selectableCardIds?.includes(selectedCardId) !== true ||
    !getActiveTargetIds(game, player.id).includes(selectedCardId)
  ) {
    return game;
  }

  if (isWaitingEnergyTarget(game, player.id, selectedCardId)) {
    const orientationResult = setEnergyOrientation(
      game,
      player.id,
      [selectedCardId],
      OrientationState.ACTIVE
    );
    if (
      !orientationResult ||
      orientationResult.previousOrientations[0]?.orientation !== OrientationState.WAITING
    ) {
      return game;
    }
    return continuePendingCardEffects(
      addAction({ ...orientationResult.gameState, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        sourceSlot: effect.metadata?.sourceSlot ?? null,
        step: 'ACTIVATE_ENERGY',
        discardedCardIds: getDiscardedCardIds(effect.metadata),
        activatedEnergyCardIds: orientationResult.updatedEnergyCardIds,
        activatedMemberCardId: null,
      }),
      false
    );
  }

  if (!isWaitingNijigasakiMemberTarget(game, player.id, selectedCardId)) {
    return game;
  }
  const orientationResult = setMemberOrientation(
    game,
    player.id,
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
    return game;
  }

  const triggerResult = enqueueMemberStateChangedTriggersFromOrientationResult(
    game,
    orientationResult,
    enqueueTriggeredCardEffects,
    {
      prepareGameStateBeforeEnqueue: (stateAfterActivate, result, events) =>
        addAction(stateAfterActivate, 'RESOLVE_ABILITY', player.id, {
          abilityId: effect.abilityId,
          sourceCardId: effect.sourceCardId,
          sourceSlot: effect.metadata?.sourceSlot ?? null,
          step: 'ACTIVATE_NIJIGASAKI_MEMBER',
          discardedCardIds: getDiscardedCardIds(effect.metadata),
          activatedEnergyCardIds: [],
          activatedMemberCardId: selectedCardId,
          previousOrientation: result.previousOrientation,
          nextOrientation: result.nextOrientation,
          memberStateChangedEventIds: events.map((event) => event.eventId),
        }),
    }
  );

  return continuePendingCardEffects(
    { ...triggerResult.gameState, activeEffect: null },
    false
  );
}

function getActiveTargetIds(game: GameState, playerId: string): readonly string[] {
  const player = getPlayerById(game, playerId);
  if (!player) {
    return [];
  }
  return [
    ...player.energyZone.cardIds.filter((cardId) => isWaitingEnergyTarget(game, player.id, cardId)),
    ...Object.values(player.memberSlots.slots).filter(
      (cardId): cardId is string =>
        cardId !== null && isWaitingNijigasakiMemberTarget(game, player.id, cardId)
    ),
  ];
}

function isWaitingEnergyTarget(game: GameState, playerId: string, cardId: string): boolean {
  const player = getPlayerById(game, playerId);
  return player?.energyZone.cardStates.get(cardId)?.orientation === OrientationState.WAITING;
}

function isWaitingNijigasakiMemberTarget(
  game: GameState,
  playerId: string,
  cardId: string
): boolean {
  const player = getPlayerById(game, playerId);
  const card = getCardById(game, cardId);
  const state = player?.memberSlots.cardStates.get(cardId);
  return (
    card !== null &&
    isMemberCardData(card.data) &&
    isNijigasakiCard(card) &&
    state?.orientation === OrientationState.WAITING
  );
}

function isEmmaSourceOnOwnStage(game: GameState, playerId: string, sourceCardId: string): boolean {
  const card = getCardById(game, sourceCardId);
  return (
    card !== null &&
    card.ownerId === playerId &&
    isMemberCardData(card.data) &&
    cardCodeMatchesBase(card.data.cardCode, 'PL!N-bp4-008') &&
    getSourceMemberSlot(game, playerId, sourceCardId) !== null
  );
}

function getDiscardedCardIds(metadata: Readonly<Record<string, unknown>> | undefined): readonly string[] {
  const value = metadata?.discardedCardIds;
  return Array.isArray(value)
    ? value.filter((candidate): candidate is string => typeof candidate === 'string')
    : [];
}
