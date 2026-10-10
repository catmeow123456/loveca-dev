import { isMemberCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { cardCodeMatchesBase } from '../../../../shared/utils/card-code.js';
import { cardBelongsToUnit } from '../../../../shared/utils/card-identity.js';
import { HS_BP8_005_NO_OTHER_DOLLCHESTRA_SEND_SELF_ABILITY_ID as ABILITY_ID } from '../../ability-ids.js';
import {
  getAbilitySourceLifecycleId,
  getActiveEffectSourceLifecycleId,
  getPendingAbilitySourceLifecycleId,
} from '../../runtime/ability-source-lifecycle.js';
import {
  sendStageMemberToWaitingRoomAndEnqueueLeaveStageTriggers,
  type EnqueueTriggeredCardEffectsForLeaveStage,
} from '../../runtime/leave-stage-triggers.js';
import { getSourceMemberSlot } from '../../runtime/source-member.js';
import {
  registerStateTriggerObserver,
  type StateTriggerObserverContext,
} from '../../runtime/state-trigger-observers.js';
import { registerManualConfirmablePendingAbilityStarterHandler } from '../../runtime/workflow-helpers.js';

const BASE_CARD_CODES = ['PL!HS-bp8-005'] as const;

export function registerHsBp8005KosuzuWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForLeaveStage;
}): void {
  registerStateTriggerObserver(ABILITY_ID, BASE_CARD_CODES, enqueueKosuzuWithoutOtherDollchestra);
  registerManualConfirmablePendingAbilityStarterHandler(
    ABILITY_ID,
    (game, ability, options, context) => {
      const sourceSlot = getSourceMemberSlot(game, ability.controllerId, ability.sourceCardId);
      const lifecycleMatches =
        getPendingAbilitySourceLifecycleId(game, ability) ===
        getAbilitySourceLifecycleId(game, ABILITY_ID, ability.sourceCardId);
      // The condition was already captured. A returning partner does not cancel this trigger.
      const moved =
        sourceSlot !== null && lifecycleMatches
          ? sendStageMemberToWaitingRoomAndEnqueueLeaveStageTriggers(
              game,
              ability.controllerId,
              ability.sourceCardId,
              deps.enqueueTriggeredCardEffects
            )
          : null;
      const state = moved?.gameState ?? game;
      return context.continuePendingCardEffects(
        addAction(
          {
            ...state,
            pendingAbilities: state.pendingAbilities.filter(
              (candidate) => candidate.id !== ability.id
            ),
            activeEffect: state.activeEffect?.id === ability.id ? null : state.activeEffect,
          },
          'RESOLVE_ABILITY',
          ability.controllerId,
          {
            pendingAbilityId: ability.id,
            abilityId: ABILITY_ID,
            sourceCardId: ability.sourceCardId,
            sourceLifecycleId: ability.sourceLifecycleId,
            step: moved ? 'SEND_SELF_WITHOUT_OTHER_DOLLCHESTRA' : 'SOURCE_OBJECT_NOT_ON_STAGE',
            movedToWaitingRoomCardIds: moved?.movedToWaitingRoomCardIds ?? [],
          }
        ),
        options.orderedResolution === true
      );
    },
    (game, ability) => ({
      stepText:
        getSourceMemberSlot(game, ability.controllerId, ability.sourceCardId) !== null &&
        getPendingAbilitySourceLifecycleId(game, ability) ===
          getAbilitySourceLifecycleId(game, ABILITY_ID, ability.sourceCardId)
          ? '确认后将此成员放置入休息室。'
          : '没有可放置入休息室的成员。',
    })
  );
}

function enqueueKosuzuWithoutOtherDollchestra(
  game: GameState,
  context: StateTriggerObserverContext
): GameState {
  let state = game;
  for (const source of context.stageMembers) {
    const card = getCardById(state, source.sourceCardId);
    if (
      !card ||
      !isMemberCardData(card.data) ||
      !BASE_CARD_CODES.some((base) => cardCodeMatchesBase(card.data.cardCode, base))
    )
      continue;
    const hasOtherDollchestra = context.stageMembers.some((other) => {
      if (other.playerId !== source.playerId || other.sourceCardId === source.sourceCardId)
        return false;
      const otherCard = getCardById(state, other.sourceCardId);
      return (
        otherCard !== null &&
        isMemberCardData(otherCard.data) &&
        cardBelongsToUnit(otherCard.data, 'DOLLCHESTRA')
      );
    });
    if (hasOtherDollchestra) continue;
    const sourceLifecycleId = getAbilitySourceLifecycleId(
      state,
      ABILITY_ID,
      source.sourceCardId,
      context.eventIds
    );
    const pending = state.pendingAbilities.some(
      (ability) =>
        ability.abilityId === ABILITY_ID &&
        ability.controllerId === source.playerId &&
        ability.sourceCardId === source.sourceCardId &&
        getPendingAbilitySourceLifecycleId(state, ability) === sourceLifecycleId
    );
    const effect = state.activeEffect;
    const active =
      effect?.abilityId === ABILITY_ID &&
      effect.controllerId === source.playerId &&
      effect.sourceCardId === source.sourceCardId &&
      getActiveEffectSourceLifecycleId(state, effect) === sourceLifecycleId;
    if (pending || active) continue;
    const id = `${ABILITY_ID}:${source.sourceCardId}:${context.eventIds[0] ?? `check-${state.actionSequence + 1}`}`;
    const ability: PendingAbilityState = {
      id,
      abilityId: ABILITY_ID,
      sourceCardId: source.sourceCardId,
      sourceLifecycleId,
      controllerId: source.playerId,
      sourceSlot: source.sourceSlot,
      mandatory: true,
      timingId: 'STATE_CONDITION',
      eventIds: context.eventIds,
    };
    state = addAction(
      { ...state, pendingAbilities: [...state.pendingAbilities, ability] },
      'TRIGGER_ABILITY',
      source.playerId,
      {
        pendingAbilityId: id,
        abilityId: ABILITY_ID,
        sourceCardId: source.sourceCardId,
        sourceLifecycleId,
        sourceSlot: source.sourceSlot,
        timingId: ability.timingId,
        eventIds: ability.eventIds,
      }
    );
  }
  return state;
}
