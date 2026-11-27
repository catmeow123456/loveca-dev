import {
  addAction,
  getCardActiveEffect,
  getCardById,
  getPlayerById,
  type ActiveEffectState,
  type GameState,
} from '../../../../domain/entities/game.js';
import { SlotPosition, TriggerCondition } from '../../../../shared/types/enums.js';
import { and, costLte, groupAliasIs } from '../../../effects/card-selectors.js';
import {
  selectCurrentLiveRevealedCheerCardIds,
  selectRevealedCheerCardIds,
} from '../../../effects/cheer-selection.js';
import { S_PB2_007_LIVE_SUCCESS_PLAY_CHEER_MEMBER_ABILITY_ID as ABILITY } from '../../ability-ids.js';
import { startPendingActiveEffect } from '../../runtime/active-effect.js';
import type { EnqueueCardEffectPlacementTriggers } from '../../runtime/play-member-to-stage.js';
import { playRevealedCheerMemberToEmptySlotAndEnqueueTriggers } from '../../runtime/revealed-cheer-movement-triggers.js';
import { queryCardSelection, querySlotSelection } from '../../runtime/selection-query.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import {
  registerActiveEffectStepHandler,
  type ActiveEffectStepHandlerContext,
} from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';

const SELECT_CARD = 'S_PB2_007_SELECT_REVEALED_CHEER_MEMBER';
const SELECT_CARD_TEXT = '请选择1张因声援公开的己方费用小于等于2的成员卡。也可以选择不登场。';
const SELECT_SLOT = 'S_PB2_007_SELECT_EMPTY_STAGE_SLOT';
const MEMBER_SLOTS = [SlotPosition.LEFT, SlotPosition.CENTER, SlotPosition.RIGHT] as const;
const aqours = groupAliasIs('Aqours');
const eligibleMember = and(aqours, costLte(2));
type Continue = ActiveEffectStepHandlerContext['continuePendingCardEffects'];

export function registerSPb2007HanamaruWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueCardEffectPlacementTriggers;
}): void {
  registerPendingAbilityStarterHandler(ABILITY, (game, ability, options, context) => {
    const ordered = options.orderedResolution === true;
    const effect: ActiveEffectState = {
      id: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      controllerId: ability.controllerId,
      effectText: getAbilityEffectText(ability.abilityId),
      stepId: SELECT_CARD,
      stepText: SELECT_CARD_TEXT,
      awaitingPlayerId: ability.controllerId,
      metadata: {
        orderedResolution: ordered,
        liveSuccessEventId: ability.eventIds[0],
      },
    };
    const choices = getChoices(game, effect);
    if (!choices) {
      const state = {
        ...game,
        pendingAbilities: game.pendingAbilities.filter((item) => item.id !== ability.id),
      };
      return finish(state, effect, context.continuePendingCardEffects, {
        step: 'NO_ELIGIBLE_CHEER_MEMBER_PLACEMENT',
      });
    }
    return startPendingActiveEffect(game, {
      ability,
      playerId: ability.controllerId,
      activeEffect: selectCard(effect, choices.cardIds),
      actionPayload: { sourceCardId: ability.sourceCardId, step: SELECT_CARD },
    });
  });

  registerActiveEffectStepHandler(
    ABILITY,
    SELECT_CARD,
    (game, input, context) => {
      const effect = getCardActiveEffect(game);
      if (!effect) return game;
      if (input.selectedCardId == null) {
        return finish(game, effect, context.continuePendingCardEffects, { step: 'DECLINE_PLAY' });
      }
      if (!effect.selectableCardIds?.includes(input.selectedCardId)) return game;
      return chooseSlot(
        game,
        effect,
        input.selectedCardId,
        context,
        deps.enqueueTriggeredCardEffects
      );
    },
    queryCardSelection
  );

  registerActiveEffectStepHandler(
    ABILITY,
    SELECT_SLOT,
    (game, input, context) => {
      const effect = getCardActiveEffect(game);
      const cardId = effect?.metadata?.selectedCardId;
      const slot = input.selectedSlot;
      if (
        !effect ||
        typeof cardId !== 'string' ||
        !slot ||
        !effect.selectableSlots?.includes(slot)
      ) {
        return game;
      }
      const choices = getChoices(game, effect);
      if (!choices || !choices.cardIds.includes(cardId)) {
        return refreshCardSelection(game, effect, choices?.cardIds, context);
      }
      if (!choices.slots.includes(slot)) {
        return { ...game, activeEffect: { ...effect, selectableSlots: choices.slots } };
      }
      return playMember(game, effect, cardId, slot, context, deps.enqueueTriggeredCardEffects);
    },
    querySlotSelection
  );
}

