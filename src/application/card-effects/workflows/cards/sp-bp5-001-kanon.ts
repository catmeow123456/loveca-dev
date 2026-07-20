import { isMemberCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getOpponent,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
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
import { cardCodeMatchesBase } from '../../../../shared/utils/card-code.js';
import { costLte, typeIs, and } from '../../../effects/card-selectors.js';
import { getEnergyCardIdsByOrientation } from '../../../effects/energy.js';
import { payImmediateEffectCosts } from '../../../effects/effect-costs.js';
import { getEnergySelectionCandidates } from '../../../effects/energy-selection.js';
import { setMemberOrientation } from '../../../effects/member-state.js';
import {
  getStageMemberOrientationTargetMetadata,
  resolveStageMemberOrientationTargetSelection,
  createStageMemberOrientationTargetSelection,
} from '../../../effects/stage-member-target-selection.js';
import { getStageMemberCardIdsMatching } from '../../../effects/stage-targets.js';
import {
  SP_BP5_001_ACTIVATED_WAIT_SELF_OR_DISCARD_ACTIVATE_ENERGY_ABILITY_ID,
  SP_BP5_001_LIVE_START_PAY_ENERGY_WAIT_OPPONENT_OR_DRAW_ABILITY_ID,
  SP_BP5_001_ON_ENTER_PAY_ENERGY_WAIT_OPPONENT_OR_DRAW_ABILITY_ID,
} from '../../ability-ids.js';
import { registerActivatedAbilityHandler } from '../../runtime/activated-registry.js';
import { drawCardsForPlayer, activateWaitingEnergyCardsForPlayer } from '../../runtime/actions.js';
import { discardOneHandCardToWaitingRoomAndEnqueueTriggers } from '../../runtime/enter-waiting-room-triggers.js';
import {
  enqueueMemberStateChangedTriggersFromOrientationResult,
  type EnqueueTriggeredCardEffectsForMemberStateChanged,
} from '../../runtime/member-state-changed-triggers.js';
import { getSourceMemberSlot } from '../../runtime/source-member.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import {
  getAbilityEffectText,
  recordAbilityUseForContext,
  recordPayCostAction,
} from '../../runtime/workflow-helpers.js';

const PAY_DECISION_STEP_ID = 'SP_BP5_001_PAY_ENERGY_DECISION';
const EFFECT_OPTION_STEP_ID = 'SP_BP5_001_SELECT_PAID_EFFECT';
const WAIT_OPPONENT_STEP_ID = 'SP_BP5_001_SELECT_OPPONENT_COST_LTE_FOUR_MEMBER';
const ACTIVATED_COST_STEP_ID = 'SP_BP5_001_SELECT_ACTIVATED_COST';
const ACTIVATED_DISCARD_STEP_ID = 'SP_BP5_001_SELECT_HAND_DISCARD_COST';

const PAY_OPTION_ID = 'pay';
const DRAW_OPTION_ID = 'draw';
const WAIT_OPPONENT_OPTION_ID = 'wait-opponent';
const WAIT_SELF_COST_OPTION_ID = 'wait-self';
const DISCARD_HAND_COST_OPTION_ID = 'discard-hand';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;
type EnqueueTriggeredCardEffects = EnqueueTriggeredCardEffectsForMemberStateChanged &
  ((
    game: GameState,
    triggerConditions: readonly TriggerCondition[],
    options?: {
      readonly enterWaitingRoomEvents?: readonly EnterWaitingRoomEvent[];
      readonly memberStateChangedEvents?: readonly MemberStateChangedEvent[];
    }
  ) => GameState);

interface PayEnergyWorkflowConfig {
  readonly abilityId: string;
  readonly triggerCondition: TriggerCondition;
  readonly startStep: string;
}

const PAY_ENERGY_WORKFLOWS: readonly PayEnergyWorkflowConfig[] = [
  {
    abilityId: SP_BP5_001_ON_ENTER_PAY_ENERGY_WAIT_OPPONENT_OR_DRAW_ABILITY_ID,
    triggerCondition: TriggerCondition.ON_ENTER_STAGE,
    startStep: 'START_ON_ENTER_PAY_ENERGY_DECISION',
  },
  {
    abilityId: SP_BP5_001_LIVE_START_PAY_ENERGY_WAIT_OPPONENT_OR_DRAW_ABILITY_ID,
    triggerCondition: TriggerCondition.ON_LIVE_START,
    startStep: 'START_LIVE_START_PAY_ENERGY_DECISION',
  },
];

