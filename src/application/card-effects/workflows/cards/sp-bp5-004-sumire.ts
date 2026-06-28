import {
  addAction,
  getCardById,
  getPlayerById,
  type GameAction,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { findMemberSlot } from '../../../../domain/entities/player.js';
import type { MemberSlotMovedEvent } from '../../../../domain/events/game-events.js';
import { addHeartLiveModifierForMember } from '../../../../domain/rules/live-modifiers.js';
import { HeartColor, SlotPosition, TriggerCondition } from '../../../../shared/types/enums.js';
import { CardAbilityCategory, CardAbilitySourceZone } from '../../ability-definition-types.js';
import { SP_BP5_004_AUTO_OWN_EFFECT_MOVE_OR_PLACE_ENERGY_DRAW_RED_HEART_ABILITY_ID } from '../../ability-ids.js';
import { getCardAbilityDefinitionsForCardCode } from '../../definitions/lookup.js';
import { drawCardsForPlayer } from '../../runtime/actions.js';
import { registerMemberSlotMovedObserver } from '../../runtime/member-slot-moved-observers.js';
import { registerResolvedAbilityObserver } from '../../runtime/resolved-ability-observers.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { recordAbilityUseForContext } from '../../runtime/workflow-helpers.js';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerSpBp5004SumireWorkflowHandlers(): void {
  registerMemberSlotMovedObserver((game, context) =>
    enqueueSpBp5004MemberSlotMovedObserver(game, context.events)
  );
  registerResolvedAbilityObserver((game, context) =>
    enqueueSpBp5004PlacedEnergyResolvedAbilityObserver(game, context.resolvedAction)
  );
  registerPendingAbilityStarterHandler(
    SP_BP5_004_AUTO_OWN_EFFECT_MOVE_OR_PLACE_ENERGY_DRAW_RED_HEART_ABILITY_ID,
    (game, ability, options, context) =>
      resolveSpBp5004SumireAuto(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
}

function enqueueSpBp5004MemberSlotMovedObserver(
  game: GameState,
  events: readonly MemberSlotMovedEvent[]
): GameState {
  let state = game;
  for (const event of events) {
    const player = getPlayerById(state, event.controllerId);
    if (
      !player ||
      event.cause?.kind !== 'CARD_EFFECT' ||
      event.cause.playerId !== player.id ||
      player.memberSlots.slots[event.toSlot] !== event.cardInstanceId
    ) {
      continue;
    }

    const sourceCard = getCardById(state, event.cardInstanceId);
    if (!sourceCard || sourceCard.ownerId !== player.id) {
      continue;
    }

    const abilityId = SP_BP5_004_AUTO_OWN_EFFECT_MOVE_OR_PLACE_ENERGY_DRAW_RED_HEART_ABILITY_ID;
    const hasSumireMoveAbility = getCardAbilityDefinitionsForCardCode(sourceCard.data.cardCode).some(
      (definition) =>
        definition.abilityId === abilityId &&
        definition.sourceZone === CardAbilitySourceZone.STAGE_MEMBER &&
        definition.category === CardAbilityCategory.AUTO &&
        definition.triggerCondition === TriggerCondition.ON_MEMBER_SLOT_MOVED
    );
    if (
      !hasSumireMoveAbility ||
      hasUsedAbilityThisTurn(state, player.id, abilityId, event.cardInstanceId)
    ) {
      continue;
    }

    const pendingAbilityId = `${abilityId}:${event.cardInstanceId}:${event.eventId}`;
    if (hasAbilityInstance(state, pendingAbilityId)) {
      continue;
    }

    const pendingAbility: PendingAbilityState = {
      id: pendingAbilityId,
      abilityId,
      sourceCardId: event.cardInstanceId,
      controllerId: player.id,
      mandatory: true,
      timingId: TriggerCondition.ON_MEMBER_SLOT_MOVED,
      eventIds: [event.eventId],
      sourceSlot: event.toSlot,
      metadata: {
        triggerKind: 'MEMBER_MOVED_BY_OWN_CARD_EFFECT',
        eventId: event.eventId,
        fromSlot: event.fromSlot,
        toSlot: event.toSlot,
        swappedCardInstanceId: event.swappedCardInstanceId ?? null,
        causedByKind: event.cause.kind,
        causedByPlayerId: event.cause.playerId,
        causedBySourceCardId: event.cause.sourceCardId,
        causedByAbilityId: event.cause.abilityId ?? null,
      },
    };

    state = addAction(
      {
        ...state,
        pendingAbilities: [...state.pendingAbilities, pendingAbility],
      },
      'TRIGGER_ABILITY',
      player.id,
      {
        pendingAbilityId,
        abilityId,
        sourceCardId: event.cardInstanceId,
        timingId: pendingAbility.timingId,
        sourceSlot: event.toSlot,
        eventId: event.eventId,
        fromSlot: event.fromSlot,
        toSlot: event.toSlot,
        causedByPlayerId: event.cause.playerId,
        causedBySourceCardId: event.cause.sourceCardId,
        causedByAbilityId: event.cause.abilityId ?? null,
      }
    );
  }

  return state;
}

function enqueueSpBp5004PlacedEnergyResolvedAbilityObserver(
  game: GameState,
  resolvedAction: GameAction
): GameState {
  const placedEnergyCardIds = getMetadataStringArray(resolvedAction.payload.placedEnergyCardIds);
  const resolvedAbilityId =
    typeof resolvedAction.payload.abilityId === 'string' ? resolvedAction.payload.abilityId : null;
  const resolvedSourceCardId =
    typeof resolvedAction.payload.sourceCardId === 'string'
      ? resolvedAction.payload.sourceCardId
      : null;
  const playerId = typeof resolvedAction.playerId === 'string' ? resolvedAction.playerId : null;
  if (
    placedEnergyCardIds.length === 0 ||
    !resolvedAbilityId ||
    !resolvedSourceCardId ||
    !playerId
  ) {
    return game;
  }

  const player = getPlayerById(game, playerId);
  const resolvedSourceCard = getCardById(game, resolvedSourceCardId);
  if (!player || !resolvedSourceCard || resolvedSourceCard.ownerId !== player.id) {
    return game;
  }
  if (!placedEnergyCardIds.every((cardId) => player.energyZone.cardIds.includes(cardId))) {
    return game;
  }

  let state = game;
  for (const sourceSlot of [SlotPosition.LEFT, SlotPosition.CENTER, SlotPosition.RIGHT] as const) {
    const sourceCardId = player.memberSlots.slots[sourceSlot];
    const sourceCard = sourceCardId ? getCardById(state, sourceCardId) : null;
    if (!sourceCardId || !sourceCard) {
      continue;
    }

    const hasSumireObserverAbility = getCardAbilityDefinitionsForCardCode(
      sourceCard.data.cardCode
    ).some(
      (definition) =>
        definition.abilityId ===
          SP_BP5_004_AUTO_OWN_EFFECT_MOVE_OR_PLACE_ENERGY_DRAW_RED_HEART_ABILITY_ID &&
        definition.sourceZone === CardAbilitySourceZone.STAGE_MEMBER &&
        definition.category === CardAbilityCategory.AUTO
    );
    const abilityId = SP_BP5_004_AUTO_OWN_EFFECT_MOVE_OR_PLACE_ENERGY_DRAW_RED_HEART_ABILITY_ID;
    if (
      !hasSumireObserverAbility ||
      hasUsedAbilityThisTurn(state, player.id, abilityId, sourceCardId)
    ) {
      continue;
    }

    const pendingAbilityId = `${abilityId}:${sourceCardId}:placed-energy-${resolvedAction.id}`;
    if (hasAbilityInstance(state, pendingAbilityId)) {
      continue;
    }

    const pendingAbility: PendingAbilityState = {
      id: pendingAbilityId,
      abilityId,
      sourceCardId,
      controllerId: player.id,
      mandatory: true,
      timingId: TriggerCondition.ON_MEMBER_SLOT_MOVED,
      eventIds: [resolvedAction.id],
      sourceSlot,
      metadata: {
        triggerKind: 'ENERGY_PLACED_BY_OWN_CARD_EFFECT',
        resolvedActionId: resolvedAction.id,
        resolvedAbilityId,
        resolvedSourceCardId,
        placedEnergyCardIds,
      },
    };

    state = addAction(
      {
        ...state,
        pendingAbilities: [...state.pendingAbilities, pendingAbility],
      },
      'TRIGGER_ABILITY',
      player.id,
      {
        pendingAbilityId,
        abilityId,
        sourceCardId,
        timingId: pendingAbility.timingId,
        sourceSlot,
        resolvedActionId: resolvedAction.id,
        resolvedAbilityId,
        resolvedSourceCardId,
        placedEnergyCardIds,
      }
    );
  }

  return state;
}

function resolveSpBp5004SumireAuto(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const sourceSlot = findMemberSlot(player, ability.sourceCardId);
  const triggerCheck = getTriggerCheck(game, ability, player.id);
  const conditionMet = sourceSlot !== null && triggerCheck.conditionMet;

  let state: GameState = {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
  };
  let drawnCardIds: readonly string[] = [];
  let heartBonus: readonly { readonly color: HeartColor; readonly count: number }[] = [];

  if (conditionMet) {
    state = recordAbilityUseForContext(state, player.id, {
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
    });

    const drawResult = drawCardsForPlayer(state, player.id, 1);
    if (drawResult) {
      state = drawResult.gameState;
      drawnCardIds = drawResult.drawnCardIds;
    }

    const heartResult = addHeartLiveModifierForMember(state, {
      playerId: player.id,
      memberCardId: ability.sourceCardId,
      sourceCardId: ability.sourceCardId,
      abilityId: ability.abilityId,
      hearts: [{ color: HeartColor.RED, count: 1 }],
    });
    if (heartResult) {
      state = heartResult.gameState;
      heartBonus = heartResult.heartBonus;
    }
  }

  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: conditionMet
        ? 'OWN_EFFECT_MOVE_OR_PLACE_ENERGY_DRAW_RED_HEART'
        : 'CONDITION_NOT_MET',
      triggerKind: triggerCheck.triggerKind,
      conditionMet,
      sourceStillOnStage: sourceSlot !== null,
      sourceSlot,
      moveEventId: triggerCheck.moveEvent?.eventId ?? null,
      fromSlot: triggerCheck.moveEvent?.fromSlot ?? null,
      toSlot: triggerCheck.moveEvent?.toSlot ?? null,
      causedByPlayerId:
        triggerCheck.moveEvent?.cause?.kind === 'CARD_EFFECT'
          ? triggerCheck.moveEvent.cause.playerId
          : null,
      placedEnergyCardIds: triggerCheck.placedEnergyCardIds,
      drawnCardIds,
      heartBonus,
    }),
    orderedResolution
  );
}

