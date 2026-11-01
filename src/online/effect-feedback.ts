import type { GameState, LiveModifierState } from '../domain/entities/game.js';
import { isLiveCardData, isMemberCardData, type HeartIcon } from '../domain/entities/card.js';
import {
  collectLiveModifiers,
  getMemberEffectiveBladeCount,
  getMemberEffectiveHeartIcons,
  getMemberHeartContributionLifecycleId,
} from '../domain/rules/live-modifiers.js';
import { getMemberEffectiveCost } from '../domain/rules/member-effective-cost.js';
import { applyHeartRequirementModifiers } from '../domain/rules/live-requirement-modifiers.js';
import { FaceState, HeartColor } from '../shared/types/enums.js';
import {
  createPublicObjectId,
  getSeatByPlayerIndex,
  isLiveModifierVisibleToViewer,
} from './projector.js';
import type {
  EffectFeedbackChange,
  EffectFeedbackPublicEvent,
  EffectFeedbackTarget,
  PublicEventSource,
  Seat,
  ViewZoneKey,
} from './types.js';

type Draft = Omit<EffectFeedbackPublicEvent, 'eventId' | 'matchId' | 'seq' | 'timestamp'>;
type Options = {
  readonly source: PublicEventSource;
  readonly actorSeat?: Seat;
  readonly isPublicCard: (state: GameState, cardId: string) => boolean;
};
type Metric = {
  readonly target: Omit<EffectFeedbackTarget, 'changes'>;
  readonly kind: 'HEART' | 'BLADE' | 'SCORE' | 'REQUIREMENT' | 'COST';
  readonly color?: HeartColor;
  readonly value: number;
};

/**
 * Derives presentation from authority facts, without changing any rule state.
 * Additive modifiers retain their exact source. Passive updates omit source
 * activation, while positive stat changes may still light their targets.
 * A public event only includes facts visible to BOTH seats.
 */
export function buildEffectFeedbackEvents(
  before: GameState,
  after: GameState,
  options: Options
): Draft[] {
  const events: Draft[] = [];
  const sourceId = (id: string | undefined) =>
    id && (options.isPublicCard(before, id) || options.isPublicCard(after, id))
      ? createPublicObjectId(id)
      : undefined;
  const push = (
    mode: Draft['mode'],
    source: string | undefined,
    targets: readonly EffectFeedbackTarget[]
  ) => {
    if (!source && targets.length === 0) return;
    events.push({
      type: 'EffectFeedback',
      source: options.source,
      actorSeat: options.actorSeat,
      mode,
      ...(source ? { sourceObjectId: source } : {}),
      targets,
    });
  };

  // Only persisted additions replay an ability. Match them as a multiset so two
  // identical grants remain two real increments, including across restored state.
  const oldModifiers = publicModifiers(before, after);
  const newModifiers = publicModifiers(after, before);
  const additions = newModifiers.filter((modifier) =>
    after.liveResolution.liveModifiers.includes(modifier)
  );
  for (const modifier of oldModifiers.filter((candidate) =>
    before.liveResolution.liveModifiers.includes(candidate)
  )) {
    const index = additions.findIndex(
      (candidate) => modifierKey(candidate) === modifierKey(modifier)
    );
    if (index >= 0) additions.splice(index, 1);
  }
  const passiveModifiers = withoutModifiers(newModifiers, additions);
  // Compare actual scenes, rather than removing and re-adding changed continuous
  // objects in the final scene. Count/condition changes are one effective delta.
  push(
    'UPDATE',
    undefined,
    metricChanges(
      readMetrics(before, oldModifiers, options),
      readMetrics(after, passiveModifiers, options)
    )
  );

  let running: readonly LiveModifierState[] = passiveModifiers;
  // Group adjacent grants by the real ability, so multi-target abilities play together.
  const groups: { modifiers: LiveModifierState[]; key: string }[] = [];
  for (const modifier of additions) {
    const key = JSON.stringify([modifier.sourceCardId, modifier.abilityId]);
    const last = groups.at(-1);
    if (last?.key === key) last.modifiers.push(modifier);
    else groups.push({ key, modifiers: [modifier] });
  }
  const pendingAdditions = [...additions];
  for (const group of groups) {
    for (const modifier of group.modifiers) {
      pendingAdditions.splice(pendingAdditions.indexOf(modifier), 1);
    }
    // Preserve authority order: cost sets and original-stat replacements use
    // the latest modifier, so appending a replaced earlier grant is incorrect.
    const next = withoutModifiers(newModifiers, pendingAdditions);
    const targets = metricChanges(
      readMetrics(after, running, options),
      readMetrics(after, next, options)
    );
    if (targets.length) push('APPLIED', sourceId(group.modifiers[0]?.sourceCardId), targets);
    running = next;
  }

  return foldPassiveTargetsIntoApplied(events);
}

