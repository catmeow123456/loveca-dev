import { isMemberCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import type { MemberStateChangedEvent } from '../../../../domain/events/game-events.js';
import { findMemberSlot } from '../../../../domain/entities/player.js';
import {
  GamePhase,
  OrientationState,
  SlotPosition,
  TriggerCondition,
} from '../../../../shared/types/enums.js';
import { groupAliasIs } from '../../../effects/card-selectors.js';
import { setMemberOrientation } from '../../../effects/member-state.js';
import { CardAbilityCategory, CardAbilitySourceZone } from '../../ability-definition-types.js';
import {
  N_BP7_022_AUTO_LIVE_PHASE_NIJIGASAKI_MEMBER_WAIT_DISCARD_ACTIVATE_ABILITY_ID,
  N_SD2_010_AUTO_NIJIGASAKI_MEMBER_WAIT_DISCARD_ACTIVATE_GAIN_TWO_BLADE_ABILITY_ID,
} from '../../ability-ids.js';
import { getCardAbilityDefinitionsForCardCode } from '../../definitions/lookup.js';
import {
  createOptionalDiscardHandToWaitingRoomActiveEffect,
  finishSkippedActiveEffect,
  startPendingActiveEffect,
} from '../../runtime/active-effect.js';
import { hasAbilityInstance } from '../../runtime/ability-instance.js';
import { canUseAbilityThisTurn } from '../../runtime/ability-turn-limit.js';
import { addBladeLiveModifierForTargetMember } from '../../runtime/actions.js';
import {
  discardOneHandCardToWaitingRoomAndEnqueueTriggers,
  type EnqueueTriggeredCardEffectsForEnterWaitingRoom,
} from '../../runtime/enter-waiting-room-triggers.js';
import {
  enqueueMemberStateChangedTriggersFromOrientationResult,
  type EnqueueTriggeredCardEffectsForMemberStateChanged,
} from '../../runtime/member-state-changed-triggers.js';
import { registerMemberStateChangedObserver } from '../../runtime/member-state-changed-observers.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import {
  getAbilityEffectText,
  recordAbilityUseForContext,
} from '../../runtime/workflow-helpers.js';

const SELECT_DISCARD_STEP_ID = 'NIJIGASAKI_MEMBER_WAITED_SELECT_DISCARD';
const SELECT_TARGET_STEP_ID = 'NIJIGASAKI_MEMBER_WAITED_SELECT_ACTIVATE_TARGET';
const MEMBER_SLOTS = [SlotPosition.LEFT, SlotPosition.CENTER, SlotPosition.RIGHT] as const;

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;
type EnqueueTriggeredCardEffects = EnqueueTriggeredCardEffectsForEnterWaitingRoom &
  EnqueueTriggeredCardEffectsForMemberStateChanged;

interface MemberWaitedDiscardActivateConfig {
  readonly abilityId: string;
  readonly requiredGamePhases?: readonly GamePhase[];
  readonly bladeBonus: number;
  readonly actionStep: string;
}

const CONFIGS: readonly MemberWaitedDiscardActivateConfig[] = [
  {
    abilityId: N_BP7_022_AUTO_LIVE_PHASE_NIJIGASAKI_MEMBER_WAIT_DISCARD_ACTIVATE_ABILITY_ID,
    requiredGamePhases: [
      GamePhase.LIVE_SET_PHASE,
      GamePhase.PERFORMANCE_PHASE,
      GamePhase.LIVE_RESULT_PHASE,
    ],
    bladeBonus: 0,
    actionStep: 'DISCARD_ACTIVATE_WAITED_NIJIGASAKI_MEMBER',
  },
  {
    abilityId: N_SD2_010_AUTO_NIJIGASAKI_MEMBER_WAIT_DISCARD_ACTIVATE_GAIN_TWO_BLADE_ABILITY_ID,
    bladeBonus: 2,
    actionStep: 'DISCARD_ACTIVATE_WAITED_NIJIGASAKI_MEMBER_GAIN_TWO_BLADE',
  },
];

export function registerMemberWaitedDiscardActivateWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffects;
}): void {
  registerMemberStateChangedObserver((game, context) =>
    enqueueMemberWaitedDiscardActivateObservers(game, context.events)
  );
  for (const config of CONFIGS) {
    registerPendingAbilityStarterHandler(config.abilityId, (game, ability, options, context) =>
      startMemberWaitedDiscardActivate(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
    );
    registerActiveEffectStepHandler(
      config.abilityId,
      SELECT_DISCARD_STEP_ID,
      (game, input, context) =>
        input.selectedCardId
          ? finishMemberWaitedDiscardActivate(
              game,
              input.selectedCardId,
              config,
              context.continuePendingCardEffects,
              deps.enqueueTriggeredCardEffects
            )
          : finishSkippedActiveEffect(game, context.continuePendingCardEffects)
    );
    registerActiveEffectStepHandler(
      config.abilityId,
      SELECT_TARGET_STEP_ID,
      (game, input, context) =>
        finishMemberWaitedTargetSelection(
          game,
          input.selectedCardId ?? null,
          config,
          context.continuePendingCardEffects,
          deps.enqueueTriggeredCardEffects
        )
    );
  }
}

function enqueueMemberWaitedDiscardActivateObservers(
  game: GameState,
  events: readonly MemberStateChangedEvent[]
): GameState {
  let state = game;
  const qualifyingEventsByController = new Map<string, MemberStateChangedEvent[]>();
  for (const event of events) {
    if (
      event.previousOrientation !== OrientationState.ACTIVE ||
      event.nextOrientation !== OrientationState.WAITING
    ) {
      continue;
    }
    const player = getPlayerById(state, event.controllerId);
    const changedCard = getCardById(state, event.cardInstanceId);
    if (
      !player ||
      !changedCard ||
      player.memberSlots.slots[event.slot] !== event.cardInstanceId ||
      !isMemberCardData(changedCard.data) ||
      !groupAliasIs('虹ヶ咲')(changedCard)
    ) {
      continue;
    }
    const controllerEvents = qualifyingEventsByController.get(player.id) ?? [];
    if (!controllerEvents.some((candidate) => candidate.eventId === event.eventId)) {
      qualifyingEventsByController.set(player.id, [...controllerEvents, event]);
    }
  }

  for (const [controllerId, controllerEvents] of qualifyingEventsByController) {
    const player = getPlayerById(state, controllerId);
    if (!player || controllerEvents.length === 0) {
      continue;
    }
    const eventIds = controllerEvents.map((event) => event.eventId);
    const changedCardIds = [
      ...new Set(controllerEvents.map((event) => event.cardInstanceId)),
    ];
    for (const sourceSlot of MEMBER_SLOTS) {
      const sourceCardId = player.memberSlots.slots[sourceSlot];
      const sourceCard = sourceCardId ? getCardById(state, sourceCardId) : null;
      if (!sourceCardId || !sourceCard) {
        continue;
      }
      const definitions = getCardAbilityDefinitionsForCardCode(sourceCard.data.cardCode).filter(
        (definition) =>
          CONFIGS.some((config) => config.abilityId === definition.abilityId) &&
          definition.category === CardAbilityCategory.AUTO &&
          definition.sourceZone === CardAbilitySourceZone.STAGE_MEMBER &&
          definition.triggerCondition === TriggerCondition.ON_MEMBER_STATE_CHANGED &&
          definition.queued &&
          definition.implemented
      );
      for (const definition of definitions) {
        const config = CONFIGS.find((candidate) => candidate.abilityId === definition.abilityId);
        if (
          !config ||
          (config.requiredGamePhases !== undefined &&
            !config.requiredGamePhases.includes(game.currentPhase)) ||
          !canUseAbilityThisTurn(state, player.id, definition.abilityId, sourceCardId)
        ) {
          continue;
        }
        const pendingAbilityId = `${definition.abilityId}:${sourceCardId}:${eventIds.join('+')}`;
        if (hasAbilityInstance(state, pendingAbilityId)) {
          continue;
        }
        const pendingAbility: PendingAbilityState = {
          id: pendingAbilityId,
          abilityId: definition.abilityId,
          sourceCardId,
          controllerId: player.id,
          mandatory: true,
          timingId: TriggerCondition.ON_MEMBER_STATE_CHANGED,
          eventIds,
          sourceSlot,
          metadata: {
            triggerKind: 'OWN_NIJIGASAKI_MEMBER_BECAME_WAITING',
            changedCardIds,
            changedControllerId: controllerId,
            changedSlots: controllerEvents.map((event) => event.slot),
            previousOrientation: OrientationState.ACTIVE,
            nextOrientation: OrientationState.WAITING,
            triggerTurnType: game.currentTurnType,
          },
        };
        state = addAction(
          { ...state, pendingAbilities: [...state.pendingAbilities, pendingAbility] },
          'TRIGGER_ABILITY',
          player.id,
          {
            pendingAbilityId,
            abilityId: definition.abilityId,
            sourceCardId,
            timingId: pendingAbility.timingId,
            sourceSlot,
            eventIds,
            changedCardIds,
            changedControllerId: controllerId,
            changedSlots: controllerEvents.map((event) => event.slot),
            previousOrientation: OrientationState.ACTIVE,
            nextOrientation: OrientationState.WAITING,
            triggerTurnType: game.currentTurnType,
          }
        );
      }
    }
  }
  return state;
}

function startMemberWaitedDiscardActivate(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }
  const changedCardIds = getStringArrayMetadata(ability.metadata?.changedCardIds);
  const selectableCardIds = getEligibleWaitedMemberCardIds(game, player.id, changedCardIds);
  if (selectableCardIds.length === 0) {
    return finishPendingWithoutPayment(
      game,
      ability,
      orderedResolution,
      continuePendingCardEffects,
      'NO_VALID_WAITED_MEMBER_TARGET'
    );
  }
  if (player.hand.cardIds.length === 0) {
    return finishPendingWithoutPayment(
      game,
      ability,
      orderedResolution,
      continuePendingCardEffects,
      'NO_HAND_TO_DISCARD'
    );
  }
  return startPendingActiveEffect(game, {
    ability,
    playerId: player.id,
    activeEffect: createOptionalDiscardHandToWaitingRoomActiveEffect({
      ability,
      playerId: player.id,
      effectText: getAbilityEffectText(ability.abilityId),
      stepId: SELECT_DISCARD_STEP_ID,
      selectableCardIds: player.hand.cardIds,
      orderedResolution,
      metadata: {
        changedCardIds,
        changedControllerId: ability.metadata?.changedControllerId,
        triggerEventIds: ability.eventIds,
        triggerTurnType: ability.metadata?.triggerTurnType,
      },
    }),
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      step: 'START_OPTIONAL_DISCARD',
      changedCardIds,
      changedControllerId: ability.metadata?.changedControllerId,
      selectableCardIds: player.hand.cardIds,
    },
  });
}

