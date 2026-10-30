import { useContext, useLayoutEffect, useRef, useState } from 'react';
import {
  MotionConfigContext,
  motion,
  useAnimationFrame,
  useMotionValue,
  useReducedMotion,
} from 'framer-motion';
import { useGameStore } from '@/store/gameStore';
import { useBattleEffectsEnabled } from '@/lib/battleEffects';
import { canPresentCardEntrance } from '@/lib/cardEntrancePolicy';
import {
  collectBattleAnimationAnchors,
  type BattleAnimationRect,
} from '@/lib/battleAnimationEvents';
import { aiHeartLinks, AI_SHARE_MS, type AiHeartLink } from '@/lib/aiEffects';
import { MODIFIER_ICON_SOURCE } from '@/lib/modifierIconAssets';
import { AiWingedHeart } from './AiWingedHeart';
import './ai-effects.css';

const center = (r: BattleAnimationRect) => ({
  x: r.left + r.width / 2,
  y: r.top + r.height * 0.35,
});
type Pending = AiHeartLink & { at: number };
/** Public projection diff only. No command, rule timer, acknowledgement or modal. */
export function AiEffectsLayer() {
  const view = useGameStore((s) => s.playerViewState);
  const epoch = useGameStore((s) => s.publicBattleLog.presentationEpoch);
  const eligible = useGameStore((s) => canPresentCardEntrance(s.getBattleSurfaceCapabilities()));
  const enabled = useBattleEffectsEnabled() && eligible;
  const osReduced = useReducedMotion();
  const config = useContext(MotionConfigContext);
  const reduced =
    config.reducedMotion === 'always' || (config.reducedMotion !== 'never' && !!osReduced);
  const previous = useRef({ view, enabled, epoch });
  const pending = useRef<Pending[]>([]);
  const [flights, setFlights] = useState<AiHeartLink[]>([]);
  useLayoutEffect(() => {
    const before = previous.current;
    previous.current = { view, enabled, epoch };
    if (
      !view ||
      !before.view ||
      !enabled ||
      !before.enabled ||
      epoch !== before.epoch ||
      before.view.match.matchId !== view.match.matchId ||
      before.view.match.viewerSeat !== view.match.viewerSeat ||
      view.match.seq < before.view.match.seq
    ) {
      pending.current = [];
      setFlights([]);
      return;
    }
    const links = aiHeartLinks(view),
      keys = new Set(links.map((l) => l.key));
    const old = new Set(aiHeartLinks(before.view).map((l) => l.key));
    pending.current = [
      ...pending.current.filter((l) => keys.has(l.key)),
      ...links.filter((l) => !old.has(l.key)).map((l) => ({ ...l, at: performance.now() + 460 })),
    ];
    setFlights((current) => current.filter((l) => keys.has(l.key)));
  }, [view, enabled, epoch]);
  useAnimationFrame(() => {
    if (!pending.current.length) return;
    const now = performance.now();
    const covered = new Set(
      useGameStore.getState().ui.battleAnimationOcclusions.map((o) => o.objectId)
    );
    const ready = pending.current.filter(
      (l) => now >= l.at && !covered.has(l.sourceId) && !covered.has(l.targetId)
    );
    pending.current = pending.current.filter((l) => !ready.includes(l) && now - l.at < 2000);
    if (ready.length) setFlights((current) => [...current, ...ready]);
  });
  if (!enabled) return null;
  return (
    <div className="ai-effects-layer" aria-hidden="true">
      {flights.map((link) => (
        <ShareFlight
          key={link.key}
          link={link}
          reduced={reduced}
          done={() => setFlights((current) => current.filter((l) => l.key !== link.key))}
        />
      ))}
    </div>
  );
}
function ShareFlight({
  link,
  reduced,
  done,
}: {
  link: AiHeartLink;
  reduced: boolean;
  done: () => void;
}) {
  const x = useMotionValue(0),
    y = useMotionValue(0),
    scale = useMotionValue(0),
    angle = useMotionValue(0),
    opacity = useMotionValue(0);
  const rx = useMotionValue(0),
    ry = useMotionValue(0),
    ro = useMotionValue(0);
  const [folded, setFolded] = useState(false);
  const finish = useRef(done);
  finish.current = done;
  const complete = useRef(false);
  useAnimationFrame((elapsed) => {
    if (complete.current) return;
    const anchors = collectBattleAnimationAnchors(),
      a = anchors.cards.get(link.sourceId),
      b = anchors.cards.get(link.targetId);
    if (!a || !b || elapsed >= AI_SHARE_MS) {
      complete.current = true;
      finish.current();
      return;
    }
    const p = elapsed / AI_SHARE_MS;
    const from = center(a),
      to = center(b);
    const t = Math.min(1, Math.max(0, (p - 0.12) / 0.64)),
      ease = t * t * (3 - 2 * t);
    const arch =
      Math.sin(Math.PI * t) * Math.min(85, Math.hypot(to.x - from.x, to.y - from.y) * 0.2 + 25);
    x.set(from.x + (to.x - from.x) * ease - 48);
    y.set(from.y + (to.y - from.y) * ease - arch - 32);
    scale.set(
      (0.75 + 0.25 * Math.sin(Math.PI * t)) *
        (p < 0.12 ? p / 0.12 : 1) *
        (p > 0.78 ? Math.max(0, (0.94 - p) / 0.16) : 1)
    );
    angle.set(Math.sin(Math.PI * t) * (to.x >= from.x ? 12 : -12));
    opacity.set(reduced ? 0 : Math.min(1, p / 0.08));
    rx.set(Math.max(4, Math.min(innerWidth - 70, to.x - 32)));
    ry.set(Math.max(4, to.y - 18));
    ro.set(
      (reduced ? 1 : Math.max(0, Math.min(1, (p - 0.72) / 0.12))) * Math.min(1, (1 - p) / 0.12)
    );
    if (p > 0.76) setFolded(true);
  });
  return (
    <div data-ai-share={link.targetId} data-ai-share-source={link.sourceId}>
      {!reduced && (
        <motion.div
          className="ai-share-flight"
          style={{ left: x, top: y, scale, rotate: angle, opacity }}
        >
          <AiWingedHeart folded={folded} />
        </motion.div>
      )}
      <motion.div className="ai-heart-receipt" style={{ left: rx, top: ry, opacity: ro }}>
        <img src={MODIFIER_ICON_SOURCE.heart_red} alt="" />
        +1
      </motion.div>
    </div>
  );
}
