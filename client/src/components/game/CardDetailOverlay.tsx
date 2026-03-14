/**
 * 卡牌详情浮窗组件
 * 
 * 当鼠标悬停在卡牌上时，显示放大的卡牌图片和详细效果说明
 */

import { memo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';
import { useGameStore } from '@/store/gameStore';
import { Card } from '@/components/card/Card';
import type { AnyCardData, MemberCardData, LiveCardData } from '@game/domain/entities/card';
import { isMemberCardData, isLiveCardData } from '@game/domain/entities/card';
import { HeartColor } from '@game/shared/types/enums';

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
  return classes[color] || 'text-slate-400';
}

/** 成员卡详情 */
export const MemberCardDetails = memo(function MemberCardDetails({ data }: { data: MemberCardData }) {
  return (
    <div className="space-y-2">
      {/* 基础信息 */}
      <div className="flex items-center gap-4 text-sm">
        <div className="flex items-center gap-1">
          <span className="text-slate-400">费用:</span>
          <span className="text-rose-400 font-bold">{data.cost}</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="text-slate-400">光棒:</span>
          <span className="text-amber-400 font-bold">{data.blade}</span>
        </div>
      </div>

      {/* Hearts */}
      {data.hearts && data.hearts.length > 0 && (
        <div>
          <span className="text-slate-400 text-sm">Hearts:</span>
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
        <div className="text-xs text-slate-500">
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
  const requirements = data.requirements.colorRequirements instanceof Map
    ? Array.from(data.requirements.colorRequirements.entries())
    : Object.entries(data.requirements.colorRequirements);

  return (
    <div className="space-y-2">
      {/* 分数 */}
      <div className="flex items-center gap-1 text-sm">
        <span className="text-slate-400">分数:</span>
        <span className="text-amber-400 font-bold text-lg">♪ {data.score}</span>
      </div>

      {/* Heart 需求 */}
      <div>
        <span className="text-slate-400 text-sm">需要 Hearts:</span>
        <div className="flex flex-wrap gap-2 mt-1">
          {requirements.map(([color, count]) => (
            <div key={color} className="flex items-center gap-1">
              <span className={cn('text-lg', getHeartColorClass(color as HeartColor))}>
                {'♥'.repeat(count as number)}
              </span>
              <span className="text-xs text-slate-500">({getHeartColorName(color as HeartColor)})</span>
            </div>
          ))}
        </div>
        <div className="text-xs text-slate-500 mt-1">
          总计需要 {data.requirements.totalRequired} 个心
        </div>
      </div>
    </div>
  );
});

export const CardDetailOverlay = memo(function CardDetailOverlay() {
  const hoveredCardId = useGameStore((s) => s.ui.hoveredCardId);
  const getCardInstance = useGameStore((s) => s.getCardInstance);
  const getCardImagePath = useGameStore((s) => s.getCardImagePath);

  const card = hoveredCardId ? getCardInstance(hoveredCardId) : null;

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
            'bg-slate-900/95 backdrop-blur-sm',
            'rounded-xl border border-slate-700',
            'shadow-2xl p-4',
            'max-w-[280px] w-[280px]',
            'pointer-events-none'
          )}
        >
          {/* 大尺寸卡牌图片 */}
          <div className="flex justify-center mb-3">
            <Card
              cardData={card.data as AnyCardData}
              instanceId={card.instanceId}
              imagePath={getCardImagePath(card.data.cardCode)}
              size="lg"
              faceUp={true}
              interactive={false}
              showHover={false}
            />
          </div>

          {/* 卡牌名称 */}
          <h3 className="text-white font-bold text-lg text-center mb-2">
            {card.data.name}
          </h3>

          {/* 卡牌编号 */}
          <div className="text-xs text-slate-500 text-center mb-3">
            {card.data.cardCode}
          </div>

          {/* 类型特定详情 */}
          {isMemberCardData(card.data) && (
            <MemberCardDetails data={card.data} />
          )}
          {isLiveCardData(card.data) && (
            <LiveCardDetails data={card.data} />
          )}

          {/* 卡牌效果文本 */}
          {card.data.cardText && (
            <div className="mt-3 pt-3 border-t border-slate-700">
              <span className="text-slate-400 text-xs">效果:</span>
              <p className="text-white text-sm mt-1 leading-relaxed">
                {card.data.cardText}
              </p>
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
});

export default CardDetailOverlay;
