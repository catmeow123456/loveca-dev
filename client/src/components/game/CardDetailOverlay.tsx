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
import { Card } from '@/components/card/Card';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import type { AnyCardData, MemberCardData, LiveCardData } from '@game/domain/entities/card';
import { isMemberCardData, isLiveCardData } from '@game/domain/entities/card';
import { HeartColor } from '@game/shared/types/enums';
import { getCardPoint } from '@game/domain/rules/deck-construction';

/**
 * 获取心颜色的中文名称
 */
function getHeartColorName(color: HeartColor): string {
  const names: Record<HeartColor, string> = {
    [HeartColor.PINK]: '粉色',
    [HeartColor.RED]: '红色',
    [HeartColor.YELLOW]: '黄色',
    [HeartColor.GREEN]: '绿色',
    [HeartColor.BLUE]: '蓝色',
    [HeartColor.PURPLE]: '紫色',
    [HeartColor.RAINBOW]: '灰',
  };
  return names[color] || color;
}

/**
 * 获取心颜色的 CSS 类名
 */
function getHeartColorClass(color: HeartColor): string {
  const classes: Record<HeartColor, string> = {
    [HeartColor.PINK]: 'text-pink-400',
    [HeartColor.RED]: 'text-red-400',
    [HeartColor.YELLOW]: 'text-yellow-400',
    [HeartColor.GREEN]: 'text-green-400',
    [HeartColor.BLUE]: 'text-blue-400',
    [HeartColor.PURPLE]: 'text-purple-400',
    [HeartColor.RAINBOW]: 'text-gray-400',
  };
  return classes[color] || 'text-[var(--text-muted)]';
}