function getTriggerCheck(
  game: GameState,
  ability: PendingAbilityState,
  playerId: string
): {
  readonly conditionMet: boolean;
  readonly triggerKind: string | null;
  readonly moveEvent: MemberSlotMovedEvent | null;
  readonly placedEnergyCardIds: readonly string[];
} {
  const triggerKind =
    typeof ability.metadata?.triggerKind === 'string' ? ability.metadata.triggerKind : null;

  if (triggerKind === 'ENERGY_PLACED_BY_OWN_CARD_EFFECT') {
    const placedEnergyCardIds = getMetadataStringArray(ability.metadata?.placedEnergyCardIds);
    const player = getPlayerById(game, playerId);
    const cardsAreInOwnEnergyZone =
      player !== null &&
      placedEnergyCardIds.length > 0 &&
      placedEnergyCardIds.every((cardId) => player.energyZone.cardIds.includes(cardId));
    return {
      conditionMet: cardsAreInOwnEnergyZone,
      triggerKind,
      moveEvent: null,
      placedEnergyCardIds,
    };
  }

  const moveEvent = getPendingMoveEvent(game, ability);
  const conditionMet =
    moveEvent !== null &&
    moveEvent.cardInstanceId === ability.sourceCardId &&
    moveEvent.controllerId === playerId &&
    moveEvent.cause?.kind === 'CARD_EFFECT' &&
    moveEvent.cause.playerId === playerId;

  return {
    conditionMet,
    triggerKind: 'MEMBER_MOVED_BY_OWN_CARD_EFFECT',
    moveEvent,
    placedEnergyCardIds: [],
  };
}

