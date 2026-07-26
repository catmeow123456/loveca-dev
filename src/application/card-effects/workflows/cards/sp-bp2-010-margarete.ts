import {
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { findMemberSlot } from '../../../../domain/entities/player.js';
import { getAllMemberCardIds } from '../../../../domain/entities/zone.js';
import { SP_BP2_010_LIVE_START_OTHER_MEMBER_CHEER_COUNT_MINUS_EIGHT_ABILITY_ID } from '../../ability-ids.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';
import { registerLiveStartCheerCountWorkflowHandlers } from '../shared/live-start-cheer-count.js';

const CHEER_COUNT_DELTA = -8;

export function registerSpBp2010MargareteWorkflowHandlers(): void {
  registerLiveStartCheerCountWorkflowHandlers([
    {
      abilityId: SP_BP2_010_LIVE_START_OTHER_MEMBER_CHEER_COUNT_MINUS_EIGHT_ABILITY_ID,
      countDelta: CHEER_COUNT_DELTA,
      actionStep: 'OTHER_MEMBER_CHEER_COUNT_MINUS_EIGHT',
      confirmationMode: 'NONE',
      getContext: getMargareteCheerCountContext,
      getConfirmationEffectText: (_game, ability, context) =>
        `${getAbilityEffectText(ability.abilityId)}（当前舞台${
          context.conditionMet ? '存在' : '不存在'
        }其他成员，实际声援张数${context.conditionMet ? '减少8张' : '不变'}。）`,
    },
  ]);
}

function getMargareteCheerCountContext(
  game: GameState,
  ability: PendingAbilityState
): {
  readonly conditionMet: boolean;
  readonly metadata: {
    readonly sourceSlot: ReturnType<typeof findMemberSlot>;
    readonly otherMemberCardIds: readonly string[];
  };
} {
  const player = getPlayerById(game, ability.controllerId);
  const sourceSlot = player ? findMemberSlot(player, ability.sourceCardId) : null;
  const otherMemberCardIds = player
    ? getAllMemberCardIds(player.memberSlots).filter((cardId) => cardId !== ability.sourceCardId)
    : [];
  return {
    conditionMet: sourceSlot !== null && otherMemberCardIds.length > 0,
    metadata: { sourceSlot, otherMemberCardIds },
  };
}
