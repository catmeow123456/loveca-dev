/**
 * 卡牌详情浮窗组件
 *
 * 桌面端悬停显示右侧详情，紧凑视口显示带遮罩的底部详情抽屉
 */

import { memo, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useGameStore, type VisibleCardPresentation } from '@/store/gameStore';
import { getHeartRequirementEntries } from '@/lib/heartRequirementUtils';
import { getCardGroupDisplayText, getCardLocalizedInfo } from '@/lib/cardLocalization';
import {
  HEART_ICON_SOURCE_BY_COLOR,
  HEART_REQUIREMENT_ICON_SOURCE_BY_COLOR,
  MODIFIER_ICON_SOURCE,
} from '@/lib/modifierIconAssets';
import { Card } from '@/components/card/Card';
import { CardLocalizedEffect, CardLocalizedName } from '@/components/card/CardLocalizedInfo';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import type {
  AnyCardData,
  BladeHearts,
  MemberCardData,
  LiveCardData,
} from '@game/domain/entities/card';
import { isMemberCardData, isLiveCardData } from '@game/domain/entities/card';
import { BladeHeartEffect, HeartColor } from '@game/shared/types/enums';
import { getCardPoint } from '@game/domain/rules/deck-construction';

function DetailMetric({
  iconSrc,
  label,
  value,
  compact = false,
}: {
  iconSrc: string;
  label: string;
  value: number | string;
  compact?: boolean;
}) {
  return (
    <div className={cn('chip-badge', compact ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1')}>
      <img
        src={iconSrc}
        alt=""
        className={cn('object-contain', compact ? 'h-4 w-4' : 'h-5 w-5')}
        draggable={false}
      />
      <span className="text-[var(--text-muted)]">{label}</span>
      <span className="font-bold text-[var(--text-primary)]">{value}</span>
    </div>
  );
}

function CompactCardName({ card }: { card: AnyCardData }) {
  const { nameCn, nameJp } = getCardLocalizedInfo(card);
  const primaryName = nameCn ?? nameJp ?? card.cardCode;
  const secondaryName = nameCn && nameJp ? nameJp : null;

  return (
    <div className="min-w-0">
      <h3 className="line-clamp-2 text-sm font-bold leading-tight text-[var(--text-primary)]">
        {primaryName}
      </h3>
      {secondaryName && (
        <p className="mt-0.5 line-clamp-2 text-[11px] leading-tight text-[var(--text-muted)]">
          {secondaryName}
        </p>
      )}
    </div>
  );
}

function HeartIconGroup({
  color,
  count,
  iconSrc,
  label,
  compact = false,
}: {
  color: HeartColor;
  count: number;
  iconSrc?: string;
  label?: string;
  compact?: boolean;
}) {
  const resolvedIconSrc = iconSrc ?? HEART_ICON_SOURCE_BY_COLOR[color];
  const maxDirectIconCount = compact ? 10 : 12;
  const shouldShowEveryIcon = count <= maxDirectIconCount;
  const repeatedCount = Math.max(0, shouldShowEveryIcon ? count : 1);
  const resolvedLabel =
    label ?? (color === HeartColor.GRAY ? '无色' : color === HeartColor.RAINBOW ? 'All' : color);

  return (
    <div
      aria-label={`${resolvedLabel} Heart ${count}`}
      title={`${resolvedLabel} Heart ×${count}`}
      className={cn(
        'inline-flex items-center gap-1 rounded-md border border-[var(--border-subtle)] bg-[color:color-mix(in_srgb,var(--bg-overlay)_58%,transparent)]',
        compact ? 'min-h-6 px-1 py-0.5' : 'min-h-7 px-1.5 py-1'
      )}
    >
      <span className="inline-flex items-center gap-0.5">
        {Array.from({ length: repeatedCount }, (_, index) => (
          <img
            key={`${color}-${index}`}
            src={resolvedIconSrc}
            alt=""
            className={cn('object-contain', compact ? 'h-4 w-4' : 'h-5 w-5')}
            draggable={false}
          />
        ))}
      </span>
      {!shouldShowEveryIcon && (
        <span className="text-xs font-bold text-[var(--text-primary)]">×{count}</span>
      )}
    </div>
  );
}

function BladeHeartDetails({
  bladeHearts,
  compact = false,
}: {
  bladeHearts?: BladeHearts;
  compact?: boolean;
}) {
  if (!bladeHearts || bladeHearts.length === 0) {
    return null;
  }

  const heartCounts = new Map<HeartColor, number>();
  let drawCount = 0;
  let scoreCount = 0;
  for (const bladeHeart of bladeHearts) {
    switch (bladeHeart.effect) {
      case BladeHeartEffect.HEART:
        if (bladeHeart.heartColor) {
          heartCounts.set(bladeHeart.heartColor, (heartCounts.get(bladeHeart.heartColor) ?? 0) + 1);
        }
        break;
      case BladeHeartEffect.DRAW:
        drawCount += 1;
        break;
      case BladeHeartEffect.SCORE:
        scoreCount += 1;
        break;
    }
  }

  return (
    <div
      className={cn(
        compact ? 'flex flex-wrap items-center gap-1.5' : 'surface-panel rounded-xl p-2.5'
      )}
    >
      <span className={cn('text-[var(--text-muted)]', compact ? 'text-[11px]' : 'text-sm')}>
        判心
      </span>
      <div className={cn('flex flex-wrap items-center', compact ? 'gap-1' : 'mt-1 gap-1.5')}>
        {[...heartCounts.entries()].map(([color, count]) => (
          <HeartIconGroup key={color} color={color} count={count} compact={compact} />
        ))}
        {drawCount > 0 && (
          <span
            className="chip-badge px-2 py-0.5 text-xs text-[var(--semantic-info)]"
            aria-label={`抽卡判心 ${drawCount}`}
          >
            抽卡 +{drawCount}
          </span>
        )}
        {scoreCount > 0 && (
          <span
            className="chip-badge px-2 py-0.5 text-xs text-[var(--accent-gold)]"
            aria-label={`分数判心 ${scoreCount}`}
          >
            分数 +{scoreCount}
          </span>
        )}
      </div>
    </div>
  );
}

/** 成员卡详情 */
export const MemberCardDetails = memo(function MemberCardDetails({
  data,
  compact = false,
}: {
  data: MemberCardData;
  compact?: boolean;
}) {
  const groupDisplayText = getCardGroupDisplayText(data);

  return (
    <div className={cn(compact ? 'space-y-1.5' : 'space-y-2.5')}>
      {/* 基础信息 */}
      <div className={cn('flex flex-wrap items-center', compact ? 'gap-1.5' : 'gap-2 text-sm')}>
        <DetailMetric
          iconSrc={MODIFIER_ICON_SOURCE.cost}
          label="费用"
          value={data.cost}
          compact={compact}
        />
        <DetailMetric
          iconSrc={MODIFIER_ICON_SOURCE.blade}
          label="光棒"
          value={data.blade}
          compact={compact}
        />
      </div>

      {/* Hearts */}
      {data.hearts && data.hearts.length > 0 && (
        <div
          className={cn(
            compact ? 'flex flex-wrap items-center gap-1.5' : 'surface-panel rounded-xl p-2.5'
          )}
        >
          <span className={cn('text-[var(--text-muted)]', compact ? 'text-[11px]' : 'text-sm')}>
            Hearts
          </span>
          <div className={cn('flex flex-wrap', compact ? 'gap-1' : 'mt-1 gap-1')}>
            {data.hearts.map((heart, idx) => (
              <HeartIconGroup key={idx} color={heart.color} count={heart.count} compact={compact} />
            ))}
          </div>
        </div>
      )}

      <BladeHeartDetails bladeHearts={data.bladeHearts} compact={compact} />

      {/* 真实团体/小组 */}
      {(groupDisplayText || data.unitName) && (
        <div className={cn('text-[var(--text-muted)]', compact ? 'text-[11px]' : 'text-xs')}>
          {groupDisplayText && <span className="mr-2">真实团体: {groupDisplayText}</span>}
          {data.unitName && <span>小组: {data.unitName}</span>}
        </div>
      )}
    </div>
  );
});

/** Live 卡详情 */
export const LiveCardDetails = memo(function LiveCardDetails({
  data,
  compact = false,
}: {
  data: LiveCardData;
  compact?: boolean;
}) {
  // 将 Map 转换为数组进行遍历
  const requirements = getHeartRequirementEntries(data.requirements?.colorRequirements);

  return (
    <div className={cn(compact ? 'space-y-1.5' : 'space-y-2.5')}>
      {/* 分数 */}
      <div className={cn('chip-badge', compact ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-sm')}>
        <span className="text-[var(--text-muted)]">分数</span>
        <span
          className={cn('font-bold text-[var(--accent-gold)]', compact ? 'text-sm' : 'text-lg')}
        >
          ♪ {data.score}
        </span>
      </div>

      {/* Heart 需求 */}
      <div
        className={cn(
          compact ? 'flex flex-wrap items-center gap-1.5' : 'surface-panel rounded-xl p-2.5'
        )}
      >
        <span className={cn('text-[var(--text-muted)]', compact ? 'text-[11px]' : 'text-sm')}>
          需要
        </span>
        <div className={cn('flex flex-wrap', compact ? 'gap-1' : 'mt-1 gap-1.5')}>
          {requirements.map(([color, count]) => (
            <HeartIconGroup
              key={color}
              color={color as HeartColor}
              count={count as number}
              iconSrc={HEART_REQUIREMENT_ICON_SOURCE_BY_COLOR[color as HeartColor]}
              label={color === HeartColor.RAINBOW || color === HeartColor.GRAY ? '无色' : undefined}
              compact={compact}
            />
          ))}
        </div>
        <span
          className={cn('text-[var(--text-muted)]', compact ? 'text-[11px]' : 'mt-1 block text-xs')}
        >
          合计 {data.requirements.totalRequired}
        </span>
      </div>

      <BladeHeartDetails bladeHearts={data.bladeHearts} compact={compact} />
    </div>
  );
});

export const CardDetailOverlay = memo(function CardDetailOverlay() {
  const cardDetail = useGameStore((s) => s.ui.cardDetail);
  const getVisibleCardPresentation = useGameStore((s) => s.getVisibleCardPresentation);
  const getPublicEventCardPresentation = useGameStore((s) => s.getPublicEventCardPresentation);
  const setCardDetail = useGameStore((s) => s.setCardDetail);
  const shouldUseCompactDrawer = useMediaQuery('(max-width: 1023px)');

  const card =
    cardDetail?.kind === 'visible'
      ? getVisibleCardPresentation(cardDetail.cardId)
      : cardDetail?.kind === 'public-event-card'
        ? getPublicEventCardPresentation(cardDetail.cardCode, cardDetail.publicObjectId)
        : null;
  const closeDetail = useCallback(() => {
    setCardDetail(null);
  }, [setCardDetail]);

  useEffect(() => {
    if (!card) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeDetail();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [card, closeDetail]);

  useEffect(() => {
    if (!card || !shouldUseCompactDrawer || typeof document === 'undefined') return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [card, shouldUseCompactDrawer]);

  const content = (
    <AnimatePresence>
      {card &&
        (shouldUseCompactDrawer ? (
          <MobileCardDetailDrawer
            key={`mobile-card-detail-${card.instanceId}`}
            card={card}
            onClose={closeDetail}
          />
        ) : (
          <DesktopCardDetailPanel key={`desktop-card-detail-${card.instanceId}`} card={card} />
        ))}
    </AnimatePresence>
  );

  if (typeof document === 'undefined') {
    return content;
  }

  return createPortal(content, document.body);
});

function DesktopCardDetailPanel({ card }: { card: VisibleCardPresentation }) {
  const localizedName = getCardLocalizedInfo(card.cardData);

  return (
    <aside
      className="pointer-events-none fixed bottom-3 right-3 top-3 z-[200]"
      aria-label={`${localizedName.title} 卡牌详情`}
    >
      <motion.div
        initial={{ opacity: 0, x: 20 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: 20 }}
        transition={{ duration: 0.2 }}
        className={cn(
          'h-full w-[min(380px,calc(100vw-1.5rem))] max-w-[380px] xl:w-[400px] xl:max-w-[400px]',
          'surface-panel-frosted cute-scrollbar overflow-hidden p-3',
          'border-[var(--border-default)] shadow-[var(--shadow-lg)]'
        )}
      >
        <CardDetailContent card={card} density="desktop" />
      </motion.div>
    </aside>
  );
}

function MobileCardDetailDrawer({
  card,
  onClose,
}: {
  card: VisibleCardPresentation;
  onClose: () => void;
}) {
  const localizedName = getCardLocalizedInfo(card.cardData);

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.15 }}
        className="modal-backdrop fixed inset-0 z-[119]"
        onClick={onClose}
      />

      <motion.section
        role="dialog"
        aria-modal="true"
        aria-label={`${localizedName.title} 卡牌详情`}
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'tween', duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}
        className="safe-bottom fixed inset-x-0 bottom-0 z-[120] flex max-h-[var(--battle-viewport-height-86,86dvh)] min-h-[var(--battle-viewport-height-46,46dvh)] flex-col overflow-hidden rounded-t-[24px] border border-b-0 border-[var(--border-default)] bg-[var(--bg-surface)] shadow-[var(--shadow-lg)]"
        onClick={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div className="shrink-0 px-4 pb-2 pt-3">
          <div className="mb-3 flex justify-center">
            <div className="h-1.5 w-12 rounded-full bg-[var(--border-default)]" />
          </div>
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <h2 className="truncate text-sm font-bold text-[var(--text-primary)]">卡牌详情</h2>
              <p className="mt-0.5 truncate text-xs text-[var(--text-muted)]">
                {localizedName.title}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="button-icon h-11 w-11 shrink-0"
              aria-label="关闭卡牌详情"
              title="关闭卡牌详情"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="touch-scroll cute-scrollbar min-h-0 flex-1 overflow-y-auto px-4 pb-4">
          <CardDetailContent card={card} density="mobile" />
        </div>
      </motion.section>
    </>
  );
}

function CardDetailContent({
  card,
  density,
}: {
  card: VisibleCardPresentation;
  density: 'desktop' | 'mobile';
}) {
  const point = getCardPoint(card.cardCode);
  const isMobile = density === 'mobile';
  const typeDetails = card.eventOnlyMissingData ? null : isMemberCardData(card.cardData) ? (
    <MemberCardDetails data={card.cardData} compact={!isMobile} />
  ) : isLiveCardData(card.cardData) ? (
    <LiveCardDetails data={card.cardData} compact={!isMobile} />
  ) : null;
  const pointBadge = (
    <span className={cn('chip-badge', isMobile ? 'px-2.5 py-1 text-sm' : 'px-2 py-0.5 text-xs')}>
      <span className="text-[var(--text-muted)]">点数</span>
      <span className="font-bold text-[var(--accent-primary)]">{point}pt</span>
    </span>
  );

  return (
    <div className={cn(isMobile ? 'space-y-3 pb-1' : 'flex h-full min-h-0 flex-col gap-2')}>
      {/* 卡牌概要 */}
      <div
        className={cn(
          isMobile
            ? 'flex justify-center'
            : 'grid shrink-0 grid-cols-[120px_minmax(0,1fr)] gap-2.5',
          isMobile
            ? 'rounded-2xl border border-[var(--border-subtle)] bg-[color:color-mix(in_srgb,var(--bg-frosted)_44%,transparent)] p-3'
            : 'items-start'
        )}
      >
        <Card
          cardData={card.cardData as AnyCardData}
          instanceId={card.instanceId}
          imagePath={card.imagePath}
          size="lg"
          faceUp={true}
          interactive={false}
          showHover={false}
          showInfoOverlay={false}
          className={cn('max-w-full', !isMobile && 'h-[168px] w-[120px]')}
        />
        {!isMobile && (
          <div className="min-w-0 space-y-1.5">
            <CompactCardName card={card.cardData as AnyCardData} />
            <div className="break-all text-left text-[11px] leading-tight text-[var(--text-muted)]">
              {card.cardCode}
            </div>
            <div className="flex flex-wrap items-center gap-1.5">{pointBadge}</div>
            {typeDetails}
          </div>
        )}
      </div>

      {isMobile && (
        <>
          {/* 卡牌名称 */}
          <CardLocalizedName card={card.cardData} align="center" className="text-lg" />

          {/* 卡牌编号 */}
          <div className="break-all text-center text-xs text-[var(--text-muted)]">
            {card.cardCode}
          </div>

          <div className="flex justify-center">{pointBadge}</div>

          {/* 类型特定详情 */}
          {typeDetails}
        </>
      )}

      {/* 卡牌效果文本 */}
      {card.eventOnlyMissingData && (
        <div className="rounded border border-[var(--border-subtle)] bg-[color:color-mix(in_srgb,var(--bg-surface)_70%,transparent)] p-3 text-sm text-[var(--text-secondary)]">
          本地卡库未收录这张卡。公开日志只保留了卡号，不包含卡牌详情快照。
        </div>
      )}

      {!card.eventOnlyMissingData && (card.cardData.cardTextCn || card.cardData.cardTextJp) && (
        <div
          className={cn(
            'min-h-0 border-t border-[var(--border-subtle)] pt-2',
            !isMobile && 'flex flex-1 flex-col'
          )}
        >
          <span className="text-xs text-[var(--text-muted)]">效果</span>
          <CardLocalizedEffect
            card={card.cardData}
            className={cn(
              'mt-1',
              !isMobile && 'cute-scrollbar min-h-0 flex-1 overflow-y-auto pr-1'
            )}
            textClassName={isMobile ? 'text-sm' : 'text-[12px] leading-[1.42]'}
          />
        </div>
      )}
    </div>
  );
}

export default CardDetailOverlay;
