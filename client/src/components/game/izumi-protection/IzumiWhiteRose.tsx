import { useId, type CSSProperties } from 'react';

/** Layered white rose and silver leaves; code-drawn, with no external texture to load. */
export function IzumiWhiteRose() {
  const id = useId().replace(/:/g, '');
  return (
    <svg viewBox="0 0 88 100" fill="none" aria-hidden="true">
      <defs>
        <radialGradient id={`${id}-halo`}>
          <stop stopColor="#f0edff" stopOpacity=".65" />
          <stop offset=".55" stopColor="#d7d6ff" stopOpacity=".22" />
          <stop offset="1" stopColor="#d7d6ff" stopOpacity="0" />
        </radialGradient>
        <linearGradient
          id={`${id}-petal`}
          x1="30"
          y1="16"
          x2="50"
          y2="50"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#fffefa" />
          <stop offset=".5" stopColor="#f1f1fc" />
          <stop offset="1" stopColor="#a3a4ca" />
        </linearGradient>
        <linearGradient
          id={`${id}-leaf`}
          x1="20"
          y1="65"
          x2="51"
          y2="85"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#dae2ef" />
          <stop offset="1" stopColor="#6e7d9d" />
        </linearGradient>
      </defs>
      <ellipse
        className="izumi-protection-halo"
        cx="44"
        cy="44"
        rx="44"
        ry="44"
        fill={`url(#${id}-halo)`}
      />
      <g className="izumi-rose-leaves" fill={`url(#${id}-leaf)`} stroke="#ccd4e6" strokeWidth=".8">
        <path d="M44 76C24 78 12 65 12 54C30 51 40 63 44 76Z" />
        <path d="M45 80C62 76 75 63 73 53C54 56 45 68 45 80Z" />
        <path d="M23 62Q39 72 44 84Q48 75 65 63" stroke="#f4f4ff" fill="none" />
      </g>
      <g stroke="#b6b8d1" strokeWidth=".9" strokeLinejoin="round" fill={`url(#${id}-petal)`}>
        {[0, 72, 144, 216, 288].map((angle, index) => (
          <g key={angle} transform={`rotate(${angle} 44 43)`}>
            <path
              className="izumi-rose-petal"
              style={{ '--petal-delay': `${index * 28}ms` } as CSSProperties}
              d="M44 51C34 47 20 36 25 24C28 15 39 12 45 18C54 12 65 20 63 30C62 41 51 49 44 51Z"
            />
          </g>
        ))}
        {[36, 126, 216, 306].map((angle, index) => (
          <g key={angle} transform={`rotate(${angle} 44 43)`}>
            <path
              className="izumi-rose-petal"
              style={{ '--petal-delay': `${95 + index * 24}ms` } as CSSProperties}
              d="M44 50C35 46 30 36 34 30C36 25 43 26 46 28C51 23 58 29 56 35C55 42 49 47 44 50Z"
            />
          </g>
        ))}
      </g>
      <path
        d="M40 48C33 43 37 34 45 35C53 35 54 45 47 48C40 50 38 42 43 40C48 38 50 44 46 44"
        fill="#f8f6ff"
        stroke="#a5a8c8"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
      <path
        className="izumi-rose-glint"
        d="M44 33V38M41.5 35.5H46.5"
        stroke="white"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}