function finishMemberWaitedDiscardActivate(
  game: GameState,
  discardCardId: string,
  config: MemberWaitedDiscardActivateConfig,
  continuePendingCardEffects: ContinuePendingCardEffects,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffects
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== config.abilityId ||
    effect.stepId !== SELECT_DISCARD_STEP_ID ||
    effect.selectableCardIds?.includes(discardCardId) !== true
  ) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  if (!player || !player.hand.cardIds.includes(discardCardId)) {
    return game;
  }
  const discardResult = discardOneHandCardToWaitingRoomAndEnqueueTriggers(
    game,
    player.id,
    discardCardId,
    { candidateCardIds: effect.selectableCardIds ?? [] },
    enqueueTriggeredCardEffects
  );
  if (!discardResult) {
    return game;
  }

  let state = addAction(discardResult.gameState, 'PAY_COST', player.id, {
    pendingAbilityId: effect.id,
    abilityId: effect.abilityId,
    sourceCardId: effect.sourceCardId,
    discardedCardIds: discardResult.discardedCardIds,
  });
  state = recordAbilityUseForContext(state, player.id, {
    abilityId: effect.abilityId,
    sourceCardId: effect.sourceCardId,
    sourceLifecycleId: effect.sourceLifecycleId,
    pendingAbilityId: effect.id,
  });

  const changedCardIds = getStringArrayMetadata(effect.metadata?.changedCardIds);
  const selectableCardIds = getEligibleWaitedMemberCardIds(state, player.id, changedCardIds);
  const stateWithPaymentMetadata: GameState = {
    ...state,
    activeEffect: {
      ...effect,
      metadata: {
        ...effect.metadata,
        discardedCardIds: discardResult.discardedCardIds,
      },
    },
  };
  if (selectableCardIds.length === 0) {
    return finishPaidEffectWithoutTarget(
      stateWithPaymentMetadata,
      config,
      continuePendingCardEffects,
      'PAID_COST_TARGETS_NO_LONGER_AVAILABLE'
    );
  }
  if (selectableCardIds.length === 1) {
    return resolveMemberWaitedDiscardActivateTarget(
      stateWithPaymentMetadata,
      selectableCardIds[0]!,
      config,
      continuePendingCardEffects,
      enqueueTriggeredCardEffects
    );
  }

  return addAction(
    {
      ...stateWithPaymentMetadata,
      activeEffect: {
        ...stateWithPaymentMetadata.activeEffect!,
        stepId: SELECT_TARGET_STEP_ID,
        stepText: '请选择1名因此变为待机状态的『虹咲』成员变为活跃状态。',
        selectableCardIds,
        selectableCardVisibility: 'PUBLIC',
        selectableCardMode: 'SINGLE',
        minSelectableCards: undefined,
        maxSelectableCards: undefined,
        autoSubmitSingleSelection: undefined,
        selectableOptions: undefined,
        effectChoice: undefined,
        selectionLabel: '选择要变为活跃状态的成员',
        confirmSelectionLabel: '变为活跃状态',
        canSkipSelection: false,
        skipSelectionLabel: undefined,
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'PAID_DISCARD_SELECT_ACTIVATE_TARGET',
      discardedCardIds: discardResult.discardedCardIds,
      selectableCardIds,
    }
  );
}

