import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { motion, useReducedMotion } from 'framer-motion';
import { useShallow } from 'zustand/react/shallow';
import type { EffectFeedbackChange, EffectFeedbackTarget, PlayerViewState } from '@game/online';
import { HeartColor } from '@game/shared/types/enums';
import { useGameStore } from '@/store/gameStore';
import {
  consumeEffectFeedback,
  hasEffectFeedbackGlow,
  EFFECT_FEEDBACK_DURATION_MS,
  type EffectFeedbackCursor,
} from '@/lib/effectFeedback';
import {
  effectFeedbackTargetKey,
  groupEffectFeedbackChanges,
  isEffectFeedbackTargetCurrent,
  replaceFeedbackPresentations,
  type FeedbackPresentation,
} from '@/lib/effectFeedbackPresentation';
import { HEART_ICON_SOURCE_BY_COLOR, MODIFIER_ICON_SOURCE } from '@/lib/modifierIconAssets';
import { EffectResultArt } from './EffectResultArt';
import './effectFeedback.css';

export const FEEDBACK_COLORS: Record<HeartColor, string> = {
  PINK: '#f7a8d1',
  RED: '#ff8e9a',
  YELLOW: '#ffe191',
  GREEN: '#a9e4bf',
  BLUE: '#a4d7ff',
  PURPLE: '#d2b8ff',
  ORANGE: '#ffc28b',
  GRAY: '#d9d7e6',
  RAINBOW: '#e2d5ff',
};
function colorFor(change: EffectFeedbackChange) {
  return 'color' in change ? FEEDBACK_COLORS[change.color] : '#d7c8ff';
}
function findHost(target: EffectFeedbackTarget): HTMLElement | null {
  const member = target.zoneKey.match(/_MEMBER_(LEFT|CENTER|RIGHT)$/)?.[1];
  const suffix = member
    ? `slot-${member}`
    : target.zoneKey.endsWith('_ENERGY_ZONE')
      ? 'energy-zone'
      : 'live-zone';
  const seat = target.zoneKey.startsWith('FIRST_') ? 'FIRST' : 'SECOND';
  const key = `seat-${seat}::${suffix}`;
  const selector = target.objectId
    ? `[data-object-id="${CSS.escape(target.objectId)}"]`
    : `[data-zone-id="${key}"], [data-animation-zone-id="${key}"]`;
  return (
    Array.from(document.querySelectorAll<HTMLElement>(selector)).find((node) => {
      const rect = node.getBoundingClientRect();
      if (
        node.closest('[data-battle-animation-ignore="true"]') ||
        rect.width <= 0 ||
        rect.height <= 0
      )
        return false;
      // Dragging hides a wrapper; opacity is not inherited by the card itself.
      for (let ancestor: HTMLElement | null = node; ancestor; ancestor = ancestor.parentElement) {
        const style = getComputedStyle(ancestor);
        if (
          style.visibility !== 'visible' ||
          style.display === 'none' ||
          style.contentVisibility === 'hidden' ||
          Number(style.opacity) === 0
        )
          return false;
      }
      return true;
    }) ?? null
  );
}
function sourceTarget(id: string, view: PlayerViewState): EffectFeedbackTarget | null {
  // Only field objects; never follow an old source into an inspection or private hand.
  const entry = Object.entries(view.table.zones).find(
    ([key, zone]) =>
      (key.includes('_MEMBER_') || key.endsWith('_LIVE_ZONE')) &&
      [...(zone.objectIds ?? []), ...Object.values(zone.slotMap ?? {})].includes(id)
  );
  return entry
    ? { objectId: id, zoneKey: entry[0] as EffectFeedbackTarget['zoneKey'], changes: [] }
    : null;
}
type MountedFeedback = FeedbackPresentation & { host: HTMLElement };
function hasGain(item: FeedbackPresentation) {
  return (
    item.event.mode === 'APPLIED' &&
    item.target.changes.some(
      (change) => (change.kind === 'HEART' || change.kind === 'BLADE') && change.delta > 0
    )
  );
}

