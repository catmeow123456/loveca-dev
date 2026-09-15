import type { PlayerViewState, Seat, ViewFrontCardInfo } from '../../online/types.js';
import { CardType, OrientationState, type HeartColor } from '../../shared/types/enums.js';
import { HeartPool, calculateHeartDeficit } from '../../domain/value-objects/heart.js';
import { applyHeartRequirementModifiers } from '../../domain/rules/live-requirement-modifiers.js';
import type { AiCandidate } from './protocol.js';

export function describeAiCardIdentity(front: ViewFrontCardInfo): string {
  return `${front.cardCode} ${front.cost !== undefined ? `费用 ${front.cost}` : `分数 ${front.score}`}「${front.nameCn ?? front.nameJp ?? front.cardCode}」`;
}

/** Short identities are grouped by card type, so the number is cost for members and score for LIVE. */
function compactCardIdentity(front: ViewFrontCardInfo): string {
  const value =
    front.cardType === CardType.MEMBER
      ? (front.cost ?? '?')
      : front.cardType === CardType.LIVE
        ? (front.score ?? '?')
        : '';
  return `${value}${front.nameCn ?? front.nameJp ?? front.cardCode}(${front.cardCode})`;
}

/** Only this seat's current waiting-room fronts; hidden identities never enter the summary. */
function describeWaitingRoom(view: Pick<PlayerViewState, 'table' | 'objects'>, selfSeat: Seat) {
  const cards: ViewFrontCardInfo[] = [];
  let total = 0;
  for (const zone of Object.values(view.table.zones)) {
    if (zone.ownerSeat !== selfSeat || zone.zone !== 'WAITING_ROOM') continue;
    total += zone.count;
    for (const id of zone.objectIds ?? []) {
      const object = view.objects[id];
      if (object?.surface === 'FRONT' && object.frontInfo) cards.push(object.frontInfo);
    }
  }
  const group = (label: string, selected: readonly ViewFrontCardInfo[]) => {
    const counts = new Map<string, number>();
    for (const card of selected) {
      const name = compactCardIdentity(card);
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    const list = [...counts].map(([name, count]) => `${name}${count > 1 ? `×${count}` : ''}`);
    return `${label} ${selected.length} 张${list.length ? `：${list.join('、')}` : ''}`;
  };
  const unknown = Math.max(0, total - cards.length);
  const other = cards.filter(
    (card) => card.cardType !== CardType.MEMBER && card.cardType !== CardType.LIVE
  );
  return `己方休息室${unknown ? '（仅列已知正面）' : ''}：${[
    group(
      '成员',
      cards.filter((card) => card.cardType === CardType.MEMBER)
    ),
    group(
      'LIVE',
      cards.filter((card) => card.cardType === CardType.LIVE)
    ),
    ...(other.length ? [group('其他', other)] : []),
    ...(unknown ? [`未知正面 ${unknown} 张`] : []),
  ].join('；')}`;
}

/** Describe existing queries, not simulated effects or a recommendation to activate. */
export function describeAiActivationResources(activation: NonNullable<AiCandidate['activation']>) {
  const costs = activation.costs.map((cost) => {
    switch (cost.kind) {
      case 'SEND_SOURCE_MEMBER_TO_WAITING_ROOM':
        return '来源成员送入休息室（离场，失去其舞台贡献与换手基础）';
      case 'TAP_ACTIVE_ENERGY':
        return `支付 ${cost.count} 能量`;
      case 'DISCARD_HAND_TO_WAITING_ROOM':
        return `${cost.optional ? '可选' : ''}弃手 ${cost.minCount === cost.maxCount ? cost.minCount : `${cost.minCount}–${cost.maxCount}`} 张`;
      case 'SET_SOURCE_MEMBER_ORIENTATION':
        return `来源成员变为${cost.orientation === OrientationState.WAITING ? '待机' : '活跃'}`;
    }
  });
  const destination = activation.destination === 'HAND' ? '回手' : '登场到来源槽位';
  return `已查询费用：${costs.join('、') || '无'}；支付后可见${destination}目标 ${activation.targets.length} 张${activation.targets.length === 0 ? '（没有可见目标，不能计入取得目标卡的收益）' : '（尚未选择或取得）'}`;
}

/** Ordinary hand play only: quote its one-card outlay without forecasting effect refunds. */
export function describeAiMemberPlay(
  front: ViewFrontCardInfo,
  replaced?: ViewFrontCardInfo,
  context?: {
    resources: AiSelfResources;
    targetSlot: string;
    energyCost: number;
  }
): string {
  const handCost = context
    ? `手牌 ${context.resources.handCards.length}→${context.resources.handCards.length - 1}（打出 1 张，未计卡效）`
    : '手牌打出 1 张（未计卡效）';
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
  return `登场 ${describeAiCardIdentity(front)}；${handCost}；新成员印刷值：${describe(incoming)}；${replaced ? `替换 ${describeAiCardIdentity(replaced)}，旧成员当前有效值：${describe(outgoing)}` : '填补空位，旧成员贡献为 0'}；静态差值（新成员印刷值减去旧成员当前有效值）：HEART ${signed(incoming.total - outgoing.total)}（${colorDeltas.join('、') || '无'}）／BLADE ${signed(incoming.blade - outgoing.blade)}${costDelta}${stageComparison}；此差值未预结算卡效、常时条件或朝向变化，不是完整舞台预测；能力见本候选 effectText 与对象卡文`;
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
  }。结束后不能再普通登场，LIVE 设置盖牌及抽牌不消耗能量，新抽手牌不能返回本次主要阶段登场。`;
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
  return `选择 ${describeAiCardIdentity(front)} 作为本次最终盖牌；手牌 → LIVE 区，不移走舞台成员；整组提交后自动确认并计入抽牌数；盖下的 LIVE 并入本轮合并判定（全成或全败），唱不成的 LIVE 会使整轮得 0 分，只有成员卡盖牌才不参与判定`;
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
    waitingRoomSummary: describeWaitingRoom(view, selfSeat),
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
