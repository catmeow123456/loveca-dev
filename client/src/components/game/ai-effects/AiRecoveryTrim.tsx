import { useId } from 'react';

/** Static ribbon clasp, kept in its own row above the ordinary selection header. */
export function AiRecoveryTrim() {
  const id = useId().replace(/:/g, '');
  return (
    <div className="ai-recovery-trim" aria-hidden="true">
      <svg viewBox="0 0 320 44" focusable="false">
        <defs>
          <linearGradient id={`${id}-satin`} x1="0" y1="0" x2="0" y2="1">
            <stop stopColor="#ee899b" />
            <stop offset=".22" stopColor="#b73052" />
            <stop offset=".6" stopColor="#741d3b" />
            <stop offset=".82" stopColor="#bb405c" />
            <stop offset="1" stopColor="#5f1931" />
          </linearGradient>
          <linearGradient id={`${id}-wing`} x1="0" y1="0" x2="0" y2="1">
            <stop stopColor="#483243" />
            <stop offset="1" stopColor="#130f1c" />
          </linearGradient>
        </defs>
        <path
          d="M6 13 H314 L304 22 L314 31 H6 L16 22Z"
          fill={`url(#${id}-satin)`}
          stroke="#df8a9c"
          strokeWidth=".6"
        />
        <path
          d="M20 16 H300 M20 28 H300"
          fill="none"
          stroke="#f3b1be"
          strokeWidth=".65"
          opacity=".55"
        />
        {[false, true].map((right) => (
          <g key={String(right)} transform={right ? 'translate(320 0) scale(-1 1)' : undefined}>
            <path
              d="M155 23 Q133 6 111 5 Q121 15 112 25 Q126 19 131 35 Q143 25 155 30Z"
              fill={`url(#${id}-wing)`}
              stroke="#d68a9d"
              strokeWidth="1"
            />
            <path
              d="M153 26 Q131 10 111 5 M152 27 Q133 16 131 35 M149 26 Q128 17 112 25"
              fill="none"
              stroke="#986174"
              strokeWidth=".65"
            />
            <path
              d="M159 22 Q143 8 138 14 L142 29 Q150 29 159 24Z"
              fill={`url(#${id}-satin)`}
              stroke="#e995a6"
              strokeWidth=".8"
            />
            <path
              d="M158 25 L143 37 L148 38 L147 42 L161 28Z"
              fill="#771e3a"
              stroke="#c56a85"
              strokeWidth=".6"
            />
          </g>
        ))}
        <path
          d="M160 17 L166 22 L160 29 L154 22Z"
          fill="#251322"
          stroke="#f1b2c0"
          strokeWidth="1"
        />
        <path d="M160 20 L162 22 L160 25 L158 22Z" fill="#d75171" />
      </svg>
    </div>
  );
}
