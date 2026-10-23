import { useId } from 'react';
import { useGameStore } from '@/store/gameStore';
import { useBattleEffectsEnabled } from '@/lib/battleEffects';
import './ShizukuRoleMarker.css';

/** A pale blue satin bookmark links the role-page transfer to the temporary card status. */
export function ShizukuRoleBookmark() {
  const id = useId().replaceAll(':', '');
  return (
    <svg viewBox="0 0 80 72" fill="none" aria-hidden="true" width="100%" height="100%">
      <defs>
        <linearGradient
          id={`${id}-paper`}
          x1="18"
          y1="8"
          x2="58"
          y2="62"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#fffdf6" />
          <stop offset="1" stopColor="#dce9f0" />
        </linearGradient>
        <linearGradient
          id={`${id}-satin`}
          x1="28"
          y1="0"
          x2="53"
          y2="0"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#91b9d0" />
          <stop offset=".36" stopColor="#dbedf4" />
          <stop offset=".6" stopColor="#c4e1ed" />
          <stop offset="1" stopColor="#8fb8ce" />
        </linearGradient>
      </defs>
      <path
        d="M20 12Q20 9 23 9H58Q61 9 61 12V60Q61 63 58 63H23Q20 63 20 60Z"
        fill={`url(#${id}-paper)`}
        stroke="#d3c8ac"
        strokeWidth="1"
      />
      <path d="M25 19H55M25 49H55M25 54H48" stroke="#b4c6cf" strokeWidth="1" opacity=".65" />
      <path
        d="M29 7Q40 10 51 7C49 22 53 40 51 64Q45 61 40 56Q35 61 29 64C32 43 27 24 29 7Z"
        fill={`url(#${id}-satin)`}
        stroke="#9bbfce"
        strokeWidth=".8"
      />
      <path
        d="M32 13C31 27 35 43 32 57M48 13C47 28 51 44 48 57"
        stroke="#f4fbff"
        strokeWidth=".9"
        opacity=".6"
      />
      <path d="M29 7Q40 11 51 7" stroke="#f7efd9" strokeWidth="1.4" strokeLinecap="round" />
      <path
        d="M40 26C35 21 30 28 40 35C50 28 45 21 40 26Z"
        stroke="#f8fcff"
        strokeWidth="1.3"
        fill="#eff8fb"
        fillOpacity=".25"
      />
    </svg>
  );
}

export function ShizukuRoleMarker({ objectId }: { objectId: string }) {
  const enabled = useBattleEffectsEnabled();
  const active = useGameStore(
    (s) => s.playerViewState?.objects[objectId]?.hasTemporaryHeartRole === true
  );
  const receiving = useGameStore((s) => {
    const view = s.playerViewState,
      wait = view?.match.entrance;
    return (
      wait?.shizukuRole?.hostObjectId === objectId &&
      !!view &&
      wait.waitingSeats.includes(view.match.viewerSeat)
    );
  });
  if (!enabled || !active) return null;
  return (
    <span
      className="shizuku-role-marker"
      data-shizuku-role-marker={objectId}
      data-receiving={receiving || undefined}
      role="img"
      aria-label="本次 LIVE 已采用所选成员的原本 HEART"
    >
      <ShizukuRoleBookmark />
    </span>
  );
}
