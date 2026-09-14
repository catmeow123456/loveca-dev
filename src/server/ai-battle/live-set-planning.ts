import { z } from 'zod';
import { BladeHeartEffect, CardType, SlotPosition } from '../../shared/types/enums.js';
import type { AiDecisionInput } from './protocol.js';
import type { AiKnowledgeMaterial } from './presets.js';

// Read only the current frozen own-deck format. No registry lookup or hidden remaining order.
const deckReference = z.object({
  cards: z
    .array(
      z.object({
        count: z.number().int().positive(),
        card: z.object({
          cardType: z.enum(CardType),
          bladeHearts: z.array(z.object({ effect: z.enum(BladeHeartEffect) })).optional(),
        }),
      })
    )
    .min(1),
});

/** An optimistic printed-cheer baseline, never a prediction of effects or a legal-action filter. */
export function summarizeAiLiveSetPlanning(input: AiDecisionInput, ownDeck?: AiKnowledgeMaterial) {
  if (input.purpose !== 'LIVE_SET') return undefined;
  const resources = input.state.selfResources;
  const ownZones = Object.values(input.state.table.zones).filter(
    (zone) => zone.ownerSeat === input.state.selfSeat
  );
  const energyCount = ownZones.find((zone) => zone.zone === 'ENERGY_ZONE')?.count ?? 0;
  const energyDeckCount = ownZones.find((zone) => zone.zone === 'ENERGY_DECK')?.count ?? 0;
  const nextRegularEnergyCount = energyCount + (energyDeckCount > 0 ? 1 : 0);
  const handMembers = new Map<
    string,
    {
      cardCode: string;
      name: string;
      printedCost: number | undefined;
      objectIds: string[];
    }
  >();
  for (const card of resources.handCards) {
    if (card.cardType !== CardType.MEMBER) continue;
    const group = handMembers.get(card.cardCode) ?? {
      cardCode: card.cardCode,
      name: card.name,
      printedCost: card.printedCost,
      objectIds: [],
    };
    group.objectIds.push(card.objectId);
    handMembers.set(card.cardCode, group);
  }
  const mainCards = ownDeck
    ? deckReference
        .parse(JSON.parse(ownDeck.content))
        .cards.filter(({ card }) => card.cardType !== CardType.ENERGY)
    : [];
  const maxHeartsPerCheerCard = mainCards.length
    ? Math.max(
        ...mainCards.map(
          ({ card }) =>
            (card.bladeHearts ?? []).filter((item) => item.effect === BladeHeartEffect.HEART).length
        )
      )
    : null;
  const totalHeartCeiling =
    maxHeartsPerCheerCard === null
      ? null
      : resources.stageHeartTotal + resources.activeMemberBladeTotal * maxHeartsPerCheerCard;
  const liveCards = input.space.candidates.flatMap((candidate) => {
    if (!candidate.objectId || !candidate.liveBaseBudget) return [];
    const budget = candidate.liveBaseBudget;
    return [
      {
        actionRef: candidate.ref,
        objectId: candidate.objectId,
        location: resources.handCards.some((card) => card.objectId === candidate.objectId)
          ? 'HAND'
          : 'SET',
        ...budget,
        shortfallEvenAtPrintedCeiling:
          totalHeartCeiling === null
            ? null
            : Math.max(0, budget.requiredHearts.totalRequired - totalHeartCeiling),
      },
    ];
  });
  return {
    ...input.liveSet,
    nextOwnMainBaseline: {
      basis: 'REGULAR_REFRESH_AND_ONE_ENERGY_WITHOUT_EFFECTS',
      energyCount,
      nextRegularEnergyCount,
      followingRegularEnergyCount: energyCount + Math.min(2, energyDeckCount),
      emptyStageSlots: Object.values(SlotPosition).filter(
        (slot) => !resources.stageMembers.some((member) => member.slot === slot)
      ),
      exclusions:
        '列出下个及再下个自己的主要阶段常规能量预算，每轮恢复并从能量卡组增加至多1张；不含卡效增减。成员支付仅为印刷费用差，未计费用修正、其他支付和未来合法性。',
    },
    handMembers: [...handMembers.values()].map((group) => ({
      ...group,
      count: group.objectIds.length,
      coverActionRefs: input.space.candidates
        .filter((candidate) => candidate.objectId && group.objectIds.includes(candidate.objectId))
        .map((candidate) => candidate.ref),
      printedPayments: {
        emptySlot: group.printedCost ?? null,
        replaceStageMember: resources.stageMembers.map((member) => ({
          slot: member.slot,
          fromPrintedCost: member.printedCost ?? null,
          payment:
            group.printedCost === undefined || member.printedCost === undefined
              ? null
              : Math.max(0, group.printedCost - member.printedCost),
        })),
      },
    })),
    stageHeartCounts: resources.stageHeartCounts,
    stageHeartTotal: resources.stageHeartTotal,
    activeMemberBladeTotal: resources.activeMemberBladeTotal,
    printedCheerBaseline: {
      basis: 'CURRENT_STAGE_AND_FROZEN_DECK_PRINTED_CHEER' as const,
      maxHeartsPerCheerCard,
      totalHeartCeiling,
      finalFeasibility: 'UNDETERMINED' as const,
      exclusions:
        '未计玩家额外HEART、声援次数/判心修正、后续卡效及多LIVE合计需求；未检查指定色命中和剩余牌序。缺口为0不保证成功；正缺口必须有实际可执行的补足来源。',
    },
    liveCards,
  };
}
