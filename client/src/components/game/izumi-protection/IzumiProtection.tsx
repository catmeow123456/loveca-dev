import { useContext, useLayoutEffect, useRef, useState } from 'react';
import { MotionConfigContext, useReducedMotion } from 'framer-motion';
import type { ViewCardObject } from '@game/online/types';
import { IzumiWhiteRose } from './IzumiWhiteRose';
import './izumi-protection.css';

export const IZUMI_PROTECTION_DESCRIPTION =
  '己方赛拉丝在场：此桂城泉不会因对方卡牌的效果变为待机状态';

type ProtectionPhase = 'hidden' | 'waiting-card' | 'forming' | 'protected' | 'releasing';

/** State-only feedback: no command, acknowledgement or animation timer controls the rule. */
export function IzumiProtection({
  objectId,
  protection,
  viewIdentity,
  enabled,
  animateOnMount = false,
  coveredByMovement = false,
}: {
  objectId: string | null;
  protection: ViewCardObject['opponentWaitProtection'];
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
  const protectedNow = protection === 'IZUMI_EDELNOTE';
  const [phase, setPhase] = useState<ProtectionPhase>(
    enabled && protectedNow
      ? animateOnMount && !reduced
        ? coveredByMovement
          ? 'waiting-card'
          : 'forming'
        : 'protected'
      : 'hidden'
  );
  const previous = useRef({ viewIdentity, objectId, protectedNow, enabled });
  useLayoutEffect(() => {
    const before = previous.current;
    const sameView = before.viewIdentity === viewIdentity;
    const sameCard = sameView && before.objectId === objectId;
    if (!enabled || !objectId) setPhase('hidden');
    else if (protectedNow) {
      setPhase((current) => {
        // Loading/reconnecting, changing perspective and re-enabling cosmetics join at rest.
        if (reduced || !sameView || !before.enabled) return 'protected';
        const newlyProtected = !before.protectedNow || !sameCard;
        if (newlyProtected || current === 'waiting-card')
          return coveredByMovement ? 'waiting-card' : 'forming';
        // Do not spend the flower opening behind the normal stage-entry flight.
        if (coveredByMovement && current === 'forming') return 'waiting-card';
        return current;
      });
    } else {
      setPhase((current) =>
        current !== 'waiting-card' && before.protectedNow && before.enabled && sameCard && !reduced
          ? 'releasing'
          : 'hidden'
      );
    }
    previous.current = { viewIdentity, objectId, protectedNow, enabled };
  }, [viewIdentity, objectId, protectedNow, enabled, reduced, coveredByMovement]);

  if (!enabled || !objectId || phase === 'hidden' || phase === 'waiting-card') return null;
  return (
    <span
      className="izumi-protection"
      data-izumi-protection={protectedNow ? objectId : undefined}
      data-izumi-protection-release={!protectedNow ? objectId : undefined}
      data-phase={phase}
      data-reduced-motion={reduced || undefined}
      role={protectedNow ? 'img' : undefined}
      aria-label={protectedNow ? IZUMI_PROTECTION_DESCRIPTION : undefined}
      aria-hidden={!protectedNow || undefined}
    >
      <span
        className={
          'izumi-protection-flower' + (phase === 'forming' ? ' izumi-protection-forming' : '')
        }
        aria-hidden="true"
        onAnimationEnd={(event) => {
          if (event.target !== event.currentTarget) return;
          if (phase === 'forming' && event.animationName === 'izumi-protection-form')
            setPhase('protected');
          if (phase === 'releasing' && event.animationName === 'izumi-protection-release')
            setPhase('hidden');
        }}
      >
        <IzumiWhiteRose />
      </span>
    </span>
  );
}
