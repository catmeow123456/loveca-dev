import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { findMemberSlot } from '../../../../domain/entities/player.js';
import type { MemberSlotMovedEvent } from '../../../../domain/events/game-events.js';
import { CardType, TriggerCondition, ZoneType } from '../../../../shared/types/enums.js';
import { and, groupAliasIs, typeIs } from '../../../effects/card-selectors.js';
import { SP_PB2_006_AUTO_LIVE_SUCCESS_OR_MOVE_STACK_LIELLA_MEMBER_BELOW_ABILITY_ID } from '../../ability-ids.js';
import { stackMemberCardBelowSpecialMember } from '../../runtime/actions.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import {
  getAbilityEffectText,
  recordAbilityUseForContext,
} from '../../runtime/workflow-helpers.js';

const SELECT_WAITING_ROOM_MEMBER_STEP_ID = 'SP_PB2_006_SELECT_LIELLA_MEMBER_TO_STACK_BELOW';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

const liellaMemberSelector = and(typeIs(CardType.MEMBER), groupAliasIs('Liella!'));

export function registerSpPb2006KinakoWorkflowHandlers(): void {
  registerPendingAbilityStarterHandler(
    SP_PB2_006_AUTO_LIVE_SUCCESS_OR_MOVE_STACK_LIELLA_MEMBER_BELOW_ABILITY_ID,
    (game, ability, options, context) =>
      startSpPb2006KinakoAuto(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    SP_PB2_006_AUTO_LIVE_SUCCESS_OR_MOVE_STACK_LIELLA_MEMBER_BELOW_ABILITY_ID,
    SELECT_WAITING_ROOM_MEMBER_STEP_ID,
    (game, input, context) =>
      finishSpPb2006KinakoStack(
        game,
        input.selectedCardId ?? null,
        context.continuePendingCardEffects
      )
  );
}

function startSpPb2006KinakoAuto(
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
  if (!sourceSlot) {
    return finishPendingAbility(
      game,
      ability,
      player.id,
      orderedResolution,
      {
        step: 'STACK_LIELLA_MEMBER_BELOW_NOOP',
        reason: 'SOURCE_NOT_ON_STAGE',
      },
      continuePendingCardEffects
    );
  }

  const moveEvent = getPendingMoveEvent(game, ability);
  if (ability.timingId === TriggerCondition.ON_MEMBER_SLOT_MOVED) {
    const movedThisMember =
      moveEvent?.controllerId === player.id && moveEvent.cardInstanceId === ability.sourceCardId;
    if (!movedThisMember) {
      return finishPendingAbility(
        game,
        ability,
        player.id,
        orderedResolution,
        {
          step: 'STACK_LIELLA_MEMBER_BELOW_NOOP',
          reason: 'MOVE_EVENT_NOT_SOURCE',
          moveEventId: moveEvent?.eventId ?? null,
          movedCardId: moveEvent?.cardInstanceId ?? null,
        },
        continuePendingCardEffects
      );
    }
  }

  const candidateCardIds = getWaitingRoomLiellaMemberCardIds(game, player.id);
  if (candidateCardIds.length === 0) {
    return finishPendingAbility(
      game,
      ability,
      player.id,
      orderedResolution,
      {
        step: 'STACK_LIELLA_MEMBER_BELOW_NOOP',
        reason: 'NO_WAITING_ROOM_LIELLA_MEMBER',
        sourceSlot,
        moveEventId: moveEvent?.eventId ?? null,
      },
      continuePendingCardEffects
    );
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
        stepId: SELECT_WAITING_ROOM_MEMBER_STEP_ID,
        stepText: '请选择自己休息室中的1张『Liella!』成员卡，放置到此成员下方。',
        awaitingPlayerId: player.id,
        selectableCardIds: candidateCardIds,
        selectableCardVisibility: 'PUBLIC',
        selectableCardMode: 'SINGLE',
        minSelectableCards: 1,
        maxSelectableCards: 1,
        selectionLabel: '选择要放置到下方的 Liella! 成员',
        confirmSelectionLabel: '放置到下方',
        canSkipSelection: false,
        metadata: {
          orderedResolution,
          sourceSlot,
          candidateCardIds,
          moveEventId: moveEvent?.eventId ?? null,
          movedCardId: moveEvent?.cardInstanceId ?? null,
        },
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: 'START_SELECT_LIELLA_MEMBER_TO_STACK_BELOW',
      sourceSlot,
      candidateCardIds,
      moveEventId: moveEvent?.eventId ?? null,
    }
  );
}

function finishSpPb2006KinakoStack(
  game: GameState,
  selectedCardId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== SP_PB2_006_AUTO_LIVE_SUCCESS_OR_MOVE_STACK_LIELLA_MEMBER_BELOW_ABILITY_ID ||
    effect.stepId !== SELECT_WAITING_ROOM_MEMBER_STEP_ID ||
    !selectedCardId ||
    effect.selectableCardIds?.includes(selectedCardId) !== true
  ) {
    return game;
  }

  const player = getPlayerById(game, effect.controllerId);
  if (!player) {
    return game;
  }
  const sourceSlot = findMemberSlot(player, effect.sourceCardId);
  if (!sourceSlot) {
    return game;
  }

  const stackResult = stackMemberCardBelowSpecialMember(game, {
    playerId: player.id,
    sourceZone: ZoneType.WAITING_ROOM,
    movedCardId: selectedCardId,
    hostCardId: effect.sourceCardId,
    targetSlot: sourceSlot,
  });
  if (!stackResult) {
    return continuePendingCardEffects(
      addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        step: 'STACK_LIELLA_MEMBER_BELOW_NOOP',
        reason: 'STACK_FAILED',
        sourceSlot,
        selectedCardId,
      }),
      effect.metadata?.orderedResolution === true
    );
  }

  const stateWithUseRecord = recordAbilityUseForContext(
    { ...stackResult.gameState, activeEffect: null },
    player.id,
    {
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
    }
  );

  return continuePendingCardEffects(
    addAction(stateWithUseRecord, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'STACK_LIELLA_MEMBER_BELOW',
      sourceSlot,
      selectedCardId,
      stackedCardId: stackResult.movedCardId,
    }),
    effect.metadata?.orderedResolution === true
  );
}

function getWaitingRoomLiellaMemberCardIds(game: GameState, playerId: string): readonly string[] {
  const player = getPlayerById(game, playerId);
  if (!player) {
    return [];
  }
  return player.waitingRoom.cardIds.filter((cardId) => {
    const card = getCardById(game, cardId);
    return card !== null && card.ownerId === player.id && liellaMemberSelector(card);
  });
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

function finishPendingAbility(
  game: GameState,
  ability: PendingAbilityState,
  playerId: string,
  orderedResolution: boolean,
  payload: Readonly<Record<string, unknown>>,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const state = {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
  };
  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', playerId, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      ...payload,
    }),
    orderedResolution
  );
}
