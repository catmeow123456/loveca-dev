import { motion } from 'framer-motion';
import type { EffectFeedbackChange } from '@game/online';
import type { FeedbackPresentation } from '@/lib/effectFeedbackPresentation';
import { hasEffectFeedbackGlow } from '@/lib/effectFeedback';

/** A single card-local sheen; HEART and BLADE differ only by colour and their result icon. */
function GainSheen({
  color,
  blade,
  lane,
  count,
}: {
  color: string;
  blade: boolean;
  lane: number;
  count: number;
}) {
  const strength = 1 / Math.sqrt(count);
  const delay = 0.1 + Math.min(lane, 5) * 0.035;
  return (
    <div
      data-effect-gain-radiance={blade ? 'blade' : 'heart'}
      style={{ position: 'absolute', inset: 0, overflow: 'hidden', borderRadius: 'inherit' }}
    >
      <motion.div
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: 'inherit',
          boxShadow: `inset 0 0 10px ${color}65`,
          border: `1px solid ${color}85`,
        }}
        initial={{ opacity: 0 }}
        animate={{ opacity: [0, 0.7 * strength, 0.4 * strength, 0] }}
        transition={{ delay, duration: 0.95, times: [0, 0.2, 0.65, 1] }}
      />
      <motion.div
        style={{
          position: 'absolute',
          inset: '-40%',
          mixBlendMode: 'screen',
          background: `linear-gradient(125deg,transparent 39%,${color}18 43%,${color}85 49%,#fff9ed80 50%,${color}30 53%,transparent 59%)`,
        }}
        initial={{ opacity: 0, x: '-85%' }}
        animate={{ opacity: [0, strength, 0.65 * strength, 0], x: ['-85%', '-40%', '35%', '85%'] }}
        transition={{ delay, duration: 0.95, times: [0, 0.2, 0.65, 1], ease: 'easeOut' }}
      />
    </div>
  );
}

/** Every gain retains its own colour/kind; exact deltas remain in the upright overlay. */
export function EffectResultArt({
  item,
  colorFor,
}: {
  item: FeedbackPresentation;
  colorFor: (change: EffectFeedbackChange) => string;
}) {
  if (item.source)
    return (
      <motion.div
        data-effect-source-light
        className="effect-source-light"
        initial={{ opacity: 0 }}
        animate={{ opacity: [0, 0.7, 0] }}
        transition={{ duration: 0.4 }}
      />
    );
  if (!hasEffectFeedbackGlow(item.event.mode, item.target.changes)) return null;
  const gains = item.target.changes.filter(
    (change) => (change.kind === 'HEART' || change.kind === 'BLADE') && change.delta > 0
  );
  const others = item.target.changes.filter((change) => !gains.includes(change));
  return (
    <div
      className={'effect-result-art' + (item.target.objectId ? '' : ' effect-result-art--zone')}
      data-effect-result-art
      aria-hidden="true"
    >
      {gains.map((change, index) => (
        <GainSheen
          key={index}
          color={colorFor(change)}
          blade={change.kind === 'BLADE'}
          lane={index}
          count={gains.length}
        />
      ))}
      {others.length > 0 && (
        <svg className="effect-result-art" viewBox="0 0 100 140" preserveAspectRatio="none">
          {others.map((change, index) => (
            <motion.path
              key={index}
              d="M 30 95 Q 50 103 72 95"
              fill="none"
              stroke={colorFor(change)}
              strokeWidth="1.4"
              strokeLinecap="round"
              initial={{ pathLength: 0, opacity: 0 }}
              animate={{ pathLength: [0, 1, 1], opacity: [0, 0.85, 0] }}
              transition={{ delay: 0.025 + Math.min(index, 4) * 0.035, duration: 0.65 }}
            />
          ))}
        </svg>
      )}
    </div>
  );
}