function withoutModifiers(
  modifiers: readonly LiveModifierState[],
  removed: readonly LiveModifierState[]
): LiveModifierState[] {
  const remaining = [...modifiers];
  for (const modifier of removed) remaining.splice(remaining.indexOf(modifier), 1);
  return remaining;
}

/** One transition may both change a condition and explicitly grant a stat.
 * Present positive passive changes with the target's last explicit grant so
 * later feedback cannot replace them. Net passive losses remain UPDATE facts
 * unless that metric also has an explicit loss to preserve as APPLIED.
 */
function foldPassiveTargetsIntoApplied(events: readonly Draft[]): Draft[] {
  const result = [...events];
  const lastApplied = new Map<string, number>();
  result.forEach((event, index) => {
    if (event.mode === 'APPLIED') {
      for (const target of event.targets) lastApplied.set(targetKey(target), index);
    }
  });
  result.forEach((event, index) => {
    if (event.mode !== 'UPDATE') return;
    const remaining: EffectFeedbackTarget[] = [];
    for (const target of event.targets) {
      const appliedIndex = lastApplied.get(targetKey(target));
      if (appliedIndex === undefined) {
        remaining.push(target);
        continue;
      }
      const applied = result[appliedIndex]!;
      result[appliedIndex] = {
        ...applied,
        targets: applied.targets.flatMap((appliedTarget) => {
          if (targetKey(appliedTarget) !== targetKey(target)) return [appliedTarget];
          const explicitLosses = new Set(
            appliedTarget.changes.filter((change) => change.delta < 0).map(changeKey)
          );
          const changes: EffectFeedbackChange[] = [];
          const passiveLosses: EffectFeedbackChange[] = [];
          for (const change of mergeChanges(target.changes, appliedTarget.changes)) {
            if (
              (change.kind === 'HEART' || change.kind === 'BLADE' || change.kind === 'COST') &&
              change.delta < 0 &&
              !explicitLosses.has(changeKey(change))
            ) {
              passiveLosses.push(change);
            } else changes.push(change);
          }
          if (passiveLosses.length) remaining.push({ ...target, changes: passiveLosses });
          return changes.length ? [{ ...appliedTarget, changes }] : [];
        }),
      };
    }
    result[index] = { ...event, targets: remaining };
  });
  return result.filter((event) => event.sourceObjectId || event.targets.length > 0);
}

function targetKey(target: Omit<EffectFeedbackTarget, 'changes'>): string {
  return JSON.stringify([target.zoneKey, target.objectId]);
}

function changeKey(change: EffectFeedbackChange): string {
  return JSON.stringify([change.kind, 'color' in change ? change.color : undefined]);
}

function mergeChanges(
  before: readonly EffectFeedbackChange[],
  after: readonly EffectFeedbackChange[]
): EffectFeedbackChange[] {
  const changes = new Map<string, EffectFeedbackChange>();
  for (const change of [...before, ...after]) {
    const key = changeKey(change);
    changes.set(key, { ...change, delta: (changes.get(key)?.delta ?? 0) + change.delta });
  }
  return [...changes.values()].filter((change) => change.delta !== 0);
}

function publicModifiers(game: GameState, other: GameState): readonly LiveModifierState[] {
  // Revealing/concealing a dependency alone must not look like gaining/losing stats.
  const isPublic = (modifier: LiveModifierState) =>
    isLiveModifierVisibleToViewer(game, 'FIRST', modifier) &&
    isLiveModifierVisibleToViewer(game, 'SECOND', modifier) &&
    isLiveModifierVisibleToViewer(other, 'FIRST', modifier) &&
    isLiveModifierVisibleToViewer(other, 'SECOND', modifier);
  // Continuous queries may themselves depend on a persisted cost/stat modifier.
  // Never bake a hidden dependency into an otherwise public continuous result.
  const publicGame = {
    ...game,
    liveResolution: {
      ...game.liveResolution,
      liveModifiers: game.liveResolution.liveModifiers.filter(isPublic),
    },
  };
  return collectLiveModifiers(publicGame).filter(isPublic);
}

function modifierKey(modifier: LiveModifierState): string {
  return JSON.stringify(modifier);
}

