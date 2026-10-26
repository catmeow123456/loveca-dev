import { useRef } from 'react';
import { motion, useAnimationFrame, useMotionValue } from 'framer-motion';
import {
  getDiscardPresentationBatchLayout,
  type BattleAnimationEvent,
} from '@/lib/battleAnimationEvents';
import { RECOVERY_DURATION_MS } from '@/lib/battleAnimationSequencing';
import { WAITING_ROOM_CARD_CLASS_NAME } from '@/lib/waitingRoomCardPresentation';
import {
  measureRecoveryHandPose,
  measureRecoveryZonePose,
  portraitRecoveryPose,
  sampleRecoveryMotion,
} from '@/lib/recoveryCardMotion';

/** Receives a visibility-filtered image; never looks up private card identities or artwork. */
export function RecoveryCardMotion({
  event,
  imagePath,
  onDone,
}: {
  event: Extract<BattleAnimationEvent, { kind: 'CARD_MOVE' }>;
  imagePath: string;
  onDone: () => void;
}) {
  const from = useRef(
    measureRecoveryZonePose(event.toSeat, 'waiting-room') ?? portraitRecoveryPose(event.fromRect)
  ).current;
  const reveal = useRef(
    getDiscardPresentationBatchLayout({
      count: event.recoveryGroup?.count ?? 1,
      toRect: from,
      toSeat: event.toSeat ?? 'FIRST',
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
    }).cards[event.recoveryGroup?.index ?? 0]
  ).current;
  const left = useMotionValue(from.left),
    top = useMotionValue(from.top);
  const width = useMotionValue(from.width),
    height = useMotionValue(from.height);
  const rotation = useMotionValue(0),
    opacity = useMotionValue(1);
  const finish = useRef(onDone);
  finish.current = onDone;
  const completed = useRef(false);
  const landed = useRef(false);

  useAnimationFrame((elapsed) => {
    if (completed.current) return;
    const target =
      event.render.toSurface === 'FRONT'
        ? measureRecoveryHandPose(event.render.objectId)
        : measureRecoveryZonePose(event.toSeat, 'hand');
    if (!target) {
      completed.current = true;
      opacity.set(0);
      finish.current();
      return;
    }
    const { pose } = sampleRecoveryMotion(from, target, elapsed, reveal);
    left.set(pose.left);
    top.set(pose.top);
    width.set(pose.width);
    height.set(pose.height);
    rotation.set(pose.rotation);
    if (elapsed >= RECOVERY_DURATION_MS) {
      // Commit the exact endpoint for one painted frame before swapping to the real hand.
      // Removing in this same frame would drop the endpoint before it is painted.
      if (landed.current) {
        completed.current = true;
        finish.current();
      }
      landed.current = true;
    }
  });

  return (
    <div data-effect-recovery={event.render.objectId} aria-hidden="true">
      <motion.div
        data-effect-recovery-card
        className={WAITING_ROOM_CARD_CLASS_NAME}
        style={{
          left,
          top,
          width,
          height,
          rotate: rotation,
          opacity,
          transformOrigin: 'center center',
          willChange: 'transform, width, height',
        }}
      >
        <img src={imagePath} alt="" draggable={false} className="h-full w-full object-cover" />
      </motion.div>
    </div>
  );
}
