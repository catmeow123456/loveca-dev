import type { Seat } from '../../online/index.js';
import { getBaseCardCode } from '../../shared/utils/card-code.js';
import type { AiObservation, AiObservedAction } from './ai-observation.js';

export const AI_STRATEGIC_OBJECTIVES_SCHEMA_VERSION =
  'ai-battle.strategic-objectives/v1' as const;

export type AiStrategicObjectiveKind =
  | 'MAINTAIN_LIVE_ACCESS'
  | 'MAINTAIN_STAGE_DEVELOPMENT'
  | 'PRESERVE_ENERGY_EFFICIENCY';

export interface AiStrategicObjective {
  readonly objectiveId: string;
  readonly kind: AiStrategicObjectiveKind;
  readonly priority: 'HIGH' | 'MEDIUM';
  readonly source: 'SERVER_DERIVED';
  readonly createdTurnCount: number;
  readonly lastObservedTurnCount: number;
  readonly summary: string;
  readonly evidence: readonly string[];
}

export interface AiStrategicObjectiveSet {
  readonly schemaVersion: typeof AI_STRATEGIC_OBJECTIVES_SCHEMA_VERSION;
  readonly items: readonly AiStrategicObjective[];
}

export interface AiStrategicObjectiveTracker {
  /**
   * Derives objectives only from the current redacted observation. Matching
   * objectives retain their creation turn across decision windows.
   */
  observe(observation: AiObservation): AiStrategicObjectiveSet;
}

interface ObjectiveDraft {
  readonly kind: AiStrategicObjectiveKind;
  readonly priority: AiStrategicObjective['priority'];
  readonly summary: string;
  readonly evidence: readonly string[];
}

/**
 * Creates a seat-local tracker for server-derived tactical continuity.
 *
 * Model explanations and plans are deliberately not accepted by this API, so
 * free text can never become an authoritative objective for a later window.
 */
export function createAiStrategicObjectiveTracker(
  viewerSeat: Seat
): AiStrategicObjectiveTracker {
  let active = new Map<AiStrategicObjectiveKind, AiStrategicObjective>();

  return {
    observe(observation) {
      if (observation.viewerSeat !== viewerSeat) {
        throw new Error('AI strategic-objective tracker viewer seat mismatch');
      }
      const drafts = deriveObjectiveDrafts(observation, active);
      const next = new Map<AiStrategicObjectiveKind, AiStrategicObjective>();
      for (const draft of drafts) {
        const previous = active.get(draft.kind);
        const objective: AiStrategicObjective = {
          objectiveId: objectiveId(draft.kind),
          kind: draft.kind,
          priority: draft.priority,
          source: 'SERVER_DERIVED',
          createdTurnCount: previous?.createdTurnCount ?? observation.turn.count,
          lastObservedTurnCount: observation.turn.count,
          summary: draft.summary,
          evidence: [...draft.evidence],
        };
        next.set(draft.kind, objective);
      }
      active = next;
      return cloneObjectiveSet(active.values());
    },
  };
}

/** Stateless convenience for tests and offline playout builders. */
export function deriveAiStrategicObjectives(observation: AiObservation): AiStrategicObjectiveSet {
  return createAiStrategicObjectiveTracker(observation.viewerSeat).observe(observation);
}

export function cloneAiStrategicObjectiveSet(
  value: AiStrategicObjectiveSet
): AiStrategicObjectiveSet {
  if (value.schemaVersion !== AI_STRATEGIC_OBJECTIVES_SCHEMA_VERSION) {
    throw new Error('AI strategic objectives require the current schema version');
  }
  return {
    schemaVersion: AI_STRATEGIC_OBJECTIVES_SCHEMA_VERSION,
    items: value.items.map((item) => ({ ...item, evidence: [...item.evidence] })),
  };
}