function getPendingMoveEvent(
  game: GameState,
  ability: PendingAbilityState
): MemberSlotMovedEvent | null {
  const eventIds = new Set(ability.eventIds);
  for (const entry of game.eventLog) {
    const event = entry.event;
    if (
      event.eventType === TriggerCondition.ON_MEMBER_SLOT_MOVED &&
      'fromSlot' in event &&
      'toSlot' in event &&
      'cardInstanceId' in event &&
      eventIds.has(event.eventId)
    ) {
      return event as MemberSlotMovedEvent;
    }
  }
  return null;
}

function getMetadataStringArray(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : [];
}

function hasAbilityInstance(game: GameState, pendingAbilityId: string): boolean {
  const alreadyPending = game.pendingAbilities.some((ability) => ability.id === pendingAbilityId);
  const alreadyActive = game.activeEffect?.id === pendingAbilityId;
  const alreadyResolved = game.actionHistory.some(
    (historyAction) =>
      historyAction.type === 'RESOLVE_ABILITY' &&
      historyAction.payload.pendingAbilityId === pendingAbilityId
  );
  return alreadyPending || alreadyActive || alreadyResolved;
}

function hasUsedAbilityThisTurn(
  game: GameState,
  playerId: string,
  abilityId: string,
  sourceCardId: string
): boolean {
  return game.actionHistory.some(
    (historyAction) =>
      historyAction.type === 'RESOLVE_ABILITY' &&
      historyAction.playerId === playerId &&
      historyAction.payload.step === 'ABILITY_USE' &&
      historyAction.payload.turnCount === game.turnCount &&
      historyAction.payload.abilityId === abilityId &&
      historyAction.payload.sourceCardId === sourceCardId
  );
}
