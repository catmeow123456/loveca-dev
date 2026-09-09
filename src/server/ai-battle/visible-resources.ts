import type { PlayerViewState, Seat, ViewFrontCardInfo } from '../../online/types.js';
import { CardType, OrientationState, type HeartColor } from '../../shared/types/enums.js';

export function describeAiCardIdentity(front: ViewFrontCardInfo): string {
  return `${front.cardCode} ${front.cost !== undefined ? `费用 ${front.cost}` : `分数 ${front.score}`}「${front.nameCn ?? front.nameJp ?? front.cardCode}」`;
}

/** Bind a play to this visible printing's text; absent text is not proof of an ability. */
export function describeAiMemberPlay(
  front: ViewFrontCardInfo,
  replaced?: ViewFrontCardInfo
): string {
  const text = front.cardTextCn?.trim() || front.cardTextJp?.trim();
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
  return `登场 ${describeAiCardIdentity(front)}；新成员印刷值：${describe(incoming)}；${replaced ? `替换 ${describeAiCardIdentity(replaced)}，旧成员当前有效值：${describe(outgoing)}` : '填补空位，旧成员贡献为 0'}；静态差值（新成员印刷值减去旧成员当前有效值）：HEART ${signed(incoming.total - outgoing.total)}（${colorDeltas.join('、') || '无'}）／BLADE ${signed(incoming.blade - outgoing.blade)}；此差值未预结算卡效、常时条件或朝向变化，不是完整舞台预测；本实例卡文：${text || '未提供，不得假设有登场能力'}`;
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
    handCards,
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
