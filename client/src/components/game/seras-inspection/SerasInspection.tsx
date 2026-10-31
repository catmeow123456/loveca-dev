import { useId } from 'react';
import { useGameStore, type VisibleCardPresentation } from '@/store/gameStore';
import { isLiveCardData } from '@game/domain/entities/card';
import { Card } from '@/components/card/Card';
import { CardDetailPressTarget } from '../CardDetailPressTarget';
import type { SerasInspectionPhase } from '@/lib/serasInspection';
import './seras-inspection.css';

/** A mask suspended from the theatre frame; decorative only. */
function HangingMask() {
  const id = useId().replace(/:/g, '');
  return (
    <svg viewBox="0 0 230 200" className="seras-mask" aria-hidden="true">
      <defs>
        <linearGradient id={`${id}metal`} x1="0" y1="0" x2=".8" y2="1">
          <stop stopColor="#51444f" />
          <stop offset=".35" stopColor="#29242e" />
          <stop offset=".65" stopColor="#0b0a11" />
          <stop offset="1" stopColor="#4c3b48" />
        </linearGradient>
        <radialGradient id={`${id}lens`} cx=".3" cy=".25">
          <stop stopColor="#696675" />
          <stop offset=".24" stopColor="#3b3949" />
          <stop offset=".65" stopColor="#232434" />
          <stop offset="1" stopColor="#080811" />
        </radialGradient>
      </defs>
      <ellipse cx="132" cy="30" rx="6" ry="8" fill="#29161f" stroke="#b99a6d" strokeWidth="1.5" />
      <path
        d="M130 36 Q86 49 48 83 M134 36 Q139 62 110 91"
        fill="none"
        stroke="#281019"
        strokeWidth="7"
      />
      <path
        d="M130 36 Q86 49 48 83 M134 36 Q139 62 110 91"
        fill="none"
        stroke="#713044"
        strokeWidth="4"
      />
      <path
        d="M129 36 Q85 49 47 82 M133 36 Q138 62 109 90"
        fill="none"
        stroke="#ad6d73"
        strokeWidth=".8"
        opacity=".7"
      />
      <g transform="translate(6 54) rotate(18 88 48)" className="seras-mask-body">
        <path
          d="M40 40 Q57 16 85 23 L112 39 Q117 67 207 97 Q159 108 117 88 L88 121 Q54 116 40 91 Q29 65 40 40Z"
          fill={`url(#${id}metal)`}
          stroke="#aa8b66"
          strokeWidth="1.2"
        />
        <path
          d="M107 54 Q144 88 207 97 Q148 88 117 88 L93 75 M87 118 Q93 91 104 80"
          fill="none"
          stroke="#7c6b68"
          strokeWidth="1"
        />
        <path
          d="M43 39 Q58 25 83 29 M45 92 Q54 111 78 113"
          fill="none"
          stroke="#b9a491"
          strokeWidth=".8"
        />
        <ellipse
          cx="72"
          cy="61"
          rx="24"
          ry="26"
          transform="rotate(-18 72 61)"
          fill="#100d16"
          stroke="#b49670"
          strokeWidth="2"
        />
        <ellipse
          className="seras-mask-lens"
          cx="72"
          cy="61"
          rx="19"
          ry="21"
          transform="rotate(-18 72 61)"
          fill={`url(#${id}lens)`}
          stroke="#685a50"
        />
        <path
          d="M59 53 Q64 44 75 45"
          stroke="#d8c7b7"
          opacity=".28"
          strokeWidth="1.5"
          fill="none"
        />
        {[0, 1, 2, 3, 4].map((n) => (
          <circle key={n} cx={123 + n * 10} cy={85 + n * 2.2} r="1.4" fill="#b19777" />
        ))}
      </g>
      <g transform="translate(132 37) scale(.6)">
        <path
          d="M-4 4 Q-20 -4 -15 -11 Q-6 -15 0 -8 Q8 -18 15 -9 Q22 0 10 6 Q7 18 -3 12 Q-12 15 -13 6Z"
          fill="#7e253b"
          stroke="#b75a65"
          strokeWidth=".7"
        />
        <path
          d="M-6 1 Q-5 -7 4 -6 Q12 -1 5 6 Q-4 10 -6 1 M-2 1 Q0 -3 4 0 L1 3Z"
          fill="none"
          stroke="#d27b83"
          strokeWidth=".8"
        />
      </g>
    </svg>
  );
}

