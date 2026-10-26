import { isEnergyCardData, isLiveCardData, isMemberCardData } from '@game/domain/entities/card';
import { OrientationState } from '@game/shared/types/enums';
import { motion } from 'framer-motion';
import { Card } from '@/components/card/Card';
import { PresentationImage } from '@/components/excel/PresentationRoot';
import { cn } from '@/lib/utils';
import type { PublicRevealEntranceTiming } from '@/lib/publicRevealAutoAdvance';
import type { VisibleCardPresentation } from '@/store/gameStore';
import { CardDetailPressTarget } from './CardDetailPressTarget';

interface BattleCardCandidate {
  id: string;
  label: string;
  presentation: VisibleCardPresentation | null;
  disabled?: boolean;
  selected?: boolean;
  selectionOrder?: number;
  concealed?: boolean;
  orientation?: OrientationState;
  skipsNextActivePhase?: boolean;
  entrance?: { key: string; timing: PublicRevealEntranceTiming };
}

/** Projected card previews only. The caller owns selection and command submission. */
export function BattleCardCandidateGrid({
  label,
  candidates,
  onSelect,
  readOnly = false,
  layout = 'grid',
}: {
  label: string;
  candidates: readonly BattleCardCandidate[];
  onSelect?: (id: string) => void;
  readOnly?: boolean;
  layout?: 'grid' | 'row';
}) {
  const visibleFaces = candidates.flatMap((candidate) =>
    !candidate.concealed && candidate.presentation ? [candidate.presentation.cardData] : []
  );
  // Mixed member/LIVE choices retain a uniform portrait layout. Energy orientation
  // continues to express its projected active/waiting state.
  const portraitCards = visibleFaces.some(isLiveCardData) && visibleFaces.some(isMemberCardData);
  const entries = candidates.map((candidate, index) => {
    // A concealed choice never consumes identity or state from a known front.
    const presentation = candidate.concealed ? null : candidate.presentation;
    const cardLabel = candidate.concealed ? `第${index + 1}张手牌` : candidate.label;
    const energy = !!presentation && isEnergyCardData(presentation.cardData);
    const energyStateKnown = energy && candidate.orientation !== undefined;
    const live = !!presentation && isLiveCardData(presentation.cardData);
    const waiting = energy && candidate.orientation === OrientationState.WAITING;
    const skipsNextActivePhase = energy && candidate.skipsNextActivePhase === true;
    const status = [
      energyStateKnown ? (waiting ? '待机' : '活跃') : '',
      skipsNextActivePhase ? '下次不自动活跃' : '',
    ].filter(Boolean);
    const orderLabel = candidate.selectionOrder ? `；顺序 ${candidate.selectionOrder}` : '';
    const title = `${cardLabel}${orderLabel}${energyStateKnown ? `；当前状态：${waiting ? '等待' : '活跃'}` : ''}${
      skipsNextActivePhase ? '；下次活跃阶段不会自动变为活跃' : ''
    }`;
    return {
      ...candidate,
      presentation,
      cardLabel,
      turnLive: live && !portraitCards,
      waiting,
      skipsNextActivePhase,
      status,
      title,
      landscape: (live && !portraitCards) || waiting,
      canSelect: candidate.concealed || !!presentation,
    };
  });
  const hasLandscape = entries.some((entry) => entry.landscape);
  const mixedOrientation = hasLandscape && entries.some((entry) => !entry.landscape);
  return (
    <div
      role="group"
      aria-label={label}
      className={cn(
        'battle-card-candidate-grid',
        layout === 'row' && 'battle-card-candidate-grid--row',
        hasLandscape && 'battle-card-candidate-grid--landscape',
        mixedOrientation && 'battle-card-candidate-grid--mixed-orientation'
      )}
    >
      {entries.map(
        ({
          id,
          cardLabel,
          title,
          presentation,
          disabled,
          selected,
          selectionOrder,
          concealed,
          turnLive,
          waiting,
          skipsNextActivePhase,
          status,
          landscape,
          canSelect,
          entrance,
        }) => {
          const classes = cn(
            'relative flex min-w-0 flex-col items-center gap-1 rounded-md border p-1 text-[var(--text-secondary)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]',
            selected
              ? 'border-[var(--border-active)] bg-[color:color-mix(in_srgb,var(--accent-primary)_12%,var(--bg-surface))]'
              : 'border-transparent bg-[var(--bg-surface)]',
            !readOnly &&
              !disabled &&
              !!onSelect &&
              canSelect &&
              'hover:border-[var(--border-active)] hover:bg-[color:color-mix(in_srgb,var(--accent-primary)_8%,var(--bg-surface))]'
          );
          const content = (
            <>
              <div className="battle-card-candidate-frame flex shrink-0 items-center justify-center">
                {concealed ? (
                  <div className="battle-card-candidate-art battle-card-face overflow-hidden shadow-sm">
                    <PresentationImage
                      src="/back.jpg"
                      alt="不可见的手牌"
                      className="h-full w-full object-cover"
                    />
                  </div>
                ) : presentation ? (
                  <CardDetailPressTarget
                    cardId={presentation.instanceId}
                    title={title}
                    className={cn(
                      'battle-card-candidate-art flex items-center justify-center',
                      landscape && 'battle-card-candidate-art--landscape'
                    )}
                  >
                    <div
                      className={cn(
                        'battle-card-face shrink-0 origin-center',
                        turnLive && '-rotate-90',
                        waiting && 'rotate-90',
                        skipsNextActivePhase &&
                          'ring-2 ring-red-500 ring-offset-2 ring-offset-[var(--bg-surface)]'
                      )}
                    >
                      <Card
                        cardData={presentation.cardData}
                        instanceId={presentation.instanceId}
                        imagePath={presentation.imagePath}
                        size="sm"
                        faceUp
                        interactive={false}
                        showHover={false}
                        animateInitialFlip={false}
                        className={cn(
                          'h-[var(--candidate-portrait-height)] w-[var(--candidate-portrait-width)] shrink-0 shadow-sm',
                          waiting && 'opacity-60 grayscale'
                        )}
                      />
                    </div>
                  </CardDetailPressTarget>
                ) : (
                  <div className="battle-card-candidate-art battle-card-face flex items-center justify-center border border-dashed border-[var(--border-subtle)] text-xs text-[var(--text-muted)]">
                    不可见
                  </div>
                )}
              </div>
              <span className="line-clamp-2 w-full text-center text-[11px] leading-4">
                {cardLabel}
              </span>
              {status.length > 0 && (
                <span className="w-full text-center text-[10px] leading-4 text-[var(--text-muted)]">
                  {status.map((line) => (
                    <span key={line} className="block">
                      {line}
                    </span>
                  ))}
                </span>
              )}
              {selectionOrder !== undefined && selectionOrder > 0 && (
                <span
                  aria-hidden="true"
                  className="absolute right-0.5 top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--accent-primary)] px-1 text-[10px] font-semibold text-white"
                >
                  {selectionOrder}
                </span>
              )}
            </>
          );
          return readOnly ? (
            <motion.div
              key={entrance?.key ?? id}
              role="group"
              data-battle-ui-object-id={id}
              aria-label={title}
              className={classes}
              initial={entrance?.timing.shouldAnimate ? { opacity: 0, y: 8, scale: 0.97 } : false}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{
                duration: entrance?.timing.durationSeconds ?? 0,
                delay: entrance?.timing.delaySeconds ?? 0,
                ease: [0.2, 0.8, 0.2, 1],
              }}
            >
              {content}
            </motion.div>
          ) : (
            <button
              key={id}
              type="button"
              data-battle-ui-object-id={id}
              disabled={disabled || !canSelect || !onSelect}
              aria-label={title}
              aria-pressed={selected}
              title={title}
              onClick={() => onSelect?.(id)}
              className={classes}
            >
              {content}
            </button>
          );
        }
      )}
    </div>
  );
}
