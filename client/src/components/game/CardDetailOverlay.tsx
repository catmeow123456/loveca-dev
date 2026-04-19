/**
 * 卡牌详情浮窗组件
 * 
 * 当鼠标悬停在卡牌上时，显示放大的卡牌图片和详细效果说明
 */

import { memo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';
import { useGameStore } from '@/store/gameStore';
import { getHeartRequirementEntries } from '@/lib/heartRequirementUtils';
import { Card } from '@/components/card/Card';
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

  const card = hoveredCardId ? getVisibleCardPresentation(hoveredCardId) : null;
  const point = card ? getCardPoint(card.cardCode) : 0;

  return (
    <AnimatePresence>
      {card && (
        <motion.div
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: 20 }}
          transition={{ duration: 0.2 }}
          className={cn(
            'fixed right-4 top-1/2 -translate-y-1/2 z-[200]',
            'surface-panel-frosted p-4',
            'border-[var(--border-default)] shadow-[var(--shadow-lg)]',
            'max-w-[280px] w-[280px]',
            'pointer-events-none'
          )}
        >
          {/* 大尺寸卡牌图片 */}
          <div className="flex justify-center mb-3">
            <Card
              cardData={card.cardData as AnyCardData}
              instanceId={card.instanceId}
              imagePath={card.imagePath}
              size="lg"
              faceUp={true}
              interactive={false}
              showHover={false}
            />
          </div>

          {/* 卡牌名称 */}
          <h3 className="mb-2 text-center text-lg font-bold text-[var(--text-primary)]">
            {card.cardData.name}
          </h3>

          {/* 卡牌编号 */}
          <div className="mb-3 text-center text-xs text-[var(--text-muted)]">
            {card.cardCode}
          </div>

          <div className="mb-3 flex justify-center">
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
            <div className="mt-3 border-t border-[var(--border-subtle)] pt-3">
              <span className="text-xs text-[var(--text-muted)]">效果</span>
              <p className="mt-1 text-sm leading-relaxed text-[var(--text-secondary)]">
                {card.cardData.cardText}
              </p>
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
});

export default CardDetailOverlay;