/** 成员卡详情 */
export const MemberCardDetails = memo(function MemberCardDetails({ data }: { data: MemberCardData }) {
  return (
    <div className="space-y-3">
      {/* 基础信息 */}
      <div className="flex items-center gap-4 text-sm">
        <div className="chip-badge px-2.5 py-1">
          <span className="text-[var(--text-muted)]">费用</span>
          <span className="font-bold text-[var(--accent-primary)]">{data.cost}</span>
        </div>
        <div className="chip-badge px-2.5 py-1">
          <span className="text-[var(--text-muted)]">光棒</span>
          <span className="font-bold text-[var(--accent-gold)]">{data.blade}</span>
        </div>
      </div>

      {/* Hearts */}
      {data.hearts && data.hearts.length > 0 && (
        <div className="surface-panel rounded-2xl p-3">
          <span className="text-sm text-[var(--text-muted)]">Hearts</span>
          <div className="flex flex-wrap gap-1 mt-1">
            {data.hearts.map((heart, idx) => (
              <span key={idx} className={cn('text-lg', getHeartColorClass(heart.color))}>
                {'♥'.repeat(heart.count)}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* 组合/小组 */}
      {(data.groupName || data.unitName) && (
        <div className="text-xs text-[var(--text-muted)]">
          {data.groupName && <span className="mr-2">组合: {data.groupName}</span>}
          {data.unitName && <span>小组: {data.unitName}</span>}
        </div>
      )}
    </div>
  );
});

/** Live 卡详情 */
export const LiveCardDetails = memo(function LiveCardDetails({ data }: { data: LiveCardData }) {
  // 将 Map 转换为数组进行遍历
  const requirements = getHeartRequirementEntries(data.requirements?.colorRequirements);

  return (
    <div className="space-y-3">
      {/* 分数 */}
      <div className="chip-badge px-2.5 py-1 text-sm">
        <span className="text-[var(--text-muted)]">分数</span>
        <span className="text-lg font-bold text-[var(--accent-gold)]">♪ {data.score}</span>
      </div>

      {/* Heart 需求 */}
      <div className="surface-panel rounded-2xl p-3">
        <span className="text-sm text-[var(--text-muted)]">需要 Hearts</span>
        <div className="flex flex-wrap gap-2 mt-1">
          {requirements.map(([color, count]) => (
            <div key={color} className="flex items-center gap-1">
              <span className={cn('text-lg', getHeartColorClass(color as HeartColor))}>
                {'♥'.repeat(count as number)}
              </span>
              <span className="text-xs text-[var(--text-muted)]">({getHeartColorName(color as HeartColor)})</span>
            </div>
          ))}
        </div>
        <div className="mt-1 text-xs text-[var(--text-muted)]">
          总计需要 {data.requirements.totalRequired} 个心
        </div>
      </div>
    </div>
  );
});

export const CardDetailOverlay = memo(function CardDetailOverlay() {
  const hoveredCardId = useGameStore((s) => s.ui.hoveredCardId);
  const getVisibleCardPresentation = useGameStore((s) => s.getVisibleCardPresentation);
  const setHoveredCard = useGameStore((s) => s.setHoveredCard);
  const shouldUseCompactDrawer = useMediaQuery('(max-width: 1023px)');

  const card = hoveredCardId ? getVisibleCardPresentation(hoveredCardId) : null;
  const closeDetail = useCallback(() => {
    setHoveredCard(null);
  }, [setHoveredCard]);

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
      {card && (
        shouldUseCompactDrawer ? (
          <MobileCardDetailDrawer
            key={`mobile-card-detail-${card.instanceId}`}
            card={card}
            onClose={closeDetail}
          />
        ) : (
          <DesktopCardDetailPanel
            key={`desktop-card-detail-${card.instanceId}`}
            card={card}
          />
        )
      )}
    </AnimatePresence>
  );

  if (typeof document === 'undefined') {
    return content;
  }

  return createPortal(content, document.body);
});

function DesktopCardDetailPanel({ card }: { card: VisibleCardPresentation }) {
  return (
    <aside
      className="pointer-events-none fixed bottom-3 right-3 top-3 z-[200]"
      aria-label={`${card.cardData.name} 卡牌详情`}
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
        aria-label={`${card.cardData.name} 卡牌详情`}
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'tween', duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}
        className="safe-bottom fixed inset-x-0 bottom-0 z-[120] flex max-h-[86dvh] min-h-[46dvh] flex-col overflow-hidden rounded-t-[24px] border border-b-0 border-[var(--border-default)] bg-[var(--bg-surface)] shadow-[var(--shadow-lg)]"
        onClick={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div className="shrink-0 px-4 pb-2 pt-3">
          <div className="mb-3 flex justify-center">
            <div className="h-1.5 w-12 rounded-full bg-[var(--border-default)]" />
          </div>
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <h2 className="truncate text-sm font-bold text-[var(--text-primary)]">
                卡牌详情
              </h2>
              <p className="mt-0.5 truncate text-xs text-[var(--text-muted)]">
                {card.cardData.name}
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

  return (
    <div className={cn(isMobile ? 'space-y-3 pb-1' : 'flex h-full min-h-0 flex-col gap-2.5')}>
      {/* 大尺寸卡牌图片 */}
      <div
        className={cn(
          'flex justify-center',
          isMobile
            ? 'rounded-2xl border border-[var(--border-subtle)] bg-[color:color-mix(in_srgb,var(--bg-frosted)_44%,transparent)] p-3'
            : 'shrink-0'
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
          className={cn('max-w-full', !isMobile && 'h-[196px] w-[140px]')}
        />
      </div>

      {/* 卡牌名称 */}
      <h3
        className={cn(
          'break-words text-center font-bold text-[var(--text-primary)]',
          isMobile ? 'text-lg' : 'text-base leading-tight'
        )}
      >
        {card.cardData.name}
      </h3>

      {/* 卡牌编号 */}
      <div className="break-all text-center text-xs text-[var(--text-muted)]">
        {card.cardCode}
      </div>

      <div className="flex justify-center">
        <span className="chip-badge px-2.5 py-1 text-sm">
          <span className="text-[var(--text-muted)]">点数</span>
          <span className="font-bold text-[var(--accent-primary)]">{point}pt</span>
        </span>
      </div>

      {/* 类型特定详情 */}
      {isMemberCardData(card.cardData) && (
        <MemberCardDetails data={card.cardData} />
      )}
      {isLiveCardData(card.cardData) && (
        <LiveCardDetails data={card.cardData} />
      )}

      {/* 卡牌效果文本 */}
      {card.cardData.cardText && (
        <div className={cn('min-h-0 border-t border-[var(--border-subtle)] pt-2', !isMobile && 'flex flex-1 flex-col')}>
          <span className="text-xs text-[var(--text-muted)]">效果</span>
          <p
            className={cn(
              'mt-1 whitespace-pre-wrap break-words text-[var(--text-secondary)]',
              isMobile
                ? 'text-sm leading-relaxed'
                : 'cute-scrollbar min-h-0 flex-1 overflow-y-auto text-[12px] leading-[1.42]'
            )}
          >
            {card.cardData.cardText}
          </p>
        </div>
      )}
    </div>
  );
}

export default CardDetailOverlay;
