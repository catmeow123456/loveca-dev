import { isMemberCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import type { MemberSlotMovedEvent } from '../../../../domain/events/game-events.js';
import { SlotPosition, TriggerCondition } from '../../../../shared/types/enums.js';
import { unitAliasIs } from '../../../effects/card-selectors.js';
import { SP_PB2_022_AUTO_5YNCRISE_MEMBER_MOVED_CENTER_GAIN_FOUR_BLADE_ABILITY_ID } from '../../ability-ids.js';
import { addBladeLiveModifierForSourceMember } from '../../runtime/actions.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { recordAbilityUseForContext } from '../../runtime/workflow-helpers.js';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerSpPb2022TomariWorkflowHandlers(): void {
  registerPendingAbilityStarterHandler(
    SP_PB2_022_AUTO_5YNCRISE_MEMBER_MOVED_CENTER_GAIN_FOUR_BLADE_ABILITY_ID,
    (game, ability, options, context) =>
      resolveSpPb2022TomariOnMove(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
}

function resolveSpPb2022TomariOnMove(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const moveEvent = getPendingMoveEvent(game, ability);
  const movedMemberIsOwnFiveyncrise =
    moveEvent !== null && isOwnFiveyncriseMember(game, player.id, moveEvent.cardInstanceId);
  const movedToCenter = moveEvent?.toSlot === SlotPosition.CENTER;
  const movedMemberCurrentlyCenter =
    moveEvent !== null && player.memberSlots.slots[SlotPosition.CENTER] === moveEvent.cardInstanceId;
  const conditionMet = movedMemberIsOwnFiveyncrise && movedToCenter && movedMemberCurrentlyCenter;
  const bladeResult = conditionMet
    ? addBladeLiveModifierForSourceMember(game, {
        playerId: player.id,
        sourceCardId: ability.sourceCardId,
        abilityId: ability.abilityId,
        amount: 4,
      })
    : null;
  const stateAfterBlade = bladeResult?.gameState ?? game;
  const stateAfterUseRecord =
    conditionMet && bladeResult
      ? recordAbilityUseForContext(stateAfterBlade, player.id, {
          abilityId: ability.abilityId,
          sourceCardId: ability.sourceCardId,
        })
      : stateAfterBlade;
  const stateWithoutPending: GameState = {
    ...stateAfterUseRecord,
    pendingAbilities: stateAfterUseRecord.pendingAbilities.filter(
      (candidate) => candidate.id !== ability.id
    ),
  };

  return continuePendingCardEffects(
    addAction(stateWithoutPending, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: conditionMet ? 'FIVEYNCRISE_MEMBER_MOVED_CENTER_GAIN_FOUR_BLADE' : 'CONDITION_NOT_MET',
      conditionMet,
      moveEventId: moveEvent?.eventId ?? null,
      movedCardId: moveEvent?.cardInstanceId ?? null,
      fromSlot: moveEvent?.fromSlot ?? null,
      toSlot: moveEvent?.toSlot ?? null,
      movedMemberIsOwnFiveyncrise,
      movedToCenter,
      movedMemberCurrentlyCenter,
      bladeBonus: bladeResult?.bladeBonus ?? 0,
    }),
    orderedResolution
  );
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

function isOwnFiveyncriseMember(game: GameState, playerId: string, cardId: string): boolean {
  const card = getCardById(game, cardId);
  return (
    card !== null &&
    card.ownerId === playerId &&
    isMemberCardData(card.data) &&
    unitAliasIs('5yncri5e!')(card)
  );
}