function selectCard(effect: ActiveEffectState, cardIds: readonly string[]): ActiveEffectState {
  return {
    ...effect,
    stepId: SELECT_CARD,
    stepText: SELECT_CARD_TEXT,
    selectableCardIds: cardIds,
    selectableCardVisibility: 'PUBLIC',
    selectableCardMode: 'SINGLE',
    selectableSlots: undefined,
    selectionLabel: '选择要登场的声援公开成员',
    confirmSelectionLabel: '选择登场成员',
    canSkipSelection: true,
    skipSelectionLabel: '不登场',
    metadata: {
      orderedResolution: effect.metadata?.orderedResolution,
      liveSuccessEventId: effect.metadata?.liveSuccessEventId,
      publicCardSelectionConfirmation: { source: 'REVEALED_CHEER', destination: 'MEMBER_SLOT' },
    },
  };
}

function chooseSlot(
  game: GameState,
  effect: ActiveEffectState,
  cardId: string,
  context: ActiveEffectStepHandlerContext,
  enqueue: EnqueueCardEffectPlacementTriggers
): GameState {
  const choices = getChoices(game, effect);
  if (!choices || !choices.cardIds.includes(cardId)) {
    return refreshCardSelection(game, effect, choices?.cardIds, context);
  }
  if (choices.slots.length === 1) {
    return playMember(game, effect, cardId, choices.slots[0], context, enqueue);
  }
  return {
    ...game,
    activeEffect: {
      ...effect,
      stepId: SELECT_SLOT,
      stepText: '请选择该成员要登场的空成员区。',
      selectableCardIds: undefined,
      selectableCardVisibility: undefined,
      selectableCardMode: undefined,
      selectableSlots: choices.slots,
      selectionLabel: '选择登场区域',
      confirmSelectionLabel: '登场',
      canSkipSelection: false,
      skipSelectionLabel: undefined,
      metadata: {
        orderedResolution: effect.metadata?.orderedResolution,
        liveSuccessEventId: effect.metadata?.liveSuccessEventId,
        selectedCardId: cardId,
      },
    },
  };
}

function refreshCardSelection(
  game: GameState,
  effect: ActiveEffectState,
  cardIds: readonly string[] | undefined,
  context: ActiveEffectStepHandlerContext
): GameState {
  if (!cardIds) {
    return finish(game, effect, context.continuePendingCardEffects, {
      step: 'NO_ELIGIBLE_CHEER_MEMBER_PLACEMENT',
    });
  }
  return { ...game, activeEffect: selectCard(effect, cardIds) };
}

function playMember(
  game: GameState,
  effect: ActiveEffectState,
  cardId: string,
  slot: SlotPosition,
  context: ActiveEffectStepHandlerContext,
  enqueue: EnqueueCardEffectPlacementTriggers
): GameState {
  const placement = playRevealedCheerMemberToEmptySlotAndEnqueueTriggers(
    game,
    effect,
    cardId,
    slot,
    enqueue
  );
  if (!placement) return game;
  return finish(placement.gameState, effect, context.continuePendingCardEffects, {
    step: 'PLAY_REVEALED_CHEER_MEMBER',
    playedCardId: placement.playedCardId,
    toSlot: placement.toSlot,
  });
}

function getChoices(game: GameState, effect: ActiveEffectState) {
  const player = getPlayerById(game, effect.controllerId);
  const successId = getCurrentLiveSuccessEventId(game, effect.controllerId);
  if (!player || !successId || successId !== effect.metadata?.liveSuccessEventId) return null;

  const revealedCardIds = selectCurrentLiveRevealedCheerCardIds(game, player.id);
  const allAqours = revealedCardIds.every((cardId) => {
    const card = getCardById(game, cardId);
    return card !== null && aqours(card);
  });
  if (!allAqours) return null;

  const cardIds = selectRevealedCheerCardIds(game, player.id, eligibleMember);
  const slots = MEMBER_SLOTS.filter((slot) => player.memberSlots.slots[slot] === null);
  return cardIds.length > 0 && slots.length > 0 ? { cardIds, slots } : null;
}

function getCurrentLiveSuccessEventId(game: GameState, playerId: string): string | undefined {
  for (let index = game.eventLog.length - 1; index >= 0; index--) {
    const { event } = game.eventLog[index];
    if (
      event.eventType === TriggerCondition.ON_LIVE_SUCCESS &&
      'playerId' in event &&
      event.playerId === playerId
    ) {
      return event.eventId;
    }
    if (
      event.eventType === TriggerCondition.ON_TURN_END ||
      (event.eventType === TriggerCondition.ON_LIVE_START &&
        'performerId' in event &&
        event.performerId === playerId)
    ) {
      return undefined;
    }
  }
  return undefined;
}

function finish(
  game: GameState,
  effect: ActiveEffectState,
  next: Continue,
  payload: Readonly<Record<string, unknown>>
): GameState {
  return next(
    addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', effect.controllerId, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      ...payload,
    }),
    effect.metadata?.orderedResolution === true
  );
}
