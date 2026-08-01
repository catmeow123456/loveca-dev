import type { OnlineMatchEmoteId } from '@game/online';
import { cn } from '@/lib/utils';

interface MatchEmoteVisualProps {
  readonly emoteId: OnlineMatchEmoteId;
  readonly className?: string;
  readonly animated?: boolean;
}

export function MatchEmoteVisual({ emoteId, className, animated = false }: MatchEmoteVisualProps) {
  return (
    <svg
      viewBox="0 0 96 96"
      className={cn('match-emote-visual', animated && 'match-emote-visual--animated', className)}
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id={`emote-card-${emoteId}`} x1="18" y1="14" x2="78" y2="82">
          <stop offset="0" stopColor="var(--accent-primary)" />
          <stop offset="1" stopColor="var(--accent-secondary)" />
        </linearGradient>
      </defs>
      <rect
        x="19"
        y="12"
        width="58"
        height="72"
        rx="11"
        fill="var(--bg-surface)"
        stroke={`url(#emote-card-${emoteId})`}
        strokeWidth="4"
      />
      <rect
        x="25"
        y="18"
        width="46"
        height="60"
        rx="7"
        fill="color-mix(in srgb, var(--accent-primary) 10%, var(--bg-surface))"
        stroke="color-mix(in srgb, var(--accent-secondary) 34%, transparent)"
        strokeWidth="1.5"
      />
      <EmoteMark emoteId={emoteId} />
    </svg>
  );
}

function EmoteMark({ emoteId }: { readonly emoteId: OnlineMatchEmoteId }) {
  switch (emoteId) {
    case 'DEEP_THINKING':
      return (
        <g>
          <path
            d="M35 33h26a8 8 0 0 1 8 8v11a8 8 0 0 1-8 8H49l-8 7 1.5-7H35a8 8 0 0 1-8-8V41a8 8 0 0 1 8-8Z"
            fill="color-mix(in srgb, var(--accent-primary) 18%, var(--bg-surface))"
            stroke="var(--accent-primary)"
            strokeWidth="2.5"
            strokeLinejoin="round"
          />
          {[39, 48, 57].map((cx, index) => (
            <circle
              key={cx}
              className="match-emote-thinking-dot"
              style={{ animationDelay: `${index * 180}ms` }}
              cx={cx}
              cy="47"
              r="3.2"
              fill="var(--accent-secondary)"
            />
          ))}
        </g>
      );
    case 'THANK_YOU':
      return (
        <g fill="none" strokeLinecap="round" strokeLinejoin="round">
          <path d="M34 59c7 6 21 6 28 0" stroke="var(--accent-primary)" strokeWidth="3" />
          <path
            d="M36 44c2.5-4 6.5-4 9 0M51 44c2.5-4 6.5-4 9 0"
            stroke="var(--text-primary)"
            strokeWidth="3"
          />
          <path
            d="m48 27 3.2 6.5 7.1 1-5.1 5 1.2 7-6.4-3.3-6.4 3.3 1.2-7-5.1-5 7.1-1Z"
            fill="var(--accent-secondary)"
            stroke="var(--accent-secondary)"
            strokeWidth="1.5"
          />
        </g>
      );
    case 'NICE_TO_MEET_YOU':
      return (
        <g fill="none" strokeLinecap="round" strokeLinejoin="round">
          <path
            d="M31 53c5-9 10-13 17-13s12 4 17 13"
            stroke="var(--accent-primary)"
            strokeWidth="4"
          />
          <path
            d="M31 53c5 5 11 8 17 8s12-3 17-8"
            stroke="var(--accent-secondary)"
            strokeWidth="4"
          />
          <path d="M34 34 29 29m33 5 5-5M48 31v-7" stroke="var(--text-primary)" strokeWidth="3" />
        </g>
      );
    case 'NICE_PLAY':
      return (
        <g strokeLinejoin="round">
          <path
            d="m48 27 5.6 11.4 12.6 1.8-9.1 8.9 2.1 12.5L48 55.7l-11.2 5.9 2.1-12.5-9.1-8.9 12.6-1.8Z"
            fill="color-mix(in srgb, var(--semantic-warning) 78%, var(--accent-secondary))"
            stroke="var(--accent-primary)"
            strokeWidth="2.5"
          />
          <path
            d="m42 46 4 4 8-9"
            fill="none"
            stroke="var(--bg-surface)"
            strokeLinecap="round"
            strokeWidth="3.5"
          />
        </g>
      );
    case 'GOOD_GAME':
      return (
        <g fill="none" strokeLinecap="round" strokeLinejoin="round">
          <path
            d="M37 32h22v11c0 9-4.5 15-11 15s-11-6-11-15Z"
            fill="color-mix(in srgb, var(--semantic-warning) 24%, var(--bg-surface))"
            stroke="var(--semantic-warning)"
            strokeWidth="3"
          />
          <path
            d="M37 36h-7v5c0 6 4 9 9 9m20-14h7v5c0 6-4 9-9 9M48 58v7m-9 4h18"
            stroke="var(--accent-primary)"
            strokeWidth="3"
          />
        </g>
      );
    case 'SORRY_TO_KEEP_YOU_WAITING':
      return (
        <g fill="none" strokeLinecap="round" strokeLinejoin="round">
          <circle
            cx="48"
            cy="47"
            r="17"
            fill="color-mix(in srgb, var(--accent-primary) 12%, var(--bg-surface))"
            stroke="var(--accent-primary)"
            strokeWidth="3"
          />
          <path d="M48 37v11l8 5M39 66h18" stroke="var(--text-primary)" strokeWidth="3" />
          <path d="M32 31 27 26m37 5 5-5" stroke="var(--accent-secondary)" strokeWidth="3" />
        </g>
      );
  }
}
