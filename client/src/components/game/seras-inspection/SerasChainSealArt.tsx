import { useId, type CSSProperties } from 'react';

const clasp = { x: 96, y: 55 };
const links = Array.from({ length: 9 }, (_, index) => {
  const distance = (index - 4) * 21.5;
  return { index, distance, side: distance < 0 ? -1 : 1 };
});

/** Alternating open/edge-on links, tube highlights and a raised rose clasp. */
export function SerasChainSealArt() {
  const id = useId().replaceAll(':', '');
  return (
    <svg viewBox="0 0 180 110" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id={`${id}-silver`} x1="0" y1="0" x2=".25" y2="1">
          <stop stopColor="#d3cbd4" />
          <stop offset=".25" stopColor="#9b939f" />
          <stop offset=".55" stopColor="#5e5969" />
          <stop offset=".85" stopColor="#a39aaa" />
          <stop offset="1" stopColor="#4c4858" />
        </linearGradient>
        <linearGradient id={`${id}-gold`} x1="0" y1="0" x2=".8" y2="1">
          <stop stopColor="#d7bd8f" />
          <stop offset=".45" stopColor="#8c7152" />
          <stop offset=".7" stopColor="#b89b6e" />
          <stop offset="1" stopColor="#594334" />
        </linearGradient>
        <radialGradient id={`${id}-rose`} cx=".3" cy=".2" r=".85">
          <stop stopColor="#a7596e" />
          <stop offset=".45" stopColor="#73364c" />
          <stop offset="1" stopColor="#351a30" />
        </radialGradient>
      </defs>
      {[-1, 1].map((direction) => (
        <g key={direction} className="seras-chain-strand">
          {links.map(({ index, distance, side }) => {
            const edgeOn = index % 2 !== 0;
            const slack = Math.sin((index / 8) * Math.PI) * direction * 13;
            // Keep the edge rings fixed; only inner rings slide along the final strand axis.
            const travelWeight = 1 - Math.abs(index - 4) / 4;
            // Off-centre crossing and different slopes keep the four edge entry points staggered.
            const slope = direction === -1 ? -0.43 : 0.22;
            const x = 90 + distance;
            const y = clasp.y + (x - clasp.x) * slope;
            const angle = (Math.atan(slope) * 180) / Math.PI;
            return (
              <g key={index} transform={`translate(${x} ${y}) rotate(${angle})`}>
                <g
                  className="seras-chain-link"
                  style={
                    {
                      '--link-entry-x': `${side * 26 * travelWeight}px`,
                      '--link-tighten-angle': `${direction * side * 12 * travelWeight}deg`,
                      '--link-slack-y': `${slack}px`,
                      '--link-slack-angle': `${direction * side * 12}deg`,
                      '--link-release-x': `${side * 18}px`,
                      '--link-delay': `${Math.abs(index - 4) * 12}ms`,
                    } as CSSProperties
                  }
                >
                  <rect
                    x="-12"
                    y={edgeOn ? -2.1 : -5.6}
                    width="24"
                    height={edgeOn ? 4.2 : 11.2}
                    rx={edgeOn ? 2.1 : 5.6}
                    stroke="#181521"
                    strokeWidth="5.3"
                  />
                  <rect
                    x="-12"
                    y={edgeOn ? -2.1 : -5.6}
                    width="24"
                    height={edgeOn ? 4.2 : 11.2}
                    rx={edgeOn ? 2.1 : 5.6}
                    stroke={`url(#${id}-silver)`}
                    strokeWidth="3.3"
                  />
                  <path
                    d={edgeOn ? 'M-9 -2H7Q10 -2 11 0' : 'M-11 0Q-11 -5 -6 -5H6Q10 -5 11 -2'}
                    stroke="#ece1e4"
                    strokeWidth=".8"
                    opacity=".7"
                    strokeLinecap="round"
                  />
                  {/* The next open link passes under this near-facing end of the ring. */}
                  {edgeOn && (
                    <path
                      d="M8 -2Q12 -2 12 0Q12 2 8 2"
                      stroke="#c5b7c8"
                      strokeWidth="2"
                      strokeLinecap="round"
                    />
                  )}
                </g>
              </g>
            );
          })}
        </g>
      ))}
      <g transform={`translate(${clasp.x} ${clasp.y})`}>
        <g className="seras-chain-clasp">
          <g stroke={`url(#${id}-gold)`} strokeWidth="3" strokeLinecap="round">
            <path
              className="seras-chain-jaw seras-chain-jaw--left"
              d="M-6 -9L-17 -9Q-23 -9 -23 -3V5Q-23 11 -17 11H-8"
            />
            <path
              className="seras-chain-jaw seras-chain-jaw--right"
              d="M6 9L17 9Q23 9 23 3V-5Q23 -11 17 -11H8"
            />
          </g>
          <g className="seras-chain-rose">
            <path
              d="M-8 -13Q-16 -20 -21 -17Q-20 -9 -12 -7M9 10Q16 18 23 14Q21 7 14 6"
              fill="#504336"
              stroke="#b59b72"
              strokeWidth="1.2"
            />
            <circle r="18" fill="#201622" stroke={`url(#${id}-gold)`} strokeWidth="2" />
            <path
              d="M-15 2C-23 -9 -12 -19 -5 -17C4 -23 16 -16 16 -9C26 -3 20 9 12 12C6 24 -8 21 -13 12C-22 11 -23 3 -15 2Z"
              fill={`url(#${id}-rose)`}
              stroke="#b57887"
              strokeWidth="1.1"
            />
            <path
              d="M-5 -17C-13 -11 -11 -3 -4 1C-11 4 -14 7 -13 12M16 -9C6 -14 -3 -9 -4 1C2 -2 10 -1 12 12M-13 12C-5 15 4 13 6 7"
              stroke="#d18a97"
              strokeWidth="1.1"
              opacity=".8"
              strokeLinecap="round"
            />
            <path
              d="M-9 -4Q-6 -12 3 -10Q13 -8 10 1Q8 11 -2 9Q-10 6 -9 -4Z"
              fill="#673047"
              stroke="#b57788"
              strokeWidth=".9"
            />
            <path
              d="M-7 -3Q2 -7 7 -1Q9 4 2 7M3 -10Q-4 -5 -1 2Q3 5 7 -1M-1 2Q-7 3 -7 -3"
              stroke="#c88a99"
              strokeWidth="1"
              strokeLinecap="round"
            />
            <path d="M-1 -3Q3 -5 4 -1L1 2L-2 0Z" fill="#39172c" stroke="#a76a7e" strokeWidth=".7" />
          </g>
        </g>
      </g>
    </svg>
  );
}
