import { calculateTotalHearts, isMemberCardData } from '../entities/card.js';
import { getCardById, getPlayerById, type GameState } from '../entities/game.js';
import { OrientationState, SlotPosition } from '../../shared/types/enums.js';
import { cardCodeMatchesBase } from '../../shared/utils/card-code.js';
import { toPlayerLocalSlotForControllerPerspective } from '../../shared/utils/slot-perspective.js';

interface FacingMemberEntryOrientationRule {
  readonly sourceBaseCardCodes: readonly string[];
  readonly maximumEnteringOriginalHeartCount: number;
  readonly orientation: OrientationState;
}

const FACING_MEMBER_ENTRY_ORIENTATION_RULES: readonly FacingMemberEntryOrientationRule[] = [
  {
    sourceBaseCardCodes: ['PL!-pb2-002'],
    maximumEnteringOriginalHeartCount: 4,
    orientation: OrientationState.WAITING,
  },
];

/**
 * Resolves the orientation of a member as it enters a stage slot.
 *
 * The query reads the pre-entry stage. Only top-level opposing members in the
 * facing slot are continuous sources; source orientation does not matter.
 * Printed/original Hearts are read directly from the entering member data.
 */
export function resolveMemberEntryOrientation(
  game: GameState,
  enteringPlayerId: string,
  enteringMemberCardId: string,
  targetSlot: SlotPosition,
  requestedOrientation: OrientationState = OrientationState.ACTIVE
): OrientationState {
  const enteringPlayer = getPlayerById(game, enteringPlayerId);
  const enteringCard = getCardById(game, enteringMemberCardId);
  if (!enteringPlayer || !enteringCard || !isMemberCardData(enteringCard.data)) {
    return requestedOrientation;
  }

  const originalHeartCount = calculateTotalHearts(enteringCard.data);
  for (const sourcePlayer of game.players) {
    if (sourcePlayer.id === enteringPlayer.id) {
      continue;
    }
    const sourceSlot = toPlayerLocalSlotForControllerPerspective(
      targetSlot,
      enteringPlayer.id,
      sourcePlayer.id
    );
    const sourceCardId = sourcePlayer.memberSlots.slots[sourceSlot];
    const sourceCard = sourceCardId ? getCardById(game, sourceCardId) : null;
    if (!sourceCard || !isMemberCardData(sourceCard.data)) {
      continue;
    }

    const matchingRule = FACING_MEMBER_ENTRY_ORIENTATION_RULES.find(
      (rule) =>
        originalHeartCount <= rule.maximumEnteringOriginalHeartCount &&
        rule.sourceBaseCardCodes.some((baseCardCode) =>
          cardCodeMatchesBase(sourceCard.data.cardCode, baseCardCode)
        )
    );
    if (matchingRule) {
      return matchingRule.orientation;
    }
  }

  return requestedOrientation;
}
