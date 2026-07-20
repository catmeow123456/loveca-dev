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
import { resolveEnergySelectionForOperation } from '../../../effects/energy-selection.js';
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
const SELECT_TARGET_TYPE_STEP_ID = 'PL_N_BP4_008_SELECT_TARGET_TYPE';
const SELECT_ACTIVE_TARGET_STEP_ID = 'PL_N_BP4_008_SELECT_ACTIVE_TARGET';
const ACTIVATE_ENERGY_OPTION_ID = 'activate-energy';
const ACTIVATE_MEMBER_OPTION_ID = 'activate-nijigasaki-member';

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
    SELECT_TARGET_TYPE_STEP_ID,
    (game, input, context) =>
      finishEmmaTargetTypeSelection(
        game,
        input.selectedOptionId ?? null,
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
    getActivationTypeOptions(game, player.id).length === 0
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
    getActivationTypeOptions(game, player.id).length === 0
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

  const selectableOptions = getActivationTypeOptions(state, player.id);
  if (selectableOptions.length === 0) {
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

  const effectAfterDiscard = {
    ...effect,
    metadata: {
      ...effect.metadata,
      discardedCardIds: discardResult.discardedCardIds,
    },
  };
  return addAction(
    {
      ...state,
      activeEffect: {
        ...effectAfterDiscard,
        stepId: SELECT_TARGET_TYPE_STEP_ID,
        stepText: '请选择要执行的效果。',
        selectableCardIds: undefined,
        selectableCardVisibility: undefined,
        selectableOptions,
        effectChoice: {
          mode: 'SINGLE',
          options: [
            {
              id: ACTIVATE_ENERGY_OPTION_ID,
              text: '将1张能量变为活跃状态。',
              selectable: selectableOptions.some(
                (option) => option.id === ACTIVATE_ENERGY_OPTION_ID
              ),
            },
            {
              id: ACTIVATE_MEMBER_OPTION_ID,
              text: '将1名『虹ヶ咲』成员变为活跃状态。',
              selectable: selectableOptions.some(
                (option) => option.id === ACTIVATE_MEMBER_OPTION_ID
              ),
            },
          ],
          minSelections: 1,
          maxSelections: 1,
          publicConfirmation: true,
        },
        selectionLabel: undefined,
        confirmSelectionLabel: '确定',
        canSkipSelection: false,
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      sourceSlot: effect.metadata?.sourceSlot ?? null,
      step: 'DISCARD_COST_SELECT_TARGET_TYPE',
      discardedCardIds: discardResult.discardedCardIds,
      selectableOptionIds: selectableOptions.map((option) => option.id),
    }
  );
}

function finishEmmaTargetTypeSelection(
  game: GameState,
  selectedOptionId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !==
      PL_N_BP4_008_ACTIVATED_DISCARD_ACTIVATE_ENERGY_OR_NIJIGASAKI_MEMBER_ABILITY_ID ||
    effect.stepId !== SELECT_TARGET_TYPE_STEP_ID ||
    !selectedOptionId ||
    effect.selectableOptions?.some((option) => option.id === selectedOptionId) !== true
  ) {
    return game;
  }
  return beginEmmaTargetSelection(
    game,
    effect,
    selectedOptionId,
    continuePendingCardEffects
  );
}

function beginEmmaTargetSelection(
  game: GameState,
  effect: NonNullable<GameState['activeEffect']>,
  selectedOptionId: string,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, effect.controllerId);
  if (!player) return game;

  if (selectedOptionId === ACTIVATE_ENERGY_OPTION_ID) {
    if (player.energyZone.cardIds.length === 0) {
      return finishEmmaEnergyNoChange(game, effect, continuePendingCardEffects, {
        step: 'ACTIVATE_ENERGY_BRANCH_STALE',
      });
    }
    const energySelection = resolveEnergySelectionForOperation(
      game,
      player.id,
      'ACTIVATE_WAITING_ENERGY',
      1
    );
    const selectedEnergyCardId = energySelection?.selectedEnergyCardIds[0] ?? null;
    if (!energySelection || !selectedEnergyCardId) {
      return finishEmmaEnergyNoChange(game, effect, continuePendingCardEffects, {
        step: 'ACTIVATE_ENERGY',
      });
    }
    return finishEmmaActivateEnergy(
      energySelection.gameState,
      effect,
      selectedEnergyCardId,
      continuePendingCardEffects
    );
  }

  if (selectedOptionId !== ACTIVATE_MEMBER_OPTION_ID) return game;
  const waitingMemberCardIds = getWaitingNijigasakiMemberTargetIds(game, player.id);
  if (waitingMemberCardIds.length === 0) return game;
  return startEmmaConcreteTargetSelection(game, effect, selectedOptionId, waitingMemberCardIds);
}