function finishMemberWaitedTargetSelection(
  game: GameState,
  selectedCardId: string | null,
  config: MemberWaitedDiscardActivateConfig,
  continuePendingCardEffects: ContinuePendingCardEffects,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffects
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== config.abilityId ||
    effect.stepId !== SELECT_TARGET_STEP_ID ||
    !selectedCardId ||
    effect.selectableCardIds?.includes(selectedCardId) !== true
  ) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  if (!player) {
    return game;
  }
  const changedCardIds = getStringArrayMetadata(effect.metadata?.changedCardIds);
  const currentSelectableCardIds = getEligibleWaitedMemberCardIds(
    game,
    player.id,
    changedCardIds
  );
  if (!currentSelectableCardIds.includes(selectedCardId)) {
    if (currentSelectableCardIds.length === 0) {
      return finishPaidEffectWithoutTarget(
        game,
        config,
        continuePendingCardEffects,
        'PAID_COST_TARGETS_NO_LONGER_AVAILABLE'
      );
    }
    return {
      ...game,
      activeEffect: { ...effect, selectableCardIds: currentSelectableCardIds },
    };
  }

  return resolveMemberWaitedDiscardActivateTarget(
    game,
    selectedCardId,
    config,
    continuePendingCardEffects,
    enqueueTriggeredCardEffects
  );
}

