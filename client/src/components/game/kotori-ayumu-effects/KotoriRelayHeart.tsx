import { useContext, useId } from 'react';
import { MotionConfigContext, useReducedMotion } from 'framer-motion';
import type { ViewCardObject } from '@game/online/types';
import './care-effects.css';

export const KOTORI_RELAY_DESCRIPTION =
  '南小鸟的常时：此待机 μ’s 成员与 μ’s 成员换手时，减免值为此成员的费用加 1（不叠加）';

/** One derived status per member. No event replay, rule timer or count per Kotori source. */
export function KotoriRelayHeart({
  active,
  enabled,
  objectId,
  coveredByMovement = false,
}: {
  active: ViewCardObject['kotoriMuseRelayBonus'];
  enabled: boolean;
  objectId: string | null;
  coveredByMovement?: boolean;
}) {
  const id = useId().replace(/:/g, '');
  const prefersReduced = useReducedMotion();
  const config = useContext(MotionConfigContext);
  const reduced =
    config.reducedMotion === 'always' || (config.reducedMotion !== 'never' && !!prefersReduced);
  if (!active || !enabled || !objectId || coveredByMovement) return null;
  return (
    <span
      className="kotori-relay-heart"
      data-kotori-relay-heart={objectId}
      data-reduced-motion={reduced || undefined}
      role="img"
      aria-label={KOTORI_RELAY_DESCRIPTION}
    >
      <svg viewBox="0 0 48 48" aria-hidden="true">
        <defs>
          <radialGradient id={`${id}halo`}>
            <stop stopColor="#ffbdd4" />
            <stop offset="1" stopColor="#ec7fa5" stopOpacity="0" />
          </radialGradient>
          <linearGradient id={`${id}heart`} x1="0" y1="0" x2=".6" y2="1">
            <stop stopColor="#f9dae0" />
            <stop offset=".5" stopColor="#d798af" />
            <stop offset="1" stopColor="#a8577b" />
          </linearGradient>
        </defs>
        <circle
          className="kotori-relay-heart-halo"
          cx="24"
          cy="24"
          r="24"
          fill={`url(#${id}halo)`}
        />
        <path
          d="M24 39C18 34 7 27 7 18C7 7 20 6 24 15C28 6 41 7 41 18C41 27 30 34 24 39Z"
          fill={`url(#${id}heart)`}
          stroke="#f5dfc9"
          strokeWidth="1.6"
        />
        <path
          d="M12 18C12 12 19 12 20 16"
          fill="none"
          stroke="#fff5eb"
          strokeWidth="2"
          strokeLinecap="round"
          opacity=".85"
        />
      </svg>
    </span>
  );
}
