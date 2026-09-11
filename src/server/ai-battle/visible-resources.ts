import type { PlayerViewState, Seat, ViewFrontCardInfo } from '../../online/types.js';
import { CardType, OrientationState, type HeartColor } from '../../shared/types/enums.js';
import { HeartPool, calculateHeartDeficit } from '../../domain/value-objects/heart.js';
import { applyHeartRequirementModifiers } from '../../domain/rules/live-requirement-modifiers.js';
import type { AiCandidate } from './protocol.js';

export function describeAiCardIdentity(front: ViewFrontCardInfo): string {
  return `${front.cardCode} ${front.cost !== undefined ? `费用 ${front.cost}` : `分数 ${front.score}`}「${front.nameCn ?? front.nameJp ?? front.cardCode}」`;
}

/** Bind a play to this visible printing's text; absent text is not proof of an ability. */
export function describeAiMemberPlay(
  front: ViewFrontCardInfo,
  replaced?: ViewFrontCardInfo,
  context?: {
    resources: AiSelfResources;
    targetSlot: string;
    energyCost: number;
  }
): string {
  const incoming = memberResources(front);
  const outgoing = memberResources(replaced);
  const colors = new Set([...Object.keys(incoming.hearts), ...Object.keys(outgoing.hearts)]);
  const signed = (value: number) => (value > 0 ? `+${value}` : String(value));
  const colorDeltas = [...colors].map(
    (color) => `${color} ${signed((incoming.hearts[color] ?? 0) - (outgoing.hearts[color] ?? 0))}`
  );
  const describe = (value: ReturnType<typeof memberResources>) =>
    `HEART ${value.total}（${
      Object.entries(value.hearts)
        .map(([color, count]) => `${color} ${count}`)
        .join('、') || '无'
    }）／BLADE ${value.blade}`;
  const costDelta =
    front.cost !== undefined && (!replaced || replaced.cost !== undefined)
      ? `；舞台顶层成员印刷总费用变化 ${signed(front.cost - (replaced?.cost ?? 0))}，实际支付见 energyCost`
      : '';
  let stageComparison = '';
  if (context) {
    const { resources, targetSlot, energyCost } = context;
    const old = resources.stageMembers.find((member) => member.slot === targetSlot);
    const costBefore = resources.stageMembers.reduce(
      (total, member) => total + member.printedCost!,
      0
    );
    const after = summarizeAiStageAfterEntry(resources, targetSlot, front);
    const costAfter = after.printedCostTotal;
    const formation = resources.stageMembers
      .filter((member) => member.slot !== targetSlot)
      .map((member) => `${member.slot}=${member.printedCost}`);
    formation.push(`${targetSlot}=${front.cost}`);
    const bladeAfter = after.activeMemberBladeTotal;
    stageComparison = `；主要阶段静态账面（仅移除被替换成员、加入活跃新成员，未结算任何卡效或其他成员变化）：支付 ${energyCost}，能量 ${resources.activeEnergyCount}→${resources.activeEnergyCount - energyCost}；舞台 ${formation.join('、')}，成员数 ${resources.stageMembers.length}→${resources.stageMembers.length + (old ? 0 : 1)}，印刷总费用 ${costBefore}→${costAfter}，HEART ${resources.stageHeartTotal}→${after.stageHeartTotal}，活跃 BLADE ${resources.activeMemberBladeTotal}→${bladeAfter}`;
  }
  return `登场 ${describeAiCardIdentity(front)}；新成员印刷值：${describe(incoming)}；${replaced ? `替换 ${describeAiCardIdentity(replaced)}，旧成员当前有效值：${describe(outgoing)}` : '填补空位，旧成员贡献为 0'}；静态差值（新成员印刷值减去旧成员当前有效值）：HEART ${signed(incoming.total - outgoing.total)}（${colorDeltas.join('、') || '无'}）／BLADE ${signed(incoming.blade - outgoing.blade)}${costDelta}${stageComparison}；此差值未预结算卡效、常时条件或朝向变化，不是完整舞台预测；能力见本候选 effectText 与对象卡文`;
}