function resolveMemberWaitedDiscardActivateTarget(
  game: GameState,
  targetCardId: string,
  config: MemberWaitedDiscardActivateConfig,
  continuePendingCardEffects: ContinuePendingCardEffects,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffects
): GameState {
  const effect = game.activeEffect;
  const player = effect ? getPlayerById(game, effect.controllerId) : null;
  if (!effect || effect.abilityId !== config.abilityId || !player) {
    return game;
  }
  const changedCardIds = getStringArrayMetadata(effect.metadata?.changedCardIds);
  if (!getEligibleWaitedMemberCardIds(game, player.id, changedCardIds).includes(targetCardId)) {
    return game;
  }

  const targetSlot = findMemberSlot(player, targetCardId);
  const orientationResult = setMemberOrientation(
    game,
    player.id,
    targetCardId,
    OrientationState.ACTIVE,
    {
      kind: 'CARD_EFFECT',
      playerId: player.id,
      sourceCardId: effect.sourceCardId,
      abilityId: effect.abilityId,
      pendingAbilityId: effect.id,
    }
  );
  let stateAfterEffect = orientationResult?.gameState ?? game;
  const bladeResult =
    orientationResult && config.bladeBonus > 0
      ? addBladeLiveModifierForTargetMember(stateAfterEffect, {
          playerId: player.id,
          sourceCardId: effect.sourceCardId,
          targetMemberCardId: targetCardId,
          abilityId: effect.abilityId,
          amount: config.bladeBonus,
        })
      : null;
  stateAfterEffect = bladeResult?.gameState ?? stateAfterEffect;

  const finishState = (current: GameState, memberStateChangedEventIds: readonly string[]) =>
    addAction({ ...current, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: config.actionStep,
      discardedCardIds: getStringArrayMetadata(effect.metadata?.discardedCardIds),
      targetMemberCardId: targetCardId,
      targetStillOnStage: targetSlot !== null,
      targetSlot,
      activated: orientationResult?.changed === true,
      blockedByEffectActivationProhibition:
        orientationResult?.blockedByEffectActivationProhibition ?? false,
      bladeBonus: bladeResult?.bladeBonus ?? 0,
      memberStateChangedEventIds,
    });

  if (!orientationResult) {
    return continuePendingCardEffects(
      finishState(stateAfterEffect, []),
      effect.metadata?.orderedResolution === true
    );
  }
  const enqueued = enqueueMemberStateChangedTriggersFromOrientationResult(
    game,
    { ...orientationResult, gameState: stateAfterEffect },
    enqueueTriggeredCardEffects,
    {
      prepareGameStateBeforeEnqueue: (current, _result, events) =>
        finishState(
          current,
          events.map((event) => event.eventId)
        ),
    }
  );
  return continuePendingCardEffects(
    enqueued.gameState,
    effect.metadata?.orderedResolution === true
  );
}

function finishPaidEffectWithoutTarget(
  game: GameState,
  config: MemberWaitedDiscardActivateConfig,
  continuePendingCardEffects: ContinuePendingCardEffects,
  step: string
): GameState {
  const effect = game.activeEffect;
  const player = effect ? getPlayerById(game, effect.controllerId) : null;
  if (!effect || effect.abilityId !== config.abilityId || !player) {
    return game;
  }
  const changedCardIds = getStringArrayMetadata(effect.metadata?.changedCardIds);
  return continuePendingCardEffects(
    addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step,
      discardedCardIds: getStringArrayMetadata(effect.metadata?.discardedCardIds),
      changedCardIds,
      targetMemberCardId: null,
      targetStillOnStage: false,
      bladeBonus: 0,
    }),
    effect.metadata?.orderedResolution === true
  );
}

function finishPendingWithoutPayment(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects,
  step: string
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
      step,
      changedCardIds: getStringArrayMetadata(ability.metadata?.changedCardIds),
    }),
    orderedResolution
  );
}

function getEligibleWaitedMemberCardIds(
  game: GameState,
  playerId: string,
  candidateCardIds: readonly string[]
): readonly string[] {
  const player = getPlayerById(game, playerId);
  if (!player) {
    return [];
  }
  return [...new Set(candidateCardIds)].filter((cardId) => {
    const card = getCardById(game, cardId);
    return (
      findMemberSlot(player, cardId) !== null &&
      player.memberSlots.cardStates.get(cardId)?.orientation === OrientationState.WAITING &&
      card !== null &&
      isMemberCardData(card.data) &&
      groupAliasIs('虹ヶ咲')(card)
    );
  });
}

function getStringArrayMetadata(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value.filter((candidate): candidate is string => typeof candidate === 'string')
    : [];
}