function deriveObjectiveDrafts(
  observation: AiObservation,
  previous: ReadonlyMap<AiStrategicObjectiveKind, AiStrategicObjective>
): readonly ObjectiveDraft[] {
  const self = observation.seats[observation.viewerSeat];
  const hand = self.zones.find((zone) => zone.zoneKey === 'HAND');
  const liveZone = self.zones.find((zone) => zone.zoneKey === 'LIVE');
  const energy = self.zones.find((zone) => zone.zoneKey === 'ENERGY');
  const handLiveCount =
    hand?.visibleCards.filter((card) => card.cardType === 'LIVE' && card.role !== 'MEMBER_BELOW')
      .length ?? 0;
  const liveZoneCount = liveZone?.count ?? 0;
  const stageMemberCount = self.zones
    .filter((zone) => zone.zoneKey.startsWith('MEMBER_'))
    .reduce((count, zone) => count + (zone.count > 0 ? 1 : 0), 0);
  const activeEnergyCount =
    energy?.visibleCards.filter((card) => card.orientation === 'ACTIVE').length ?? 0;
  const drafts: ObjectiveDraft[] = [];

  if (self.successLiveCount < 3 && liveZoneCount === 0) {
    drafts.push({
      kind: 'MAINTAIN_LIVE_ACCESS',
      priority: 'HIGH',
      summary:
        handLiveCount > 0
          ? '在完成本回合 LIVE 设置前，至少保留并优先使用 1 张可见 LIVE 卡。'
          : '当前缺少可用于 LIVE 设置的 LIVE 卡；优先取得并保留至少 1 张。',
      evidence: [
        `当前手牌可见 LIVE 卡 ${String(handLiveCount)} 张，LIVE 区 ${String(liveZoneCount)} 张。`,
        `当前成功 LIVE ${String(self.successLiveCount)} 张，尚未达到通常胜利目标。`,
      ],
    });
  }

  drafts.push({
    kind: 'MAINTAIN_STAGE_DEVELOPMENT',
    priority: stageMemberCount === 0 ? 'HIGH' : 'MEDIUM',
    summary:
      stageMemberCount < 2
        ? '将舞台稳定扩展到至少 2 名成员，并避免为了等价资源循环撤销已有进展。'
        : '保留已经形成的舞台进展；只有在换手、起动或回收产生明确净收益时才减少成员。',
    evidence: [`当前舞台有 ${String(stageMemberCount)} 名成员。`],
  });

  const energyComparison = compareCurrentMemberPlayEnergy(observation);
  const previousEnergyObjective = previous.get('PRESERVE_ENERGY_EFFICIENCY');
  if (energyComparison) {
    drafts.push({
      kind: 'PRESERVE_ENERGY_EFFICIENCY',
      priority: 'MEDIUM',
      summary: '比较扩场与换手的净收益；不要为同一成员的较贵路线额外支付能量而没有持续收益。',
      evidence: [
        `${energyComparison.cardName}当前合法登场路线需支付 ${String(energyComparison.minCost)}～${String(energyComparison.maxCost)} 张能量，价差 ${String(energyComparison.maxCost - energyComparison.minCost)}。`,
        `当前有 ${String(activeEnergyCount)} 张活跃能量。`,
      ],
    });
  } else if (
    previousEnergyObjective &&
    observation.turn.phase === 'MAIN_PHASE' &&
    previousEnergyObjective.lastObservedTurnCount === observation.turn.count
  ) {
    drafts.push({
      kind: 'PRESERVE_ENERGY_EFFICIENCY',
      priority: 'MEDIUM',
      summary: '本回合此前存在更省能量的换手路线；后续动作应说明额外资源消耗带来的净收益。',
      evidence: [
        `当前仍在同一主要阶段，活跃能量为 ${String(activeEnergyCount)} 张。`,
        ...previousEnergyObjective.evidence.slice(0, 1),
      ],
    });
  }

  return drafts.sort(
    (left, right) =>
      priorityRank(left.priority) - priorityRank(right.priority) ||
      compareText(left.kind, right.kind)
  );
}

function compareCurrentMemberPlayEnergy(observation: AiObservation):
  | {
      readonly cardName: string;
      readonly minCost: number;
      readonly maxCost: number;
    }
  | null {
  if (observation.decision.kind !== 'MAIN_PHASE') return null;
  const candidates = new Map(
    observation.decision.candidates.map((candidate) => [candidate.candidateId, candidate])
  );
  const grouped = new Map<
    string,
    { readonly cardName: string; readonly actions: AiObservedAction[] }
  >();
  for (const action of observation.decision.actions) {
    if (action.kind !== 'PLAY_MEMBER' || !action.candidateId || !action.paymentPreview) continue;
    const card = candidates.get(action.candidateId)?.card;
    if (!card) continue;
    const key = getBaseCardCode(card.cardCode);
    const existing = grouped.get(key);
    if (existing) existing.actions.push(action);
    else grouped.set(key, { cardName: card.name, actions: [action] });
  }

  let best: { readonly cardName: string; readonly minCost: number; readonly maxCost: number } | null =
    null;
  for (const group of grouped.values()) {
    const costs = group.actions.map((action) => action.paymentPreview!.energyCost);
    const minCost = Math.min(...costs);
    const maxCost = Math.max(...costs);
    if (maxCost <= minCost) continue;
    if (!best || maxCost - minCost > best.maxCost - best.minCost) {
      best = { cardName: group.cardName, minCost, maxCost };
    }
  }
  return best;
}

function cloneObjectiveSet(items: Iterable<AiStrategicObjective>): AiStrategicObjectiveSet {
  return {
    schemaVersion: AI_STRATEGIC_OBJECTIVES_SCHEMA_VERSION,
    items: [...items]
      .sort(
        (left, right) =>
          priorityRank(left.priority) - priorityRank(right.priority) ||
          compareText(left.kind, right.kind)
      )
      .map((item) => ({ ...item, evidence: [...item.evidence] })),
  };
}

function objectiveId(kind: AiStrategicObjectiveKind): string {
  return `objective-${kind.toLowerCase().replace(/_/gu, '-')}`;
}

function priorityRank(priority: AiStrategicObjective['priority']): number {
  return priority === 'HIGH' ? 0 : 1;
}

function compareText(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}