function startEmmaConcreteTargetSelection(
  game: GameState,
  effect: NonNullable<GameState['activeEffect']>,
  targetType: string,
  selectableCardIds: readonly string[]
): GameState {
  const isEnergy = targetType === ACTIVATE_ENERGY_OPTION_ID;
  return addAction(
    {
      ...game,
      activeEffect: {
        ...effect,
        stepId: SELECT_ACTIVE_TARGET_STEP_ID,
        stepText: isEnergy
          ? '请选择1张待机状态能量变为活跃状态。'
          : '请选择1名待机状态「虹咲」成员变为活跃状态。',
        effectChoice: undefined,
        selectableOptions: undefined,
        selectableCardIds,
        selectableCardVisibility: 'PUBLIC',
        selectionLabel: isEnergy ? '选择要变为活跃状态的能量' : '选择要变为活跃状态的成员',
        confirmSelectionLabel: '变为活跃状态',
        canSkipSelection: false,
        metadata: {
          ...effect.metadata,
          targetType,
        },
      },
    },
    'RESOLVE_ABILITY',
    effect.controllerId,
    {
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      sourceSlot: effect.metadata?.sourceSlot ?? null,
      step: isEnergy ? 'SELECT_ENERGY_TARGET' : 'SELECT_MEMBER_TARGET',
      discardedCardIds: getDiscardedCardIds(effect.metadata),
      selectableCardIds,
    }
  );
}

function finishEmmaEnergyNoChange(
  game: GameState,
  effect: NonNullable<GameState['activeEffect']>,
  continuePendingCardEffects: ContinuePendingCardEffects,
  payload: Readonly<Record<string, unknown>>
): GameState {
  return continuePendingCardEffects(
    addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', effect.controllerId, {
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      sourceSlot: effect.metadata?.sourceSlot ?? null,
      discardedCardIds: getDiscardedCardIds(effect.metadata),
      selectedTargetType: ACTIVATE_ENERGY_OPTION_ID,
      activatedEnergyCardIds: [],
      activatedMemberCardId: null,
      stateChanged: false,
      ...payload,
    }),
    false
  );
}

function finishEmmaActivateEnergy(
  game: GameState,
  effect: NonNullable<GameState['activeEffect']>,
  selectedCardId: string,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, effect.controllerId);
  if (!player || !isEnergyTarget(game, player.id, selectedCardId)) return game;
  const previousOrientation = player.energyZone.cardStates.get(selectedCardId)?.orientation;
  if (previousOrientation !== OrientationState.WAITING) {
    return finishEmmaEnergyNoChange(game, effect, continuePendingCardEffects, {
      step: 'ACTIVATE_ENERGY',
      previousOrientation,
      nextOrientation: OrientationState.ACTIVE,
    });
  }
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
    addAction(
      { ...orientationResult.gameState, activeEffect: null },
      'RESOLVE_ABILITY',
      player.id,
      {
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        sourceSlot: effect.metadata?.sourceSlot ?? null,
        step: 'ACTIVATE_ENERGY',
        discardedCardIds: getDiscardedCardIds(effect.metadata),
        selectedEnergyCardId: selectedCardId,
        activatedEnergyCardIds: orientationResult.updatedEnergyCardIds,
        activatedMemberCardId: null,
        previousOrientation: orientationResult.previousOrientations[0]?.orientation,
        nextOrientation: orientationResult.nextOrientation,
        stateChanged: orientationResult.updatedEnergyCardIds.length > 0,
      }
    ),
    false
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
    effect.selectableCardIds?.includes(selectedCardId) !== true
  ) {
    return game;
  }

  if (effect.metadata?.targetType === ACTIVATE_ENERGY_OPTION_ID) {
    if (!isEnergyTarget(game, player.id, selectedCardId)) return game;
    return finishEmmaActivateEnergy(game, effect, selectedCardId, continuePendingCardEffects);
  }

  if (
    effect.metadata?.targetType !== ACTIVATE_MEMBER_OPTION_ID ||
    !isWaitingNijigasakiMemberTarget(game, player.id, selectedCardId)
  ) {
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

function getActivationTypeOptions(
  game: GameState,
  playerId: string
): readonly { readonly id: string; readonly label: string }[] {
  const player = getPlayerById(game, playerId);
  if (!player) return [];
  return [
    ...(player.energyZone.cardIds.length > 0
      ? [{ id: ACTIVATE_ENERGY_OPTION_ID, label: '将1张能量变为活跃状态' }]
      : []),
    ...(getWaitingNijigasakiMemberTargetIds(game, player.id).length > 0
      ? [{ id: ACTIVATE_MEMBER_OPTION_ID, label: '将1名「虹咲」成员变为活跃状态' }]
      : []),
  ];
}

function getWaitingNijigasakiMemberTargetIds(
  game: GameState,
  playerId: string
): readonly string[] {
  const player = getPlayerById(game, playerId);
  if (!player) return [];
  return Object.values(player.memberSlots.slots).filter(
    (cardId): cardId is string =>
      cardId !== null && isWaitingNijigasakiMemberTarget(game, player.id, cardId)
  );
}

function isEnergyTarget(game: GameState, playerId: string, cardId: string): boolean {
  const player = getPlayerById(game, playerId);
  return (
    player?.energyZone.cardIds.includes(cardId) === true && player.energyZone.cardStates.has(cardId)
  );
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