const lowCostOpponentMemberSelector = and(typeIs(CardType.MEMBER), costLte(4));

export function registerSpBp5001KanonWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffects;
}): void {
  for (const config of PAY_ENERGY_WORKFLOWS) {
    registerPendingAbilityStarterHandler(config.abilityId, (game, ability, options, context) =>
      startPayEnergyChoice(
        game,
        ability,
        config,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
    );
    registerActiveEffectStepHandler(config.abilityId, PAY_DECISION_STEP_ID, (game, input, context) =>
      finishPayEnergyDecision(
        game,
        input.selectedOptionId ?? null,
        context.continuePendingCardEffects
      )
    );
    registerActiveEffectStepHandler(
      config.abilityId,
      EFFECT_OPTION_STEP_ID,
      (game, input, context) =>
        finishPaidEffectOption(
          game,
          input.selectedOptionId ?? null,
          context.continuePendingCardEffects
        )
    );
    registerActiveEffectStepHandler(config.abilityId, WAIT_OPPONENT_STEP_ID, (game, input, context) =>
      finishWaitOpponentLowCostMember(
        game,
        input.selectedCardId ?? null,
        context.continuePendingCardEffects,
        deps.enqueueTriggeredCardEffects
      )
    );
  }

  registerActivatedAbilityHandler(
    SP_BP5_001_ACTIVATED_WAIT_SELF_OR_DISCARD_ACTIVATE_ENERGY_ABILITY_ID,
    (game, playerId, cardId) => startActivatedEnergyActivation(game, playerId, cardId)
  );
  registerActiveEffectStepHandler(
    SP_BP5_001_ACTIVATED_WAIT_SELF_OR_DISCARD_ACTIVATE_ENERGY_ABILITY_ID,
    ACTIVATED_COST_STEP_ID,
    (game, input) =>
      finishActivatedCostChoice(
        game,
        input.selectedOptionId ?? null,
        deps.enqueueTriggeredCardEffects
      )
  );
  registerActiveEffectStepHandler(
    SP_BP5_001_ACTIVATED_WAIT_SELF_OR_DISCARD_ACTIVATE_ENERGY_ABILITY_ID,
    ACTIVATED_DISCARD_STEP_ID,
    (game, input) =>
      finishActivatedDiscardCost(
        game,
        input.selectedCardId ?? null,
        deps.enqueueTriggeredCardEffects
      )
  );
}

function startPayEnergyChoice(
  game: GameState,
  ability: PendingAbilityState,
  config: PayEnergyWorkflowConfig,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  const sourceCard = getCardById(game, ability.sourceCardId);
  const sourceSlot = getSourceMemberSlot(game, ability.controllerId, ability.sourceCardId);
  if (
    !player ||
    !sourceCard ||
    sourceCard.ownerId !== player.id ||
    !isMemberCardData(sourceCard.data) ||
    !cardCodeMatchesBase(sourceCard.data.cardCode, 'PL!SP-bp5-001') ||
    sourceSlot === null
  ) {
    return consumePendingNoop(game, ability, orderedResolution, continuePendingCardEffects, {
      step: 'SKIP_SOURCE_NOT_ON_STAGE',
    });
  }

  const canPay =
    getEnergySelectionCandidates(game, player.id, 'TAP_ACTIVE_ENERGY').length >= 1;
  if (!canPay) {
    return consumePendingNoop(game, ability, orderedResolution, continuePendingCardEffects, {
      step: 'SKIP_NO_ACTIVE_ENERGY',
      sourceSlot,
    });
  }

  return addAction(
    {
      ...game,
      pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
      activeEffect: {
        id: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        controllerId: player.id,
        effectText: getAbilityEffectText(ability.abilityId),
        stepId: PAY_DECISION_STEP_ID,
        stepText: '可以支付[E]发动此效果。',
        awaitingPlayerId: player.id,
        selectableOptions: [{ id: PAY_OPTION_ID, label: '支付[E]' }],
        canSkipSelection: true,
        skipSelectionLabel: '不发动',
        metadata: {
          orderedResolution,
          sourceSlot,
          triggerCondition: config.triggerCondition,
        },
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      sourceSlot,
      step: config.startStep,
    }
  );
}

function finishPayEnergyDecision(
  game: GameState,
  selectedOptionId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (!effect || effect.stepId !== PAY_DECISION_STEP_ID) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  if (!player) {
    return game;
  }
  if (selectedOptionId === null) {
    return continuePendingCardEffects(
      addAction(
        {
          ...game,
          activeEffect: null,
        },
        'RESOLVE_ABILITY',
        player.id,
        {
          pendingAbilityId: effect.id,
          abilityId: effect.abilityId,
          sourceCardId: effect.sourceCardId,
          sourceSlot: effect.metadata?.sourceSlot ?? null,
          step: 'DECLINE_PAY_ENERGY',
        }
      ),
      effect.metadata?.orderedResolution === true
    );
  }
  if (selectedOptionId !== PAY_OPTION_ID) {
    return game;
  }

  const costPayment = payImmediateEffectCosts(game, player.id, effect.sourceCardId, [
    { kind: 'TAP_ACTIVE_ENERGY', count: 1 },
  ]);
  if (!costPayment) {
    return continuePendingCardEffects(
      addAction(
        {
          ...game,
          activeEffect: null,
        },
        'RESOLVE_ABILITY',
        player.id,
        {
          pendingAbilityId: effect.id,
          abilityId: effect.abilityId,
          sourceCardId: effect.sourceCardId,
          sourceSlot: effect.metadata?.sourceSlot ?? null,
          step: 'SKIP_PAY_FAILED',
        }
      ),
      effect.metadata?.orderedResolution === true
    );
  }

  const stateAfterPayCost = recordPayCostAction(costPayment.gameState, player.id, {
    pendingAbilityId: effect.id,
    abilityId: effect.abilityId,
    sourceCardId: effect.sourceCardId,
    sourceSlot: effect.metadata?.sourceSlot ?? null,
    energyCardIds: costPayment.paidEnergyCardIds,
    amount: costPayment.paidEnergyCardIds.length,
  });
  const optionIds = getPaidEffectOptions(stateAfterPayCost, player.id);

  return addAction(
    {
      ...stateAfterPayCost,
      activeEffect: {
        ...effect,
        stepId: EFFECT_OPTION_STEP_ID,
        stepText: '请选择要结算的效果。',
        selectableOptions: optionIds.map((optionId) =>
          optionId === WAIT_OPPONENT_OPTION_ID
            ? { id: WAIT_OPPONENT_OPTION_ID, label: '对方费用4以下成员WAIT' }
            : { id: DRAW_OPTION_ID, label: '抽1张卡' }
        ),
        effectChoice: {
          mode: 'SINGLE',
          options: [
            {
              id: WAIT_OPPONENT_OPTION_ID,
              text: '将对方舞台上1名费用小于等于4的成员变为待机状态。',
              selectable: optionIds.includes(WAIT_OPPONENT_OPTION_ID),
            },
            {
              id: DRAW_OPTION_ID,
              text: '抽1张卡。',
              selectable: optionIds.includes(DRAW_OPTION_ID),
            },
          ],
          minSelections: 1,
          maxSelections: 1,
          publicConfirmation: true,
        },
        metadata: {
          ...effect.metadata,
          paidEnergyCardIds: costPayment.paidEnergyCardIds,
        },
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      sourceSlot: effect.metadata?.sourceSlot ?? null,
      step: 'PAY_ENERGY_SELECT_EFFECT',
      paidEnergyCardIds: costPayment.paidEnergyCardIds,
      selectableOptionIds: optionIds,
    }
  );
}

function finishPaidEffectOption(
  game: GameState,
  selectedOptionId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (!effect || effect.stepId !== EFFECT_OPTION_STEP_ID) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  if (!player || !selectedOptionId || effect.selectableOptions?.some((option) => option.id === selectedOptionId) !== true) {
    return game;
  }

  if (selectedOptionId === DRAW_OPTION_ID) {
    const drawResult = drawCardsForPlayer(game, player.id, 1);
    const stateAfterDraw = drawResult?.gameState ?? game;
    return continuePendingCardEffects(
      addAction(
        {
          ...stateAfterDraw,
          activeEffect: null,
        },
        'RESOLVE_ABILITY',
        player.id,
        {
          pendingAbilityId: effect.id,
          abilityId: effect.abilityId,
          sourceCardId: effect.sourceCardId,
          sourceSlot: effect.metadata?.sourceSlot ?? null,
          step: 'DRAW_ONE',
          paidEnergyCardIds: getStringArray(effect.metadata?.paidEnergyCardIds),
          drawnCardIds: drawResult?.drawnCardIds ?? [],
        }
      ),
      effect.metadata?.orderedResolution === true
    );
  }

  const targetSelection = createOpponentWaitSelection(game, effect);
  if (selectedOptionId !== WAIT_OPPONENT_OPTION_ID || targetSelection.activeEffect === null) {
    return game;
  }

  return addAction(
    {
      ...game,
      activeEffect: {
        ...targetSelection.activeEffect,
        metadata: {
          ...targetSelection.activeEffect.metadata,
          paidEnergyCardIds: getStringArray(effect.metadata?.paidEnergyCardIds),
        },
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      sourceSlot: effect.metadata?.sourceSlot ?? null,
      step: 'SELECT_OPPONENT_COST_LTE_FOUR_MEMBER',
      paidEnergyCardIds: getStringArray(effect.metadata?.paidEnergyCardIds),
      selectableCardIds: targetSelection.selectableCardIds,
    }
  );
}

function finishWaitOpponentLowCostMember(
  game: GameState,
  selectedCardId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffects
): GameState {
  const effect = game.activeEffect;
  if (!effect || effect.stepId !== WAIT_OPPONENT_STEP_ID) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  const targetMetadata = getStageMemberOrientationTargetMetadata(effect);
  if (!player || !targetMetadata) {
    return game;
  }
  const orientationChange = resolveStageMemberOrientationTargetSelection(game, effect, selectedCardId);
  if (!orientationChange) {
    return game;
  }
  const stateWithMemberStateTriggers = enqueueMemberStateChangedTriggersFromOrientationResult(
    game,
    orientationChange,
    enqueueTriggeredCardEffects,
    {
      prepareGameStateBeforeEnqueue: (state, result) =>
        addAction(
          {
            ...state,
            activeEffect: null,
          },
          'RESOLVE_ABILITY',
          player.id,
          {
            pendingAbilityId: effect.id,
            abilityId: effect.abilityId,
            sourceCardId: effect.sourceCardId,
            sourceSlot: effect.metadata?.sourceSlot ?? null,
            step: 'WAIT_OPPONENT_COST_LTE_FOUR_MEMBER',
            paidEnergyCardIds: getStringArray(effect.metadata?.paidEnergyCardIds),
            targetPlayerId: targetMetadata.targetPlayerId,
            targetCardId: selectedCardId,
            previousOrientation: result.previousOrientation,
            nextOrientation: result.nextOrientation,
          }
        ),
    }
  );
  return continuePendingCardEffects(
    stateWithMemberStateTriggers.gameState,
    effect.metadata?.orderedResolution === true
  );
}

function startActivatedEnergyActivation(
  game: GameState,
  playerId: string,
  cardId: string
): GameState {
  if (game.activeEffect || game.currentPhase !== GamePhase.MAIN_PHASE) {
    return game;
  }
  const activePlayerId = game.players[game.activePlayerIndex]?.id ?? null;
  const player = getPlayerById(game, playerId);
  const sourceCard = getCardById(game, cardId);
  const sourceSlot = getSourceMemberSlot(game, playerId, cardId);
  const sourceState = player?.memberSlots.cardStates.get(cardId);
  if (
    activePlayerId !== playerId ||
    !player ||
    !sourceCard ||
    sourceCard.ownerId !== player.id ||
    !isMemberCardData(sourceCard.data) ||
    !cardCodeMatchesBase(sourceCard.data.cardCode, 'PL!SP-bp5-001') ||
    sourceSlot === null
  ) {
    return game;
  }

  const options = [
    ...(sourceState?.orientation === OrientationState.ACTIVE
      ? [{ id: WAIT_SELF_COST_OPTION_ID, label: '此成员WAIT' }]
      : []),
    ...(player.hand.cardIds.length > 0
      ? [{ id: DISCARD_HAND_COST_OPTION_ID, label: '弃1张手牌' }]
      : []),
  ];
  if (options.length === 0) {
    return game;
  }

  return {
    ...game,
    activeEffect: {
      id: `${SP_BP5_001_ACTIVATED_WAIT_SELF_OR_DISCARD_ACTIVATE_ENERGY_ABILITY_ID}:${cardId}:turn-${game.turnCount}:action-${game.actionHistory.length}`,
      abilityId: SP_BP5_001_ACTIVATED_WAIT_SELF_OR_DISCARD_ACTIVATE_ENERGY_ABILITY_ID,
      sourceCardId: cardId,
      controllerId: player.id,
      effectText: getAbilityEffectText(
        SP_BP5_001_ACTIVATED_WAIT_SELF_OR_DISCARD_ACTIVATE_ENERGY_ABILITY_ID
      ),
      stepId: ACTIVATED_COST_STEP_ID,
      stepText: '请选择起动成本。',
      awaitingPlayerId: player.id,
      selectableOptions: options,
      effectChoice: {
        mode: 'SINGLE',
        options: [
          {
            id: WAIT_SELF_COST_OPTION_ID,
            text: '将此成员变为待机状态。',
            selectable: options.some((option) => option.id === WAIT_SELF_COST_OPTION_ID),
          },
          {
            id: DISCARD_HAND_COST_OPTION_ID,
            text: '将1张手牌放置入休息室。',
            selectable: options.some((option) => option.id === DISCARD_HAND_COST_OPTION_ID),
          },
        ],
        minSelections: 1,
        maxSelections: 1,
        publicConfirmation: true,
      },
      canSkipSelection: false,
      metadata: {
        sourceSlot,
      },
    },
  };
}

function finishActivatedCostChoice(
  game: GameState,
  selectedOptionId: string | null,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffects
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== SP_BP5_001_ACTIVATED_WAIT_SELF_OR_DISCARD_ACTIVATE_ENERGY_ABILITY_ID ||
    effect.stepId !== ACTIVATED_COST_STEP_ID ||
    !selectedOptionId ||
    effect.selectableOptions?.some((option) => option.id === selectedOptionId) !== true
  ) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  if (!player) {
    return game;
  }
  if (selectedOptionId === DISCARD_HAND_COST_OPTION_ID) {
    return {
      ...game,
      activeEffect: {
        ...effect,
        stepId: ACTIVATED_DISCARD_STEP_ID,
        stepText: '请选择1张手牌放置入休息室。',
        effectChoice: undefined,
        selectableCardIds: player.hand.cardIds,
        selectableCardVisibility: 'AWAITING_PLAYER_ONLY',
        selectionLabel: '选择要放置入休息室的手牌',
        confirmSelectionLabel: '放置入休息室',
        metadata: {
          ...effect.metadata,
          selectedCost: DISCARD_HAND_COST_OPTION_ID,
        },
      },
    };
  }
  if (selectedOptionId !== WAIT_SELF_COST_OPTION_ID) {
    return game;
  }
  const waitResult = setMemberOrientation(game, player.id, effect.sourceCardId, OrientationState.WAITING, {
    kind: 'CARD_EFFECT',
    playerId: player.id,
    sourceCardId: effect.sourceCardId,
    abilityId: effect.abilityId,
  });
  if (!waitResult || waitResult.previousOrientation !== OrientationState.ACTIVE) {
    return game;
  }
  const stateWithMemberStateTriggers = enqueueMemberStateChangedTriggersFromOrientationResult(
    game,
    waitResult,
    enqueueTriggeredCardEffects,
    {
      prepareGameStateBeforeEnqueue: (state, result, memberStateChangedEvents) =>
        recordPayCostAction(state, player.id, {
          abilityId: effect.abilityId,
          sourceCardId: effect.sourceCardId,
          sourceSlot: effect.metadata?.sourceSlot ?? null,
          costType: WAIT_SELF_COST_OPTION_ID,
          waitedMemberCardId: effect.sourceCardId,
          previousOrientation: result.previousOrientation,
          nextOrientation: result.nextOrientation,
          memberStateChangedEventIds: memberStateChangedEvents.map((event) => event.eventId),
        }),
    }
  );
  return finishActivatedAfterCost(
    stateWithMemberStateTriggers.gameState,
    effect,
    player.id,
    {
      costType: WAIT_SELF_COST_OPTION_ID,
      waitedMemberCardId: effect.sourceCardId,
    }
  );
}

function finishActivatedDiscardCost(
  game: GameState,
  selectedCardId: string | null,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffects
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== SP_BP5_001_ACTIVATED_WAIT_SELF_OR_DISCARD_ACTIVATE_ENERGY_ABILITY_ID ||
    effect.stepId !== ACTIVATED_DISCARD_STEP_ID ||
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
  const stateAfterPayCost = recordPayCostAction(discardResult.gameState, player.id, {
    abilityId: effect.abilityId,
    sourceCardId: effect.sourceCardId,
    sourceSlot: effect.metadata?.sourceSlot ?? null,
    costType: DISCARD_HAND_COST_OPTION_ID,
    discardedCardId: selectedCardId,
    discardedCardIds: discardResult.discardedCardIds,
    enterWaitingRoomEventId: discardResult.enterWaitingRoomEvent?.eventId ?? null,
  });
  return finishActivatedAfterCost(stateAfterPayCost, effect, player.id, {
    costType: DISCARD_HAND_COST_OPTION_ID,
    discardedCardId: selectedCardId,
    discardedCardIds: discardResult.discardedCardIds,
  });
}

function finishActivatedAfterCost(
  game: GameState,
  effect: NonNullable<GameState['activeEffect']>,
  playerId: string,
  payload: Record<string, unknown>
): GameState {
  const stateAfterAbilityUse = recordAbilityUseForContext(game, playerId, {
    abilityId: effect.abilityId,
    sourceCardId: effect.sourceCardId,
  });
  const waitingEnergyCount = getEnergyCardIdsByOrientation(
    stateAfterAbilityUse,
    playerId,
    OrientationState.WAITING
  ).length;
  const activationCount = Math.min(1, waitingEnergyCount);
  const energyActivation = activateWaitingEnergyCardsForPlayer(
    stateAfterAbilityUse,
    playerId,
    activationCount
  );
  if (!energyActivation) {
    return game;
  }

  return addAction(
    {
      ...energyActivation.gameState,
      activeEffect: null,
    },
    'RESOLVE_ABILITY',
    playerId,
    {
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      sourceSlot: effect.metadata?.sourceSlot ?? null,
      step: 'PAY_COST_ACTIVATE_ENERGY',
      ...payload,
      activatedEnergyCardIds: energyActivation.activatedEnergyCardIds,
      previousEnergyOrientations: energyActivation.previousOrientations,
      nextEnergyOrientation: energyActivation.nextOrientation,
    }
  );
}

function consumePendingNoop(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects,
  payload: Record<string, unknown>
): GameState {
  const state = {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
  };
  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', ability.controllerId, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      ...payload,
    }),
    orderedResolution
  );
}

