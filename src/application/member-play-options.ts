import { isMemberCardData } from '../domain/entities/card.js';
import { getCardById, getPlayerById, type GameState } from '../domain/entities/game.js';
import { canMemberBeRelayedAway } from '../domain/rules/cost-calculator.js';
import { SlotPosition } from '../shared/types/enums.js';
import { canUseDoubleRelay } from '../shared/rules/double-relay.js';
import type { MemberPlayOption } from '../shared/rules/member-play-options.js';
import { getManualOperationMode } from './manual-operation-mode.js';
import {
  canAssignLlBp7001SpecialPlayPayment,
  getLlBp7001SpecialPlayTargetSlots,
  getNBp7011SpecialPlayTargetSlots,
  isLlBp7001SpecialPlaySource,
  isNBp7011SpecialPlaySource,
} from './effects/special-member-play.js';

const MEMBER_SLOTS = [SlotPosition.LEFT, SlotPosition.CENTER, SlotPosition.RIGHT] as const;

function getDoubleRelayTargetSlots(
  game: GameState,
  playerId: string,
  sourceCardId: string
): readonly SlotPosition[] {
  const player = getPlayerById(game, playerId);
  const source = getCardById(game, sourceCardId);
  if (
    !player ||
    !source ||
    source.ownerId !== playerId ||
    !player.hand.cardIds.includes(sourceCardId) ||
    !isMemberCardData(source.data) ||
    !canUseDoubleRelay(source.data)
  ) {
    return [];
  }

  const sourceMemberData = source.data;
  const rulesMode = getManualOperationMode(game) === 'RULES';
  return MEMBER_SLOTS.filter((slot) => {
    const occupantId = player.memberSlots.slots[slot];
    if (!occupantId || (rulesMode && player.movedToStageThisTurn.includes(occupantId))) {
      return false;
    }
    const occupant = getCardById(game, occupantId);
    return (
      occupant !== null &&
      isMemberCardData(occupant.data) &&
      canMemberBeRelayedAway(occupant.data, sourceMemberData)
    );
  });
}

export function getMemberPlayOptionsForHandCard(
  game: GameState,
  playerId: string,
  sourceCardId: string
): readonly MemberPlayOption[] {
  const options: MemberPlayOption[] = [];

  if (isLlBp7001SpecialPlaySource(game, playerId, sourceCardId)) {
    const targetSlots = getLlBp7001SpecialPlayTargetSlots(game, playerId, sourceCardId);
    if (
      targetSlots.length > 0 &&
      canAssignLlBp7001SpecialPlayPayment(game, playerId, sourceCardId)
    ) {
      options.push({
        id: 'LL_BP7_001_SPECIAL_PLAY',
        label: '特殊登场',
        kind: 'CARD_DEFINED',
        title: '选择特殊登场区域',
        description:
          '选择「国木田花丸」「优木雪菜」「岚千砂都」的成员卡各1张放置入休息室，再完成特殊登场。',
        targetSlots,
        mode: 'LL_BP7_001_SPECIAL_PLAY',
      });
    }
  } else if (isNBp7011SpecialPlaySource(game, playerId, sourceCardId)) {
    const targetSlots = getNBp7011SpecialPlayTargetSlots(game, playerId, sourceCardId);
    if (targetSlots.length > 0) {
      options.push({
        id: 'N_BP7_011_WAITING_MEMBERS_COST_MINUS_TWO',
        label: '特殊登场',
        kind: 'CARD_DEFINED',
        title: '选择特殊登场区域',
        description:
          '将自己休息室中的所有成员卡洗切并放置于卡组底，使此卡本次登场费用减2，再完成特殊登场。',
        targetSlots,
        mode: 'N_BP7_011_WAITING_MEMBERS_COST_MINUS_TWO',
      });
    }
  }

  const doubleRelayTargetSlots = getDoubleRelayTargetSlots(game, playerId, sourceCardId);
  if (doubleRelayTargetSlots.length >= 2) {
    options.push({
      id: 'DOUBLE_RELAY',
      label: '双换手',
      kind: 'DOUBLE_RELAY',
      title: '选择双换手区域',
      description: '依次选择两个成员区。第1个是登场位置，第2个是追加换手位置。',
      targetSlots: doubleRelayTargetSlots,
      selection: {
        minTargets: 2,
        maxTargets: 2,
        mustIncludeTarget: true,
      },
    });
  }

  return options;
}

export function getMemberPlayOptionsByHandCardId(
  game: GameState,
  playerId: string
): ReadonlyMap<string, readonly MemberPlayOption[]> {
  const player = getPlayerById(game, playerId);
  if (!player) {
    return new Map();
  }

  const entries = player.hand.cardIds
    .map((cardId) => [cardId, getMemberPlayOptionsForHandCard(game, playerId, cardId)] as const)
    .filter((entry) => entry[1].length > 0);
  return new Map(entries);
}