/** Compare stopping with every available action; this does not rank, remove or execute any. */
export function describeAiMainPhaseEnd(
  activeEnergyCount: number,
  alternatives: readonly AiCandidate[]
): string {
  const budgets = alternatives.map((candidate) =>
    candidate.energyCost === undefined
      ? `${candidate.ref}（起动，代价与后续目标见该候选卡文）`
      : `${candidate.ref}（${candidate.activation ? '起动' : '登场'}支付 ${candidate.energyCost}，剩余 ${activeEnergyCount - candidate.energyCost} 能量）`
  );
  return `结束主要阶段；当前活跃能量 ${activeEnergyCount}；${
    budgets.length ? `仍可选择：${budgets.join('、')}` : '当前没有其他主要阶段动作'
  }。结束后不能再普通登场，LIVE 设置盖牌及抽牌不消耗能量，新抽手牌不能返回本次主要阶段登场。${
    budgets.length
      ? '结束前逐项比较可发动能力的可见目标：支付费用→目标登场或移动→后续触发→LIVE收益。activation.destination=SOURCE_MEMBER_SLOT 表示直接登场到原区域，不再支付普通登场费用；HAND 表示先回手，成员需另有合法登场机会和预算。entryResources 只列已查询的条件收益，空列表不表示没有能力，恢复能量仍取决于结算时的待机能量。当前 HEART 不足时，先检查能否发展场面或获取其他 LIVE，再判断表演机会。优先本轮得分和有效资源，舞台总费用只是衔接参考；保留能量说明下次恢复前的具体用途，没有有价值的路线才结束。tradeoff 简述净资源变化与下一步用途，选择结束时说明放弃的最佳可见路线及理由。'
      : ''
  }`;
}

/** Stage frontInfo is already effective; modifierDelta must not be added again. */
function memberResources(front?: ViewFrontCardInfo) {
  const hearts: Record<string, number> = {};
  for (const heart of front?.hearts ?? [])
    hearts[heart.color] = (hearts[heart.color] ?? 0) + heart.count;
  return {
    hearts,
    total: Object.values(hearts).reduce((sum, count) => sum + count, 0),
    blade: front?.blade ?? 0,
  };
}

/** Only the visible old member is removed and the incoming printed member is added active.
 * Triggered effects and changes to other members' continuous conditions are not forecast here.
 */
export function summarizeAiStageAfterEntry(
  resources: AiSelfResources,
  slot: string,
  front: ViewFrontCardInfo
) {
  const old = resources.stageMembers.find((member) => member.slot === slot);
  const stageHeartCounts: Partial<Record<HeartColor, number>> = { ...resources.stageHeartCounts };
  for (const heart of old?.hearts ?? [])
    stageHeartCounts[heart.color] = (stageHeartCounts[heart.color] ?? 0) - heart.count;
  for (const heart of front.hearts ?? [])
    stageHeartCounts[heart.color] = (stageHeartCounts[heart.color] ?? 0) + heart.count;
  return {
    basis: 'STATIC_MEMBER_REPLACEMENT_WITHOUT_OTHER_EFFECTS' as const,
    stageHeartCounts,
    stageHeartTotal: Object.values(stageHeartCounts).reduce((sum, count) => sum + count, 0),
    activeMemberBladeTotal:
      resources.activeMemberBladeTotal -
      (old?.orientation === OrientationState.ACTIVE ? old.blade : 0) +
      (front.blade ?? 0),
    printedCostTotal:
      resources.stageMembers.reduce((sum, member) => sum + member.printedCost!, 0) -
      (old?.printedCost ?? 0) +
      front.cost!,
  };
}

export type AiStageEntryBudget = ReturnType<typeof summarizeAiStageAfterEntry>;

/** Base requirement comparison only: no cheer, player modifiers, other LIVE or future effects. */
export function summarizeAiLiveBaseBudget(
  resources: { stageHeartCounts: Partial<Record<HeartColor, number>> },
  front: ViewFrontCardInfo
) {
  if (front.cardType !== CardType.LIVE || !front.requiredHearts) return undefined;
  const requirement = applyHeartRequirementModifiers(
    {
      colorRequirements: new Map(
        Object.entries(front.requiredHearts.colorRequirements) as [HeartColor, number][]
      ),
      totalRequired: front.requiredHearts.totalRequired,
    },
    []
  );
  const pool = new HeartPool(
    new Map(Object.entries(resources.stageHeartCounts) as [HeartColor, number][])
  );
  const missingHearts = Object.fromEntries(calculateHeartDeficit(pool, requirement));
  return {
    basis: 'CURRENT_STAGE_MEMBERS_VS_BASE_REQUIREMENT' as const,
    score: front.score,
    requiredHearts: front.requiredHearts,
    stageHeartCounts: resources.stageHeartCounts,
    missingHearts,
    stageAloneMeetsBaseRequirement: pool.canSatisfy(requirement),
  };
}

