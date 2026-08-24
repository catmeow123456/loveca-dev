import { isMemberCardData } from '../../../domain/entities/card.js';
import { getCardById, type GameState } from '../../../domain/entities/game.js';
import type { SlotPosition, ZoneType } from '../../../shared/types/enums.js';
import { groupAliasIs } from '../../effects/card-selectors.js';
import type { CardAbilityDefinition } from '../ability-definition-types.js';

export interface OnLeaveStageTriggerSource {
  readonly cardId: string;
  readonly controllerId: string;
  readonly sourceSlot: SlotPosition;
  readonly eventId: string;
  readonly toZone?: ZoneType;
  readonly replacingCardId?: string;
}

/**
 * Definition-driven ON_LEAVE_STAGE enqueue gate.
 *
 * This helper only checks immutable leave-event facts plus the registered
 * replacing card's printed identity. It does not create pending abilities,
 * consume turn limits, or resolve the eventual effect.
 */
export function doesOnLeaveStageSourceMatchAbilityDefinition(
  game: GameState,
  ability: CardAbilityDefinition,
  source: OnLeaveStageTriggerSource
): boolean {
  if (
    ability.triggerToZones !== undefined &&
    (source.toZone === undefined || !ability.triggerToZones.includes(source.toZone))
  ) {
    return false;
  }

  const relayFilter = ability.onLeaveStageTriggerFilter?.relayReplacementMember;
  if (!relayFilter) {
    return true;
  }

  if (
    !source.replacingCardId ||
    !Number.isInteger(relayFilter.minPrintedCost) ||
    relayFilter.minPrintedCost < 0 ||
    relayFilter.groupAliases.length === 0
  ) {
    return false;
  }

  const replacingCard = getCardById(game, source.replacingCardId);
  return (
    replacingCard !== null &&
    isMemberCardData(replacingCard.data) &&
    replacingCard.data.cost >= relayFilter.minPrintedCost &&
    relayFilter.groupAliases.some((alias) => groupAliasIs(alias)(replacingCard))
  );
}
