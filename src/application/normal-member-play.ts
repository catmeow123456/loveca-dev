import { isMemberCardData } from '../domain/entities/card.js';
import { getCardById, getPlayerById, type GameState } from '../domain/entities/game.js';
import { costCalculator, type CostPaymentPlan } from '../domain/rules/cost-calculator.js';
import { canPlayMemberInStageSlotThisTurn } from '../domain/rules/member-turn-state.js';
import { SlotPosition } from '../shared/types/enums.js';
import type { PlayMemberToSlotCommand } from './game-commands.js';
import { buildPlayMemberCostResources } from './effects/play-member-cost.js';

type MemberPlayParameters = Pick<
  PlayMemberToSlotCommand,
  'playerId' | 'cardId' | 'targetSlot' | 'relayMode' | 'relayReplacementSlots'
>;

/** Parameter-level RULES query. Timing and actor authorization remain at the command boundary. */
export function queryNormalMemberPlay(
  game: GameState,
  input: MemberPlayParameters
):
  | {
      readonly ok: true;
      readonly plan: CostPaymentPlan;
      readonly payableEnergyCardIds: readonly string[];
    }
  | { readonly ok: false; readonly reason: string } {
  const player = getPlayerById(game, input.playerId);
  const card = getCardById(game, input.cardId);
  if (
    !player ||
    !card ||
    card.ownerId !== input.playerId ||
    !player.hand.cardIds.includes(input.cardId)
  ) {
    return { ok: false, reason: '卡牌当前不在己方手牌' };
  }
  if (!isMemberCardData(card.data)) {
    return { ok: false, reason: '只有成员卡可以登场到成员区' };
  }
  const slots = [
    input.targetSlot,
    ...(input.relayMode === 'DOUBLE' ? (input.relayReplacementSlots ?? []) : []),
  ];
  if (slots.some((slot) => !Object.values(SlotPosition).includes(slot))) {
    return { ok: false, reason: '无效的成员区' };
  }
  if (slots.some((slot) => !canPlayMemberInStageSlotThisTurn(game, input.playerId, slot))) {
    return { ok: false, reason: '该成员区的成员本回合刚登场，不能再在此登场成员' };
  }
  const resources = buildPlayMemberCostResources(
    game,
    input.playerId,
    input.cardId,
    player.hand.cardIds
  );
  if (!resources) return { ok: false, reason: '无法计算成员卡的当前费用' };
  const check = costCalculator.checkCanPayCost(card.data, input.targetSlot, resources, {
    relayMode: input.relayMode,
    relayReplacementSlots: input.relayReplacementSlots,
  });
  const plan = costCalculator.selectOptimalPlan(check.availablePlans);
  if (!plan) return { ok: false, reason: check.reason ?? '可用活跃能量不足' };
  return { ok: true, plan, payableEnergyCardIds: resources.activeEnergyIds };
}

/** Enumerates ordinary/single-relay inputs; card-defined and double-relay entries have separate workflows. */
export function getNormalMemberPlayOptions(game: GameState, playerId: string) {
  return (getPlayerById(game, playerId)?.hand.cardIds ?? []).flatMap((cardId) =>
    [SlotPosition.LEFT, SlotPosition.CENTER, SlotPosition.RIGHT].flatMap((targetSlot) => {
      const result = queryNormalMemberPlay(game, { playerId, cardId, targetSlot });
      return result.ok ? [{ cardId, targetSlot, plan: result.plan }] : [];
    })
  );
}
