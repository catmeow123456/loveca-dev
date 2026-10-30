import { useRef } from 'react';
import { motion, useAnimationFrame, useMotionValue } from 'framer-motion';
import { useGameStore } from '@/store/gameStore';
import { getDeckBackUrl } from '@/lib/imageService';
import {
  collectBattleAnimationAnchors,
  type BattleAnimationEvent,
} from '@/lib/battleAnimationEvents';
import {
  measureRecoveryHandPose,
  measureRecoveryZonePose,
  portraitRecoveryPose,
} from '@/lib/recoveryCardMotion';
import { AI_INVITATION_MS } from '@/lib/aiEffects';
import { WAITING_ROOM_CARD_CLASS_NAME } from '@/lib/waitingRoomCardPresentation';
import { AiWingedHeart } from './AiWingedHeart';
import './ai-effects.css';

export function AiInvitationMotion({
  event,
  onDone,
}: {
  event: Extract<BattleAnimationEvent, { kind: 'CARD_MOVE' }>;
  onDone: () => void;
}) {
  const source = useRef(
    collectBattleAnimationAnchors().cards.get(event.aiInvitation!.sourceObjectId)
  ).current;
  const from = useRef(
    measureRecoveryZonePose(event.toSeat, 'waiting-room') ?? portraitRecoveryPose(event.fromRect)
  ).current;
  // Only the previously revealed public card is used. The destination remains anonymous.
  const image = useGameStore((s) => s.getCardImagePath)(event.aiInvitation!.publicCardCode);
  const left = useMotionValue(from.left),
    top = useMotionValue(from.top),
    width = useMotionValue(from.width),
    height = useMotionValue(from.height),
    rotation = useMotionValue(0),
    tilt = useMotionValue(0);
  const gx = useMotionValue(0),
    gy = useMotionValue(0),
    go = useMotionValue(0),
    gs = useMotionValue(0.8),
    frontOpacity = useMotionValue(1);
  const finish = useRef(onDone);
  finish.current = onDone;
  const ended = useRef(false),
    landed = useRef(false);
  useAnimationFrame((elapsed) => {
    if (ended.current) return;
    const target =
      event.render.toSurface === 'FRONT'
        ? measureRecoveryHandPose(event.render.objectId)
        : measureRecoveryZonePose(event.toSeat, 'hand');
    if (!target) {
      ended.current = true;
      finish.current();
      return;
    }
    const p = Math.min(1, elapsed / AI_INVITATION_MS);
    const invite = Math.min(1, p / 0.28),
      lift = Math.sin(Math.PI * Math.min(1, p / 0.48)) * 12;
    const q = Math.max(0, (p - 0.26) / 0.74),
      t = q * q * (3 - 2 * q),
      arc = Math.sin(Math.PI * q) * 45;
    const w = from.width + (target.width - from.width) * t,
      h = from.height + (target.height - from.height) * t;
    const x = from.left + (target.left - from.left) * t,
      y = from.top + (target.top - from.top) * t - arc - lift * (1 - t);
    left.set(x);
    top.set(y);
    width.set(w);
    height.set(h);
    rotation.set(target.rotation * t - 8 * Math.sin(Math.PI * q));
    tilt.set(-14 * Math.sin(Math.PI * q));
    const startX = source ? source.left + source.width / 2 : from.left + from.width / 2;
    const startY = source ? source.top + source.height * 0.25 : from.top - 35;
    const tipX = p < 0.28 ? startX + (from.left + from.width / 2 - startX) * invite : x + w / 2;
    const tipY =
      p < 0.28
        ? startY + (from.top - 15 - startY) * invite - Math.sin(Math.PI * invite) * 35
        : y - 18;
    gx.set(tipX - 44);
    gy.set(tipY - 30);
    go.set(Math.min(1, p / 0.08, (1 - p) / 0.16));
    gs.set(0.72 + 0.15 * Math.sin(Math.PI * p));
    frontOpacity.set(
      event.render.toSurface === 'BACK' ? Math.max(0, Math.min(1, (0.88 - p) / 0.08)) : 1
    );
    if (p >= 1) {
      if (landed.current) {
        ended.current = true;
        finish.current();
      }
      landed.current = true;
    }
  });
  return (
    <div
      data-ai-invitation={event.render.objectId}
      data-effect-recovery={event.render.objectId}
      aria-hidden="true"
    >
      <motion.div
        data-effect-recovery-card
        className={`${WAITING_ROOM_CARD_CLASS_NAME} ai-invitation-card`}
        style={{
          left,
          top,
          width,
          height,
          rotate: rotation,
          rotateY: tilt,
          transformPerspective: 700,
        }}
      >
        {event.render.toSurface === 'BACK' && (
          <img
            src={getDeckBackUrl()}
            alt=""
            className="absolute inset-0 h-full w-full object-cover"
          />
        )}
        <motion.img
          src={image}
          alt=""
          draggable={false}
          className="absolute inset-0 h-full w-full object-cover"
          style={{ opacity: frontOpacity }}
        />
      </motion.div>
      <motion.div
        className="ai-invitation-guide"
        style={{ left: gx, top: gy, opacity: go, scale: gs }}
      >
        <AiWingedHeart />
      </motion.div>
    </div>
  );
}