/** A single active-frame sampler validates identity; card-local portals inherit all transforms. */
export function EffectFeedbackLayer({ enabled = true }: { readonly enabled?: boolean }) {
  const reduced = !!useReducedMotion();
  const { view, log, readOnly } = useGameStore(
    useShallow((s) => ({
      view: s.playerViewState,
      log: s.publicBattleLog,
      readOnly: s.getBattleSurfaceCapabilities().isReadOnly,
    }))
  );
  const cursor = useRef<EffectFeedbackCursor | null>(null);
  const active = useRef<MountedFeedback[]>([]);
  const frame = useRef(0);
  const badges = useRef(new Map<string, HTMLDivElement>());
  const [playing, setPlaying] = useState<MountedFeedback[]>([]);
  const clear = () => {
    cancelAnimationFrame(frame.current);
    frame.current = 0;
    active.current = [];
    setPlaying([]);
  };
  useEffect(() => () => cancelAnimationFrame(frame.current), []);
  useLayoutEffect(() => {
    if (!view || log.matchId !== view.match.matchId) {
      cursor.current = null;
      clear();
      return;
    }
    const result = consumeEffectFeedback(cursor.current, {
      context: `${view.match.matchId}:${view.match.viewerSeat}:${log.presentationEpoch}:${enabled}:${readOnly}:${reduced}`,
      seq: view.match.seq,
      events: log.events.filter((e) => e.matchId === view.match.matchId),
    });
    cursor.current = result.cursor;
    if (result.reset || !enabled || readOnly || view.match.entrance) clear();
    if (!enabled || readOnly || view.match.entrance) return;
    const now = performance.now();
    const additions: MountedFeedback[] = [];
    for (const event of result.events) {
      for (const target of event.targets) {
        if (!isEffectFeedbackTargetCurrent(target, view)) continue;
        const host = findHost(target);
        const changes = groupEffectFeedbackChanges(target.changes);
        if (!host || !changes.length) continue;
        const key = effectFeedbackTargetKey(target);
        additions.push({
          id: `${event.eventId}:${key}`,
          key,
          event,
          target: { ...target, changes },
          source: false,
          host,
          startedAt: now,
          endsAt: now + (reduced ? 240 : EFFECT_FEEDBACK_DURATION_MS),
        });
      }
      const source = event.sourceObjectId && sourceTarget(event.sourceObjectId, view);
      if (
        !source ||
        reduced ||
        !isEffectFeedbackTargetCurrent(source, view) ||
        event.targets.some((t) => t.objectId === source.objectId) ||
        !event.targets.some((t) => hasEffectFeedbackGlow(event.mode, t.changes))
      )
        continue;
      const host = findHost(source);
      if (host)
        additions.push({
          id: `${event.eventId}:source`,
          key: `source:${source.objectId}`,
          event,
          target: source,
          source: true,
          host,
          startedAt: now,
          endsAt: now + 420,
        });
    }
    // Target replacement is synchronous, with no queue or cross-event arithmetic.
    if (additions.length) {
      const retained = replaceFeedbackPresentations(active.current, additions);
      const targetIds = new Set(retained.filter((p) => !p.source).map((p) => p.target.objectId));
      active.current = retained.filter((p) => !p.source || !targetIds.has(p.target.objectId));
      setPlaying(active.current);
    }
    const tick = () => {
      frame.current = 0;
      const latest = useGameStore.getState().playerViewState;
      const next = active.current.filter(
        (p) =>
          latest &&
          performance.now() < p.endsAt &&
          p.host.isConnected &&
          isEffectFeedbackTargetCurrent(p.target, latest) &&
          findHost(p.target) === p.host
      );
      if (next.length !== active.current.length) {
        active.current = next;
        setPlaying(next);
      }
      // Text stays screen-aligned while the light is attached to the rotating card itself.
      for (const p of next) {
        const badge = badges.current.get(p.id);
        if (!badge) continue;
        const rect = p.host.getBoundingClientRect();
        badge.style.setProperty('--feedback-target-width', `${rect.width}px`);
        const halfWidth = badge.offsetWidth / 2 + 8;
        badge.style.left = `${Math.max(halfWidth, Math.min(window.innerWidth - halfWidth, rect.left + rect.width / 2))}px`;
        badge.style.top = `${Math.max(8, Math.min(window.innerHeight - badge.offsetHeight - 8, rect.top + rect.height * (hasGain(p) ? 0.3 : 0.68)))}px`;
      }
      if (next.length) frame.current = requestAnimationFrame(tick);
    };
    cancelAnimationFrame(frame.current);
    tick();
  }, [view, log, enabled, readOnly, reduced]);
  return (
    <div
      aria-hidden="true"
      data-effect-feedback-layer
      className="pointer-events-none fixed inset-0 z-[48] overflow-hidden"
    >
      {playing.map((item) => (
        <div key={item.id} data-effect-feedback={item.event.mode} data-effect-feedback-space="card">
          {!reduced &&
            createPortal(<EffectResultArt item={item} colorFor={colorFor} />, item.host, item.id)}
          {!item.source && (
            <div
              ref={(node) => {
                if (node) badges.current.set(item.id, node);
                else badges.current.delete(item.id);
              }}
              className="effect-result-label-anchor"
            >
              <motion.div
                className={
                  'effect-result-label' + (hasGain(item) ? ' effect-result-label--gain' : '')
                }
                data-effect-feedback-badge
                initial={{ opacity: 0, scale: reduced ? 1 : 0.9 }}
                animate={{
                  opacity: [0, 1, 1, 0],
                  scale: reduced ? 1 : hasGain(item) ? [0.72, 1.08, 1, 0.95] : [0.9, 1, 1, 1],
                  y: !reduced && hasGain(item) ? [9, 0, -2, -10] : 0,
                }}
                transition={{
                  duration: reduced ? 0.22 : hasGain(item) ? 0.95 : 1.2,
                  delay: !reduced && hasGain(item) ? 0.25 : 0,
                  times: [0, hasGain(item) ? 0.23 : 0.2, hasGain(item) ? 0.7 : 0.88, 1],
                }}
              >
                {item.target.changes.map((change, i) => (
                  <Change key={i} change={change} />
                ))}
              </motion.div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
function Change({ change }: { change: EffectFeedbackChange }) {
  const icon =
    change.kind === 'HEART' ? HEART_ICON_SOURCE_BY_COLOR[change.color] : MODIFIER_ICON_SOURCE.blade;
  return (
    <span
      className="effect-result-value"
      style={{ '--feedback-color': colorFor(change) } as CSSProperties}
    >
      {icon && <img src={icon} alt="" />}
      <b>
        {change.delta > 0 ? '+' : '−'}
        {Math.abs(change.delta)}
      </b>
    </span>
  );
}
