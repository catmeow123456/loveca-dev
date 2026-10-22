import { useGameStore } from '@/store/gameStore';
import { useReducedMotion } from 'framer-motion';
import { useBattleEffectsEnabled } from '@/lib/battleEffects';
import './GinkoKnotMarker.css';
import {
  knotColors,
  knotPaths,
  knotPolyline,
  knotFlowerPetals,
  knotFlowerColors,
} from '@/lib/ginkoKnotShape';

export function GinkoKnotMarker({ objectId }: { objectId: string }) {
  const enabled = useBattleEffectsEnabled();
  const hasGrant = useGameStore(
    (s) => s.playerViewState?.objects[objectId]?.hasTemporaryOnEnterAbility === true
  );
  const receiving = useGameStore((s) => {
    const view = s.playerViewState,
      entrance = view?.match.entrance;
    return (
      entrance?.abilityTransfer?.hostObjectId === objectId &&
      !!view &&
      entrance.waitingSeats.includes(view.match.viewerSeat)
    );
  });
  const reduced = !!useReducedMotion();
  if (!enabled || !hasGrant) return null;
  return (
    <span
      data-ginko-knot-marker={objectId}
      data-receiving={receiving ? 'true' : 'false'}
      role="img"
      aria-label="已获得额外登场能力，LIVE结束时消失"
      style={{
        position: 'absolute',
        right: '4%',
        bottom: '4%',
        width: '30%',
        maxWidth: 34,
        minWidth: 22,
        aspectRatio: '88 / 110',
        zIndex: 25,
        pointerEvents: 'none',
        opacity: receiving ? 0 : 1,
      }}
    >
      <svg
        className="ginko-knot-emblem"
        data-reduced-motion={reduced}
        viewBox="-44 -40 88 110"
        width="100%"
        height="100%"
        fill="none"
        aria-hidden="true"
      >
        {Object.values(knotPaths).map((points, i) => (
          <g key={i} strokeLinecap="round" strokeLinejoin="round">
            <polyline points={knotPolyline(points)} stroke={knotColors.shadow} strokeWidth="6" />
            <polyline points={knotPolyline(points)} stroke={knotColors.body} strokeWidth="4" />
            <polyline
              points={knotPolyline(points)}
              stroke={knotColors.highlight}
              strokeWidth=".6"
              transform="translate(-.35 -.45)"
            />
          </g>
        ))}
        <g
          fill={knotFlowerColors.body}
          stroke={knotFlowerColors.edge}
          strokeWidth=".8"
          strokeLinejoin="round"
        >
          {knotFlowerPetals.map((points, i) => (
            <polygon key={i} points={knotPolyline(points)} />
          ))}
        </g>
        <circle r="1.8" fill={knotFlowerColors.center} />
      </svg>
    </span>
  );
}
