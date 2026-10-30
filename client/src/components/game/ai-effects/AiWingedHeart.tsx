import { useId } from 'react';

/** A sculpted heart and articulated bat membranes; the settled rules icon is separate. */
export function AiWingedHeart({ folded = false }: { folded?: boolean }) {
  const id = useId().replace(/:/g, '');
  return (
    <svg
      viewBox="0 0 160 106"
      className="ai-winged-heart"
      data-folded={folded || undefined}
      aria-hidden="true"
    >
      <defs>
        <radialGradient id={`${id}-heart`} cx=".32" cy=".22" r=".86">
          <stop stopColor="#ffb6bf" />
          <stop offset=".22" stopColor="#f44b6f" />
          <stop offset=".6" stopColor="#bf193f" />
          <stop offset="1" stopColor="#610f30" />
        </radialGradient>
        <linearGradient id={`${id}-wing`} x2=".3" y2="1">
          <stop stopColor="#65304c" />
          <stop offset=".52" stopColor="#29182f" />
          <stop offset="1" stopColor="#10101e" />
        </linearGradient>
      </defs>
      {[false, true].map((right) => (
        <g key={String(right)} transform={right ? 'translate(160 0) scale(-1 1)' : undefined}>
          <g className="ai-heart-wing">
            <path
              d="M62 51 Q40 25 7 21 Q19 37 6 57 Q25 49 29 70 Q42 56 57 69 L70 64Z"
              fill={`url(#${id}-wing)`}
              stroke="#c9879b"
              strokeWidth="1.5"
            />
            <path
              d="M61 57 Q38 32 7 21 M59 60 Q31 45 29 70 M57 62 Q24 47 6 57"
              fill="none"
              stroke="#986177"
              strokeWidth="1"
            />
            <path
              d="M11 25 Q39 32 59 52"
              fill="none"
              stroke="#efb9c6"
              strokeWidth=".8"
              opacity=".6"
            />
          </g>
        </g>
      ))}
      <path
        d="M80 88 C68 77 45 61 46 43 C47 23 70 22 80 39 C90 22 113 23 114 43 C115 61 92 77 80 88Z"
        fill={`url(#${id}-heart)`}
        stroke="#ffd1da"
        strokeWidth="1.3"
      />
      <path
        d="M55 44 C54 31 66 29 73 38"
        fill="none"
        stroke="#ffe1e7"
        strokeWidth="3"
        strokeLinecap="round"
        opacity=".7"
      />
      <path d="M82 80 Q106 59 108 48" fill="none" stroke="#770d32" strokeWidth="2" opacity=".65" />
      <path
        d="M72 37 L68 26 L78 31 M88 37 L92 26 L82 31"
        fill="#572139"
        stroke="#f6aabd"
        strokeWidth=".9"
      />
    </svg>
  );
}
