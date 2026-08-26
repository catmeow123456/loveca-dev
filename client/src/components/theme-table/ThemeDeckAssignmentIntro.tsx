import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Check, Clock3, Eye, Layers3 } from 'lucide-react';
import type { OnlineRoomView } from '@game/online';
import type { ThemePrebuiltDeckView } from '@game/online/theme-table-types';
import type { AnyCardData } from '@game/domain/entities/card';
import { CardDetailDrawer } from '@/components/deck-editor/CardDetailDrawer';
import { getCardBackUrl, resolveRegistryCardImagePath } from '@/lib/imageService';
import { useGameStore } from '@/store/gameStore';
import { ThemeDeckGallery } from './ThemeDeckGallery';
import './theme-deck-assignment-intro.css';

const RESULT_READY_DELAY_MS = 1_500;

export function ThemeDeckAssignmentIntro({
  assignment,
  playerName,
  opponentName,
  eventName,
  assignedDeck,
  openingExpiresAt,
  poolPreviewCardCodes,
  reduceMotion,
  onComplete,
}: {
  assignment: NonNullable<OnlineRoomView['themeDeckAssignment']>;
  playerName: string;
  opponentName: string;
  eventName: string | null;
  assignedDeck: Pick<ThemePrebuiltDeckView, 'mainDeck' | 'energyDeck'> | null;
  openingExpiresAt: number | null;
  poolPreviewCardCodes: readonly string[];
  reduceMotion: boolean;
  onComplete: () => void;
}) {
  const [animationCompleted, setAnimationCompleted] = useState(false);
  const [showFinalImmediately, setShowFinalImmediately] = useState(false);
  const [showDeckPreview, setShowDeckPreview] = useState(false);
  const [selectedCard, setSelectedCard] = useState<AnyCardData | null>(null);
  const [remainingSeconds, setRemainingSeconds] = useState<number | null>(null);
  const cardDataRegistry = useGameStore((state) => state.cardDataRegistry);
  const completedRef = useRef(false);
  const resultReady = reduceMotion || showFinalImmediately || animationCompleted;
  const finish = useCallback(() => {
    if (completedRef.current) return;
    completedRef.current = true;
    onComplete();
  }, [onComplete]);

  useEffect(() => {
    if (!resultReady || openingExpiresAt === null) return;

    const updateCountdown = () => {
      const nextRemainingSeconds = Math.max(0, Math.ceil((openingExpiresAt - Date.now()) / 1_000));
      setRemainingSeconds(nextRemainingSeconds);
      if (nextRemainingSeconds === 0) finish();
    };

    updateCountdown();
    const timer = window.setInterval(updateCountdown, 1_000);
    return () => window.clearInterval(timer);
  }, [finish, openingExpiresAt, resultReady]);

  useEffect(() => {
    if (reduceMotion) return;
    const timer = window.setTimeout(() => setAnimationCompleted(true), RESULT_READY_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [reduceMotion]);

  const poolCards = useMemo(
    () =>
      poolPreviewCardCodes.length > 0
        ? poolPreviewCardCodes.slice(0, 4)
        : ([null, null, null, null] as const),
    [poolPreviewCardCodes]
  );
  const ownPreviewCards = assignment.previewCardCodes.slice(0, 3);
  const cardBackUrl = getCardBackUrl('medium');
  const showSettledResult = reduceMotion || showFinalImmediately;

  return (
    <div
      className={`theme-assignment-intro online-opening-stage-layout relative grid gap-3 p-3 sm:gap-5 sm:p-6 ${
        reduceMotion ? 'theme-assignment-intro--reduced' : ''
      } ${showSettledResult ? 'theme-assignment-intro--settled' : ''}`}
      aria-labelledby="theme-assignment-intro-title"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-xs font-semibold text-[var(--accent-primary)]">
            {eventName ?? '娱乐模式'}
          </div>
          <h1
            id="theme-assignment-intro-title"
            className="mt-1 text-xl font-semibold tracking-normal text-[var(--text-primary)] sm:text-3xl lg:text-4xl"
          >
            本局卡组
          </h1>
          <p className="mt-1 text-xs font-semibold text-[var(--text-secondary)] sm:mt-2 sm:text-sm">
            {resultReady ? '本局节目单已确定' : '正在分配本局节目单'}
          </p>
        </div>
        {!resultReady ? (
          <button
            type="button"
            className="theme-assignment-intro__skip"
            onClick={() => setShowFinalImmediately(true)}
          >
            立即查看
          </button>
        ) : null}
      </div>

      <div className="theme-assignment-intro__scene">
        <div className="theme-assignment-intro__pool" aria-hidden="true">
          {poolCards.map((cardCode, index) => (
            <img
              key={cardCode ?? `deck-back-${index}`}
              src={
                cardCode
                  ? resolveRegistryCardImagePath(cardCode, cardDataRegistry, 'medium')
                  : cardBackUrl
              }
              alt=""
              style={{ '--theme-pool-index': index } as CSSProperties}
              onError={(event) => {
                event.currentTarget.onerror = null;
                event.currentTarget.src = cardBackUrl;
              }}
            />
          ))}
          <span className="theme-assignment-intro__pool-label">
            <Layers3 size={14} /> 本期卡组池
          </span>
        </div>

        <div
          className="theme-assignment-intro__flight theme-assignment-intro__flight--self"
          aria-hidden="true"
        >
          <img src={cardBackUrl} alt="" />
        </div>
        <div
          className="theme-assignment-intro__flight theme-assignment-intro__flight--opponent"
          aria-hidden="true"
        >
          <img src={cardBackUrl} alt="" />
        </div>

        <div className="theme-assignment-intro__seat-grid">
          <article className="theme-assignment-intro__seat theme-assignment-intro__seat--self">
            <div className="min-w-0">
              <div className="text-[10px] text-[var(--text-muted)] sm:text-xs">你</div>
              <div className="mt-0.5 truncate text-sm font-bold text-[var(--text-primary)] sm:text-base lg:text-lg">
                {playerName}
              </div>
            </div>
            <div className="theme-assignment-intro__result theme-assignment-intro__result--self">
              <div className="theme-assignment-intro__own-cards" aria-hidden="true">
                {ownPreviewCards.length > 0 ? (
                  ownPreviewCards.map((cardCode, index) => (
                    <img
                      key={cardCode}
                      src={resolveRegistryCardImagePath(cardCode, cardDataRegistry, 'medium')}
                      alt=""
                      style={{ '--theme-card-index': index } as CSSProperties}
                      onError={(event) => {
                        event.currentTarget.onerror = null;
                        event.currentTarget.src = cardBackUrl;
                      }}
                    />
                  ))
                ) : (
                  <img src={cardBackUrl} alt="" />
                )}
              </div>
              <div className="min-w-0 text-right lg:text-center">
                <div className="truncate text-sm font-bold text-[var(--text-primary)] sm:text-base lg:text-lg">
                  {assignment.deckName}
                </div>
                <div className="mt-0.5 text-[10px] font-semibold text-[var(--accent-primary)] lg:mt-1 lg:text-xs">
                  你的本局卡组
                </div>
              </div>
            </div>
          </article>

          <div className="theme-assignment-intro__axis" aria-hidden="true">
            <span />
            <Layers3 size={20} />
            <span />
          </div>

          <article className="theme-assignment-intro__seat theme-assignment-intro__seat--opponent">
            <div className="min-w-0">
              <div className="text-[10px] text-[var(--text-muted)] sm:text-xs">对手</div>
              <div className="mt-0.5 truncate text-sm font-bold text-[var(--text-primary)] sm:text-base lg:text-lg">
                {opponentName}
              </div>
            </div>
            <div className="theme-assignment-intro__result theme-assignment-intro__result--opponent">
              <div className="theme-assignment-intro__sealed-deck" aria-hidden="true">
                <img src={cardBackUrl} alt="" />
                <span>
                  <Check size={12} />
                </span>
              </div>
              <div className="min-w-0 text-right lg:text-center">
                <div className="text-sm font-bold text-[var(--text-primary)] sm:text-base lg:text-lg">
                  分配完成
                </div>
                <div className="mt-0.5 text-[10px] font-semibold text-[var(--semantic-info)] lg:mt-1 lg:text-xs">
                  对手卡组已就绪
                </div>
              </div>
            </div>
          </article>
        </div>
      </div>

      {resultReady && assignedDeck ? (
        <section
          className="theme-assignment-intro__deck-preview"
          aria-labelledby="theme-assignment-deck-preview-title"
        >
          <div className="theme-assignment-intro__deck-preview-header">
            <div>
              <h2 id="theme-assignment-deck-preview-title">本局卡组构成</h2>
              <p>
                {assignedDeck.mainDeck.reduce((total, entry) => total + entry.count, 0)} 张主卡组 ·{' '}
                {assignedDeck.energyDeck.reduce((total, entry) => total + entry.count, 0)} 张能量
              </p>
            </div>
            <button
              type="button"
              className="theme-assignment-intro__deck-preview-toggle"
              aria-expanded={showDeckPreview}
              aria-controls="theme-assignment-deck-preview-content"
              onClick={() => setShowDeckPreview((visible) => !visible)}
            >
              <Eye size={15} aria-hidden="true" />
              {showDeckPreview ? '收起预览' : '查看卡组构成'}
            </button>
          </div>
          {showDeckPreview ? (
            <div
              id="theme-assignment-deck-preview-content"
              className="theme-assignment-intro__deck-preview-content"
            >
              <ThemeDeckGallery deck={assignedDeck} onViewCard={setSelectedCard} />
            </div>
          ) : null}
        </section>
      ) : null}

      <div className="theme-assignment-intro__next">
        <p className="text-center text-xs font-semibold text-[var(--text-secondary)] sm:text-sm">
          {resultReady ? (
            <>
              分配完成，确认后进入猜拳
              {remainingSeconds !== null ? (
                <span className="theme-assignment-intro__countdown">
                  <Clock3 size={13} aria-hidden="true" />
                  自动进入 {formatCountdown(remainingSeconds)}
                </span>
              ) : null}
            </>
          ) : (
            '正在从本期卡组池分配'
          )}
        </p>
        <button
          type="button"
          className="theme-assignment-intro__continue"
          disabled={!resultReady}
          onClick={finish}
        >
          进入猜拳
        </button>
      </div>
      {resultReady ? (
        <p className="sr-only" aria-live="polite">
          你的本局卡组是“{assignment.deckName}”，对手卡组已分配。
        </p>
      ) : null}
      <CardDetailDrawer card={selectedCard} onClose={() => setSelectedCard(null)} />
    </div>
  );
}

function formatCountdown(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}