export function SerasTheatreDecor({ selected }: { selected: boolean }) {
  return (
    <div className="seras-decor" aria-hidden="true" data-selected={selected}>
      <div className="seras-curtain seras-curtain--left" />
      <div className="seras-curtain seras-curtain--right" />
      <div className="seras-valance" />
      <svg className="seras-arch" viewBox="0 0 1000 56" preserveAspectRatio="none">
        <path d="M24 18 Q250 42 500 28 Q750 42 976 18" />
        <path d="M484 28 L500 36 L516 28" />
      </svg>
      <HangingMask />
    </div>
  );
}

export interface SerasInspectionCard {
  id: string;
  presentation: VisibleCardPresentation | null;
  eligible: boolean;
  selected: boolean;
}

/** Reads projected fronts only. Unknown/private cards stay backs, even in a themed panel. */
export function SerasInspectionCards({
  cards,
  phase,
  canSelect,
  onSelect,
}: {
  cards: readonly SerasInspectionCard[];
  phase: SerasInspectionPhase;
  canSelect: boolean;
  onSelect: (id: string) => void;
}) {
  const setHoveredCard = useGameStore((s) => s.setHoveredCard);
  return (
    <div
      className="seras-score-gallery"
      role="group"
      aria-label={phase === 'reveal' ? '本次公开的卡牌' : '塞拉丝检视的卡牌'}
    >
      {cards.map(({ id, presentation, eligible, selected }) => {
        const live = presentation && isLiveCardData(presentation.cardData);
        const label = presentation?.cardData.name ?? '未公开的检视牌';
        const selectable = canSelect && eligible && !!presentation;
        return (
          <div
            className="seras-score"
            key={id}
            data-eligible={eligible}
            data-selected={selected}
            data-battle-ui-object-id={id}
          >
            {phase === 'reveal' && (
              <div className="seras-score-position" aria-hidden="true">
                LIVE
              </div>
            )}
            <CardDetailPressTarget
              cardId={presentation?.instanceId}
              title={label}
              className="seras-score-art"
            >
              <button
                type="button"
                aria-label={label}
                aria-pressed={phase === 'inspection' && eligible ? selected : undefined}
                aria-disabled={!selectable}
                tabIndex={selectable ? 0 : -1}
                className={`seras-score-card ${live ? 'seras-score-card--live' : ''}`}
                onClick={() => {
                  if (selectable) onSelect(id);
                }}
              >
                {presentation ? (
                  <div className="seras-card-orientation">
                    <Card
                      cardData={presentation.cardData}
                      instanceId={presentation.instanceId}
                      imagePath={presentation.imagePath}
                      size="sm"
                      faceUp
                      interactive={false}
                      showHover={false}
                      animateInitialFlip={false}
                      className="seras-card-face"
                    />
                  </div>
                ) : (
                  <img src="/back.jpg" alt="未公开的检视牌" className="seras-card-back" />
                )}
              </button>
            </CardDetailPressTarget>
            {presentation ? (
              <button
                type="button"
                className="seras-score-label"
                aria-label={`查看${label}详情`}
                onClick={() => setHoveredCard(presentation.instanceId)}
              >
                {label}
              </button>
            ) : (
              <div className="seras-score-label">{label}</div>
            )}
            {phase === 'inspection' && (
              <div className="seras-score-status">
                {presentation
                  ? eligible
                    ? selected
                      ? '已选择'
                      : '可选择'
                    : '将放置入休息室'
                  : '仅对方可见'}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
