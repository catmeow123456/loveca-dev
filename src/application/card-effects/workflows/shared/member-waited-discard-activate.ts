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
  OrientationState,
  SlotPosition,
  TriggerCondition,
  TurnType,
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
const MEMBER_SLOTS = [SlotPosition.LEFT, SlotPosition.CENTER, SlotPosition.RIGHT] as const;

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;
type EnqueueTriggeredCardEffects = EnqueueTriggeredCardEffectsForEnterWaitingRoom &
  EnqueueTriggeredCardEffectsForMemberStateChanged;

interface MemberWaitedDiscardActivateConfig {
  readonly abilityId: string;
  readonly requiredTurnType?: TurnType;
  readonly bladeBonus: number;
  readonly actionStep: string;
}

const CONFIGS: readonly MemberWaitedDiscardActivateConfig[] = [
  {
    abilityId: N_BP7_022_AUTO_LIVE_PHASE_NIJIGASAKI_MEMBER_WAIT_DISCARD_ACTIVATE_ABILITY_ID,
    requiredTurnType: TurnType.LIVE_PHASE,
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
  }
}

function enqueueMemberWaitedDiscardActivateObservers(
  game: GameState,
  events: readonly MemberStateChangedEvent[]
): GameState {
  let state = game;
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
          (config.requiredTurnType !== undefined &&
            game.currentTurnType !== config.requiredTurnType) ||
          !canUseAbilityThisTurn(state, player.id, definition.abilityId, sourceCardId)
        ) {
          continue;
        }
        const pendingAbilityId = `${definition.abilityId}:${sourceCardId}:${event.eventId}`;
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
          eventIds: [event.eventId],
          sourceSlot,
          metadata: {
            triggerKind: 'OWN_NIJIGASAKI_MEMBER_BECAME_WAITING',
            eventId: event.eventId,
            changedCardId: event.cardInstanceId,
            changedControllerId: event.controllerId,
            changedSlot: event.slot,
            previousOrientation: event.previousOrientation,
            nextOrientation: event.nextOrientation,
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
            eventId: event.eventId,
            changedCardId: event.cardInstanceId,
            changedControllerId: event.controllerId,
            changedSlot: event.slot,
            previousOrientation: event.previousOrientation,
            nextOrientation: event.nextOrientation,
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
        changedCardId: ability.metadata?.changedCardId,
        changedControllerId: ability.metadata?.changedControllerId,
        changedSlot: ability.metadata?.changedSlot,
        triggerEventId: ability.eventIds[0] ?? null,
        triggerTurnType: ability.metadata?.triggerTurnType,
      },
    }),
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      step: 'START_OPTIONAL_DISCARD',
      changedCardId: ability.metadata?.changedCardId,
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

  const targetCardId =
    typeof effect.metadata?.changedCardId === 'string' ? effect.metadata.changedCardId : null;
  const targetControllerId =
    typeof effect.metadata?.changedControllerId === 'string'
      ? effect.metadata.changedControllerId
      : player.id;
  const targetPlayer = getPlayerById(state, targetControllerId);
  const targetSlot =
    targetCardId && targetPlayer ? findMemberSlot(targetPlayer, targetCardId) : null;
  const targetStillOnStage = targetControllerId === player.id && targetSlot !== null;
  const orientationResult =
    targetCardId && targetStillOnStage
      ? setMemberOrientation(state, player.id, targetCardId, OrientationState.ACTIVE, {
          kind: 'CARD_EFFECT',
          playerId: player.id,
          sourceCardId: effect.sourceCardId,
          abilityId: effect.abilityId,
          pendingAbilityId: effect.id,
        })
      : null;
  let stateAfterEffect = orientationResult?.gameState ?? state;
  const bladeResult =
    targetCardId && targetStillOnStage && config.bladeBonus > 0
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
      discardedCardIds: discardResult.discardedCardIds,
      targetMemberCardId: targetCardId,
      targetStillOnStage,
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
    state,
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
      targetMemberCardId: ability.metadata?.changedCardId ?? null,
    }),
    orderedResolution
  );
}
