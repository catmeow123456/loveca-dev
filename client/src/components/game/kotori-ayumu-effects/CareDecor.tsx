import { useId, type CSSProperties } from 'react';
import type { CareMovementKind } from '@/lib/careMovementPresentation';
import './care-effects.css';

/** Always attached to the moving card, so ornaments share its geometry and clock. */
export function CareCardTrim({
  kind,
  discardDuration = 1180,
  timeScale = 1,
  holdAt,
}: {
  kind: CareMovementKind | 'KOTORI_DISCARD';
  discardDuration?: number;
  timeScale?: number;
  holdAt?: number;
}) {
  const id = useId().replace(/:/g, '');
  const kotori = kind.startsWith('KOTORI');
  return (
    <svg
      className="care-card-trim"
      viewBox="0 0 100 140"
      aria-hidden="true"
      data-care-trim={kind}
      data-held={holdAt !== undefined || undefined}
      style={
        {
          '--kotori-flight-duration': `${discardDuration / timeScale}ms`,
          '--kotori-flight-delay': `${-(holdAt ?? 0) / timeScale}ms`,
        } as CSSProperties
      }
    >
      <defs>
        <pattern id={`${id}gauze`} width="3" height="3" patternUnits="userSpaceOnUse">
          <path d="M0 0H3M0 0V3" stroke="#927a79" strokeWidth=".3" opacity=".35" />
        </pattern>
        <linearGradient id={`${id}feather`} x2=".3" y2="1">
          <stop stopColor="#fffbed" />
          <stop offset=".6" stopColor="#f0d5d1" />
          <stop offset="1" stopColor="#bd8d9a" />
        </linearGradient>
        <linearGradient id={`${id}foil`} x2="1" y2=".2">
          <stop stopColor="#b085b0" stopOpacity=".5" />
          <stop offset=".35" stopColor="#fff1d6" stopOpacity=".9" />
          <stop offset=".7" stopColor="#d9b5d5" stopOpacity=".7" />
          <stop offset="1" stopColor="#fff4dc" stopOpacity=".85" />
        </linearGradient>
        <radialGradient id={`${id}gold`} cx=".3" cy=".25">
          <stop stopColor="#fff8d2" />
          <stop offset=".4" stopColor="#efd085" />
          <stop offset=".75" stopColor="#a67c40" />
          <stop offset="1" stopColor="#f4dc9b" />
        </radialGradient>
      </defs>
      {kotori ? (
        <>
          <rect
            x="-2"
            y="-2"
            width="104"
            height="144"
            rx="7"
            fill="none"
            stroke="#f4d4d6"
            strokeWidth="1.5"
          />
          <path
            d="M3 18V5H18 M82 5H97V18 M97 122V135H82 M18 135H3V122"
            fill="none"
            stroke="#ead5b5"
            strokeWidth="1.2"
            strokeDasharray="2 2"
          />
          {kind === 'KOTORI_KEEP' &&
            [-1, 1].map((side) => (
              <g key={side} transform={`translate(${side < 0 ? 0 : 100} 65) scale(${side} 1)`}>
                <g className="care-feather-wing">
                  {[0, 1, 2, 3, 4].map((n) => (
                    <path
                      key={n}
                      transform={`rotate(${-n * 13})`}
                      d={`M0 0 Q14 -17 ${38 + n * 2} -18 Q30 -2 0 0`}
                      fill={`url(#${id}feather)`}
                      stroke="#c6a58b"
                      strokeWidth=".45"
                    />
                  ))}
                </g>
              </g>
            ))}
          {kind === 'KOTORI_DISCARD' &&
            [-1, 1].map((side) => (
              <g key={side} transform={`translate(${side < 0 ? 0 : 100} 64) scale(${side} 1)`}>
                <g className="kotori-gauze-wing">
                  <path
                    d="M-2-5C17-20 30-29 48-26C38-16 40 0 25 7C18 11 8 7-2 4Z"
                    fill={`url(#${id}feather)`}
                    stroke="#e5caba"
                    strokeWidth=".7"
                  />
                  <path
                    d="M-2-5C17-20 30-29 48-26C38-16 40 0 25 7C18 11 8 7-2 4Z"
                    fill={`url(#${id}gauze)`}
                  />
                  <path
                    d="M1-2C18-12 29-22 41-23M2 3C21 9 29-3 35-10"
                    fill="none"
                    stroke="#a27f84"
                    strokeWidth=".7"
                    strokeDasharray="1.5 2"
                  />
                  <g className="kotori-gauze-tail">
                    <path
                      d="M-1 2C13 10 22 14 34 9C40 6 45 9 48 13C32 14 36 31 20 29C9 27 8 13-1 8Z"
                      fill="#eee1cf"
                      stroke="#cbb3a9"
                      strokeWidth=".7"
                    />
                    <path
                      d="M0 6C14 19 24 26 37 16"
                      fill="none"
                      stroke="#b49795"
                      strokeWidth=".6"
                      strokeDasharray="2 2"
                    />
                  </g>
                  <path
                    d="M-2-7Q8-9 10 0L2 9Q-6 7-2-7Z"
                    fill="#a85d76"
                    stroke="#f2c9c4"
                    strokeWidth=".7"
                  />
                </g>
              </g>
            ))}
        </>
      ) : (
        <>
          {kind !== 'AYUMU_DRAW' &&
            [-1, 1].map((side) => (
              <g key={side} transform={`translate(${side < 0 ? -2 : 102} 71) scale(${side} 1)`}>
                <g className="care-candy-wrap">
                  <path
                    d="M0-10L25-31Q18-3 29 25L0 10Z"
                    fill={`url(#${id}foil)`}
                    stroke="#f9e1c5"
                    strokeWidth=".6"
                  />
                  <path
                    d="M0 0L21-22M0 1L20-4M1 2L24 17"
                    stroke="#fff7df"
                    strokeWidth=".65"
                    opacity=".8"
                  />
                </g>
              </g>
            ))}
          <rect
            x="-2"
            y="-2"
            width="104"
            height="144"
            rx="7"
            fill="none"
            stroke="#e8c49c"
            strokeWidth="1"
          />
          <g transform="translate(50 -5)">
            <g className="care-bell">
              <path
                d="M0 0C-12-17-31-13-24 1C-19 10-6 5 0 0C12-17 31-13 24 1C19 10 6 5 0 0Z"
                fill="#6f466f"
                stroke="#bc91a4"
                strokeWidth=".7"
              />
              <path d="M-3 2L-16 20L-7 16L-4 23L3 2L16 20L7 16L4 23Z" fill="#48304f" />
              <circle cy="12" r="9" fill={`url(#${id}gold)`} stroke="#f8dfac" strokeWidth=".6" />
              <circle cy="14" r="1.8" fill="#705033" />
              <path d="M-7 15Q0 20 7 15" fill="none" stroke="#705033" />
            </g>
          </g>
        </>
      )}
    </svg>
  );
}
