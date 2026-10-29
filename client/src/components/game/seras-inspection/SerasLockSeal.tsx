import { useContext, useLayoutEffect, useRef, useState } from 'react';
import { MotionConfigContext, useReducedMotion } from 'framer-motion';
import type { ViewCardObject } from '@game/online/types';
import { SerasChainSealArt } from './SerasChainSealArt';
import './seras-lock-seal.css';

export const SERAS_LOCK_DESCRIPTION =
  '起动封锁：赛拉丝与同侧活跃状态的桂城泉在场，双方费用不超过4的舞台成员不能起动能力';

type SealPhase = 'hidden' | 'waiting-card' | 'forming' | 'sealed' | 'releasing';

/** State-only feedback: no command, acknowledgement or animation timer controls the rule. */
export function SerasLockSeal({
  objectId,
  prohibition,
  viewIdentity,
  enabled,
  animateOnMount = false,
  coveredByMovement = false,
}: {
  objectId: string | null;
  prohibition: ViewCardObject['activatedAbilityProhibition'];
  viewIdentity: string;
  enabled: boolean;
  /** Only a newly arrived card in an already rendered view; never a loaded snapshot. */
  animateOnMount?: boolean;
  /** The normal flying-card layer temporarily owns this card's visible surface. */
  coveredByMovement?: boolean;
}) {
  const prefersReduced = useReducedMotion();
  const motionConfig = useContext(MotionConfigContext);
  const reduced =
    motionConfig.reducedMotion === 'always' ||
    (motionConfig.reducedMotion !== 'never' && !!prefersReduced);
  const blocked = prohibition === 'SERAS_LOW_COST';
  const [phase, setPhase] = useState<SealPhase>(
    enabled && blocked
      ? animateOnMount && !reduced
        ? coveredByMovement
          ? 'waiting-card'
          : 'forming'
        : 'sealed'
      : 'hidden'
  );
  const previous = useRef({ viewIdentity, objectId, blocked, enabled });
  useLayoutEffect(() => {
    const before = previous.current;
    const sameView = before.viewIdentity === viewIdentity;
    const sameCard = sameView && before.objectId === objectId;
    if (!enabled || !objectId) setPhase('hidden');
    else if (blocked) {
      setPhase((current) => {
        // Loading/reconnecting, changing perspective and re-enabling cosmetics join at rest.
        if (reduced || !sameView || !before.enabled) return 'sealed';
        const newlyBlocked = !before.blocked || !sameCard;
        if (newlyBlocked || current === 'waiting-card')
          return coveredByMovement ? 'waiting-card' : 'forming';
        // Do not spend the binding animation behind the normal stage-entry flight.
        if (coveredByMovement && current === 'forming') return 'waiting-card';
        return current;
      });
    } else {
      setPhase((current) =>
        current !== 'waiting-card' && before.blocked && before.enabled && sameCard && !reduced
          ? 'releasing'
          : 'hidden'
      );
    }
    previous.current = { viewIdentity, objectId, blocked, enabled };
  }, [viewIdentity, objectId, blocked, enabled, reduced, coveredByMovement]);

  if (!enabled || !objectId || phase === 'hidden' || phase === 'waiting-card') return null;
  return (
    <span
      className="seras-lock-seal"
      data-seras-lock={blocked ? objectId : undefined}
      data-seras-lock-release={!blocked ? objectId : undefined}
      data-phase={phase}
      data-reduced-motion={reduced || undefined}
      role={blocked ? 'img' : undefined}
      aria-label={blocked ? SERAS_LOCK_DESCRIPTION : undefined}
      aria-hidden={!blocked || undefined}
    >
      <span
        className={'seras-seal-badge' + (phase === 'forming' ? ' seras-seal-formation' : '')}
        aria-hidden="true"
        onAnimationEnd={(event) => {
          if (event.target !== event.currentTarget) return;
          if (phase === 'forming' && event.animationName === 'seras-seal-form') setPhase('sealed');
          if (phase === 'releasing' && event.animationName === 'seras-seal-release')
            setPhase('hidden');
        }}
      >
        <SerasChainSealArt />
      </span>
    </span>
  );
}