function readMetrics(
  game: GameState,
  modifiers: readonly LiveModifierState[],
  options: Options
): Map<string, Metric> {
  const metrics = new Map<string, Metric>();
  const add = (
    target: Metric['target'],
    kind: Metric['kind'],
    value: number,
    color?: HeartColor,
    lifecycleId?: string
  ) => {
    // Follow the same stage object through slot moves, but never compare a new
    // entry/reentry with the printed stats of its previous stage instance.
    const ownerZone = lifecycleId ? target.zoneKey.split('_')[0] : target.zoneKey;
    const key = JSON.stringify([ownerZone, target.objectId, lifecycleId, kind, color]);
    metrics.set(key, { target, kind, value, ...(color ? { color } : {}) });
  };
  const addHearts = (
    target: Metric['target'],
    hearts: readonly HeartIcon[],
    lifecycleId?: string
  ) => {
    for (const color of Object.values(HeartColor)) {
      add(
        target,
        'HEART',
        hearts
          .filter((heart) => heart.color === color)
          .reduce((sum, heart) => sum + heart.count, 0),
        color,
        lifecycleId
      );
    }
  };
  game.players.forEach((player, index) => {
    const seat = getSeatByPlayerIndex(index);
    for (const [slot, id] of Object.entries(player.memberSlots.slots)) {
      if (!id || !options.isPublicCard(game, id)) continue;
      const target = {
        objectId: createPublicObjectId(id),
        zoneKey: `${seat}_MEMBER_${slot}` as ViewZoneKey,
      };
      const lifecycleId = getMemberHeartContributionLifecycleId(game, id);
      add(
        target,
        'COST',
        getMemberEffectiveCost(game, player.id, id, modifiers),
        undefined,
        lifecycleId
      );
      add(
        target,
        'BLADE',
        getMemberEffectiveBladeCount(game, player.id, id, modifiers),
        undefined,
        lifecycleId
      );
      const card = game.cardRegistry.get(id);
      // An invalid printed Heart list is unknown, not zero. Omit its Heart
      // metrics without changing authority data or suppressing other feedback.
      if (card && isMemberCardData(card.data) && Array.isArray(card.data.hearts)) {
        addHearts(
          target,
          getMemberEffectiveHeartIcons(game, player.id, id, modifiers),
          lifecycleId
        );
      }
    }
    const liveTarget = { zoneKey: `${seat}_LIVE_ZONE` as ViewZoneKey };
    add(
      liveTarget,
      'SCORE',
      modifiers.reduce(
        (sum, m) =>
          sum +
          (m.kind === 'SCORE' && m.playerId === player.id && !m.liveCardId ? m.countDelta : 0),
        0
      )
    );
    add(
      liveTarget,
      'BLADE',
      modifiers.reduce(
        (sum, m) =>
          sum +
          (m.kind === 'BLADE' && m.target === 'PLAYER' && m.playerId === player.id
            ? m.countDelta
            : 0),
        0
      )
    );
    addHearts(
      liveTarget,
      modifiers.flatMap((m) =>
        m.kind === 'HEART' && m.target === 'PLAYER' && m.playerId === player.id ? m.hearts : []
      )
    );
    for (const id of player.liveZone.cardIds) {
      const card = game.cardRegistry.get(id);
      if (
        !card ||
        !isLiveCardData(card.data) ||
        !options.isPublicCard(game, id) ||
        player.liveZone.cardStates.get(id)?.face === FaceState.FACE_DOWN
      )
        continue;
      const target = { ...liveTarget, objectId: createPublicObjectId(id) };
      add(
        target,
        'SCORE',
        modifiers.reduce(
          (sum, m) => sum + (m.kind === 'SCORE' && m.liveCardId === id ? m.countDelta : 0),
          0
        )
      );
      const requirements = applyHeartRequirementModifiers(
        card.data.requirements,
        modifiers.flatMap((m) =>
          m.kind === 'REQUIREMENT' && m.liveCardId === id ? m.modifiers : []
        )
      );
      // Normalize implicit generic requirements using the same domain query as judgment.
      const normalized = applyHeartRequirementModifiers(requirements, [
        { color: HeartColor.RAINBOW, countDelta: 0 },
      ]);
      for (const color of Object.values(HeartColor))
        add(target, 'REQUIREMENT', normalized.colorRequirements.get(color) ?? 0, color);
    }
  });
  return metrics;
}

function metricChanges(
  before: Map<string, Metric>,
  after: Map<string, Metric>
): EffectFeedbackTarget[] {
  const targets = new Map<string, { target: Metric['target']; changes: EffectFeedbackChange[] }>();
  for (const [key, metric] of after) {
    const delta = metric.value - (before.get(key)?.value ?? metric.value);
    if (!delta) continue;
    const targetKey = JSON.stringify(metric.target);
    let group = targets.get(targetKey);
    if (!group) {
      group = { target: metric.target, changes: [] };
      targets.set(targetKey, group);
    }
    if (metric.kind === 'HEART' || metric.kind === 'REQUIREMENT') {
      group.changes.push({ kind: metric.kind, color: metric.color!, delta });
    } else group.changes.push({ kind: metric.kind, delta });
  }
  return [...targets.values()].map(({ target, changes }) => ({ ...target, changes }));
}
