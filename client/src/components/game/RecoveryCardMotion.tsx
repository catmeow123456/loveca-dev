import { useId, useRef } from 'react';
import { motion, useAnimationFrame, useMotionValue } from 'framer-motion';
import type { BattleAnimationEvent } from '@/lib/battleAnimationEvents';
import { RECOVERY_DURATION_MS } from '@/lib/battleAnimationSequencing';
import {
  measureRecoveryHandPose,
  measureRecoveryZonePose,
  portraitRecoveryPose,
  recoveryEdgePoint,
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
  const gradientId = useId();
  const from = portraitRecoveryPose(event.fromRect);
  const left = useMotionValue(from.left),
    top = useMotionValue(from.top);
  const width = useMotionValue(from.width),
    height = useMotionValue(from.height);
  const rotation = useMotionValue(0),
    opacity = useMotionValue(0);
  const sourceLeft = useMotionValue(from.left),
    sourceTop = useMotionValue(from.top);
  const sourceWidth = useMotionValue(from.width),
    sourceHeight = useMotionValue(from.height);
  const glow = useMotionValue(0),
    shaftOpacity = useMotionValue(0),
    trailOpacity = useMotionValue(0);
  const shaft = useMotionValue(''),
    trailLeft = useMotionValue(''),
    trailRight = useMotionValue('');
  const finish = useRef(onDone);
  finish.current = onDone;
  const completed = useRef(false);

  useAnimationFrame((elapsed) => {
    if (completed.current) return;
    const source = measureRecoveryZonePose(event.toSeat, 'waiting-room') ?? from;
    const target =
      event.render.toSurface === 'FRONT'
        ? measureRecoveryHandPose(event.render.objectId)
        : measureRecoveryZonePose(event.toSeat, 'hand');
    // A subsequent command, view switch or removed board hands ownership back immediately.
    if (!target) {
      completed.current = true;
      opacity.set(0);
      glow.set(0);
      shaftOpacity.set(0);
      trailOpacity.set(0);
      finish.current();
      return;
    }
    const frame = sampleRecoveryMotion(source, target, elapsed);
    const pose = frame.pose;
    left.set(pose.left);
    top.set(pose.top);
    width.set(pose.width);
    height.set(pose.height);
    rotation.set(pose.rotation);
    opacity.set(frame.opacity);
    sourceLeft.set(source.left - source.width * 0.25);
    sourceTop.set(source.top - source.height * 0.15);
    sourceWidth.set(source.width * 1.5);
    sourceHeight.set(source.height * 1.3);
    glow.set(frame.sourceGlow * (0.65 + frame.popGlow * 0.35));
    const baseY = source.top + source.height * 0.7;
    const tipY = pose.top + pose.height * 0.7;
    shaft.set(
      `M ${source.left + source.width * 0.15} ${baseY} L ${pose.left} ${tipY} L ${pose.left + pose.width} ${tipY} L ${source.left + source.width * 0.85} ${baseY} Z`
    );
    shaftOpacity.set(
      frame.riseProgress > 0 && frame.flightProgress === 0
        ? frame.sourceGlow * (0.12 + frame.popGlow * 0.5)
        : 0
    );
    trailOpacity.set(frame.trailGlow);
    for (const [side, path] of [
      [-1, trailLeft],
      [1, trailRight],
    ] as const) {
      const points = [0, 16, 32, 48, 64].map((lag) =>
        recoveryEdgePoint(
          sampleRecoveryMotion(source, target, Math.max(0, elapsed - lag)).pose,
          side
        )
      );
      path.set(points.map((p, index) => `${index === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' '));
    }
    if (elapsed >= RECOVERY_DURATION_MS) {
      completed.current = true;
      // No exit fade: the real hand replaces the overlay at its exact current pose.
      finish.current();
    }
  });

  return (
    <div data-effect-recovery={event.render.objectId} aria-hidden="true">
      <motion.div
        data-recovery-source-glow
        className="fixed rounded-[30%]"
        style={{
          left: sourceLeft,
          top: sourceTop,
          width: sourceWidth,
          height: sourceHeight,
          opacity: glow,
          background:
            'radial-gradient(ellipse, #d4ffe075 0%, #80edc654 30%, #32a89225 52%, transparent 74%)',
          filter: 'blur(3px)',
          mixBlendMode: 'screen',
        }}
      />
      <svg className="fixed inset-0 h-full w-full overflow-visible" aria-hidden="true">
        <defs>
          <linearGradient id={gradientId} x1="0" y1="1" x2="0" y2="0">
            <stop offset="0" stopColor="#80edc6" stopOpacity=".05" />
            <stop offset=".3" stopColor="#80edc6" stopOpacity=".6" />
            <stop offset="1" stopColor="#d4ffe0" stopOpacity="0" />
          </linearGradient>
        </defs>
        <motion.path
          d={shaft}
          fill={`url(#${gradientId})`}
          style={{ opacity: shaftOpacity, filter: 'blur(3px)' }}
        />
        {[trailLeft, trailRight].map((path, index) => (
          <motion.path
            key={index}
            d={path}
            fill="none"
            stroke="#bfeee1"
            strokeWidth="1.6"
            strokeLinecap="round"
            style={{ opacity: trailOpacity, filter: 'blur(.8px)' }}
          />
        ))}
      </svg>
      <motion.div
        data-effect-recovery-card
        className="fixed overflow-hidden rounded-lg"
        style={{
          left,
          top,
          width,
          height,
          rotate: rotation,
          opacity,
          transformOrigin: 'center',
          willChange: 'transform, opacity',
          boxShadow: '0 8px 20px #11172260',
        }}
      >
        <img src={imagePath} alt="" draggable={false} className="h-full w-full object-cover" />
      </motion.div>
    </div>
  );
}