function getPaidEffectOptions(game: GameState, playerId: string): readonly string[] {
  return hasLegalOpponentWaitTarget(game, playerId)
    ? [WAIT_OPPONENT_OPTION_ID, DRAW_OPTION_ID]
    : [DRAW_OPTION_ID];
}

function hasLegalOpponentWaitTarget(game: GameState, playerId: string): boolean {
  const opponent = getOpponent(game, playerId);
  if (!opponent) {
    return false;
  }
  return getStageMemberCardIdsMatching(
    game,
    opponent.id,
    lowCostOpponentMemberSelector
  ).some((cardId) => opponent.memberSlots.cardStates.get(cardId)?.orientation !== OrientationState.WAITING);
}

function createOpponentWaitSelection(
  game: GameState,
  effect: NonNullable<GameState['activeEffect']>
) {
  const opponent = getOpponent(game, effect.controllerId);
  const triggerCondition =
    typeof effect.metadata?.triggerCondition === 'string'
      ? (effect.metadata.triggerCondition as TriggerCondition)
      : TriggerCondition.ON_ENTER_STAGE;
  const ability: PendingAbilityState = {
    id: effect.id,
    abilityId: effect.abilityId,
    sourceCardId: effect.sourceCardId,
    controllerId: effect.controllerId,
    mandatory: true,
    timingId: triggerCondition,
    eventIds: [],
    sourceSlot: getSourceSlotFromMetadata(effect.metadata),
  };
  if (!opponent) {
    return { selectableCardIds: [], activeEffect: null };
  }
  return createStageMemberOrientationTargetSelection(game, {
    ability,
    effectText: effect.effectText,
    stepId: WAIT_OPPONENT_STEP_ID,
    stepText: '请选择对方舞台上1名费用小于等于4的成员变为待机状态。',
    awaitingPlayerId: effect.controllerId,
    targetPlayerId: opponent.id,
    selector: lowCostOpponentMemberSelector,
    targetOrientation: OrientationState.WAITING,
    selectionLabel: '选择对方舞台上费用小于等于4的成员',
    orderedResolution: effect.metadata?.orderedResolution === true,
    metadata: {
      sourceSlot: effect.metadata?.sourceSlot ?? null,
    },
  });
}

function getSourceSlotFromMetadata(
  metadata: NonNullable<GameState['activeEffect']>['metadata']
): SlotPosition | undefined {
  const sourceSlot = metadata?.sourceSlot;
  return sourceSlot === SlotPosition.LEFT ||
    sourceSlot === SlotPosition.CENTER ||
    sourceSlot === SlotPosition.RIGHT
    ? sourceSlot
    : undefined;
}

function getStringArray(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}
