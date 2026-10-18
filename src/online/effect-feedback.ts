import type { GameState, LiveModifierState } from '../domain/entities/game.js';
import { isLiveCardData, type HeartIcon } from '../domain/entities/card.js';
import {
  collectLiveModifiers,
  getMemberEffectiveBladeCount,
  getMemberEffectiveHeartIcons,
} from '../domain/rules/live-modifiers.js';
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
  readonly kind: 'HEART' | 'BLADE' | 'SCORE' | 'REQUIREMENT';
  readonly color?: HeartColor;
  readonly value: number;
};

/**
 * Derives presentation from authority facts, without changing any rule state.
 * Additive modifiers retain their exact source; passive/removal deltas are quiet.
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

  // Keep duplicate modifiers: two identical grants are two real increments.
  const oldModifiers = publicModifiers(before, after);
  const newModifiers = publicModifiers(after, before);
  const remaining = [...newModifiers];
  const retained: LiveModifierState[] = [];
  for (const modifier of oldModifiers) {
    const index = remaining.findIndex(
      (candidate) => modifierKey(candidate) === modifierKey(modifier)
    );
    if (index >= 0) retained.push(...remaining.splice(index, 1));
  }

  // Removal/expiry and continuous-condition changes do not replay an activation.
  if (retained.length !== oldModifiers.length) {
    push(
      'UPDATE',
      undefined,
      metricChanges(
        readMetrics(after, oldModifiers, options),
        readMetrics(after, retained, options)
      )
    );
  }

  let running = retained;
  // Group adjacent grants by the real ability, so multi-target abilities play together.
  const groups: { modifiers: LiveModifierState[]; key: string; applied: boolean }[] = [];
  for (const modifier of remaining) {
    const applied =
      after.liveResolution.liveModifiers.includes(modifier) &&
      !before.liveResolution.liveModifiers.includes(modifier);
    const key = JSON.stringify([modifier.sourceCardId, modifier.abilityId, applied]);
    const last = groups.at(-1);
    if (last?.key === key) last.modifiers.push(modifier);
    else groups.push({ key, modifiers: [modifier], applied });
  }
  for (const group of groups) {
    const next = [...running, ...group.modifiers];
    const targets = metricChanges(
      readMetrics(after, running, options),
      readMetrics(after, next, options)
    );
    if (targets.length)
      push(
        group.applied ? 'APPLIED' : 'UPDATE',
        group.applied ? sourceId(group.modifiers[0]?.sourceCardId) : undefined,
        targets
      );
    running = next;
  }

  return events;
}

function publicModifiers(game: GameState, other: GameState): readonly LiveModifierState[] {
  // Revealing/concealing a dependency alone must not look like gaining/losing stats.
  return collectLiveModifiers(game).filter(
    (modifier) =>
      isLiveModifierVisibleToViewer(game, 'FIRST', modifier) &&
      isLiveModifierVisibleToViewer(game, 'SECOND', modifier) &&
      isLiveModifierVisibleToViewer(other, 'FIRST', modifier) &&
      isLiveModifierVisibleToViewer(other, 'SECOND', modifier)
  );
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
    color?: HeartColor
  ) => {
    const key = JSON.stringify([target.zoneKey, target.objectId, kind, color]);
    metrics.set(key, { target, kind, value, ...(color ? { color } : {}) });
  };
  const addHearts = (target: Metric['target'], hearts: readonly HeartIcon[]) => {
    for (const color of Object.values(HeartColor)) {
      add(
        target,
        'HEART',
        hearts
          .filter((heart) => heart.color === color)
          .reduce((sum, heart) => sum + heart.count, 0),
        color
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
      add(target, 'BLADE', getMemberEffectiveBladeCount(game, player.id, id, modifiers));
      addHearts(target, getMemberEffectiveHeartIcons(game, player.id, id, modifiers));
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