export type AiLiveBaseBudget = ReturnType<typeof summarizeAiLiveBaseBudget>;

export function describeAiLiveSet(front: ViewFrontCardInfo): string {
  return `里侧设置 ${describeAiCardIdentity(front)}；手牌 → LIVE 区，不移走舞台成员；确认设置后计入抽牌数`;
}

export function describeAiLiveSetCompletion(setCount: number): string {
  return `完成 LIVE 设置；本次已盖 ${setCount} 张，确认后抽 ${setCount} 张；不再追加盖牌`;
}

/** A model-readable subtotal of already visible facts, never a new rules calculation or state.
 * Real-model sampling demonstrated repeated counting of hand/opponent cards as own stage cards.
 */
export function summarizeAiSelfResources(
  view: Pick<PlayerViewState, 'table' | 'objects'>,
  selfSeat: Seat
) {
  const stageMembers = [];
  const handCards = [];
  const stageHeartCounts: Partial<Record<HeartColor, number>> = {};
  let activeEnergyCount = 0;
  let successfulLiveCount = 0;
  let activeMemberBladeTotal = 0;
  for (const zone of Object.values(view.table.zones)) {
    if (zone.ownerSeat !== selfSeat) continue;
    if (zone.zone === 'HAND') {
      for (const objectId of zone.objectIds ?? []) {
        const object = view.objects[objectId];
        if (object?.surface !== 'FRONT' || !object.frontInfo) continue;
        const front = object.frontInfo;
        handCards.push({
          objectId,
          cardCode: front.cardCode,
          name: front.nameCn ?? front.nameJp ?? front.cardCode,
          cardType: front.cardType,
          printedCost: front.cost,
          score: front.score,
          requiredHearts: front.requiredHearts,
        });
      }
    }
    if (zone.zone === 'ENERGY_ZONE') {
      activeEnergyCount += zone.objectIds!.filter(
        (id) => view.objects[id]?.orientation === OrientationState.ACTIVE
      ).length;
    }
    if (zone.zone === 'SUCCESS_ZONE') successfulLiveCount += zone.count;
    if (zone.zone !== 'MEMBER_SLOT') continue;
    for (const [slot, objectId] of Object.entries(zone.slotMap!)) {
      if (!objectId) continue;
      const object = view.objects[objectId];
      if (object?.surface !== 'FRONT' || !object.frontInfo) continue;
      const front = object.frontInfo;
      const hearts = front.hearts ?? [];
      const blade = front.blade ?? 0;
      stageMembers.push({
        slot,
        objectId,
        cardCode: front.cardCode,
        name: front.nameCn ?? front.nameJp ?? front.cardCode,
        printedCost: front.cost,
        orientation: object.orientation,
        hearts,
        blade,
      });
      for (const heart of hearts)
        stageHeartCounts[heart.color] = (stageHeartCounts[heart.color] ?? 0) + heart.count;
      if (object.orientation === OrientationState.ACTIVE) activeMemberBladeTotal += blade;
    }
  }
  return {
    handCards: handCards.map((card) => {
      const liveBaseBudget = summarizeAiLiveBaseBudget(
        { stageHeartCounts },
        view.objects[card.objectId]!.frontInfo!
      );
      return liveBaseBudget ? { ...card, liveBaseBudget } : card;
    }),
    handLiveCount: handCards.filter((card) => card.cardType === CardType.LIVE).length,
    stageMembers,
    stageHeartCounts,
    stageHeartTotal: Object.values(stageHeartCounts).reduce((sum, count) => sum + count, 0),
    activeMemberBladeTotal,
    activeEnergyCount,
    successfulLiveCount,
  };
}

export type AiSelfResources = ReturnType<typeof summarizeAiSelfResources>;
