import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Check, Layers3 } from 'lucide-react';
import type { OnlineRoomView } from '@game/online';
import { getCardBackUrl, getCardImageUrl } from '@/lib/imageService';
import './theme-deck-assignment-intro.css';

const RESULT_READY_DELAY_MS = 1_500;

export function ThemeDeckAssignmentIntro({
  assignment,
  playerName,
  opponentName,
  eventName,
  poolPreviewCardCodes,
  reduceMotion,
  onComplete,
}: {
  assignment: NonNullable<OnlineRoomView['themeDeckAssignment']>;
  playerName: string;
  opponentName: string;
  eventName: string | null;
  poolPreviewCardCodes: readonly string[];
  reduceMotion: boolean;
  onComplete: () => void;
}) {
  const [animationCompleted, setAnimationCompleted] = useState(false);
  const [showFinalImmediately, setShowFinalImmediately] = useState(false);
  const completedRef = useRef(false);
  const finish = useCallback(() => {
    if (completedRef.current) return;
    completedRef.current = true;
    onComplete();
  }, [onComplete]);

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
  const resultReady = reduceMotion || showFinalImmediately || animationCompleted;
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
            {eventName ?? '轮换主题牌桌'}
          </div>
          <h1
            id="theme-assignment-intro-title"
            className="mt-1 text-xl font-semibold tracking-normal text-[var(--text-primary)] sm:text-3xl lg:text-4xl"
          >
            本局主题卡组
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
              src={cardCode ? getCardImageUrl(cardCode, 'medium') : cardBackUrl}
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
                      src={getCardImageUrl(cardCode, 'medium')}
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

      <div className="theme-assignment-intro__next">
        <p className="text-center text-xs font-semibold text-[var(--text-secondary)] sm:text-sm">
          {resultReady ? '分配完成，确认后进入猜拳' : '正在从本期卡组池分配'}
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
    </div>
  );
}
